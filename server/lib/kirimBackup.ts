// Kirim berkas cadangan database ke Bot Telegram dan/atau Email (SMTP)
// SETELAH backup lokal selesai dibuat. Semua kegagalan di sini hanya dicatat
// (kolom status kirim pada system_backups) — cadangan lokal tetap sukses.
//
// Berkas .sql.gz dikemas ulang menjadi .zip sebelum dikirim (batas lampiran
// email 25 MB & Bot Telegram 50 MB). Berkas zip adalah berkas sementara di
// folder temp sistem dan dihapus setelah pengiriman.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import nodemailer from 'nodemailer';
import { get, run } from '../db.pg.ts';
import { catatHasilKirim } from './sistem.ts';

/* ------------------------------- KONFIG ---------------------------------- */

export interface KonfigKirim {
  telegram_aktif: boolean;
  telegram_token: string;
  telegram_chat_id: string;
  email_aktif: boolean;
  email_tujuan: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_pengguna: string;
  smtp_sandi: string;
}

/**
 * Kunci `settings` milik fitur ini. Host/port/pengguna/sandi SMTP memakai
 * kunci lama yang sama dengan tab Notifikasi & Pesan agar kredensial tidak
 * tersimpan dua kali.
 */
const KUNCI = {
  telegram_aktif: 'peng.database.kirim_telegram_aktif',
  telegram_token: 'peng.database.kirim_telegram_token',
  telegram_chat_id: 'peng.database.kirim_telegram_chat_id',
  email_aktif: 'peng.database.kirim_email_aktif',
  email_tujuan: 'peng.database.kirim_email_tujuan',
  smtp_secure: 'peng.database.kirim_smtp_secure',
  smtp_host: 'smtp_host',
  smtp_port: 'smtp_port',
  smtp_pengguna: 'smtp_pengguna',
  smtp_sandi: 'smtp_sandi',
} as const;

const baca = async (kunci: string): Promise<string> =>
  String((await get<{ nilai: string | null }>('SELECT nilai FROM settings WHERE kunci = ?', kunci))?.nilai ?? '');

const tulis = async (kunci: string, nilai: string): Promise<void> => {
  await run(
    `INSERT INTO settings (kunci, nilai, diubah_pada) VALUES (?, ?, now())
     ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai, diubah_pada = excluded.diubah_pada`,
    kunci,
    nilai,
  );
};

export async function bacaKonfigKirim(): Promise<KonfigKirim> {
  const port = Number.parseInt(await baca(KUNCI.smtp_port), 10);
  return {
    telegram_aktif: (await baca(KUNCI.telegram_aktif)) === 'true',
    telegram_token: await baca(KUNCI.telegram_token),
    telegram_chat_id: await baca(KUNCI.telegram_chat_id),
    email_aktif: (await baca(KUNCI.email_aktif)) === 'true',
    email_tujuan: await baca(KUNCI.email_tujuan),
    smtp_host: await baca(KUNCI.smtp_host),
    smtp_port: Number.isFinite(port) && port > 0 ? port : 465,
    smtp_secure: (await baca(KUNCI.smtp_secure)) !== 'false',
    smtp_pengguna: await baca(KUNCI.smtp_pengguna),
    smtp_sandi: await baca(KUNCI.smtp_sandi),
  };
}

/** Simpan konfigurasi. Token/sandi kosong = pertahankan nilai lama. */
export async function simpanKonfigKirim(patch: Partial<KonfigKirim>): Promise<void> {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if ((k === 'telegram_token' || k === 'smtp_sandi') && String(v) === '') continue;
    const kunci = KUNCI[k as keyof typeof KUNCI];
    if (!kunci) continue;
    await tulis(kunci, typeof v === 'boolean' ? String(v) : String(v));
  }
}

/* ------------------------------- UTILITAS -------------------------------- */

const batasUkuran = (b: number): string =>
  b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : b >= 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`;

/** Waktu zona WIB — dipakai caption Telegram, subjek & isi email. */
export function formatWib(d: Date): string {
  const bagian = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const ambil = (t: string): string => bagian.find((x) => x.type === t)?.value ?? '';
  return `${ambil('day')}/${ambil('month')}/${ambil('year')} ${ambil('hour')}:${ambil('minute')} WIB`;
}

/**
 * Kemas berkas cadangan menjadi .zip sementara.
 * Mengembalikan path zip (pemanggil wajib menghapusnya).
 */
export function zipkanCadangan(sumber: string): string {
  const namaAsli = path.basename(sumber);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nusapos-kirim-'));
  const tujuan = path.join(dir, `${namaAsli.replace(/\.(sql\.gz|dump|tar|sql)$/i, '')}.zip`);
  const zip = new AdmZip();
  zip.addLocalFile(sumber);
  zip.writeZip(tujuan);
  return tujuan;
}

export function hapusBerkasKirim(p: string): void {
  try {
    const dir = path.dirname(p);
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* berkas sementara — abaikan */
  }
}

/* ------------------------------- TELEGRAM -------------------------------- */

export interface MetaKirim {
  /** Nama berkas cadangan (mis. nusa_backup_v0.1.0_20261124_2300.sql.gz). */
  nama: string;
  /** Waktu backup dibuat. */
  waktu: Date;
  /** Ukuran berkas asli (byte) — untuk ringkasan caption/email. */
  ukuran: number;
  /** Asal cadangan: manual / otomatis. */
  tipe?: string;
}

function captionTelegram(meta: MetaKirim, namaZip: string): string {
  return [
    '✅ Auto-Backup ERP Berhasil',
    `📅 Waktu: ${formatWib(meta.waktu)}`,
    `📦 Ukuran: ${batasUkuran(meta.ukuran)}`,
    `🗂️ File: ${namaZip}`,
    meta.tipe ? `🏷️ Tipe: ${meta.tipe === 'otomatis' ? 'Terjadwal' : 'Manual'}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function telegramApi(token: string, metode: string, form: FormData): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${metode}`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  let isi: { ok?: boolean; description?: string } = {};
  try {
    isi = (await res.json()) as { ok?: boolean; description?: string };
  } catch {
    /* balasan bukan JSON */
  }
  if (!res.ok || isi.ok !== true) {
    throw new Error(isi.description || `Telegram menolak permintaan (HTTP ${res.status}).`);
  }
}

/** Kirim berkas cadangan (.zip) sebagai document ke chat/grup Telegram. */
export async function sendBackupToTelegram(zipPath: string, meta: MetaKirim): Promise<void> {
  const cfg = await bacaKonfigKirim();
  if (!cfg.telegram_token || !cfg.telegram_chat_id) {
    throw new Error('Bot Token / Chat ID Telegram belum diisi.');
  }
  const ukuran = fs.statSync(zipPath).size;
  if (ukuran > 50 * 1024 * 1024) {
    throw new Error(`Ukuran ${batasUkuran(ukuran)} melebihi batas Bot Telegram (50 MB).`);
  }
  const namaZip = path.basename(zipPath);
  const form = new FormData();
  form.append('chat_id', cfg.telegram_chat_id);
  form.append('caption', captionTelegram(meta, namaZip));
  form.append('document', new Blob([fs.readFileSync(zipPath)]), namaZip);
  await telegramApi(cfg.telegram_token, 'sendDocument', form);
}

/** Pesan uji (tanpa lampiran) untuk memastikan token & Chat ID valid. */
export async function tesTelegram(): Promise<void> {
  const cfg = await bacaKonfigKirim();
  if (!cfg.telegram_token || !cfg.telegram_chat_id) {
    throw new Error('Bot Token / Chat ID Telegram belum diisi.');
  }
  const form = new FormData();
  form.append('chat_id', cfg.telegram_chat_id);
  form.append(
    'text',
    `✅ Tes Kirim Berhasil\nAuto-Backup ERP terhubung ke Bot Telegram pada ${formatWib(new Date())}.`,
  );
  await telegramApi(cfg.telegram_token, 'sendMessage', form);
}

/* --------------------------------- EMAIL --------------------------------- */

function transporterEmail(cfg: KonfigKirim) {
  return nodemailer.createTransport({
    host: cfg.smtp_host,
    port: cfg.smtp_port,
    secure: cfg.smtp_secure,
    auth: cfg.smtp_pengguna ? { user: cfg.smtp_pengguna, pass: cfg.smtp_sandi } : undefined,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 180_000,
  });
}

function cekSmtp(cfg: KonfigKirim): void {
  if (!cfg.smtp_host) throw new Error('Host SMTP belum diisi.');
  if (!cfg.email_tujuan) throw new Error('Email tujuan belum diisi.');
}

/** Kirim berkas cadangan (.zip) sebagai lampiran email. */
export async function sendBackupToEmail(zipPath: string, meta: MetaKirim): Promise<void> {
  const cfg = await bacaKonfigKirim();
  cekSmtp(cfg);
  const ukuran = fs.statSync(zipPath).size;
  if (ukuran > 25 * 1024 * 1024) {
    throw new Error(`Ukuran ${batasUkuran(ukuran)} melebihi batas lampiran email (25 MB).`);
  }
  const namaZip = path.basename(zipPath);
  await transporterEmail(cfg).sendMail({
    from: cfg.smtp_pengguna,
    to: cfg.email_tujuan,
    subject: `[Auto-Backup ERP] Cadangan Database - ${formatWib(meta.waktu)}`,
    text: [
      'Cadangan database berhasil dibuat dan dilampirkan pada email ini.',
      '',
      `Waktu   : ${formatWib(meta.waktu)}`,
      `Ukuran  : ${batasUkuran(meta.ukuran)}`,
      `Berkas  : ${namaZip}`,
      meta.tipe ? `Tipe    : ${meta.tipe === 'otomatis' ? 'Terjadwal' : 'Manual'}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    attachments: [{ filename: namaZip, path: zipPath }],
  });
}

/** Email uji (tanpa lampiran) untuk memverifikasi koneksi SMTP. */
export async function tesEmail(): Promise<void> {
  const cfg = await bacaKonfigKirim();
  cekSmtp(cfg);
  await transporterEmail(cfg).sendMail({
    from: cfg.smtp_pengguna,
    to: cfg.email_tujuan,
    subject: '[Auto-Backup ERP] Tes Kirim Email',
    text: `Koneksi SMTP berhasil. Pengiriman otomatis cadangan database aktif sejak ${formatWib(new Date())}.`,
  });
}

/* ---------------------------- ORKESTRASI --------------------------------- */

export type StatusKirim = 'terkirim' | 'gagal';

/**
 * Kirim satu berkas cadangan ke semua tujuan yang aktif.
 * Tidak pernah melempar galat: kegagalan dicatat di riwayat backup.
 */
export async function kirimCadanganOtomatis(sumber: string, meta: MetaKirim): Promise<void> {
  let cfg: KonfigKirim;
  try {
    cfg = await bacaKonfigKirim();
  } catch (e) {
    console.warn('[kirim-backup] gagal membaca konfigurasi:', (e as Error)?.message);
    return;
  }
  const keTelegram = cfg.telegram_aktif && Boolean(cfg.telegram_token) && Boolean(cfg.telegram_chat_id);
  const keEmail = cfg.email_aktif && Boolean(cfg.smtp_host) && Boolean(cfg.email_tujuan);
  if (!keTelegram && !keEmail) return;

  let zipPath = '';
  const galat: string[] = [];
  let statusTelegram: StatusKirim | null = null;
  let statusEmail: StatusKirim | null = null;
  try {
    zipPath = zipkanCadangan(sumber);
    const ukuranZip = fs.statSync(zipPath).size;
    const metaZip: MetaKirim = { ...meta, nama: path.basename(zipPath), ukuran: ukuranZip };

    if (keTelegram) {
      try {
        await sendBackupToTelegram(zipPath, metaZip);
        statusTelegram = 'terkirim';
      } catch (e) {
        statusTelegram = 'gagal';
        galat.push(`Telegram: ${(e as Error)?.message ?? 'gagal'}`);
      }
    }
    if (keEmail) {
      try {
        await sendBackupToEmail(zipPath, metaZip);
        statusEmail = 'terkirim';
      } catch (e) {
        statusEmail = 'gagal';
        galat.push(`Email: ${(e as Error)?.message ?? 'gagal'}`);
      }
    }
  } catch (e) {
    galat.push(`Kompresi: ${(e as Error)?.message ?? 'gagal'}`);
    if (keTelegram) statusTelegram = 'gagal';
    if (keEmail) statusEmail = 'gagal';
  } finally {
    if (zipPath) hapusBerkasKirim(zipPath);
  }

  try {
    await catatHasilKirim(meta.nama, {
      telegram: statusTelegram,
      email: statusEmail,
      galat: galat.length ? galat.join(' | ').slice(0, 500) : null,
    });
  } catch {
    /* riwayat kirim opsional */
  }
  if (galat.length) console.warn(`[kirim-backup] ${meta.nama}: ${galat.join(' | ')}`);
}

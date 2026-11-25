// Backup & Restore Database — endpoint RESTful khusus.
//
//   GET    /api/backup/list        daftar riwayat (nama, waktu, ukuran, tipe, status)
//   GET    /api/backup/status      status jadwal + mode maintenance (polling publik login)
//   POST   /api/backup/create      backup manual {alasan?} -> 201
//   GET    /api/backup/unduh?nama= unduh berkas
//   POST   /api/backup/restore     JSON {nama, konfirmasi} ATAU raw octet-stream
//                                  (?nama= & ?konfirmasi=) untuk unggahan
//   DELETE /api/backup/:filename   hapus berkas dari server
//   GET    /api/backup/jadwal      baca pengaturan jadwal
//   PUT    /api/backup/jadwal      simpan pengaturan jadwal
//
// Baca daftar/status/jadwal dijaga izin tab Database; aksi yang mengubah data
// atau berkas (create/unduh/restore/hapus/jadwal) HANYA untuk Administrator.
// Rute lama /api/pengaturan/sistem/* tetap hidup (kompatibel) dan memakai
// inti lib yang sama.
import express, { Router, type RequestHandler } from 'express';
import {
  NAMA_CHECKPOINT,
  buatBackup,
  hapusBackup,
  konfirmasiRestoreBenar,
  pathBackup,
  pulihkanDariBerkas,
  pulihkanDariUnggahan,
  riwayatBackup,
  sedangMaintenance,
  statusBackup,
} from '../lib/sistem.ts';
import { cariTab, tulisTab, validasi } from '../lib/pengaturanBaru.ts';
import {
  bacaKonfigKirim,
  simpanKonfigKirim,
  tesEmail,
  tesTelegram,
} from '../lib/kirimBackup.ts';
import { catatAudit } from '../lib/audit.ts';
import { tolak } from '../lib/http.ts';
import { asyncHandler } from '../lib/http.ts';
import { penggunaSaatIni } from '../lib/akses.ts';
import { wajibIzinTabInfo } from './pengaturan.ts';

const jaga: RequestHandler = wajibIzinTabInfo('database');

/**
 * Backup, restore, unduh, hapus, dan perubahan jadwal HANYA untuk Administrator
 * (Owner/Administrator tanpa override peran) — izin tab Database saja tidak
 * cukup karena berkas cadangan memuat seluruh data.
 */
const wajibAdminBackup: RequestHandler = (req, _res, next) => {
  if (req.konteks?.admin === true) {
    next();
    return;
  }
  next(tolak(403, 'Backup & Restore database hanya untuk Administrator.'));
};

export function routerBackup(): Router {
  const r = Router();

  /* Daftar riwayat backup + status maintenance. */
  r.get(
    '/list',
    jaga,
    asyncHandler(async (_req, res) => {
      res.json({ data: await riwayatBackup(), maintenance: sedangMaintenance() });
    }),
  );

  /* Status jadwal & maintenance (dipolling saat layar maintenance tampil). */
  r.get(
    '/status',
    jaga,
    asyncHandler(async (_req, res) => {
      res.json(await statusBackup());
    }),
  );

  /* Backup manual (instant). */
  r.post(
    '/create',
    jaga,
    wajibAdminBackup,
    asyncHandler(async (req, res) => {
      const pengguna = penggunaSaatIni(req);
      const alasan = String(req.body?.alasan ?? 'cadangan manual').slice(0, 120);
      const nama = await buatBackup(alasan, { tipe: 'manual', pembuat: pengguna.id });
      await catatAudit({
        userId: pengguna.id, aksi: 'tambah', tabel: 'pengaturan', recordId: 'database',
        sesudah: { cadangan: nama, tipe: 'manual', alasan },
        alasan: 'Backup manual dari dashboard',
      });
      const baris = (await riwayatBackup()).find((b) => b.nama === nama);
      res.status(201).json({ nama, ukuran: baris?.ukuran ?? 0, pesan: `Cadangan ${nama} berhasil dibuat.` });
    }),
  );

  /* Unduh berkas cadangan. */
  r.get(
    '/unduh',
    jaga,
    wajibAdminBackup,
    asyncHandler(async (req, res) => {
      const nama = String(req.query.nama ?? '');
      const p = pathBackup(nama);
      await catatAudit({
        userId: penggunaSaatIni(req).id, aksi: 'ekspor', tabel: 'pengaturan',
        recordId: 'database', sesudah: { cadangan: nama },
      });
      res.download(p, nama);
    }),
  );

  /* Restore: JSON {nama, konfirmasi} ATAU unggahan biner (?nama=&?konfirmasi=). */
  r.post(
    '/restore',
    jaga,
    wajibAdminBackup,
    (req, _res, next) => {
      const ct = String(req.headers['content-type'] ?? '');
      if (ct.includes('application/octet-stream')) {
        express.raw({ type: 'application/octet-stream', limit: '512mb' })(req, _res, next);
        return;
      }
      express.json()(req, _res, next);
    },
    asyncHandler(async (req, res) => {
      const pengguna = penggunaSaatIni(req);
      let konfirmasi: unknown;
      let pengaman: string;
      let sumber: string;
      if (Buffer.isBuffer(req.body)) {
        const namaAsli = String(req.query.nama ?? '');
        konfirmasi = req.query.konfirmasi;
        if (!konfirmasiRestoreBenar(konfirmasi)) {
          throw tolak(400, 'Konfirmasi salah. Ketik RESTORE untuk melanjutkan.');
        }
        const isi = req.body as Buffer;
        if (!isi || isi.length === 0) throw tolak(400, 'Berkas unggahan kosong atau tidak terbaca.');
        sumber = `unggahan ${namaAsli || '(tanpa nama)'}`;
        pengaman = await pulihkanDariUnggahan(isi, namaAsli);
      } else {
        const nama = String((req.body as { nama?: unknown })?.nama ?? '');
        konfirmasi = (req.body as { konfirmasi?: unknown })?.konfirmasi;
        if (!konfirmasiRestoreBenar(konfirmasi)) {
          throw tolak(400, 'Konfirmasi salah. Ketik RESTORE untuk melanjutkan.');
        }
        sumber = nama;
        pengaman = await pulihkanDariBerkas(pathBackup(nama));
      }
      await catatAudit({
        userId: pengguna.id, aksi: 'ubah', tabel: 'pengaturan', recordId: 'database',
        sesudah: { dipulihkan_dari: sumber, cadangan_pengaman: pengaman },
        alasan: 'Restore database dari dashboard backup',
      });
      res.json({
        pesan: 'Database berhasil dipulihkan! Halaman akan dimuat ulang.',
        sumber,
        pengaman,
      });
    }),
  );

  /* Hapus berkas cadangan dari server. */
  r.delete(
    '/:filename',
    jaga,
    wajibAdminBackup,
    asyncHandler(async (req, res) => {
      const nama = String(req.params.filename ?? '');
      await hapusBackup(nama);
      await catatAudit({
        userId: penggunaSaatIni(req).id, aksi: 'hapus', tabel: 'pengaturan',
        recordId: 'database', sesudah: { cadangan_dihapus: nama },
      });
      res.json({ pesan: `Cadangan ${nama} dihapus dari server.` });
    }),
  );

  /* Baca pengaturan jadwal auto-backup. */
  r.get(
    '/jadwal',
    jaga,
    asyncHandler(async (_req, res) => {
      const st = await statusBackup();
      res.json({
        mode: st.mode, jam: st.jam, jumlah: st.jumlah,
        retensi_hari: st.retensi_hari,
        interval_nilai: st.interval_nilai, interval_satuan: st.interval_satuan,
        terakhir_otomatis: st.terakhir_otomatis, berikutnya: st.berikutnya,
      });
    }),
  );

  /* Simpan pengaturan jadwal auto-backup. */
  r.put(
    '/jadwal',
    jaga,
    wajibAdminBackup,
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      // Hanya bidang yang benar-benar dikirim yang divalidasi/disimpan; nilai
      // undefined tidak boleh menimpa pengaturan lain atau gagal validasi.
      const nilai: Record<string, unknown> = {};
      for (const kunci of ['backup_otomatis', 'backup_jam', 'interval_nilai', 'interval_satuan', 'jumlah_backup', 'retensi_hari']) {
        if (body[kunci] !== undefined) nilai[kunci] = body[kunci];
      }
      const tab = cariTab('database');
      validasi(tab, nilai);
      const daftar = await tulisTab(tab, nilai, null);
      await catatAudit({
        userId: penggunaSaatIni(req).id, aksi: 'ubah', tabel: 'pengaturan',
        recordId: 'database',
        sebelum: Object.fromEntries(daftar.map((d) => [d.kunci, d.sebelum])),
        sesudah: Object.fromEntries(daftar.map((d) => [d.kunci, d.sesudah])),
        alasan: 'Ubah jadwal backup otomatis',
      });
      res.json({ pesan: daftar.length ? `${daftar.length} pengaturan jadwal disimpan.` : 'Tidak ada perubahan.', jumlah: daftar.length });
    }),
  );

  /* ============ Kirim otomatis backup ke Telegram & Email (SMTP) ========== */

  /* Baca konfigurasi pengiriman — token & kata sandi TIDAK pernah dikirim. */
  r.get(
    '/kirim',
    jaga,
    wajibAdminBackup,
    asyncHandler(async (_req, res) => {
      const k = await bacaKonfigKirim();
      res.json({
        data: {
          telegram_aktif: k.telegram_aktif,
          telegram_chat_id: k.telegram_chat_id,
          telegram_token_ada: Boolean(k.telegram_token),
          telegram_token_ekor: k.telegram_token ? k.telegram_token.slice(-4) : '',
          email_aktif: k.email_aktif,
          email_tujuan: k.email_tujuan,
          smtp_host: k.smtp_host,
          smtp_port: k.smtp_port,
          smtp_secure: k.smtp_secure,
          smtp_pengguna: k.smtp_pengguna,
          smtp_sandi_ada: Boolean(k.smtp_sandi),
        },
      });
    }),
  );

  /* Simpan konfigurasi pengiriman (token/sandi kosong = pertahankan lama). */
  r.put(
    '/kirim',
    jaga,
    wajibAdminBackup,
    asyncHandler(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const teks = (v: unknown, label: string, maks: number): string => {
        const s = String(v ?? '').trim();
        if (s.length > maks) throw tolak(400, `${label} maksimal ${maks} karakter.`);
        return s;
      };
      const patch: Record<string, unknown> = {};
      if (b.telegram_aktif !== undefined) patch.telegram_aktif = b.telegram_aktif === true;
      if (b.email_aktif !== undefined) patch.email_aktif = b.email_aktif === true;
      if (b.telegram_chat_id !== undefined) {
        const chat = teks(b.telegram_chat_id, 'Chat ID Tujuan', 64);
        if (chat && !/^-?\d+$/.test(chat)) {
          throw tolak(400, 'Chat ID Telegram harus berupa angka (ID personal, grup, atau channel -100…).');
        }
        patch.telegram_chat_id = chat;
      }
      if (b.telegram_token !== undefined) {
        const token = teks(b.telegram_token, 'Bot Token', 200);
        if (token && !/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
          throw tolak(400, 'Bot Token Telegram tidak valid (format: 123456789:AA…).');
        }
        if (token) patch.telegram_token = token;
      }
      if (b.email_tujuan !== undefined) {
        const email = teks(b.email_tujuan, 'Email Tujuan', 200);
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          throw tolak(400, 'Alamat email tujuan tidak valid.');
        }
        patch.email_tujuan = email;
      }
      if (b.smtp_host !== undefined) patch.smtp_host = teks(b.smtp_host, 'Host SMTP', 120);
      if (b.smtp_pengguna !== undefined) patch.smtp_pengguna = teks(b.smtp_pengguna, 'Email Pengirim', 200);
      if (b.smtp_sandi !== undefined) {
        const sandi = teks(b.smtp_sandi, 'SMTP Password', 200);
        if (sandi) patch.smtp_sandi = sandi;
      }
      if (b.smtp_port !== undefined) {
        const port = Number(b.smtp_port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw tolak(400, 'Port SMTP harus 1–65535.');
        patch.smtp_port = port;
      }
      if (b.smtp_secure !== undefined) patch.smtp_secure = b.smtp_secure === true;

      if (!Object.keys(patch).length) throw tolak(400, 'Tidak ada pengaturan pengiriman yang dikirim.');
      await simpanKonfigKirim(patch as Parameters<typeof simpanKonfigKirim>[0]);
      // Audit tanpa kredensial: nilai rahasia hanya ditandai berubah.
      const aman = { ...patch } as Record<string, unknown>;
      for (const k of ['telegram_token', 'smtp_sandi']) if (k in aman) aman[k] = '(disimpan) ';
      await catatAudit({
        userId: penggunaSaatIni(req).id, aksi: 'ubah', tabel: 'pengaturan',
        recordId: 'database', sesudah: aman,
        alasan: 'Ubah pengiriman backup otomatis (Telegram/Email)',
      });
      res.json({ pesan: 'Pengaturan pengiriman backup disimpan.' });
    }),
  );

  /* Tes kirim: pesan/email uji memakai konfigurasi yang tersimpan. */
  r.post(
    '/kirim/tes',
    jaga,
    wajibAdminBackup,
    asyncHandler(async (req, res) => {
      const kanal = String(req.body?.kanal ?? '');
      if (kanal === 'telegram') {
        try {
          await tesTelegram();
        } catch (e) {
          throw tolak(502, `Tes Telegram gagal: ${(e as Error)?.message ?? 'tidak diketahui'}`, true);
        }
        res.json({ pesan: 'Pesan uji berhasil dikirim ke Telegram.' });
        return;
      }
      if (kanal === 'email') {
        try {
          await tesEmail();
        } catch (e) {
          throw tolak(502, `Tes email gagal: ${(e as Error)?.message ?? 'tidak diketahui'}`, true);
        }
        res.json({ pesan: 'Email uji berhasil dikirim.' });
        return;
      }
      throw tolak(400, 'Kanal tidak dikenal (telegram / email).');
    }),
  );

  return r;
}

/** Nama checkpoint — dipakai UI untuk menandai baris pengaman. */
export { NAMA_CHECKPOINT };

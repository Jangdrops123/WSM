// ============================================================================
// Rute Log In (Tahap 1) + Lupa Password & Kode Pemulihan (Tahap 2)
//
//   POST /masuk          Log In (username/email + password, "Ingat saya")
//   POST /keluar         Keluar (hapus sesi + cookie)
//   GET  /sesi           Cek sesi aktif → identitas + matriks hak akses
//   POST /ganti-sandi    Ganti password sendiri (lama + baru + konfirmasi)
//   GET  /lupa/kanal     Apakah alur mandiri tersedia (email/WhatsApp aktif)
//   POST /lupa           Minta tautan reset (pesan selalu netral)
//   POST /kirim-ulang    Kirim ulang tautan reset
//   POST /reset          Pakai tautan reset → password baru
//   POST /pulihkan       Pakai Kode Pemulihan Admin (tanpa email/WhatsApp)
//   GET  /info           Info ringkas untuk halaman Log In
//
// Aturan keamanan:
//   * Password disimpan sebagai hash bcrypt — tidak pernah teks biasa.
//   * 5x salah → akun terkunci (durasi dari Pengaturan ▸ Keamanan).
//   * Reset: berlaku 30 menit, sekali pakai, maksimal 3x per jam per akun,
//     balasan selalu netral (tidak membocorkan keberadaan akun).
//   * Password berubah → seluruh sesi lama pengguna itu ikut keluar.
// ============================================================================

import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { all, get, getSettings, run } from '../db.pg.ts';
import { catatAudit } from '../lib/audit.ts';
import {
  alasanPeriodeLogin,
  bacaBatasLogin,
  buatSesi,
  irisanCakupan as irisanCakupanAuth,
  cocokSandi,
  konteksDariToken,
  hashSandi,
  hashToken,
  kebijakanSandi,
  hapusSesi,
  hapusSesiPengguna,
  ipDariReq,
  konteksWajib,
  lepasKuki,
  msDariSql,
  pasangKuki,
  perangkatDariUA,
  validasiSandiBaru,
  waktuSql,
} from '../lib/auth.ts';
import { asyncHandler, tolak } from '../lib/http.ts';
import { resolveMenuAwal } from '../lib/menuAwal.ts';

const NETRAL = 'Jika akun terdaftar, instruksi reset telah dikirim ke email/WhatsApp terdaftar.';

/** Hash dummy untuk menyamarkan waktu cek akun yang tidak dikenal. */
let hashDummy: string | null = null;

interface BarisPengguna {
  id: number;
  nama: string;
  username: string;
  email: string | null;
  wa: string | null;
  password_hash: string;
  aktif: number;
  wajib_ganti: number;
  gagal: number;
  kunci_sampai: string | null;
  role_nama: string;
}

const SELECT_PENGGUNA = `SELECT u.id, u.nama, u.username, u.email, u.wa, u.password_hash,
        u.aktif, u.wajib_ganti, u.gagal, u.kunci_sampai, r.nama AS role_nama
   FROM users u JOIN roles r ON r.id = u.role_id`;

async function angkaSetting(kunci: string, bawaan: number): Promise<number> {
  const v = Number(await ((await getSettings()))[kunci]);
  return Number.isFinite(v) && v > 0 ? v : bawaan;
}

/** Payload sesi — dipakai /masuk dan /sesi sehingga bentuknya sama.
 *  Identitas memakai peran ASLI pemilik sesi (k.asli): header `x-peran`
 *  (simulasi peran / hak uji) tidak mengubah "siapa yang masuk" — saat
 *  ganti akun di peramban yang sama, nilai lokal klien tidak boleh
 *  mewarisi peran pengguna sebelumnya (salah halaman awal + salah x-peran). */
export async  function payloadSesi(k: import('../lib/auth.ts').Konteks): Promise<Record<string, unknown>> {
  return {
    masuk: true,
    pengguna: {
      id: k.userId,
      nama: k.nama,
      username: k.username,
      peran: k.asli.peranKunci,
      peranNama: k.asli.roleNama,
      admin: k.asli.admin,
      adminUtama: k.adminUtama,
      wajibGanti: k.wajibGanti,
      email: k.email,
      wa: k.wa,
    },
    hak: k.asli.hak,
    khusus: k.asli.khusus,
    cakupanToko: k.asli.cakupanToko,
    // WI2 — gudang default + akses + kunci untuk form transaksi (POS,
    // Pembelian, Stok): dropdown terisi default dan terkunci bila diminta.
    gudang: k.asli.gudang,
    sesiMenit: await angkaSetting('sesi_menit', 480),
    // AY — menu awal peran, diselesaikan di server terhadap sel Lihat
    // (fallback = halaman pertama yang boleh dilihat; null = tanpa akses).
    menuAwal: await resolveMenuAwal(k.asli.roleId, k.asli.admin),
    // Id sesi ini — dipakai panel Keamanan menandai "Sesi ini" agar tidak
    // salah mengeluarkan diri sendiri.
    sesiId: k.sesiId,
  };
}

async function cariPengguna(kunci: string): Promise<BarisPengguna | undefined> {
  const k = kunci.trim().toLowerCase();
  return await get<BarisPengguna>(
    `${SELECT_PENGGUNA}
      WHERE lower(trim(u.username)) = ? OR lower(trim(COALESCE(u.email, ''))) = ?
      LIMIT 1`,
    k,
    k,
  );
}

/* ---------------------------- lupa password ----------------------------- */

/** Batas 3x per jam PER identitas yang diketik (akun ada atau tidak). */
const riwayatLupa = new Map<string, number[]>();

function bolehMintaLupa(identitas: string): boolean {
  const kini = Date.now();
  const daftar = (riwayatLupa.get(identitas) ?? []).filter((t) => kini - t < 3_600_000);
  if (daftar.length >= 3) {
    riwayatLupa.set(identitas, daftar);
    return false;
  }
  daftar.push(kini);
  riwayatLupa.set(identitas, daftar);
  return true;
}

async function kanalTersedia(): Promise<{ email: boolean; wa: boolean }> {
  const s = await getSettings();
  return {
    email: s.smtp_aktif === 'true' && Boolean(s.smtp_host) && Boolean(s.smtp_pengguna),
    wa: s.wa_aktif === 'true' && Boolean(s.wa_nomor_pengirim),
  };
}

function maskEmail(e: string): string {
  const [user, domain] = e.split('@');
  if (!domain) return e;
  return `${user.slice(0, 1)}***@${domain}`;
}

function maskWa(w: string): string {
  const bersih = w.replace(/\D/g, '');
  if (bersih.length < 7) return w;
  return `${bersih.slice(0, 4)}****${bersih.slice(-3)}`;
}

function asalAplikasi(req: Request): string {
  const env = process.env.APP_ORIGIN;
  if (env) return env.replace(/\/$/, '');
  const origin = req.headers.origin;
  if (origin) return origin;
  const ref = req.headers.referer;
  if (ref) {
    try {
      return new URL(ref).origin;
    } catch {
      /* jatuh ke bawah */
    }
  }
  return `http://127.0.0.1:${process.env.API_PORT ?? 3001}`;
}

/**
 * Buat token reset (30 menit, sekali pakai) dan catat pesan keluar.
 * Tautan asli TIDAK disimpan — hanya hash SHA-256-nya; tautan utuh ada di
 * kotak keluar (Pengaturan ▸ Notifikasi) agar Admin meneruskannya pada
 * instalasi yang belum menyambungkan email/WhatsApp.
 */
async function kirimTautanReset(req: Request, user: BarisPengguna): Promise<void> {
  const kanal = await kanalTersedia();
  const pilih =
    kanal.email && user.email
      ? { kanal: 'email' as const, tujuan: user.email }
      : kanal.wa && user.wa
        ? { kanal: 'wa' as const, tujuan: user.wa }
        : null;
  if (!pilih) return; // kanal tidak tersedia / kontak belum diisi — tetap netral

  await run('DELETE FROM password_resets WHERE kedaluwarsa < ?', waktuSql());
  const token = crypto.randomBytes(24).toString('base64url');
  const tampil = pilih.kanal === 'email' ? maskEmail(pilih.tujuan) : maskWa(pilih.tujuan);
  await run(
    `INSERT INTO password_resets (user_id, token_hash, kanal, tujuan, kedaluwarsa)
     VALUES (?, ?, ?, ?, ?)`,
    user.id,
    hashToken(token),
    pilih.kanal,
    tampil,
    waktuSql(new Date(Date.now() + 30 * 60_000)),
  );
  const tautan = `${asalAplikasi(req)}/reset-sandi?token=${encodeURIComponent(token)}`;
  const isi =
    `Halo ${user.nama},\n\n` +
    `Permintaan setel ulang password NusaSuite (username: ${user.username}).\n` +
    `Buka tautan ini untuk membuat password baru: ${tautan}\n` +
    `Tautan berlaku 30 menit dan hanya bisa dipakai sekali.\n` +
    `Bila Anda tidak meminta ini, abaikan pesan ini.`;
  await run(
    `INSERT INTO pesan_keluar (jenis, tujuan, isi, status) VALUES ('reset_sandi', ?, ?, 'antre')`,
    tampil,
    isi,
  );
}

/** Pasang password baru, tutup semua sesi lama, catat audit. */
async function terapkanPasswordBaru(user: BarisPengguna, sandi: string, alasan: string): Promise<number> {
  const salah = await validasiSandiBaru(sandi);
  if (salah) throw tolak(400, salah);
  await run(
    'UPDATE users SET password_hash = ?, wajib_ganti = FALSE, sandi_diubah_pada = ?, gagal = 0, kunci_sampai = NULL WHERE id = ?',
    hashSandi(sandi),
    waktuSql(),
    user.id,
  );
  const sesiDitutup = await hapusSesiPengguna(user.id);
  await catatAudit({ userId: user.id, aksi: 'ubah', tabel: 'users', recordId: user.id, alasan });
  return sesiDitutup;
}

/* ------------------------------- router --------------------------------- */

export function routerAuth(): Router {
  const r = Router();

  /* ------------------------------ LOG IN -------------------------------- */

  r.post(
    '/masuk',
    asyncHandler(async (req, res) => {
      const b = (req.body ?? {}) as { username?: unknown; sandi?: unknown; ingat?: unknown; toko?: unknown };
      const identitas = String(b.username ?? '').trim();
      const sandi = String(b.sandi ?? '');
      if (!identitas || !sandi) throw tolak(400, 'Username/email dan password wajib diisi.');

      const maks = await angkaSetting('masuk_coba_maks', 5);
      const kunciMenit = await angkaSetting('masuk_terkunci_menit', 15);
      const u = await cariPengguna(identitas);

      if (!u) {
        hashDummy ??= hashSandi(crypto.randomUUID());
        cocokSandi(sandi, hashDummy);
        await catatAudit({
          userId: null,
          aksi: 'login',
          tabel: 'users',
          recordId: null,
          alasan: `gagal 1x — akun tidak dikenal (${identitas.slice(0, 60)})`,
        });
        throw tolak(401, 'Username/email atau password salah.');
      }

      const kini = Date.now();
      if (u.kunci_sampai && msDariSql(u.kunci_sampai) > kini) {
        const sisa = Math.max(1, Math.ceil((msDariSql(u.kunci_sampai) - kini) / 60_000));
        throw tolak(403, `Akun terkunci setelah ${maks} kali percobaan salah. Coba lagi dalam ${sisa} menit.`);
      }
      if (u.kunci_sampai) {
        // Masa kunci sudah lewat → hitung percobaan dimulai lagi.
        await run('UPDATE users SET kunci_sampai = NULL, gagal = 0 WHERE id = ?', u.id);
        u.gagal = 0;
      }
      if (!u.aktif) throw tolak(403, 'Akun ini dinonaktifkan. Hubungi Admin untuk mengaktifkannya.');

      if (!cocokSandi(sandi, u.password_hash)) {
        const gagal = (Number(u.gagal) || 0) + 1;
        const terkunci = gagal >= maks;
        await run(
          'UPDATE users SET gagal = ?, kunci_sampai = ? WHERE id = ?',
          terkunci ? 0 : gagal,
          terkunci ? waktuSql(new Date(Date.now() + kunciMenit * 60_000)) : null,
          u.id,
        );
        await catatAudit({
          userId: u.id,
          aksi: 'login',
          tabel: 'users',
          recordId: u.id,
          alasan: terkunci ? `gagal ${gagal}x — akun terkunci ${kunciMenit} menit` : `gagal ${gagal}x`,
        });
        if (terkunci) {
          throw tolak(403, `Akun terkunci ${kunciMenit} menit karena ${maks} kali percobaan salah. Coba lagi nanti.`);
        }
        throw tolak(401, 'Username/email atau password salah.');
      }

      // AR7 — periode login & batas perangkat dicek SETELAH password benar
      // (agar tidak membocorkan keberadaan akun lewat waktu).
      try {
        const batas = await get<{ periode_aktif: number; jam_dari: string | null; jam_sampai: string | null; hari_aktif: string | null }>('SELECT periode_aktif, jam_dari, jam_sampai, hari_aktif FROM users WHERE id = ?', u.id);
        if (batas) {
          const tolakPeriode = alasanPeriodeLogin(batas);
          if (tolakPeriode) {
            await catatAudit({ userId: u.id, aksi: 'login', tabel: 'users', recordId: u.id, alasan: `ditolak — di luar periode (${tolakPeriode})` });
            throw tolak(403, tolakPeriode);
          }
        }
      } catch (e) {
        if (e instanceof Error && 'status' in e) throw e;
      }
      try {
        const maksPerangkat = (await ((await get<{ maks_perangkat: number }>('SELECT maks_perangkat FROM users WHERE id = ?', u.id)))?.maks_perangkat ?? 0) as number;
        if (maksPerangkat > 0) {
          const aktif = (await ((await get<{ n: number }>('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', u.id)))?.n ?? 0) as number;
          if (aktif >= maksPerangkat) {
            await catatAudit({ userId: u.id, aksi: 'login', tabel: 'users', recordId: u.id, alasan: `ditolak — melebihi batas ${maksPerangkat} perangkat aktif` });
            throw tolak(403, `Batas ${maksPerangkat} perangkat aktif tercapai. Minta Owner mengeluarkan salah satu sesi.`);
          }
        }
      } catch (e) {
        if (e instanceof Error && 'status' in e) throw e;
      }
      // AR7 — toko yang diminta saat login harus di dalam cakupan pengguna/peran.
      const tokoMinta = String(b.toko ?? '').trim() || null;
      if (tokoMinta) {
        // Kolom cakupan (migrasi 029) wajib ada; bila skema belum bermigrasi,
        // JANGAN 500 — anggap tanpa pembatasan seperti sebelum fitur ada.
        let cu: string | null = null;
        let cr: string | null = null;
        try {
          cu = await ((await get<{ cakupan_toko: string | null }>('SELECT cakupan_toko FROM users WHERE id = ?', u.id)))?.cakupan_toko ?? null;
          cr = await ((await get<{ cakupan_toko: string | null }>('SELECT cakupan_toko FROM roles WHERE id = (SELECT role_id FROM users WHERE id = ?)', u.id)))?.cakupan_toko ?? null;
        } catch {
          console.warn('[LOGIN] kolom cakupan_toko belum ada — lewati cek toko.');
        }
        const efektif = await irisanCakupanAuth(cu, cr);
        if (efektif !== null && !efektif.includes(tokoMinta)) {
          await catatAudit({ userId: u.id, aksi: 'login', tabel: 'users', recordId: u.id, alasan: `ditolak — toko ${tokoMinta} di luar hak akses` });
          throw tolak(403, 'Toko/gudang di luar hak akses Anda.');
        }
      }
      await run('UPDATE users SET gagal = 0, kunci_sampai = NULL, login_terakhir = ? WHERE id = ?', waktuSql(), u.id);
      const ingat = b.ingat === true || b.ingat === 'true' || b.ingat === 1;
      const sesi = await buatSesi(u.id, {
        ingat,
        perangkat: perangkatDariUA(String(req.headers['user-agent'] ?? '')),
        ip: ipDariReq(req),
      });
      pasangKuki(res, sesi.token, ingat);
      if (tokoMinta) {
        try {
          await run('UPDATE sessions SET toko_kode = ? WHERE id = ?', tokoMinta, sesi.id);
        } catch {
          /* migrasi 028 belum jalan — abaikan */
        }
        try {
          await run('UPDATE users SET toko_terakhir = ? WHERE id = ?', tokoMinta, u.id);
        } catch {
          /* abaikan */
        }
      }
      await catatAudit({ userId: u.id, aksi: 'login', tabel: 'users', recordId: u.id, alasan: tokoMinta ? `berhasil (toko ${tokoMinta})` : 'berhasil' });

      let konteks = await konteksDariToken(req, res, sesi.token);
      if (!konteks) {
        // Sesi baru saja dibuat tetapi konteksnya tidak dapat dirakit
        // (balapan penghapusan akun/peran atau pembatasan jam yang berubah
        // di tengah permintaan) — JANGAN 500: jelaskan yang bisa ditindak.
        const batas = await bacaBatasLogin(u.id);
        const tolakPeriode = batas ? alasanPeriodeLogin(batas) : null;
        await hapusSesi(sesi.token);
        if (tolakPeriode) {
          await catatAudit({ userId: u.id, aksi: 'login', tabel: 'users', recordId: u.id, alasan: 'ditolak — di luar periode (' + tolakPeriode + ')' });
          throw tolak(403, tolakPeriode);
        }
        console.warn('[LOGIN] sesi tanpa konteks untuk user ' + u.id + ' — data akun berubah saat masuk.');
        throw tolak(401, 'Sesi tidak dapat disiapkan karena data akun berubah. Coba masuk lagi; bila berlanjut, minta Admin memeriksa akun & peran Anda.');
      }
      res.json({ pesan: 'Berhasil masuk.', wajibGanti: u.wajib_ganti === 1, sesi: await payloadSesi(konteks) });
    }),
  );

  /* ------------------------------ KELUAR -------------------------------- */

  r.post(
    '/keluar',
    asyncHandler(async (req, res) => {
      const k = konteksWajib(req);
      await hapusSesi(k.token);
      lepasKuki(res);
      await catatAudit({ userId: k.userId, aksi: 'logout', tabel: 'users', recordId: k.userId, alasan: 'keluar' });
      res.json({ pesan: 'Anda telah keluar.' });
    }),
  );

  /* ------------------------------- SESI --------------------------------- */

  r.get(
    '/sesi',
    asyncHandler(async (req, res) => {
      res.json(await payloadSesi(konteksWajib(req)));
    }),
  );

  /* ------------- AR7/AS — Pilih Gudang setelah login ---------------------- */

  r.get(
    '/toko-pilihan',
    asyncHandler(async (req, res) => {
      const k = konteksWajib(req);
      // AS: unit = gudang Master Data (warehouses), bukan toko.
      let semua: { kode: string; nama: string }[] = [];
      try {
        semua = (await all<{ kode: string; nama: string }>('SELECT kode, nama FROM warehouses WHERE aktif = TRUE ORDER BY nama'));
      } catch {
        semua = (await all<{ kode: string; nama: string }>('SELECT kode, nama FROM warehouses ORDER BY nama'));
      }
      const boleh = k.cakupanToko === null ? semua : semua.filter((t) => k.cakupanToko?.includes(t.kode));
      let terakhir: string | null = null;
      try {
        terakhir = await ((await get<{ toko_terakhir: string | null }>('SELECT toko_terakhir FROM users WHERE id = ?', k.userId)))?.toko_terakhir ?? null;
      } catch {
        terakhir = null;
      }
      let mode = 'terbatas';
      try {
        mode = await ((await get<{ mode_toko: string | null }>('SELECT mode_toko FROM users WHERE id = ?', k.userId)))?.mode_toko ?? 'terbatas';
      } catch {
        mode = 'terbatas';
      }
      res.json({
        toko: boleh,
        perlu_pilih: mode === 'pilih' && boleh.length > 1,
        terakhir: terakhir && boleh.some((t) => t.kode === terakhir) ? terakhir : (boleh[0]?.kode ?? null),
      });
    }),
  );

  r.post(
    '/toko-pilihan',
    asyncHandler(async (req, res) => {
      const k = konteksWajib(req);
      const kode = String((req.body as { toko?: unknown })?.toko ?? '').trim();
      if (!kode) throw tolak(400, 'Pilih toko/gudang.');
      if (k.cakupanToko !== null && !k.cakupanToko.includes(kode)) {
        throw tolak(403, 'Toko/gudang di luar hak akses Anda.');
      }
      let ada: { kode: string } | undefined;
      try {
        ada = (await get<{ kode: string }>('SELECT kode FROM warehouses WHERE kode = ? AND aktif = TRUE', kode));
      } catch {
        ada = (await get<{ kode: string }>('SELECT kode FROM warehouses WHERE kode = ?', kode));
      }
      if (!ada) throw tolak(404, 'Gudang tidak ditemukan di Master Data.');
      try {
        await run('UPDATE sessions SET toko_kode = ? WHERE id = ?', kode, k.sesiId);
      } catch {
        /* kolom belum ada (migrasi 028) — pilihan tetap disimpan di pengguna */
      }
      try {
        await run('UPDATE users SET toko_terakhir = ? WHERE id = ?', kode, k.userId);
      } catch {
        /* abaikan */
      }
      await catatAudit({ userId: k.userId, aksi: 'ubah', tabel: 'sessions', recordId: k.sesiId, alasan: `Pilih toko/gudang: ${kode}` });
      res.json({ pesan: `Toko/gudang aktif: ${kode}.`, toko: kode });
    }),
  );

  /* --------------------------- GANTI SANDI ------------------------------ */

  r.post(
    '/ganti-sandi',
    asyncHandler(async (req, res) => {
      const k = konteksWajib(req);
      const b = (req.body ?? {}) as { lama?: unknown; baru?: unknown; konfirmasi?: unknown };
      const lama = String(b.lama ?? '');
      const baru = String(b.baru ?? '');
      const konfirmasi = String(b.konfirmasi ?? '');

      const u = await get<BarisPengguna>(`${SELECT_PENGGUNA} WHERE u.id = ?`, k.userId);
      if (!u) throw tolak(401, 'Sesi berakhir. Silakan masuk kembali.');
      if (!cocokSandi(lama, u.password_hash)) throw tolak(400, 'Password lama salah.');
      if (baru !== konfirmasi) throw tolak(400, 'Konfirmasi password baru tidak sama.');
      if (baru === lama) throw tolak(400, 'Password baru harus berbeda dari password lama.');
      const salah = await validasiSandiBaru(baru);
      if (salah) throw tolak(400, salah);

      await run(
        'UPDATE users SET password_hash = ?, wajib_ganti = FALSE, sandi_diubah_pada = ?, gagal = 0, kunci_sampai = NULL WHERE id = ?',
        hashSandi(baru),
        waktuSql(),
        u.id,
      );
      const sesiLain = await hapusSesiPengguna(u.id, k.token);
      await catatAudit({ userId: u.id, aksi: 'ubah', tabel: 'users', recordId: u.id, alasan: 'Ganti password sendiri' });
      res.json({
        pesan:
          sesiLain > 0
            ? `Password diperbarui. ${sesiLain} sesi lama di perangkat lain ikut dikeluarkan.`
            : 'Password diperbarui.',
      });
    }),
  );

  /* --------------------------- LUPA PASSWORD ---------------------------- */

  r.get(
    '/lupa/kanal',
    asyncHandler(async (_req, res) => {
      const k = await kanalTersedia();
      res.json({ tersedia: k.email || k.wa, kanal: k.email ? 'email' : k.wa ? 'wa' : null });
    }),
  );

  const mintaReset = asyncHandler(async (req: Request, res: Response) => {
    const b = (req.body ?? {}) as { identitas?: unknown };
    const identitas = String(b.identitas ?? '').trim().toLowerCase();
    if (!identitas) throw tolak(400, 'Isi username atau email Anda.');
    if (!bolehMintaLupa(identitas)) {
      throw tolak(429, 'Terlalu banyak permintaan reset. Maksimal 3x per jam — coba lagi nanti.');
    }
    const u = await cariPengguna(identitas);
    if (u && u.aktif) await kirimTautanReset(req, u);
    // Balasan selalu netral — tidak menyebut apakah akun ada.
    res.json({ pesan: NETRAL });
  });

  r.post('/lupa', mintaReset);
  r.post('/kirim-ulang', mintaReset);

  r.post(
    '/reset',
    asyncHandler(async (req, res) => {
      const b = (req.body ?? {}) as { token?: unknown; baru?: unknown; konfirmasi?: unknown };
      const token = String(b.token ?? '');
      const baru = String(b.baru ?? '');
      const konfirmasi = String(b.konfirmasi ?? '');
      if (!token) throw tolak(400, 'Tautan reset tidak ditemukan. Minta tautan baru lewat "Lupa password?".');

      const row = await get<{ id: number; user_id: number; kedaluwarsa: string; dipakai_pada: string | null }>(
        'SELECT id, user_id, kedaluwarsa, dipakai_pada FROM password_resets WHERE token_hash = ?',
        hashToken(token),
      );
      if (!row || row.dipakai_pada) {
        throw tolak(400, 'Tautan sudah pernah dipakai atau tidak dikenal. Minta tautan baru lewat "Lupa password?".');
      }
      if (msDariSql(row.kedaluwarsa) < Date.now()) {
        throw tolak(400, 'Tautan kedaluwarsa (berlaku 30 menit). Minta tautan baru lewat "Lupa password?".');
      }
      if (baru !== konfirmasi) throw tolak(400, 'Konfirmasi password baru tidak sama.');

      const u = await get<BarisPengguna>(`${SELECT_PENGGUNA} WHERE u.id = ?`, row.user_id);
      if (!u) throw tolak(400, 'Akun pada tautan ini sudah tidak ada. Minta tautan baru.');

      await run('UPDATE password_resets SET dipakai_pada = ? WHERE id = ?', waktuSql(), row.id);
      const sesiDitutup = await terapkanPasswordBaru(u, baru, 'Setel ulang password lewat tautan lupa password');
      res.json({
        pesan: 'Password baru tersimpan. Silakan masuk dengan password baru.',
        sesiDitutup,
        username: u.username,
      });
    }),
  );

  /* ------------------------- KODE PEMULIHAN ----------------------------- */

  r.post(
    '/pulihkan',
    asyncHandler(async (req, res) => {
      const b = (req.body ?? {}) as { identitas?: unknown; kode?: unknown; baru?: unknown; konfirmasi?: unknown };
      const identitas = String(b.identitas ?? '').trim().toLowerCase();
      const kode = String(b.kode ?? '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '');
      const baru = String(b.baru ?? '');
      const konfirmasi = String(b.konfirmasi ?? '');
      if (!identitas || !kode) throw tolak(400, 'Isi username dan Kode Pemulihan.');
      if (!bolehMintaLupa(`pulihkan:${identitas}`)) {
        throw tolak(429, 'Terlalu banyak percobaan. Maksimal 3x per jam — coba lagi nanti.');
      }

      // Kode Pemulihan hanya untuk akun Admin utama (username: admin).
      const u = await cariPengguna(identitas);
      const pesanGagal = 'Kode Pemulihan tidak valid atau sudah dipakai.';
      if (!u || u.username.toLowerCase() !== 'admin') throw tolak(400, pesanGagal);

      const kodeRow = await get<{ id: number }>(
        'SELECT id FROM recovery_codes WHERE user_id = ? AND kode_hash = ? AND dipakai_pada IS NULL',
        u.id,
        hashToken(kode),
      );
      if (!kodeRow) throw tolak(400, pesanGagal);
      if (baru !== konfirmasi) throw tolak(400, 'Konfirmasi password baru tidak sama.');

      await run('UPDATE recovery_codes SET dipakai_pada = ? WHERE id = ?', waktuSql(), kodeRow.id);
      const sesiDitutup = await terapkanPasswordBaru(u, baru, 'Setel ulang password memakai Kode Pemulihan');
      res.json({
        pesan: 'Password baru tersimpan. Silakan masuk dengan password baru.',
        sesiDitutup,
        username: u.username,
      });
    }),
  );

  /* ---------------- info singkat untuk halaman Log In ------------------- */

  r.get(
    '/info',
    asyncHandler(async (_req, res) => {
      const s = await getSettings();
      const k = await kanalTersedia();
      res.json({
        aplikasi: s['app_nama'] || 'NusaSuite',
        tagline: s['app_tagline'] ?? 'POS · WMS · Akuntansi',
        lupaTersedia: k.email || k.wa,
        kebijakan: await kebijakanSandi(),
        kodePemulihan:
          await ((await all<{ n: number }>('SELECT COUNT(*) AS n FROM recovery_codes WHERE dipakai_pada IS NULL')))[0]?.n ?? 0,
      });
    }),
  );

  return r;
}

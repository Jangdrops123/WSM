import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { getSettings, all, pool, ROOT_DIR } from './db.pg.ts';
import { jalankanMigrasi } from './migrate.ts';
import { routerMaster } from './routes/master/index.ts';
import { routerStock } from './routes/stock.ts';
import { routerPos } from './routes/pos.ts';
import { routerPembelian } from './routes/pembelian.ts';
import { routerPo } from './routes/po.ts';
import { routerFaktur } from './routes/faktur.ts';
import { routerStruk } from './routes/struk.ts';
import { routerOpname } from './routes/opname.ts';
import { routerPersediaan } from './routes/persediaan.ts';
import { routerProsesTahunan } from './routes/prosesTahunan.ts';
import { routerLaporan } from './routes/laporan.ts';
import { routerAkuntansi } from './routes/akuntansi.ts';
import { routerDashboard } from './routes/dashboard.ts';
import { routerTampilan } from './routes/tampilan.ts';
import { routerProfilSize } from './routes/profilSize.ts';
import { routerChatAturan } from './routes/chatAturan.ts';
import { routerPemeliharaanDb, routerPengaturan } from './routes/pengaturan.ts';
import { routerSuaraScan } from './routes/suaraScan.ts';
import { routerBackup } from './routes/backup.ts';
import { mulaiBackupTerjadwal, sedangMaintenance } from './lib/sistem.ts';
import { pesanKesalahan } from './lib/http.ts';
import { pastikanAdminAwal, wajibLogin } from './lib/auth.ts';
import { laporanKapabilitasAX, wajibModul } from './lib/hak.ts';
import { routerAuth } from './routes/auth.ts';
import { routerPengguna } from './routes/pengguna.ts';
import { routerKeamanan } from './routes/keamanan.ts';
import { alihRuteLama } from './alihPos.ts';

// API_PORT punya prioritas; PORT=0 (port acak dari lingkungan) tidak dianggap valid.
const envPort = Number(process.env.API_PORT ?? process.env.PORT ?? 3001);
const PORT = Number.isInteger(envPort) && envPort > 0 ? envPort : 3001;

// Pastikan skema seluruhnya diterapkan saat server naik.
// SQLite: migrasi file-per-file. PostgreSQL: skema dikelola via
// pg-migrations/*.sql (psql) — JANGAN jalankan runner SQLite di sini.
const MENGGUNAKAN_PG = Boolean(process.env.DATABASE_URL);
const diterapkan: string[] = MENGGUNAKAN_PG ? [] : jalankanMigrasi();
if (diterapkan.length > 0) console.log(`Migrasi diterapkan: ${diterapkan.join(', ')}`);
// AX6 — tampilkan SATU KALI kemampuan tiap peran dari matriks (tanpa
// auto-grant) agar Owner meninjau ulang.
if (diterapkan.some((f) => f.startsWith('035_'))) {
  try {
    console.log('[AX6] Matriks-peran saja — tidak ada izin otomatis:');
    for (const baris of await laporanKapabilitasAX()) console.log(`[AX6] ${baris}`);
  } catch {
    /* abaikan bila DB belum siap */
  }
}
// Tahap 1 — akun Admin awal dibuat otomatis pada jalannya pertama (bcrypt +
// tanda "wajib ganti password saat login pertama").
await pastikanAdminAwal();

const app = express();

// AN6 — izinkan pemakaian kamera dari halaman aplikasi sendiri (produksi
// wajib HTTPS agar getUserMedia tersedia).
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(self)');
  next();
});
// 25mb — BAGIAN L: impor opname massal mengirim file (base64) berikut baris
// pratinjau; puluhan ribu baris melewati batas 5mb lama.
app.use(express.json({ limit: '25mb' }));

// --- API -------------------------------------------------------------------
// --- API -------------------------------------------------------------------
// /api/meta bersifat publik (halaman Log In memakainya) — kunci rahasia
// (kata sandi SMTP, token, kunci API) tidak pernah ikut dikirim.
const RAHASIA = /(sandi|password|secret|token|api[_-]?key)/i;
function tanpaRahasia(s: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(s).filter(([k]) => !RAHASIA.test(k)));
}

const api = express.Router();

api.get('/health', async (_req, res) => {
  const users = (await all<{ n: number }>('SELECT COUNT(*) AS n FROM users'))[0]?.n ?? 0;
  const roles = (await all<{ n: number }>('SELECT COUNT(*) AS n FROM roles'))[0]?.n ?? 0;
  res.json({
    ok: true,
    database: MENGGUNAKAN_PG ? 'postgresql' : 'sqlite',
    foreign_keys: true, // SQLite: PRAGMA; PostgreSQL: selalu ditegakkan
    migrasi: diterapkan.length,
    roles,
    users,
    waktu: new Date().toISOString(),
  });
});

// Meta aplikasi: identitas, pengaturan, dan daftar menu navigasi.
// Sumber kebenaran menu juga ada di src/config/menu.ts agar konsisten dengan sidebar.
// Y2.4 — nama/tagline diambil dari Identitas Aplikasi (tabel settings),
// bukan teks tetap di kode.
api.get('/meta', async (_req, res) => {
  const s = await getSettings();
  res.json({
    aplikasi: s['app_nama'] || 'NusaSuite',
    tagline: s['app_tagline'] ?? 'POS · WMS · Akuntansi',
    pengaturan: tanpaRahasia(s),
    menu: (await all('SELECT kunci, nilai FROM settings ORDER BY kunci')).filter((b) => !RAHASIA.test(String(b.kunci))),
  });
});

// --- Autentikasi & hak akses (TAHAP 1 & 2) ------------------------------
// Semua /api wajib sesi login kecuali endpoint publik (health, meta, auth
// masuk/lupa/reset); kemudian matriks modul + pembatasan cakupan toko.
app.use('/api', wajibLogin);
app.use('/api', wajibModul);
// Mode Maintenance (restore database): kunci SEMUA tulis/baca non-backup
// agar tidak ada transaksi gantung. Rute backup, auth, meta & health tetap
// terbuka agar admin bisa memantau & login.
app.use('/api', (req, res, next) => {
  if (!sedangMaintenance()) return next();
  const p = req.path.toLowerCase();
  const bebas =
    p.startsWith('/backup') || p.startsWith('/auth') || p.startsWith('/pengguna/masuk') ||
    p === '/meta' || p === '/health' || p.startsWith('/tampilan');
  if (bebas) return next();
  res.status(503).json({ ok: false, kode: 'maintenance', pesan: 'Server dalam mode maintenance — restore database sedang berjalan. Coba lagi sesaat lagi.' });
});

app.use('/api/auth', routerAuth());
app.use('/api/pengguna', routerPengguna());
app.use('/api/master', routerMaster());
app.use('/api/stock', routerStock());
// Modul Persediaan Sub — didaftarkan sebelum router POS untuk menghindari bentrok pola.
app.use('/api/persediaan', routerPersediaan());
app.use('/api/pembelian', routerPembelian());
// Modul Purchase Order (PO) — pesanan ke pemasok + penerimaan bertahap.
app.use('/api/po', routerPo());
app.use('/api/faktur', routerFaktur());
app.use('/api/struk', routerStruk());
app.use('/api/opname', routerOpname());
// Proses Tahunan (Admin only) — didaftarkan sebelum router Pos agar pola rutenya jelas.
app.use('/api/proses-tahunan', routerProsesTahunan());
// Modul Laporan (BAGIAN N) — agregasi baca-saja dari transaksi yang sudah ada.
app.use('/api/laporan', await routerLaporan());
// Modul Akuntansi (BAGIAN A–D) — COA, pemetaan akun, jurnal, buku besar,
// neraca saldo, kas/bank, piutang/hutang, laporan, dan kunci periode.
app.use('/api/akuntansi', routerAkuntansi());
// Modul Dashboard — tampilan kartu, ringkasan KPI/grafik, dan pengingat faktur.
app.use('/api/dashboard', routerDashboard());
// Pengaturan (tab baru per grup) — didaftarkan sebelum router /api umum.
app.use('/api/pengaturan', routerKeamanan());
app.use('/api/pengaturan', routerPengaturan());
// Alias sesuai spesifikasi: pemeliharaan database (VACUUM/REINDEX).
app.use('/api/settings', routerPemeliharaanDb());
// Suara scan global (audio kustom): GET semua peran, PUT khusus Admin.
app.use('/api/settings', routerSuaraScan());
// Backup & Restore Database (RESTful khusus) — inti lib sama dengan rute lama.
app.use('/api/backup', routerBackup());

// BAGIAN X5 — Profil Size untuk aturan kodi chatbot (hanya Admin).
app.use('/api/profil-size', routerProfilSize());
app.use('/api/chat-aturan', routerChatAturan());
// Preferensi tema tampilan (terang/gelap/sistem + aksen + sidebar).
app.use('/api', routerTampilan());
app.use('/api', routerPos());
app.use('/api', api);

// --- Foto produk (storage) --------------------------------------------------
// File hasil Unggah Foto Massal — disajikan setelah API, sebelum statis dist.
app.use('/uploads', express.static(path.join(ROOT_DIR, 'data', 'uploads')));

// --- M2/O2/R1 — Rute lama → rute baru (redirect 301) ----------------------
// Sebelum statis: /pos/*, /opname/*, /persediaan-sub/* dan /persediaan/opname/*
// harus menjawab 301, bukan index.html SPA — supaya bookmark tetap hidup.
const RUTE_LAMA = /^\/(pos|opname|persediaan-sub|persediaan)(\/.*)?$/;
app.get(RUTE_LAMA, (req, res, next) => {
  const tujuan = alihRuteLama(req.originalUrl);
  if (tujuan) {
    res.redirect(301, tujuan);
    return;
  }
  next();
});

// --- Aplikasi statis (produksi) -------------------------------------------
const distDir = path.join(ROOT_DIR, 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res
      .status(200)
      .type('text/plain')
      .send('API berjalan. Build frontend belum ada (jalankan `npm run build` untuk mode produksi, atau gunakan `npm run dev` untuk Vite dev server).');
  });
}

// --- Penanganan kesalahan --------------------------------------------------
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const { status, pesan, aman } = pesanKesalahan(err);
  if (status >= 500) {
    // Jangan bocorkan detail internal (SQL/stack) ke klien — catat di server,
    // kirim pesan generik. Pengecualian: galat yang sengaja ditandai
    // `amanTampil` (mis. "Gagal mengosongkan master data: ...") diteruskan apa
    // adanya supaya pengguna/admin tahu penyebabnya tanpa membuka log server.
    console.error('[API ERROR]', err instanceof Error ? (err.stack ?? err.message) : err);
    res.status(status).json({
      ok: false,
      pesan: aman
        ? pesan
        : 'Terjadi kesalahan pada server. Coba lagi; bila berlanjut, hubungi administrator.',
    });
    return;
  }
  // Kontrak galat tunggal: seluruh 403 di aplikasi ini adalah penolakan hak
  // akses matriks -> tandai kode 'akses' agar klien dapat membedakan dari
  // galat data/jaringan (toast de-dup + placeholder widget, bukan teks merah).
  if (status === 403) {
    res.status(status).json({ ok: false, pesan, kode: 'akses' });
    return;
  }
  res.status(status).json({ ok: false, pesan });
});

// AN6 — HOST=0.0.0.0 bila API harus dijangkau perangkat lain di LAN/Wi-Fi
// (mis. uji HP). Bawaan tetap loopback agar tidak terbuka tanpa disengaja.
// Penjadwal backup otomatis (cron ringan 60 detik + catch-up saat naik).
// Gagal jadwal tidak boleh menjatuhkan server.
try {
  mulaiBackupTerjadwal();
} catch (e) {
  console.warn('[backup] penjadwal gagal dimulai:', e instanceof Error ? e.message : e);
}

const HOST = process.env.HOST ?? '127.0.0.1';
app.listen(PORT, HOST, () => {
  console.log(`API berjalan di http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});

// Pastikan koneksi database ditutup saat proses berhenti.
for (const sinyal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinyal, () => {
    void (async () => {
      try {
        await pool.end();
      } finally {
        process.exit(0);
      }
    })();
  });
}

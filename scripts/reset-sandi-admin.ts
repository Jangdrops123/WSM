// ============================================================================
// Reset password akun Admin utama langsung lewat database.
//
// Dipakai bila KODE PEMULIHAN hilang (dan email/WhatsApp tidak tersambung) —
// jalur pemulihan terakhir yang TIDAK tampil di aplikasi publik, sesuai
// dokumentasi (README ▸ Keamanan & Pemulihan Akun).
//
//   npx tsx scripts/reset-sandi-admin.ts               # sandi acak — dicetak sekali
//   npx tsx scripts/reset-sandi-admin.ts "Baru1234"    # sandi pilihan sendiri
//
// DB_FILE=data/uji-reset.db API_PORT=3017 …             # untuk server uji terpisah
//
// Sesudah dijalankan:
//   * seluruh sesi lama akun ini dikeluarkan (perangkat lain ikut logout),
//   * akun ditandai "wajib ganti password" pada login berikutnya,
//   * percobaan gagal & masa terkunci di-reset.
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { hashSandi, sandiAcak } from '../server/lib/auth.ts';

const DB_FILE = process.env.DB_FILE ?? 'data/app.db';
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA busy_timeout = 5000;');

type Baris = { id: number; username: string };

const admin = db
  .prepare(`SELECT id, username FROM users WHERE lower(trim(username)) = 'admin' LIMIT 1`)
  .get() as Baris | undefined;
if (!admin) {
  console.error(`Akun "admin" tidak ditemukan di ${DB_FILE}.`);
  db.close();
  process.exit(1);
}

const sandiBaru = process.argv[2] ?? sandiAcak();
if (sandiBaru.length < 8 || !/[a-zA-Z]/.test(sandiBaru) || !/\d/.test(sandiBaru)) {
  console.error('Password baru minimal 8 karakter dan memuat huruf + angka (kebijakan aplikasi).');
  db.close();
  process.exit(1);
}

const hash = hashSandi(sandiBaru);
db.prepare(
  `UPDATE users
      SET password_hash = ?, wajib_ganti = 1, gagal = 0, kunci_sampai = NULL
    WHERE id = ?`,
).run(hash, admin.id);
const sesi = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(admin.id);
db.close();

console.log(`Password akun "${admin.username}" disetel ulang di ${DB_FILE}.`);
console.log(`Sandi baru: ${sandiBaru}`);
if (!process.argv[2]) console.log('  ↑ sandi acak — CATAT SEKARANG, hanya ditampilkan sekali ini.');
console.log(`Sesi lama dikeluarkan: ${Number(sesi.changes)} sesi.`);
console.log('Login berikutnya wajib ganti password (sesuai kebijakan akun awal).');

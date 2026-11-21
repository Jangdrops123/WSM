// ============================================================================
// Keamanan (Pengaturan ▸ Keamanan & Notifikasi) — Tahap 1 & 2
//
//   GET    /keamanan/sesi             daftar sesi/perangkat aktif
//   DELETE /keamanan/sesi/:id         keluarkan paksa satu sesi
//   GET    /keamanan/kode-pemulihan   status Kode Pemulihan Admin
//   POST   /keamanan/kode-pemulihan   buat 10 kode baru (tampil sekali)
//   GET    /notifikasi/keluar         kotak keluar pesan (tautan reset, dsb.)
//
// Router ini didaftarkan SEBELUM routerPengaturan pada prefix yang sama,
// sehingga ia menaungi endpoint lama `GET /keamanan/sesi` (yang sudah ada
// sebelum modul login ada) dengan payload yang lebih lengkap.
// ============================================================================

import { Router, type RequestHandler } from 'express';
import { all, get, run, withTransaction } from '../db.pg.ts';
import { catatAudit } from '../lib/audit.ts';
import { hashToken, kodePemulihanAcak, konteksWajib } from '../lib/auth.ts';
import { asyncHandler, tolak } from '../lib/http.ts';
import { izinTab } from './pengaturan.ts';

export function routerKeamanan(): Router {
  const r = Router();

  const bolehKeamanan: RequestHandler = async (req, res, next) => {
    const k = konteksWajib(req);
    if (k.admin || await izinTab(req, 'keamanan')) return next();
    res.status(403).json({ ok: false, pesan: 'Tab Keamanan hanya untuk Admin (atau peran yang diizinkan Admin).' });
  };

  /* ----------------------------- SESI AKTIF ----------------------------- */

  r.get(
    '/keamanan/sesi',
    bolehKeamanan,
    asyncHandler(async (_req, res) => {
      const data = await all<{ id: number; perangkat: string | null; ip: string | null; terakhir: string; nama: string; username: string }>(
        `SELECT s.id, s.perangkat, s.ip, s.terakhir_aktif AS terakhir, u.nama, u.username
           FROM sessions s JOIN users u ON u.id = s.user_id
          ORDER BY s.terakhir_aktif DESC LIMIT 100`,
      );
      res.json({ data });
    }),
  );

  r.delete(
    '/keamanan/sesi/:id',
    bolehKeamanan,
    asyncHandler(async (req, res) => {
      const k = konteksWajib(req);
      const id = Number(req.params.id);
      const s = await get<{ id: number; user_id: number; perangkat: string | null }>(
        'SELECT id, user_id, perangkat FROM sessions WHERE id = ?',
        id,
      );
      if (!s) throw tolak(404, 'Sesi tidak ditemukan.');
      await run('DELETE FROM sessions WHERE id = ?', id);
      await catatAudit({
        userId: k.userId,
        aksi: 'ubah',
        tabel: 'sessions',
        recordId: id,
        alasan: `Keluarkan sesi paksa (${s.perangkat ?? 'perangkat'})`,
      });
      res.json({ pesan: 'Sesi dikeluarkan dari perangkat tersebut.' });
    }),
  );

  /* ------------------------- KODE PEMULIHAN ADMIN ----------------------- */

  r.get(
    '/keamanan/kode-pemulihan',
    bolehKeamanan,
    asyncHandler(async (_req, res) => {
      const admin = await get<{ id: number }>("SELECT id FROM users WHERE lower(trim(username)) = 'admin' LIMIT 1");
      if (!admin) {
        res.json({ ada: false, dibuat: 0, sisa: 0, waktu: null });
        return;
      }
      const total = await ((await get<{ n: number }>('SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ?', admin.id)))?.n ?? 0;
      const sisa = await ((await get<{ n: number }>(
        'SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND dipakai_pada IS NULL',
        admin.id,
      )))?.n ?? 0;
      const terakhir =
        await ((await get<{ d: string | null }>(
          'SELECT MAX(dibuat_pada) AS d FROM recovery_codes WHERE user_id = ?',
          admin.id,
        )))?.d ?? null;
      res.json({ ada: total > 0, dibuat: total, sisa, waktu: terakhir });
    }),
  );

  r.post(
    '/keamanan/kode-pemulihan',
    bolehKeamanan,
    asyncHandler(async (req, res) => {
      const k = konteksWajib(req);
      if (!k.admin) throw tolak(403, 'Hanya Admin yang boleh membuat Kode Pemulihan.');
      const admin = await get<{ id: number; nama: string }>(
        "SELECT id, nama FROM users WHERE lower(trim(username)) = 'admin' LIMIT 1",
      );
      if (!admin) throw tolak(404, 'Akun Admin utama belum ada.');

      const kodeBaru = Array.from({ length: 10 }, () => kodePemulihanAcak());
      await withTransaction(async () => {
        // Kode lama tidak berlaku lagi begitu kode baru dibuat.
        await run('DELETE FROM recovery_codes WHERE user_id = ?', admin.id);
        for (const kode of kodeBaru) {
          await run('INSERT INTO recovery_codes (user_id, kode_hash) VALUES (?, ?)', admin.id, hashToken(kode));
        }
        await catatAudit({
          userId: k.userId,
          aksi: 'ubah',
          tabel: 'recovery_codes',
          recordId: admin.id,
          sesudah: { jumlah: kodeBaru.length },
          alasan: 'Buat 10 Kode Pemulihan baru (kode lama dibatalkan)',
        });
      });

      res.json({
        kode: kodeBaru,
        pesan:
          '10 Kode Pemulihan dibuat. Cetak atau unduh sekarang — KESEPLUHAN hanya tampil sekali ini ' +
          'dan tiap kode hanya bisa dipakai satu kali untuk menyetel ulang password Admin utama.',
      });
    }),
  );

  /* --------------------------- KOTAK KELUAR ----------------------------- */

  r.get(
    '/notifikasi/keluar',
    async (req, res, next) => {
      const k = konteksWajib(req);
      if (k.admin || await izinTab(req, 'notifikasi')) return next();
      res.status(403).json({ ok: false, pesan: 'Tab Notifikasi hanya untuk Admin.' });
    },
    asyncHandler(async (_req, res) => {
      res.json({
        data: await all<{ id: number; jenis: string; tujuan: string; status: string; dibuat_pada: string }>(
          'SELECT id, jenis, tujuan, status, dibuat_pada FROM pesan_keluar ORDER BY id DESC LIMIT 100',
        ),
        isi: await all<{ id: number; isi: string }>('SELECT id, isi FROM pesan_keluar ORDER BY id DESC LIMIT 100'),
      });
    }),
  );

  return r;
}

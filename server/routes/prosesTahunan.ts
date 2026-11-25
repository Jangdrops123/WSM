// Rute Proses Tahunan — hanya Admin. Wizard 4 langkah dijalankan klien:
//   1) GET  /ringkas    — jumlah data per modul + peringatan tertahan
//   2) GET  /backup     — unduh .xlsx cadangan lengkap periode terpilih
//   3) GET  /pratinjau  — tabel Saldo Akhir vs Saldo Awal + penyebab
//   4) POST /jalankan   — kata "HAPUS" + kata sandi, lalu eksekusi atomik
//   -) GET  /daftar, GET /:id/bukti — riwayat & Bukti Saldo Awal (Excel)
//   -) POST /pulihkan   — impor file backup bila Admin salah hapus

import express, { Router, type Request } from 'express';
import { penggunaSaatIni, wajibAdmin } from '../lib/akses.ts';
import { tulisExcelMulti } from '../lib/excel.ts';
import { asyncHandler, tolak } from '../lib/http.ts';
import {
  buktiProses,
  verifikasiSandiAktif,
  daftarProses,
  jalankanProses,
  pratinjauProses,
  pulihkanProses,
  ringkasProses,
  sheetsBackup,
  type Lingkup,
} from '../lib/prosesTahunan.ts';

function bacaLingkup(req: Request): Lingkup {
  const sampai = String(req.query.sampai ?? req.body?.sampai ?? '').trim();
  const rawGudang = req.query.gudang_id ?? req.body?.gudang_id;
  const gudangId =
    rawGudang === undefined || rawGudang === null || rawGudang === '' || rawGudang === 'semua'
      ? null
      : Number(rawGudang);
  if (gudangId !== null && !Number.isFinite(gudangId)) throw tolak(400, 'Pilihan toko/gudang tidak valid.');
  return { gudangId, sampai };
}

async function kirimExcel(
  res: { type: (t: string) => unknown; set: (k: string, v: string) => unknown; send: (b: Buffer) => unknown },
  namaBerkas: string,
  sheets: Parameters<typeof tulisExcelMulti>[0],
): Promise<void> {
  const buf = await tulisExcelMulti(sheets);
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="${namaBerkas}"`);
  res.send(buf);
}

export function routerProsesTahunan(): Router {
  const r = Router();

  // Hanya Admin/Owner yang boleh menyentuh Proses Tahunan.
  r.use(wajibAdmin);

  // Langkah 1 — ringkasan jumlah data + peringatan transaksi tertahan.
  r.get(
    '/ringkas',
    asyncHandler(async (req, res) => {
      res.json(await ringkasProses(bacaLingkup(req)));
    }),
  );

  // Langkah 3 — pratinjau konversi saldo awal (dua sisi + penyebab blokir).
  r.get(
    '/pratinjau',
    asyncHandler(async (req, res) => {
      res.json(await pratinjauProses(bacaLingkup(req)));
    }),
  );

  // Langkah 2 — unduh backup lengkap (.xlsx multi-sheet, semua modul periode ini).
  r.get(
    '/backup',
    asyncHandler(async (req, res) => {
      const l = bacaLingkup(req);
      await kirimExcel(res, `backup-proses-tahunan-${l.sampai}.xlsx`, await sheetsBackup(l));
    }),
  );

  // Langkah 4 — eksekusi: kata "HAPUS" + kata sandi, transaksi atomik.
  r.post(
    '/jalankan',
    asyncHandler(async (req, res) => {
      const l = bacaLingkup(req);
      const kata = String(req.body?.kata ?? '');
      const sandi = String(req.body?.sandi ?? '');
      if (kata !== 'HAPUS') {
        throw tolak(400, 'Konfirmasi harus mengetik kata HAPUS dengan huruf kapital.');
      }
      const pengguna = penggunaSaatIni(req);
      if (pengguna.id === null) throw tolak(401, 'Sesi tidak valid. Masuk ulang lalu coba lagi.');
      if (!await verifikasiSandiAktif(pengguna.id, sandi)) {
        throw tolak(401, 'Kata sandi Anda tidak cocok. Proses dibatalkan — gunakan kata sandi akun yang sedang login.');
      }
      res.json(await jalankanProses(l, pengguna.id));
    }),
  );

  // Riwayat proses (Log Aktivitas modul ini).
  r.get(
    '/daftar',
    asyncHandler(async (_req, res) => {
      res.json({ data: await daftarProses() });
    }),
  );

  // Bukti Saldo Awal — ekspor Excel (PDF dicetak dari halaman hasil).
  r.get(
    '/:id/bukti',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) throw tolak(400, 'Id proses tidak valid.');
      const pr = (await daftarProses()).find((p) => Number(p.id) === id) as { no_proses?: string } | undefined;
      const nama = pr?.no_proses ?? `proses-${id}`;
      await kirimExcel(res, `bukti-saldo-awal-${nama}.xlsx`, await buktiProses(id));
    }),
  );

  // Pulihkan dari Backup: file .xlsx asli (bukan JSON) + no_proses di header.
  // express.json global hanya memproses content-type JSON — body biner diteruskan
  // ke parser raw di sini (64 MB cukup untuk cadangan satu tahun).
  r.post(
    '/pulihkan',
    express.raw({ type: () => true, limit: '64mb' }),
    asyncHandler(async (req, res) => {
      const noProses = String(req.header('x-no-proses') ?? '').trim();
      if (!noProses) throw tolak(400, 'Nomor proses tidak dikirim (header x-no-proses).');
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        throw tolak(400, 'File backup tidak diterima.');
      }
      const pengguna = penggunaSaatIni(req);
      res.json(await pulihkanProses(noProses, body, pengguna.id));
    }),
  );

  return r;
}

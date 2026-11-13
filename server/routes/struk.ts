import { Router } from 'express';
import { all, get, getSettings, run, withTransaction } from '../db.pg.ts';
import { asyncHandler, tolak } from '../lib/http.ts';

/**
 * API BAGIAN J3/J4 — Pengaturan struk POS.
 *
 *  - Profil struk (ukuran kertas thermal/A4/A5/A6/kustom, margin, font,
 *    blok tampil/sembunyi, teks catatan kaki) — beberapa profil, satu bawaan.
 *  - Pengaturan global POS: "cetak otomatis setelah bayar".
 *
 * Mengubah profil mengikuti matriks peran (pos/pengaturan: tambah/ubah/
 * hapus); tanpa sel yang sesuai, tombol di UI nonaktif.
 */

/** Ukuran kertas struk yang didukung (mm) — dipakai juga untuk CSS @page. */
export const KERTAS_STRUK: Record<string, { lebar: number; tinggi: number | 'otomatis' }> = {
  '58mm': { lebar: 58, tinggi: 'otomatis' },
  '80mm': { lebar: 80, tinggi: 'otomatis' },
  A4: { lebar: 210, tinggi: 297 },
  A5: { lebar: 148, tinggi: 210 },
  A6: { lebar: 105, tinggi: 148 },
};

const BLOK_STRUK = new Set([
  'logo', 'nama_toko', 'alamat', 'telepon', 'kasir', 'pelanggan',
  'kode_item', 'diskon', 'pajak', 'metode_bayar', 'kembalian', 'catatan_kaki', 'qr',
]);
const TEKS_STRUK = new Set(['catatan_kaki']);

const angka = (v: unknown, min: number, max: number, bawaan: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : bawaan;
};

function amanJson<T>(v: unknown, bawaan: T): T {
  try {
    return JSON.parse(String(v ?? '')) as T;
  } catch {
    return bawaan;
  }
}

/** Bentuk respons profil (JSON sudah dibuka). */
export function bentukProfilStruk(r: Record<string, unknown>) {
  return {
    id: Number(r.id),
    nama: String(r.nama),
    bawaan: Number(r.bawaan ?? 0) === 1,
    kertas: String(r.kertas),
    lebar_mm: r.lebar_mm === null || r.lebar_mm === undefined ? null : Number(r.lebar_mm),
    tinggi_mm: r.tinggi_mm === null || r.tinggi_mm === undefined ? null : Number(r.tinggi_mm),
    margin_atas: Number(r.margin_atas),
    margin_kanan: Number(r.margin_kanan),
    margin_bawah: Number(r.margin_bawah),
    margin_kiri: Number(r.margin_kiri),
    ukuran_font: Number(r.ukuran_font),
    blok: amanJson<Record<string, boolean>>(r.blok, {}),
    teks: amanJson<Record<string, string>>(r.teks, {}),
  };
}

/** Validasi & normalisasi body profil struk. */
function bacaProfilStruk(body: Record<string, unknown>, lama?: Record<string, unknown>) {
  const ambil = <T>(kunci: string, bawaan: T): T =>
    body[kunci] !== undefined ? (body[kunci] as T) : (lama?.[kunci] as T) ?? bawaan;

  const nama = String(ambil('nama', '') ?? '').trim();
  if (!nama) throw tolak(400, 'Nama profil struk wajib diisi.');
  if (nama.length > 80) throw tolak(400, 'Nama profil struk maksimal 80 karakter.');

  const kertas = String(ambil('kertas', '80mm'));
  const kustom = kertas === 'custom';
  if (!kustom && !(kertas in KERTAS_STRUK)) {
    throw tolak(400, `Ukuran kertas "${kertas}" tidak didukung (58mm / 80mm / A4 / A5 / A6 / kustom).`);
  }
  const lebarMm = kustom ? angka(ambil('lebar_mm', 80), 20, 300, 80) : null;
  // tinggi_mm null = otomatis (thermal mengikuti isi; kustom boleh otomatis).
  const tinggiMentah = ambil('tinggi_mm', null);
  const tinggiMm = tinggiMentah === null || tinggiMentah === undefined ? null : angka(tinggiMentah, 30, 2000, 200);

  const blok: unknown = body['blok'] !== undefined ? body['blok'] : lama?.['blok'];
  let blokBersih: Record<string, boolean> | null = null;
  if (blok && typeof blok === 'object' && !Array.isArray(blok)) {
    blokBersih = {};
    for (const [k, v] of Object.entries(blok as Record<string, unknown>)) {
      if (BLOK_STRUK.has(k)) blokBersih[k] = Boolean(v);
    }
  }

  const teks: unknown = body['teks'] !== undefined ? body['teks'] : lama?.['teks'];
  let teksBersih: Record<string, string> | null = null;
  if (teks && typeof teks === 'object' && !Array.isArray(teks)) {
    teksBersih = {};
    for (const [k, v] of Object.entries(teks as Record<string, unknown>)) {
      if (TEKS_STRUK.has(k)) teksBersih[k] = String(v).slice(0, 300);
    }
  }

  return {
    nama,
    kertas,
    lebar_mm: lebarMm,
    tinggi_mm: tinggiMm,
    margin_atas: angka(ambil('margin_atas', 3), 0, 60, 3),
    margin_kanan: angka(ambil('margin_kanan', 2), 0, 60, 2),
    margin_bawah: angka(ambil('margin_bawah', 3), 0, 60, 3),
    margin_kiri: angka(ambil('margin_kiri', 2), 0, 60, 2),
    ukuran_font: angka(ambil('ukuran_font', 11), 6, 24, 11),
    blok: JSON.stringify(blokBersih ?? amanJson<Record<string, boolean>>(lama?.blok, {})),
    teks: JSON.stringify(teksBersih ?? amanJson<Record<string, string>>(lama?.teks, {})),
  };
}

export function routerStruk() {
  const r = Router();

  // --- Daftar profil + pengaturan global (kasir boleh membaca) ------------
  r.get(
    '/profil',
    asyncHandler(async (_req, res) => {
      const rows = await all<Record<string, unknown>>(
        'SELECT * FROM struk_profil ORDER BY bawaan DESC, nama',
      );
      const s = await getSettings();
      res.json({
        data: rows.map(bentukProfilStruk),
        kertas: KERTAS_STRUK,
        pengaturan: { cetak_otomatis: s['struk_cetak_otomatis'] === 'true' },
      });
    }),
  );

  // --- Buat profil baru (Admin) -------------------------------------------
  r.post(
    '/profil',
    asyncHandler(async (req, res) => {
      const isi = bacaProfilStruk((req.body ?? {}) as Record<string, unknown>);
      const hasil = await run(
        `INSERT INTO struk_profil (nama, kertas, lebar_mm, tinggi_mm, margin_atas, margin_kanan,
                                   margin_bawah, margin_kiri, ukuran_font, blok, teks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        isi.nama, isi.kertas, isi.lebar_mm, isi.tinggi_mm,
        isi.margin_atas, isi.margin_kanan, isi.margin_bawah, isi.margin_kiri,
        isi.ukuran_font, isi.blok, isi.teks,
      );
      const id = Number(hasil.lastInsertRowid);
      const baris = await get<Record<string, unknown>>('SELECT * FROM struk_profil WHERE id = ?', id);
      res.status(201).json({ id, data: baris ? bentukProfilStruk(baris) : null });
    }),
  );

  // --- Perbarui profil (Admin) --------------------------------------------
  r.put(
    '/profil/:id',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const lama = await get<Record<string, unknown>>('SELECT * FROM struk_profil WHERE id = ?', id);
      if (!lama) throw tolak(404, 'Profil struk tidak ditemukan.');
      const isi = bacaProfilStruk((req.body ?? {}) as Record<string, unknown>, lama);
      await run(
        `UPDATE struk_profil SET nama = ?, kertas = ?, lebar_mm = ?, tinggi_mm = ?,
                margin_atas = ?, margin_kanan = ?, margin_bawah = ?, margin_kiri = ?,
                ukuran_font = ?, blok = ?, teks = ?, diubah_pada = now()
         WHERE id = ?`,
        isi.nama, isi.kertas, isi.lebar_mm, isi.tinggi_mm,
        isi.margin_atas, isi.margin_kanan, isi.margin_bawah, isi.margin_kiri,
        isi.ukuran_font, isi.blok, isi.teks, id,
      );
      const baris = await get<Record<string, unknown>>('SELECT * FROM struk_profil WHERE id = ?', id);
      res.json({ data: baris ? bentukProfilStruk(baris) : null });
    }),
  );

  // --- Hapus profil (Admin; profil bawaan tidak bisa dihapus) --------------
  r.delete(
    '/profil/:id',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const lama = await get<Record<string, unknown>>('SELECT * FROM struk_profil WHERE id = ?', id);
      if (!lama) throw tolak(404, 'Profil struk tidak ditemukan.');
      if (Number(lama.bawaan) === 1) throw tolak(400, 'Profil bawaan tidak bisa dihapus — tetapkan bawaan lain dulu.');
      await run('DELETE FROM struk_profil WHERE id = ?', id);
      res.json({ pesan: 'Profil struk dihapus.' });
    }),
  );

  // --- Jadikan bawaan (Admin) ---------------------------------------------
  r.post(
    '/profil/:id/bawaan',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const ada = await get<Record<string, unknown>>('SELECT id FROM struk_profil WHERE id = ?', id);
      if (!ada) throw tolak(404, 'Profil struk tidak ditemukan.');
      await withTransaction(async () => {
        await run('UPDATE struk_profil SET bawaan = FALSE');
        await run('UPDATE struk_profil SET bawaan = TRUE, diubah_pada = now() WHERE id = ?', id);
      });
      res.json({ pesan: 'Profil menjadi bawaan cetak.' });
    }),
  );

  // --- Pengaturan POS: cetak otomatis setelah bayar (Admin) ----------------
  r.put(
    '/pengaturan',
    asyncHandler(async (req, res) => {
      const nilai = Boolean((req.body ?? {}).cetak_otomatis);
      await run(
        `INSERT INTO settings (kunci, nilai, diubah_pada) VALUES ('struk_cetak_otomatis', ?, now())
         ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai, diubah_pada = excluded.diubah_pada`,
        String(nilai),
      );
      res.json({ pengaturan: { cetak_otomatis: nilai } });
    }),
  );

  return r;
}

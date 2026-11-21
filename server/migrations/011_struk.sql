-- BAGIAN J4 — Pengaturan ukuran struk POS (hanya Admin yang mengubah).
-- Beberapa profil boleh disimpan (mis. "Thermal 58 mm kasir depan"),
-- satu profil bawaan dipakai kedua mode POS bila kasir tidak memilih lain.

CREATE TABLE IF NOT EXISTS struk_profil (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nama          TEXT NOT NULL,
  bawaan        INTEGER NOT NULL DEFAULT 0,          -- 1 = profil default cetak
  kertas        TEXT NOT NULL DEFAULT '80mm',        -- 58mm | 80mm | A4 | A5 | A6 | custom
  lebar_mm      REAL,                                -- hanya kertas = custom
  tinggi_mm     REAL,                                -- NULL = otomatis (thermal / panjang isi)
  margin_atas   REAL NOT NULL DEFAULT 3,
  margin_kanan  REAL NOT NULL DEFAULT 2,
  margin_bawah  REAL NOT NULL DEFAULT 3,
  margin_kiri   REAL NOT NULL DEFAULT 2,
  ukuran_font   REAL NOT NULL DEFAULT 11,            -- px pada struk thermal/A4
  blok          TEXT NOT NULL DEFAULT '{}',          -- JSON: tampil/sembunyi blok
  teks          TEXT NOT NULL DEFAULT '{}',          -- JSON: teks tetap (catatan kaki)
  dibuat_pada   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
  diubah_pada   TEXT
);

-- Profil bawaan agar POS langsung bisa mencetak sebelum admin mengatur.
INSERT INTO struk_profil (nama, bawaan, kertas, blok, teks)
SELECT 'Thermal 80 mm', 1, '80mm',
       '{"logo":true,"nama_toko":true,"alamat":true,"telepon":true,"kasir":true,"pelanggan":true,"kode_item":true,"diskon":true,"pajak":true,"metode_bayar":true,"kembalian":true,"catatan_kaki":true,"qr":true}',
       '{"catatan_kaki":"Terima kasih atas kunjungan Anda"}'
WHERE NOT EXISTS (SELECT 1 FROM struk_profil);

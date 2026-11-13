-- =====================================================================
-- BAGIAN I — Faktur otomatis, template yang bisa diubah, ukuran kertas
-- =====================================================================
-- 1) invoices          : dokumen faktur hasil generasi otomatis (snapshot).
-- 2) invoice_templates : template visual per jenis dokumen (Penjualan,
--                         Pembelian, Surat Jalan) + ukuran & margin kertas.
-- 3) settings tambahan : prefix nomor, identitas toko, aturan per kodi.

CREATE TABLE invoice_templates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nama          TEXT NOT NULL,
  jenis         TEXT NOT NULL CHECK (jenis IN ('penjualan', 'pembelian', 'surat_jalan')),
  -- Satu template bawaan per jenis (dipakai generasi otomatis).
  bawaan        INTEGER NOT NULL DEFAULT 0 CHECK (bawaan IN (0, 1)),

  -- --- I3: ukuran kertas & tata letak ---------------------------------
  -- kertas: A4 | A5 | A6 | Letter | Legal | 58mm | 80mm | HalfA4 | custom
  kertas        TEXT NOT NULL DEFAULT 'A4',
  orientasi     TEXT NOT NULL DEFAULT 'portrait' CHECK (orientasi IN ('portrait', 'landscape')),
  lebar_mm      REAL,                       -- ukuran kustom (mm)
  tinggi_mm     REAL,                       -- ukuran kustom (mm)
  margin_atas   REAL NOT NULL DEFAULT 12,
  margin_kanan  REAL NOT NULL DEFAULT 12,
  margin_bawah  REAL NOT NULL DEFAULT 12,
  margin_kiri   REAL NOT NULL DEFAULT 12,
  skala         REAL NOT NULL DEFAULT 100,  -- skala isi (%)
  ukuran_font   REAL NOT NULL DEFAULT 10,   -- ukuran font isi (pt)
  aksen         TEXT NOT NULL DEFAULT '#2563eb',

  -- --- I2: blok tampil/sembunyi, urutan kolom, teks tetap --------------
  blok          TEXT NOT NULL DEFAULT '{}', -- {logo, alamat, kolom_kode, kolom_satuan, kolom_diskon, terbilang, tanda_tangan, catatan, ...}
  urutan_kolom  TEXT NOT NULL DEFAULT '["kode", "nama", "qty", "satuan", "harga", "diskon", "subtotal"]',
  teks          TEXT NOT NULL DEFAULT '{}', -- {judul, catatan_kaki, rekening, catatan}

  dibuat_oleh   INTEGER REFERENCES users(id),
  dibuat_pada   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  diubah_pada   TEXT
);

-- Tepat satu template bawaan per jenis dokumen.
CREATE UNIQUE INDEX idx_template_bawaan
  ON invoice_templates (jenis, bawaan)
  WHERE bawaan = 1;

CREATE TABLE invoices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  no_faktur     TEXT NOT NULL UNIQUE,        -- INV-2026-0001 / PB-2026-0001 (prefix dari Pengaturan)
  jenis         TEXT NOT NULL CHECK (jenis IN ('penjualan', 'pembelian')),
  sumber_tipe   TEXT NOT NULL,               -- 'penjualan' | 'pembelian'
  sumber_id     INTEGER NOT NULL,            -- id sales / purchases
  tanggal       TEXT NOT NULL,
  template_id   INTEGER REFERENCES invoice_templates(id),

  pihak_nama    TEXT,                        -- pelanggan / pemasok
  pihak_telepon TEXT,
  pihak_alamat  TEXT,

  subtotal      REAL NOT NULL DEFAULT 0,
  diskon        REAL NOT NULL DEFAULT 0,
  pajak_persen  REAL NOT NULL DEFAULT 0,
  pajak         REAL NOT NULL DEFAULT 0,
  total         REAL NOT NULL DEFAULT 0,
  terbilang     TEXT,
  catatan       TEXT,

  -- Snapshot isi faktur (item, identitas toko, dokumen sumber) agar bisa
  -- dibuka ulang walau data sumber berubah.
  data_json     TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'terbit' CHECK (status IN ('terbit', 'batal')),

  dibuat_oleh   INTEGER REFERENCES users(id),
  dibuat_pada   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  diubah_pada   TEXT
);

-- Satu faktur per dokumen sumber (generasi idempoten).
CREATE UNIQUE INDEX idx_invoice_sumber ON invoices (sumber_tipe, sumber_id);
CREATE INDEX idx_invoice_tanggal ON invoices (tanggal);

-- --- Pengaturan: prefix nomor, identitas toko, aturan per kodi ---------
INSERT INTO settings (kunci, nilai, keterangan)
SELECT kunci, nilai, keterangan FROM (
  SELECT 'faktur_prefix_penjualan' AS kunci, 'INV' AS nilai,
         'Prefix nomor faktur penjualan (mis. INV-2026-0001)' AS keterangan
  UNION ALL SELECT 'faktur_prefix_pembelian', 'PB',
         'Prefix nomor faktur pembelian (mis. PB-2026-0001)'
  UNION ALL SELECT 'alamat_usaha', '', 'Alamat toko pada faktur & dokumen'
  UNION ALL SELECT 'telepon_usaha', '', 'Telepon toko pada faktur & dokumen'
  UNION ALL SELECT 'logo_usaha', '', 'URL/logo toko pada faktur (opsional)'
  UNION ALL SELECT 'aturan_kodi',
         '{"per_kodi":20,"normal":{"39":4,"40":4,"41":4,"42":4,"43":4}}',
         'Aturan per kodi untuk parser Chatbot: jumlah pasang per kodi & jatah per size'
)
WHERE kunci NOT IN (SELECT kunci FROM settings);

-- --- Template bawaan per jenis dokumen --------------------------------
INSERT INTO invoice_templates (nama, jenis, bawaan, urutan_kolom, teks)
SELECT 'Faktur Penjualan Bawaan', 'penjualan', 1,
       '["kode","nama","qty","satuan","harga","diskon","subtotal"]',
       '{"judul":"FAKTUR PENJUALAN","catatan_kaki":"Terima kasih atas kunjungan Anda.","catatan":""}'
WHERE NOT EXISTS (SELECT 1 FROM invoice_templates WHERE jenis = 'penjualan' AND bawaan = 1);

INSERT INTO invoice_templates (nama, jenis, bawaan, urutan_kolom, teks)
SELECT 'Faktur Pembelian Bawaan', 'pembelian', 1,
       '["kode","nama","qty","satuan","harga","diskon","subtotal"]',
       '{"judul":"FAKTUR PEMBELIAN","catatan_kaki":"Dokumen ini dibuat otomatis dari transaksi pembelian.","catatan":""}'
WHERE NOT EXISTS (SELECT 1 FROM invoice_templates WHERE jenis = 'pembelian' AND bawaan = 1);

INSERT INTO invoice_templates (nama, jenis, bawaan, urutan_kolom, teks)
SELECT 'Surat Jalan Bawaan', 'surat_jalan', 1,
       '["kode","nama","qty","satuan"]',
       '{"judul":"SURAT JALAN","catatan_kaki":"Barang yang sudah keluar tidak dapat ditukar.","catatan":""}'
WHERE NOT EXISTS (SELECT 1 FROM invoice_templates WHERE jenis = 'surat_jalan' AND bawaan = 1);

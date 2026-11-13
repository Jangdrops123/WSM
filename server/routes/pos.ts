
import { Router } from 'express';
import { all, get, getSettings, run, withTransaction } from '../db.pg.ts';
import { bacaTab, cariTab, nomorOtomatis } from '../lib/pengaturanBaru.ts';
import { asyncHandler, polaCari, tolak } from '../lib/http.ts';
import { cocokSandi, konteksWajib } from '../lib/auth.ts';
import { catatAudit } from '../lib/audit.ts';
import { ubahStok } from '../lib/stok.ts';
import { syaratGudangSesi, wajibGudangDiizinkan, wajibKelolaTransaksi, wajibSel } from '../lib/hak.ts';
import { idPenggunaBawaan as idKasir } from '../lib/jurnal.ts';
import { pengaturanPpn } from '../lib/akun.ts';
import { akunKasMetode, catatMutasiKas } from '../lib/dasarKas.ts';
import { buatFakturPenjualan } from '../lib/faktur.ts';
import { hapusPenjualanPermanen } from '../lib/pembersihanTransaksi.ts';

/**
 * Kolom tambahan tabel `payments` untuk pelunasan piutang DARI KASIR:
 * - `shift_id`: menautkan penerimaan ke shift kasir aktif agar laporan tutup
 *   kasir ikut menghitung uang tunai piutang.
 * - `metode`: 'tunai' | 'transfer' (menentukan laci vs rekening bank).
 * Idempoten — aman dijalankan berulang pada instalasi lama.
 */
let skemaPiutangSiap = false;
async function pastikanSkemaPiutang(): Promise<void> {
  if (skemaPiutangSiap) return;
  await run(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS shift_id BIGINT REFERENCES cashier_shifts(id)`);
  await run(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS metode TEXT`);
  skemaPiutangSiap = true;
}

/**
 * API POS (Mode Foto): produk untuk grid kasir, shift kasir, transaksi
 * tertahan, PENJUALAN ATOMIK (stok berkurang + kartu stok + jurnal penjualan
 * & HPP dalam satu transaksi), void & retur berverifikasi password Admin.
 *
 * Tanpa varian: keranjang merujuk product_id langsung dan setiap baris
 * transaksi menyimpan snapshot nama, SKU, serta harga saat transaksi.
 */

/**
 * Verifikasi ulang sandi pengguna yang sedang login untuk aksi sensitif.
 * Hanya Administrator atau peran dengan Hak Khusus "Hapus transaksi" —
 * password akun sendiri tetap wajib diketik ulang (bukan PIN supervisor).
 */
async function verifikasiAdmin(req: import('express').Request, sandi: unknown): Promise<void> {
  const sesi = konteksWajib(req);
  if (!(sesi.admin || sesi.khusus.hapus_transaksi)) {
    throw tolak(403, 'Void dan retur hanya dapat dilakukan oleh Administrator atau peran dengan Hak Khusus "Hapus transaksi".');
  }
  const akun = await get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', sesi.userId);
  if (typeof sandi !== 'string' || sandi.length === 0) {
    throw tolak(400, 'Password akun wajib diisi untuk void/retur.');
  }
  // 400, bukan 403: 403 dipakai untuk penolakan hak akses matriks dan pesannya
  // ditimpa klien menjadi "Aksi ditolak oleh Hak Akses", sedangkan salah
  // password harus tampil spesifik di form modal. 401 akan memicu logout.
  if (!cocokSandi(sandi, akun?.password_hash)) {
    throw tolak(400, 'Password akun yang Anda masukkan salah. Periksa kembali lalu coba lagi.');
  }
}
async function shiftAktif() {
  return await get<{ id: number; kas_awal: number }>(
    `SELECT id, kas_awal FROM cashier_shifts WHERE tutup_pada IS NULL ORDER BY id DESC LIMIT 1`,
  );
}

async function nomorDokumen(prefix: string): Promise<string> {
  // Mengikuti Pengaturan ▸ Penomoran Dokumen; nilai bawaan = perilaku lama.
  return await nomorOtomatis(prefix === 'RET' ? 'retur' : 'surat_jalan');
}

/**
 * Kurangi stok penjualan: SATU mutasi keluar per produk per gudang
 * (saldo memang disimpan per gudang; lokasi tidak memecah saldo).
 * Sisa stok (bila minus diizinkan) jatuh ke kebijakan stok minus di ubahStok.
 */
async function kurangiStok(warehouseId: number, productId: number, qty: number, tipeDokumen: string, dokumenId: number, userId: number): Promise<void> {
  await ubahStok({ productId, warehouseId, keluar: qty, tipeDokumen, dokumenId, userId });
}

type ItemMasuk = { product_id: number; qty: number; harga: number; diskon?: number };
type BayarMasuk = { metode: 'tunai' | 'transfer' | 'qris' | 'kredit'; jumlah: number; referensi?: string | null };

const METODE = new Set(['tunai', 'transfer', 'qris', 'kredit']);/** Hasil validasi + perhitungan satu penjualan (dipakai POST /pos/sales & PUT /pos/sales/:id). */
type PenjualanSiap = {
  tanggal: string;
  rincian: { productId: number; qty: number; harga: number; diskon: number; hpp: number; sku: string; nama: string }[];
  payments: BayarMasuk[];
  customerId: number | null;
  warehouseId: number;
  modePos: 'foto' | 'cepat';
  subtotal: number;
  diskonTotal: number;
  pajak: number;
  total: number;
  tunaiNet: number;
  transferNet: number;
  qrisNet: number;
  kreditNet: number;
  jatuhTempo: string | null;
  dibayar: number;
};

/**
 * Validasi keranjang, pelanggan, pembayaran, produk, dan hak khusus diskon,
 * lalu hitung total + net penerimaan per metode. SATU sumber aturan untuk
 * transaksi baru (POST) maupun edit transaksi (PUT — Token Edit).
 */
async function hitungPenjualan(
  req: import('express').Request,
  body: {
    items?: ItemMasuk[];
    diskon?: number;
    pajak_persen?: number;
    customer_id?: number | null;
    warehouse_id?: number;
    mode_pos?: string;
    payments?: BayarMasuk[];
    jatuh_tempo?: string | null;
    created_at?: string | null;
  },
): Promise<PenjualanSiap> {
  // Waktu transaksi dari jam kasir (live clock header POS) — dipakai sebagai
  // tanggal bila valid & masuk akal, fallback ke waktu server.
  let tanggal = new Date().toISOString();
  if (typeof body.created_at === 'string' && body.created_at) {
    const cli = new Date(body.created_at);
    if (Number.isFinite(cli.getTime())) {
      const selisih = Date.now() - cli.getTime();
      if (selisih >= -5 * 60_000 && selisih <= 24 * 3600_000) tanggal = cli.toISOString();
    }
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) throw tolak(400, 'Keranjang kosong.');
  const diskon = Math.max(0, Number(body.diskon ?? 0));
  // Tarif PPN dari Pengaturan (akuntansi_ppn); bila klien mengirim nilai
  // eksplisit, nilai klien yang dipakai (kompatibel dengan POS lama).
  const ppnSet = await pengaturanPpn();
  const pajakPersen =
    body.pajak_persen !== undefined && body.pajak_persen !== null && body.pajak_persen !== ('' as unknown)
      ? Number(body.pajak_persen)
      : ppnSet.aktif
        ? ppnSet.tarif
        : 0;
  if (!Number.isFinite(pajakPersen) || pajakPersen < 0 || pajakPersen > 100) throw tolak(400, 'Persentase pajak tidak valid.');
  const warehouseId = Number(body.warehouse_id ?? 0);
  const gudang = await get<{ id: number }>(`SELECT id FROM warehouses WHERE id = ?`, warehouseId);
  if (!gudang) throw tolak(400, 'Gudang penjualan tidak valid.');
  // ISOLASI GUDANG — transaksi tidak boleh dibuat ke gudang di luar cakupan.
  await wajibGudangDiizinkan(req, warehouseId);
  const payments = Array.isArray(body.payments) ? body.payments : [];
  if (payments.length === 0) throw tolak(400, 'Belum ada pembayaran.');
  for (const b of payments) {
    if (!METODE.has(b.metode)) throw tolak(400, `Metode pembayaran "${String(b.metode)}" tidak dikenal.`);
    if (!Number.isFinite(Number(b.jumlah)) || Number(b.jumlah) <= 0) throw tolak(400, 'Jumlah pembayaran tidak valid.');
  }

  const customerId = body.customer_id ? Number(body.customer_id) : null;
  const kreditTotal = payments.filter((p) => p.metode === 'kredit').reduce((a, p) => a + Number(p.jumlah), 0);
  if (kreditTotal > 0 && !customerId) throw tolak(400, 'Pembayaran kredit/piutang memerlukan pelanggan.');
  // Pelanggan yang sudah dihapus tidak boleh lolos ke INSERT/UPDATE (FK 23503
  // akan menjadi 500). Transaksi lama tanpa pelanggan (customer_id NULL) tetap
  // sah, dan pelanggan nonaktif tetap diterima agar transaksi lama bisa diedit.
  if (customerId) {
    const pelanggan = await get<{ id: number }>(`SELECT id FROM customers WHERE id = ?`, customerId);
    if (!pelanggan) {
      throw tolak(400, 'Pelanggan transaksi ini sudah dihapus. Pilih pelanggan lain, atau kosongkan pelanggan.');
    }
  }

  // Validasi produk + hitung total SEBELUM transaksi (baca konsisten).
  let subtotal = 0;
  let diskonItem = 0;
  const rincian = await Promise.all(items.map(async (it) => {
    const qty = Number(it.qty);
    const harga = Number(it.harga);
    const diskonBaris = Math.max(0, Number(it.diskon ?? 0));
    if (!Number.isInteger(Number(it.product_id)) || !Number.isFinite(qty) || qty <= 0) throw tolak(400, 'Item tidak valid.');
    if (!Number.isFinite(harga) || harga < 0) throw tolak(400, 'Harga tidak valid.');
    if (!Number.isFinite(diskonBaris)) throw tolak(400, 'Diskon item tidak valid.');
    if (diskonBaris > qty * harga) throw tolak(400, 'Diskon item melebihi nilai baris.');
    const p = await get<{ id: number; harga_beli: number; harga_jual: number; sku: string; nama: string }>(
      `SELECT id, harga_beli, harga_jual, sku, nama FROM products
       WHERE id = ? AND deleted_at IS NULL AND aktif = TRUE`,
      Number(it.product_id),
    );
    if (!p) throw tolak(404, `Produk ${Number(it.product_id)} tidak ditemukan atau nonaktif.`);
    // Hak Khusus: izin ubah harga jual di kasir + batas maksimal diskon %.
    const k = konteksWajib(req);
    const bolehUbahHarga = k.admin || k.khusus.ubah_harga_kasir;
    const batasDiskon = k.admin ? 100 : k.khusus.diskon_maks;
    if (!bolehUbahHarga && harga !== Number(p.harga_jual)) {
      throw tolak(403, 'Peran ini tidak memiliki hak "Ubah harga jual di kasir" (Hak Khusus).');
    }
    const persenBaris = qty * harga > 0 ? (diskonBaris / (qty * harga)) * 100 : 0;
    if (persenBaris > batasDiskon + 1e-9) {
      throw tolak(403, `Diskon baris ${persenBaris.toFixed(1)}% melebihi batas ${batasDiskon}% peran ini.`);
    }
    subtotal += qty * harga;
    diskonItem += diskonBaris;
    // Snapshot nama & SKU saat transaksi — riwayat tetap utuh walau master berubah.
    return { productId: p.id, qty, harga, diskon: diskonBaris, hpp: qty * Number(p.harga_beli), sku: p.sku, nama: p.nama };
  }));

  // Hak Khusus: diskon kasir (persentase subtotal) ikut dibatasi.
  {
    const k = konteksWajib(req);
    const batas = k.admin ? 100 : k.khusus.diskon_maks;
    const persen = subtotal > 0 ? (diskon / subtotal) * 100 : 0;
    if (persen > batas + 1e-9) {
      throw tolak(403, `Diskon penjualan ${persen.toFixed(1)}% melebihi batas ${batas}% peran ini.`);
    }
  }
  const dasar = Math.max(0, subtotal - diskon - diskonItem);
  const pajak = Math.round(dasar * (pajakPersen / 100));
  const total = dasar + pajak;
  const dibayar = payments.reduce((a, p) => a + Number(p.jumlah), 0);
  if (dibayar + 0.5 < total) throw tolak(400, `Pembayaran kurang ${total - dibayar} — lengkapi pembayaran.`);

  // Net penerimaan untuk kas & piutang: uang kembalian dipotong berurutan
  // (tunai → transfer → qris → kredit).
  let sisaKembalian = Math.max(0, dibayar - total);
  const potong = (n: number): number => {
    const ambil = Math.min(n, sisaKembalian);
    sisaKembalian -= ambil;
    return n - ambil;
  };
  const tunaiNet = potong(payments.filter((p) => p.metode === 'tunai').reduce((a, p) => a + Number(p.jumlah), 0));
  const transferNet = potong(payments.filter((p) => p.metode === 'transfer').reduce((a, p) => a + Number(p.jumlah), 0));
  const qrisNet = potong(payments.filter((p) => p.metode === 'qris').reduce((a, p) => a + Number(p.jumlah), 0));
  const kreditNet = potong(kreditTotal);

  return {
    tanggal,
    rincian,
    payments,
    customerId,
    warehouseId,
    modePos: body.mode_pos === 'cepat' ? 'cepat' : 'foto',
    subtotal,
    diskonTotal: diskon + diskonItem,
    pajak,
    total,
    tunaiNet,
    transferNet,
    qrisNet,
    kreditNet,
    jatuhTempo: body.jatuh_tempo ? String(body.jatuh_tempo) : null,
    dibayar,
  };
}

/**
 * Tulis seluruh efek satu penjualan: baris item + potong stok (kartu stok),
 * pembayaran, piutang kredit, dan kas masuk. WAJIB di dalam withTransaction().
 */
async function terapkanPenjualan(saleId: number, s: PenjualanSiap, kasir: number, noDok: string): Promise<void> {
  for (const it of s.rincian) {
    await run(
      `INSERT INTO sale_items (sale_id, product_id, nama_produk, sku, qty, unit_id, harga, diskon, subtotal, hpp)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      saleId,
      it.productId,
      it.nama,
      it.sku,
      it.qty,
      it.harga,
      it.diskon,
      it.qty * it.harga - it.diskon,
      it.hpp,
    );
    // Stok berkurang + kartu stok tercatat (transaksi yang sama).
    await kurangiStok(s.warehouseId, it.productId, it.qty, 'penjualan', saleId, kasir);
  }

  for (const b of s.payments) {
    await run(
      `INSERT INTO sale_payments (sale_id, metode, jumlah, referensi) VALUES (?, ?, ?, ?)`,
      saleId,
      b.metode,
      Number(b.jumlah),
      b.referensi ? String(b.referensi) : null,
    );
  }

  if (s.kreditNet > 0) {
    const tempo = s.jatuhTempo ?? new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    await run(
      `INSERT INTO receivables (sale_id, customer_id, jatuh_tempo, total, status, dibuat_oleh)
       VALUES (?, ?, ?, ?, 'belum', ?)`,
      saleId,
      s.customerId,
      tempo,
      s.kreditNet,
      kasir,
    );
  }

  // AKUNTANSI DASAR — tanpa jurnal. Penerimaan tunai/transfer/QRIS langsung
  // menjadi Kas Masuk pada rekening sesuai metode bayar.
  const penerimaan: [string, number][] = [
    ['tunai', s.tunaiNet],
    ['transfer', s.transferNet],
    ['qris', s.qrisNet],
  ];
  for (const [metode, jumlah] of penerimaan) {
    if (jumlah <= 0) continue;
    const akunKas = await akunKasMetode(metode);
    if (!akunKas) continue; // metode belum ditautkan ke rekening — dilewati agar POS tetap jalan
    await catatMutasiKas({
      tipe: 'masuk',
      akunId: akunKas.id,
      jumlah,
      keterangan: `Penjualan ${noDok}`,
      sumberTipe: 'penjualan',
      sumberId: saleId,
      dibuatOleh: kasir,
    });
  }
}

/* ============ Autocomplete POS Mode Cepat (/pos/cari) ====================
 * Hasil = SATU baris per produk (unit jual). Pencarian bertingkat:
 *   Fase A — empat jalur indeks awalan (sku, barcode, nama, kode_item);
 *            masing-masing SATU syarat LIKE 'awalan%' + ORDER BY kolom indeks
 *            COLLATE NOCASE + LIMIT dinamis sehingga berhenti dini tanpa memindai
 *            seluruh tabel (lihat migrasi 009: indeks NOCASE + ANALYZE).
 *   Fase B — hanya bila fase A < batas hasil: satu query kata/berisi (scan).
 * Stok dihitung terakhir hanya untuk produk terpilih.
 *
 * Batas dinamis (contoh: menyesuaikan Master Data): ?batas=N (1–500,
 * bawaan 100). Frontend meminta batas besar + dropdown scroll sehingga
 * semua barang cocok tampil, bukan patokan 10.
 */

/** Bawaan & maksimum hasil autocomplete — menyesuaikan isi Master Data. */
const BATAS_SARAN_BAWAAN = 100;
const BATAS_SARAN_MAKS = 500;

interface BarisCari {
  product_id: number;
  nama: string;
  kode_item: string | null;
  sku: string;
  barcode: string | null;
  /** Stok minimum produk — dipakai Mode Cepat untuk warna "menipis". */
  stok_min: number;
  harga: number;
}

const KOLOM_CARI = `p.id AS product_id, p.nama, p.kode_item,
        p.sku, p.barcode, p.stok_min, p.harga_jual AS harga`;
const DARI_PRODUK = `FROM products p`;
const SYARAT_AKTIF = `p.deleted_at IS NULL AND p.aktif = TRUE`;

/**
 * SUMBER DATA autocomplete = tabel MASTER `products`, DIBATASI alokasi gudang.
 *
 * WI (Warehouse Isolation): kandidat hanya produk yang punya slot stok
 * (stock_balances.qty <> 0) di gudang aktif — gudang yang dipilih pengguna,
 * atau gudang-gudang yang diizinkan bila gudang belum dipilih. Produk yang
 * hanya punya stok di gudang lain tidak boleh muncul (mis. barang gudang B
 * saat kasir memakai gudang A).
 *
 * Catatan: "Reset Transaksi" mengosongkan qty saldo → pencarian memang kosong
 * sampai ada stok masuk; itu konsekuensi isolasi yang diminta.
 *
 * `saring` = fragmen EXISTS (... sb ...) opsional tanpa klausa WHERE tambahan.
 */
const Q_CARI_SKU = (batas: number, saring = '') => `SELECT ${KOLOM_CARI} ${DARI_PRODUK} WHERE ${SYARAT_AKTIF} ${saring}
  AND p.sku ILIKE ? ESCAPE '\\' ORDER BY LOWER(p.sku) LIMIT ${batas}`;
const Q_CARI_BARCODE = (batas: number, saring = '') => `SELECT ${KOLOM_CARI} ${DARI_PRODUK} WHERE ${SYARAT_AKTIF} ${saring}
  AND p.barcode ILIKE ? ESCAPE '\\' ORDER BY LOWER(p.barcode) LIMIT ${batas}`;
const Q_CARI_NAMA = (batas: number, saring = '') => `SELECT ${KOLOM_CARI} ${DARI_PRODUK} WHERE ${SYARAT_AKTIF} ${saring}
  AND p.nama ILIKE ? ESCAPE '\\' ORDER BY LOWER(p.nama) LIMIT ${batas}`;
const Q_CARI_KODE = (batas: number, saring = '') => `SELECT ${KOLOM_CARI} ${DARI_PRODUK} WHERE ${SYARAT_AKTIF} ${saring}
  AND p.kode_item ILIKE ? ESCAPE '\\' ORDER BY LOWER(p.kode_item) LIMIT ${batas}`;

// Jalur kata/berisi: penuh dengan syarat OR sehingga scan; urutan peringkat
// (0 = persis barcode/SKU → 1 awalan nama → 2 awalan kode → 3 awalan kata → 4 berisi).
const Q_CARI_BROAD = (batas: number, saring = '') => `SELECT ${KOLOM_CARI} ${DARI_PRODUK} WHERE ${SYARAT_AKTIF} ${saring} AND (
      p.nama ILIKE ? ESCAPE '\\' OR p.nama ILIKE ? ESCAPE '\\'
   OR p.kode_item ILIKE ? ESCAPE '\\' OR p.sku ILIKE ? ESCAPE '\\'
   OR p.barcode ILIKE ? ESCAPE '\\')
  ORDER BY
    CASE
      WHEN p.barcode ILIKE ? OR p.sku ILIKE ? THEN 0
      WHEN p.nama ILIKE ? ESCAPE '\\' THEN 1
      WHEN p.kode_item ILIKE ? ESCAPE '\\' OR p.sku ILIKE ? ESCAPE '\\' OR p.barcode ILIKE ? ESCAPE '\\' THEN 2
      WHEN p.nama ILIKE ? ESCAPE '\\' THEN 3
      ELSE 4
    END,
    p.nama, p.sku
  LIMIT ${batas}`;

/** Peringkat hasil (0 = paling cocok) — identik dengan CASE di Q_CARI_BROAD. */
function peringkatCari(r: BarisCari, q: string): number {
  const sku = r.sku.toLowerCase();
  const barcode = (r.barcode ?? '').toLowerCase();
  const nama = r.nama.toLowerCase();
  const kode = (r.kode_item ?? '').toLowerCase();
  if (barcode === q || sku === q) return 0;
  if (nama.startsWith(q)) return 1;
  if (kode.startsWith(q) || sku.startsWith(q) || barcode.startsWith(q)) return 2;
  if (nama.includes(` ${q}`)) return 3;
  return 4;
}

export function routerPos() {
  const r = Router();

  // --- Produk untuk grid POS (foto, harga, stok per gudang) -----------------
  // ?gudang=<id> mengunci grid ke gudang itu: HANYA produk yang punya catatan
  // saldo di gudang tersebut yang dikembalikan (isolasi ketat ala Mode Tanpa
  // Foto). Tanpa gudang: baris global, angka dibatasi gudang sesi.
  r.get(
    '/pos/produk',
    asyncHandler(async (req, res) => {
      const cari = String(req.query.cari ?? '').trim();
      const kategori = Number(req.query.kategori ?? 0);
      const gudangGridMinta = Number(req.query.gudang ?? 0);
      const syarat = ['p.deleted_at IS NULL', 'p.aktif = TRUE'];
      const params: unknown[] = [];
      if (cari) {
        syarat.push(`(p.nama ILIKE ? ESCAPE '\\' OR p.kode_item ILIKE ? ESCAPE '\\' OR p.sku ILIKE ? ESCAPE '\\')`);
        params.push(polaCari(cari), polaCari(cari), polaCari(cari));
      }
      if (kategori) {
        syarat.push('p.category_id = ?');
        params.push(kategori);
      }
      if (gudangGridMinta > 0) {
        // Pertahanan berlapis: middleware menolak gudang di luar cakupan.
        await wajibGudangDiizinkan(req, gudangGridMinta);
        // ISOLASI GUDANG — grid (Mode Foto) juga hanya memuat produk yang
        // punya alokasi stok di gudang itu, agar pencarian di dalam grid tidak
        // menampilkan barang milik gudang lain.
        syarat.push(
          'EXISTS (SELECT 1 FROM stock_balances sbF WHERE sbF.product_id = p.id AND sbF.warehouse_id = ? AND sbF.qty <> 0)',
        );
        params.push(gudangGridMinta);
      }
      const where = `WHERE ${syarat.join(' AND ')}`;
      // ISOLASI GUDANG — angka stok grid hanya dari gudang yang terlihat sesi
      // (atau gudang terkunci bila ?gudang diisi).
      const lingkupGrid = gudangGridMinta > 0
        ? { sql: 'sb.warehouse_id IN (?)', params: [gudangGridMinta] }
        : await syaratGudangSesi(req, 'sb.warehouse_id');
      const batasGrid = lingkupGrid.sql === '1 = 0' ? ' AND 1 = 0' : lingkupGrid.sql ? ` AND ${lingkupGrid.sql}` : '';
      // Urutan parameter mengikuti urutan placeholder di SQL: subquery stok
      // (di SELECT) lebih dulu, lalu syarat WHERE.
      const paramsGrid = [...lingkupGrid.params, ...params];

      const produk = await all<{
        id: number;
        kode_item: string | null;
        nama: string;
        sku: string;
        barcode: string | null;
        foto_url: string | null;
        category_id: number | null;
        kategori: string | null;
        stok_min: number;
        harga: number;
        stok: number;
      }>(
        // X4.2 — foto memakai versi diubah_pada (?v=…) agar foto hasil unggah
        // massal/ganti tampil tanpa muat ulang (cache-busting). URL eksternal
        // dibiarkan apa adanya.
        `SELECT p.id, p.kode_item, p.nama, p.sku, p.barcode,
                CASE WHEN p.foto_url LIKE '/uploads/%'
                     THEN p.foto_url || '?v=' || replace(substr(COALESCE(p.diubah_pada::text, ''), 1, 19), ':', '')
                     ELSE p.foto_url END AS foto_url,
                p.category_id, c.nama AS kategori,
                p.stok_min, p.harga_jual AS harga,
                COALESCE((SELECT SUM(sb.qty) FROM stock_balances sb WHERE sb.product_id = p.id${batasGrid}), 0) AS stok
         FROM products p LEFT JOIN categories c ON c.id = p.category_id
         ${where}
         ORDER BY p.nama ASC
         LIMIT 500`,
        ...paramsGrid,
      );

      const idProduk = produk.map((p) => p.id);
      const saldo = idProduk.length && batasGrid !== ' AND 1 = 0'
        ? await all<{ product_id: number; warehouse_id: number; qty: number }>(
            `SELECT product_id, warehouse_id, qty FROM stock_balances sb
             WHERE qty <> 0 AND product_id IN (${idProduk.map(() => '?').join(',')})${batasGrid}`,
            ...idProduk,
            ...lingkupGrid.params,
          )
        : [];
      const petaSaldo = new Map<number, Record<number, number>>();
      for (const s of saldo) {
        const m = petaSaldo.get(s.product_id) ?? {};
        m[s.warehouse_id] = Number(s.qty);
        petaSaldo.set(s.product_id, m);
      }

      const data = produk.map((p) => ({
        ...p,
        harga: Number(p.harga),
        stok: Number(p.stok),
        stok_gudang: petaSaldo.get(p.id) ?? {},
      }));

      const s = await getSettings();
      const ppn = await pengaturanPpn();
      res.json({
        data,
        pengaturan: {
          pajak_persen: ppn.aktif ? ppn.tarif : Number(s['pajak_persen'] ?? 0),
          ppn,
          nama_usaha: s['nama_usaha'] ?? 'Toko Retail',
          // Mode Foto: rasio gambar kartu dari tab Pengaturan ▸ Penjualan & POS
          // (bidang berskala global) — bawaan persegi 1:1.
          pos_foto_rasio:
            String((await bacaTab(cariTab('penjualan-pos'), null))['pos_foto_rasio'] ?? '1/1') === '4/3' ? '4/3' : '1/1',
        },
      });
    }),
  );

  // --- Autocomplete POS Mode Cepat (/pos/cari) -----------------------------
  r.get(
    '/pos/cari',
    asyncHandler(async (req, res) => {
      const q = String(req.query.cari ?? '').trim().toLowerCase();
      const gudang = Number(req.query.gudang ?? 0);
      if (!q) return res.json({ data: [] });
      // Batas dinamis: ?batas=N dijepit 1–500 (bawaan 100) agar hasil
      // menyesuaikan jumlah barang di Master Data, bukan patokan 10.
      const batas = Math.min(
        BATAS_SARAN_MAKS,
        Math.max(1, Number.parseInt(String(req.query.batas ?? ''), 10) || BATAS_SARAN_BAWAAN),
      );

      // Escape karakter LIKE; % dan _ dari pengguna tetap literal (ESCAPE '\').
      const e = q.replace(/[\\%_]/g, (m) => `\\${m}`);
      const awal = `${e}%`;
      const kata = `% ${e}%`;
      const isi = `%${e}%`;

      // ISOLASI GUDANG — kandidat hanya produk yang teralokasi di gudang aktif.
      // Prioritas: gudang yang dipilih (?gudang=) → bila kosong, gudang yang
      // diizinkan sesi (non-Top). Admin tanpa pilihan gudang = tanpa batas.
      // ?berstok=1 (kasir POS) juga mensyaratkan qty <> 0 — barang yang
      // saldonya kosong di gudang itu tidak boleh muncul di kasir. Modul
      // Persediaan memakai jalur default (alokasi) agar barang baru yang masih
      // nol tetap bisa diisi stoknya.
      if (gudang > 0) await wajibGudangDiizinkan(req, gudang);
      const hanyaBerstok = ['1', 'true', 'ya'].includes(String(req.query.berstok ?? '').toLowerCase());
      const kondisiQty = hanyaBerstok ? 'sb.qty <> 0 AND ' : '';
      const gudangSaring = gudang > 0
        ? { sql: 'sb.warehouse_id IN (?)', params: [gudang] }
        : await syaratGudangSesi(req, 'sb.warehouse_id');
      const saringSql = gudangSaring.sql === '1 = 0'
        ? 'AND 1 = 0'
        : gudangSaring.sql
          ? `AND EXISTS (SELECT 1 FROM stock_balances sb WHERE sb.product_id = p.id AND ${kondisiQty}${gudangSaring.sql})`
          : '';
      const pSaring = gudangSaring.sql === '1 = 0' ? [] : gudangSaring.params;

      // Fase A: jalur indeks awalan. Fase B (kata/berisi) hanya bila kurang batas.
      const kandidat: BarisCari[] = [
        ...await all<BarisCari>(Q_CARI_SKU(batas, saringSql), ...pSaring, awal),
        ...await all<BarisCari>(Q_CARI_BARCODE(batas, saringSql), ...pSaring, awal),
        ...await all<BarisCari>(Q_CARI_NAMA(batas, saringSql), ...pSaring, awal),
        ...await all<BarisCari>(Q_CARI_KODE(batas, saringSql), ...pSaring, awal),
      ];
      if (kandidat.length < batas) {
        kandidat.push(...await all<BarisCari>(Q_CARI_BROAD(batas, saringSql), ...pSaring, kata, isi, isi, isi, isi, q, q, awal, awal, awal, awal, kata));
      }

      // Dedupe per produk, urutkan peringkat (lalu nama, SKU).
      const peta = new Map<number, BarisCari>();
      for (const row of kandidat) if (!peta.has(row.product_id)) peta.set(row.product_id, row);
      const terpilih = [...peta.values()]
        .sort(
          (a, b) => peringkatCari(a, q) - peringkatCari(b, q) ||
            a.nama.localeCompare(b.nama) || a.sku.localeCompare(b.sku),
        )
        .slice(0, batas);
      const terbatas = peta.size >= batas;

      // Stok hanya untuk produk terpilih (per gudang bila diminta).
      // Tanpa gudang: non-admin hanya melihat jumlah di gudang yang diizinkan.
      const lingkupCari = gudang > 0 ? { sql: '', params: [] as number[] } : await syaratGudangSesi(req, 'warehouse_id');
      const stok = new Map<number, number>();
      if (terpilih.length > 0 && lingkupCari.sql !== '1 = 0') {
        const ids = terpilih.map((row) => row.product_id);
        const baris = await all<{ product_id: number; stok: number }>(
          `SELECT product_id, COALESCE(SUM(qty), 0) AS stok FROM stock_balances
           WHERE product_id IN (${ids.map(() => '?').join(',')})${gudang > 0 ? ' AND warehouse_id = ?' : lingkupCari.sql ? ` AND ${lingkupCari.sql}` : ''}
           GROUP BY product_id`,
          ...(gudang > 0 ? [...ids, gudang] : [...ids, ...lingkupCari.params]),
        );
        for (const b of baris) stok.set(Number(b.product_id), Number(b.stok));
      }

      res.json({
        data: terpilih.map((row) => ({ ...row, harga: Number(row.harga ?? 0), stok: stok.get(row.product_id) ?? 0 })),
        batas,
        terbatas,
      });
    }),
  );

  // --- Shift kasir ----------------------------------------------------------
  r.get(
    '/pos/shift/aktif',
    asyncHandler(async (req, res) => {
      await pastikanSkemaPiutang();
      const s = await get<Record<string, unknown>>(`SELECT * FROM cashier_shifts WHERE tutup_pada IS NULL ORDER BY id DESC LIMIT 1`);
      if (!s) return res.json({ data: null });
      // ISOLASI GUDANG — ringkasan shift hanya dari penjualan gudang sesi.
      const lingShift = await syaratGudangSesi(req, 'sales.warehouse_id');
      const bShift = lingShift.sql ? ` AND ${lingShift.sql}` : '';
      const pShift = [...lingShift.params];
      const n = Number(
        await ((await get<{ n: number }>(`SELECT COUNT(*) AS n FROM sales WHERE shift_id = ? AND status = 'disahkan'${bShift}`, Number(s.id), ...pShift)))?.n ?? 0,
      );
      const total = Number(
        await ((await get<{ v: number }>(`SELECT COALESCE(SUM(total), 0) AS v FROM sales WHERE shift_id = ? AND status = 'disahkan'${bShift}`, Number(s.id), ...pShift)))?.v ?? 0,
      );
      const tunai = Number(
        await ((await get<{ v: number }>(
          `SELECT COALESCE(SUM(sp.jumlah), 0) AS v
           FROM sale_payments sp JOIN sales s2 ON s2.id = sp.sale_id
           WHERE s2.shift_id = ? AND s2.status = 'disahkan' AND sp.metode = 'tunai'${bShift.replaceAll('sales.warehouse_id', 's2.warehouse_id')}`,
          Number(s.id),
          ...pShift,
        )))?.v ?? 0,
      );
      // Pelunasan piutang TUNAI dari kasir pada shift ini ikut menambah laci.
      const tunaiPiutang = Number(
        await ((await get<{ v: number }>(
          `SELECT COALESCE(SUM(jumlah), 0) AS v FROM payments
            WHERE tipe = 'piutang' AND shift_id = ? AND metode = 'tunai'`,
          Number(s.id),
        )))?.v ?? 0,
      );
      res.json({
        data: {
          ...s,
          ringkasan: {
            jumlah_transaksi: n,
            penjualan: total,
            tunai,
            tunai_piutang: tunaiPiutang,
            penerimaan_tunai: tunai + tunaiPiutang,
          },
        },
      });
    }),
  );

  r.post(
    '/pos/shift/buka',
    asyncHandler(async (req, res) => {
      const kasAwal = Number((req.body as { kas_awal?: unknown })?.kas_awal ?? 0);
      if (!Number.isFinite(kasAwal) || kasAwal < 0) throw tolak(400, 'Kas awal tidak valid.');
      if (await shiftAktif()) throw tolak(409, 'Masih ada shift kasir aktif — tutup dulu.');
      const id = await withTransaction(async () => {
        const hasil = await run(`INSERT INTO cashier_shifts (user_id, kas_awal) VALUES (?, ?)`, await idKasir(), kasAwal);
        await catatAudit({ userId: await idKasir(), aksi: 'tambah', tabel: 'cashier_shifts', recordId: Number(hasil.lastInsertRowid), sesudah: { kas_awal: kasAwal } });
        return Number(hasil.lastInsertRowid);
      });
      res.status(201).json({ id, data: await get(`SELECT * FROM cashier_shifts WHERE id = ?`, id) });
    }),
  );

  r.post(
    '/pos/shift/tutup',
    asyncHandler(async (req, res) => {
      const fisik = Number((req.body as { kas_akhir_fisik?: unknown })?.kas_akhir_fisik ?? 0);
      if (!Number.isFinite(fisik) || fisik < 0) throw tolak(400, 'Hitungan kas fisik tidak valid.');
      await pastikanSkemaPiutang();
      const s = await shiftAktif();
      if (!s) throw tolak(404, 'Tidak ada shift kasir aktif.');
      // ISOLASI GUDANG — kas shift hanya dari penjualan gudang sesi.
      const lingTutup = await syaratGudangSesi(req, 's2.warehouse_id');
      const bTutup = lingTutup.sql ? ` AND ${lingTutup.sql}` : '';
      const tunai = Number(
        await ((await get<{ v: number }>(
          `SELECT COALESCE(SUM(sp.jumlah), 0) AS v
           FROM sale_payments sp JOIN sales s2 ON s2.id = sp.sale_id
           WHERE s2.shift_id = ? AND s2.status = 'disahkan' AND sp.metode = 'tunai'${bTutup}`,
          s.id,
          ...lingTutup.params,
        )))?.v ?? 0,
      );
      // Uang KELUAR dari laci pada shift ini: retur yang dikembalikan TUNAI
      // (tanpa piutang berjalan pada penjualan asli) mengurangi kas sistem —
      // sama dengan sisi kredit jurnal retur (Cr Kas Kasir).
      const returTunai = Number(
        await ((await get<{ v: number }>(
          `SELECT COALESCE(SUM(sr.total), 0) AS v
           FROM sale_returns sr
           JOIN sales s2 ON s2.id = sr.sale_id
           WHERE s2.shift_id = ? AND sr.status = 'disahkan'${bTutup}
             AND NOT EXISTS (
               SELECT 1 FROM receivables rc
               WHERE rc.sale_id = s2.id AND rc.status IN ('belum', 'sebagian'))`,
          s.id,
          ...lingTutup.params,
        )))?.v ?? 0,
      );
      // Penerimaan piutang tunai pada shift ini = uang masuk laci.
      const tunaiPiutang = Number(
        await ((await get<{ v: number }>(
          `SELECT COALESCE(SUM(jumlah), 0) AS v FROM payments
            WHERE tipe = 'piutang' AND shift_id = ? AND metode = 'tunai'`,
          s.id,
        )))?.v ?? 0,
      );
      const sistem = Number(s.kas_awal) + tunai + tunaiPiutang - returTunai;
      await withTransaction(async () => {
        await run(
          `UPDATE cashier_shifts SET tutup_pada = ?, kas_akhir_sistem = ?, kas_akhir_fisik = ? WHERE id = ?`,
          new Date().toISOString(),
          sistem,
          fisik,
          s.id,
        );
        // AKUNTANSI DASAR — tutup kasir TIDAK membuat jurnal. Selisih fisik
        // vs sistem tetap disimpan & diaudit pada shift, tanpa akun/buku besar.
        await catatAudit({
          userId: await idKasir(),
          aksi: 'ubah',
          tabel: 'cashier_shifts',
          recordId: s.id,
          sebelum: { kas_akhir_sistem: null, kas_akhir_fisik: null },
          sesudah: { kas_akhir_sistem: sistem, kas_akhir_fisik: fisik },
        });
      });
      res.json({
        id: s.id,
        kas_awal: Number(s.kas_awal),
        tunai,
        tunai_piutang: tunaiPiutang,
        retur_tunai: returTunai,
        kas_akhir_sistem: sistem,
        kas_akhir_fisik: fisik,
        selisih: fisik - sistem,
      });
    }),
  );

  // --- Transaksi tertahan (F8/F9) ------------------------------------------
  r.get(
    '/pos/held',
    asyncHandler(async (_req, res) => {
      const rows = await all<{ id: number; data_json: string; dibuat_pada: string }>(
        `SELECT id, data_json, dibuat_pada FROM held_sales ORDER BY id DESC LIMIT 50`,
      );
      res.json({
        data: rows.map((h) => {
          let data: unknown = null;
          try {
            data = JSON.parse(h.data_json);
          } catch {
            data = null;
          }
          return { id: h.id, dibuat_pada: h.dibuat_pada, data };
        }),
      });
    }),
  );

  r.post(
    '/pos/held',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as { data?: unknown; nama?: unknown };
      const data = body.data;
      if (!data || typeof data !== 'object' || !Array.isArray((data as { items?: unknown[] }).items) || (data as { items: unknown[] }).items.length === 0) {
        throw tolak(400, 'Data transaksi tertahan tidak valid.');
      }
      const id = Number(
        await ((await run(`INSERT INTO held_sales (kasir_id, data_json) VALUES (?, ?)`, await idKasir(), JSON.stringify({ nama: String(body.nama ?? ''), ...((data as object) as object) })))).lastInsertRowid,
      );
      res.status(201).json({ id });
    }),
  );

  r.delete(
    '/pos/held/:id',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const hasil = await run(`DELETE FROM held_sales WHERE id = ?`, id);
      if (!hasil.changes) throw tolak(404, 'Transaksi tertahan tidak ditemukan.');
      res.json({ ok: true });
    }),
  );

  // --- Saha penjualan: ATOMIK (stok + kartu stok + jurnal penjualan & HPP) --
  r.post(
    '/pos/sales',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as {
        items?: ItemMasuk[];
        diskon?: number;
        pajak_persen?: number;
        customer_id?: number | null;
        warehouse_id?: number;
        mode_pos?: string;
        payments?: BayarMasuk[];
        jatuh_tempo?: string | null;
        created_at?: string | null;
      };



      const siap = await hitungPenjualan(req, body);
      const { customerId, warehouseId, subtotal, diskonTotal, pajak, total, dibayar } = siap;

      const shift = await shiftAktif();
      if (!shift) throw tolak(409, 'Buka kasir dulu sebelum bertransaksi.');
      const kasir = await idKasir();

      const hasil = await withTransaction(async () => {
        const noDok = await nomorDokumen('SJ');
        const saleId = Number(
          await ((await run(
            `INSERT INTO sales (no_dokumen, tanggal, shift_id, kasir_id, customer_id, warehouse_id, mode_pos,
                                subtotal, diskon, pajak, total, status, dibuat_oleh)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'disahkan', ?)`,
            noDok,
            siap.tanggal,
            shift.id,
            kasir,
            customerId,
            warehouseId,
            siap.modePos,
            subtotal,
            diskonTotal,
            pajak,
            total,
            kasir,
          ))).lastInsertRowid,
        );

        await terapkanPenjualan(saleId, siap, kasir, noDok);

        await catatAudit({ userId: kasir, aksi: 'tambah', tabel: 'sales', recordId: saleId, sesudah: { no_dokumen: noDok, total, items: siap.rincian.length } });
        // BAGIAN I: faktur penjualan disusun otomatis saat transaksi disahkan.
        const faktur = await buatFakturPenjualan(saleId, kasir);
        return { id: saleId, no_dokumen: noDok, faktur };
      });

      const sale = (await get<Record<string, unknown>>(`SELECT * FROM sales WHERE id = ?`, hasil.id))!
      res.status(201).json({ ...hasil, data: sale, kembalian: Math.max(0, dibayar - total) });
    }),
  );

  // --- Riwayat (untuk void / retur / cetak ulang) --------------------------
  r.get(
    '/pos/sales',
    asyncHandler(async (req, res) => {
      const per = Math.min(100, Math.max(1, Number(req.query.per ?? 20) || 20));
      // R2 — filter periode tampil + tautan faktur (Riwayat & Dokumen Penjualan).
      const syarat: string[] = [];
      const argumen: unknown[] = [];
      const dari = String(req.query.dari ?? '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(dari)) {
        syarat.push('substr(s.tanggal, 1, 10) >= ?');
        argumen.push(dari);
      }
      const sampai = String(req.query.sampai ?? '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(sampai)) {
        syarat.push('substr(s.tanggal, 1, 10) <= ?');
        argumen.push(sampai);
      }
      // ISOLASI GUDANG — riwayat tanpa filter hanya mencakup gudang sesi;
      // filter eksplisit di luar cakupan ditolak 403.
      if (req.query.gudang) {
        const gudangMinta = Number(req.query.gudang);
        await wajibGudangDiizinkan(req, gudangMinta);
        syarat.push('s.warehouse_id = ?');
        argumen.push(gudangMinta);
      } else {
        const lingkup = await syaratGudangSesi(req, 's.warehouse_id');
        if (lingkup.sql) {
          syarat.push(lingkup.sql);
          argumen.push(...lingkup.params);
        }
      }
      const where = syarat.length ? `WHERE ${syarat.join(' AND ')}` : '';
      const rows = await all<Record<string, unknown>>(
        `SELECT s.id, s.no_dokumen, s.tanggal, s.subtotal, s.diskon, s.pajak, s.total, s.status,
                COALESCE((SELECT SUM(si.qty) FROM sale_items si WHERE si.sale_id = s.id), 0) AS total_qty,
                /* NET SALES — retur DISAHKAN mengurangi qty & nominal yang disajikan.
                   Nilai asli header (total_qty / total) TIDAK diubah agar audit trail
                   transaksi awal tetap utuh. */
                COALESCE((SELECT SUM(sri.qty) FROM sale_return_items sri
                          JOIN sale_returns sr ON sr.id = sri.return_id
                          WHERE sr.sale_id = s.id AND sr.status = 'disahkan'), 0) AS qty_retur,
                COALESCE((SELECT SUM(sr.total) FROM sale_returns sr
                          WHERE sr.sale_id = s.id AND sr.status = 'disahkan'), 0) AS total_retur,
                CASE WHEN EXISTS (SELECT 1 FROM sale_returns sr
                                   WHERE sr.sale_id = s.id AND sr.status = 'disahkan')
                     THEN 1 ELSE 0 END AS has_return,
                COALESCE((SELECT SUM(si.qty) FROM sale_items si WHERE si.sale_id = s.id), 0)
                  - COALESCE((SELECT SUM(sri.qty) FROM sale_return_items sri
                              JOIN sale_returns sr ON sr.id = sri.return_id
                              WHERE sr.sale_id = s.id AND sr.status = 'disahkan'), 0) AS total_qty_net,
                s.total - COALESCE((SELECT SUM(sr.total) FROM sale_returns sr
                                    WHERE sr.sale_id = s.id AND sr.status = 'disahkan'), 0) AS total_net,
                c.nama AS pelanggan, c.telepon AS pelanggan_telepon, u.nama AS kasir,
                (SELECT GROUP_CONCAT(DISTINCT sp.metode) FROM sale_payments sp WHERE sp.sale_id = s.id) AS metode,
                (SELECT i.id FROM invoices i WHERE i.sumber_tipe = 'penjualan' AND i.sumber_id = s.id ORDER BY i.id DESC LIMIT 1) AS faktur_id,
                (SELECT i.no_faktur FROM invoices i WHERE i.sumber_tipe = 'penjualan' AND i.sumber_id = s.id ORDER BY i.id DESC LIMIT 1) AS no_faktur
         FROM sales s
         LEFT JOIN customers c ON c.id = s.customer_id
         LEFT JOIN users u ON u.id = s.kasir_id
         ${where}
         ORDER BY s.id DESC
         LIMIT ?`,
        ...argumen,
        per,
      );
      res.json({ data: rows });
    }),
  );

  r.get(
    '/pos/sales/:id',
    asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const sale = await get<Record<string, unknown>>(
      `SELECT s.*, c.nama AS pelanggan, c.telepon AS pelanggan_telepon
         FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE s.id = ?`,
      id,
    );
    if (!sale) throw tolak(404, 'Penjualan tidak ditemukan.');
    // ISOLASI GUDANG — detail dokumen gudang lain tidak bisa dibuka langsung.
    await wajibGudangDiizinkan(req, Number(sale.warehouse_id));
      // Snapshot nama/SKU pada baris transaksi — tanpa JOIN ke master.
      // qty_retur = akumulasi qty yang sudah diretur (hanya retur DISAHKAN),
      // dipakai modal Detail Penjualan untuk kolom Qty Retur / Qty Net.
      const items = await all<Record<string, unknown>>(
        `SELECT si.product_id, si.nama_produk, si.sku, si.qty, si.harga, si.diskon, si.subtotal, si.hpp,
                COALESCE((SELECT SUM(sri.qty) FROM sale_return_items sri
                          JOIN sale_returns sr ON sr.id = sri.return_id
                          WHERE sr.sale_id = si.sale_id AND sr.status = 'disahkan'
                            AND sri.product_id = si.product_id), 0) AS qty_retur
         FROM sale_items si
         WHERE si.sale_id = ?`,
        id,
      );
      const payments = await all<Record<string, unknown>>(`SELECT metode, jumlah, referensi FROM sale_payments WHERE sale_id = ?`, id);
      const retur = await all<Record<string, unknown>>(`SELECT id, no_dokumen, tanggal, total, status FROM sale_returns WHERE sale_id = ?`, id);
      res.json({ data: { ...sale, items, payments, retur } });
    }),
  );

  // --- Token Edit: ubah penjualan yang sudah disahkan ---------------------
  // Seluruh data transaksi (item, qty, harga, pelanggan, metode bayar) dimuat
  // ulang ke form kasir. Saat disimpan, server merekonsiliasi:
  //   stok (balik qty lama → potong qty baru), kas (mutasi lama dibalik, baru
  //   dicatat ulang), piutang kredit, dan snapshot faktur. Semua atomik.
  r.put(
    '/pos/sales/:id',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const body = (req.body ?? {}) as {
        items?: ItemMasuk[];
        diskon?: number;
        pajak_persen?: number;
        customer_id?: number | null;
        warehouse_id?: number;
        payments?: BayarMasuk[];
        jatuh_tempo?: string | null;
      };
      const lama = await get<{ id: number; status: string; no_dokumen: string; tanggal: string; warehouse_id: number }>(
        `SELECT id, status, no_dokumen, tanggal, warehouse_id FROM sales WHERE id = ?`,
        id,
      );
      if (!lama) throw tolak(404, 'Penjualan tidak ditemukan.');
      // Edit = sel Ubah pada Penjualan + Hak Khusus "Hapus transaksi".
      await wajibSel(req, 'penjualan', 'ubah');
      wajibKelolaTransaksi(req, 'edit');
      await wajibGudangDiizinkan(req, Number(lama.warehouse_id));
      if (lama.status !== 'disahkan') throw tolak(409, 'Hanya penjualan disahkan yang bisa diedit.');

      const adaRetur = await get<{ id: number }>(
        `SELECT id FROM sale_returns WHERE sale_id = ? AND status = 'disahkan' LIMIT 1`,
        id,
      );
      if (adaRetur) {
        throw tolak(409, 'Penjualan ini sudah diretur — edit ditolak agar qty retur tidak bentrok. Batalkan retur terlebih dahulu.');
      }
      const piutang = await get<{ terbayar: number }>(`SELECT terbayar FROM receivables WHERE sale_id = ?`, id);
      if (piutang && Number(piutang.terbayar) > 0) {
        throw tolak(409, `Edit ditolak: piutang transaksi ini sudah dibayar Rp ${Number(piutang.terbayar)}. Batalkan pelunasan dulu.`);
      }

      const siap = await hitungPenjualan(req, body);
      // Tanggal asli dipertahankan — edit tidak memindahkan transaksi antar periode.
      siap.tanggal = String(lama.tanggal);
      const kasir = await idKasir();
      const lamaItems = await all<{ product_id: number; qty: number; hpp: number }>(
        `SELECT product_id, qty, hpp FROM sale_items WHERE sale_id = ?`,
        id,
      );

      // Seluruh efek edit atomik; kegagalan apa pun → ROLLBACK penuh.
      const jalankanEdit = async () => withTransaction(async () => {
        // Trigger fn_sales_disahkan_terkunci menolak UPDATE baris 'disahkan'.
        // Penanda SET LOCAL ini (hanya berlaku di transaksi ini dan tidak bisa
        // dikirim dari klien) membuka jalur edit resmi — lihat
        // pg-migrations/007_edit_penjualan_pg.sql.
        await run(`SET LOCAL nusapos.edit_penjualan = 'on'`);

        // 1) Stok lama kembali ke gudang asal (kartu stok ikut).
        for (const it of lamaItems) {
          const qty = Number(it.qty);
          if (!(qty > 0)) continue;
          await ubahStok({
            productId: Number(it.product_id),
            warehouseId: Number(lama.warehouse_id),
            masuk: qty,
            hargaMasuk: Number(it.hpp) > 0 ? Number(it.hpp) / qty : undefined,
            tipeDokumen: 'penjualan',
            dokumenId: id,
            userId: kasir,
          });
        }
        // 2) Kas lama DIHAPUS (bukan dibalik dengan mutasi berlawanan). Mutasi
        // kas adalah data turunan penjualan: baris balik bertanda sumber yang
        // sama akan ikut terbalik lagi pada edit berikutnya sehingga kas bisa
        // berlipat. Setelah ini terapkanPenjualan() memposting ulang.
        await run(
          `DELETE FROM cash_transactions WHERE sumber_tipe = 'penjualan' AND sumber_id = ?`,
          id,
        );
        await run(`DELETE FROM sale_items WHERE sale_id = ?`, id);
        await run(`DELETE FROM sale_payments WHERE sale_id = ?`, id);
        await run(`DELETE FROM receivables WHERE sale_id = ?`, id);

        // 3) Header diperbarui, lalu seluruh efek baru ditulis ulang.
        await run(
          `UPDATE sales SET tanggal = ?, customer_id = ?, warehouse_id = ?, mode_pos = ?,
                  subtotal = ?, diskon = ?, pajak = ?, total = ?, diubah_pada = ?
           WHERE id = ?`,
          siap.tanggal,
          siap.customerId,
          siap.warehouseId,
          siap.modePos,
          siap.subtotal,
          siap.diskonTotal,
          siap.pajak,
          siap.total,
          new Date().toISOString(),
          id,
        );
        await terapkanPenjualan(id, siap, kasir, lama.no_dokumen);

        await catatAudit({
          userId: kasir,
          aksi: 'ubah',
          tabel: 'sales',
          recordId: id,
          sebelum: { no_dokumen: lama.no_dokumen, status: lama.status },
          sesudah: { total: siap.total, items: siap.rincian.length, mode_pos: siap.modePos },
          alasan: 'Edit transaksi (Token Edit)',
        });
        // Faktur sumber ikut disegarkan (nomor faktur tetap).
        await buatFakturPenjualan(id, kasir, { perbarui: true });
      });

      try {
        await jalankanEdit();
      } catch (err) {
        // Log detail (dokumen + stack) agar query yang gagal bisa diisolasi;
        // klien tetap menerima pesan yang bisa ditindak, bukan 500 generik.
        console.error(
          `[pos.sales.edit] gagal id=${id} no=${lama.no_dokumen}`,
          err instanceof Error ? (err.stack ?? err.message) : err,
        );
        const kode = (err as { code?: string } | null)?.code ?? '';
        if (kode === 'P0001') {
          throw tolak(
            409,
            'Penjualan terkunci oleh aturan database (trigger). Jalankan migrasi pg-migrations/007_edit_penjualan_pg.sql lalu coba lagi.',
          );
        }
        if (kode === '23503') {
          throw tolak(409, 'Data terkait sudah dihapus (produk/pelanggan/gudang/pengguna). Perbaiki dulu data master sebelum mengedit.');
        }
        if (kode === '23502') {
          throw tolak(400, 'Ada kolom wajib yang kosong pada transaksi ini. Periksa pelanggan dan gudang.');
        }
        if (kode === '22P02' || kode === '22003' || kode === '22007') {
          throw tolak(400, 'Nilai angka atau tanggal pada transaksi tidak valid. Periksa qty, harga, dan diskon.');
        }
        throw err;
      }

      res.json({ ok: true, id, no_dokumen: lama.no_dokumen });
    }),
  );

  // --- Void (Admin + password): balik stok + batalkan transaksi -----------
  r.post(
    '/pos/sales/:id/void',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const body = (req.body ?? {}) as { sandi?: unknown; alasan?: unknown };
      // Verifikasi dilakukan setelah sale, izin, dan cakupan gudang divalidasi.
      const sale = await get<{ id: number; status: string; no_dokumen: string; warehouse_id: number }>(
        `SELECT id, status, no_dokumen, warehouse_id FROM sales WHERE id = ?`,
        id,
      );
      if (!sale) throw tolak(404, 'Penjualan tidak ditemukan.');
      // Void = sel Hapus pada Penjualan, cakupan gudang, dan password Admin.
      // Seluruh validasi (termasuk password) selesai SEBELUM BEGIN: query yang
      // gagal di dalam transaksi akan meng-abort seluruh blok PostgreSQL.
      await wajibSel(req, 'penjualan', 'hapus');
      await wajibGudangDiizinkan(req, sale.warehouse_id);
      await verifikasiAdmin(req, body.sandi);
      if (sale.status !== 'disahkan') throw tolak(409, 'Hanya penjualan disahkan yang bisa di-void.');
      const kasir = await idKasir();

      await withTransaction(async () => {
        // Kunci baris: dua permintaan void bersamaan tidak boleh sama-sama lolos
        // (void kedua akan menghapus stok dua kali).
        const kunci = await get<{ status: string }>('SELECT status FROM sales WHERE id = ? FOR UPDATE', id);
        if (!kunci) throw tolak(404, 'Penjualan tidak ditemukan.');
        if (kunci.status !== 'disahkan') {
          throw tolak(409, 'Penjualan ini sudah dibatalkan. Muat ulang daftar riwayat.');
        }
        // Item dibaca SETELAH baris dikunci supaya qty/HPP yang dibalik pasti
        // milik versi terakhir dokumen.
        const items = await all<{ product_id: number; qty: number; hpp: number }>(
          `SELECT product_id, qty, hpp FROM sale_items WHERE sale_id = ?`,
          id,
        );
        for (const it of items) {
          await ubahStok({
            productId: it.product_id,
            warehouseId: sale.warehouse_id,
            masuk: it.qty,
            hargaMasuk: it.qty > 0 ? it.hpp / it.qty : undefined,
            tipeDokumen: 'penjualan',
            dokumenId: id,
            userId: kasir,
          });
        }
        await catatAudit({
          userId: kasir,
          aksi: 'batal',
          tabel: 'sales',
          recordId: id,
          sebelum: { status: 'disahkan' },
          sesudah: { status: 'dihapus_permanen' },
          alasan: body.alasan ? String(body.alasan) : 'Void POS',
        });

        // Kebijakan No Retain: penjualan yang di-void tidak disimpan sebagai
        // log "batal". Header, detail, pembayaran, piutang, mutasi kas, dan
        // kartu stoknya dihapus permanen. Peran stok sudah dibalik di atas.
        await hapusPenjualanPermanen(id);
      });
      res.json({ ok: true, no_dokumen: sale.no_dokumen });
    }),
  );

  // --- Retur (Admin + password): stok masuk + catat retur -----------------
  r.post(
    '/pos/sales/:id/retur',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const body = (req.body ?? {}) as { sandi?: unknown; alasan?: unknown; items?: { product_id: number; qty: number }[] };
      // Verifikasi password Admin dilakukan setelah sale, izin, dan gudang tervalidasi.
      const sale = await get<{ id: number; status: string; warehouse_id: number; no_dokumen: string }>(
        `SELECT id, status, warehouse_id, no_dokumen FROM sales WHERE id = ?`,
        id,
      );
      if (!sale) throw tolak(404, 'Penjualan tidak ditemukan.');
      // Retur = sel Tambah pada Penjualan, cakupan gudang, dan password Admin.
      await wajibSel(req, 'penjualan', 'tambah');
      await wajibGudangDiizinkan(req, sale.warehouse_id);
      await verifikasiAdmin(req, body.sandi);
      if (sale.status !== 'disahkan') throw tolak(409, 'Hanya penjualan disahkan yang bisa diretur.');

      const minta = Array.isArray(body.items) ? body.items : [];
      if (minta.length === 0) throw tolak(400, 'Pilih item yang diretur.');

      const kasir = await idKasir();

      const hasil = await withTransaction(async () => {
        // Kunci baris penjualan: qty retur dihitung terhadap versi dokumen yang
        // tidak berubah selama transaksi (cegah dua retur paralel melebihi qty).
        const kunci = await get<{ status: string }>('SELECT status FROM sales WHERE id = ? FOR UPDATE', id);
        if (!kunci) throw tolak(404, 'Penjualan tidak ditemukan.');
        if (kunci.status !== 'disahkan') {
          throw tolak(409, 'Status penjualan sudah berubah. Muat ulang daftar riwayat.');
        }
        // Validasi: qty retur ≤ qty terjual − qty yang sudah diretur.
        // Permintaan digabung per produk lebih dulu supaya produk yang dikirim
        // dua kali tidak lolos validasi qty maupun menambah stok dua kali.
        const mintaPerProduk = new Map<number, number>();
        for (const m of minta) {
          const productId = Number(m.product_id);
          const qty = Number(m.qty);
          if (!Number.isInteger(productId) || productId <= 0) continue;
          if (!Number.isFinite(qty) || qty <= 0) continue;
          mintaPerProduk.set(productId, (mintaPerProduk.get(productId) ?? 0) + qty);
        }
        let totalRetur = 0;
        const rincian: { productId: number; qty: number; harga: number; hpp: number; nama: string; sku: string }[] = [];
        for (const [productId, qty] of mintaPerProduk) {
          // Produk yang sama bisa muncul di beberapa baris penjualan — jumlahkan
          // qty/HPP-nya agar sisa yang boleh diretur dihitung benar.
          const it = await get<{ qty: number; harga: number; hpp: number; nama_produk: string; sku: string }>(
            `SELECT SUM(qty) AS qty, MAX(harga) AS harga, SUM(hpp) AS hpp,
                    MAX(nama_produk) AS nama_produk, MAX(sku) AS sku
             FROM sale_items WHERE sale_id = ? AND product_id = ?`,
            id,
            productId,
          );
          if (!it || Number(it.qty) <= 0) throw tolak(400, 'Item bukan bagian penjualan ini.');
          const sudah = Number(
            await ((await get<{ v: number }>(
              `SELECT COALESCE(SUM(sri.qty), 0) AS v
               FROM sale_return_items sri JOIN sale_returns sr ON sr.id = sri.return_id
               WHERE sr.sale_id = ? AND sri.product_id = ? AND sr.status = 'disahkan'`,
              id,
              productId,
            )))?.v ?? 0,
          );
          const sisa = Number(it.qty) - sudah;
          if (qty > sisa) throw tolak(409, `Retur melebihi sisa terjual (${sisa}) untuk produk ini.`);
          const harga = Number(it.harga);
          const hppPer = Number(it.qty) > 0 ? Number(it.hpp) / Number(it.qty) : 0;
          totalRetur += qty * harga;
          rincian.push({ productId, qty, harga, hpp: Math.round(qty * hppPer), nama: it.nama_produk, sku: it.sku });
        }
        if (rincian.length === 0) throw tolak(400, 'Tidak ada item valid untuk diretur.');

        const noRet = await nomorDokumen('RET');
        const returId = Number(
          await ((await run(
            `INSERT INTO sale_returns (no_dokumen, sale_id, tanggal, alasan, total, status, dibuat_oleh)
             VALUES (?, ?, ?, ?, ?, 'disahkan', ?)`,
            noRet,
            id,
            new Date().toISOString(),
            body.alasan ? String(body.alasan) : null,
            totalRetur,
            kasir,
          ))).lastInsertRowid,
        );

        for (const it of rincian) {
          await run(
            `INSERT INTO sale_return_items (return_id, product_id, nama_produk, sku, qty, harga) VALUES (?, ?, ?, ?, ?, ?)`,
            returId,
            it.productId,
            it.nama,
            it.sku,
            it.qty,
            it.harga,
          );
          await ubahStok({
            productId: it.productId,
            warehouseId: sale.warehouse_id,
            masuk: it.qty,
            hargaMasuk: it.qty > 0 ? it.hpp / it.qty : undefined,
            tipeDokumen: 'retur',
            dokumenId: returId,
            userId: kasir,
          });
        }

        const hppRetur = rincian.filter((it) => it.hpp > 0);
        void hppRetur;
        // AR SYNC + KAS — retur adalah PENGURANG tagihan. Piutang berjalan
        // dipotong lebih dulu; bila penjualan sudah lunas/tunai (tidak ada
        // sisa tagihan) atau nilai retur melebihi sisa, kelebihan itu
        // dikembalikan sebagai Kas Keluar agar arus kas kasir tetap benar.
        // Semua langkah ada di transaksi yang sama (atomik bersama stok).
        const piutang = await get<{ id: number; total: number; terbayar: number }>(
          `SELECT id, total, terbayar FROM receivables
            WHERE sale_id = ? AND status IN ('belum', 'sebagian')`,
          id,
        );
        let sisaRefund = totalRetur;
        if (piutang) {
          const sisaTagihan = Math.max(0, Number(piutang.total) - Number(piutang.terbayar));
          const dipotong = Math.min(sisaTagihan, sisaRefund);
          if (dipotong > 0) {
            const totalBaru = Number(piutang.total) - dipotong;
            const terbayarBaru = Number(piutang.terbayar);
            const statusBaru =
              terbayarBaru >= totalBaru - 0.5 ? 'lunas' : terbayarBaru > 0 ? 'sebagian' : 'belum';
            await run(`UPDATE receivables SET total = ?, status = ? WHERE id = ?`, totalBaru, statusBaru, piutang.id);
            sisaRefund -= dipotong;
          }
        }
        if (sisaRefund > 0) {
          const akunKasRetur = await akunKasMetode('tunai');
          if (akunKasRetur) {
            await catatMutasiKas({
              tipe: 'keluar',
              akunId: akunKasRetur.id,
              jumlah: sisaRefund,
              keterangan: `Retur penjualan ${sale.no_dokumen} → ${noRet}`,
              sumberTipe: 'retur',
              sumberId: returId,
              dibuatOleh: kasir,
            });
          }
        }

        await catatAudit({ userId: kasir, aksi: 'tambah', tabel: 'sale_returns', recordId: returId, sesudah: { no_dokumen: noRet, total: totalRetur } });
        return { id: returId, no_dokumen: noRet, total: totalRetur };
      });

      res.status(201).json(hasil);
    }),
  );

  // --- Daftar retur penjualan (tab Retur di halaman /penjualan/retur) -----
  // `items` = rincian barang retur (dipakai kolom "Rincian Barang" & modal
  // Detail). Diambil dengan satu kueri tambahan yang portabel (tanpa fungsi
  // JSON khusus PostgreSQL) lalu dikelompokkan per id retur.
  r.get(
    '/pos/returns',
    asyncHandler(async (req, res) => {
      const per = Math.min(100, Math.max(1, Number(req.query.per ?? 50) || 50));
      const rows = await all<Record<string, unknown>>(
        `SELECT sr.id, sr.no_dokumen, sr.tanggal, sr.alasan, sr.total, sr.status,
                s.no_dokumen AS no_penjualan, s.id AS sale_id, c.nama AS pelanggan, u.nama AS kasir
         FROM sale_returns sr
         JOIN sales s ON s.id = sr.sale_id
         LEFT JOIN customers c ON c.id = s.customer_id
         LEFT JOIN users u ON u.id = sr.dibuat_oleh
         ORDER BY sr.id DESC
         LIMIT ?`,
        per,
      );

      const ids = rows.map((x) => Number(x.id));
      const itemRows = ids.length
        ? await all<Record<string, unknown>>(
            `SELECT return_id, nama_produk, sku, qty, harga
               FROM sale_return_items
              WHERE return_id IN (${ids.map(() => '?').join(',')})
              ORDER BY id`,
            ...ids,
          )
        : [];
      const petaItem = new Map<number, Record<string, unknown>[]>();
      for (const it of itemRows) {
        const rid = Number(it.return_id);
        const daftar = petaItem.get(rid) ?? [];
        const qty = Number(it.qty ?? 0);
        const harga = Number(it.harga ?? 0);
        daftar.push({
          product_name: String(it.nama_produk ?? ''),
          sku: String(it.sku ?? ''),
          qty_returned: qty,
          unit_price: harga,
          subtotal: qty * harga,
        });
        petaItem.set(rid, daftar);
      }

      res.json({ data: rows.map((x) => ({ ...x, items: petaItem.get(Number(x.id)) ?? [] })) });
    }),
  );

  // --- Pelunasan piutang DARI KASIR (tunai / transfer) ---------------------
  // Kasir hanya butuh sel Tambah pada modul Penjualan/POS — bukan modul
  // Akuntansi. Efeknya sama dengan /api/akuntansi/piutang/:id/bayar: sisa
  // piutang berkurang, status menjadi 'lunas' saat habis, kas & bank bergerak,
  // dan bila tunai nominalnya masuk ringkasan shift kasir aktif.
  r.post(
    '/pos/piutang/:id/catat',
    asyncHandler(async (req, res) => {
      await wajibSel(req, 'penjualan', 'tambah');
      await pastikanSkemaPiutang();
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) throw tolak(400, 'Tagihan piutang tidak valid.');
      const b = (req.body ?? {}) as Record<string, unknown>;
      const jumlah = Math.round(Number(b.jumlah) || 0);
      if (!(jumlah > 0)) throw tolak(400, 'Nominal pembayaran harus lebih dari 0.');
      const metode = String(b.metode ?? 'tunai') === 'transfer' ? 'transfer' : 'tunai';
      const akun = await akunKasMetode(metode);
      if (!akun) {
        throw tolak(
          409,
          `Metode bayar "${metode}" belum ditautkan ke rekening Kas & Bank. Tautkan dulu di Pengaturan ▸ Kas & Bank.`,
        );
      }
      const pengguna = { id: konteksWajib(req).userId };
      const shift = await shiftAktif();
      const hasil = await withTransaction(async () => {
        const row = await get<{
          id: number;
          total: number;
          terbayar: number;
          status: string;
          no_dokumen: string;
          pelanggan: string | null;
          warehouse_id: number;
        }>(
          `SELECT rc.id, rc.total, rc.terbayar, rc.status, s.no_dokumen,
                  c.nama AS pelanggan, s.warehouse_id
             FROM receivables rc JOIN sales s ON s.id = rc.sale_id
             LEFT JOIN customers c ON c.id = rc.customer_id
            WHERE rc.id = ?`,
          id,
        );
        if (!row) throw tolak(404, 'Tagihan piutang tidak ditemukan.');
        await wajibGudangDiizinkan(req, Number(row.warehouse_id));
        if (row.status === 'lunas') throw tolak(409, 'Tagihan ini sudah lunas.');
        if (row.status === 'batal') throw tolak(409, 'Tagihan ini dibatalkan.');
        const sisa = Number(row.total) - Number(row.terbayar);
        if (jumlah > sisa + 0.5) {
          throw tolak(400, `Nominal melebihi sisa piutang (Rp ${Math.round(sisa).toLocaleString('id-ID')}).`);
        }
        const terbayarBaru = Number(row.terbayar) + jumlah;
        const statusBaru = terbayarBaru >= Number(row.total) - 0.5 ? 'lunas' : 'sebagian';
        await run(
          `UPDATE receivables SET terbayar = ?, status = ?, diubah_pada = now() WHERE id = ?`,
          terbayarBaru,
          statusBaru,
          id,
        );
        const bayarId = Number(
          await ((await run(
            `INSERT INTO payments (tipe, referensi_id, tanggal, jumlah, akun_kas_id, dibuat_oleh, shift_id, metode)
             VALUES ('piutang', ?, CURRENT_DATE, ?, ?, ?, ?, ?)`,
            id,
            jumlah,
            akun.id,
            pengguna.id,
            shift?.id ?? null,
            metode,
          ))).lastInsertRowid,
        );
        await catatMutasiKas({
          tipe: 'masuk',
          akunId: akun.id,
          jumlah,
          keterangan: `Pelunasan piutang ${row.no_dokumen}${row.pelanggan ? ` — ${row.pelanggan}` : ''}`,
          sumberTipe: 'pembayaran',
          sumberId: bayarId,
          dibuatOleh: pengguna.id,
        });
        await catatAudit({
          userId: pengguna.id,
          aksi: 'ubah',
          tabel: 'receivables',
          recordId: id,
          sesudah: { terbayar: terbayarBaru, status: statusBaru, metode, jumlah },
        });
        return {
          ok: true,
          id: bayarId,
          status: statusBaru,
          terbayar: terbayarBaru,
          sisa: Math.max(0, Number(row.total) - terbayarBaru),
          tunai: metode === 'tunai',
          shift_id: shift?.id ?? null,
        };
      });
      res.status(201).json(hasil);
    }),
  );

  // --- Daftar piutang penjualan (tab Piutang di halaman /penjualan/piutang) ---
  r.get(
    '/pos/receivables',
    asyncHandler(async (req, res) => {
      const per = Math.min(100, Math.max(1, Number(req.query.per ?? 50) || 50));
      const rows = await all<Record<string, unknown>>(
        `SELECT rc.id, rc.jatuh_tempo, rc.total, rc.terbayar, rc.status,
                s.no_dokumen, s.tanggal, c.nama AS pelanggan,
                c.id AS customer_id, c.telepon AS pelanggan_telepon,
                (rc.total - rc.terbayar) AS sisa
         FROM receivables rc
         JOIN sales s ON s.id = rc.sale_id
         LEFT JOIN customers c ON c.id = rc.customer_id
         ORDER BY CASE WHEN rc.status = 'lunas' THEN 1 ELSE 0 END,
                  rc.jatuh_tempo ASC, rc.id DESC
         LIMIT ?`,
        per,
      );
      res.json({ data: rows });
    }),
  );

  return r;
}

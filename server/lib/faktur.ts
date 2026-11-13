// BAGIAN I — Pembuatan faktur otomatis.
//
// Faktur dibuat saat transaksi disahkan:
//   • penjualan POS  → saat sale disahkan (server/routes/pos.ts)
//   • pembelian/GRN  → saat pembelian disahkan (server/routes/pembelian.ts),
//                      termasuk dokumen yang lahir dari mode Chatbot.
//
// Nomor urut otomatis memakai prefix dari Pengaturan
// (faktur_prefix_penjualan = INV → INV-2026-0001, faktur_prefix_pembelian = PB
//  → PB-2026-0001) dan mengikuti tahun tanggal dokumen.
//
// Isi faktur disimpan sebagai snapshot (data_json) sehingga dokumen bisa
// dibuka ulang dari Daftar Dokumen walau data sumber berubah.
import { all, get, getSettings, run, type Row } from '../db.pg.ts';
import { nomorOtomatis } from './pengaturanBaru.ts';

export interface ItemFaktur {
  kode: string;
  nama: string;
  qty: number;
  satuan: string | null;
  harga: number;
  diskon: number;
  subtotal: number;
}

export interface TokoFaktur {
  nama: string;
  alamat: string | null;
  telepon: string | null;
  logo: string | null;
}

export type JenisFaktur = 'penjualan' | 'pembelian';

/** Identitas toko dari Pengaturan (dipakai kop faktur). */
export async function dataToko(): Promise<TokoFaktur> {
  const s = await getSettings();
  return {
    nama: s['nama_usaha']?.trim() || 'Toko Retail',
    alamat: s['alamat_usaha']?.trim() || null,
    telepon: s['telepon_usaha']?.trim() || null,
    logo: s['logo_usaha']?.trim() || null,
  };
}

/** Template bawaan untuk satu jenis dokumen (dipakai generasi & fallback). */
export async function templateBawaan(jenis: JenisFaktur | 'surat_jalan'): Promise<Row | undefined> {
  return await get<Row>(`SELECT * FROM invoice_templates WHERE jenis = ? AND bawaan = TRUE`, jenis);
}

// --- Terbilang (opsional pada faktur) -------------------------------------

const ANGKA = [
  '', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan',
  'sepuluh', 'sebelas',
];

/** 1500000 → "satu juta lima ratus ribu rupiah". */
export function terbilang(nilai: number): string {
  const n = Math.floor(Math.abs(nilai));
  if (n === 0) return 'nol';
  const tulis = (x: number): string => {
    if (x < 12) return ANGKA[x];
    if (x < 20) return `${tulis(x - 10)} belas`;
    if (x < 100) return `${tulis(Math.floor(x / 10))} puluh${x % 10 ? ` ${tulis(x % 10)}` : ''}`;
    if (x < 200) return `seratus${x % 100 ? ` ${tulis(x % 100)}` : ''}`;
    if (x < 1000) return `${tulis(Math.floor(x / 100))} ratus${x % 100 ? ` ${tulis(x % 100)}` : ''}`;
    if (x < 2000) return `seribu${x % 1000 ? ` ${tulis(x % 1000)}` : ''}`;
    if (x < 1e6) return `${tulis(Math.floor(x / 1000))} ribu${x % 1000 ? ` ${tulis(x % 1000)}` : ''}`;
    if (x < 1e9) return `${tulis(Math.floor(x / 1e6))} juta${x % 1e6 ? ` ${tulis(x % 1e6)}` : ''}`;
    return `${tulis(Math.floor(x / 1e9))} miliar${x % 1e9 ? ` ${tulis(x % 1e9)}` : ''}`;
  };
  return `${tulis(n)} rupiah`;
}

// --- Pembuatan --------------------------------------------------------------

interface SumberFaktur {
  jenis: JenisFaktur;
  sumberTipe: string;
  sumberId: number;
  tanggal: string; // ISO
  noDokumen: string;
  pihak: { nama: string | null; telepon: string | null; alamat: string | null };
  items: ItemFaktur[];
  subtotal: number;
  diskon: number;
  pajakPersen: number;
  pajak: number;
  total: number;
  catatan?: string | null;
  sumber: Record<string, unknown>;
  userId: number | null;
}

/** Nomor faktur: PREFIX-TAHUN-0001 (prefix dari Pengaturan). */
async function nomorFaktur(jenis: JenisFaktur, tanggal: string): Promise<string> {
  // Nomor faktur mengikuti Pengaturan ▸ Penomoran Dokumen. Dengan nilai
  // bawaan hasilnya sama persis dengan perilaku lama (PREFIX-TAHUN-URUT).
  return await nomorOtomatis(jenis === 'penjualan' ? 'penjualan' : 'faktur_pembelian', tanggal);
}

/**
 * Simpan faktur — idempoten: satu dokumen sumber hanya menghasilkan satu
 * faktur. Mengembalikan faktur yang sudah ada bila sudah pernah dibuat.
 */
export async function simpanFaktur(
  s: SumberFaktur,
  opsi: { perbarui?: boolean } = {},
): Promise<{ id: number; no_faktur: string }> {
  const lama = await get<{ id: number; no_faktur: string; data_json: string }>(
    `SELECT id, no_faktur, data_json FROM invoices WHERE sumber_tipe = ? AND sumber_id = ?`,
    s.sumberTipe,
    s.sumberId,
  );
  if (lama) {
    // Jaga-jaga: id dokumen sumber bisa dipakai ulang setelah dokumen lama
    // dihapus (mis. data uji). Bila nomor dokumennya berbeda, faktur lama
    // sudah basi — ganti dengan yang baru.
    let noLama: string | null = null;
    try {
      noLama = String((JSON.parse(String(lama.data_json ?? '{}')) as { sumber?: { no_dokumen?: string } }).sumber?.no_dokumen ?? '');
    } catch {
      noLama = '';
    }
    if (noLama === s.noDokumen) {
      // Edit transaksi — faktur tetap nomornya, isi snapshot disegarkan.
      if (!opsi.perbarui) return { id: Number(lama.id), no_faktur: lama.no_faktur };
      await segarkanFaktur(Number(lama.id), s);
      return { id: Number(lama.id), no_faktur: lama.no_faktur };
    }
    await run(`DELETE FROM invoices WHERE id = ?`, Number(lama.id));
  }

  const noFaktur = await nomorFaktur(s.jenis, s.tanggal);
  const toko = await dataToko();
  const template = await templateBawaan(s.jenis);
  const terbilangTeks = terbilang(s.total);
  const data = {
    toko,
    pihak: s.pihak,
    sumber: s.sumber,
    items: s.items,
    no_dokumen: s.noDokumen,
  };

  const id = Number(
    await ((await run(
      `INSERT INTO invoices (no_faktur, jenis, sumber_tipe, sumber_id, tanggal, template_id,
                             pihak_nama, pihak_telepon, pihak_alamat,
                             subtotal, diskon, pajak_persen, pajak, total, terbilang, catatan,
                             data_json, dibuat_oleh)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      noFaktur,
      s.jenis,
      s.sumberTipe,
      s.sumberId,
      s.tanggal,
      template ? Number(template.id) : null,
      s.pihak.nama,
      s.pihak.telepon,
      s.pihak.alamat,
      s.subtotal,
      s.diskon,
      s.pajakPersen,
      s.pajak,
      s.total,
      terbilangTeks,
      s.catatan ?? null,
      JSON.stringify(data),
      s.userId,
    ))).lastInsertRowid,
  );
  return { id, no_faktur: noFaktur };
}

/** Tulis ulang isi faktur yang sudah ada (dipakai saat transaksi diedit). */
async function segarkanFaktur(id: number, s: SumberFaktur): Promise<void> {
  const toko = await dataToko();
  const data = {
    toko,
    pihak: s.pihak,
    sumber: s.sumber,
    items: s.items,
    no_dokumen: s.noDokumen,
  };
  await run(
    `UPDATE invoices SET tanggal = ?, pihak_nama = ?, pihak_telepon = ?, pihak_alamat = ?,
            subtotal = ?, diskon = ?, pajak_persen = ?, pajak = ?, total = ?, terbilang = ?,
            catatan = ?, data_json = ?
      WHERE id = ?`,
    s.tanggal,
    s.pihak.nama,
    s.pihak.telepon,
    s.pihak.alamat,
    s.subtotal,
    s.diskon,
    s.pajakPersen,
    s.pajak,
    s.total,
    terbilang(s.total),
    s.catatan ?? null,
    JSON.stringify(data),
    id,
  );
}

/** Faktur penjualan dari satu sale POS (dipanggil saat sale disahkan). */
export async function buatFakturPenjualan(
  saleId: number,
  userId: number | null = null,
  opsi: { perbarui?: boolean } = {},
): Promise<{ id: number; no_faktur: string } | null> {
  const sale = await get<Row>(
    `SELECT s.*, c.nama AS pelanggan_nama, c.telepon AS pelanggan_telepon, c.alamat AS pelanggan_alamat,
            w.nama AS gudang_nama, u.nama AS kasir_nama
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN warehouses w ON w.id = s.warehouse_id
       LEFT JOIN users u ON u.id = s.kasir_id
      WHERE s.id = ?`,
    saleId,
  );
  if (!sale) return null;

  const items = await (await all<Row>(
    `SELECT si.qty, si.harga, si.diskon, si.subtotal, si.sku, si.nama_produk,
            un.nama AS satuan
       FROM sale_items si
       LEFT JOIN units un ON un.id = si.unit_id
      WHERE si.sale_id = ?
      ORDER BY si.id`,
    saleId,
  )).map<ItemFaktur>((r) => ({
    kode: String(r.sku ?? ''),
    nama: String(r.nama_produk ?? ''),
    qty: Number(r.qty ?? 0),
    satuan: r.satuan ? String(r.satuan) : null,
    harga: Number(r.harga ?? 0),
    diskon: Number(r.diskon ?? 0),
    subtotal: Number(r.subtotal ?? 0),
  }));

  return simpanFaktur({
    jenis: 'penjualan',
    sumberTipe: 'penjualan',
    sumberId: saleId,
    tanggal: String(sale.tanggal),
    noDokumen: String(sale.no_dokumen),
    pihak: {
      nama: sale.pelanggan_nama ? String(sale.pelanggan_nama) : null,
      telepon: sale.pelanggan_telepon ? String(sale.pelanggan_telepon) : null,
      alamat: sale.pelanggan_alamat ? String(sale.pelanggan_alamat) : null,
    },
    items,
    subtotal: Number(sale.subtotal ?? 0),
    diskon: Number(sale.diskon ?? 0),
    pajakPersen: 0,
    pajak: Number(sale.pajak ?? 0),
    total: Number(sale.total ?? 0),
    sumber: {
      no_dokumen: sale.no_dokumen,
      gudang: sale.gudang_nama ?? null,
      kasir: sale.kasir_nama ?? null,
      mode_pos: sale.mode_pos ?? null,
      status: sale.status ?? null,
    },
    userId: userId ?? (sale.dibuat_oleh ? Number(sale.dibuat_oleh) : null),
  }, opsi);
}

/** Faktur pembelian dari satu pembelian (dipanggil saat disahkan / GRN). */
export async function buatFakturPembelian(
  purchaseId: number,
  userId: number | null = null,
  opsi: { perbarui?: boolean } = {},
): Promise<{ id: number; no_faktur: string } | null> {
  const p = await get<Row>(
    `SELECT p.*, s.nama AS pemasok_nama, s.telepon AS pemasok_telepon, s.alamat AS pemasok_alamat,
            w.nama AS gudang_nama
       FROM purchases p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN warehouses w ON w.id = p.warehouse_id
      WHERE p.id = ?`,
    purchaseId,
  );
  if (!p) return null;

  const items = await (await all<Row>(
    `SELECT pi.qty, pi.harga_beli, pi.diskon, pi.subtotal, pi.sku, pi.nama_produk,
            un.nama AS satuan
       FROM purchase_items pi
       LEFT JOIN units un ON un.id = pi.unit_id
      WHERE pi.purchase_id = ?
      ORDER BY pi.id`,
    purchaseId,
  )).map<ItemFaktur>((r) => ({
    kode: String(r.sku ?? ''),
    nama: String(r.nama_produk ?? ''),
    qty: Number(r.qty ?? 0),
    satuan: r.satuan ? String(r.satuan) : null,
    harga: Number(r.harga_beli ?? 0),
    diskon: Number(r.diskon ?? 0),
    subtotal: Number(r.subtotal ?? 0),
  }));

  return simpanFaktur({
    jenis: 'pembelian',
    sumberTipe: 'pembelian',
    sumberId: purchaseId,
    tanggal: String(p.tanggal),
    noDokumen: String(p.no_dokumen),
    pihak: {
      nama: p.pemasok_nama ? String(p.pemasok_nama) : null,
      telepon: p.pemasok_telepon ? String(p.pemasok_telepon) : null,
      alamat: p.pemasok_alamat ? String(p.pemasok_alamat) : null,
    },
    items,
    subtotal: Number(p.subtotal ?? 0),
    diskon: Number(p.diskon ?? 0),
    pajakPersen: Number(p.pajak_persen ?? 0),
    pajak: Number(p.pajak ?? 0),
    total: Number(p.total ?? 0),
    sumber: {
      no_dokumen: p.no_dokumen,
      no_grn: p.no_grn ?? null,
      no_po: p.no_po ?? null,
      gudang: p.gudang_nama ?? null,
      metode_input: p.metode_input ?? null,
      status: p.status ?? null,
    },
    userId: userId ?? (p.dibuat_oleh ? Number(p.dibuat_oleh) : null),
  }, opsi);
}

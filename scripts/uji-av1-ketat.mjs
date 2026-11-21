// ============================================================================
// uji-av1-ketat — Probe AV1 O (keamanan & ketahanan) + P (konkurensi).
// API-level: injeksi, XSS tersimpan, klik-ganda, balapan stok terakhir.
// Fiksur UJI-KT-, dibersihkan di akhir. Hanya untuk DB uji terisolasi.
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { headerUji } from './sesi-uji.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3001';
const DB_FILE = process.env.DB_FILE ?? 'data/app.db';
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA foreign_keys = ON');

let lulus = 0;
let gagal = 0;
const cek = (nama, ok, info = '') => {
  if (ok) lulus++;
  else gagal++;
  console.log(`${ok ? '✔' : '✘'} ${nama}${info ? ` — ${info}` : ''}`);
};
async function req(method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method, headers: await headerUji(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* bukan json */ }
  return { status: res.status, data };
}
const q1 = (s, ...p) => db.prepare(s).get(...p);
const semua = (s, ...p) => db.prepare(s).all(...p);

const G1 = q1(`SELECT id FROM warehouses WHERE kode = 'GD-1'`);
/** Hapus satu statement; tabel yang tidak ada di skema dilewati diam-diam. */
const cobaHapus = (sql, ...args) => { try { db.prepare(sql).run(...args); } catch (e) { /* tabel tak ada */ } };
const bersih = () => {
  const pids = semua(`SELECT id FROM products WHERE sku LIKE 'UJI-KT-%'`).map((r) => r.id);
  const sids = semua(`SELECT DISTINCT s.id FROM sales s JOIN sale_items i ON i.sale_id = s.id JOIN products p ON p.id = i.product_id WHERE p.sku LIKE 'UJI-KT-%'`).map((r) => r.id);
  const dids = semua(`SELECT id FROM purchases WHERE supplier_id IN (SELECT id FROM suppliers WHERE nama LIKE 'UJI-KT-%')`).map((r) => r.id);
  const phS = sids.map(() => '?').join(',');
  const phD = dids.map(() => '?').join(',');
  const phP = pids.map(() => '?').join(',');
  // Urutan anak → induk; tiap tabel try sendiri agar satu tabel yang tak ada di
  // skema tidak menggagalkan sisanya. Trigger trg_products_tidak_dihapus_bertransaksi
  // menuntut sale_items, purchase_items, opname_items, stock_ledger,
  // stock_transfer_items, journal_lines bersih sebelum products bisa dihapus.
  if (sids.length) {
    cobaHapus(`DELETE FROM sale_item_taxes WHERE sale_item_id IN (SELECT id FROM sale_items WHERE sale_id IN (${phS}))`, ...sids);
    cobaHapus(`DELETE FROM sale_payments WHERE sale_id IN (${phS})`, ...sids);
    cobaHapus(`DELETE FROM sale_items WHERE sale_id IN (${phS})`, ...sids);
    cobaHapus(`DELETE FROM receivables WHERE sale_id IN (${phS})`, ...sids);
    cobaHapus(`DELETE FROM sales WHERE id IN (${phS})`, ...sids);
  }
  if (dids.length) {
    cobaHapus(`DELETE FROM purchase_item_taxes WHERE purchase_item_id IN (SELECT id FROM purchase_items WHERE purchase_id IN (${phD}))`, ...dids);
    cobaHapus(`DELETE FROM purchase_items WHERE purchase_id IN (${phD})`, ...dids);
    cobaHapus(`DELETE FROM payables WHERE purchase_id IN (${phD})`, ...dids);
    cobaHapus(`DELETE FROM grn_items WHERE grn_id IN (SELECT id FROM grns WHERE purchase_id IN (${phD}))`, ...dids);
    cobaHapus(`DELETE FROM grns WHERE purchase_id IN (${phD})`, ...dids);
    cobaHapus(`DELETE FROM goods_receipts WHERE purchase_id IN (${phD})`, ...dids);
    cobaHapus(`DELETE FROM purchases WHERE id IN (${phD})`, ...dids);
  }
  if (pids.length) {
    cobaHapus(`DELETE FROM stock_transfer_items WHERE product_id IN (${phP})`, ...pids);
    cobaHapus(`DELETE FROM journal_lines WHERE product_id IN (${phP})`, ...pids);
    cobaHapus(`DELETE FROM stock_ledger WHERE product_id IN (${phP})`, ...pids);
    cobaHapus(`DELETE FROM stock_balances WHERE product_id IN (${phP})`, ...pids);
    cobaHapus(`DELETE FROM opname_items WHERE product_id IN (${phP})`, ...pids);
    // Satu per satu: satu produk bertransaksi (dilindungi trigger) tidak
    // menggagalkan produk lain.
    for (const pid of pids) cobaHapus(`DELETE FROM products WHERE id = ?`, pid);
  }
  cobaHapus(`DELETE FROM suppliers WHERE nama LIKE 'UJI-KT-%'`);
};
bersih();

// --- O1: XSS tersimpan pada nama produk ---------------------------------------
const xss = `<script>alert('xss')</script><img src=x onerror=alert(2)>`;
const px = await req('POST', '/api/master/produk', { nama: `UJI-KT ${xss}`, sku: 'UJI-KT-X1', kode_item: 'UJI-KT-X1', harga_beli: 100, harga_jual: 200, aktif: 1 });
cek('O1 produk nama-XSS tersimpan (200/201)', px.status === 200 || px.status === 201, `status=${px.status}`);
const pidX = px.data?.id;
const det = pidX ? await req('GET', `/api/master/produk/${pidX}`) : { status: 0, data: null };
const namaTersimpan = det.data?.data?.nama ?? det.data?.nama ?? '';
cek('O1 nama tidak dieksekusi di JSON (teks mentah, bukan HTML)', det.status === 200 && namaTersimpan.includes('<script>'), `status=${det.status}`);

// --- O2: injeksi SQL pada parameter cari ---------------------------------------
const inj1 = await req('GET', `/api/master/produk?cari=${encodeURIComponent(`' OR '1'='1`)}&per=5`);
const n1 = inj1.data?.data?.length ?? inj1.data?.length ?? -1;
cek(`O2 OR-injection tidak membocorkan katalog (200, hasil wajar)`, inj1.status === 200 && n1 <= 5, `status=${inj1.status} rows=${n1}`);
const inj2 = await req('GET', `/api/master/produk?cari=${encodeURIComponent(`'; DROP TABLE products;--`)}&per=5`);
const masihAda = q1(`SELECT COUNT(*) c FROM products`)?.c ?? 0;
cek('O2 DROP-injection gagal total tabel utuh', inj2.status === 200 && masihAda > 0, `status=${inj2.status} produk=${masihAda}`);

// --- O3: klik ganda (double submit penjualan) -----------------------------------
const sup = await req('POST', '/api/master/pemasok', { nama: 'UJI-KT-SUP', termin_hari: 0 });
const supId = sup.data?.id;
const pr = await req('POST', '/api/master/produk', { nama: 'UJI-KT Race', sku: 'UJI-KT-R1', kode_item: 'UJI-KT-R1', harga_beli: 10000, harga_jual: 15000, aktif: 1 });
const pidR = pr.data?.id;
const loc = q1(`SELECT id FROM locations WHERE warehouse_id = ? ORDER BY id LIMIT 1`, G1.id)?.id;
const dd = await req('POST', '/api/pembelian', { supplier_id: supId, warehouse_id: G1.id, metode: 'biasa', items: [{ product_id: pidR, qty: 1, unit_id: null, harga_beli: 10000, diskon: 0, location_id: loc ?? null }] });
const did = dd.data?.id;
await req('POST', `/api/pembelian/${did}/terima`, {});
await req('POST', `/api/pembelian/${did}/sahkan`, {});
await req('POST', '/api/pos/shift/buka', { kas_awal: 0 });
const payload = { warehouse_id: G1.id, items: [{ product_id: pidR, qty: 1, harga: 15000 }], payments: [{ metode: 'tunai', jumlah: 15000 }] };
const [a, b] = await Promise.all([req('POST', '/api/pos/sales', payload), req('POST', '/api/pos/sales', payload)]);
const kode = [a.status, b.status].sort().join('/');
cek('O3/P balapan stok-1: satu 201 + satu ditolak', kode === '201/400' || kode === '201/409', `status=${a.status}/${b.status}`);
const stokAkhir = Number(q1(`SELECT COALESCE(qty,0) q FROM stock_balances WHERE product_id = ? AND warehouse_id = ?`, pidR, G1.id)?.q ?? 999);
cek('O3 stok akhir = 0 (tidak minus/ganda)', stokAkhir === 0, `stok=${stokAkhir}`);
const jualBerhasil = [a, b].filter((r) => r.status === 201).length;
cek('O3 tepat 1 dokumen penjualan tercipta', jualBerhasil === 1, `berhasil=${jualBerhasil}`);

// --- O4: refresh saat proses (dokumen tetap konsisten) ---------------------------
const dd2 = await req('POST', '/api/pembelian', { supplier_id: supId, warehouse_id: G1.id, metode: 'biasa', items: [{ product_id: pidR, qty: 2, unit_id: null, harga_beli: 10000, diskon: 0, location_id: loc ?? null }] });
cek('O4 draft baru tetap bisa dibuat', dd2.status === 201, `status=${dd2.status}`);

bersih();
cek('fiksur UJI-KT- dibersihkan', semua(`SELECT id FROM products WHERE sku LIKE 'UJI-KT-%'`).length === 0, '');
console.log(`\nHasil: ${lulus} lulus, ${gagal} gagal`);
if (gagal) process.exit(1);

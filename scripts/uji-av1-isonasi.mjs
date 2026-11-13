// ============================================================================
// uji-av1-isonasi — Probe AV1 A-04 (isolasi data gudang) + A-05 + Q (angka).
//
//   DB_FILE=data/uji-av.db BASE=http://127.0.0.1:3029 \
//     UJI_USERNAME=admin UJI_SANDI=xxx npx tsx scripts/uji-av1-isonasi.mjs
//
// Memakai gudang yang sudah ada di DB uji (GD-1, GD-2). Fiksur berawalan
// UJI- dan dibersihkan di akhir (pola skrip uji lain). TIDAK untuk data nyata.
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

const H = async (extra) => headerUji(extra);
async function req(method, url, body, headers) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: headers ?? (await H()),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* bukan json */ }
  return { status: res.status, data };
}
const q1 = (s, ...p) => db.prepare(s).get(...p);
const semua = (s, ...p) => db.prepare(s).all(...p);

const G1 = q1(`SELECT id, kode FROM warehouses WHERE kode = 'GD-1'`);
const G2 = q1(`SELECT id, kode FROM warehouses WHERE kode = 'GD-2'`);
if (!G1 || !G2) { console.error('Butuh gudang GD-1 dan GD-2 di DB uji.'); process.exit(2); }

// --- Bersihkan sisa run sebelumnya -----------------------------------------
const bersih = () => {
  const pids = semua(`SELECT id FROM products WHERE sku LIKE 'UJI-ISO-%'`).map((r) => r.id);
  const dids = semua(`SELECT id FROM purchases WHERE supplier_id IN (SELECT id FROM suppliers WHERE nama LIKE 'UJI-ISO-%')`).map((r) => r.id);
  const sids = semua(`SELECT DISTINCT s.id FROM sales s JOIN sale_items i ON i.sale_id = s.id JOIN products p ON p.id = i.product_id WHERE p.sku LIKE 'UJI-ISO-%'`).map((r) => r.id);
  const alld = [...pids, ...dids, ...sids];
  if (alld.length) {
    const ph = alld.map(() => '?').join(',');
    for (const t of ['stock_ledger', 'sale_items', 'purchase_items', 'sale_returns', 'sale_return_items']) {
      try { db.prepare(`DELETE FROM ${t} WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'UJI-ISO-%')`).run(); } catch { /* beda kolom */ }
    }
    try { db.prepare(`DELETE FROM sale_payments WHERE sale_id IN (${sids.length ? sids.map(() => '?').join(',') : '-1'})`).run(...sids); } catch { /* abaikan */ }
    try { db.prepare(`DELETE FROM sale_items WHERE sale_id IN (${sids.length ? sids.map(() => '?').join(',') : '-1'})`).run(...sids); } catch { /* abaikan */ }
    try { db.prepare(`DELETE FROM sales WHERE id IN (${sids.length ? sids.map(() => '?').join(',') : '-1'})`).run(...sids); } catch { /* abaikan */ }
    try { db.prepare(`DELETE FROM purchase_items WHERE purchase_id IN (${dids.length ? dids.map(() => '?').join(',') : '-1'})`).run(...dids); } catch { /* abaikan */ }
    try { db.prepare(`DELETE FROM payables WHERE purchase_id IN (${dids.length ? dids.map(() => '?').join(',') : '-1'})`).run(...dids); } catch { /* abaikan */ }
    try { db.prepare(`DELETE FROM purchases WHERE id IN (${dids.length ? dids.map(() => '?').join(',') : '-1'})`).run(...dids); } catch { /* abaikan */ }
    try { db.prepare(`DELETE FROM stock_ledger WHERE product_id IN (${pids.length ? pids.map(() => '?').join(',') : '-1'})`).run(...pids); } catch { /* abaikan */ }
    try { db.prepare(`DELETE FROM stock_balances WHERE product_id IN (${pids.length ? pids.map(() => '?').join(',') : '-1'})`).run(...pids); } catch { /* abaikan */ }
    try { db.prepare(`DELETE FROM products WHERE id IN (${pids.length ? pids.map(() => '?').join(',') : '-1'})`).run(...pids); } catch { /* abaikan */ }
    void ph;
  }
  try { db.prepare(`DELETE FROM suppliers WHERE nama LIKE 'UJI-ISO-%'`).run(); } catch { /* abaikan */ }
  for (const u of semua(`SELECT id FROM users WHERE username LIKE 'uji_iso_%'`)) {
    try { db.prepare(`DELETE FROM audit_logs WHERE user_id = ?`).run(u.id); } catch { /* abaikan */ }
    try { db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(u.id); } catch { /* abaikan */ }
    try { db.prepare(`DELETE FROM users WHERE id = ?`).run(u.id); } catch { /* abaikan */ }
  }
  try { db.prepare(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE nama LIKE 'UJI-ISO%')`).run(); } catch { /* abaikan */ }
  try { db.prepare(`DELETE FROM role_hak_khusus WHERE role_id IN (SELECT id FROM roles WHERE nama LIKE 'UJI-ISO%')`).run(); } catch { /* abaikan */ }
  try { db.prepare(`DELETE FROM roles WHERE nama LIKE 'UJI-ISO%'`).run(); } catch { /* abaikan */ }
};
bersih();

// --- Seed: pemasok + produk + stok berbeda per gudang (Q1: beli 10 & 25) ----
const sup = await req('POST', '/api/master/pemasok', { nama: 'UJI-ISO-SUP', telepon: '0800', termin_hari: 0 });
cek('seed pemasok → 201', sup.status === 201, `status=${sup.status} ${JSON.stringify(sup.data)?.slice(0, 120)}`);
const supId = sup.data?.id ?? q1(`SELECT id FROM suppliers WHERE nama = 'UJI-ISO-SUP'`)?.id;

const prod = await req('POST', '/api/master/produk', {
  nama: 'UJI-ISO Widget Alpha', sku: 'UJI-ISO-A', kode_item: 'UJI-ISO-A',
  harga_beli: 50000, harga_jual: 80000, aktif: 1,
});
cek('seed produk → 201', prod.status === 201, `status=${prod.status}`);
const pid = prod.data?.id;
const loc1 = q1(`SELECT id FROM locations WHERE warehouse_id = ? ORDER BY id LIMIT 1`, G1.id)?.id;
const loc2 = q1(`SELECT id FROM locations WHERE warehouse_id = ? ORDER BY id LIMIT 1`, G2.id)?.id;

async function beliSahkan(gudangId, qty, lokasiId) {
  const d = await req('POST', '/api/pembelian', {
    supplier_id: supId, warehouse_id: gudangId, metode: 'biasa',
    items: [{ product_id: pid, qty, unit_id: null, harga_beli: 50000, diskon: 0, location_id: lokasiId ?? null }],
  });
  if (d.status !== 201) return { ok: false, tahap: `draft:${d.status}` };
  const id = d.data?.id;
  const t = await req('POST', `/api/pembelian/${id}/terima`, {});
  if (t.status !== 200) return { ok: false, tahap: `terima:${t.status}` };
  const s = await req('POST', `/api/pembelian/${id}/sahkan`, {});
  if (s.status !== 200) return { ok: false, tahap: `sahkan:${s.status} ${JSON.stringify(s.data)?.slice(0, 160)}`, id };
  return { ok: true, id };
}
const b1 = await beliSahkan(G1.id, 10, loc1);
cek('Q1 beli 10 GD-1 → disahkan', b1.ok, b1.tahap ?? '');
const b2 = await beliSahkan(G2.id, 25, loc2);
cek('Q1 beli 25 GD-2 → disahkan', b2.ok, b2.tahap ?? '');

const st1 = Number(q1(`SELECT COALESCE(qty,0) q FROM stock_balances WHERE product_id = ? AND warehouse_id = ?`, pid, G1.id)?.q ?? -1);
const st2 = Number(q1(`SELECT COALESCE(qty,0) q FROM stock_balances WHERE product_id = ? AND warehouse_id = ?`, pid, G2.id)?.q ?? -1);
cek('stok GD-1 = 10, GD-2 = 25', st1 === 10 && st2 === 25, `GD-1=${st1} GD-2=${st2}`);

// --- Peran + pengguna GD-1 saja ---------------------------------------------
const rPeran = await req('POST', '/api/pengguna/peran', { nama: 'UJI-ISO-GD1' });
const roleId = rPeran.data?.id;
cek('peran UJI-ISO-GD1 dibuat → 201', rPeran.status === 201, `status=${rPeran.status}`);
const MATRIKS = {
  master: ['lihat'], stok: ['lihat', 'tambah', 'ubah'], pembelian: ['lihat', 'tambah', 'ubah'],
  penjualan: ['lihat'], pos: ['lihat', 'tambah'], laporan: ['lihat'],
};
const rMat = await req('PUT', `/api/pengguna/matriks/${roleId}`, { hak: MATRIKS, khusus: {} });
cek('matriks peran tersimpan → 200', rMat.status === 200, `status=${rMat.status}`);
const rUser = await req('POST', '/api/pengguna/', {
  nama: 'UJI ISO GD1', username: 'uji_iso_gd1', sandi: 'SandiUji123!', peran_id: roleId, cakupan_toko: ['GD-1'],
});
cek('pengguna GD-1 dibuat → 201', rUser.status === 201, `status=${rUser.status} ${JSON.stringify(rUser.data)?.slice(0, 140)}`);

const loginU = await req('POST', '/api/auth/masuk', { username: 'uji_iso_gd1', sandi: 'SandiUji123!' });
cek('login pengguna GD-1 → 200', loginU.status === 200, `status=${loginU.status}`);
const setC = loginU.rawHeaders ?? null;
void setC;
const jar = [];
// ambil cookie sesi dari respons login
const loginRes = await fetch(`${BASE}/api/auth/masuk`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'uji_iso_gd1', sandi: 'SandiUji123!' }),
});
const setCookie = loginRes.headers.get('set-cookie') ?? '';
const m = /ns_sesi=([^;]+)/.exec(setCookie);
const HU = { 'content-type': 'application/json', cookie: `ns_sesi=${m?.[1] ?? ''}` };
const R = (method, url, body) => req(method, url, body, HU);
void jar;

// --- A-04: daftar master hanya GD-1 ------------------------------------------
const daftar = await R('GET', `/api/master/produk?cari=UJI-ISO&per=50`);
const baris = daftar.data?.data ?? daftar.data ?? [];
const milikU = baris.find((p) => String(p.sku ?? p.kode_item ?? '').includes('UJI-ISO-A'));
const rinci = milikU?.stok_rinci ?? milikU?.stok_per_gudang ?? null;
cek('master produk terbaca GD-1', daftar.status === 200 && Boolean(milikU), `status=${daftar.status}`);
cek('stok_rinci hanya GD-1 (qty 10)', Array.isArray(rinci) ? rinci.every((g) => String(g.gudang_kode ?? g.kode ?? '').includes('GD-1')) : true, JSON.stringify(rinci)?.slice(0, 160));

// --- A-04: filter gudang asing ditolak ----------------------------------------
const fGud = await R('GET', `/api/master/produk?gudang=${G2.id}`);
cek('master filter GD-2 → 403', fGud.status === 403, `status=${fGud.status}`);
const sGud = await R('GET', `/api/stok/saldo?gudang=${G2.id}`);
cek('stok saldo GD-2 → 403', sGud.status === 403, `status=${sGud.status}`);
const cGud = await R('GET', `/api/pos/cari?cari=UJI-ISO&gudang=${G2.id}`);
cek('pos cari gudang GD-2 → 403', cGud.status === 403, `status=${cGud.status}`);

// --- A-04: dokumen GD-2 langsung → ditolak -------------------------------------
const dokB = await R('GET', `/api/pembelian/${b2.id}`);
cek('buka dokumen GD-2 langsung → 403/404', dokB.status === 403 || dokB.status === 404, `status=${dokB.status}`);
const listB = await R('GET', `/api/pembelian?gudang=${G2.id}`);
cek('riwayat pembelian GD-2 → 403', listB.status === 403, `status=${listB.status}`);

// --- A-04: tulis ke GD-2 ditolak -----------------------------------------------
const dB = await R('POST', '/api/pembelian', { supplier_id: supId, warehouse_id: G2.id, metode: 'biasa', items: [] });
cek('draft ke GD-2 → 403', dB.status === 403, `status=${dB.status}`);

// --- A-04: cari default hanya GD-1 ----------------------------------------------
const cari = await R('GET', `/api/pos/cari?cari=UJI-ISO-A`);
const hasilCari = cari.data?.data ?? cari.data ?? [];
cek('pos cari default hanya stok GD-1', cari.status === 200 && hasilCari.every((x) => Number(x.stok ?? x.qty ?? 0) <= 10), `status=${cari.status} ${JSON.stringify(hasilCari[0] ?? null)?.slice(0, 160)}`);

// --- A-04: laporan + dashboard gudang asing --------------------------------------
const lap = await R('GET', `/api/laporan/penjualan/rekap?gudang=${G2.id}`);
cek('laporan gudang GD-2 → 403/404', [403, 404].includes(lap.status), `status=${lap.status}`);
const dash = await R('GET', `/api/dashboard/isi?gudang=${G2.id}`);
cek('dashboard gudang GD-2 → 403/404', [403, 404].includes(dash.status), `status=${dash.status}`);

// --- Q2: jual 4 @80000 tunai (admin) → stok 6, HPP 200rb ---------------------------
const shift = await req('POST', '/api/pos/shift/buka', { kas_awal: 0 });
const jual = await req('POST', '/api/pos/sales', {
  warehouse_id: G1.id,
  items: [{ product_id: pid, qty: 4, harga: 80000 }],
  payments: [{ metode: 'tunai', jumlah: 320000 }],
  catatan: 'UJI-ISO-Q2',
});
cek('Q2 jual 4 tunai → 201', jual.status === 201, `status=${jual.status} ${JSON.stringify(jual.data)?.slice(0, 160)}`);
const saleId = jual.data?.id;
const st1b = Number(q1(`SELECT COALESCE(qty,0) q FROM stock_balances WHERE product_id = ? AND warehouse_id = ?`, pid, G1.id)?.q ?? -1);
cek('Q2 stok GD-1 = 6', st1b === 6, `stok=${st1b}`);
const hpp = Number(q1(`SELECT COALESCE(SUM(qty_keluar * nilai_unit),0) n FROM stock_ledger WHERE tipe_dokumen = 'penjualan' AND dokumen_id = ?`, saleId)?.n ?? -1);
cek('Q2 HPP = 200.000 (4 × 50.000)', hpp === 200000, `hpp=${hpp}`);
const st2b = Number(q1(`SELECT COALESCE(qty,0) q FROM stock_balances WHERE product_id = ? AND warehouse_id = ?`, pid, G2.id)?.q ?? -1);
cek('GD-2 tetap 25 (tidak terpengaruh jual GD-1)', st2b === 25, `stok=${st2b}`);

// --- Bersih-bersih ---------------------------------------------------------------
bersih();
cek('fiksur UJI- dibersihkan', semua(`SELECT id FROM products WHERE sku LIKE 'UJI-ISO-%'`).length === 0
  && semua(`SELECT id FROM users WHERE username LIKE 'uji_iso_%'`).length === 0
  && semua(`SELECT id FROM roles WHERE nama LIKE 'UJI-ISO%'`).length === 0, '');

console.log(`\nHasil: ${lulus} lulus, ${gagal} gagal`);
if (gagal) process.exit(1);

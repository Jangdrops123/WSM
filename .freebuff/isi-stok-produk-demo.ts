/* Isi stok demo untuk produk yang SUDAH ADA — idempoten.
   Ikuti jalur resmi seperti scripts/isi-stok-demo.ts: gudang+lokasi via API
   Master, stok masuk lewat ubahStok() agar tercatat di Kartu Stok
   (stock_ledger). Aman dijalankan berulang.

   Jalankan: npx tsx .freebuff/isi-stok-produk-demo.ts   (API hidup di :3001)
*/
import { all, get } from '../server/db.ts';
import { ubahStok } from '../server/lib/stok.ts';

const API = process.env.API ?? 'http://127.0.0.1:3001';

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}: ${JSON.stringify(data)}`);
  return data as T;
}

async function pastikanGudang(kode: string, nama: string): Promise<number> {
  const daftar = await api<{ data: { id: number; kode: string }[] }>('GET', `/api/master/gudang?cari=${encodeURIComponent(kode)}&per=50`);
  const ada = daftar.data.find((g) => g.kode === kode);
  if (ada) return Number(ada.id);
  const baru = await api<{ id: number }>('POST', '/api/master/gudang', { kode, nama });
  console.log(`gudang baru: ${kode} (id ${baru.id})`);
  return Number(baru.id);
}

async function pastikanLokasi(warehouseId: number, kode: string, isi: { zona: string; rak: string; bin: string }): Promise<number> {
  const daftar = await api<{ data: { id: number; kode_lokasi: string; warehouse_id: number }[] }>(
    'GET',
    `/api/master/lokasi?cari=${encodeURIComponent(kode)}&per=200`,
  );
  const ada = daftar.data.find((l) => l.kode_lokasi === kode && Number(l.warehouse_id) === warehouseId);
  if (ada) return Number(ada.id);
  const baru = await api<{ id: number }>('POST', '/api/master/lokasi', {
    warehouse_id: warehouseId,
    kode_lokasi: kode,
    ...isi,
  });
  console.log(`lokasi baru: ${kode} (id ${baru.id})`);
  return Number(baru.id);
}

const gudang = await pastikanGudang('GD-PUSAT', 'Gudang Pusat');
const lokasi = await pastikanLokasi(gudang, 'A-01-01', { zona: 'A', rak: '01', bin: '01' });

const produk = all<{ id: number; harga_beli: number }>(
  `SELECT id, harga_beli FROM products
   WHERE aktif = 1 AND deleted_at IS NULL
   ORDER BY id`,
);

let dibuat = 0;
let dilewati = 0;
for (const p of produk) {
  const ada = Number(
    get<{ n: number }>(`SELECT COALESCE(SUM(qty), 0) AS n FROM stock_balances WHERE product_id = ?`, p.id)?.n ?? 0,
  );
  if (ada > 0) {
    dilewati++;
    continue;
  }
  const qty = p.id % 25; // 0..24 — sebagian sengaja 0 agar tampilan "Habis" ikut teruji
  if (qty === 0) continue;
  ubahStok({
    productId: p.id,
    warehouseId: gudang,
    locationId: lokasi,
    masuk: qty,
    hargaMasuk: Number(p.harga_beli) || 0,
    tipeDokumen: 'penyesuaian',
  });
  dibuat++;
}

const total = Number(
  get<{ n: number }>(`SELECT COALESCE(SUM(qty), 0) AS n FROM stock_balances`)?.n ?? 0,
);
console.log(`produk distok: ${dibuat} · sudah terisi (dilewati): ${dilewati} · total saldo: ${total}`);

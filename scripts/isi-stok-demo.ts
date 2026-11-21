/**
 * Isi data demo Modul Stok — IDEMPOTEN, aman dijalankan berulang.
 *
 *   npx tsx scripts/isi-stok-demo.ts     (server API harus hidup di :3001)
 *
 * - Gudang, lokasi, kategori, dan 4 produk demo dibuat lewat API Master Data
 *   (jalur aplikasi) — satu baris = satu produk (tanpa varian).
 * - Stok awal MASUK lewat SATU-JALUR ubahStok() sehingga langsung tercatat di
 *   Kartu Stok (stock_ledger) — tidak ada saldo yang lahir tanpa kartu stok.
 * - Stok minimum demo diatur sebagai metadata produk (bukan pergerakan stok).
 */
import { get, pool, run } from '../server/db.pg.ts';
import { ubahStok } from '../server/lib/stok.ts';
import { headerUji } from './sesi-uji.mjs';

const API = process.env.API ?? 'http://127.0.0.1:3001';

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: await headerUji(),
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

async function pastikanKategori(nama: string): Promise<number> {
  const daftar = await api<{ data: { id: number; nama: string }[] }>('GET', `/api/master/kategori?cari=${encodeURIComponent(nama)}&per=50`);
  const ada = daftar.data.find((k) => k.nama === nama);
  if (ada) return Number(ada.id);
  const baru = await api<{ id: number }>('POST', '/api/master/kategori', { nama });
  console.log(`kategori baru: ${nama} (id ${baru.id})`);
  return Number(baru.id);
}

/** Produk demo (satu baris = satu produk) — dibuat via API bila belum ada. */
const PRODUK_DEMO = [
  { sku: 'KAOS-DISTRO-M-MERAH', nama: 'Kaos Distro Merah M', hb: 45_000, he: 75_000 },
  { sku: 'KAOS-DISTRO-M-BIRU', nama: 'Kaos Distro Biru M', hb: 45_000, he: 75_000 },
  { sku: 'KAOS-DISTRO-L-MERAH', nama: 'Kaos Distro Merah L', hb: 50_000, he: 85_000 },
  { sku: 'KAOS-DISTRO-L-BIRU', nama: 'Kaos Distro Biru L', hb: 50_000, he: 85_000 },
];

async function pastikanProduk(p: (typeof PRODUK_DEMO)[number]): Promise<number> {
  const daftar = await api<{ data: { id: number; sku: string }[] }>('GET', `/api/master/produk?cari=${encodeURIComponent(p.sku)}&per=50`);
  const ada = daftar.data.find((x) => x.sku === p.sku);
  if (ada) return Number(ada.id);
  const baru = await api<{ id: number }>('POST', '/api/master/produk', {
    kode_item: '',
    nama: p.nama,
    sku: p.sku,
    harga_beli: p.hb,
    harga_jual: p.he,
    stok_min: 0,
    aktif: 1,
    konversi: [],
  });
  console.log(`produk baru: ${p.sku} (id ${baru.id})`);
  return Number(baru.id);
}

async function main() {
  // 1. Gudang + lokasi -----------------------------------------------------
  const pusat = await pastikanGudang('GD-PUSAT', 'Gudang Pusat');
  const cabang = await pastikanGudang('GD-CABANG', 'Gudang Cabang');
  const lokA1 = await pastikanLokasi(pusat, 'A-01-01', { zona: 'A', rak: '01', bin: '01' });
  const lokA2 = await pastikanLokasi(pusat, 'A-02-01', { zona: 'A', rak: '02', bin: '01' });
  const lokB1 = await pastikanLokasi(cabang, 'B-01-01', { zona: 'B', rak: '01', bin: '01' });

  // 2. Kategori + produk demo ------------------------------------------------
  const kategoriKaos = await pastikanKategori('Kaos');
  const idProduk = new Map<string, number>();
  for (const p of PRODUK_DEMO) idProduk.set(p.sku, await pastikanProduk(p));

  // Kaitkan kategori ke produk demo milik skrip ini (BUKAN produk sembarangan
  // yang kebetulan belum punya kategori — bisa jadi fixture uji yang dibersihkan
  // skrip lain, lalu kategori jadi "tidak terpakai" dan ikut terhapus).
  const contoh = await get<{ id: number }>(`SELECT id FROM products WHERE sku = 'KAOS-DISTRO-M-MERAH'`);
  if (contoh) {
    await run(`UPDATE products SET category_id = ? WHERE id = ?`, kategoriKaos, Number(contoh.id));
    console.log(`produk id ${contoh.id} (KAOS-DISTRO-M-MERAH) dikaitkan ke kategori Kaos`);
  }

  // 3. Stok awal — lewat ubahStok agar tercatat di Kartu Stok ---------------
  const STOK_AWAL = [
    { sku: 'KAOS-DISTRO-M-MERAH', qty: 24, harga: 45_000, lokasi: lokA1 },
    { sku: 'KAOS-DISTRO-M-BIRU', qty: 18, harga: 45_000, lokasi: lokA1 },
    { sku: 'KAOS-DISTRO-L-MERAH', qty: 30, harga: 50_000, lokasi: lokA2 },
    { sku: 'KAOS-DISTRO-L-BIRU', qty: 12, harga: 50_000, lokasi: lokA1 },
  ];

  for (const s of STOK_AWAL) {
    const id = idProduk.get(s.sku);
    if (!id) {
      console.log(`lewati ${s.sku}: produk tidak ada`);
      continue;
    }
    const total = Number((await get<{ n: number }>(`SELECT COALESCE(SUM(qty), 0) AS n FROM stock_balances WHERE product_id = ?`, id))?.n ?? 0);
    if (total > 0) {
      console.log(`lewati ${s.sku}: sudah ada stok (${total})`);
      continue;
    }
    await ubahStok({
      productId: id,
      warehouseId: pusat,
      locationId: s.lokasi,
      masuk: s.qty,
      hargaMasuk: s.harga,
      tipeDokumen: 'penyesuaian',
    });
    console.log(`stok awal: ${s.sku} +${s.qty} @${s.harga} (kartu stok tercatat)`);
  }

  // 4. Stok minimum demo (metadata — bukan pergerakan stok) -----------------
  await run(
    `UPDATE products
        SET stok_min = CASE
          WHEN sku = 'KAOS-DISTRO-L-BIRU' THEN 20   -- sengaja di bawah minimum
          WHEN sku = 'KAOS-DISTRO-M-BIRU' THEN 10
          ELSE 0 END
      WHERE sku LIKE 'KAOS-DISTRO-%'`,
  );

  // 5. Ringkasan ------------------------------------------------------------
  const ringkas = await get<{ n: number }>(`SELECT COUNT(*) AS n FROM stock_balances`);
  const ledger = await get<{ n: number }>(`SELECT COUNT(*) AS n FROM stock_ledger`);
  console.log('---');
  console.log(`gudang: GD-PUSAT(${pusat}), GD-CABANG(${cabang}) · lokasi: ${lokA1}, ${lokA2}, ${lokB1}`);
  console.log(`baris saldo: ${ringkas?.n} · baris kartu stok: ${ledger?.n}`);
}

await main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error('GAGAL:', err instanceof Error ? err.message : err);
    process.exit(1);
  },
);

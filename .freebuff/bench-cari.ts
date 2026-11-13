/* Benchmark autocomplete POS Mode Cepat — skrip sekali jalan (bukan bagian aplikasi).
   Jalankan:  npx tsx .freebuff/bench-cari.ts
   DB skrip .freebuff/bench.db (50.000 produk, tanpa varian).

   Desain yang diuji (identik dengan server/routes/pos.ts /pos/cari):
     Fase A — 4 query indeks-awalan (sku, barcode, nama, kode_item), masing-masing
              SATU syarat LIKE 'awalan%' + ORDER BY kolom indeks + LIMIT 10
              (berhenti dini tanpa sorting penuh);
     Fase B — hanya bila A < 10: satu query kata/berisi (scan penuh) LIMIT 10;
     Gabung di JS: dedupe per produk, peringkat,
     lalu stok untuk ≤10 produk terpilih.
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbFile = path.join(here, 'bench.db');
for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) fs.rmSync(f, { force: true });
process.env.DB_FILE = dbFile;

const { db } = await import('../server/db.ts');
const { jalankanMigrasi } = await import('../server/migrate.ts');

console.log('migrasi…', jalankanMigrasi());

/* ------------------------------ seed 50k -------------------------------- */
const N = 50_000;
const awal = Date.now();
db.exec('BEGIN');
const wId = Number(
  db.prepare(`INSERT INTO warehouses (kode, nama) VALUES ('GW-BENCH', 'Gudang Bench')`).run().lastInsertRowid,
);

const kataDepan = ['Kaos', 'Polo', 'Celana', 'Sepatu', 'Kemeja', 'Jaket', 'Tas', 'Topi', 'Sandal', 'Dompet', 'Amara', 'Bata'];
const kataBantu = ['Polos', 'Oblong', 'Hitam', 'Putih', 'Anak', 'Dewasa', 'Premium', 'Lokal', 'Batik', 'Grosir'];
const ukuran = ['S', 'M', 'L', 'XL'];
const warna = ['Hitam', 'Putih', 'Merah', 'Biru'];

// Satu baris = satu produk; size/warna ikut di nama (kosmetik) agar kata kunci
// tetap terwakili dalam teks nama seperti katalog nyata.
const insP = db.prepare(
  `INSERT INTO products (nama, kode_item, sku, barcode, harga_beli, harga_jual, aktif) VALUES (?, ?, ?, ?, 1000, 50000, 1)`,
);
const insS = db.prepare(`INSERT INTO stock_balances (product_id, warehouse_id, qty) VALUES (?, ?, ?)`);

for (let i = 1; i <= N; i++) {
  const depan = i % 10 < 3 ? 'Kaos' : kataDepan[i % kataDepan.length];
  const bantu = i % 7 === 0 ? 'Polos' : kataBantu[(i * 3) % kataBantu.length];
  const size = i % 3 === 0 ? ukuran[i % 4] : null;
  const wrn = i % 5 === 0 ? warna[i % 4] : null;
  const nama = `${depan} ${bantu}${size ? ` ${size}` : ''}${wrn ? ` ${wrn}` : ''} ${i}`;
  const barcode = i % 4 === 0 ? `899${String(i).padStart(10, '0')}` : null;
  const pid = Number(insP.run(nama, `BR-${i}`, `SKU-${i}`, barcode).lastInsertRowid);
  insS.run(pid, wId, i % 25);
}
db.exec('COMMIT');
// Statistik pengoptimal: tanpa ANALYZE, planner memilih indeks aktif yang salah.
db.exec('ANALYZE');
console.log(`seed ${N} produk selesai dalam ${Date.now() - awal} ms`);

/* ------------------------------ kandidat query --------------------------- */
const KOLOM = `p.id AS product_id, p.nama, p.kode_item, p.sku, p.barcode, p.harga_jual AS harga`;
const SYARAT = `p.deleted_at IS NULL AND p.aktif = 1`;

const esc = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

const qSku = db.prepare(`SELECT ${KOLOM} FROM products p WHERE ${SYARAT} AND p.sku LIKE ? ESCAPE '\\' ORDER BY p.sku COLLATE NOCASE LIMIT 10`);
const qBc = db.prepare(`SELECT ${KOLOM} FROM products p WHERE ${SYARAT} AND p.barcode LIKE ? ESCAPE '\\' ORDER BY p.barcode COLLATE NOCASE LIMIT 10`);
const qNama = db.prepare(`SELECT ${KOLOM} FROM products p WHERE ${SYARAT} AND p.nama LIKE ? ESCAPE '\\' ORDER BY p.nama COLLATE NOCASE LIMIT 10`);
const qKode = db.prepare(`SELECT ${KOLOM} FROM products p WHERE ${SYARAT} AND p.kode_item LIKE ? ESCAPE '\\' ORDER BY p.kode_item COLLATE NOCASE LIMIT 10`);

const qBroad = db.prepare(`
  SELECT ${KOLOM} FROM products p
  WHERE ${SYARAT} AND (
      p.nama LIKE ? ESCAPE '\\' OR p.nama LIKE ? ESCAPE '\\'
   OR p.kode_item LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\'
   OR p.barcode LIKE ? ESCAPE '\\')
  ORDER BY
    CASE
      WHEN p.barcode = ? COLLATE NOCASE OR p.sku = ? COLLATE NOCASE THEN 0
      WHEN p.nama LIKE ? ESCAPE '\\' THEN 1
      WHEN p.kode_item LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR p.barcode LIKE ? ESCAPE '\\' THEN 2
      WHEN p.nama LIKE ? ESCAPE '\\' THEN 3
      ELSE 4
    END,
    p.nama, p.sku
  LIMIT 10`);

const sqlStok = (n: number) =>
  `SELECT product_id, COALESCE(SUM(qty), 0) AS stok FROM stock_balances
   WHERE warehouse_id = ? AND product_id IN (${new Array(n).fill('?').join(',')}) GROUP BY product_id`;

interface Baris {
  product_id: number;
  nama: string;
  kode_item: string | null;
  sku: string;
  barcode: string | null;
  harga: number;
}

const peringkat = (r: Baris, q: string): number => {
  const sku = r.sku.toLowerCase();
  const bc = (r.barcode ?? '').toLowerCase();
  const nama = r.nama.toLowerCase();
  const kode = (r.kode_item ?? '').toLowerCase();
  if (bc === q || sku === q) return 0;
  if (nama.startsWith(q)) return 1;
  if (kode.startsWith(q) || sku.startsWith(q) || bc.startsWith(q)) return 2;
  if (nama.includes(` ${q}`)) return 3;
  return 4;
};

function cari(q: string): Baris[] {
  const e = esc(q);
  const awalan = `${e}%`;
  const kata = `% ${e}%`;
  const isi = `%${e}%`;

  // Fase A: jalur indeks awalan.
  const semua: Baris[] = [
    ...(qSku.all(awalan) as Baris[]),
    ...(qBc.all(awalan) as Baris[]),
    ...(qNama.all(awalan) as Baris[]),
    ...(qKode.all(awalan) as Baris[]),
  ];

  // Fase B: hanya bila kurang dari 10.
  if (semua.length < 10) {
    semua.push(...(qBroad.all(kata, isi, isi, isi, isi, q, q, awalan, awalan, awalan, kata) as Baris[]));
  }

  // Dedupe per produk + urut peringkat, ambil 10.
  const peta = new Map<number, Baris>();
  for (const r of semua) if (!peta.has(r.product_id)) peta.set(r.product_id, r);
  const hasil = [...peta.values()]
    .sort(
      (a, b) =>
        peringkat(a, q) - peringkat(b, q) ||
        a.nama.localeCompare(b.nama) ||
        a.sku.localeCompare(b.sku),
    )
    .slice(0, 10);

  // Stok hanya untuk ≤10 produk terpilih.
  if (hasil.length > 0) {
    const ids = hasil.map((r) => r.product_id);
    const rows = db.prepare(sqlStok(ids.length)).all(wId, ...(ids as never[])) as { product_id: number; stok: number }[];
    const stok = new Map(rows.map((s) => [s.product_id, Number(s.stok)]));
    for (const r of hasil) (r as Baris & { stok?: number }).stok = stok.get(r.product_id) ?? 0;
  }
  return hasil;
}

/* EXPLAIN QUERY PLAN jalur indeks (diperiksa sekali) */
console.log('\nEXPLAIN QUERY PLAN qNama:');
for (const r of qNama.all('kaos%') as unknown as Record<string, unknown>[]) console.log('  ', JSON.stringify(r));

/* ------------------------------ jalankan -------------------------------- */
const queries = ['k', 'ka', 'kao', 'kaos', 'polos', 'SKU-1234', '89900000001', 'zzz', 'br-0001'];
for (const q of queries) cari(q); // hangatkan
console.log('\nTertingkat (fase A + B bila perlu), 50.000 produk:');
for (const q of queries) {
  const ITER = 30;
  const t: number[] = [];
  let n = 0;
  for (let i = 0; i < ITER; i++) {
    const s = process.hrtime.bigint();
    const r = cari(q);
    t.push(Number(process.hrtime.bigint() - s) / 1e6);
    n = r.length;
  }
  t.sort((a, b) => a - b);
  const avg = t.reduce((a, b) => a + b, 0) / t.length;
  const p95 = t[Math.floor(t.length * 0.95)];
  console.log(`  q=${JSON.stringify(q).padEnd(12)} hasil=${n}  avg=${avg.toFixed(1)}ms  p95=${p95.toFixed(1)}ms`);
}

db.close();

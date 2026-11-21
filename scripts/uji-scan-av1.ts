// Uji integrasi modul Pembelian/Inbound (metode Scan Barcode):
// scan box → semua isi masuk draft; scan satuan → +1 pcs; barcode tak dikenal → opsi;
// draft scan → GRN → Sahkan (stok + hutang) → batal (pulih); riwayat scan per dokumen.
// Master Produk tanpa varian — pack_items & item merujuk product_id.
// Jalankan: npx tsx scripts/uji-scan.ts   (server API harus hidup di :3001)
import { all, get, pool, run } from '../server/db.pg.ts';
import { headerUji } from './sesi-uji.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3001';

let lulus = 0;
let gagal = 0;
const cek = async (nama: string, ok: boolean, info = '') => {
  if (ok) lulus++;
  else gagal++;
  console.log(`${ok ? '✔' : '✘'} ${nama}${info ? ` — ${info}` : ''}`);
};

async function req(method: string, url: string, body?: unknown) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: await headerUji(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* bukan json */
  }
  return { status: res.status, data };
}

const q1 = async (sql: string, ...p: unknown[]) => (await get(sql, ...(p as never[]))) as any;
const semua = async (sql: string, ...p: unknown[]) => (await all(sql, ...(p as never[]))) as any[];

/** Hapus sisa uji sebelumnya (dokumen + fiksinya) supaya berulang dengan aman. */
const bersihkan = async () => {
  const sup = (await semua(`SELECT id FROM suppliers WHERE nama LIKE 'SCN %' OR nama LIKE 'SCN-%'`)).map((r) => Number(r.id));
  const supPh = sup.length ? sup.map(() => '?').join(',') : '-1';
  const docs = (await semua(
    `SELECT id FROM purchases WHERE supplier_id IN (${supPh})
       OR warehouse_id IN (SELECT id FROM warehouses WHERE kode LIKE 'SCN-%')`,
    ...sup,
  )).map((r) => Number(r.id));
  if (docs.length) {
    const dph = docs.map(() => '?').join(',');
    (await run(`DELETE FROM purchase_scan_logs WHERE purchase_id IN (${dph})`, ...docs));
    (await run(`DELETE FROM stock_ledger WHERE tipe_dokumen IN ('pembelian', 'pembelian_batal') AND dokumen_id IN (${dph})`, ...docs));
    (await run(`DELETE FROM journals WHERE sumber_tipe = 'pembelian' AND sumber_id IN (${dph})`, ...docs));
    (await run(`DELETE FROM payables WHERE purchase_id IN (${dph})`, ...docs));
    (await run(`DELETE FROM purchase_items WHERE purchase_id IN (${dph})`, ...docs));
    (await run(`DELETE FROM purchases WHERE id IN (${dph})`, ...docs));
  }
  if (sup.length) {
    (await run(`DELETE FROM suppliers WHERE id IN (${sup.map(() => '?').join(',')})`, ...sup));
  }
  await run(`
    DELETE FROM pack_items WHERE pack_id IN (SELECT id FROM packs WHERE barcode_box LIKE 'SCN-%');
    DELETE FROM packs WHERE barcode_box LIKE 'SCN-%';
    DELETE FROM stock_ledger WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'SCN-%');
    DELETE FROM stock_balances WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'SCN-%');
    DELETE FROM products WHERE sku LIKE 'SCN-%';
    DELETE FROM units WHERE kode LIKE 'SCN-%';
    DELETE FROM locations WHERE kode_lokasi LIKE 'SCN-%';
    DELETE FROM warehouses WHERE kode LIKE 'SCN-%';
  `)
};

interface Fiks {
  supId: number;
  gudangId: number;
  p1: number; // isi box 5 pcs/box
  p2: number; // isi box 15 pcs/box
  p3: number; // produk satuan
  bcBox: string;
  bcP1: string;
  bcP2: string;
  bcP3: string;
  bcAsing: string;
}

const siapkan = async (): Fiks => {
  const supId = Number((await run(`INSERT INTO suppliers (nama, telepon, termin_hari) VALUES ('SCN-PT Uji Scan', '081200', 14)`)).lastInsertRowid);
  const gudangId = Number((await run(`INSERT INTO warehouses (kode, nama) VALUES ('SCN-GD', 'Gudang Uji Scan')`)).lastInsertRowid);
  (await run(`INSERT INTO locations (warehouse_id, kode_lokasi, zona) VALUES (?, 'SCN-L1', 'Zona Uji')`, gudangId));
  const pcsId = Number((await run(`INSERT INTO units (kode, nama) VALUES ('SCN-PCS', 'Pcs Uji')`)).lastInsertRowid);
  // Tiga produk terpisah (SKU unik) — pengganti tiga varian pada skema lama.
  const p1 = Number((await run(`INSERT INTO products (nama, sku, barcode, satuan_dasar_id, harga_beli, harga_jual) VALUES ('SCN Uji Kaos H-M', 'SCN-KRA-H-M', 'SCN-BC-0001', ?, 10000, 20000)`, pcsId)).lastInsertRowid);
  const p2 = Number((await run(`INSERT INTO products (nama, sku, barcode, satuan_dasar_id, harga_beli, harga_jual) VALUES ('SCN Uji Kaos H-L', 'SCN-KRA-H-L', 'SCN-BC-0002', ?, 5000, 10000)`, pcsId)).lastInsertRowid);
  const p3 = Number((await run(`INSERT INTO products (nama, sku, barcode, satuan_dasar_id, harga_beli, harga_jual) VALUES ('SCN Uji Kaos P-M', 'SCN-KRB-P-M', 'SCN-BC-0003', ?, 20000, 40000)`, pcsId)).lastInsertRowid);
  const packId = Number(
    (await run(`INSERT INTO packs (kode_box, barcode_box, nama) VALUES ('SCN-BOX-1', 'SCN-BC-BOX', 'SCN Box Isi 20')`)).lastInsertRowid,
  );
  (await run(`INSERT INTO pack_items (pack_id, product_id, qty) VALUES (?, ?, 5)`, packId, p1));
  (await run(`INSERT INTO pack_items (pack_id, product_id, qty) VALUES (?, ?, 15)`, packId, p2));
  return {
    supId,
    gudangId,
    p1,
    p2,
    p3,
    bcBox: 'SCN-BC-BOX',
    bcP1: 'SCN-BC-0001',
    bcP2: 'SCN-BC-0002',
    bcP3: 'SCN-BC-0003',
    bcAsing: 'SCN-BC-TIDAK-ADA',
  };
};

async function main() {
  await bersihkan();
  const f = await siapkan();

  // --- endpoint scan: box ---------------------------------------------------
  let r = await req('POST', '/api/pembelian/scan', { barcode: f.bcBox });
  await cek('scan box dikenali', r.status === 200 && r.data.tipe === 'box', `tipe=${r.data.tipe}`);
  await cek('box berisi 2 produk', Array.isArray(r.data.pack?.items) && r.data.pack.items.length === 2, `items=${r.data.pack?.items?.length}`);
  await cek(
    'box total 20 pcs (5+15) & harga per produk',
    r.data.pack?.total_pcs === 20 &&
      r.data.pack.items.every((it: any) => [10000, 5000].includes(Number(it.harga_beli))),
    `total_pcs=${r.data.pack?.total_pcs}`,
  );

  // --- endpoint scan: satuan (case-insensitive) & tak dikenal ---------------
  const bcP3 = f.bcP3.toLowerCase();
  const rSat = await req('POST', '/api/pembelian/scan', { barcode: bcP3 });
  await cek('scan satuan case-insensitive', rSat.status === 200 && rSat.data.tipe === 'satuan' && Number(rSat.data.produk?.product_id) === f.p3);

  const rAsing = await req('POST', '/api/pembelian/scan', { barcode: f.bcAsing });
  await cek('barcode tak dikenal dilaporkan', rAsing.status === 200 && rAsing.data.tipe === 'tidak_dikenal');

  const packId = Number(r.data.pack.id);

  // --- draft dari hasil scan (frontend: 2 box + 1 satuan) -------------------
  const items = [
    { product_id: f.p1, qty: 10, unit_id: null, harga_beli: 10000, diskon: 0, pack_id: packId, sumber_scan: 'box' },
    { product_id: f.p2, qty: 30, unit_id: null, harga_beli: 5000, diskon: 0, pack_id: packId, sumber_scan: 'box' },
    { product_id: f.p3, qty: 1, unit_id: null, harga_beli: 20000, diskon: 0, pack_id: null, sumber_scan: 'satuan' },
  ];
  const scanLogs = [
    { barcode: f.bcBox, tipe: 'box', pack_id: packId, product_id: null },
    { barcode: bcP3, tipe: 'satuan', pack_id: null, product_id: f.p3 },
    { barcode: f.bcAsing, tipe: 'tidak_dikenal', pack_id: null, product_id: null },
  ];
  r = await req('POST', '/api/pembelian', {
    metode_input: 'scan',
    supplier_id: f.supId,
    warehouse_id: f.gudangId,
    items,
    scan_logs: scanLogs,
  });
  const dok = r.data?.data;
  await cek('draft scan dibuat (metode_input=scan)', r.status === 201 && dok?.id && dok.metode_input === 'scan', `no=${dok?.no_dokumen}`);

  const diDb = await q1(`SELECT metode_input, status FROM purchases WHERE id = ?`, dok.id);
  await cek('DB menyimpan metode_input & status draft', diDb?.metode_input === 'scan' && diDb?.status === 'draft');

  const barisBox = await semua(`SELECT product_id, qty, pack_id, sumber_scan FROM purchase_items WHERE purchase_id = ? ORDER BY id`, dok.id);
  const packIdDok = barisBox.find((b: any) => b.pack_id)?.pack_id;
  await cek(
    'item box terikat pack_id + sumber_scan',
    barisBox.filter((b: any) => b.pack_id === packIdDok).length === 2 &&
      barisBox.filter((b: any) => b.sumber_scan === 'box' && b.pack_id).length === 2,
    `baris=${barisBox.length}`,
  );
  await cek(
    'qty per produk box = jumlah_box × komposisi (2 box: 10 & 30)',
    barisBox.some((b: any) => Number(b.product_id) === f.p1 && Number(b.qty) === 10) &&
      barisBox.some((b: any) => Number(b.product_id) === f.p2 && Number(b.qty) === 30),
  );
  await cek(
    'baris satuan tercatat (sumber_scan=satuan, pack NULL)',
    barisBox.some((b: any) => Number(b.product_id) === f.p3 && b.sumber_scan === 'satuan' && b.pack_id === null),
  );

  const logs = await semua(`SELECT tipe, pack_id FROM purchase_scan_logs WHERE purchase_id = ?`, dok.id);
  await cek('riwayat scan tersimpan (3 entri)', logs.length === 3, `entri=${logs.length}`);
  await cek('riwayat memuat barcode tak dikenal', logs.some((l: any) => l.tipe === 'tidak_dikenal'));

  const chat = await req('GET', `/api/pembelian/${dok.id}/chat`);
  await cek('GET /:id/chat menampilkan riwayat scan', chat.status === 200 && chat.data?.data?.length === 3, `entri=${chat.data?.data?.length}`);

  // --- negatif: produk kembar dalam satu box ditolak ------------------------
  const rDup = await req('POST', '/api/pembelian', {
    metode_input: 'scan',
    supplier_id: f.supId,
    warehouse_id: f.gudangId,
    items: [
      { product_id: f.p1, qty: 5, harga_beli: 10000, diskon: 0, pack_id: packId, sumber_scan: 'box' },
      { product_id: f.p1, qty: 5, harga_beli: 10000, diskon: 0, pack_id: packId, sumber_scan: 'box' },
    ],
  });
  await cek('produk kembar dalam satu pack ditolak (409)', rDup.status === 409, `status=${rDup.status}`);

  // --- stok masih nol sebelum pengesahan ------------------------------------
  const stok0 = await semua(`SELECT product_id, qty FROM stock_balances WHERE product_id IN (?,?,?)`, f.p1, f.p2, f.p3);
  await cek('stok belum bergerak saat draft', stok0.length === 0, `baris=${stok0.length}`);

  // --- chain GRN → Sahkan (sama dengan tombol UI) ---------------------------
  let rT = await req('POST', `/api/pembelian/${dok.id}/terima`, {});
  await cek('terima (GRN) sukses', rT.status === 200 && rT.data?.data?.status === 'diterima');
  let rS = await req('POST', `/api/pembelian/${dok.id}/sahkan`, {});
  await cek('sahkan sukses (faktur + hutang otomatis)', rS.status === 200 && rS.data?.data?.status === 'disahkan', `faktur=${rS.data?.data?.no_faktur ?? ''}`);

  const stok1 = await semua(`SELECT product_id, qty FROM stock_balances WHERE product_id IN (?,?,?) AND warehouse_id = ?`, f.p1, f.p2, f.p3, f.gudangId);
  const q = async (p: number) => Number(stok1.find((s: any) => Number(s.product_id) === p)?.qty ?? -1);
  await cek('stok masuk saat disahkan: p1=10, p2=30, p3=1', await q(f.p1) === 10 && await q(f.p2) === 30 && await q(f.p3) === 1, `${await q(f.p1)}/${await q(f.p2)}/${await q(f.p3)}`);

  // 2 box × 20 pcs @harga box + satuan: (5×10000 + 15×5000)×2 + 20000 = 270.000
  const pib = await q1(`SELECT COALESCE(SUM(qty * harga_beli - diskon), 0) AS dasar FROM purchase_items WHERE purchase_id = ?`, dok.id);
  const hutang = await q1(`SELECT COALESCE(SUM(total), 0) AS total FROM payables WHERE purchase_id = ?`, dok.id);
  const jurnal = await semua(`SELECT id FROM journals WHERE sumber_tipe = 'pembelian' AND sumber_id = ?`, dok.id);
  // AKUNTANSI DASAR — pengesahan TIDAK membuat jurnal (lihat uji-pembelian).
  await cek(
    'pengesahan: dasar = hutang, tanpa jurnal (Akuntansi Dasar)',
    Number(pib?.dasar) === 270000 && Number(hutang?.total) === 270000 && jurnal.length === 0,
    `dasar=${pib?.dasar} hutang=${hutang?.total} jurnal=${jurnal.length}`,
  );

  // --- void memulihkan stok --------------------------------------------------
  const rB = await req('POST', `/api/pembelian/${dok.id}/batal`, { alasan: 'Uji scan: pembatalan' });
  await cek('batal & pulihkan sukses', rB.status === 200);
  const stok2 = await semua(`SELECT product_id, qty FROM stock_balances WHERE product_id IN (?,?,?) AND warehouse_id = ?`, f.p1, f.p2, f.p3, f.gudangId);
  const q2 = async (p: number) => Number(stok2.find((s: any) => Number(s.product_id) === p)?.qty ?? -1);
  await cek('stok kembali nol setelah void', await q2(f.p1) === 0 && await q2(f.p2) === 0 && await q2(f.p3) === 0, `${await q2(f.p1)}/${await q2(f.p2)}/${await q2(f.p3)}`);
  const hutang2 = await q1(`SELECT status FROM payables WHERE purchase_id = ?`, dok.id);
  await cek('hutang dibatalkan bersama void', hutang2?.status === 'batal', `status=${hutang2?.status}`);
  const sisaLog = await q1(`SELECT COUNT(*) AS n FROM purchase_scan_logs WHERE purchase_id = ?`, dok.id);
  await cek('riwayat scan tetap utuh setelah void', Number(sisaLog?.n) === 3, `entri=${sisaLog?.n}`);

  // --- barcode box vs produk tidak boleh bertabrakan (master) ---------------
  const rTabrak = await req('POST', '/api/master/produk', {
    nama: 'SCN Uji Tabrak',
    sku: 'SCN-TABRAK',
    barcode: f.bcBox,
    harga_beli: 1000,
    harga_jual: 2000,
    stok_min: 0,
    aktif: 1,
    konversi: [],
  });
  await cek('barcode box tidak bisa dipakai produk (409)', rTabrak.status === 409, `status=${rTabrak.status}`);

  await bersihkan();
  console.log(`\n${lulus} lulus, ${gagal} gagal`);
  process.exit(gagal ? 1 : 0);
}

await main().catch(async (e) => {
  console.error('✘ Error tak terduga:', e);
  await bersihkan();
  process.exit(1);
});

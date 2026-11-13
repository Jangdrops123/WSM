// Uji integrasi metode CHATBOT modul Pembelian/Inbound — FORMAT GAYA BARIS
// (AG0: parser lama gaya bebas sudah dihapus; satu baris per barang):
// 1) Parser mengurai contoh spesifikasi (pemasok, tanggal, baris barang per
//    ukuran, satuan pcs/lusin/kodi/box, @harga, diskon %, baris "Total = …"
//    sebagai verifikasi) tanpa API eksternal, dengan penanda ⚠ kuning + saran
//    bila ambigu/tidak cocok.
// 2) Riwayat chat disimpan per dokumen (diklaim lewat chat_sesi saat draft
//    dibuat) dan dokumen masuk ke alur pengesahan yang sama.
// Master Produk tanpa varian: warna/size dibaca dari NAMA produk (satu produk
// = satu baris katalog), parser memilih product_id.
// Jalankan: npx tsx scripts/uji-chat.ts   (server API harus hidup di :3001)
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

/** Fiks UCH: produk contoh yang cocok dengan 3 teks spesifikasi.
    Nama membawa warna/size agar parser katalog (baca nama produk) mengenali. */
const CONTOH1 = 'beli dari Supplier A, kaos polos hitam size M 2 lusin harga 45000';
// Gaya baris + verifikasi "Total = …" (H1): total kodi yang diketik diverifikasi
// parser terhadap hasil hitung — baris "Total" bukan sumber jumlah.
const CONTOH2 = 'sepatu sport putih 39-43 2 kodi @120000\nTotal = 2 kd';
const CONTOH3 = '• kemeja flanel merah L 10 pcs diskon 5%\n• kemeja flanel biru XL 5 pcs diskon 5%';

interface Fiks {
  supId: number;
  gudangId: number;
  unitId: number;
  kpmM: number;
  kpmL: number;
  ssp: Record<string, number>; // size → product id
  kfm: number;
  kfb: number;
  amara: number;
}

const bersihkan = async () => {
  const sup = (await semua(`SELECT id FROM suppliers WHERE nama = 'Supplier A'`)).map((r) => Number(r.id));
  const supPh = sup.length ? sup.map(() => '?').join(',') : '-1';
  const docs = (await semua(
    `SELECT id FROM purchases WHERE supplier_id IN (${supPh})
        OR warehouse_id IN (SELECT id FROM warehouses WHERE kode = 'UCH-GD')`,
    ...sup,
  )).map((r) => Number(r.id));
  if (docs.length) {
    const dph = docs.map(() => '?').join(',');
    (await run(`DELETE FROM stock_ledger WHERE tipe_dokumen IN ('pembelian', 'pembelian_batal') AND dokumen_id IN (${dph})`, ...docs));
    (await run(`DELETE FROM journals WHERE sumber_tipe = 'pembelian' AND sumber_id IN (${dph})`, ...docs));
    (await run(`DELETE FROM payables WHERE purchase_id IN (${dph})`, ...docs));
    (await run(`DELETE FROM purchase_items WHERE purchase_id IN (${dph})`, ...docs));
    (await run(`DELETE FROM purchases WHERE id IN (${dph})`, ...docs));
  }
  // Riwayat chat yang belum terklaim (tidak menempel di dokumen mana pun).
  (await run(`DELETE FROM purchase_chat_logs WHERE chat_sesi LIKE 'UCH-%' AND purchase_id IS NULL`));
  await run(`
    DELETE FROM stock_ledger WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'UCH-%');
    DELETE FROM stock_balances WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'UCH-%');
    DELETE FROM products WHERE sku LIKE 'UCH-%';
    DELETE FROM units WHERE kode = 'UCH-PCS';
    DELETE FROM locations WHERE kode_lokasi LIKE 'UCH-%';
    DELETE FROM warehouses WHERE kode = 'UCH-GD';
    DELETE FROM suppliers WHERE nama = 'Supplier A';
  `)
};

const siapkan = async (): Fiks => {
  const supId = Number((await run(`INSERT INTO suppliers (nama, telepon, termin_hari) VALUES ('Supplier A', '081200', 0)`)).lastInsertRowid);
  const gudangId = Number((await run(`INSERT INTO warehouses (kode, nama) VALUES ('UCH-GD', 'Gudang Uji Chat')`)).lastInsertRowid);
  (await run(`INSERT INTO locations (warehouse_id, kode_lokasi, zona) VALUES (?, 'UCH-L1', 'U')`, gudangId));
  const unitId = Number((await run(`INSERT INTO units (kode, nama) VALUES ('UCH-PCS', 'Pcs Uji Chat')`)).lastInsertRowid);

  const buat = async (nama: string, sku: string, harga: number) =>
    Number(
      (await run(`INSERT INTO products (nama, sku, satuan_dasar_id, harga_beli, harga_jual) VALUES (?, ?, ?, ?, ?)`, nama, sku, unitId, harga, harga * 2)).lastInsertRowid,
    );

  const kpmM = await buat('Kaos Polos Hitam M', 'UCH-KPM-M', 40000);
  const kpmL = await buat('Kaos Polos Hitam L', 'UCH-KPM-L', 40000);

  const sspMap: Record<string, number> = {};
  for (const n of [39, 40, 41, 42, 43]) sspMap[String(n)] = await buat(`Sepatu Sport Putih ${n}`, `UCH-SSP-${n}`, 100000);

  const kfm = await buat('Kemeja Flanel Merah L', 'UCH-KFM', 30000);
  const kfb = await buat('Kemeja Flanel Biru XL', 'UCH-KFB', 35000);

  // Produk "nyata" untuk uji pemasok tak dikenal (kecocokan yakin).
  // Nama HARUS unik di katalog — katalog demo sudah punya "Amara Hitam 39",
  // nama kembar membuat kecocokan rangkap → kabur (bukan bug parser).
  const amara = await buat('Amaraux Hitam 39', 'UCH-AMARA-39', 90000);

  return { supId, gudangId, unitId, kpmM, kpmL, ssp: sspMap, kfm, kfb, amara };
};

const stok = async (produkId: number, gudangId: number) =>
  Number((await q1(`SELECT COALESCE(SUM(qty), 0) AS s FROM stock_balances WHERE product_id = ? AND warehouse_id = ?`, produkId, gudangId))?.s ?? 0);

const urai = async (teks: string, sesi: string) => await req('POST', '/api/pembelian/chat/urai', { teks, chat_sesi: sesi });

async function main() {
  await bersihkan();
  const f = await siapkan();

  // --- validasi dasar endpoint ---
  let r = await req('POST', '/api/pembelian/chat/urai', { teks: '' });
  await cek('urai tanpa teks → 400', r.status === 400, `status ${r.status}`);
  r = await req('POST', '/api/pembelian/chat/urai', { teks: 'tes', purchase_id: 999999 });
  await cek('urai dengan purchase_id asing → 404', r.status === 404, `status ${r.status}`);
  r = await req('GET', '/api/pembelian/999999/chat');
  await cek('riwayat dokumen tak dikenal → 404', r.status === 404, `status ${r.status}`);

  // --- CONTOH 1: pemasok + warna + size eksplisit + lusin + harga ---
  r = await urai(CONTOH1, 'UCH-SES-1');
  await cek('contoh 1 → 201', r.status === 201, `status ${r.status} ${r.data?.pesan ?? ''}`);
  const h1 = r.data ?? {};
  await cek('contoh 1: pemasok "Supplier A" cocok', h1.pemasok?.cocok === true && Number(h1.pemasok?.supplier_id) === f.supId, JSON.stringify(h1.pemasok));
  await cek('contoh 1: satu baris', h1.baris?.length === 1, String(h1.baris?.length));
  const b1 = h1.baris?.[0] ?? {};
  await cek('contoh 1: yakin tanpa alasan', b1.kecocokan === 'yakin' && (b1.alasan ?? []).length === 0, `${b1.kecocokan} / ${JSON.stringify(b1.alasan)}`);
  await cek('contoh 1: produk UCH-KPM-M', Number(b1.product_id) === f.kpmM && b1.baris?.sku === 'UCH-KPM-M', String(b1.product_id));
  await cek('contoh 1: warna hitam + size M', b1.warna === 'hitam' && b1.size === 'm', `${b1.warna}/${b1.size}`);
  await cek(
    'contoh 1: 2 lusin → 24 satuan dasar',
    // Gaya baris: qty = pasang terkonversi; teks ketikan terbaca di `konversi`.
    Number(b1.qty) === 24 && Number(b1.qty_dasar) === 24 && String(b1.konversi ?? '').includes('2 lusin'),
    `${b1.qty} ${b1.satuan_teks} → ${b1.qty_dasar} (${b1.konversi ?? ''})`,
  );
  await cek('contoh 1: harga 45.000', Number(b1.harga) === 45000, String(b1.harga));
  await cek(
    'contoh 1: pesan bot berisi ringkasan',
    typeof h1.pesan_bot === 'string' && h1.pesan_bot.includes('Total hitung:') && /[⚠✔]/.test(h1.pesan_bot),
    String(h1.pesan_bot ?? '').split('\n')[3] ?? '',
  );

  // --- CONTOH 2: rentang size + kodi + @harga ---
  r = await urai(CONTOH2, 'UCH-SES-2');
  await cek('contoh 2 → 201', r.status === 201, `status ${r.status}`);
  const h2 = r.data ?? {};
  await cek('contoh 2: rentang 39-43 → 5 baris', h2.baris?.length === 5, String(h2.baris?.length));
  const ukuran = (h2.baris ?? []).map((b: any) => b.size);
  await cek('contoh 2: size 39…43 berurutan', JSON.stringify(ukuran) === JSON.stringify(['39', '40', '41', '42', '43']), JSON.stringify(ukuran));
  await cek(
    'contoh 2: 2 kodi terdistribusi ke 5 size',
    // "2 kodi" = TOTAL baris → dipecah ke daftar size profil; jumlah ketikan
    // terbaca di `konversi`, totalnya diverifikasi pratinjau (total_kodi = 2).
    (h2.baris ?? []).length === 5 &&
      (h2.baris ?? []).every((b: any) => Number(b.qty_dasar) > 0 && String(b.konversi ?? '').includes('2 kodi')) &&
      Number(h2.pratinjau?.[0]?.total_kodi) === 2 &&
      (h2.baris ?? []).reduce((n: number, b: any) => n + Number(b.qty_dasar), 0) === Number(h2.pratinjau?.[0]?.total_pasang),
    `kodi ${h2.pratinjau?.[0]?.total_kodi}, pasang ${h2.pratinjau?.[0]?.total_pasang}, per baris ${(h2.baris ?? []).map((b: any) => b.qty_dasar).join('/')}`,
  );
  await cek(
    'contoh 2: verifikasi baris Total → ✔ pada pesan bot',
    typeof h2.pesan_bot === 'string' && h2.pesan_bot.includes('✔ Cocok dengan baris'),
    String(h2.pesan_bot ?? '').split('\n').find((l: string) => l.includes('Total')) ?? '',
  );
  await cek('contoh 2: tiap baris harga 120.000', (h2.baris ?? []).every((b: any) => Number(b.harga) === 120000));
  await cek('contoh 2: semua produk terpilih yakin', (h2.baris ?? []).every((b: any) => b.kecocokan === 'yakin' && Number(b.product_id) > 0));
  await cek(
    'contoh 2: produk cocok per size',
    (h2.baris ?? []).every((b: any, i: number) => Number(b.product_id) === f.ssp[String(39 + i)]),
    JSON.stringify((h2.baris ?? []).map((b: any) => b.product_id)),
  );
  await cek('contoh 2: catatan jumlah per size', (h2.catatan ?? []).some((c: string) => c.includes('Rentang size 39–43')), JSON.stringify(h2.catatan));

  // --- CONTOH 3: baris lanjutan + diskon persen global ---
  r = await urai(CONTOH3, 'UCH-SES-3');
  await cek('contoh 3 → 201', r.status === 201, `status ${r.status}`);
  const h3 = r.data ?? {};
  await cek('contoh 3: dua baris', h3.baris?.length === 2, String(h3.baris?.length));
  const b3a = h3.baris?.[0] ?? {};
  const b3b = h3.baris?.[1] ?? {};
  await cek(
    'contoh 3: baris 1 merah L 10 pcs yakin',
    b3a.warna === 'merah' && b3a.size === 'l' && Number(b3a.qty_dasar) === 10 && b3a.satuan_teks === 'pcs' && b3a.kecocokan === 'yakin',
    `${b3a.warna}/${b3a.size}/${b3a.qty_dasar}/${b3a.kecocokan}`,
  );
  await cek('contoh 3: baris 1 produk UCH-KFM', Number(b3a.product_id) === f.kfm, String(b3a.product_id));
  await cek('contoh 3: harga jatuh ke master 30.000', b3a.harga_dari_master === true && Number(b3a.harga) === 30000, `${b3a.harga_dari_master}/${b3a.harga}`);
  await cek('contoh 3: baris 2 lanjutan biru XL + produk terpilih', b3b.warna === 'biru' && b3b.size === 'xl' && Number(b3b.qty_dasar) === 5 && Number(b3b.product_id) === f.kfb, `${b3b.kecocokan}/${b3b.product_id} ${JSON.stringify(b3b.alasan)}`);
  await cek(
    'contoh 3: diskon 5% terbaca di kedua baris',
    // Parser menyimpan persen; nilai rupiah dihitung UI (qty × harga × %).
    Number(b3a.diskon_persen) === 5 && Number(b3b.diskon_persen) === 5,
    `${b3a.diskon_persen}/${b3b.diskon_persen}`,
  );
  await cek('contoh 3: pemasok tidak disebut → teks null', h3.pemasok?.teks === null && h3.pemasok?.cocok === false, JSON.stringify(h3.pemasok));

  // --- pemasok tak dikenal → penanda kuning + saran ---
  r = await urai('beli dari Supplier Zzz, Amaraux Hitam 39 1 pcs', 'UCH-SES-4');
  const h4 = r.data ?? {};
  await cek('pemasok tak dikenal: teks terbaca, cocok=false', h4.pemasok?.teks === 'Supplier Zzz' && h4.pemasok?.cocok === false, JSON.stringify(h4.pemasok));
  await cek('pemasok tak dikenal: saran tersedia', Array.isArray(h4.pemasok?.saran) && h4.pemasok.saran.length >= 1, JSON.stringify(h4.pemasok?.saran));
  await cek(
    'pemasok tak dikenal: catatan peringatan',
    (h4.catatan ?? []).some((c: string) => c.includes('belum ada di master')),
    JSON.stringify(h4.catatan),
  );
  const b4 = h4.baris?.[0] ?? {};
  await cek('produk nyata "Amaraux Hitam 39" yakin', b4.kecocokan === 'yakin' && Number(b4.product_id) === f.amara, `${b4.kecocokan}/${b4.product_id}`);

  // --- satuan box: dikenali, ditandai kuning karena tanpa konversi ---
  r = await urai('beli dari Supplier A, Kaos Polos Hitam M 3 box harga 45000', 'UCH-SES-5');
  const h5 = r.data ?? {};
  const b5 = h5.baris?.[0] ?? {};
  await cek('box dikenali sebagai satuan', b5.satuan_teks === 'box' && Number(b5.qty_dasar) === 3, `${b5.satuan_teks}/${b5.qty_dasar}`);
  await cek('box ditandai kuning (tanpa konversi)', Array.isArray(b5.alasan) && b5.alasan.some((a: string) => a.includes('box')), JSON.stringify(b5.alasan));
  await cek('box: produk tetap yakin', b5.kecocokan === 'yakin' && Number(b5.product_id) === f.kpmM, String(b5.kecocokan));

  // --- produk tak cocok → saran ---
  r = await urai('jeruk peras 5 pcs', 'UCH-SES-6');
  const h6 = r.data ?? {};
  await cek('produk tak dikenal: baris tetap ada & kuning', h6.baris?.length === 1 && h6.baris[0].kecocokan === 'tidak', String(h6.baris?.[0]?.kecocokan));
  await cek('produk tak dikenal: produk kosong', h6.baris?.[0]?.product_id === null, String(h6.baris?.[0]?.product_id));

  // --- riwayat chat sebelum dokumen: menunggu dengan chat_sesi ---
  let nPending = Number((await q1(`SELECT COUNT(*) AS n FROM purchase_chat_logs WHERE chat_sesi = 'UCH-SES-1' AND purchase_id IS NULL`))?.n ?? 0);
  await cek('pesan pra-dokumen tersimpan dengan chat_sesi', nPending === 1, String(nPending));

  // --- konfirmasi → draft metode chatbot + klaim riwayat ---
  r = await req('POST', '/api/pembelian', {
    metode_input: 'chatbot',
    supplier_id: f.supId,
    warehouse_id: f.gudangId,
    pajak_persen: 0,
    chat_sesi: 'UCH-SES-1',
    items: [{ product_id: f.kpmM, qty: 24, unit_id: f.unitId, harga_beli: 45000, diskon: 0 }],
  });
  await cek('buat draft dari chat → 201', r.status === 201, `status ${r.status} ${r.data?.pesan ?? ''}`);
  const docId = Number(r.data?.id);
  await cek('draft bermetode chatbot', r.data?.data?.metode_input === 'chatbot', String(r.data?.data?.metode_input));
  await cek('total 1.080.000 (24 × 45.000)', Number(r.data?.data?.total) === 1080000, String(r.data?.data?.total));

  const klaim = await semua(`SELECT purchase_id FROM purchase_chat_logs WHERE chat_sesi = 'UCH-SES-1'`);
  await cek('riwayat sesi terklaim ke dokumen', klaim.length > 0 && klaim.every((x) => Number(x.purchase_id) === docId), JSON.stringify(klaim));
  const sesiLain = await q1(`SELECT purchase_id FROM purchase_chat_logs WHERE chat_sesi = 'UCH-SES-2'`);
  await cek('sesi lain TIDAK ikut terklaim', sesiLain?.purchase_id === null || sesiLain === undefined, String(sesiLain?.purchase_id));

  r = await req('GET', `/api/pembelian/${docId}/chat`);
  await cek('GET riwayat chat → 200 & berisi pesan', r.status === 200 && r.data?.data?.length >= 1, `status ${r.status} n=${r.data?.data?.length}`);
  const log0 = r.data?.data?.[0] ?? {};
  await cek('riwayat membawa pesan user + bot', log0.pesan_user === CONTOH1 && typeof log0.pesan_bot === 'string' && log0.pesan_bot.length > 0, `${String(log0.pesan_user).slice(0, 30)}…`);

  r = await req('GET', '/api/pembelian?metode=chatbot');
  await cek('filter metode=chatbot menemukan dokumen', Boolean(r.data?.data?.some((b: any) => b.id === docId)));

  // --- alur pengesahan yang sama ---
  r = await req('POST', `/api/pembelian/${docId}/terima`, {});
  await cek('GRN draft chat → 200', r.status === 200, `status ${r.status} ${r.data?.pesan ?? ''}`);
  await cek('GRN: stok masih 0', await stok(f.kpmM, f.gudangId) === 0, String(await stok(f.kpmM, f.gudangId)));
  await cek('GRN: belum ada jurnal', (await semua(`SELECT id FROM journals WHERE sumber_tipe = 'pembelian' AND sumber_id = ?`, docId)).length === 0);

  r = await req('POST', `/api/pembelian/${docId}/sahkan`, {});
  await cek('sahkan draft chat → 200', r.status === 200, `status ${r.status} ${r.data?.pesan ?? ''}`);
  await cek('sahkan: stok masuk 24', await stok(f.kpmM, f.gudangId) === 24, String(await stok(f.kpmM, f.gudangId)));
  const js = await semua(`SELECT * FROM journals WHERE sumber_tipe = 'pembelian' AND sumber_id = ?`, docId);
  // AKUNTANSI DASAR (model saat ini — lihat komentar "AKUNTANSI DASAR" di
  // routes/pembelian.ts): pengesahan TIDAK membuat jurnal; pembelian tercatat
  // sebagai stok + hutang pemasok, kas bergerak saat pembayaran hutang.
  await cek('pengesahan tanpa jurnal (Akuntansi Dasar)', js.length === 0, `jurnal=${js.length}`);
  const hutang = await q1(`SELECT * FROM payables WHERE purchase_id = ?`, docId);
  await cek('hutang dibuat 1.080.000', Number(hutang?.total) === 1080000 && hutang?.status === 'belum', `${hutang?.total}/${hutang?.status}`);

  r = await req('POST', `/api/pembelian/${docId}/batal`, { alasan: 'uji chat void' });
  await cek('void draft chat → 200', r.status === 200, `status ${r.status} ${r.data?.pesan ?? ''}`);
  await cek('void: stok kembali 0', await stok(f.kpmM, f.gudangId) === 0, String(await stok(f.kpmM, f.gudangId)));
  // Model pembatalan saat ini (Akuntansi Dasar): TIDAK ada jurnal untuk
  // dibalik — pembatalan membalik stok + hutang (diverifikasi di baris atas).
  const jurnalVoid = await semua(
    `SELECT status, keterangan FROM journals WHERE sumber_tipe = 'pembelian' AND sumber_id = ? ORDER BY id`,
    docId,
  );
  await cek('void tanpa jurnal pembalik (Akuntansi Dasar)',
    jurnalVoid.length === 0,
    JSON.stringify(jurnalVoid));
  await cek('riwayat chat tetap utuh setelah void', Number((await q1(`SELECT COUNT(*) AS n FROM purchase_chat_logs WHERE purchase_id = ?`, docId))?.n ?? 0) >= 1);

  console.log(`\n${lulus} lulus, ${gagal} gagal`);
  await bersihkan();
  console.log('Fiks uji UCH dibersihkan — database dikembalikan ke kondisi semula.');
  await pool.end();
  process.exit(gagal > 0 ? 1 : 0);
}

await main().catch(async (err) => {
  console.error('✘ Galat fatal:', err instanceof Error ? err.message : err);
  await pool.end();
  process.exit(1);
});

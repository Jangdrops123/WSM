// Uji integrasi modul Pembelian/Inbound (metode Biasa):
// draft (PO opsional) → GRN → Faktur; stok + jurnal hanya saat disahkan.
// Master Produk tanpa varian — item merujuk product_id, snapshot nama+SKU.
// Jalankan: npx tsx scripts/uji-pembelian.ts   (server API harus hidup di :3001)
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

/** Hapus sisa uji sebelumnya (dokumen + fiksinya), produk dikembalikan bersih. */
const bersihkan = async () => {
  // Dokumen dicari lewat supplier DAN gudang PBL agar tidak ada yatim
  // walau salah satu sudah terhapus.
  const sup = (await semua(`SELECT id FROM suppliers WHERE nama LIKE 'PBL %' OR nama LIKE 'PBL-%'`)).map((r) => Number(r.id));
  const supPh = sup.length ? sup.map(() => '?').join(',') : '-1';
  const docs = (await semua(
    `SELECT id FROM purchases WHERE supplier_id IN (${supPh})
       OR warehouse_id IN (SELECT id FROM warehouses WHERE kode LIKE 'PBL-%')`,
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
  if (sup.length) {
    (await run(`DELETE FROM suppliers WHERE id IN (${sup.map(() => '?').join(',')})`, ...sup));
  }
  await run(`
    DELETE FROM stock_ledger WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'PBL-%');
    DELETE FROM stock_balances WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'PBL-%');
    DELETE FROM unit_conversions WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'PBL-%');
    DELETE FROM products WHERE sku LIKE 'PBL-%';
    DELETE FROM units WHERE kode LIKE 'PBL-%';
    DELETE FROM locations WHERE kode_lokasi LIKE 'PBL-%';
    DELETE FROM warehouses WHERE kode LIKE 'PBL-%';
  `)
};

interface Fiks {
  supId: number;
  gudangId: number;
  pcsId: number;
  dusId: number;
  karId: number;
  p1: number;
  p2: number;
}

const siapkan = async (): Fiks => {
  const supId = Number((await run(`INSERT INTO suppliers (nama, telepon, termin_hari) VALUES ('PBL-PT Uji Pembelian', '081200', 14)`)).lastInsertRowid);
  const gudangId = Number((await run(`INSERT INTO warehouses (kode, nama) VALUES ('PBL-GD', 'Gudang Uji Pembelian')`)).lastInsertRowid);
  (await run(`INSERT INTO locations (warehouse_id, kode_lokasi, zona) VALUES (?, 'PBL-L1', 'Zona Uji')`, gudangId));
  const pcsId = Number((await run(`INSERT INTO units (kode, nama) VALUES ('PBL-PCS', 'Pcs Uji')`)).lastInsertRowid);
  const dusId = Number((await run(`INSERT INTO units (kode, nama) VALUES ('PBL-DUS', 'Dus Uji')`)).lastInsertRowid);
  const karId = Number((await run(`INSERT INTO units (kode, nama) VALUES ('PBL-KAR', 'Karung Uji')`)).lastInsertRowid);
  // Dua produk terpisah (SKU unik) — pengganti dua varian pada skema lama.
  const p1 = Number(
    (await run(`INSERT INTO products (nama, sku, barcode, satuan_dasar_id, harga_beli, harga_jual) VALUES ('PBL Uji Kaos M', 'PBL-001', 'PBL8990001', ?, 5000, 75000)`, pcsId)).lastInsertRowid,
  );
  const p2 = Number(
    (await run(`INSERT INTO products (nama, sku, barcode, satuan_dasar_id, harga_beli, harga_jual) VALUES ('PBL Uji Kaos L', 'PBL-002', 'PBL8990002', ?, 12500, 150000)`, pcsId)).lastInsertRowid,
  );
  // 1 DUS = 12 PCS untuk p1; sengaja TIDAK ada konversi KAR untuk uji tolak.
  (await run(`INSERT INTO unit_conversions (product_id, unit_id, jumlah_per_satuan_dasar) VALUES (?, ?, 12)`, p1, dusId));
  return { supId, gudangId, pcsId, dusId, karId, p1, p2 };
};

const stok = async (produkId: number, gudangId: number) =>
  Number((await q1(`SELECT COALESCE(SUM(qty), 0) AS s FROM stock_balances WHERE product_id = ? AND warehouse_id = ?`, produkId, gudangId))?.s ?? 0);

const jurnalPembelian = async (docId: number) => await semua(`SELECT * FROM journals WHERE sumber_tipe = 'pembelian' AND sumber_id = ?`, docId);

async function main() {
  await bersihkan();
  const f = await siapkan();

  // PPN (PKP) diaktifkan langsung di settings — Akuntansi Dasar tidak punya
  // rute /api/akuntansi/ppn (pengaturan PPN kini lewat registry Pengaturan);
  // nilai dikembalikan seperti semula di akhir agar tidak memengaruhi uji lain.
  const ppnSebelum = (await q1(`SELECT nilai FROM settings WHERE kunci = 'akuntansi_ppn'`))?.nilai ?? null;
  (await run(
    `INSERT INTO settings (kunci, nilai, keterangan) VALUES ('akuntansi_ppn', ?, 'Pengaturan PPN: aktif (PKP), tarif %, harga sudah termasuk PPN')     ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai, diubah_pada = excluded.diubah_pada`,
    JSON.stringify({ aktif: true, tarif: 11, harga_termasuk: false})));
  await cek(
    'aktifkan PPN (PKP) di settings',
    JSON.parse(String((await q1(`SELECT nilai FROM settings WHERE kunci = 'akuntansi_ppn'`))?.nilai ?? '{}'))?.aktif === true,
  );

  const payload1 = {
    metode_input: 'biasa',
    supplier_id: f.supId,
    warehouse_id: f.gudangId,
    tanggal: new Date().toISOString(),
    no_po: 'PO-UJI-1',
    pajak_persen: 11,
    items: [
      { product_id: f.p1, qty: 10, unit_id: f.pcsId, harga_beli: 5000, diskon: 500 },
      { product_id: f.p2, qty: 4, unit_id: null, harga_beli: 12500, diskon: 0 },
    ],
  };
  const bareng = async (tambahan: Record<string, unknown>) => ({ ...payload1, ...tambahan });

  // --- validasi input ---
  let r = await req('POST', '/api/pembelian', await bareng({ items: [] }));
  await cek('tolak tanpa item (400)', r.status === 400, `status ${r.status}`);
  r = await req('POST', '/api/pembelian', await bareng({ supplier_id: 999999 }));
  await cek('tolak pemasok tak dikenal (400)', r.status === 400, `status ${r.status}`);
  r = await req('POST', '/api/pembelian', await bareng({ items: [{ product_id: 999999, qty: 1, harga_beli: 100 }] }));
  await cek('tolak produk tak dikenal (400)', r.status === 400, `status ${r.status}`);
  r = await req('POST', '/api/pembelian', await bareng({ items: [{ product_id: f.p1, qty: 0, harga_beli: 100 }] }));
  await cek('tolak qty 0 (400)', r.status === 400, `status ${r.status}`);
  r = await req('POST', '/api/pembelian', await bareng({ items: [{ product_id: f.p1, qty: 1, harga_beli: 1000, diskon: 999999 }] }));
  await cek('tolak diskon melebihi nilai item (400)', r.status === 400, `status ${r.status}`);
  r = await req('POST', '/api/pembelian', await bareng({ pajak_persen: 150 }));
  await cek('tolak pajak > 100% (400)', r.status === 400, `status ${r.status}`);
  r = await req('POST', '/api/pembelian', await bareng({ items: [{ product_id: f.p1, qty: 1, unit_id: f.karId, harga_beli: 1000, diskon: 0 }] }));
  await cek('tolak satuan tanpa konversi (400)', r.status === 400, `status ${r.status}`);
  r = await req('POST', '/api/pembelian', await bareng({ items: [{ product_id: f.p1, qty: 1, harga_beli: 5000 }, { product_id: f.p1, qty: 2, harga_beli: 5000 }] }));
  await cek('tolak produk kembar (409)', r.status === 409, `status ${r.status}`);

  // --- buat draft: TANPA stok/jurnal ---
  r = await req('POST', '/api/pembelian', payload1);
  await cek('buat draft → 201', r.status === 201, `status ${r.status} ${r.data?.pesan ?? ''}`);
  const d1 = r.data?.data ?? {};
  const id1 = Number(r.data?.id);
  await cek('draft berstatus draft', d1.status === 'draft', String(d1.status));
  await cek('no dokumen PB-…', String(d1.no_dokumen ?? '').startsWith('PB-'), String(d1.no_dokumen));
  await cek('no PO tersimpan', d1.no_po === 'PO-UJI-1', String(d1.no_po));
  await cek('subtotal 100.000', Number(d1.subtotal) === 100000, String(d1.subtotal));
  await cek('diskon 500', Number(d1.diskon) === 500, String(d1.diskon));
  await cek('pajak 10.945', Number(d1.pajak) === 10945, String(d1.pajak));
  await cek('total 110.445', Number(d1.total) === 110445, String(d1.total));
  await cek('draft: stok MASIH 0', await stok(f.p1, f.gudangId) === 0 && await stok(f.p2, f.gudangId) === 0);
  await cek('draft: belum ada jurnal', (await jurnalPembelian(id1)).length === 0);
  await cek('draft: belum ada hutang', Number((await q1('SELECT COUNT(*) AS c FROM payables WHERE purchase_id = ?', id1))?.c ?? 0) === 0);

  // --- pengesahan wajib lewat GRN ---
  r = await req('POST', `/api/pembelian/${id1}/sahkan`, {});
  await cek('sahkan langsung dari draft → 409', r.status === 409, `status ${r.status}`);

  // --- GRN: status saja, stok/jurnal tetap 0 ---
  r = await req('POST', `/api/pembelian/${id1}/terima`, {});
  await cek('terima (GRN) → 200', r.status === 200, `status ${r.status} ${r.data?.pesan ?? ''}`);
  const g1 = r.data?.data ?? {};
  await cek('status diterima', g1.status === 'diterima', String(g1.status));
  await cek('no GRN otomatis', String(g1.no_grn ?? '').startsWith('GRN-'), String(g1.no_grn));
  await cek('diterima_pada tercatat', Boolean(g1.diterima_pada));
  await cek('GRN: stok MASIH 0', await stok(f.p1, f.gudangId) === 0 && await stok(f.p2, f.gudangId) === 0);
  await cek('GRN: belum ada jurnal', (await jurnalPembelian(id1)).length === 0);
  r = await req('POST', `/api/pembelian/${id1}/terima`, {});
  await cek('terima dua kali → 409', r.status === 409, `status ${r.status}`);
  r = await req('PUT', `/api/pembelian/${id1}`, payload1);
  await cek('ubah setelah diterima → 409', r.status === 409, `status ${r.status}`);

  // --- pengesahan: stok + kartu + hutang dalam satu transaksi (tanpa jurnal) ---
  r = await req('POST', `/api/pembelian/${id1}/sahkan`, { no_faktur: 'INV-UJI-001', jatuh_tempo: '2026-11-30' });
  await cek('sahkan → 200', r.status === 200, `status ${r.status} ${r.data?.pesan ?? ''}`);
  const s1 = r.data?.data ?? {};
  await cek('status disahkan', s1.status === 'disahkan', String(s1.status));
  await cek('no faktur sesuai input', s1.no_faktur === 'INV-UJI-001', String(s1.no_faktur));
  await cek('stok p1 masuk 10', await stok(f.p1, f.gudangId) === 10, String(await stok(f.p1, f.gudangId)));
  await cek('stok p2 masuk 4', await stok(f.p2, f.gudangId) === 4, String(await stok(f.p2, f.gudangId)));

  const ledger = await semua(`SELECT * FROM stock_ledger WHERE tipe_dokumen = 'pembelian' AND dokumen_id = ?`, id1);
  await cek('kartu stok: 2 baris masuk', ledger.length === 2, String(ledger.length));
  const lp1 = ledger.find((l) => Number(l.product_id) === f.p1);
  await cek('kartu stok: qty_masuk 10', Number(lp1?.qty_masuk) === 10, String(lp1?.qty_masuk));
  await cek('kartu stok: saldo 10', Number(lp1?.saldo) === 10, String(lp1?.saldo));
  await cek('kartu stok: nilai unit 4.950 (net diskon)', Number(lp1?.nilai_unit) === 4950, String(lp1?.nilai_unit));

  // AKUNTANSI DASAR — pengesahan TIDAK membuat jurnal (lihat komentar
  // "AKUNTANSI DASAR" di routes/pembelian.ts): pembelian tercatat sebagai
  // stok + hutang pemasok; kas bergerak lewat dasarKas saat pembayaran hutang.
  const js = await jurnalPembelian(id1);
  await cek('pengesahan tanpa jurnal (Akuntansi Dasar)', js.length === 0, String(js.length));

  // Baris pembelian menyimpan snapshot nama + SKU (bukan rujukan varian).
  const snap = await q1(`SELECT nama_produk, sku FROM purchase_items WHERE purchase_id = ? AND product_id = ?`, id1, f.p1);
  await cek('baris beli menyimpan snapshot nama+SKU', snap?.nama_produk === 'PBL Uji Kaos M' && snap?.sku === 'PBL-001', JSON.stringify(snap));

  const hutang = await q1('SELECT * FROM payables WHERE purchase_id = ?', id1);
  await cek('hutang pemasok dibuat', Boolean(hutang));
  await cek('hutang total 110.445', Number(hutang?.total) === 110445, String(hutang?.total));
  await cek('hutang status belum', hutang?.status === 'belum', String(hutang?.status));
  await cek('jatuh tempo dari input menang', hutang?.jatuh_tempo === '2026-11-30', String(hutang?.jatuh_tempo));

  // kunci dokumen disahkan (trigger migrasi 010)
  try {
    (await run('UPDATE purchases SET subtotal = 1 WHERE id = ?', id1));
    await cek('trigger kunci dokumen disahkan', false, 'UPDATE lolos — trigger tidak bekerja');
  } catch {
    await cek('trigger kunci dokumen disahkan', true);
  }

  r = await req('POST', `/api/pembelian/${id1}/sahkan`, {});
  await cek('sahkan dua kali → 409', r.status === 409, `status ${r.status}`);
  r = await req('PUT', `/api/pembelian/${id1}`, payload1);
  await cek('ubah setelah disahkan → 409', r.status === 409, `status ${r.status}`);
  r = await req('DELETE', `/api/pembelian/${id1}`);
  await cek('hapus setelah disahkan → 409', r.status === 409, `status ${r.status}`);

  // --- dokumen 2: nomor faktur otomatis + termin pemasok ---
  r = await req('POST', '/api/pembelian', {
    metode_input: 'biasa',
    supplier_id: f.supId,
    warehouse_id: f.gudangId,
    pajak_persen: 0,
    items: [{ product_id: f.p2, qty: 1, harga_beli: 12500, diskon: 0 }],
  });
  await cek('draft kedua → 201', r.status === 201, `status ${r.status}`);
  const id2 = Number(r.data?.id);
  await req('POST', `/api/pembelian/${id2}/terima`, {});
  r = await req('POST', `/api/pembelian/${id2}/sahkan`, {});
  const s2 = r.data?.data ?? {};
  await cek('faktur otomatis FP-…', String(s2.no_faktur ?? '').startsWith('FP-'), String(s2.no_faktur));
  const tempoHarap = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  await cek('jatuh tempo ikut termin pemasok (14 hari)', s2.hutang?.jatuh_tempo === tempoHarap, `${s2.hutang?.jatuh_tempo} vs ${tempoHarap}`);
  await cek('stok p2 +1 → 5', await stok(f.p2, f.gudangId) === 5, String(await stok(f.p2, f.gudangId)));

  // --- dokumen 3: konversi satuan 2 DUS = 24 PCS ---
  r = await req('POST', '/api/pembelian', {
    metode_input: 'biasa',
    supplier_id: f.supId,
    warehouse_id: f.gudangId,
    pajak_persen: 0,
    items: [{ product_id: f.p1, qty: 2, unit_id: f.dusId, harga_beli: 60000, diskon: 0 }],
  });
  await cek('draft konversi satuan → 201', r.status === 201, `status ${r.status} ${r.data?.pesan ?? ''}`);
  const id3 = Number(r.data?.id);
  await req('POST', `/api/pembelian/${id3}/terima`, {});
  r = await req('POST', `/api/pembelian/${id3}/sahkan`, {});
  await cek('sahkan konversi → 200', r.status === 200, `status ${r.status} ${r.data?.pesan ?? ''}`);
  await cek('stok p1 +24 (2 dus × 12) → 34', await stok(f.p1, f.gudangId) === 34, String(await stok(f.p1, f.gudangId)));

  // --- metode input & daftar/filter ---
  r = await req('POST', '/api/pembelian', {
    metode_input: 'scan',
    supplier_id: f.supId,
    warehouse_id: f.gudangId,
    items: [{ product_id: f.p1, qty: 1, harga_beli: 5000, diskon: 0 }],
  });
  await cek('draft metode scan tersimpan', r.status === 201 && r.data?.data?.metode_input === 'scan', String(r.data?.data?.metode_input));
  const idScan = Number(r.data?.id);

  r = await req('GET', '/api/pembelian?metode=scan');
  await cek('filter metode=scan menemukan dokumen', Boolean(r.data?.data?.some((b: any) => b.id === idScan)));
  r = await req('GET', '/api/pembelian?status=disahkan');
  await cek('filter status=disahkan menemukan dokumen', Boolean(r.data?.data?.some((b: any) => b.id === id1)));
  r = await req('GET', '/api/pembelian?cari=INV-UJI-001');
  await cek('cari no faktur menemukan dokumen', Boolean(r.data?.data?.some((b: any) => b.id === id1)));
  r = await req('GET', `/api/pembelian/${id1}`);
  const det = r.data?.data ?? {};
  await cek('detail: items + hutang (jurnal null — Akuntansi Dasar)', Array.isArray(det.items) && det.items.length === 2 && det.jurnal == null && Boolean(det.hutang));

  // --- batal draft (tanpa efek) ---
  r = await req('POST', '/api/pembelian', {
    metode_input: 'biasa',
    supplier_id: f.supId,
    warehouse_id: f.gudangId,
    items: [{ product_id: f.p1, qty: 1, harga_beli: 5000, diskon: 0 }],
  });
  const id4 = Number(r.data?.id);
  const stokSebelumBatal = await stok(f.p1, f.gudangId);
  r = await req('POST', `/api/pembelian/${id4}/batal`, { alasan: 'uji batal draft' });
  await cek('batal draft → status batal', r.status === 200 && r.data?.data?.status === 'batal', `status ${r.status}`);
  await cek('batal draft: stok tidak berubah', await stok(f.p1, f.gudangId) === stokSebelumBatal);

  // --- batal disahkan (void): stok + hutang dipulihkan (tanpa jurnal) ---
  const v2Sebelum = await stok(f.p2, f.gudangId);
  r = await req('POST', `/api/pembelian/${id2}/batal`, { alasan: 'uji void faktur' });
  await cek('batal disahkan → 200', r.status === 200, `status ${r.status} ${r.data?.pesan ?? ''}`);
  await cek('void: stok p2 berkurang 1', await stok(f.p2, f.gudangId) === v2Sebelum - 1, `${await stok(f.p2, f.gudangId)} vs ${v2Sebelum - 1}`);
  // Akuntansi Dasar: tidak ada jurnal asli/pembalik — void membalik stok + hutang.
  const jurnalVoid2 = await jurnalPembelian(id2);
  await cek(
    'void tanpa jurnal pembalik (Akuntansi Dasar)',
    jurnalVoid2.length === 0,
    JSON.stringify(jurnalVoid2),
  );
  await cek('void: hutang → batal', (await q1('SELECT status FROM payables WHERE purchase_id = ?', id2))?.status === 'batal');
  await cek(
    'void: kartu stok keluar tercatat',
    Number((await q1(`SELECT COUNT(*) AS c FROM stock_ledger WHERE tipe_dokumen = 'pembelian_batal' AND dokumen_id = ?`, id2))?.c ?? 0) === 1,
  );
  r = await req('POST', `/api/pembelian/${id2}/batal`, {});
  await cek('batal dua kali → 409', r.status === 409, `status ${r.status}`);

  // --- hapus draft ---
  r = await req('DELETE', `/api/pembelian/${idScan}`);
  await cek('hapus draft → 200', r.status === 200, `status ${r.status}`);
  r = await req('DELETE', `/api/pembelian/${id2}`);
  await cek('hapus dokumen batal → 409', r.status === 409, `status ${r.status}`);

  console.log(`\n${lulus} lulus, ${gagal} gagal`);

  // Kembalikan database ke kondisi semula: fiks PBL hanya untuk uji ini dan
  // boleh memengaruhi pemilihan produk uji lain (uji-pos memilih produk berstok).
  await bersihkan();
  console.log('Fiks uji PBL dibersihkan — database dikembalikan ke kondisi semula.');

  // Kembalikan pengaturan PPN seperti semula (hapus bila semula tidak ada).
  if (ppnSebelum !== null) {
    (await run(`INSERT INTO settings (kunci, nilai, keterangan) VALUES ('akuntansi_ppn', ?, 'Pengaturan PPN: aktif (PKP), tarif %, harga sudah termasuk PPN')
      ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai, diubah_pada = excluded.diubah_pada`, ppnSebelum));
  } else {
    (await run(`DELETE FROM settings WHERE kunci = 'akuntansi_ppn'`));
  }

  await pool.end();
  process.exit(gagal > 0 ? 1 : 0);
}

await main().catch(async (err) => {
  console.error('✘ Galat fatal:', err);
  await pool.end();
  process.exit(1);
});

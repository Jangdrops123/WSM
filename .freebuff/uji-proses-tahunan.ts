// Uji integrasi Proses Tahunan (API :3001).
// Fixture transaksi → ringkas → pratinjau → backup → jalankan (cek!) →
// pulihkan (cek!) → bersihkan fixture. Exit 1 bila ada kegagalan.
// Pembersihan terpasang di proses keluar (aman bila uji gagal di tengah jalan).
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { bacaExcelMulti } from '../server/lib/excel.ts';

const API = 'http://127.0.0.1:3001/api/proses-tahunan';
const db = new DatabaseSync('data/app.db');
const q = <T = Record<string, unknown>>(sql: string, ...p: unknown[]): T[] =>
  db.prepare(sql).all(...(p as never[])) as T[];
const satu = <T = Record<string, unknown>>(sql: string, ...p: unknown[]): T =>
  db.prepare(sql).get(...(p as never[])) as T;
const jml = (t: string): number => Number(satu<{ n: number }>(`SELECT COUNT(*) n FROM ${t}`).n);
const balancesAwal = JSON.stringify(q('SELECT product_id, warehouse_id, qty FROM stock_balances ORDER BY id'));

let lulus = 0;
let gagal = 0;
function cek(nama: string, kondisi: boolean, detail?: unknown): void {
  if (kondisi) {
    lulus++;
    console.log(`  ✔ ${nama}`);
  } else {
    gagal++;
    console.log(`  ✘ ${nama}`, detail !== undefined ? JSON.stringify(detail) : '');
  }
}

async function gjson<T>(path: string): Promise<{ status: number; data: T }> {
  const res = await fetch(`${API}${path}`);
  const data = (await res.json().catch(() => null)) as T;
  return { status: res.status, data };
}
async function pjson<T>(path: string, body: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as T;
  return { status: res.status, data };
}

/** Nets per akun dari jurnal disahkan (subquery aman terhadap jurnal batal/draft). */
const nets = (): Record<string, number> => {
  const rows = q<{ kode: string; net: number }>(
    `SELECT a.kode,
            COALESCE((SELECT SUM(jl.debit - jl.kredit) FROM journal_lines jl
                      JOIN journals j ON j.id = jl.journal_id
                      WHERE j.status = 'disahkan' AND jl.account_id = a.id), 0) AS net
     FROM accounts a`,
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.kode] = Math.round(Number(r.net));
  return out;
};
const seimbangBuku = (): boolean => Object.values(nets()).reduce((a, b) => a + b, 0) === 0;
const balances = (): string => JSON.stringify(q('SELECT product_id, warehouse_id, qty FROM stock_balances ORDER BY id'));

// --- Pembersihan fixture (idempoten; dipanggil eksplisit & saat proses keluar) ---
const deltaLog: [number, number][] = [];
let sudahBersih = false;
function bersihkan(): void {
  if (sudahBersih) return;
  sudahBersih = true;
  try {
    db.prepare(
      `UPDATE journals SET status='batal' WHERE status='disahkan'
         AND (no_jurnal LIKE 'JU-UJI-%' OR sumber_tipe IN ('jurnal_penutup','saldo_awal'))`,
    ).run();
    db.prepare(`DELETE FROM journals WHERE no_jurnal LIKE 'JU-UJI-%' OR sumber_tipe IN ('jurnal_penutup','saldo_awal')`).run();
    db.prepare(
      `DELETE FROM stock_ledger WHERE
         (tipe_dokumen='penjualan' AND dokumen_id IN (SELECT id FROM sales WHERE no_dokumen LIKE 'INV-UJI-%'))
      OR (tipe_dokumen='retur'     AND dokumen_id IN (SELECT id FROM sale_returns WHERE no_dokumen LIKE 'RET-UJI-%'))
      OR (tipe_dokumen='pembelian' AND dokumen_id IN (SELECT id FROM purchases WHERE no_dokumen LIKE 'PB-UJI-%'))`,
    ).run();
    db.prepare(`DELETE FROM receivables WHERE sale_id IN (SELECT id FROM sales WHERE no_dokumen LIKE 'INV-UJI-%')`).run();
    db.prepare(`DELETE FROM sale_returns WHERE no_dokumen LIKE 'RET-UJI-%'`).run();
    db.prepare(`DELETE FROM sales WHERE no_dokumen LIKE 'INV-UJI-%'`).run();
    db.prepare(`DELETE FROM payables WHERE purchase_id IN (SELECT id FROM purchases WHERE no_dokumen LIKE 'PB-UJI-%')`).run();
    db.prepare(`DELETE FROM purchases WHERE no_dokumen LIKE 'PB-UJI-%'`).run();
    db.prepare(`DELETE FROM opname_sessions WHERE no_dokumen='OP-UJI-D'`).run();
    db.prepare(`DELETE FROM stock_transfers WHERE no_dokumen='TR-UJI-D'`).run();
    db.prepare(`DELETE FROM customers WHERE nama='Pelanggan Uji PT'`).run();
    db.prepare(`DELETE FROM suppliers WHERE nama='Pemasok Uji PT'`).run();
    for (const [produk, delta] of deltaLog) {
      db.prepare(`UPDATE stock_balances SET qty = qty - ? WHERE product_id=? AND warehouse_id=4`).run(delta, produk);
    }
    db.prepare(`DELETE FROM annual_processes`).run();
    db.prepare(`DELETE FROM audit_logs WHERE aksi IN ('proses_tahunan','pulihkan')`).run();
    db.prepare(`DELETE FROM document_counters WHERE kunci IN ('jurnal-2026','proses-tahunan-2026')`).run();
    try { fs.unlinkSync('.freebuff/backup-uji.xlsx'); } catch { /* */ }
    try { fs.unlinkSync('.freebuff/bukti-uji.xlsx'); } catch { /* */ }
    console.log('\n[cleanup] fixture dibersihkan.');
  } catch (e) {
    console.error('[cleanup] GAGAL:', e instanceof Error ? e.message : e);
  }
}
process.on('exit', bersihkan);
process.on('uncaughtException', (e) => {
  console.error('UNCAUGHT:', e);
  bersihkan();
  process.exit(1);
});

// ---------------------------------------------------------------------------
// 1. Fixture — semua tanggal ≤ 2026-10-10, gudang 4
// ---------------------------------------------------------------------------
console.log('\n== Fixture transaksi ==');
const W = 4;
db.exec(`INSERT INTO customers (nama) VALUES ('Pelanggan Uji PT')`);
db.exec(`INSERT INTO suppliers (nama) VALUES ('Pemasok Uji PT')`);
const custId = Number(satu<{ id: number }>(`SELECT id FROM customers WHERE nama='Pelanggan Uji PT'`).id);
const supId = Number(satu<{ id: number }>(`SELECT id FROM suppliers WHERE nama='Pemasok Uji PT'`).id);
const ak = (kode: string): number => Number(satu<{ id: number }>(`SELECT id FROM accounts WHERE kode=?`, kode).id);

function jurnalFixture(no: string, tgl: string, keterangan: string, baris: [number, number, number][]): void {
  const id = Number(
    db
      .prepare(
        `INSERT INTO journals (no_jurnal, tanggal, period_id, sumber_tipe, sumber_id, keterangan, status, dibuat_oleh)
         VALUES (?, ?, 1, 'uji', 0, ?, 'draft', 1)`,
      )
      .run(no, tgl, keterangan).lastInsertRowid,
  );
  const ln = db.prepare(
    `INSERT INTO journal_lines (journal_id, account_id, debit, kredit, keterangan) VALUES (?, ?, ?, ?, ?)`,
  );
  for (const [akun, dr, kr] of baris) ln.run(id, akun, dr, kr, keterangan);
  db.prepare(`UPDATE journals SET status='disahkan' WHERE id=?`).run(id);
}
function ledger(tgl: string, produk: number, tipe: string, dok: number, masuk: number, keluar: number, nilai: number): void {
  db.prepare(
    `INSERT INTO stock_ledger (tanggal, product_id, warehouse_id, location_id, tipe_dokumen, dokumen_id, qty_masuk, qty_keluar, saldo, nilai_unit, user_id)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 0, ?, 1)`,
  ).run(tgl, produk, W, tipe, dok, masuk, keluar, nilai);
}
function balDelta(produk: number, delta: number): void {
  db.prepare(`UPDATE stock_balances SET qty = qty + ? WHERE product_id=? AND warehouse_id=?`).run(delta, produk, W);
  deltaLog.push([produk, delta]);
}
function sale(no: string, tgl: string, status: string, total: number): number {
  return Number(
    db
      .prepare(
        `INSERT INTO sales (no_dokumen, tanggal, kasir_id, customer_id, warehouse_id, subtotal, total, status, dibuat_oleh)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, 1)`,
      )
      .run(no, tgl, custId, W, total, total, status).lastInsertRowid,
  );
}
function itemPenjualan(saleId: number, produk: number, qty: number, harga: number): void {
  db.prepare(
    `INSERT INTO sale_items (sale_id, product_id, nama_produk, sku, qty, harga, subtotal, hpp)
     VALUES (?, ?, 'Produk Uji', 'UJI', ?, ?, ?, 0)`,
  ).run(saleId, produk, qty, harga, qty * harga);
}

// A — penjualan kredit BELUM LUNAS → DIPERTAHANKAN (+ peringatan piutang)
const idA = sale('INV-UJI-A', '2026-05-15', 'disahkan', 75000);
itemPenjualan(idA, 14, 1, 75000);
db.prepare(`INSERT INTO receivables (sale_id, customer_id, jatuh_tempo, total, terbayar, status) VALUES (?, ?, '2026-06-15', 75000, 0, 'belum')`).run(idA, custId);
ledger('2026-05-15T10:00:00.000Z', 14, 'penjualan', idA, 0, 1, 40000); balDelta(14, -1);
jurnalFixture('JU-UJI-01', '2026-05-15', 'Penjualan kredit uji A', [[ak('1100'), 75000, 0], [ak('4001'), 0, 75000]]);
jurnalFixture('JU-UJI-02', '2026-05-15', 'HPP uji A', [[ak('5001'), 40000, 0], [ak('1200'), 0, 40000]]);

// B — penjualan DRAFT → DIPERTAHANKAN
sale('INV-UJI-B', '2026-06-01', 'draft', 25000);

// C — penjualan tunai SELESAI → DIHAPUS, plus retur masuk atas C
const idC = sale('INV-UJI-C', '2026-07-04', 'disahkan', 50000);
itemPenjualan(idC, 13, 1, 50000);
ledger('2026-07-04T09:00:00.000Z', 13, 'penjualan', idC, 0, 1, 30000); balDelta(13, -1);
jurnalFixture('JU-UJI-03', '2026-07-04', 'Penjualan tunai uji C', [[ak('1001'), 50000, 0], [ak('4001'), 0, 50000]]);
jurnalFixture('JU-UJI-04', '2026-07-04', 'HPP uji C', [[ak('5001'), 30000, 0], [ak('1200'), 0, 30000]]);

const idRetur = Number(
  db
    .prepare(`INSERT INTO sale_returns (no_dokumen, sale_id, tanggal, total, status, dibuat_oleh) VALUES ('RET-UJI-C', ?, '2026-09-01', 30000, 'disahkan', 1)`)
    .run(idC).lastInsertRowid,
);
ledger('2026-09-01T09:00:00.000Z', 13, 'retur', idRetur, 1, 0, 30000); balDelta(13, 1);
jurnalFixture('JU-UJI-05', '2026-09-01', 'Retur masuk uji', [[ak('4001'), 30000, 0], [ak('1001'), 0, 30000]]);
jurnalFixture('JU-UJI-06', '2026-09-01', 'Retur stok uji', [[ak('1200'), 30000, 0], [ak('5001'), 0, 30000]]);

// D1 — pembelian LUNAS → DIHAPUS
const idD1 = Number(
  db
    .prepare(`INSERT INTO purchases (no_dokumen, tanggal, supplier_id, warehouse_id, subtotal, total, status, dibuat_oleh) VALUES ('PB-UJI-1', '2026-08-01', ?, ?, 100000, 100000, 'disahkan', 1)`)
    .run(supId, W).lastInsertRowid,
);
db.prepare(`INSERT INTO purchase_items (purchase_id, product_id, nama_produk, sku, qty, harga_beli, diskon, subtotal) VALUES (?, 15, 'Produk Uji', 'UJI', 2, 50000, 0, 100000)`).run(idD1);
db.prepare(`INSERT INTO payables (purchase_id, supplier_id, total, terbayar, status) VALUES (?, ?, 100000, 100000, 'lunas')`).run(idD1, supId);
ledger('2026-08-01T09:00:00.000Z', 15, 'pembelian', idD1, 2, 0, 50000); balDelta(15, 2);
jurnalFixture('JU-UJI-07', '2026-08-01', 'Pembelian uji D1', [[ak('1200'), 100000, 0], [ak('2100'), 0, 100000]]);
jurnalFixture('JU-UJI-08', '2026-08-01', 'Pembayaran hutang D1', [[ak('2100'), 100000, 0], [ak('1001'), 0, 100000]]);

// D2 — pembelian HUTANG BELUM LUNAS → DIPERTAHANKAN (+ peringatan hutang)
const idD2 = Number(
  db
    .prepare(`INSERT INTO purchases (no_dokumen, tanggal, supplier_id, warehouse_id, subtotal, total, status, dibuat_oleh) VALUES ('PB-UJI-2', '2026-08-20', ?, ?, 60000, 60000, 'disahkan', 1)`)
    .run(supId, W).lastInsertRowid,
);
db.prepare(`INSERT INTO purchase_items (purchase_id, product_id, nama_produk, sku, qty, harga_beli, diskon, subtotal) VALUES (?, 16, 'Produk Uji', 'UJI', 1, 60000, 0, 60000)`).run(idD2);
db.prepare(`INSERT INTO payables (purchase_id, supplier_id, total, terbayar, status) VALUES (?, ?, 60000, 0, 'belum')`).run(idD2, supId);
ledger('2026-08-20T09:00:00.000Z', 16, 'pembelian', idD2, 1, 0, 60000); balDelta(16, 1);
jurnalFixture('JU-UJI-09', '2026-08-20', 'Pembelian uji D2', [[ak('1200'), 60000, 0], [ak('2100'), 0, 60000]]);

// Draft opname + transfer → peringatan tertahan
db.prepare(`INSERT INTO opname_sessions (no_dokumen, warehouse_id, tanggal, status, penanggung_jawab_id) VALUES ('OP-UJI-D', ?, '2026-06-15', 'draft', 1)`).run(W);
db.prepare(`INSERT INTO stock_transfers (no_dokumen, dari_warehouse, ke_warehouse, status, tanggal) VALUES ('TR-UJI-D', 4, 5, 'draft', '2026-06-20')`).run();

const sebelum = { nets: nets(), balances: balances() };
console.log('  nets sebelum:', JSON.stringify(sebelum.nets), 'seimbang:', seimbangBuku());

try {
  // -------------------------------------------------------------------------
  // 2. Ringkas & pratinjau (Langkah 1 & 3)
  // -------------------------------------------------------------------------
  console.log('\n== Langkah 1: ringkas ==');
  const r1 = await gjson<any>(`/ringkas?sampai=2026-10-10`);
  cek('HTTP 200 ringkas', r1.status === 200);
  cek('penjualan=1', r1.data.ringkas.penjualan === 1, r1.data.ringkas);
  cek('pembelian=1 (D1; D2 tertahan)', r1.data.ringkas.pembelian === 1, r1.data.ringkas);
  cek('retur_masuk=1', r1.data.ringkas.retur_masuk === 1, r1.data.ringkas);
  cek('persediaan_sub=14', r1.data.ringkas.persediaan_sub === 14, r1.data.ringkas);
  cek('jurnal=9', r1.data.ringkas.jurnal === 9, r1.data.ringkas);
  cek('peringatan: draft penjualan', r1.data.peringatan.some((p: string) => p.includes('draft')));
  cek('peringatan: piutang 75.000', r1.data.tertahan.penjualanPiutang === 1 && r1.data.tertahan.piutangSisa === 75000, r1.data.tertahan);
  cek('peringatan: hutang 60.000', r1.data.tertahan.pembelianHutang === 1 && r1.data.tertahan.hutangSisa === 60000, r1.data.tertahan);
  cek('peringatan: opname & transfer draft', r1.data.tertahan.opnameDraft === 1 && r1.data.tertahan.transferDraft === 1, r1.data.tertahan);

  const r1s = await gjson<any>(`/ringkas?sampai=2026-10-10&gudang_id=4`);
  cek('ringkas terbatas gudang → 200', r1s.status === 200, r1s);

  console.log('\n== Langkah 3: pratinjau ==');
  const r3 = await gjson<any>(`/pratinjau?sampai=2026-10-10`);
  cek('HTTP 200 pratinjau', r3.status === 200);
  cek('pratinjau COCOK', r3.data.cocok === true, r3.data.penyebab);
  const r3s = await gjson<any>(`/pratinjau?sampai=2026-10-10&gudang_id=4`);
  cek('pratinjau terbatas gudang → 200 & cocok', r3s.status === 200 && r3s.data.cocok === true, r3s.data?.penyebab);
  const baris = (r3.data.baris ?? []) as any[];
  const cari = (k: string) => baris.find((b) => b.kategori.startsWith(k));
  cek('selisih Stok = 0', cari('Stok')?.selisih === 0, cari('Stok'));
  cek('Piutang 75.000 selisih 0', cari('Piutang')?.sebelum === 75000 && cari('Piutang')?.selisih === 0, cari('Piutang'));
  cek('Hutang 60.000 selisih 0', cari('Hutang')?.sebelum === 60000 && cari('Hutang')?.selisih === 0, cari('Hutang'));
  cek('Kas/Bank -80.000 selisih 0', cari('Kas/Bank')?.sebelum === -80000 && cari('Kas/Bank')?.selisih === 0, cari('Kas/Bank'));
  cek('Pendapatan ditutup (alasan)', cari('Pendapatan')?.sesudah === 0 && Boolean(cari('Pendapatan')?.alasan), cari('Pendapatan'));
  cek('Laba Ditahan sesudah = 55.000', cari('Laba Ditahan (3100)')?.sesudah === 55000, cari('Laba Ditahan (3100)'));
  const rincian = r3.data.rincian ?? {};
  cek('rincian stok ada', Array.isArray(rincian.stok) && rincian.stok.length > 0, rincian.stok?.length);
  cek('rincian piutang 1×75.000', rincian.piutang?.length === 1 && rincian.piutang[0].sisa === 75000, rincian.piutang);
  cek('rincian hutang 1×60.000', rincian.hutang?.length === 1 && rincian.hutang[0].sisa === 60000, rincian.hutang);

  // -------------------------------------------------------------------------
  // 3. Backup (Langkah 2)
  // -------------------------------------------------------------------------
  console.log('\n== Langkah 2: backup .xlsx ==');
  const resB = await fetch(`${API}/backup?sampai=2026-10-10`);
  const bufB = Buffer.from(await resB.arrayBuffer());
  cek('HTTP 200 backup', resB.status === 200);
  cek('backup .xlsx PK', bufB.length > 5000 && bufB[0] === 0x50 && bufB[1] === 0x4b, bufB.length);
  fs.writeFileSync('.freebuff/backup-uji.xlsx', bufB);
  const sheets = await bacaExcelMulti(bufB);
  const shJudul = sheets.map((s) => s.judul);
  cek(
    'sheet Proses meta',
    sheets.find((s) => s.judul === 'Proses')?.baris.some((r) => r.kunci === 'jenis' && r.nilai === 'backup-proses-tahunan') ?? false,
  );
  const nPenjualan = sheets.find((s) => s.judul === 'Penjualan')?.baris.length ?? -1;
  const nKartu = sheets.find((s) => s.judul === 'Kartu Stok')?.baris.length ?? -1;
  const nJurnal = sheets.find((s) => s.judul === 'Jurnal')?.baris.length ?? -1;
  cek('sheet Penjualan = 1 (C)', nPenjualan === 1, nPenjualan);
  cek('sheet Kartu Stok = 26', nKartu === 26, nKartu);
  cek('sheet Jurnal = 9', nJurnal === 9, nJurnal);
  cek('22 sheet', shJudul.length === 22, shJudul);

  // -------------------------------------------------------------------------
  // 4. Jalankan (Langkah 4)
  // -------------------------------------------------------------------------
  console.log('\n== Langkah 4: jalankan ==');
  const salah = await pjson<any>(`/jalankan`, { sampai: '2026-10-10', kata: 'HAPUS', sandi: 'salah' });
  cek('sandi salah → 401', salah.status === 401, salah);
  const salahKata = await pjson<any>(`/jalankan`, { sampai: '2026-10-10', kata: 'hapus', sandi: '1234' });
  cek('kata bukan HAPUS → 400', salahKata.status === 400, salahKata);

  const jalan = await pjson<any>(`/jalankan`, { sampai: '2026-10-10', kata: 'HAPUS', sandi: '1234' });
  cek('jalankan → 200', jalan.status === 200, jalan);
  const L = jalan.data ?? {};
  cek('no_proses PT-2026-', String(L.no_proses ?? '').startsWith('PT-2026-'), L.no_proses);
  cek('laporan: penjualan 1 & pembelian 1 & retur 1', L.dihapus?.penjualan === 1 && L.dihapus?.pembelian === 1 && L.dihapus?.retur_masuk === 1, L.dihapus);
  cek('laporan: sub 14, jurnal 9', L.dihapus?.persediaan_sub === 14 && L.dihapus?.jurnal === 9, L.dihapus);
  cek('laporan: total 26', L.dihapus?.total === 26, L.dihapus);
  cek('stok sebelum == sesudah', L.stok?.sama === true && L.stok.sebelum === L.stok.sesudah, L.stok);
  cek('jurnal penutup & pembuka dibuat', L.saldo_awal?.id_jurnal_penutup > 0 && L.saldo_awal?.id_jurnal_pembuka > 0, L.saldo_awal);

  const sesudahNets = nets();
  cek('akun 1001 tidak berubah (-80.000)', sesudahNets['1001'] === -80000, sesudahNets);
  cek('piutang tetap 75.000', sesudahNets['1100'] === 75000, sesudahNets);
  cek('persediaan tetap 120.000', sesudahNets['1200'] === 120000, sesudahNets);
  cek('hutang tetap -60.000', sesudahNets['2100'] === -60000, sesudahNets);
  cek('pendapatan ditutup → 0', sesudahNets['4001'] === 0, sesudahNets);
  cek('beban ditutup → 0', sesudahNets['5001'] === 0, sesudahNets);
  cek('laba ditahan = -55.000 (kredit)', sesudahNets['3100'] === -55000, sesudahNets);
  cek('pembukuan seimbang', seimbangBuku(), sesudahNets);
  cek('stock_balances IDENTIK', balances() === sebelum.balances);
  cek('sales: C hilang, A & B ada', jml('sales') === 2 && !q(`SELECT id FROM sales WHERE no_dokumen='INV-UJI-C'`).length && !!q(`SELECT id FROM sales WHERE no_dokumen='INV-UJI-A'`).length, jml('sales'));
  cek('purchases tinggal D2', jml('purchases') === 1, jml('purchases'));
  cek('retur hilang', jml('sale_returns') === 0);
  cek('sub docs hilang (14)', jml('sub_stock_docs') === 0, jml('sub_stock_docs'));
  cek('draft opname & transfer bertahan', jml('opname_sessions') === 1 && jml('stock_transfers') === 1);
  cek('piutang & hutang belum lunas bertahan', jml('receivables') === 1 && jml('payables') === 1, { r: jml('receivables'), p: jml('payables') });
  const led = q<{ s: number }>(
    `SELECT COALESCE(SUM(CASE WHEN tanggal < '2026-10-11' AND tipe_dokumen <> 'saldo_awal' THEN 1 ELSE 0 END),0) s FROM stock_ledger`,
  )[0];
  cek('kartu stok lama ≤ batas = 0', Number(led.s) === 0, led);
  const saldoAwal = q<any>(`SELECT * FROM stock_ledger WHERE tipe_dokumen='saldo_awal'`);
  cek('baris Saldo Awal dibuat', saldoAwal.length > 0, saldoAwal.length);
  cek(
    'tanggal Saldo Awal = 11/10/2026 (waktu lokal)',
    saldoAwal.every((r) => {
      const d = new Date(String(r.tanggal));
      return !Number.isNaN(d.getTime()) && d.getFullYear() === 2026 && d.getMonth() === 9 && d.getDate() === 11;
    }),
    saldoAwal.map((r) => r.tanggal),
  );
  const jurnalBaru = q<any>(`SELECT sumber_tipe, COUNT(*) n FROM journals GROUP BY sumber_tipe`);
  cek('jurnal penutup & saldo_awal ada', jurnalBaru.some((j) => j.sumber_tipe === 'jurnal_penutup') && jurnalBaru.some((j) => j.sumber_tipe === 'saldo_awal'), jurnalBaru);

  // Daftar & bukti
  const rDaftar = await gjson<any>(`/daftar`);
  const barisProses = rDaftar.data.data ?? [];
  cek(
    'daftar: proses ini di urutan teratas (riwayat menumpuk)',
    barisProses.length >= 1 && barisProses[0]?.no_proses === L.no_proses,
    barisProses.map((p: { no_proses: string }) => p.no_proses),
  );
  const idProses = barisProses[0]?.id;
  const resBukti = await fetch(`${API}/${idProses}/bukti`);
  const bufBukti = Buffer.from(await resBukti.arrayBuffer());
  cek('bukti HTTP 200 & PK', resBukti.status === 200 && bufBukti[0] === 0x50 && bufBukti[1] === 0x4b, resBukti.status);
  fs.writeFileSync('.freebuff/bukti-uji.xlsx', bufBukti);
  const shBukti = await bacaExcelMulti(bufBukti);
  cek('bukti: sheet Saldo Akhir vs Saldo Awal', shBukti.some((s) => s.judul === 'Saldo Akhir vs Saldo Awal'), shBukti.map((s) => s.judul));
  const shSaldoStok = shBukti.find((s) => s.judul === 'Saldo Awal Stok');
  cek('bukti: label Saldo Awal', (shSaldoStok?.baris.length ?? 0) > 0 && shSaldoStok!.baris.every((r) => r.label === 'Saldo Awal'));
  const shJbuka = shBukti.find((s) => s.judul === 'Jurnal Pembuka');
  cek('bukti: jurnal pembuka berisi neraca + pendapatan/beban', ['1100', '1200', '2100', '4001', '5001'].every((k) => shJbuka!.baris.some((r) => r.kode === k)), shJbuka?.baris);
  const shJtutup = shBukti.find((s) => s.judul === 'Jurnal Penutup');
  cek('bukti: jurnal penutup 4001/5001/3100', ['4001', '5001', '3100'].every((k) => shJtutup!.baris.some((r) => r.kode === k)), shJtutup?.baris);

  // -------------------------------------------------------------------------
  // 5. Pulihkan dari backup
  // -------------------------------------------------------------------------
  console.log('\n== Pulihkan dari backup ==');
  const bufAsli = fs.readFileSync('.freebuff/backup-uji.xlsx');
  async function kirimPulih(buf: Buffer, no: string): Promise<{ status: number; data: any }> {
    const res = await fetch(`${API}/pulihkan`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-no-proses': no },
      body: buf,
    });
    return { status: res.status, data: (await res.json().catch(() => null)) as any };
  }
  const salahNo = await kirimPulih(bufAsli, 'PT-9999-9999');
  cek('no proses salah → 404', salahNo.status === 404, salahNo);
  const pulih = await kirimPulih(bufAsli, String(barisProses[0]?.no_proses));
  cek('pulihkan → 200', pulih.status === 200, pulih);

  const netsPulih = nets();
  cek('nets kembali PERSIS seperti sebelum', JSON.stringify(netsPulih) === JSON.stringify(sebelum.nets), { sebelum: sebelum.nets, pulih: netsPulih });
  cek('pembukuan seimbang setelah pulih', seimbangBuku());
  cek('stock_balances tetap identik', balances() === sebelum.balances);
  cek('sales kembali 3', jml('sales') === 3, jml('sales'));
  cek('purchases kembali 2', jml('purchases') === 2, jml('purchases'));
  cek('retur kembali 1', jml('sale_returns') === 1);
  cek('sub docs kembali 14', jml('sub_stock_docs') === 14, jml('sub_stock_docs'));
  cek('kartu stok kembali 26', jml('stock_ledger') === 26, jml('stock_ledger'));
  cek('baris Saldo Awal proses hilang', q(`SELECT id FROM stock_ledger WHERE tipe_dokumen='saldo_awal'`).length === 0);
  cek('jurnal penutup/pembuka hilang', q(`SELECT id FROM journals WHERE sumber_tipe IN ('jurnal_penutup','saldo_awal')`).length === 0);
  const prosesRow = q<any>(`SELECT dipulihkan_pada FROM annual_processes ORDER BY id DESC LIMIT 1`)[0];
  cek('ditandai dipulihkan', Boolean(prosesRow?.dipulihkan_pada), prosesRow);
  const pulih2 = await kirimPulih(bufAsli, String(barisProses[0]?.no_proses));
  cek('pulihkan kedua → 409', pulih2.status === 409, pulih2);
} catch (e) {
  gagal++;
  console.error('\nKEGAGALAN TAK TERDUGA:', e instanceof Error ? e.message : e);
}

// ---------------------------------------------------------------------------
// 6. Bersihkan fixture + cek akhir
// ---------------------------------------------------------------------------
console.log('\n== Bersihkan fixture ==');
bersihkan();
cek('final: sales 0', jml('sales') === 0, jml('sales'));
cek('final: journals 0', jml('journals') === 0, jml('journals'));
cek('final: stock_ledger 21', jml('stock_ledger') === 21, jml('stock_ledger'));
cek('final: sub docs 14', jml('sub_stock_docs') === 14, jml('sub_stock_docs'));
cek('final: balances persis', balances() === balancesAwal);
cek('final: annual_processes 0', jml('annual_processes') === 0, jml('annual_processes'));
cek('final: nets bersih', Object.values(nets()).every((v) => v === 0), nets());

console.log(`\n=== HASIL: ${lulus} lulus, ${gagal} gagal ===`);
process.exit(gagal > 0 ? 1 : 0);

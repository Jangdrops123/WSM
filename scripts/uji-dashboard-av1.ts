/* Uji API Dashboard: preferensi tampilan kartu (per pengguna & bawaan peran),
   ringkasan KPI/grafik/tabel, pengingat faktur (piutang POS + hutang pembelian,
   urgensi jatuh tempo), pengaturan pengingat, dan catat pembayaran
   (pembaharuan terbayar + mutasi kas masuk/keluar — Akuntansi Dasar). */
import { all, get, pool, run } from '../server/db.pg.ts';
import { headerUji } from './sesi-uji.mjs';

const BASE = `${process.env.BASE ?? 'http://127.0.0.1:3001'}/api`;
let lulus = 0;
let gagal = 0;

const cek = async (nama: string, kondisi: boolean, info = '') => {
  if (kondisi) {
    lulus++;
    console.log(`✔ ${nama}`);
  } else {
    gagal++;
    console.log(`✘ ${nama} ${info}`);
  }
};

const jalan = async <T = any>(metod: string, path: string, body?: unknown): Promise<{ status: number; data: T }> => {
  const res = await fetch(`${BASE}${path}`, {
    method: metod,
    headers: await headerUji(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data: data as T };
};

const q1 = async <T = any>(sql: string, ...p: unknown[]): Promise<T | undefined> => (await get(sql, ...(p as never[]))) as T | undefined;
const jml = async (sql: string, ...p: unknown[]): Promise<number> => Number((await q1<{ n: number }>(sql, ...p))?.n ?? 0);

const SEMUA_KARTU = [
  'pintasan', 'kpi-penjualan', 'kpi-transaksi', 'kpi-laba', 'kpi-stok', 'kpi-piutang',
  'kpi-menipis', 'pengingat', 'grafik-7hari', 'grafik-metode', 'grafik-terlaris',
  'grafik-vs', 'tabel-transaksi', 'tabel-menipis',
];

/* Bersihkan seluruh data uji dashboard (idempoten; pola sama dengan uji-pos:
   jurnal disahkan wajib dibatalkan dulu sebelum barisnya bisa dihapus). */
async function bersihkanUji(): void {
  // Penjualan uji (POS): kembalikan stok lalu hapus dokumen + jurnalnya.
  const sisa = (await all(`SELECT id, warehouse_id FROM sales`)) as { id: number; warehouse_id: number }[];
  for (const s of sisa) {
    const baris = (await all(`SELECT product_id, qty FROM sale_items WHERE sale_id = ?`, s.id)) as { product_id: number; qty: number }[];
    for (const b of baris) {
      (await run(`INSERT INTO stock_balances (product_id, warehouse_id, qty) VALUES (?, ?, ?) ON CONFLICT (product_id, warehouse_id) DO UPDATE SET qty = stock_balances.qty + excluded.qty`, b.product_id, s.warehouse_id, b.qty));
    }
    (await run(`UPDATE journals SET status = 'batal' WHERE sumber_tipe IN ('penjualan', 'hpp', 'pembayaran', 'retur') AND status = 'disahkan' AND (sumber_id = ? OR sumber_id IN (SELECT id FROM receivables WHERE sale_id = ?))`, s.id, s.id));
    (await run(`DELETE FROM journal_lines WHERE journal_id IN (SELECT id FROM journals WHERE sumber_tipe IN ('penjualan', 'hpp') AND sumber_id = ?)`, s.id));
    (await run(`DELETE FROM journals WHERE sumber_tipe IN ('penjualan', 'hpp') AND sumber_id = ?`, s.id));
    (await run(`DELETE FROM receivables WHERE sale_id = ?`, s.id));
    (await run(`DELETE FROM sale_payments WHERE sale_id = ?`, s.id));
    (await run(`DELETE FROM sale_items WHERE sale_id = ?`, s.id));
    (await run(`DELETE FROM stock_ledger WHERE tipe_dokumen = 'penjualan' AND dokumen_id = ?`, s.id));
    (await run(`DELETE FROM sales WHERE id = ?`, s.id));
  }
  // Kas pembayaran piutang/hutang buatan /dashboard/pelunasan (Akuntansi Dasar:
  // tanpa jurnal — kas bergerak lewat cash_transactions sumber_tipe 'pembayaran').
  (await run(`DELETE FROM cash_transactions WHERE sumber_tipe = 'pembayaran'
              AND sumber_id IN (SELECT id FROM payments WHERE tipe IN ('piutang', 'hutang'))`));
  (await run(`DELETE FROM payments WHERE tipe IN ('piutang', 'hutang')`));
  // Hutang uji pembelian.
  (await run(`DELETE FROM payables WHERE purchase_id IN (SELECT id FROM purchases WHERE no_dokumen = 'UJI-DASH-PB')`));
  (await run(`DELETE FROM purchases WHERE no_dokumen = 'UJI-DASH-PB'`));
  // Preferensi & pengaturan uji.
  (await run(`DELETE FROM pengaturan_dashboard`));
  (await run(`DELETE FROM pengaturan_dashboard_peran`));
  (await run(`DELETE FROM settings WHERE kunci LIKE 'pengingat_%'`));
  (await run(`DELETE FROM audit_logs WHERE tabel IN ('pengaturan_dashboard_peran', 'receivables', 'payables')`));
}

(async () => {
  /* --- 0) Kondisi bersih: buang sisa run sebelumnya -------------------- */
  await bersihkanUji();
  (await run(`DELETE FROM customers WHERE nama = 'Pelanggan Uji Dashboard'`));
  (await run(`DELETE FROM suppliers WHERE nama = 'Pemasok Uji Dashboard'`));

  /* --- 1) Tampilan kartu: bawaan per peran ---------------------------- */
  const awal = await jalan<any>('GET', '/dashboard/kartu?peran=admin');
  await cek('GET kartu → 200 + semua id kartu', awal.status === 200 && SEMUA_KARTU.every((k) => typeof awal.data.kartu[k] === 'boolean'), `sumber=${awal.data.sumber}`);

  const bawaanKasir = await jalan<any>('PUT', '/dashboard/kartu/bawaan', {
    peran: 'kasir',
    kartu: { pintasan: false, 'kpi-menipis': false },
  });
  await cek('PUT kartu/bawaan (kasir) → 200', bawaanKasir.status === 200, `status=${bawaanKasir.status}`);
  const kartuKasir = await jalan<any>('GET', '/dashboard/kartu?peran=kasir');
  await cek('GET kartu kasir memakai bawaan peran', kartuKasir.data.sumber === 'peran' && kartuKasir.data.kartu.pintasan === false && kartuKasir.data.kartu['kpi-menipis'] === false && kartuKasir.data.kartu['kpi-piutang'] === true, JSON.stringify(kartuKasir.data));
  const kartuAdmin2 = await jalan<any>('GET', '/dashboard/kartu?peran=admin');
  await cek('bawaan kasir tidak mengubah tampilan admin', kartuAdmin2.data.sumber === 'bawaan' && kartuAdmin2.data.kartu.pintasan === true, `sumber=${kartuAdmin2.data.sumber}`);
  const peranSalah = await jalan<any>('PUT', '/dashboard/kartu/bawaan', { peran: 'superuser', kartu: {} });
  await cek('PUT kartu/bawaan peran tak dikenal → 400', peranSalah.status === 400, `status=${peranSalah.status}`);

  /* --- 2) Tampilan kartu: baris pengguna menang ------------------------- */
  const simpanUser = await jalan<any>('PUT', '/dashboard/kartu', {
    kartu: { 'grafik-metode': false, 'tabel-menipis': false },
  });
  await cek('PUT kartu (pengguna) → 200', simpanUser.status === 200, `status=${simpanUser.status}`);
  const kartuUser = await jalan<any>('GET', '/dashboard/kartu?peran=admin');
  await cek('baris pengguna menang atas bawaan peran', kartuUser.data.sumber === 'pengguna' && kartuUser.data.kartu['grafik-metode'] === false && kartuUser.data.kartu['tabel-menipis'] === false && kartuUser.data.kartu.pintasan === true, JSON.stringify(kartuUser.data));

  /* --- 3) Isi ringkasan ------------------------------------------------ */
  const isi = await jalan<any>('GET', '/dashboard/isi');
  await cek('GET isi → 200: KPI + tren 7 hari + metode + terlaris + tabel',
    isi.status === 200 &&
      typeof isi.data.kpi?.penjualan === 'number' &&
      typeof isi.data.kpi?.piutang === 'number' &&
      Array.isArray(isi.data.tren) && isi.data.tren.length === 7 &&
      Array.isArray(isi.data.metode) && Array.isArray(isi.data.terlaris) &&
      Array.isArray(isi.data.transaksi) && Array.isArray(isi.data.stokMenipis),
    JSON.stringify(isi.data).slice(0, 200));

  /* --- 4) Pengaturan pengingat ----------------------------------------- */
  const setSalah = await jalan<any>('PUT', '/dashboard/pengingat-pengaturan', { hari_sebelum: 5 });
  await cek('pengaturan hari=5 → 400 (hanya 1/3/7)', setSalah.status === 400, `status=${setSalah.status}`);
  const setOk = await jalan<any>('PUT', '/dashboard/pengingat-pengaturan', { hari_sebelum: 1, terlambat_harian: true });
  await cek('pengaturan 1 hari → 200', setOk.status === 200 && setOk.data.pengaturan?.hariSebelum === 1, JSON.stringify(setOk.data));

  /* --- 5) Piutang lewat penjualan POS kredit --------------------------- */
  const custSql = `INSERT INTO customers (nama, telepon) VALUES ('Pelanggan Uji Dashboard', '081100000')`;
  (await run(`DELETE FROM customers WHERE nama = 'Pelanggan Uji Dashboard'`));
  (await run(custSql));
  const custId = (await q1<{ id: number }>(`SELECT id FROM customers WHERE nama = 'Pelanggan Uji Dashboard'`))!.id;

  const kandidat = await q1<{ product_id: number; harga: number; warehouse_id: number }>(
    `SELECT p.id AS product_id, p.harga_jual AS harga, sb.warehouse_id
       FROM products p JOIN stock_balances sb ON sb.product_id = p.id
      WHERE p.aktif = TRUE AND p.deleted_at IS NULL AND p.harga_jual > 0
      GROUP BY p.id, sb.warehouse_id HAVING SUM(sb.qty) >= 1
      ORDER BY SUM(sb.qty) DESC LIMIT 1`,
  );
  await cek('data: ada produk berstok & berharga', Boolean(kandidat), JSON.stringify(kandidat));
  if (!kandidat) throw new Error('Tidak ada produk uji');

  const shift0 = await jalan<any>('GET', '/pos/shift/aktif');
  let shiftDibuka = false;
  if (shift0.status !== 200 || !shift0.data.data?.id) {
    const buka = await jalan<any>('POST', '/pos/shift/buka', { kas_awal: 0 });
    await cek('buka shift uji → 201', buka.status === 201, `status=${buka.status}`);
    shiftDibuka = true;
  }

  const jual = await jalan<any>('POST', '/pos/sales', {
    warehouse_id: kandidat.warehouse_id,
    customer_id: custId,
    items: [{ product_id: kandidat.product_id, qty: 1, harga: kandidat.harga }],
    payments: [{ metode: 'kredit', jumlah: kandidat.harga }],
    jatuh_tempo: '2020-01-05',
  });
  await cek('penjualan kredit (jatuh tempo lampau) → 201', jual.status === 201, `status=${jual.status} ${JSON.stringify(jual.data)}`);
  const saleId = jual.data.data?.id as number;
  const noDokumen = jual.data.data?.no_dokumen as string;

  /* --- 5b) Widget: periode 7/14/30 + filter kategori ------------------- */
  const w14 = await jalan<any>('GET', '/dashboard/widget?metrik=penjualan&periode=14-hari&jumlah=5');
  const beda14 =
    w14.status === 200 && w14.data.rentang
      ? Math.round((Date.parse(w14.data.rentang.sampai) - Date.parse(w14.data.rentang.dari)) / 86400000) + 1
      : 0;
  await cek('widget 14 hari → 14 titik & rentang 14 hari', w14.status === 200 && w14.data.seri?.length === 14 && beda14 === 14, `titik=${w14.data.seri?.length} hari=${beda14}`);

  const w30 = await jalan<any>('GET', '/dashboard/widget?metrik=penjualan&periode=30-hari&jumlah=5');
  await cek('widget 30 hari → 30 titik (tidak terpotong)', w30.status === 200 && w30.data.seri?.length === 30, `titik=${w30.data.seri?.length}`);
  await cek('widget KPI menyertakan deret untuk sparkline', Array.isArray(w30.data.seri));

  const metrikSalah = await jalan<any>('GET', '/dashboard/widget?metrik=tidak-ada');
  await cek('widget metrik tak dikenal → 400', metrikSalah.status === 400, `status=${metrikSalah.status}`);

  // Filter kategori: total tanpa filter = nilai penjualan uji; kategori lain = 0.
  const omzetUji = Number((await q1<{ v: number }>(`SELECT COALESCE(SUM(subtotal - diskon), 0) v FROM sales WHERE id = ?`, saleId))?.v ?? 0);
  const kategoriProduk = (await q1<{ category_id: number | null }>(`SELECT category_id FROM products WHERE id = ?`, kandidat.product_id))?.category_id;
  const kategoriLain = await q1<{ id: number }>(`SELECT id FROM categories WHERE id <> ? ORDER BY id LIMIT 1`, kategoriProduk ?? 0);
  const tanpaFilter = await jalan<any>('GET', '/dashboard/widget?metrik=penjualan&periode=hari-ini');
  await cek('widget KPI hari ini = omzet penjualan uji', Math.abs(Number(tanpaFilter.data.nilai) - omzetUji) < 1, `nilai=${tanpaFilter.data.nilai} harap=${omzetUji}`);
  if (kategoriLain) {
    const berfilter = await jalan<any>('GET', `/dashboard/widget?metrik=penjualan&periode=hari-ini&kategori=${kategoriLain.id}`);
    await cek('widget filter kategori lain menyaring omzet ke 0', berfilter.status === 200 && Number(berfilter.data.nilai) === 0, `nilai=${berfilter.data.nilai}`);
  }

  const pengingat1 = await jalan<any>('GET', '/dashboard/pengingat');
  const baris1 = (pengingat1.data.piutang as any[]).find((b) => b.no_dokumen === noDokumen);
  await cek('pengingat: piutang muncul, terlambat, perlu_ingat', Boolean(baris1) && baris1!.urgensi === 'terlambat' && baris1!.perlu_ingat === true && baris1!.sisa === kandidat.harga, JSON.stringify(baris1));
  await cek('pengingat: menghubungkan nomor faktur otomatis', typeof baris1?.no_faktur === 'string' && baris1!.no_faktur.length > 0, `no_faktur=${baris1?.no_faktur}`);

  const badge1 = await jalan<any>('GET', '/dashboard/badge');
  await cek('badge menu ≥ 1 (ada terlambat)', badge1.status === 200 && Number(badge1.data.terlambat) >= 1, JSON.stringify(badge1.data));

  const isi2 = await jalan<any>('GET', '/dashboard/isi');
  await cek('KPI piutang ikut naik', Number(isi2.data.kpi.piutang) >= kandidat.harga, `piutang=${isi2.data.kpi.piutang}`);

  // Pengingat harian nonaktif → tagihan terlambat tidak dihitung badge.
  await jalan<any>('PUT', '/dashboard/pengingat-pengaturan', { hari_sebelum: 3, terlambat_harian: false });
  const badgeMati = await jalan<any>('GET', '/dashboard/badge');
  await cek('badge = 0 saat pengingat harian nonaktif (padahal ada terlambat)', Number(badgeMati.data.terlambat) === 0, JSON.stringify(badgeMati.data));
  await jalan<any>('PUT', '/dashboard/pengingat-pengaturan', { hari_sebelum: 1, terlambat_harian: true });
  const badgeNyala = await jalan<any>('GET', '/dashboard/badge');
  await cek('badge ≥ 1 lagi saat pengingat harian aktif', Number(badgeNyala.data.terlambat) >= 1, JSON.stringify(badgeNyala.data));

  /* --- 6) Catat pembayaran: validasi + sebagian + lunas ---------------- */
  const tipeSalah = await jalan<any>('POST', '/dashboard/pelunasan', { tipe: 'utang', id: baris1!.id, jumlah: 1000 });
  await cek('pelunasan tipe tak dikenal → 400', tipeSalah.status === 400, `status=${tipeSalah.status}`);
  const idSalah = await jalan<any>('POST', '/dashboard/pelunasan', { tipe: 'piutang', id: 99999999, jumlah: 1000 });
  await cek('pelunasan id tak dikenal → 404', idSalah.status === 404, `status=${idSalah.status}`);
  const lebih = await jalan<any>('POST', '/dashboard/pelunasan', { tipe: 'piutang', id: baris1!.id, jumlah: kandidat.harga + 1 });
  await cek('pelunasan melebihi sisa → 400', lebih.status === 400, `status=${lebih.status}`);

  const sebagian = Math.round(kandidat.harga / 2);
  const bayar1 = await jalan<any>('POST', '/dashboard/pelunasan', { tipe: 'piutang', id: baris1!.id, jumlah: sebagian, metode: 'tunai' });
  await cek('bayar sebagian → 201 status sebagian', bayar1.status === 201 && bayar1.data.data?.status === 'sebagian', JSON.stringify(bayar1.data));
  // Akuntansi Dasar: pelunasan mencatat mutasi kas MASUK (piutang → kas),
  // bukan jurnal debit/kredit.
  const kasBayar = await q1<{ n: number; j: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(jumlah),0) AS j
       FROM cash_transactions
      WHERE sumber_tipe = 'pembayaran' AND tipe = 'masuk' AND jumlah = ?`,
    sebagian,
  );
  await cek('mutasi kas pelunasan sebagian tercatat (masuk = pembayaran)',
    Number(kasBayar?.n ?? 0) >= 1 && Number(kasBayar?.j) >= sebagian,
    `baris=${kasBayar?.n} jumlah=${kasBayar?.j} harap=${sebagian}`);

  const pengingat2 = await jalan<any>('GET', '/dashboard/pengingat');
  const baris2 = (pengingat2.data.piutang as any[]).find((b) => b.id === baris1!.id);
  await cek('pengingat setelah bayar sebagian: sisa menyusut', Boolean(baris2) && Math.abs(baris2!.sisa - (kandidat.harga - sebagian)) < 1, JSON.stringify(baris2));

  const bayar2 = await jalan<any>('POST', '/dashboard/pelunasan', { tipe: 'piutang', id: baris1!.id, jumlah: kandidat.harga - sebagian });
  await cek('pelunasan sisa → lunas', bayar2.status === 201 && bayar2.data.data?.status === 'lunas', JSON.stringify(bayar2.data));
  const lunasUlang = await jalan<any>('POST', '/dashboard/pelunasan', { tipe: 'piutang', id: baris1!.id, jumlah: 1000 });
  await cek('bayar tagihan lunas → 409', lunasUlang.status === 409, `status=${lunasUlang.status}`);
  const pengingat3 = await jalan<any>('GET', '/dashboard/pengingat');
  await cek('pengingat: piutang lunas hilang dari daftar', !(pengingat3.data.piutang as any[]).some((b) => b.id === baris1!.id));

  /* --- 7) Hutang pembelian (insert SQL, jatuh tempo lampau) ------------ */
  const supSql = `INSERT INTO suppliers (nama, telepon) VALUES ('Pemasok Uji Dashboard', '082200000')`;
  (await run(`DELETE FROM suppliers WHERE nama = 'Pemasok Uji Dashboard'`));
  (await run(supSql));
  const supId = (await q1<{ id: number }>(`SELECT id FROM suppliers WHERE nama = 'Pemasok Uji Dashboard'`))!.id;

  (await run(`DELETE FROM payables WHERE purchase_id IN (SELECT id FROM purchases WHERE no_dokumen = 'UJI-DASH-PB')`));
  (await run(`DELETE FROM purchases WHERE no_dokumen = 'UJI-DASH-PB'`));
  const pbId = Number(
    (await run(`INSERT INTO purchases (no_dokumen, supplier_id, warehouse_id, total, status) VALUES ('UJI-DASH-PB', ?, ?, 50000, 'disahkan')`, supId, kandidat.warehouse_id)).lastInsertRowid,
  );
  const pbPay = Number(
    (await run(`INSERT INTO payables (purchase_id, supplier_id, jatuh_tempo, total, terbayar, status) VALUES (?, ?, '2020-02-02', 50000, 0, 'belum')`, pbId, supId)).lastInsertRowid,
  );

  const pengingat4 = await jalan<any>('GET', '/dashboard/pengingat');
  const barisHutang = (pengingat4.data.hutang as any[]).find((b) => b.id === pbPay);
  await cek('pengingat: hutang muncul & terlambat', Boolean(barisHutang) && barisHutang!.urgensi === 'terlambat', JSON.stringify(barisHutang));

  const bayarHutang = await jalan<any>('POST', '/dashboard/pelunasan', { tipe: 'hutang', id: pbPay, jumlah: 50000, metode: 'transfer' });
  await cek('bayar hutang → lunas', bayarHutang.status === 201 && bayarHutang.data.data?.status === 'lunas', JSON.stringify(bayarHutang.data));
  // Akuntansi Dasar: pembayaran hutang mencatat mutasi kas KELUAR (kas → hutang).
  const kasHutang = await jml(
    `SELECT COUNT(*) AS n FROM cash_transactions
      WHERE sumber_tipe = 'pembayaran' AND tipe = 'keluar' AND jumlah = 50000`,
  );
  await cek('mutasi kas pembayaran hutang tercatat (keluar)', kasHutang >= 1, `baris=${kasHutang}`);

  const pengingat5 = await jalan<any>('GET', '/dashboard/pengingat');
  await cek('pengingat: hutang lunas hilang dari daftar', !(pengingat5.data.hutang as any[]).some((b) => b.id === pbPay));

  /* --- 8) Bersihkan semua data uji ------------------------------------- */
  await bersihkanUji();
  (await run(`DELETE FROM customers WHERE nama = 'Pelanggan Uji Dashboard'`));
  (await run(`DELETE FROM suppliers WHERE nama = 'Pemasok Uji Dashboard'`));
  if (shiftDibuka) await jalan<any>('POST', '/pos/shift/tutup', { kas_akhir_fisik: 0 });

  const bersih = await jml(`SELECT COUNT(*) AS n FROM sales`) + await jml(`SELECT COUNT(*) AS n FROM purchases WHERE no_dokumen = 'UJI-DASH-PB'`);
  await cek('cleanup: data uji terhapus', bersih === 0, `sisa=${bersih}`);

  console.log(`\nHasil: ${lulus} lulus, ${gagal} gagal`);
  process.exit(gagal ? 1 : 0);
})().catch((e) => {
  console.error('GAGAL total:', e);
  process.exit(1);
});

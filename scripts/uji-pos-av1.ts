/* Uji API POS: shift, tertahan, penjualan atomik (stok + kartu stok
   + jurnal penjualan & HPP), pembayaran campuran, void & retur PIN supervisor.
   Master Produk tanpa varian — keranjang merujuk product_id langsung. */
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

/* Bersihkan sisa data uji dari run sebelumnya (idempoten). Kembalikan stok
   penjualan yang belum di-void/diretur, lalu hapus dokumen: hormati trigger
   (jual wajib punya jurnal seimbang; jurnal disahkan wajib dibatalkan dulu). */
async function bersihkanSisaPos(): void {
  const sisa = (await all(`SELECT id, warehouse_id, status FROM sales`)) as { id: number; warehouse_id: number; status: string }[];
  for (const s of sisa) {
    if (s.status === 'disahkan') {
      const baris = (await all(`SELECT product_id, qty FROM sale_items WHERE sale_id = ?`, s.id)) as { product_id: number; qty: number }[];
      for (const b of baris) {
        const sudah = await q1<{ n: number }>(
          `SELECT COALESCE(SUM(sri.qty), 0) AS n FROM sale_return_items sri
           JOIN sale_returns sr ON sr.id = sri.return_id
           WHERE sr.sale_id = ? AND sri.product_id = ? AND sr.status = 'disahkan'`,
          s.id,
          b.product_id,
        );
        const kembali = b.qty - Number(sudah?.n ?? 0);
        if (kembali > 0) {
          (await run(
            `INSERT INTO stock_balances (product_id, warehouse_id, qty) VALUES (?, ?, ?)
             ON CONFLICT (product_id, warehouse_id) DO UPDATE SET qty = stock_balances.qty + excluded.qty`,
            b.product_id, s.warehouse_id, kembali));
        }
      }
    }
    const returIds = (await all(`SELECT id FROM sale_returns WHERE sale_id = ?`, s.id)) as { id: number }[];
    for (const ri of returIds) {
      (await run(`DELETE FROM sale_return_items WHERE return_id = ?`, ri.id));
      (await run(`DELETE FROM stock_ledger WHERE tipe_dokumen = 'retur' AND dokumen_id = ?`, ri.id));
      (await run(`UPDATE journals SET status = 'batal' WHERE sumber_tipe = 'retur' AND sumber_id = ? AND status = 'disahkan'`, ri.id));
      (await run(`DELETE FROM journal_lines WHERE journal_id IN (SELECT id FROM journals WHERE sumber_tipe = 'retur' AND sumber_id = ?)`, ri.id));
      (await run(`DELETE FROM journals WHERE sumber_tipe = 'retur' AND sumber_id = ?`, ri.id));
    }
    (await run(`DELETE FROM sale_returns WHERE sale_id = ?`, s.id));
    (await run(`UPDATE journals SET status = 'batal' WHERE sumber_tipe IN ('penjualan', 'hpp') AND sumber_id = ? AND status = 'disahkan'`, s.id));
    (await run(`DELETE FROM journal_lines WHERE journal_id IN (SELECT id FROM journals WHERE sumber_tipe IN ('penjualan', 'hpp') AND sumber_id = ?)`, s.id));
    (await run(`DELETE FROM journals WHERE sumber_tipe IN ('penjualan', 'hpp') AND sumber_id = ?`, s.id));
    (await run(`DELETE FROM receivables WHERE sale_id = ?`, s.id));
    (await run(`DELETE FROM sale_payments WHERE sale_id = ?`, s.id));
    (await run(`DELETE FROM sale_items WHERE sale_id = ?`, s.id));
    (await run(`DELETE FROM stock_ledger WHERE tipe_dokumen = 'penjualan' AND dokumen_id = ?`, s.id));
    (await run(`DELETE FROM sales WHERE id = ?`, s.id));
  }
  (await run(`DELETE FROM held_sales`));
  (await run(`DELETE FROM cashier_shifts`));
  (await run(`DELETE FROM audit_logs WHERE tabel IN ('sales', 'sale_returns', 'cashier_shifts')`));
}

(async () => {
  await bersihkanSisaPos();
  (await run(`DELETE FROM customers WHERE nama = 'Pelanggan POS Uji'`));

  // --- 1) Grid produk POS ---------------------------------------------------
  const grid = await jalan<any>('GET', '/pos/produk');
  await cek('grid produk → 200', grid.status === 200, `status=${grid.status}`);
  const produk = grid.data.data as any[];
  await cek('grid: minimal satu produk', produk.length > 0, `produk=${produk.length}`);
  await cek('grid: produk membawa foto_url (mode foto)', produk.every((p) => p.foto_url === null || typeof p.foto_url === 'string'), `contoh=${JSON.stringify(produk[0]?.foto_url)}`);
  await cek('grid: produk membawa nama kategori', produk.some((p) => typeof p.kategori === 'string'), `kategori contoh=${produk.find((p) => p.kategori)?.kategori}`);
  await cek('grid: tiap produk membawa stok_gudang (peta per gudang)', produk.every((p) => p.stok_gudang && typeof p.stok_gudang === 'object' && !Array.isArray(p.stok_gudang)), JSON.stringify(produk[0]?.stok_gudang));
  await cek('grid: pengaturan pajak & nama usaha ikut dikirim', typeof grid.data.pengaturan?.pajak_persen === 'number' && typeof grid.data.pengaturan?.nama_usaha === 'string', JSON.stringify(grid.data.pengaturan));

  const namaContoh = produk[0].nama as string;
  const cari = await jalan<any>('GET', `/pos/produk?cari=${encodeURIComponent(namaContoh)}`);
  await cek('grid: pencarian bekerja', cari.status === 200 && (cari.data.data as any[]).length >= 1, `jumlah=${cari.data.data?.length}`);
  const kategoriId = produk.find((p) => p.category_id)?.category_id;
  if (kategoriId) {
    const k1 = await jalan<any>('GET', `/pos/produk?kategori=${kategoriId}`);
    await cek('grid: filter kategori bekerja', k1.status === 200 && (k1.data.data as any[]).length > 0, `jumlah=${k1.data.data?.length}`);
  } else {
    await cek('grid: filter kategori bekerja (tidak ada kategori pada data contoh)', true);
  }

  // --- 2) Shift kasir: validasi, buka, tutup, buka lagi ---------------------
  const kasAwal = 100000;
  const buka = await jalan<any>('POST', '/pos/shift/buka', { kas_awal: kasAwal });
  await cek('buka shift → 201', buka.status === 201, `status=${buka.status} ${JSON.stringify(buka.data)}`);
  let shiftId = buka.data.id as number;
  const buka2 = await jalan<any>('POST', '/pos/shift/buka', { kas_awal: 1000 });
  await cek('buka shift saat sudah buka → 409', buka2.status === 409, `status=${buka2.status}`);
  const tutupInvalid = await jalan<any>('POST', '/pos/shift/tutup', { kas_akhir_fisik: -5 });
  await cek('tutup shift dengan kas fisik negatif → 400', tutupInvalid.status === 400, `status=${tutupInvalid.status}`);
  const shiftAktif = await jalan<any>('GET', '/pos/shift/aktif');
  await cek('shift aktif terbaca + ringkasan', shiftAktif.status === 200 && shiftAktif.data.data?.id === shiftId && typeof shiftAktif.data.data?.ringkasan?.penjualan === 'number', JSON.stringify(shiftAktif.data));

  // --- 3) Transaksi tertahan ------------------------------------------------
  // Pilih produk+gudang yang benar-benar punya stok, harga jual & beli > 0.
  const kandidat = (await all(
    `SELECT p.id AS product_id, p.nama, p.harga_jual AS harga,
            sb.warehouse_id, SUM(sb.qty) AS stok
     FROM products p
     JOIN stock_balances sb ON sb.product_id = p.id
     WHERE p.aktif = TRUE AND p.deleted_at IS NULL
     GROUP BY p.id, sb.warehouse_id
     HAVING SUM(sb.qty) >= 2 AND p.harga_jual > 0 AND p.harga_beli > 0
     ORDER BY stok DESC`,
  )) as { product_id: number; nama: string; harga: number; warehouse_id: number; stok: number }[];
  await cek('data: minimal dua produk+gudang berstok & berharga', kandidat.length >= 2, `kandidat=${kandidat.length}`);
  const w1 = kandidat[0];
  // Penjualan memakai SATU gudang — w2 wajib se-gudang dengan w1 agar item
  // campuran tidak dijual dari gudang yang tidak punya stoknya.
  const w2 =
    kandidat.find((k) => k.product_id !== w1.product_id && k.warehouse_id === w1.warehouse_id) ??
    kandidat.find((k) => k.product_id !== w1.product_id) ??
    w1;

  const tertahan = await jalan<any>('POST', '/pos/held', {
    nama: 'Tahan Uji',
    data: { items: [{ product_id: w1.product_id, qty: 1, harga: Number(w1.harga), nama: w1.nama }], diskon: 0, pajak_persen: 0 },
  });
  await cek('tahan transaksi → 201', tertahan.status === 201, `status=${tertahan.status} ${JSON.stringify(tertahan.data)}`);
  const daftarTertahan = await jalan<any>('GET', '/pos/held');
  await cek('daftar tertahan memuat transaksi', daftarTertahan.status === 200 && daftarTertahan.data.data.length === 1, `jumlah=${daftarTertahan.data.data?.length}`);

  // --- 4) Penjualan atomik --------------------------------------------------
  const pin = '1234';

  // Tutup dulu shift bawaan, lalu uji 'tanpa shift' sebelum buka shift uji.
  const shiftSisa = await jalan<any>('POST', '/pos/shift/tutup', { kas_akhir_fisik: 0 });
  const tanpaShift = await jalan<any>('POST', '/pos/sales', {
    warehouse_id: w1.warehouse_id,
    items: [{ product_id: w1.product_id, qty: 1, harga: w1.harga }],
    payments: [{ metode: 'tunai', jumlah: w1.harga }],
  });
  await cek('penjualan tanpa shift → 409', tanpaShift.status === 409, `status=${tanpaShift.status} tutupSisa=${shiftSisa.status}`);

  // Buka shift uji untuk seluruh skenario penjualan berikutnya.
  const bukaUji = await jalan<any>('POST', '/pos/shift/buka', { kas_awal: kasAwal });
  await cek('buka shift uji → 201', bukaUji.status === 201, `status=${bukaUji.status}`);
  shiftId = bukaUji.data.id as number;

  const stokSebelum = await jml(`SELECT COALESCE(SUM(qty), 0) AS n FROM stock_balances WHERE product_id = ? AND warehouse_id = ?`, w1.product_id, w1.warehouse_id);
  const stok2Sebelum = await jml(`SELECT COALESCE(SUM(qty), 0) AS n FROM stock_balances WHERE product_id = ? AND warehouse_id = ?`, w2.product_id, w2.warehouse_id);
  const ledgerSebelum = await jml(`SELECT COUNT(*) AS n FROM stock_ledger WHERE product_id = ?`, w1.product_id);

  const tipeSalah = await jalan<any>('POST', '/pos/sales', {
    warehouse_id: w1.warehouse_id,
    items: [{ product_id: 99999999, qty: 1, harga: 1000 }],
    payments: [{ metode: 'tunai', jumlah: 1000 }],
  });
  await cek('produk tak dikenal → 404', tipeSalah.status === 404, `status=${tipeSalah.status}`);

  const bayarSalah = await jalan<any>('POST', '/pos/sales', {
    warehouse_id: w1.warehouse_id,
    items: [{ product_id: w1.product_id, qty: 1, harga: w1.harga }],
    payments: [{ metode: 'tunai', jumlah: 1 }],
  });
  await cek('bayar kurang → 400', bayarSalah.status === 400, `status=${bayarSalah.status}`);

  const kreditTanpaPelanggan = await jalan<any>('POST', '/pos/sales', {
    warehouse_id: w1.warehouse_id,
    items: [{ product_id: w1.product_id, qty: 1, harga: w1.harga }],
    payments: [{ metode: 'kredit', jumlah: w1.harga }],
  });
  await cek('kredit tanpa pelanggan → 400', kreditTanpaPelanggan.status === 400, `status=${kreditTanpaPelanggan.status}`);

  (await run(`INSERT INTO customers (nama, telepon) VALUES ('Pelanggan POS Uji', '0812')`));
  const custRow = await q1<{ id: number }>(`SELECT id FROM customers WHERE nama = 'Pelanggan POS Uji'`);

  const jual = await jalan<any>('POST', '/pos/sales', {
    warehouse_id: w1.warehouse_id,
    customer_id: custRow?.id,
    items: [
      { product_id: w1.product_id, qty: 2, harga: w1.harga },
      { product_id: w2.product_id, qty: 1, harga: w2.harga },
    ],
    payments: [
      { metode: 'tunai', jumlah: w1.harga * 2 },
      { metode: 'kredit', jumlah: w2.harga },
    ],
    catatan: 'Uji POS',
  });
  await cek('penjualan campuran → 201', jual.status === 201, `status=${jual.status} ${JSON.stringify(jual.data)}`);
  const noDok = jual.data.no_dokumen as string;
  await cek('nomor dokumen terformat SJ-tahun-bulan-nomor', /^SJ-\d{4}-\d{2}-\d{4}$/.test(noDok ?? ''), `no=${noDok}`);
  const saleId = jual.data.id as number;
  const saleRow = jual.data.data as any;
  const totalHarap = w1.harga * 2 + w2.harga;
  await cek('total = jumlah pembayaran', Number(saleRow?.total) === totalHarap, `total=${saleRow?.total} harap=${totalHarap}`);
  await cek('kembalian 0 (tunai pas)', jual.data.kembalian === 0, `kembalian=${jual.data.kembalian}`);
  await cek('penjualan terkait shift aktif', Number(saleRow?.shift_id) === shiftId, `shift=${saleRow?.shift_id} aktif=${shiftId}`);

  // Snapshot nama/SKU/harga ikut tersimpan di baris penjualan.
  const snap = await q1<{ nama_produk: string; sku: string; harga: number }>(
    `SELECT nama_produk, sku, harga FROM sale_items WHERE sale_id = ? AND product_id = ?`,
    saleId,
    w1.product_id,
  );
  await cek('baris jual menyimpan snapshot nama+SKU+harga', Boolean(snap?.nama_produk && snap?.sku) && Number(snap?.harga) === w1.harga, JSON.stringify(snap));

  const stokSesudah = await jml(`SELECT COALESCE(SUM(qty), 0) AS n FROM stock_balances WHERE product_id = ? AND warehouse_id = ?`, w1.product_id, w1.warehouse_id);
  await cek('stok berkurang atomik', stokSesudah === stokSebelum - 2, `sebelum=${stokSebelum} sesudah=${stokSesudah}`);

  const ledgerBaru = await jml(`SELECT COUNT(*) AS n FROM stock_ledger WHERE product_id = ? AND tipe_dokumen = 'penjualan' AND dokumen_id = ?`, w1.product_id, saleId);
  const ledgerTotal = await jml(`SELECT COUNT(*) AS n FROM stock_ledger WHERE product_id = ?`, w1.product_id);
  await cek('kartu stok tercatat', ledgerBaru >= 1 && ledgerTotal > ledgerSebelum, `kartu=${ledgerBaru} total=${ledgerTotal} sebelum=${ledgerSebelum}`);

  const jualJurnal = await q1<{ n: number; d: number; k: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(jl.debit), 0) AS d, COALESCE(SUM(jl.kredit), 0) AS k
     FROM journals j JOIN journal_lines jl ON jl.journal_id = j.id
     WHERE j.sumber_tipe = 'penjualan' AND j.sumber_id = ? AND j.status = 'disahkan'`,
    saleId,
  );
  // AKUNTANSI DASAR (model saat ini): penjualan TIDAK membuat jurnal — kas &
  // piutang dicatat lewat dasarKas/receivables (diverifikasi cek kas di bawah).
  await cek('penjualan tanpa jurnal (Akuntansi Dasar)', (jualJurnal?.n ?? 0) === 0, JSON.stringify(jualJurnal));

  const hppTotal = Number((await q1<{ n: number }>(`SELECT COALESCE(SUM(hpp), 0) AS n FROM sale_items WHERE sale_id = ?`, saleId))?.n ?? 0);
  const hppJurnal = await q1<{ n: number; d: number; k: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(jl.debit), 0) AS d, COALESCE(SUM(jl.kredit), 0) AS k
     FROM journals j JOIN journal_lines jl ON jl.journal_id = j.id
     WHERE j.sumber_tipe = 'hpp' AND j.sumber_id = ? AND j.status = 'disahkan'`,
    saleId,
  );
  await cek(
    'HPP tercatat di sale_items, tanpa jurnal HPP (Akuntansi Dasar)',
    hppTotal > 0 && (hppJurnal?.n ?? 0) === 0,
    JSON.stringify({ hppTotal, hppJurnal }),
  );

  const piutang = await q1<{ total: number }>(`SELECT total FROM receivables WHERE sale_id = ?`, saleId);
  await cek('piutang tercatat untuk bayar kredit', Number(piutang?.total) === w2.harga, JSON.stringify(piutang));

  // --- 5) Void dengan PIN supervisor ----------------------------------------
  const voidTanpaPin = await jalan<any>('POST', `/pos/sales/${saleId}/void`, { pin: '0000' });
  await cek('void dengan PIN salah → 403', voidTanpaPin.status === 403, `status=${voidTanpaPin.status}`);

  const voidOk = await jalan<any>('POST', `/pos/sales/${saleId}/void`, { pin, alasan: 'Uji void' });
  await cek('void dengan PIN benar → 200', voidOk.status === 200, `status=${voidOk.status} ${JSON.stringify(voidOk.data)}`);
  const stokPulih = await jml(`SELECT COALESCE(SUM(qty), 0) AS n FROM stock_balances WHERE product_id = ? AND warehouse_id = ?`, w1.product_id, w1.warehouse_id);
  await cek('void mengembalikan stok', stokPulih === stokSebelum, `sebelum=${stokSebelum} pulih=${stokPulih}`);
  // Model pembatalan: jurnal asli TETAP disahkan + jurnal pembalik disahkan —
  // efek gabungan nol sehingga laporan (yang menghitung 'disahkan') tetap benar.
  const jurnalVoid = (await all(
    `SELECT j.status, SUM(jl.debit) AS d, SUM(jl.kredit) AS k
     FROM journals j JOIN journal_lines jl ON jl.journal_id = j.id
     WHERE j.sumber_tipe = 'penjualan' AND j.sumber_id = ? GROUP BY j.id`,
    saleId)) as { status: string; d: number; k: number }[];
  // Akuntansi Dasar: tidak ada jurnal asli/pembalik — void membalik stok + kas
  // (diverifikasi cek stok & kas sebelumnya).
  await cek(
    'void tanpa jurnal pembalik (Akuntansi Dasar)',
    jurnalVoid.length === 0,
    JSON.stringify(jurnalVoid),
  );
  const voidUlang = await jalan<any>('POST', `/pos/sales/${saleId}/void`, { pin });
  await cek('void dua kali → 409', voidUlang.status === 409, `status=${voidUlang.status}`);

  // --- 6) Penjualan kedua + retur sebagian ----------------------------------
  const jual2 = await jalan<any>('POST', '/pos/sales', {
    warehouse_id: w2.warehouse_id,
    items: [{ product_id: w2.product_id, qty: 1, harga: w2.harga }],
    payments: [{ metode: 'tunai', jumlah: w2.harga }],
  });
  await cek('penjualan kedua → 201', jual2.status === 201, `status=${jual2.status}`);
  const sale2 = jual2.data.id as number;

  const retur = await jalan<any>('POST', `/pos/sales/${sale2}/retur`, {
    pin,
    items: [{ product_id: w2.product_id, qty: 1 }],
  });
  await cek('retur dengan PIN benar → 201', retur.status === 201, `status=${retur.status} ${JSON.stringify(retur.data)}`);
  const stok2Pulih = await jml(`SELECT COALESCE(SUM(qty), 0) AS n FROM stock_balances WHERE product_id = ? AND warehouse_id = ?`, w2.product_id, w2.warehouse_id);
  await cek('retur mengembalikan stok', stok2Pulih === stok2Sebelum, `sebelum=${stok2Sebelum} pulih=${stok2Pulih}`);
  const returJurnal = await q1<{ n: number; d: number; k: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(jl.debit), 0) AS d, COALESCE(SUM(jl.kredit), 0) AS k
     FROM journals j JOIN journal_lines jl ON jl.journal_id = j.id
     WHERE j.sumber_tipe = 'retur' AND j.sumber_id = ? AND j.status = 'disahkan'`,
    retur.data.id,
  );
  await cek('retur tanpa jurnal (Akuntansi Dasar)', (returJurnal?.n ?? 0) === 0, JSON.stringify(returJurnal));
  const returLebih = await jalan<any>('POST', `/pos/sales/${sale2}/retur`, {
    pin,
    items: [{ product_id: w2.product_id, qty: 5 }],
  });
  await cek('retur melebihi sisa terjual → 409', returLebih.status === 409, `status=${returLebih.status}`);

  // --- 7) Tutup shift --------------------------------------------------------
  // Kas sistem = kas awal + tunai penjualan disahkan − retur TUNAI keluar laci
  // (penjualan 1 sudah void → gugur dari rekap tunai; penjualan 2 diretur penuh
  //  dan dibayar tunai, jadi uangnya keluar dari laci lagi).
  const returTunai = await jml(
    `SELECT COALESCE(SUM(sr.total), 0) AS n FROM sale_returns sr
     JOIN sales s2 ON s2.id = sr.sale_id
     WHERE s2.shift_id = ? AND sr.status = 'disahkan'
       AND NOT EXISTS (SELECT 1 FROM receivables rc WHERE rc.sale_id = s2.id AND rc.status IN ('belum', 'sebagian'))`,
    shiftId,
  );
  const sistemHarap = kasAwal + w2.harga - returTunai;
  const tutup = await jalan<any>('POST', '/pos/shift/tutup', { kas_akhir_fisik: sistemHarap, keterangan: 'Uji tutup' });
  await cek('tutup shift → 200', tutup.status === 200, `status=${tutup.status} ${JSON.stringify(tutup.data)}`);
  await cek('kas sistem = kas awal + tunai − retur tunai', Number(tutup.data.kas_akhir_sistem) === sistemHarap, `sistem=${tutup.data.kas_akhir_sistem} harap=${sistemHarap} retur=${returTunai}`);
  await cek('selisih kas dihitung', Number(tutup.data.selisih) === 0, `selisih=${tutup.data.selisih}`);
  const tutupUlang = await jalan<any>('POST', '/pos/shift/tutup', { kas_akhir_fisik: 0 });
  await cek('tutup shift dua kali → 404 (tak ada shift aktif)', tutupUlang.status === 404, `status=${tutupUlang.status}`);

  // --- 8) Audit log ----------------------------------------------------------
  const auditSales = await jml(`SELECT COUNT(*) AS n FROM audit_logs WHERE tabel = 'sales'`);
  const auditShift = await jml(`SELECT COUNT(*) AS n FROM audit_logs WHERE tabel = 'cashier_shifts'`);
  await cek('audit log POS tercatat', auditSales >= 3 && auditShift >= 2, `sales=${auditSales} shift=${auditShift}`);

  // --- 9) Bersihkan data uji (stok sudah netral; sisa run awal juga ikut) ----
  await bersihkanSisaPos();
  (await run(`DELETE FROM customers WHERE nama = 'Pelanggan POS Uji'`));

  const bersih = await jml(`SELECT COUNT(*) AS n FROM sales`);
  await cek('cleanup: data uji terhapus, stok netral', bersih === 0 && stokPulih === stokSebelum && stok2Pulih === stok2Sebelum);

  console.log(`\nHasil: ${lulus} lulus, ${gagal} gagal`);
  process.exit(gagal ? 1 : 0);
})().catch((e) => {
  console.error('GAGAL total:', e);
  process.exit(1);
});

/* Uji MODUL AKUNTANSI DASAR (pengganti modul COA/jurnal lama):
   1. Hak akses API per await peran(Kasir & Staf Gudang ditolak — wajibAkuntansi).
   2. Kas & Bank: CRUD rekening + mutasi masuk/keluar/transfer + saldo.
   3. Pemetaan metode bayar → rekening kas (validasi).
   4. Kategori biaya/pemasukan + pengeluaran & pemasukan lain.
   5. Piutang & hutang: pembayaran parsial → lunas (kas bergerak, tanpa jurnal).
   6. Laporan dasar (kas-bank, laba-rugi, rekap) + ekspor Excel + jurnal-lama.

   Jalankan: npx tsx scripts/uji-akuntansi.ts   (API hidup di :3001)
   Self-cleaning: rekening uji prefix AKTU-, dokumen uji UJI-AKTU-%. */
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

async function req(metod: string, url: string, body?: unknown) {
  const res = await fetch(`${BASE}${url}`, {
    method: metod,
    headers: await headerUji(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* bukan json */ }
  return { status: res.status, data };
}

/** Permintaan mentah (untuk endpoint non-JSON seperti ekspor Excel). */
async function reqKirim(metod: string, url: string) {
  const res = await fetch(`${BASE}${url}`, { method: metod, headers: await headerUji() });
  return { status: res.status, tipe: res.headers.get('content-type') ?? '' };
}

/** Permintaan dengan override await peran(hanya berlaku dari sesi Admin). */
async function peran(Perl: string, metod: string, url: string, body?: unknown) {
  const res = await fetch(`${BASE}${url}`, {
    method: metod,
    headers: await headerUji({ 'x-peran': Perl }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.status;
}

const q1 = async (sql: string, ...p: unknown[]) => (await get(sql, ...(p as never[]))) as any;
const jml = async (sql: string, ...p: unknown[]): Promise<number> => Number((await q1(sql, ...p))?.n ?? 0);
const ins = async (sql: string, ...p: unknown[]) => Number((await run(sql, ...(p as never[]))).lastInsertRowid);

/** Saldo satu rekening kas versi server (saldo awal + masuk − keluar,
 *  termasuk transfer dua arah — tiruan persis `saldoKas` di lib/dasarKas). */
const saldo = async (kode: string): Promise<number> => {
  const a = await q1(`SELECT id, saldo_awal FROM cash_accounts WHERE kode = ?`, kode);
  if (!a) return NaN;
  const keluar = Number((await q1(
    `SELECT COALESCE(SUM(jumlah), 0) AS v FROM cash_transactions
      WHERE cash_account_id = ? AND tipe IN ('keluar', 'transfer')`, a.id))?.v ?? NaN);
  const masuk = Number((await q1(
    `SELECT COALESCE(SUM(jumlah), 0) AS v FROM cash_transactions
      WHERE (tipe = 'masuk' AND cash_account_id = ?)
         OR (tipe = 'transfer' AND cash_account_tujuan_id = ?)`, a.id, a.id))?.v ?? NaN);
  return Math.round(Number(a.saldo_awal) + masuk - keluar);
};

/**
 * Bersihkan sisa uji sebelumnya (idempoten) — dipanggil di awal & akhir.
 * Urutan: mutasi kas → metode bayar → pembayaran → tagihan → dokumen → rekening.
 */
async function bersihkan(): void {
  try { await run('ROLLBACK') } catch { /* tidak ada transaksi aktif */ }
  // Kas pembayaran dokumen uji saja — jangan sentuh pembayaran modul lain.
  const dokPiu = `SELECT id FROM receivables WHERE sale_id IN (SELECT id FROM sales WHERE no_dokumen LIKE 'UJI-AKTU-%')`;
  const dokHut = `SELECT id FROM payables WHERE purchase_id IN (SELECT id FROM purchases WHERE no_dokumen LIKE 'UJI-AKTU-%')`;
  (await run(`DELETE FROM cash_transactions
              WHERE (sumber_tipe = 'pembayaran'
                     AND sumber_id IN (SELECT id FROM payments
                         WHERE (tipe = 'piutang' AND referensi_id IN (${dokPiu}))
                            OR (tipe = 'hutang' AND referensi_id IN (${dokHut}))))
                 OR cash_account_id IN (SELECT id FROM cash_accounts WHERE kode LIKE 'AKTU-%')
                 OR cash_account_tujuan_id IN (SELECT id FROM cash_accounts WHERE kode LIKE 'AKTU-%')`));
  (await run(`DELETE FROM payment_method_accounts WHERE cash_account_id IN
                (SELECT id FROM cash_accounts WHERE kode LIKE 'AKTU-%')`));
  (await run(`DELETE FROM payments
              WHERE (tipe = 'piutang' AND referensi_id IN
                       (SELECT id FROM receivables WHERE sale_id IN (SELECT id FROM sales WHERE no_dokumen LIKE 'UJI-AKTU-%')))
                 OR (tipe = 'hutang' AND referensi_id IN
                       (SELECT id FROM payables WHERE purchase_id IN (SELECT id FROM purchases WHERE no_dokumen LIKE 'UJI-AKTU-%')))`));
  (await run(`DELETE FROM receivables WHERE sale_id IN (SELECT id FROM sales WHERE no_dokumen LIKE 'UJI-AKTU-%')`));
  (await run(`DELETE FROM payables WHERE purchase_id IN (SELECT id FROM purchases WHERE no_dokumen LIKE 'UJI-AKTU-%')`));
  (await run(`DELETE FROM sales WHERE no_dokumen LIKE 'UJI-AKTU-%'`));
  (await run(`DELETE FROM purchases WHERE no_dokumen LIKE 'UJI-AKTU-%'`));
  (await run(`DELETE FROM customers WHERE nama LIKE '%AKTU%'`));
  (await run(`DELETE FROM suppliers WHERE nama LIKE '%AKTU%'`));
  (await run(`DELETE FROM expense_categories WHERE nama LIKE '%(AKTU)'`));
  (await run(`DELETE FROM cash_accounts WHERE kode LIKE 'AKTU-%'`));
}

/** Metode bayar yang semula TIDAK terpeta → dipetakan sementara & dibersihkan. */
const metodeDibuat: string[] = [];

/** Pastikan metode bayar punya rekening kas (bila belum, petakan ke AKTU-KASA). */
async function pastikanMetode(metode: string, akunId: number): Promise<void> {
  const ada = await jml(`SELECT COUNT(*) AS n FROM payment_method_accounts WHERE metode = ?`, metode);
  if (ada === 0) {
    const r = await req('PUT', '/api/akuntansi/metode-bayar', { metode, akun_id: akunId });
    if (r.status === 200) metodeDibuat.push(metode);
  }
}

async function main(): Promise<void> {
  await bersihkan();

  /* --- 1) Hak akses API per peran --------------------------------------- */
  await cek('Kasir DITOLAK buka Akuntansi (403)', await peran('kasir', 'GET', '/api/akuntansi/kas/akun') === 403);
  await cek('Staf Gudang DITOLAK buka laporan akuntansi (403)', await peran('gudang', 'GET', '/api/akuntansi/laporan/laba-rugi') === 403);
  await cek('Manajer BOLEH lihat Akuntansi (200)', await peran('manajer', 'GET', '/api/akuntansi/kas/akun') === 200);
  await cek('Akuntan BOLEH lihat Akuntansi (200)', await peran('akuntan', 'GET', '/api/akuntansi/kas/akun') === 200);

  /* --- 2) Kas & Bank: CRUD rekening ------------------------------------- */
  let r = await req('GET', '/api/akuntansi/kas/akun');
  await cek('GET kas/akun → 200 + daftar', r.status === 200 && Array.isArray(r.data?.data), `status=${r.status}`);

  r = await req('POST', '/api/akuntansi/kas/akun', { kode: 'AKTU-KASA', nama: 'Kas Uji', jenis: 'kas', saldo_awal: 100000 });
  const idA = r.data?.id as number;
  await cek('tambah rekening kas → 201', r.status === 201 && Number(idA) > 0, `status=${r.status}`);

  r = await req('POST', '/api/akuntansi/kas/akun', { kode: 'AKTU-KASA', nama: 'Duplikat', jenis: 'kas', saldo_awal: 0 });
  await cek('kode rekening kembar → 409', r.status === 409, `status=${r.status}`);

  r = await req('POST', '/api/akuntansi/kas/akun', { kode: 'AKTU-X', nama: 'X', jenis: 'crypto', saldo_awal: 0 });
  await cek('jenis rekening tak dikenal → 400', r.status === 400, `status=${r.status}`);

  r = await req('POST', '/api/akuntansi/kas/akun', { kode: 'AKTU-KASB', nama: '', jenis: 'bank', saldo_awal: 0 });
  await cek('nama kosong → 400', r.status === 400, `status=${r.status}`);

  r = await req('POST', '/api/akuntansi/kas/akun', { kode: 'AKTU-KASB', nama: 'Bank Uji', jenis: 'bank', saldo_awal: 50000 });
  const idB = r.data?.id as number;
  await cek('tambah rekening bank → 201', r.status === 201 && Number(idB) > 0, `status=${r.status}`);

  r = await req('PUT', `/api/akuntansi/kas/akun/${idA}`, { nama: 'Kas Uji (ubah)', saldo_awal: 90000 });
  await cek('ubah rekening → 200', r.status === 200, `status=${r.status}`);
  r = await req('GET', '/api/akuntansi/kas/akun');
  const rekA = (r.data?.data ?? []).find((x: any) => x.kode === 'AKTU-KASA');
  const rekB = (r.data?.data ?? []).find((x: any) => x.kode === 'AKTU-KASB');
  await cek('saldo & nama hasil ubah terbaca', rekA?.nama === 'Kas Uji (ubah)' && Math.round(rekA?.saldo) === 90000 && Math.round(rekB?.saldo) === 50000,
    JSON.stringify({ a: rekA?.saldo, b: rekB?.saldo }));

  r = await req('PUT', '/api/akuntansi/kas/akun/99999999', { nama: 'Hantu' });
  await cek('ubah rekening tak ada → 404', r.status === 404, `status=${r.status}`);

  /* --- 3) Metode bayar → rekening kas ----------------------------------- */
  r = await req('GET', '/api/akuntansi/metode-bayar');
  await cek('GET metode-bayar → 200 + opsi akun', r.status === 200 && Array.isArray(r.data?.data) && Array.isArray(r.data?.akunOpsi),
    `status=${r.status}`);
  await cek('rekening uji muncul di opsi metode bayar',
    (r.data?.akunOpsi ?? []).some((a: any) => a.kode === 'AKTU-KASA'));

  r = await req('PUT', '/api/akuntansi/metode-bayar', { metode: 'doku', akun_id: idA });
  await cek('metode tak dikenal → 400', r.status === 400, `status=${r.status}`);
  r = await req('PUT', '/api/akuntansi/metode-bayar', { metode: 'tunai', akun_id: 99999999 });
  await cek('metode → rekening tak ada → 404', r.status === 404, `status=${r.status}`);

  await pastikanMetode('tunai', idA);
  await pastikanMetode('transfer', idA);
  const akunTunai = await jml(`SELECT cash_account_id AS n FROM payment_method_accounts WHERE metode = 'tunai'`);
  r = await req('PUT', '/api/akuntansi/metode-bayar', { metode: 'tunai', akun_id: akunTunai || idA });
  await cek('petakan ulang tunai (idempoten) → 200', r.status === 200, `status=${r.status}`);

  /* --- 4) Mutasi kas manual --------------------------------------------- */
  r = await req('POST', '/api/akuntansi/kas/masuk', { akun_id: idA, jumlah: 25000, keterangan: 'Uji kas masuk' });
  await cek('kas masuk → 201', r.status === 201, `status=${r.status}`);
  await cek('saldo naik +25.000', await saldo('AKTU-KASA') === 115000, `saldo=${await saldo('AKTU-KASA')}`);

  r = await req('POST', '/api/akuntansi/kas/keluar', { akun_id: idA, jumlah: 10000, keterangan: 'Uji kas keluar' });
  await cek('kas keluar → 201', r.status === 201, `status=${r.status}`);
  await cek('saldo turun −10.000', await saldo('AKTU-KASA') === 105000, `saldo=${await saldo('AKTU-KASA')}`);

  r = await req('POST', '/api/akuntansi/kas/masuk', { akun_id: idA, jumlah: 0 });
  await cek('jumlah kas 0/negatif → 400', r.status === 400, `status=${r.status}`);

  r = await req('POST', '/api/akuntansi/kas/transfer', { akun_id: idA, akun_tujuan_id: idB, jumlah: 15000 });
  await cek('transfer antar rekening → 201', r.status === 201, `status=${r.status}`);
  await cek('transfer: asal turun & tujuan naik', await saldo('AKTU-KASA') === 90000 && await saldo('AKTU-KASB') === 65000,
    `A=${await saldo('AKTU-KASA')} B=${await saldo('AKTU-KASB')}`);

  r = await req('POST', '/api/akuntansi/kas/transfer', { akun_id: idA, akun_tujuan_id: idA, jumlah: 1000 });
  await cek('transfer asal = tujuan → 400', r.status === 400, `status=${r.status}`);

  r = await req('GET', `/api/akuntansi/kas/mutasi?akun_id=${idA}`);
  await cek('daftar mutasi kas → 200 + baris uji', r.status === 200 && (r.data?.data ?? []).some((m: any) => m.keterangan === 'Uji kas masuk'),
    `total=${r.data?.total}`);
  r = await req('GET', `/api/akuntansi/kas/mutasi?akun_id=${idA}&tipe=transfer`);
  await cek('filter tipe=transfer hanya 1 baris', r.status === 200 && (r.data?.data ?? []).length === 1,
    `baris=${r.data?.data?.length}`);
  r = await req('GET', '/api/akuntansi/kas/mutasi?tipe=ngawur');
  await cek('filter tipe tak dikenal diabaikan/bukan galat', r.status === 200, `status=${r.status}`);

  /* --- 5) Kategori biaya & pemasukan ------------------------------------ */
  r = await req('POST', '/api/akuntansi/kategori', { nama: 'Uji Biaya (AKTU)', tipe: 'pengeluaran' });
  const katBiaya = r.data?.id as number;
  await cek('tambah kategori pengeluaran → 201', r.status === 201 && Number(katBiaya) > 0, `status=${r.status}`);

  r = await req('POST', '/api/akuntansi/kategori', { nama: 'Uji Biaya (AKTU)', tipe: 'pengeluaran' });
  await cek('kategori kembar → 409', r.status === 409, `status=${r.status}`);
  r = await req('POST', '/api/akuntansi/kategori', { nama: 'Uji Aneh', tipe: 'nekat' });
  await cek('tipe kategori tak dikenal → 400', r.status === 400, `status=${r.status}`);

  r = await req('POST', '/api/akuntansi/kategori', { nama: 'Uji Masuk (AKTU)', tipe: 'pemasukan' });
  const katMasuk = r.data?.id as number;
  await cek('tambah kategori pemasukan → 201', r.status === 201 && Number(katMasuk) > 0, `status=${r.status}`);

  r = await req('GET', '/api/akuntansi/kategori?tipe=pengeluaran');
  await cek('filter kategori pengeluaran', r.status === 200 && (r.data?.data ?? []).some((k: any) => k.id === katBiaya));
  r = await req('GET', '/api/akuntansi/kategori?tipe=pemasukan');
  await cek('filter kategori pemasukan tidak bocor pengeluaran',
    r.status === 200 && (r.data?.data ?? []).every((k: any) => k.tipe === 'pemasukan'));

  /* --- 6) Pengeluaran & pemasukan lain ---------------------------------- */
  r = await req('POST', '/api/akuntansi/pengeluaran', { akun_id: idA, kategori_id: katMasuk, jumlah: 1000 });
  await cek('pengeluaran dengan kategori pemasukan → 400', r.status === 400, `status=${r.status}`);
  r = await req('POST', '/api/akuntansi/pengeluaran', { akun_id: idA, jumlah: 1000 });
  await cek('pengeluaran tanpa kategori → 400', r.status === 400, `status=${r.status}`);

  r = await req('POST', '/api/akuntansi/pengeluaran', { akun_id: idA, kategori_id: katBiaya, jumlah: 7000, keterangan: 'Uji biaya operasional' });
  await cek('catat pengeluaran → 201', r.status === 201, `status=${r.status}`);
  await cek('pengeluaran mengurangi saldo', await saldo('AKTU-KASA') === 83000, `saldo=${await saldo('AKTU-KASA')}`);

  r = await req('POST', '/api/akuntansi/pemasukan', { akun_id: idA, kategori_id: katBiaya, jumlah: 1000 });
  await cek('pemasukan dengan kategori pengeluaran → 400', r.status === 400, `status=${r.status}`);
  r = await req('POST', '/api/akuntansi/pemasukan', { akun_id: idA, kategori_id: katMasuk, jumlah: 3000, keterangan: 'Uji pemasukan lain' });
  await cek('catat pemasukan lain → 201', r.status === 201, `status=${r.status}`);
  await cek('pemasukan menaikkan saldo', await saldo('AKTU-KASA') === 86000, `saldo=${await saldo('AKTU-KASA')}`);

  r = await req('GET', `/api/akuntansi/kas/mutasi?akun_id=${idA}&tipe=keluar`);
  await cek('mutasi keluar membawa nama kategori', (r.data?.data ?? []).some((m: any) => m.kategori === 'Uji Biaya (AKTU)'),
    JSON.stringify((r.data?.data ?? []).map((m: any) => m.kategori)));

  /* --- 7) Piutang: parsial → lunas (kas bergerak) ----------------------- */
  const idUser = await jml(`SELECT id AS n FROM users ORDER BY id LIMIT 1`);
  const idGudang = await jml(`SELECT id AS n FROM warehouses ORDER BY id LIMIT 1`);
  const idPelanggan = await ins(`INSERT INTO customers (nama, telepon) VALUES ('Pelanggan AKTU', '08119990001')`);
  const idJual = await ins(
    `INSERT INTO sales (no_dokumen, kasir_id, customer_id, warehouse_id, subtotal, total, status)
     VALUES ('UJI-AKTU-SL', ?, ?, ?, 40000, 40000, 'disahkan')`,
    idUser, idPelanggan, idGudang,
  );
  const idPiutang = await ins(
    `INSERT INTO receivables (sale_id, customer_id, jatuh_tempo, total, terbayar, status)
     VALUES (?, ?, '2020-01-05', 40000, 0, 'belum')`,
    idJual, idPelanggan,
  );
  await cek('data siap: penjualan tempo', idJual > 0 && idPiutang > 0);

  r = await req('GET', '/api/akuntansi/piutang');
  const barisPiutang = (r.data?.baris ?? []).find((b: any) => b.id === idPiutang);
  await cek('daftar piutang memuat tagihan uji + aging', r.status === 200 && Boolean(barisPiutang) && Number(barisPiutang?.sisa) === 40000 && barisPiutang?.umur_ember === '0-30',
    JSON.stringify(barisPiutang));

  r = await req('GET', '/api/akuntansi/laporan/rekap-piutang');
  await cek('rekap piutang memuat entitas uji (sebelum bayar)',
    r.status === 200 && (r.data?.baris ?? []).some((x: any) => x.entitas === 'Pelanggan AKTU' && Number(x.sisa) === 40000));

  r = await req('POST', `/api/akuntansi/piutang/${idPiutang}/bayar`, { jumlah: 50000, metode: 'tunai' });
  await cek('bayar melebihi sisa → 400', r.status === 400, `status=${r.status} ${r.data?.pesan ?? ''}`);

  r = await req('POST', `/api/akuntansi/piutang/${idPiutang}/bayar`, { jumlah: 15000, metode: 'tunai' });
  await cek('bayar sebagian → 201 status sebagian + sisa 25.000',
    r.status === 201 && r.data?.status === 'sebagian' && Number(r.data?.sisa) === 25000,
    JSON.stringify(r.data));

  const kasPiu15 = await jml(`SELECT COUNT(*) AS n FROM cash_transactions WHERE sumber_tipe = 'pembayaran' AND tipe = 'masuk' AND jumlah = 15000`);
  await cek('kas masuk dari pelunasan piutang tercatat (tanpa jurnal)', kasPiu15 >= 1, `baris=${kasPiu15}`);

  r = await req('GET', `/api/akuntansi/pembayaran/piutang/${idPiutang}`);
  await cek('riwayat pembayaran tagihan → 1 baris', r.status === 200 && (r.data?.data ?? []).length === 1,
    `baris=${r.data?.data?.length}`);

  r = await req('GET', `/api/akuntansi/pembayaran/utang/${idPiutang}`);
  await cek('riwayat pembayaran tipe tak dikenal → 400', r.status === 400, `status=${r.status}`);

  r = await req('POST', `/api/akuntansi/piutang/${idPiutang}/bayar`, { jumlah: 25000, metode: 'tunai' });
  await cek('pelunasan sisa → lunas', r.status === 201 && r.data?.status === 'lunas' && Number(r.data?.sisa) === 0,
    JSON.stringify(r.data));

  r = await req('POST', `/api/akuntansi/piutang/${idPiutang}/bayar`, { jumlah: 1000, metode: 'tunai' });
  await cek('bayar tagihan lunas → 409', r.status === 409, `status=${r.status}`);

  r = await req('POST', '/api/akuntansi/piutang/99999999/bayar', { jumlah: 1000, metode: 'tunai' });
  await cek('bayar tagihan tak ada → 404', r.status === 404, `status=${r.status}`);

  r = await req('GET', '/api/akuntansi/piutang');
  await cek('tagihan lunas hilang dari daftar piutang',
    !(r.data?.baris ?? []).some((b: any) => b.id === idPiutang));

  r = await req('GET', `/api/akuntansi/pembayaran/piutang/${idPiutang}`);
  await cek('riwayat pembayaran lengkap → 2 baris', (r.data?.data ?? []).length === 2,
    `baris=${r.data?.data?.length}`);

  /* --- 8) Hutang pembelian: lunas sekali jalan -------------------------- */
  const idPemasok = await ins(`INSERT INTO suppliers (nama, telepon) VALUES ('Pemasok AKTU', '08119990002')`);
  const idBeli = await ins(
    `INSERT INTO purchases (no_dokumen, supplier_id, warehouse_id, total, status)
     VALUES ('UJI-AKTU-PB', ?, ?, 50000, 'disahkan')`,
    idPemasok, idGudang,
  );
  const idHutang = await ins(
    `INSERT INTO payables (purchase_id, supplier_id, jatuh_tempo, total, terbayar, status)
     VALUES (?, ?, '2020-02-02', 50000, 0, 'belum')`,
    idBeli, idPemasok,
  );
  await cek('data siap: pembelian tempo', idBeli > 0 && idHutang > 0);

  r = await req('GET', '/api/akuntansi/hutang');
  const barisHutang = (r.data?.baris ?? []).find((b: any) => b.id === idHutang);
  await cek('daftar hutang memuat tagihan uji', r.status === 200 && Boolean(barisHutang) && Number(barisHutang?.sisa) === 50000,
    JSON.stringify(barisHutang));

  r = await req('POST', `/api/akuntansi/hutang/${idHutang}/bayar`, { jumlah: 50000, metode: 'transfer' });
  await cek('bayar hutang lunas → 201', r.status === 201 && r.data?.status === 'lunas', JSON.stringify(r.data));
  const kasHut50 = await jml(`SELECT COUNT(*) AS n FROM cash_transactions WHERE sumber_tipe = 'pembayaran' AND tipe = 'keluar' AND jumlah = 50000`);
  await cek('kas keluar dari pembayaran hutang tercatat', kasHut50 >= 1, `baris=${kasHut50}`);

  r = await req('GET', '/api/akuntansi/hutang');
  await cek('hutang lunas hilang dari daftar', !(r.data?.baris ?? []).some((b: any) => b.id === idHutang));

  /* --- 9) Laporan dasar -------------------------------------------------- */
  r = await req('GET', '/api/akuntansi/laporan/kas-bank');
  await cek('laporan kas-bank → 200 + total', r.status === 200 && typeof r.data?.total?.saldo_akhir === 'number',
    `status=${r.status}`);
  await cek('rekening uji ikut tercantum di kas-bank',
    (r.data?.akun ?? []).some((a: any) => a.kode === 'AKTU-KASA' && typeof a.saldo_akhir === 'number'));

  r = await req('GET', '/api/akuntansi/laporan/laba-rugi?dari=2000-01-01&sampai=2999-12-31');
  await cek('laba-rugi → 200 + laba_bersih', r.status === 200 && typeof r.data?.laba_bersih === 'number',
    `status=${r.status}`);
  await cek('rincian laba-rugi memuat kategori biaya uji',
    (r.data?.rincian_pengeluaran ?? []).some((x: any) => x.kategori === 'Uji Biaya (AKTU)' && Number(x.jumlah) === 7000),
    JSON.stringify(r.data?.rincian_pengeluaran));

  r = await req('GET', '/api/akuntansi/laporan/rekap-hutang');
  await cek('rekap hutang → 200 + total_sisa', r.status === 200 && typeof r.data?.total_sisa === 'number');

  r = await req('GET', '/api/akuntansi/laporan/neraca');
  await cek('laporan neraca lama TIDAK ada lagi (404)', r.status === 404, `status=${r.status}`);

  r = await reqKirim('GET', '/api/akuntansi/laporan/kas-bank/xlsx');
  await cek('ekspor Excel kas-bank → 200 + xlsx', r.status === 200 && /spreadsheet/.test(r.tipe), `${r.status} ${r.tipe}`);

  /* --- 10) Jurnal lama (warisan migrasi) -------------------------------- */
  r = await req('GET', '/api/akuntansi/jurnal-lama');
  await cek('GET jurnal-lama → 200 + ringkasan', r.status === 200 && typeof r.data?.jumlah_jurnal === 'number',
    `status=${r.status}`);
  r = await reqKirim('GET', '/api/akuntansi/jurnal-lama/xlsx');
  await cek('ekspor Excel jurnal lama → 200 + xlsx', r.status === 200 && /spreadsheet/.test(r.tipe), `${r.status} ${r.tipe}`);

  /* --- 11) Nonaktifkan rekening via API lalu bersih ---------------------- */
  r = await req('DELETE', `/api/akuntansi/kas/akun/${idA}`);
  await cek('hapus/nonaktif rekening terpakai → dinonaktifkan + jumlah_mutasi',
    r.status === 200 && r.data?.dinonaktifkan === true && Number(r.data?.jumlah_mutasi) >= 5,
    JSON.stringify(r.data));
  r = await req('DELETE', `/api/akuntansi/kas/akun/${idB}`);
  await cek('rekening transfer ikut tercatat mutasinya', r.status === 200 && Number(r.data?.jumlah_mutasi) >= 1,
    JSON.stringify(r.data));
  r = await req('DELETE', '/api/akuntansi/kas/akun/99999999');
  await cek('hapus rekening tak ada → 404', r.status === 404, `status=${r.status}`);

  await bersihkan();
  for (const m of metodeDibuat) {
    (await run(`DELETE FROM payment_method_accounts WHERE metode = ?`, m));
  }
  const sisa = await jml(`SELECT COUNT(*) AS n FROM cash_accounts WHERE kode LIKE 'AKTU-%'`)
    + await jml(`SELECT COUNT(*) AS n FROM sales WHERE no_dokumen LIKE 'UJI-AKTU-%'`)
    + await jml(`SELECT COUNT(*) AS n FROM expense_categories WHERE nama LIKE '%(AKTU)'`);
  await cek('cleanup: data uji terhapus', sisa === 0, `sisa=${sisa}`);

  console.log(`\nHasil: ${lulus} lulus, ${gagal} gagal`);
  await pool.end();
  process.exit(gagal ? 1 : 0);
}

await main().catch(async (err) => {
  console.error('GAGAL total:', err);
  try { await bersihkan(); } catch { /* abai */ }
  await pool.end();
  process.exit(1);
});

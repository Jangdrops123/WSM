// Uji integrasi modul Stok (Master Produk tanpa varian — stok per produk per gudang).
// Jalankan: npx tsx scripts/uji-stok.ts   (server API harus hidup di :3001)
import { all, get, pool, run } from '../server/db.pg.ts';
import { ubahStok } from '../server/lib/stok.ts';
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

const bersihkan = async () => {
  // transfer uji melibatkan gudang STK — hapus sebelum produk & gudang
  await run(`
    DELETE FROM stock_transfer_items WHERE transfer_id IN (
      SELECT id FROM stock_transfers
      WHERE dari_warehouse IN (SELECT id FROM warehouses WHERE kode LIKE 'STK-%')
         OR ke_warehouse  IN (SELECT id FROM warehouses WHERE kode LIKE 'STK-%'));
    DELETE FROM stock_transfers
      WHERE dari_warehouse IN (SELECT id FROM warehouses WHERE kode LIKE 'STK-%')
         OR ke_warehouse  IN (SELECT id FROM warehouses WHERE kode LIKE 'STK-%');
  `)
  const produkIds = (await all(`SELECT id FROM products WHERE sku LIKE 'STK-%'`)).map((r: any) => r.id);
  for (const id of produkIds) {
    (await run('DELETE FROM stock_ledger WHERE product_id = ?', id));
    (await run('DELETE FROM stock_balances WHERE product_id = ?', id));
    (await run('DELETE FROM unit_conversions WHERE product_id = ?', id));
  }
  await run(`
    DELETE FROM products WHERE sku LIKE 'STK-%';
    DELETE FROM locations WHERE kode_lokasi LIKE 'STK-%';
    DELETE FROM warehouses WHERE kode LIKE 'STK-%';
    DELETE FROM categories WHERE nama LIKE 'STK%';
    DELETE FROM settings WHERE kunci = 'stok_minus_izinkan';
    INSERT INTO settings (kunci, nilai, keterangan) VALUES ('stok_minus_izinkan', 'false', 'Izinkan stok menjadi minus jika stok fisik kurang')
      ON CONFLICT (kunci) DO UPDATE SET nilai = 'false';
  `)
};
await bersihkan();

// Saldo = per produk per gudang (penempatan lokasi dicatat di kartu stok).
const saldo = async (produkId: number, whId: number) =>
  Number(
    (await get('SELECT COALESCE(qty,0) AS q FROM stock_balances WHERE product_id=? AND warehouse_id=?', produkId, whId))?.['q'] ?? 0,
  );
const jumlahLedger = async (produkId: number) => Number((await get('SELECT COUNT(*) c FROM stock_ledger WHERE product_id=?', produkId))?.['c'] ?? 0);

// --- Setup via API ---------------------------------------------------------
const kat = await req('POST', '/api/master/kategori', { nama: 'STK Kategori' });
const wh1 = await req('POST', '/api/master/gudang', { kode: 'STK-A', nama: 'Gudang Uji A' });
const wh2 = await req('POST', '/api/master/gudang', { kode: 'STK-B', nama: 'Gudang Uji B' });
const loc1 = await req('POST', '/api/master/lokasi', { warehouse_id: wh1.data?.id, kode_lokasi: 'STK-A-01', zona: 'A', rak: '01', bin: '01' });
const loc2 = await req('POST', '/api/master/lokasi', { warehouse_id: wh2.data?.id, kode_lokasi: 'STK-B-01', zona: 'B', rak: '01', bin: '01' });
await cek('setup gudang & lokasi', [wh1, wh2, loc1, loc2].every((x) => x.status === 201));

// Dua produk terpisah (SKU unik) — pengganti dua varian pada skema lama.
const p1 = await req('POST', '/api/master/produk', {
  nama: 'STK Uji Produk 1',
  sku: 'STK-1',
  barcode: '7770001',
  category_id: kat.data?.id,
  harga_beli: 1000,
  harga_jual: 2000,
  stok_min: 20,
  aktif: 1,
  konversi: [],
});
const p2 = await req('POST', '/api/master/produk', {
  nama: 'STK Uji Produk 2',
  sku: 'STK-2',
  barcode: '7770002',
  category_id: kat.data?.id,
  harga_beli: 500,
  harga_jual: 900,
  stok_min: 0,
  aktif: 1,
  konversi: [],
});
await cek('setup produk uji', p1.status === 201 && p2.status === 201, `${p1.status}/${p2.status}`);
const A1 = { productId: p1.data?.id as number, warehouseId: wh1.data!.id as number, locationId: loc1.data!.id as number };

// --- 1. Kenaikan stok wajib tercatat di kartu stok --------------------------
const ledgerAwal = await jumlahLedger(A1.productId);
const h1 = await ubahStok({ ...A1, masuk: 10, hargaMasuk: 1000, tipeDokumen: 'pembelian' });
await cek('masuk 10 @1.000 → saldo 10', h1.saldo === 10, `saldo ${h1.saldo}`);
await cek('kartu stok bertambah otomatis', await jumlahLedger(A1.productId) === ledgerAwal + 1);
await cek('rata-rata = 1.000', Math.abs(h1.rataBergerak - 1000) < 0.01, String(h1.rataBergerak));

// --- 2. Rata-rata bergerak -------------------------------------------------
const h2 = await ubahStok({ ...A1, masuk: 10, hargaMasuk: 1500, tipeDokumen: 'pembelian' });
await cek('masuk 10 @1.500 → saldo 20', h2.saldo === 20, `saldo ${h2.saldo}`);
await cek('rata-rata bergerak = 1.250', Math.abs(h2.rataBergerak - 1250) < 0.01, String(h2.rataBergerak));

// --- 3. Pengeluaran memakai rata-rata bergerak -----------------------------
const h3 = await ubahStok({ ...A1, keluar: 5, tipeDokumen: 'penjualan' });
const nilaiKeluar = Number((await get('SELECT nilai_unit n FROM stock_ledger ORDER BY id DESC LIMIT 1'))?.['n']);
await cek('keluar 5 → saldo 15', h3.saldo === 15, `saldo ${h3.saldo}`);
await cek('nilai keluar = rata-rata 1.250', Math.abs(nilaiKeluar - 1250) < 0.01, String(nilaiKeluar));

// --- 4. Stok minus ditolak & atomik (tidak ada jejak) ----------------------
const ledgerSebelum = await jumlahLedger(A1.productId);
let errMinus: any = null;
try {
  await ubahStok({ ...A1, keluar: 100, tipeDokumen: 'penjualan' });
} catch (e) {
  errMinus = e;
}
await cek('stok tidak mencukupi → ditolak', errMinus !== null && String((errMinus as Error).message).includes('tidak mencukupi'), String(errMinus));
await cek('gagal = batal semua: saldo tetap 15', await saldo(A1.productId, A1.warehouseId) === 15, String(await saldo(A1.productId, A1.warehouseId)));
await cek('gagal = batal semua: kartu stok tidak bertambah', await jumlahLedger(A1.productId) === ledgerSebelum);

// --- 5. Pengaturan stok minus (API) + batas minus --------------------------
const setOn = await req('PUT', '/api/stock/pengaturan', { stok_minus_izinkan: true });
await cek('pengaturan: izinkan stok minus', setOn.status === 200, String(setOn.status));
const hMinus = await ubahStok({ ...A1, keluar: 100, tipeDokumen: 'penjualan' });
await cek('stok minus diizinkan → saldo -85', hMinus.saldo === -85, `saldo ${hMinus.saldo}`);
const setOff = await req('PUT', '/api/stock/pengaturan', { stok_minus_izinkan: false });
await cek('pengaturan: kembali tidak boleh minus', setOff.status === 200);
const getPeng = await req('GET', '/api/stock/pengaturan');
await cek('GET pengaturan: default false + valuasi rata-rata bergerak', getPeng.data?.stok_minus_izinkan === false && getPeng.data?.valuasi === 'rata_rata_bergerak');

// pulihkan await saldo(masuk 100) supaya tidak minus untuk uji berikut
await ubahStok({ ...A1, masuk: 100, hargaMasuk: 1250, tipeDokumen: 'penyesuaian' });
await cek('saldo dipulihkan = 15', await saldo(A1.productId, A1.warehouseId) === 15, String(await saldo(A1.productId, A1.warehouseId)));

// --- 6. Halaman Stok: cari + filter + indikator bawah minimum --------------
const saldoApi = await req('GET', '/api/stock/saldo?cari=STK-1');
await cek('cari saldo via SKU', saldoApi.status === 200 && saldoApi.data?.total === 1, `total ${saldoApi.data?.total}`);
const kurang = await req('GET', '/api/stock/saldo?kurang=1');
const adaKurang = (kurang.data?.data ?? []).some((r: any) => r.sku === 'STK-1');
await cek('indikator stok di bawah minimum', kurang.status === 200 && adaKurang, `jumlah kurang ${kurang.data?.ringkasan?.jumlah_kurang}`);
const filterGudang = await req('GET', `/api/stock/saldo?gudang=${wh2.data?.id}`);
await cek('filter gudang', filterGudang.status === 200 && (filterGudang.data?.data ?? []).every((r: any) => r.warehouse_id === wh2.data?.id));
const filterKategori = await req('GET', `/api/stock/saldo?kategori=${kat.data?.id}`);
await cek('filter kategori', filterKategori.status === 200 && (filterKategori.data?.data ?? []).every((r: any) => r.kategori === 'STK Kategori'));
await cek('ringkasan nilai persediaan terhitung', typeof filterKategori.data?.ringkasan?.nilai_persediaan === 'number');

// --- 7. Kartu Stok per produk ---------------------------------------------
const kartu = await req('GET', `/api/stock/kartu?product_id=${A1.productId}`);
await cek('kartu stok: daftar baris', kartu.status === 200 && kartu.data?.total >= 3, `total ${kartu.data?.total}`);
await cek('kartu stok: memuat masuk/keluar/saldo/pengguna', ['qty_masuk', 'qty_keluar', 'saldo', 'tanggal', 'tipe_dokumen'].every((k) => k in (kartu.data?.data?.[0] ?? {})));
await cek('kartu stok: ringkasan rata-rata bergerak', Math.abs(Number(kartu.data?.produk?.rata_bergerak) - 1250) < 100, String(kartu.data?.produk?.rata_bergerak));
const kartuFilter = await req('GET', `/api/stock/kartu?product_id=${A1.productId}&gudang=${wh2.data?.id}`);
await cek('kartu stok: filter gudang', kartuFilter.status === 200 && (kartuFilter.data?.data ?? []).every((r: any) => r.warehouse_id === wh2.data?.id));

// --- 8. Transfer: draft → kirim → terima -----------------------------------
const tf1 = await req('POST', '/api/stock/transfer', {
  dari_warehouse: wh1.data?.id,
  ke_warehouse: wh2.data?.id,
  items: [{ product_id: A1.productId, qty: 6 }],
});
await cek('transfer draft dibuat (no_dokumen TRF)', tf1.status === 201 && /^TRF-\d{4}-\d{4}$/.test(tf1.data?.data?.no_dokumen ?? ''), tf1.data?.data?.no_dokumen);
const idTf1 = tf1.data?.id;
const sblmKirim = await saldo(A1.productId, A1.warehouseId);

const kir1 = await req('POST', `/api/stock/transfer/${idTf1}/kirim`);
await cek('kirim: stok keluar gudang asal', kir1.status === 200 && await saldo(A1.productId, A1.warehouseId) === sblmKirim - 6, `${sblmKirim} → ${await saldo(A1.productId, A1.warehouseId)}`);
await cek('kirim: tahap = dikirim', kir1.data?.data?.tahap === 'dikirim', kir1.data?.data?.tahap);

const terimaTanpaKirim = await req('POST', '/api/stock/transfer', { dari_warehouse: wh1.data?.id, ke_warehouse: wh2.data?.id, items: [{ product_id: A1.productId, qty: 1 }] });
const cobaTerima = await req('POST', `/api/stock/transfer/${terimaTanpaKirim.data?.id}/terima`, { location_id: loc2.data?.id });
await cek('terima sebelum kirim → ditolak', cobaTerima.status === 409, `${cobaTerima.status} ${cobaTerima.data?.pesan}`);

const ter1 = await req('POST', `/api/stock/transfer/${idTf1}/terima`, { location_id: loc2.data?.id });
const stokB = await saldo(A1.productId, wh2.data!.id as number);
await cek('terima: stok masuk gudang tujuan', ter1.status === 200 && stokB === 6, `tujuan ${stokB}`);
await cek('terima: transfer disahkan (tahap selesai)', ter1.data?.data?.tahap === 'selesai' && ter1.data?.data?.status === 'disahkan', ter1.data?.data?.status);

const kartuSetelah = await req('GET', `/api/stock/kartu?product_id=${A1.productId}`);
const adaTransfer = (kartuSetelah.data?.data ?? []).some((r: any) => r.tipe_dokumen === 'transfer' && r.no_dokumen);
await cek('kartu stok memuat dokumen sumber transfer (no_dokumen)', adaTransfer);

// kirim dengan stok tidak mencukupi → ditolak & tanpa jejak
const tf2 = await req('POST', '/api/stock/transfer', { dari_warehouse: wh2.data?.id, ke_warehouse: wh1.data?.id, items: [{ product_id: A1.productId, qty: 999 }] });
const idTf2 = tf2.data?.id;
const ledgerSebelum2 = await jumlahLedger(A1.productId);
const kir2 = await req('POST', `/api/stock/transfer/${idTf2}/kirim`);
await cek('kirim melebihi stok → ditolak', kir2.status === 409, `${kir2.status} ${kir2.data?.pesan}`);
await cek('kirim gagal tidak meninggalkan kartu stok', await jumlahLedger(A1.productId) === ledgerSebelum2);
const tf2Setelah = await req('GET', `/api/stock/transfer/${idTf2}`);
await cek('kirim gagal: transfer tetap draft', tf2Setelah.data?.data?.tahap === 'draft' && !tf2Setelah.data?.data?.dikirim_pada);

// batal transfer yang sudah diterima → kedua sisi dipulihkan
const batal = await req('POST', `/api/stock/transfer/${idTf1}/batal`);
const stokAsalSetelahBatal = await saldo(A1.productId, A1.warehouseId);
const stokTujuanSetelahBatal = await saldo(A1.productId, wh2.data!.id as number);
await cek('batal transfer diterima → stok kembali ke asal', batal.status === 200 && stokAsalSetelahBatal === sblmKirim, `${stokAsalSetelahBatal} vs ${sblmKirim}`);
await cek('batal transfer: stok tujuan kembali 0', stokTujuanSetelahBatal === 0, String(stokTujuanSetelahBatal));
await cek('batal: status = batal', batal.data?.data?.status === 'batal', batal.data?.data?.status);

const daftarTf = await req('GET', '/api/stock/transfer?tahap=batal');
await cek('filter daftar transfer per tahap', daftarTf.status === 200 && (daftarTf.data?.data ?? []).every((t: any) => t.tahap === 'batal'));

// --- 9. Invariant: setiap saldo = jumlah kartu stok ------------------------
const selisih = await get(
  `SELECT COUNT(*) c FROM stock_balances sb
   WHERE ABS(sb.qty - COALESCE((SELECT SUM(qty_masuk) - SUM(qty_keluar) FROM stock_ledger l
     WHERE l.product_id = sb.product_id AND l.warehouse_id = sb.warehouse_id), 0)) > 0.0001`,
);
await cek('INVARIAN: setiap saldo = jumlah kartu stok', Number((selisih as any)?.c ?? 0) === 0, `selisih ${(selisih as any)?.c}`);

// --- 10. Audit log pengaturan ---------------------------------------------
const auditPeng = (await get(`SELECT COUNT(*) c FROM audit_logs WHERE tabel='settings' AND record_id='stok_minus_izinkan'`));
await cek('perubahan pengaturan stok minus tercatat di audit', Number((auditPeng as any)?.c ?? 0) >= 2, `baris ${(auditPeng as any)?.c}`);

await bersihkan();
await pool.end();

console.log(`\nHasil: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);

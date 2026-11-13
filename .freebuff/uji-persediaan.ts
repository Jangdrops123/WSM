// Uji integrasi API modul Persediaan Sub — jalankan dengan server hidup :3001
// npx tsx .freebuff/uji-persediaan.ts
import ExcelJS from 'exceljs';

const BASE = 'http://127.0.0.1:3001';
let gagal = 0;

function ok(cond: boolean, pesan: string, detail?: unknown): void {
  if (cond) console.log(`  ✓ ${pesan}`);
  else {
    gagal++;
    console.error(`  ✗ ${pesan}`, detail !== undefined ? JSON.stringify(detail).slice(0, 400) : '');
  }
}

async function jalan<T = unknown>(metode: string, url: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE}${url}`, {
    method: metode,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* bukan JSON */
  }
  return { status: res.status, data: data as T };
}

async function utama() {
  /* --- siapkan: gudang + produk ---------------------------------------- */
  const opsi = await jalan<{ data: { id: number; label: string }[] }>('GET', '/api/master/gudang/opsi?per=500');
  const gudangId = opsi.data.data[0]?.id;
  ok(!!gudangId, 'gudang tersedia', opsi.data);

  const cari = await jalan<{ data: { product_id: number; nama: string; stok: number; sku: string }[] }>(
    'GET',
    '/api/pos/cari?cari=a',
  );
  const produk = cari.data.data[0];
  ok(!!produk, 'produk pencarian tersedia', cari.data);

  const stokSekarang = async (): Promise<number> => {
    const r = await jalan<{ data: { product_id: number; qty: number; satuan: string | null }[] }>(
      'GET',
      `/api/persediaan/stok?gudang=${gudangId}&produk=${produk!.product_id}`,
    );
    return r.data.data[0]?.qty ?? -999;
  };
  const awal = await stokSekarang();
  console.log(`  stok awal ${produk!.nama} = ${awal}`);

  /* --- 1. Item Masuk ------------------------------------------------------ */
  console.log('1. Item Masuk');
  const masuk = await jalan<{ data: { id: number; no_dokumen: string; status: string } }>('POST', '/api/persediaan', {
    arah: 'masuk',
    warehouse_id: gudangId,
    tanggal: new Date().toISOString().slice(0, 10),
    alasan: 'stok_awal',
    keterangan: 'uji stok awal',
    items: [{ product_id: produk!.product_id, qty: 7 }],
  });
  ok(masuk.status === 201, 'dokumen masuk dibuat', masuk.data);
  ok(/^PSM-\d{4}-\d{4}$/.test(masuk.data.data?.no_dokumen ?? ''), 'nomor PSM-YYYY-NNNN', masuk.data);
  ok((await stokSekarang()) === awal + 7, 'stok bertambah 7', { sesudah: await stokSekarang() });

  /* --- 2. Item Keluar ----------------------------------------------------- */
  console.log('2. Item Keluar');
  const keluar = await jalan<{ data: { id: number; no_dokumen: string } }>('POST', '/api/persediaan', {
    arah: 'keluar',
    warehouse_id: gudangId,
    alasan: 'rusak',
    keterangan: 'uji keluar',
    items: [{ product_id: produk!.product_id, qty: 3 }],
  });
  ok(keluar.status === 201, 'dokumen keluar dibuat', keluar.data);
  ok(/^PSK-\d{4}-\d{4}$/.test(keluar.data.data?.no_dokumen ?? ''), 'nomor PSK-YYYY-NNNN', keluar.data);
  ok((await stokSekarang()) === awal + 4, 'stok berkurang 3', { sesudah: await stokSekarang() });

  /* --- 3. tolak keluar melebihi stok (stok_minus mati) --------------------- */
  console.log('3. tolak stok kurang');
  const kurang = await jalan<{ pesan: string }>('POST', '/api/persediaan', {
    arah: 'keluar',
    warehouse_id: gudangId,
    alasan: 'hilang',
    items: [{ product_id: produk!.product_id, qty: 999999 }],
  });
  ok(kurang.status === 409, '409 stok tidak cukup', kurang);
  ok((await stokSekarang()) === awal + 4, 'stok tidak berubah setelah gagal');

  /* --- 4. validasi alasan/keterangan --------------------------------------- */
  console.log('4. validasi input');
  const salahAlasan = await jalan<{ pesan: string }>('POST', '/api/persediaan', {
    arah: 'masuk',
    warehouse_id: gudangId,
    alasan: 'rusak', // alasan keluar dipakai di dokumen masuk
    items: [{ product_id: produk!.product_id, qty: 1 }],
  });
  ok(salahAlasan.status === 400, 'alasan salah arah → 400', salahAlasan);
  const tanpaKet = await jalan<{ pesan: string }>('POST', '/api/persediaan', {
    arah: 'masuk',
    warehouse_id: gudangId,
    alasan: 'lainnya',
    keterangan: '',
    items: [{ product_id: produk!.product_id, qty: 1 }],
  });
  ok(tanpaKet.status === 400, 'alasan Lainnya tanpa keterangan → 400', tanpaKet);

  /* --- 5. riwayat + urut A-Z/Z-A + cari ------------------------------------- */
  console.log('5. riwayat');
  const asc = await jalan<{ data: { no_dokumen: string }[]; total: number }>(
    'GET',
    '/api/persediaan?arah=masuk&urut=no_dokumen&arah_urut=ASC',
  );
  ok(asc.data.total >= 1, 'riwayat masuk punya dokumen', { total: asc.data.total });
  const desc = await jalan<{ data: { no_dokumen: string }[] }>(
    'GET',
    '/api/persediaan?arah=masuk&urut=no_dokumen&arah_urut=DESC',
  );
  const urutAsc = asc.data.data.map((d) => d.no_dokumen);
  const urutDesc = desc.data.data.map((d) => d.no_dokumen);
  ok(JSON.stringify(urutAsc) === JSON.stringify([...urutDesc].reverse()), 'A-Z vs Z-A terbalik', { urutAsc, urutDesc });
  const cariDok = await jalan<{ data: { no_dokumen: string }[] }>(
    'GET',
    `/api/persediaan?arah=masuk&cari=${masuk.data.data!.no_dokumen}`,
  );
  ok(cariDok.data.data.length === 1, 'cari nomor dokumen', cariDok.data);

  /* --- 6. detail ----------------------------------------------------------- */
  console.log('6. detail');
  const det = await jalan<{
    data: { dokumen: { no_dokumen: string; alasan_label: string; total_qty: number }; item: { qty: number; stok_sebelum: number; stok_sesudah: number; satuan: string | null }[] };
  }>('GET', `/api/persediaan/${masuk.data.data!.id}`);
  ok(det.status === 200 && det.data.data.item.length === 1, 'detail + item', det.data);
  const it = det.data.data.item[0];
  ok(it.stok_sesudah === it.stok_sebelum + it.qty, 'snapshot sebelum + qty = sesudah', it);
  ok(det.data.data.dokumen.alasan_label === 'Stok Awal', 'alasan_label terisi', det.data.data.dokumen);

  /* --- 7. kartu stok (riwayat per produk) ----------------------------------- */
  console.log('7. kartu stok');
  const kartu = await jalan<{ data: { tipe_dokumen: string; qty_masuk: number; qty_keluar: number }[] }>(
    'GET',
    `/api/stock/kartu?product_id=${produk!.product_id}&gudang=${gudangId}`,
  );
  const barisPenyesuaian = kartu.data.data.filter(
    (k) => k.tipe_dokumen === 'penyesuaian' && (k.qty_masuk > 0 || k.qty_keluar > 0),
  );
  ok(barisPenyesuaian.length >= 2, 'kartu stok mencatat masuk + keluar', {
    jumlah: barisPenyesuaian.length,
  });

  /* --- 8. ekspor & template Excel ------------------------------------------ */
  console.log('8. ekspor/template');
  for (const [url, nama] of [
    [`/api/persediaan/ekspor?arah=masuk`, 'ekspor'],
    [`/api/persediaan/template?arah=masuk`, 'template'],
  ] as const) {
    const res = await fetch(`${BASE}${url}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    const pk = buf[0] === 0x50 && buf[1] === 0x4b;
    ok(res.status === 200 && pk, `${nama} .xlsx valid (PK zip)`, {
      status: res.status,
      ct: res.headers.get('content-type'),
      len: buf.length,
    });
  }

  /* --- 9. impor massal ------------------------------------------------------ */
  console.log('9. impor massal');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.columns = ['Tanggal', 'Gudang', 'Alasan', 'Keterangan', 'Kode Item', 'Nama', 'Qty'].map((h, i) => ({
    key: h,
    header: h,
    width: 16 + i,
  }));
  const kode = produk!.sku;
  const gudangLabel = opsi.data.data[0]?.label ?? 'Gudang';
  // 2 baris header sama → 1 dokumen; 1 baris beda keterangan → 1 dokumen
  ws.addRow({ Tanggal: '', Gudang: gudangLabel, Alasan: 'Stok Awal', 'Kode Item': kode, Qty: 2 });
  ws.addRow({ Tanggal: '', Gudang: gudangLabel, Alasan: 'Stok Awal', 'Kode Item': kode, Qty: 3 });
  ws.addRow({ Tanggal: '', Gudang: gudangLabel, Alasan: 'Temuan', Keterangan: 'temuan rak', 'Kode Item': kode, Qty: 1 });
  // 1 baris rusak → error, tidak menghalangi dokumen lain
  ws.addRow({ Tanggal: '', Gudang: gudangLabel, Alasan: 'Temuan', Keterangan: 'temuan rak', 'Kode Item': 'TIDAK-ADA', Qty: 1 });
  const buf = Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
  const sebelumImpor = await stokSekarang();
  const impor = await jalan<{
    data: { baris_valid: number; baris_error: number; dokumen_dibuat: number; errors: { nomor_baris: number }[] };
  }>('POST', '/api/persediaan/impor', {
    arah: 'masuk',
    nama_file: 'uji.xlsx',
    data_base64: buf.toString('base64'),
  });
  ok(impor.status === 200, 'impor sukses HTTP', impor.data);
  ok(impor.data.data.dokumen_dibuat === 2, '2 dokumen dari kelompok header sama', impor.data);
  ok(impor.data.data.baris_valid === 3, '3 baris valid (2+3 satu kelompok, 1 kelompok lain)', impor.data);
  ok(impor.data.data.baris_error >= 1, '1 kesalahan baris rusak', impor.data);
  ok((await stokSekarang()) === sebelumImpor + 6, 'stok impor masuk +6', { sesudah: await stokSekarang() });

  /* --- 10. batal dokumen (stok kembali) -------------------------------------- */
  console.log('10. pembatalan');
  const idMasuk = masuk.data.data!.id;
  const batal = await jalan<{ data: { status: string } }>('POST', `/api/persediaan/${idMasuk}/batal`, {
    alasan: 'uji batal',
  });
  ok(batal.status === 200 && batal.data.data.status === 'batal', 'dokumen dibatalkan', batal.data);
  // Net satu putaran uji: +7 (masuk) − 3 (keluar) + 6 (impor) − 7 (batal) = +3.
  ok((await stokSekarang()) === awal + 3, 'stok masuk dikembalikan otomatis (-7)', {
    sesudah: await stokSekarang(),
    harap: awal + 3,
  });
  const dobel = await jalan<{ pesan: string }>('POST', `/api/persediaan/${idMasuk}/batal`, {});
  ok(dobel.status === 409, 'batal dua kali → 409', dobel);
  const hilang = await jalan<{ pesan: string }>('DELETE', `/api/persediaan/${idMasuk}`);
  ok(hilang.status === 404 || hilang.status === 405, 'tidak ada hapus permanen (DELETE)', hilang);

  console.log(gagal === 0 ? '\nSEMUA LULUS' : `\nGAGAL: ${gagal}`);
  process.exit(gagal === 0 ? 0 : 1);
}

utama().catch((e) => {
  console.error(e);
  process.exit(1);
});

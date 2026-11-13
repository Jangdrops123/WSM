/* Verifikasi X5.2: POST/PUT /api/master/produk menyimpan size_profile_id
   (jalur yang dipakai form Tambah/Ubah Produk) — lalu dibersihkan. */
const BASE = 'http://127.0.0.1:3001';
let lulus = 0;
let gagal = 0;
const cek = (n: string, ok: boolean, info = '') => {
  if (ok) lulus++;
  else gagal++;
  console.log(`${ok ? '✔' : '✘'} ${n}${info ? ` — ${info}` : ''}`);
};

async function req(method: string, url: string, body?: unknown) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
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

const dasar = {
  kode_item: 'X5-FORM',
  nama: 'Produk Uji Form X5',
  sku: 'X5-FORM',
  barcode: null,
  deskripsi: null,
  category_id: null,
  brand_id: null,
  satuan_dasar_id: null,
  harga_beli: 1000,
  harga_jual: 2000,
  stok_min: 0,
  aktif: 1,
  konversi: [],
};

const idProfil = Number(((await req('GET', '/api/profil-size/opsi')).data?.data ?? []).find((o: any) => o.label === 'Sepatu Wanita')?.id ?? 0);
cek('opsi profil tersedia (Sepatu Wanita)', idProfil > 0, `id=${idProfil}`);

let r = await req('POST', '/api/master/produk', { ...dasar, size_profile_id: idProfil });
const id = Number(r.data?.id ?? 0);
cek('POST produk + size_profile_id → 201', r.status === 201 && id > 0, `status=${r.status}`);

if (id) {
  let d = (await req('GET', `/api/master/produk/${id}`)).data?.data;
  cek('GET mengembalikan size_profile_id', Number(d?.size_profile_id) === idProfil, `size_profile_id=${d?.size_profile_id}`);

  r = await req('PUT', `/api/master/produk/${id}`, { ...dasar, size_profile_id: 0 });
  cek('PUT size_profile_id=0 → ditolak (400, tidak ada profil id0)', r.status === 400, `status=${r.status} ${JSON.stringify(r.data).slice(0, 90)}`);

  r = await req('PUT', `/api/master/produk/${id}`, { ...dasar, size_profile_id: null });
  cek('PUT size_profile_id=null → 200 (kembali otomatis)', r.status === 200, `status=${r.status}`);
  d = (await req('GET', `/api/master/produk/${id}`)).data?.data;
  cek('GET sesudah PUT → null', d?.size_profile_id == null, `size_profile_id=${d?.size_profile_id}`);

  r = await req('PUT', `/api/master/produk/${id}`, { ...dasar, size_profile_id: idProfil });
  cek('PUT size_profile_id valid → 200 & tersimpan', r.status === 200, `status=${r.status}`);
  d = (await req('GET', `/api/master/produk/${id}`)).data?.data;
  cek('GET sesudah PUT valid → id profil', Number(d?.size_profile_id) === idProfil, `size_profile_id=${d?.size_profile_id}`);

  const del = await req('DELETE', `/api/master/produk/${id}`);
  cek('hapus produk uji → 200', del.status === 200, `status=${del.status}`);
}

console.log(`\n${lulus} lulus, ${gagal} gagal`);
if (gagal > 0) process.exit(1);

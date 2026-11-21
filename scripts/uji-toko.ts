import { headerUji } from './sesi-uji.mjs';
// Uji integrasi Data Toko & pengaturan per toko (Pengaturan ▸ tab per toko).
// Jalankan: npx tsx scripts/uji-toko.ts   (API harus hidup di :3001)
//
// Memeriksa: CRUD toko, isolasi nilai antar toko, guard toko wajib/tak
// dikenal, reset per toko, dan pembersihan pengaturan saat toko dihapus.
const BASE = process.env.BASE ?? 'http://127.0.0.1:3001';
const P = `${BASE}/api/pengaturan`;

let lulus = 0;
let gagal = 0;
const cek = async (nama: string, ok: boolean, info = '') => {
  if (ok) lulus++;
  else gagal++;
  console.log(`${ok ? '✔' : '✘'} ${nama}${info ? ` — ${info}` : ''}`);
};

async function req(method: string, url: string, body?: unknown) {
  const res = await fetch(`${P}${url}`, {
    method,
    headers: await headerUji(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: Record<string, any> | null = null;
  try {
    data = (await res.json()) as Record<string, any>;
  } catch {
    /* balasan bukan JSON */
  }
  return { s: res.status, d: data };
}

/* --- 0) kondisi bersih: buang sisa run sebelumnya ------------------------ */
const awal = await req('GET', '/toko');
for (const t of (awal.d?.data ?? []) as { id: number; kode: string }[]) {
  if (['TJK', 'TSB'].includes(t.kode)) await req('DELETE', `/toko/${t.id}`);
}

/* --- 1) CRUD toko -------------------------------------------------------- */
let r = await req('POST', '/toko', { kode: 'TJK', nama: 'Toko Jakarta', alamat: 'Jl. Sudirman', telepon: '021' });
await cek('tambah toko 1 → 201', r.s === 201, r.d?.pesan);
r = await req('POST', '/toko', { kode: 'TSB', nama: 'Toko Surabaya', alamat: 'Jl. Tunjungan', telepon: '031' });
await cek('tambah toko 2 → 201', r.s === 201, r.d?.pesan);
r = await req('POST', '/toko', { kode: 'TJK', nama: 'Duplikat' });
await cek('kode duplikat ditolak', r.s >= 400, `status ${r.s}: ${r.d?.pesan}`);
r = await req('POST', '/toko', { kode: '', nama: 'Tanpa Kode' });
await cek('kode wajib diisi → 400', r.s === 400, r.d?.pesan);
r = await req('GET', '/toko');
await cek('opsi toko memakai kode', ((r.d?.data ?? []) as { kode: string }[]).some((t) => t.kode === 'TJK'));
r = await req('PUT', '/toko/0', { kode: 'XXX', nama: 'Tidak Ada' });
await cek('ubah toko tak dikenal → 404', r.s === 404, r.d?.pesan);

/* --- 2) pengaturan per toko terisolasi ----------------------------------- */
r = await req('PUT', '/penjualan-pos?toko=TJK', {
  nilai: {
    pos_mode_bawaan: 'tanpa_foto', harga_bawaan: 'grosir', izinkan_diskon: true,
    diskon_maks_persen: 10, izinkan_ubah_harga: false, stok_minus_izinkan: true,
    metode_bayar: ['tunai|Tunai'], izinkan_kembalian: true, cetak_otomatis: false,
    kirim_wa_otomatis: false, piutang_jatuh_tempo_hari: 14,
  },
});
await cek('simpan pengaturan toko TJK → 200', r.s === 200, r.d?.pesan);
r = await req('GET', '/penjualan-pos?toko=TSB');
await cek(
  'toko TSB tetap memakai nilai bawaan',
  r.d?.nilai.harga_bawaan === 'eceran' && r.d.nilai.piutang_jatuh_tempo_hari === 30,
  JSON.stringify({ harga: r.d?.nilai.harga_bawaan, tempo: r.d?.nilai.piutang_jatuh_tempo_hari }),
);
r = await req('GET', '/penjualan-pos?toko=TJK');
await cek(
  'toko TJK menyimpan nilainya sendiri',
  r.d?.nilai.harga_bawaan === 'grosir' && r.d.nilai.piutang_jatuh_tempo_hari === 14,
);

/* --- 3) guard cakupan toko ----------------------------------------------- */
r = await req('PUT', '/penjualan-pos', { nilai: { harga_bawaan: 'grosir' } });
await cek('tanpa toko → 400', r.s === 400, r.d?.pesan);
r = await req('PUT', '/penjualan-pos?toko=XXX', { nilai: { harga_bawaan: 'grosir' } });
await cek('toko tak dikenal → 404', r.s === 404, r.d?.pesan);

/* --- 4) reset per toko hanya mengembalikan toko itu ---------------------- */
r = await req('POST', '/penjualan-pos/bawaan', { toko: 'TJK' });
await cek('reset toko TJK → 200', r.s === 200, r.d?.pesan);
r = await req('GET', '/penjualan-pos?toko=TJK');
await cek('toko TJK kembali bawaan', r.d?.nilai.harga_bawaan === 'eceran');

/* --- 5) perubahan toko tercatat di Log Aktivitas ------------------------- */
r = await req('GET', '/log/aktivitas?per=20');
await cek(
  'CRUD toko tercatat di audit',
  ((r.d?.data ?? []) as { tabel?: string; tab?: string }[]).some((x) => String(x.tab ?? '').includes('toko') || String(x.alasan ?? '').includes('toko')),
);

/* --- 6) hapus toko membersihkan pengaturan per toko ---------------------- */
await req('PUT', '/penjualan-pos?toko=TSB', {
  nilai: {
    pos_mode_bawaan: 'foto', harga_bawaan: 'grosir', izinkan_diskon: true,
    diskon_maks_persen: 100, izinkan_ubah_harga: false, stok_minus_izinkan: true,
    metode_bayar: [], izinkan_kembalian: true, cetak_otomatis: false,
    kirim_wa_otomatis: false, piutang_jatuh_tempo_hari: 7,
  },
});
r = await req('GET', '/toko');
const idTsb = ((r.d?.data ?? []) as { id: number; kode: string }[]).find((t) => t.kode === 'TSB')?.id;
r = await req('DELETE', `/toko/${idTsb}`);
await cek('hapus toko → 200', r.s === 200, r.d?.pesan);
r = await req('GET', '/penjualan-pos?toko=TSB');
await cek('pengaturan toko terhapus ikut hilang', r.d?.nilai.piutang_jatuh_tempo_hari === 30);

/* bersihkan sisa */
const akhir = await req('GET', '/toko');
for (const t of (akhir.d?.data ?? []) as { id: number; kode: string }[]) {
  if (['TJK', 'TSB'].includes(t.kode)) await req('DELETE', `/toko/${t.id}`);
}

console.log(`\nHasil: ${lulus} lulus, ${gagal} gagal`);
if (gagal) process.exit(1);

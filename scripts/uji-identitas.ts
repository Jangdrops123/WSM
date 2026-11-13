import { headerUji } from './sesi-uji.mjs';
// Pemeriksaan Identitas Aplikasi (BAGIAN Y2.1–Y2.6):
//   • tab baru "identitas-aplikasi" paling atas di Pengaturan Dasar dan hanya
//     untuk Admin/Owner (matriks Hak Akses + guard server),
//   • ubah nama/tagline/judul tab/aksen/latar → tersimpan + audit + versi naik,
//   • unggah & hapus logo (PNG maks 2 MB, file hilang setelah hapus),
//   • opsi "Pakai logo dan nama ini juga untuk faktur dan struk" menyalin dan
//     memulihkan nama_usaha / logo_usaha di Profil Usaha,
//   • non-Admin ditolak 403 pada semua endpoint tulis,
//   • "Kembalikan bawaan" mengembalikan nilai awal & menghapus berkas logo.
//
//   API_PORT=3001 npx tsx scripts/uji-identitas.ts
const BASE = `http://127.0.0.1:${process.env.API_PORT ?? 3001}/api`;
let lulus = 0;
let gagal = 0;
const cek = async (n: string, ok: boolean, info = '') => {
  ok ? lulus++ : gagal++;
  console.log(`${ok ? '✔' : '✘'} ${n}${info ? ` — ${info}` : ''}`);
};

const req = async (
  m: string,
  u: string,
  b?: unknown,
  peran = 'admin',
): Promise<{ s: number; d: Record<string, any> | null }> => {
  const r = await fetch(`${BASE}${u}`, {
    method: m,
    headers: await headerUji({ 'x-peran': peran }),
    body: b === undefined ? undefined : JSON.stringify(b),
  });
  let d: Record<string, any> | null = null;
  try {
    d = (await r.json()) as Record<string, any>;
  } catch {
    /* non-json */
  }
  return { s: r.status, d };
};

// PNG 1×1 transparan (177 byte) — valid untuk uji unggah.
const PNG_1PX =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const awal = await req('GET', '/tampilan/identitas');
await cek('GET identitas → 200', awal.s === 200, `nama=${awal.d?.nama}`);
const versiAwal = Number(awal.d?.versi ?? 0);

/* --- Y2.1 — tab baru: urutan & izin ------------------------------------ */
const daftar = await req('GET', '/pengaturan/daftar');
const tab = (daftar.d?.tab ?? []) as { kode: string; grup: string; boleh: boolean; kustom: string | null }[];
const idx = tab.findIndex((t) => t.kode === 'identitas-aplikasi');
await cek('tab identitas-aplikasi tersedia', idx >= 0, tab[idx]?.kustom ?? '');
await cek('tab identitas-aplikasi paling atas', tab[0]?.kode === 'identitas-aplikasi', tab[0]?.kode);
await cek('panel khusus "identitas"', tab[idx]?.kustom === 'identitas');
const daftarKasir = await req('GET', '/pengaturan/daftar', undefined, 'kasir');
const tabKasir = (daftarKasir.d?.tab ?? []) as { kode: string; boleh: boolean }[];
await cek(
  'non-Admin: tab identitas disembunyikan',
  // Seed Kasir tanpa matriks pengaturan.lihat ditolak di seluruh daftar (403)
  // oleh guard matriks global — tab identitas ikut tersembunyi karenanya.
  daftarKasir.s === 403 || tabKasir.find((t) => t.kode === 'identitas-aplikasi')?.boleh === false,
  `http=${daftarKasir.s}`,
);

/* --- Y2.1 — ubah nama, tagline, judul tab, aksen, latar ----------------- */
const ubah = await req('PUT', '/tampilan/identitas', {
  nama: 'Toko Nusantara',
  tagline: 'POS · WMS · Akuntansi',
  judulTab: 'Toko Nusantara — Kasir',
  favicon: '',
  aksen: 'hijau',
  latar: 'surface-2',
  pakaiFaktur: false,
  cakupan: 'semua',
});
await cek('ubah identitas → 200', ubah.s === 200, ubah.d?.pesan);
await cek('nama tersimpan', ubah.d?.nama === 'Toko Nusantara', String(ubah.d?.nama));
await cek('judul tab tersimpan', ubah.d?.judulTab === 'Toko Nusantara — Kasir');
await cek('aksen & latar tersimpan', ubah.d?.aksen === 'hijau' && ubah.d?.latar === 'surface-2');
await cek('versi naik', Number(ubah.d?.versi) > versiAwal, `${versiAwal} → ${ubah.d?.versi}`);

const ulang = await req('GET', '/tampilan/identitas');
await cek('perubahan terbaca ulang tanpa restart', ulang.d?.nama === 'Toko Nusantara');
const meta = await req('GET', '/tampilan/identitas/meta');
await cek('meta (Admin) → 200', meta.s === 200, `multiToko=${meta.d?.multiToko}`);

/* --- Y2.6 — non-Admin ditolak ------------------------------------------ */
const tolak = await req('PUT', '/tampilan/identitas', { nama: 'Hacker' }, 'kasir');
await cek('PUT sebagai kasir → 403', tolak.s === 403, tolak.d?.pesan);
const tolakLogo = await req(
  'POST',
  '/tampilan/identitas/logo',
  { varian: 'siang', data_base64: PNG_1PX },
  'kasir',
);
await cek('unggah logo sebagai kasir → 403', tolakLogo.s === 403);
const tolakMeta = await req('GET', '/tampilan/identitas/meta', undefined, 'kasir');
await cek('meta sebagai kasir → 403', tolakMeta.s === 403);

/* --- Y2.1 — unggah & hapus logo ---------------------------------------- */
const unggah = await req('POST', '/tampilan/identitas/logo', {
  varian: 'siang',
  data_base64: PNG_1PX,
});
await cek('unggah logo → 200', unggah.s === 200);
const urlLogo = String(unggah.d?.url ?? '');
await cek('url logo + cache busting versi', urlLogo.startsWith('/uploads/identitas/') && urlLogo.includes('?v='), urlLogo);

const adaBerkas = await fetch(`http://127.0.0.1:${process.env.API_PORT ?? 3001}${urlLogo.split('?')[0]}`);
await cek(
  'berkas logo bisa diunduh',
  String(adaBerkas.headers.get('content-type') ?? '').startsWith('image/'),
  String(adaBerkas.headers.get('content-type')),
);

const setelahUnggah = await req('GET', '/tampilan/identitas');
await cek('logoSiang terisi', setelahUnggah.d?.logoSiang === urlLogo, String(setelahUnggah.d?.logoSiang));

const hapus = await req('POST', '/tampilan/identitas/logo/hapus', { varian: 'siang' });
await cek('hapus logo → 200', hapus.s === 200);
const sesudahHapus = await req('GET', '/tampilan/identitas');
await cek('logoSiang kembali kosong', sesudahHapus.d?.logoSiang === '');
const berkasHilang = await fetch(
  `http://127.0.0.1:${process.env.API_PORT ?? 3001}${urlLogo.split('?')[0]}`,
);
// Rute /uploads yang tidak ada jatuh ke fallback SPA (200 text/html), jadi
// yang diperiksa adalah jenis kontennya — bukan statusnya.
await cek(
  'berkas logo ikut terhapus',
  !String(berkasHilang.headers.get('content-type') ?? '').startsWith('image/'),
  String(berkasHilang.headers.get('content-type')),
);

/* --- Y2.2 — opsi "pakai juga untuk faktur & struk" ---------------------- */
const metaAwal = await req('GET', '/meta');
const namaUsahaAwal = String(metaAwal.d?.pengaturan?.nama_usaha ?? '');
const logoUsahaAwal = String(metaAwal.d?.pengaturan?.logo_usaha ?? '');

const unggahLagi = await req('POST', '/tampilan/identitas/logo', {
  varian: 'siang',
  data_base64: PNG_1PX,
});
const urlKedua = String(unggahLagi.d?.url ?? '');
const pakai = await req('PUT', '/tampilan/identitas', {
  nama: 'Toko Nusantara',
  tagline: 'POS · WMS · Akuntansi',
  judulTab: '',
  favicon: '',
  aksen: '',
  latar: '',
  pakaiFaktur: true,
  cakupan: 'semua',
});
await cek('opsi pakaiFaktur disimpan', pakai.s === 200 && pakai.d?.pakaiFaktur === true);

const metaPakai = await req('GET', '/meta');
await cek(
  'nama usaha ikut identitas',
  String(metaPakai.d?.pengaturan?.nama_usaha) === 'Toko Nusantara',
  String(metaPakai.d?.pengaturan?.nama_usaha),
);
await cek(
  'logo faktur ikut identitas (tanpa ?v=)',
  String(metaPakai.d?.pengaturan?.logo_usaha) === urlKedua.split('?')[0],
  String(metaPakai.d?.pengaturan?.logo_usaha),
);

const lepas = await req('PUT', '/tampilan/identitas', {
  nama: 'Toko Nusantara',
  tagline: 'POS · WMS · Akuntansi',
  judulTab: '',
  favicon: '',
  aksen: '',
  latar: '',
  pakaiFaktur: false,
  cakupan: 'semua',
});
await cek('opsi dilepas', lepas.s === 200 && lepas.d?.pakaiFaktur === false);
const metaLepas = await req('GET', '/meta');
await cek(
  'nama usaha dipulihkan',
  String(metaLepas.d?.pengaturan?.nama_usaha) === namaUsahaAwal,
  String(metaLepas.d?.pengaturan?.nama_usaha),
);
await cek(
  'logo faktur dipulihkan',
  String(metaLepas.d?.pengaturan?.logo_usaha) === logoUsahaAwal,
  String(metaLepas.d?.pengaturan?.logo_usaha),
);

/* --- Y2.1 — kembalikan bawaan ------------------------------------------ */
const versiSebelumReset = Number(lepas.d?.versi ?? 0);
const bawaan = await req('POST', '/tampilan/identitas/bawaan', {});
await cek('kembalikan bawaan → 200', bawaan.s === 200, bawaan.d?.pesan);
const sesudahBawaan = await req('GET', '/tampilan/identitas');
await cek('nama kembali bawaan', sesudahBawaan.d?.nama === 'NusaSuite', String(sesudahBawaan.d?.nama));
await cek('tagline kembali bawaan', sesudahBawaan.d?.tagline === 'POS · WMS · Akuntansi');
await cek('judul tab kosong', sesudahBawaan.d?.judulTab === '');
await cek('logo bersih', !sesudahBawaan.d?.logoSiang && !sesudahBawaan.d?.logoMalam && !sesudahBawaan.d?.ikon);
await cek(
  'versi naik setelah reset (cache logo lama terpecah)',
  Number(sesudahBawaan.d?.versi) > versiSebelumReset,
  `${versiSebelumReset} → ${sesudahBawaan.d?.versi}`,
);
await cek(
  'logo fisik benar-benar terhapus',
  !String(
    (
      await fetch(
        `http://127.0.0.1:${process.env.API_PORT ?? 3001}${urlKedua.split('?')[0]}`,
      )
    ).headers.get('content-type') ?? '',
  ).startsWith('image/'),
);

/* --- Y2.6 — perubahan tercatat di log aktivitas -------------------------- */
const log = await req('GET', '/pengaturan/log/aktivitas?per=60');
const baris = (log.d?.data ?? []) as { tab: string; aksi: string; alasan: string | null }[];
await cek(
  'audit log mencatat perubahan identitas',
  baris.some((b) => b.tab === 'settings' && (b.alasan ?? '').includes('Identitas Aplikasi')),
  baris
    .filter((b) => b.tab === 'settings')
    .slice(0, 3)
    .map((b) => `${b.aksi}:${b.alasan ?? ''}`)
    .join(' | '),
);

/* --- Y2.4 — /api/meta memakai identitas (bukan teks tetap) -------------- */
const metaAkhir = await req('GET', '/meta');
await cek(
  'meta.aplikasi mengikuti identitas',
  String(metaAkhir.d?.aplikasi) === 'NusaSuite',
  String(metaAkhir.d?.aplikasi),
);

console.log(`\nHasil: ${lulus} lulus, ${gagal} gagal`);
if (gagal > 0) process.exit(1);

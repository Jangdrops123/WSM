// Pemeriksaan pulih-cadangan (Pengaturan ▸ Database & Backup): data kembali
// sesuai cadangan DAN database tetap utuh — pemulihan dijalankan saat server
// masih berjalan. Tanpa pembersihan berkas cadangan, skrip ini menumpuk file.
//
//   API_PORT=3001 npx tsx scripts/uji-pulih.ts
import fs from 'node:fs';
import path from 'node:path';
import { headerUji } from './sesi-uji.mjs';

const BASE = `${process.env.BASE ?? 'http://127.0.0.1:3001'}/api/pengaturan`;
let lulus = 0, gagal = 0;
const cek = async (n: string, ok: boolean, info = '') => {
  ok ? lulus++ : gagal++;
  console.log(`${ok ? '✔' : '✘'} ${n}${info ? ` — ${info}` : ''}`);
};
const req = async (m: string, u: string, b?: unknown) => {
  const r = await fetch(`${BASE}${u}`, {
    method: m,
    headers: await headerUji(),
    body: b === undefined ? undefined : JSON.stringify(b),
  });
  let d: Record<string, any> | null = null;
  try { d = await r.json(); } catch { /* non-json */ }
  return { s: r.status, d };
};

// 1) bersihkan sisa toko uji
for (const t of ((await req('GET', '/toko')).d?.data ?? []) as { id: number; kode: string }[]) {
  if (['UJI', 'UJI2'].includes(t.kode)) await req('DELETE', `/toko/${t.id}`);
}

// 2) buat cadangan pada kondisi bersih
const cad = await req('POST', '/sistem/backup', {});
await cek('buat cadangan → 201', cad.s === 201, String(cad.d?.nama));
const namaCadangan = String(cad.d?.nama ?? '');

// 3) tambahkan toko SETELAH cadangan — harus hilang setelah pemulihan
const tambah = await req('POST', '/toko', { kode: 'UJI', nama: 'Toko Uji Pulih' });
await cek('tambah toko setelah cadangan → 201', tambah.s === 201, tambah.d?.pesan);

const sebelum = ((await req('GET', '/toko')).d?.data ?? []) as { kode: string }[];
await cek('toko terlihat sebelum pemulihan', sebelum.some((t) => t.kode === 'UJI'), sebelum.map((t) => t.kode).join(','));

// 4) pulihkan — dilakukan saat server MASIH BERJALAN
const pulih = await req('POST', '/sistem/pulihkan', { nama: namaCadangan, konfirmasi: 'PULIHKAN' });
await cek('pemulihan → 200 saat server berjalan', pulih.s === 200, pulih.d?.pesan);

// 5) data kembali ke keadaan cadangan
const sesudah = ((await req('GET', '/toko')).d?.data ?? []) as { kode: string }[];
await cek('toko yang dibuat setelah cadangan hilang', !sesudah.some((t) => t.kode === 'UJI'), sesudah.map((t) => t.kode).join(','));

// 6) database tetap bisa dipakai untuk tulis & baca setelah pemulihan
const tambah2 = await req('POST', '/toko', { kode: 'UJI2', nama: 'Toko Sesudah Pulih' });
await cek('tulis setelah pemulihan → 201', tambah2.s === 201, tambah2.d?.pesan);
const set2 = await req('PUT', '/penjualan-pos?toko=UJI2', {
  nilai: {
    pos_mode_bawaan: 'foto', harga_bawaan: 'grosir', izinkan_diskon: true, diskon_maks_persen: 100,
    izinkan_ubah_harga: false, stok_minus_izinkan: true, metode_bayar: [], izinkan_kembalian: true,
    cetak_otomatis: false, kirim_wa_otomatis: false, piutang_jatuh_tempo_hari: 7,
  },
});
await cek('pengaturan per toko setelah pemulihan → 200', set2.s === 200, set2.d?.pesan);
const baca = await req('GET', '/penjualan-pos?toko=UJI2');
await cek('pengaturan per toko terbaca utuh', baca.d?.nilai?.harga_bawaan === 'grosir', JSON.stringify(baca.d?.nilai?.harga_bawaan));

// 7) cadangan pengaman tidak menumpuk berkas
const info = await req('GET', '/sistem/info');
await cek('info sistem tetap sehat setelah pemulihan', info.s === 200 && (info.d?.cadangan ?? []).length > 0, `cadangan=${info.d?.cadangan?.length}`);

// bersihkan: toko uji + berkas cadangan yang dibuat skrip ini
for (const t of (((await req('GET', '/toko')).d?.data ?? []) as { id: number; kode: string }[])) {
  if (['UJI', 'UJI2'].includes(t.kode)) await req('DELETE', `/toko/${t.id}`);
}
if (namaCadangan) {
  try { fs.unlinkSync(path.join('data', 'backups', namaCadangan)); } catch { /* sudah terhapus oleh rotasi */ }
}

console.log(`\nHasil: ${lulus} lulus, ${gagal} gagal`);
if (gagal) process.exit(1);

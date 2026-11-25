// Repro: impor produk-359.xlsx ke /api/master/produk/impor/pra-tinjau dan
// tampilkan ringkasan alasan error + 5 error pertama.
import fs from 'node:fs';
import { headerUji } from '../scripts/sesi-uji.mjs';

const BASE = 'http://127.0.0.1:3001/api';
const data_base64 = fs.readFileSync('.freebuff/produk-359.xlsx').toString('base64');

// Pemetaan identik hasil autoPemetaan klien (judul = key modul).
const JUDUL = [
  'kode_item', 'nama_produk', 'sku', 'kategori', 'merek', 'satuan',
  'profil_size', 'barcode', 'harga_beli', 'harga_jual', 'status', 'nama_file_foto',
];
const pemetaan = Object.fromEntries(JUDUL.map((k) => [k, k]));

async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: await headerUji(),
    body: JSON.stringify(body),
  });
  const teks = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(teks) as Record<string, unknown>;
  } catch {
    console.log('BADAN NON-JSON:', teks.slice(0, 400));
  }
  return { status: res.status, data };
}

const pra = await post('/master/produk/impor/pra-tinjau', {
  nama_file: 'produk-359.xlsx',
  data_base64,
  pemetaan,
  opsi: { perbarui: true, lewati_error: true },
});
const d = pra.data as {
  total_baris?: number; baris_valid?: number; baris_error?: number;
  errors?: { nomor_baris: number; kolom: string | null; pesan: string }[];
};
console.log('status:', pra.status);
console.log('total:', d.total_baris, 'valid:', d.baris_valid, 'error:', d.baris_error);
const grup = new Map<string, number>();
for (const e of d.errors ?? []) {
  const k = e.pesan.replace(/"[^"]*"/g, '"…"').replace(/\(baris \d+\)/, '').replace(/\d+/g, 'N').trim();
  grup.set(k, (grup.get(k) ?? 0) + 1);
}
console.log('--- ringkasan alasan ---');
for (const [k, n] of [...grup.entries()].sort((a, b) => b[1] - a[1])) console.log(`${n}x ${k}`);
console.log('--- 8 error pertama ---');
for (const e of (d.errors ?? []).slice(0, 8)) console.log(JSON.stringify(e));

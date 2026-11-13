// Uji API impor (tahap kolom → pra-tinjau → konfirmasi) terhadap server hidup.
import fs from 'node:fs';
import ExcelJS from 'exceljs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3001';
const FILE = '.freebuff/uji-impor.xlsx';

const PEMETAAN: Record<string, string> = {
  kode_item: 'Kode',
  nama_produk: 'Nama Barang',
  sku: 'SKU',
  kategori: 'Kategori',
  merek: 'Merek',
  barcode: 'Barcode',
  harga_beli: 'Harga Beli',
  harga_jual: 'Harga Jual',
  status: 'Status',
};

async function baca(): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const buf = fs.readFileSync(FILE);
  void wb;
  return buf.toString('base64');
}

async function post(url: string, body: unknown) {
  const r = await fetch(`${BASE}/api/master/produk/${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
}

const t = async (label: string, fn: () => Promise<unknown>) => {
  try {
    const v = await fn();
    console.log(`\n### ${label}\n${JSON.stringify(v, null, 2).slice(0, 1600)}`);
  } catch (e) {
    console.log(`\n### ${label}\nERROR ${(e as Error).message}`);
  }
};

const data_base64 = await baca();

await t('1) /impor/kolom', async () => (await post('impor/kolom', { nama_file: 'uji-impor.xlsx', data_base64 })).data);

await t('2) pra-tinjau (pemetaan + semua opsi on)', async () =>
  (await post('impor/pra-tinjau', { nama_file: 'uji-impor.xlsx', data_base64, pemetaan: PEMETAAN, opsi: { perbarui: true, lewati_error: true } })).data);

await t('3) pra-tinjau TANPA pemetaan (harus 0 valid, wajib belum dipetakan)', async () =>
  (await post('impor/pra-tinjau', { nama_file: 'uji-impor.xlsx', data_base64 })).data);

console.log('\n### 4) konfirmasi impor (pemetaan + opsi bawaan)');
const impor = await post('impor', { nama_file: 'uji-impor.xlsx', data_base64, pemetaan: PEMETAAN, opsi: { perbarui: true, lewati_error: true } });
console.log(JSON.stringify(impor, null, 2).slice(0, 1200));

await t('5) pra-tinjau ULANG — semua kode sudah ada (harus "perbarui")', async () =>
  (await post('impor/pra-tinjau', { nama_file: 'uji-impor.xlsx', data_base64, pemetaan: PEMETAAN, opsi: { perbarui: true, lewati_error: true } })).data);

await t('6) pra-tinjau dengan opsi perbarui=OFF (harus 0 valid, 12 dilewati)', async () =>
  (await post('impor/pra-tinjau', { nama_file: 'uji-impor.xlsx', data_base64, pemetaan: PEMETAAN, opsi: { perbarui: false, lewati_error: true } })).data);

await t('7) konfirmasi dengan perbarui=OFF (harus 0 masuk, 12 dilewati)', async () =>
  (await post('impor', { nama_file: 'uji-impor.xlsx', data_base64, pemetaan: PEMETAAN, opsi: { perbarui: false, lewati_error: true } })).data);

const ekspor = await fetch(`${BASE}/api/master/produk/ekspor?format=json&batas=200`);
const j = (await ekspor.json()) as { total: number; baris: Record<string, unknown>[] };
console.log(`\n### 8) total produk setelah impor: ${j.total}`);
console.log(j.baris.slice(0, 3).map((b) => `${b.kode_item} | ${b.nama_produk} | ${b.kategori} | ${b.status}`).join('\n'));

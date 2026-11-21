import fs from 'node:fs';
import ExcelJS from 'exceljs';

const BASE = 'http://127.0.0.1:3001/api/master/produk/ekspor';

async function ambil(q) {
  const r = await fetch(`${BASE}?${q}`);
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return Buffer.from(await r.arrayBuffer());
}

// 1) xlsx: sheet per kategori, tanpa baris judul, kolom terbatas
const buf = await ambil('kolom=kode_item,nama_produk,kategori,stok&sheet_per_kategori=1&header=0');
fs.writeFileSync('.freebuff/ekspor-per-kategori.xlsx', buf);
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile('.freebuff/ekspor-per-kategori.xlsx');
console.log('1) sheet:', wb.worksheets.map(w => `${w.name}(${w.rowCount}x${w.columnCount})`).join(', '));
wb.worksheets.forEach(ws => {
  console.log(`   [${ws.name}] baris1 =`, JSON.stringify(ws.getRow(1).values?.slice(1)));
  console.log(`   [${ws.name}] baris2 =`, JSON.stringify(ws.getRow(2).values?.slice(1)));
});

// 2) xlsx: dengan judul, satu sheet
const buf2 = await ambil('kolom=kode_item,stok&header=1');
fs.writeFileSync('.freebuff/ekspor-dengan-judul.xlsx', buf2);
const wb2 = new ExcelJS.Workbook();
await wb2.xlsx.readFile('.freebuff/ekspor-dengan-judul.xlsx');
const ws2 = wb2.worksheets[0];
console.log('2) sheet:', ws2.name, '| header freeze:', JSON.stringify(ws2.views));
console.log('   baris1 =', JSON.stringify(ws2.getRow(1).values?.slice(1)));
console.log('   baris2 =', JSON.stringify(ws2.getRow(2).values?.slice(1)));

// 3) csv dengan judul
const r3 = await fetch(`${BASE}?format=csv&kolom=kode_item,kategori,stok`);
const csv = await r3.text();
console.log('3) csv头3 baris:\n' + csv.split('\r\n').slice(0, 3).join('\n'));

// 4) cakupan terpilih
const r4 = await fetch(`${BASE}?format=json&cakupan=terpilih&ids=1,3,5&kolom=kode_item,stok`);
console.log('4) terpilih:', JSON.stringify(await r4.json()));
// 5) kategori id filter
const r5 = await fetch(`${BASE}?format=json&cakupan=filter&kategori=2&kolom=kode_item,kategori`);
const j5 = await r5.json();
console.log('5) filter kategori=2:', j5.total, 'baris ->', j5.baris.map(b=>b.kode_item).join(','));

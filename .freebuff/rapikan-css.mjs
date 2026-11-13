// Perapian format setelah konversi rem: sisipkan baris baru setelah '}' yang
// menempel langsung pada selector/deklarasi berikutnya.
import fs from 'node:fs';

const FILES = [
  'src/styles.css',
  'src/crud.css',
  'src/pages/pembelian/pembelian.css',
  'src/pages/penjualan/penjualan.css',
  'src/pages/persediaan/persediaan.css',
  'src/pages/opname/opname.css',
  'src/pages/pengaturan/pengaturan.css',
  'src/pages/pengaturan/proses-tahunan.css',
  'src/pages/laporan/laporan.css',
  'src/pages/pos/pos.css',
  'src/pages/dashboard/dashboard.css',
  'src/pages/master/impor-ekspor.css',
];

for (const f of FILES) {
  if (!fs.existsSync(f)) continue;
  const s = fs.readFileSync(f, 'utf8');
  const out = s.replace(/\}(?=[^\s}])/g, '}\n');
  if (out !== s) {
    fs.writeFileSync(f, out);
    console.log('rapikan:', f);
  }
}

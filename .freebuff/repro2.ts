import fs from 'node:fs';
import { headerUji } from '../scripts/sesi-uji.mjs';

const data_base64 = fs.readFileSync('.freebuff/produk-359.xlsx').toString('base64');
const res = await fetch('http://127.0.0.1:3001/api/master/produk/impor/pra-tinjau', {
  method: 'POST',
  headers: await headerUji(),
  body: JSON.stringify({ nama_file: 'produk-359.xlsx', data_base64 }),
});
console.log('status', res.status);
console.log((await res.text()).slice(0, 800));

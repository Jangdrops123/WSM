// Codemod dialek SQLite -> PostgreSQL pada SQL teks di server/*.ts.
// Idempoten. Hanya pola yang dipetakan 1:1; WIB/COLLATE ditangani manual.
//   node scripts/codemod-dialek.mjs [--tulis]
import fs from 'node:fs';
import path from 'node:path';

const TULIS = process.argv.includes('--tulis');
const Q = `(?:'|\\\\')`; // kutip biasa atau kutip lolos-backslash (struk.ts)

function files(d) {
  const o = [];
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) o.push(...files(p));
    else if (p.endsWith('.ts')) o.push(p);
  }
  return o;
}

const pola = [
  // strftime('%Y-%m-%d %H:%M:%f','now') -> now()
  [new RegExp(`strftime\\(${Q}%Y-%m-%d %H:%M:%f${Q}\\s*,\\s*${Q}now${Q}\\)`, 'g'), 'now()'],
  // date('now') -> CURRENT_DATE
  [new RegExp(`date\\(${Q}now${Q}\\)`, 'g'), 'CURRENT_DATE'],
  // strftime('%Y%m%d', kolom) -> TO_CHAR(kolom, 'YYYYMMDD')
  [/strftime\('%Y%m%d',\s*([^)]+)\)/g, 'TO_CHAR($1, \'YYYYMMDD\')'],
  // datetime(?) -> ?::timestamptz
  [/datetime\(\?\)/g, '?::timestamptz'],
  // date(KOLOM, '+7 hours') -> (KOLOM AT TIME ZONE 'Asia/Jakarta')::date
  [/date\(([^,()]+),\s*'\+7 hours'\)/g, `($1 AT TIME ZONE 'Asia/Jakarta')::date`],
  // datetime(KOLOM, '+7 hours') -> (KOLOM AT TIME ZONE 'Asia/Jakarta')
  [/datetime\(([^,()]+),\s*'\+7 hours'\)/g, `($1 AT TIME ZONE 'Asia/Jakarta')`],
  // strftime('%W', X) -> TO_CHAR(X, 'IW')
  [/strftime\('%W',\s*([^)]+)\)/g, `TO_CHAR($1, 'IW')`],
  // json_group_array( -> jsonb_agg(
  [/json_group_array\(/g, 'jsonb_agg('],
  // json_object( -> jsonb_build_object(
  [/json_object\(/g, 'jsonb_build_object('],
];

let total = 0;
for (const f of files('server')) {
  if (/migrations|codemod|db\.pg\.ts|db\.ts$|[\\/]migrate\.ts$/.test(f)) continue;
  let s = fs.readFileSync(f, 'utf8');
  let n = 0;
  const sebelum = s;
  for (const [re, ganti] of pola) s = s.replace(re, (...a) => { n++; return typeof ganti === 'string' ? ganti : ganti(...a); });
  if (s !== sebelum) {
    if (TULIS) fs.writeFileSync(f, s);
    total += n;
    console.log(`${TULIS ? 'TULIS' : 'SIMULASI'} ${f}: ${n}`);
  }
}
console.log(`TOTAL: ${total} ${TULIS ? '(ditulis)' : '(simulasi)'}`);

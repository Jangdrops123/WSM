// Codemod COLLATE/LIKE SQLite -> PostgreSQL:
//   `= ? COLLATE NOCASE`        -> `ILIKE ?`      (banding persis takpeka-kapital)
//   `ORDER BY x COLLATE NOCASE` -> `ORDER BY LOWER(x)`
//   `LIKE ?` (pola dari pengguna) -> `ILIKE ?`   (LIKE SQLite takpeka-kapital ASCII)
//   Pola literal awalan tetap (BRG-%, peng.%, /uploads/%) tidak diubah.
//   Idempoten.
//   node scripts/codemod-collate.mjs [--tulis]
import fs from 'node:fs';
import path from 'node:path';

const TULIS = process.argv.includes('--tulis');

function files(d) {
  const o = [];
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) o.push(...files(p));
    else if (p.endsWith('.ts')) o.push(p);
  }
  return o;
}

let total = 0;
for (const f of files('server')) {
  if (/migrations|codemod|db\.pg\.ts|db\.ts$|[\\/]migrate\.ts$/.test(f)) continue;
  let s = fs.readFileSync(f, 'utf8');
  let n = 0;
  const ganti = (re, rep) => {
    s = s.replace(re, (...a) => { n++; return typeof rep === 'function' ? rep(...a) : rep; });
  };
  ganti(/=\s*\?\s*COLLATE NOCASE/gi, 'ILIKE ?');
  ganti(/ORDER BY\s+([\w.]+)\s+COLLATE NOCASE/gi, (_m, c) => `ORDER BY LOWER(${c})`);
  ganti(/\bLIKE\s+\?/g, 'ILIKE ?');
  if (n) {
    if (TULIS) fs.writeFileSync(f, s);
    total += n;
    console.log(`${TULIS ? 'TULIS' : 'SIMULASI'} ${f}: ${n}`);
  }
}
console.log(`TOTAL: ${total} ${TULIS ? '(ditulis)' : '(simulasi)'}`);

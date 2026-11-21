// Codemod skrip uji SQLite -> PostgreSQL (sekali pakai, idempoten).
//   db.prepare(SQL).all(a) -> (await all(SQL, a))
//   db.prepare(SQL).get(a) -> (await get(SQL, a))
//   db.prepare(SQL).run(a) -> (await run(SQL, a))
//   db.exec(SQL non-PRAGMA) -> await run(SQL)
//   PRAGMA/sqlite_master -> dihapus / pg_tables
//   new DatabaseSync -> dihapus; db.close() -> await pool.end()
//   node scripts/codemod-uji-pg.mjs [--tulis] [file...]
import fs from 'node:fs';

const TULIS = process.argv.includes('--tulis');
const HANYA = process.argv.filter((a) => a.endsWith('.ts'));

// Pindai ekspresi seimbang mulai dari indeks i (sudah di setelah kurung buka).
function pindaiSeimbang(s, i) {
  let dalam = 1;
  let kutip = null; // ', ", `
  let lolos = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (kutip) {
      if (lolos) { lolos = false; continue; }
      if (c === '\\') { lolos = true; continue; }
      if (c === kutip) kutip = null;
      // ${} di dalam template — sederhanakan: anggap kurung di dalamnya seimbang sendiri
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { kutip = c; continue; }
    if (c === '(') dalam++;
    else if (c === ')') { dalam--; if (!dalam) return j; }
  }
  return -1;
}

function konversi(s) {
  let n = 0;
  // 1) db.prepare(EXPR).metode(ARGS)
  {
    let keluar = '';
    let i = 0;
    while (true) {
      const k = s.indexOf('db.prepare(', i);
      if (k < 0) { keluar += s.slice(i); break; }
      const awalExpr = k + 'db.prepare('.length;
      const akhirExpr = pindaiSeimbang(s, awalExpr);
      if (akhirExpr < 0) { keluar += s.slice(i); break; }
      const m = /^\s*\.(all|get|run)\(/.exec(s.slice(akhirExpr + 1));
      if (!m) { keluar += s.slice(i, k + 1); i = k + 1; continue; }
      const awalArg = akhirExpr + 1 + m[0].length;
      const akhirArg = pindaiSeimbang(s, awalArg);
      if (akhirArg < 0) { keluar += s.slice(i); break; }
      const expr = s.slice(awalExpr, akhirExpr);
      const args = s.slice(awalArg, akhirArg).trim();
      const fn = m[1];
      keluar += s.slice(i, k) + `(await ${fn}(${expr}${args ? ', ' + args : ''}))`;
      i = akhirArg + 1;
      n++;
    }
    s = keluar;
  }
  // 2) db.exec(EXPR) non-PRAGMA -> await run(EXPR); PRAGMA -> hapus
  {
    let keluar = '';
    let i = 0;
    while (true) {
      const k = s.indexOf('db.exec(', i);
      if (k < 0) { keluar += s.slice(i); break; }
      const awalExpr = k + 'db.exec('.length;
      const akhirExpr = pindaiSeimbang(s, awalExpr);
      if (akhirExpr < 0) { keluar += s.slice(i); break; }
      const expr = s.slice(awalExpr, akhirExpr);
      // telan ; setelahnya bila ada
      let sesudah = akhirExpr + 1;
      if (s[sesudah] === ';') sesudah++;
      if (/PRAGMA/i.test(expr)) {
        keluar += s.slice(i, k);
      } else {
        keluar += s.slice(i, k) + `await run(${expr})`;
      }
      i = sesudah;
      n++;
    }
    s = keluar;
  }
  return [s, n];
}

const IMPOR_PG = `import { all, get, pool, run } from '../server/db.pg.ts';`;
const polaTeks = [
  [/^.*import\s*\{\s*DatabaseSync\s*\}\s*from\s*['"]node:sqlite['"];?\s*$/m, IMPOR_PG],
  [/^.*import\s*\{[^}]*\}\s*from\s*['"]\.\.\/server\/db\.ts['"];?\s*$/m, IMPOR_PG],
  [/^\s*(const|let|var)\s+db\s*=\s*new\s+DatabaseSync\(.*?\);\s*$/m, ''],
  [/db\.close\(\)/g, 'await pool.end()'],
  [/SELECT name FROM sqlite_master WHERE type\s*=\s*'table' AND name NOT LIKE 'sqlite_%'/g,
    `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'`],
  [/SELECT name FROM sqlite_master WHERE type\s*=\s*"table" AND name NOT LIKE "sqlite_%"/g,
    `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'`],
];

let total = 0;
for (const f of HANYA.length ? HANYA : []) {
  void f;
}
import path from 'node:path';
function semuaUji() {
  const d = 'scripts';
  return fs.readdirSync(d).filter((e) => /^(uji-|bersih-uji|isi-stok-demo|tandai-pakai).*\.ts$/.test(e)).map((e) => path.join(d, e));
}
for (const f of HANYA.length ? HANYA : semuaUji()) {
  let s = fs.readFileSync(f, 'utf8');
  if (!/db\.(prepare|exec|close)\(/.test(s) && !/new DatabaseSync/.test(s)) continue;
  if (/from '.*db\.pg\.ts'/.test(s)) { console.log(`LEWATI (sudah pg): ${f}`); continue; }
  let n = 0;
  [s, n] = [konversi(s)[0], konversi(s)[1]];
  // ulangi? konversi mengembalikan [s, n] — panggil sekali saja:
  for (const [re, ganti] of polaTeks) {
    const s2 = s.replace(re, ganti);
    if (s2 !== s) { n++; s = s2; }
  }
  // gabung impor db.pg ganda menjadi satu baris
  {
    let jumpa = 0;
    s = s.replace(/^.*from '\.\.\/server\/db\.pg\.ts';\s*$/gm, (m) => (++jumpa === 1 ? m : ''));
    if (jumpa > 1) n++;
  }
  // isi-stok-demo: pemanggilan sinkron -> await (di dalam main yang async)
  if (f.endsWith('isi-stok-demo.ts')) {
    const s2 = s
      .replace(/^(\s*)get(\s*<)/gm, '$1await get$2')
      .replace(/^(\s*)run(\s*\()/gm, '$1await run$2')
      .replace(/^(\s*)ubahStok(\s*\()/gm, '$1await ubahStok$2');
    if (s2 !== s) { n += 3; s = s2; }
  }
  if (n) {
    if (TULIS) fs.writeFileSync(f, s);
    total += n;
    console.log(`${TULIS ? 'TULIS' : 'SIMULASI'} ${f}: ${n}`);
  }
}
console.log(`TOTAL: ${total} ${TULIS ? '(ditulis)' : '(simulasi)'}`);

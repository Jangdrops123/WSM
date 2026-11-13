// Codemod fase 4: X.map(async ...) -> await Promise.all(X.map(async ...))
// (callback menjadi async di fase 1-3; hasilnya harus di-resolve agar sama
// seperti versi sinkron: urutan & nilai identik).
//   node scripts/codemod-pg4.mjs [--tulis]
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

const TULIS = process.argv.includes('--tulis');

function daftarFile(dir) {
  const keluar = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) keluar.push(...daftarFile(p));
    else if (e.isFile() && p.endsWith('.ts') && !p.endsWith('.d.ts')) keluar.push(p);
  }
  return keluar;
}

let hit = 0;

for (const file of daftarFile('server')) {
  const base = path.basename(file);
  if (base === 'db.ts' || base === 'migrate.ts' || base === 'db.pg.ts') continue;
  let src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ESNext, true);
  const edit = [];

  const kunjungi = (node) => {
    if (ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'map' &&
        node.arguments.length > 0) {
      const cb = node.arguments[0];
      const mods = (typeof ts.getModifiers === 'function' ? ts.getModifiers(cb) : cb.modifiers) ?? [];
      const isAsyncFn = (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) &&
        mods.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
      if (isAsyncFn) {
        // Lewati bila sudah dibungkus Promise.all / sudah di-await langsung
        let p = node.parent;
        while (p && ts.isParenthesizedExpression(p)) p = p.parent;
        const teks = src.slice(Math.max(0, node.getStart() - 30), node.getStart());
        if (/await\s+Promise\.all\s*\($/.test(teks)) return;
        edit.push({ pos: node.getStart(), hapus: 0, tulis: 'await Promise.all(' });
        edit.push({ pos: node.getEnd(), hapus: 0, tulis: ')' });
        hit++;
        // Tandai fungsi pembungkus async
        let n = node;
        while (n) {
          if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) ||
              ts.isArrowFunction(n) || ts.isMethodDeclaration(n)) {
            const fm = (typeof ts.getModifiers === 'function' ? ts.getModifiers(n) : n.modifiers) ?? [];
            if (!fm.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) {
              const q = fm.length ? fm[fm.length - 1].end : n.getStart();
              edit.push({ pos: q, hapus: 0, tulis: fm.length ? ' async ' : 'async ' });
            }
            break;
          }
          n = n.parent;
        }
      }
    }
    ts.forEachChild(node, kunjungi);
  };
  kunjungi(sf);

  if (!edit.length) continue;
  edit.sort((a, b) => b.pos - a.pos);
  for (const e of edit) src = src.slice(0, e.pos) + e.tulis + src.slice(e.pos + e.hapus);
  if (TULIS) fs.writeFileSync(file, src);
  console.log(`${TULIS ? 'TULIS' : 'SIMULASI'} ${file}`);
}

console.log(`\nTOTAL map-dibungkus=${hit} ${TULIS ? '(ditulis)' : '(simulasi)'}`);

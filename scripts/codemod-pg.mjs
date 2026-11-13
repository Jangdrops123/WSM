// Codemod SQLite -> PostgreSQL (mekanis, tanpa ubah logika):
//  1. import '.../db.ts' -> '.../db.pg.ts' (server/**, kecuali db.ts/migrate.ts/db.pg.ts)
//  2. sisipkan `await` pada tiap pemanggilan all/get/run/withTransaction/
//     getSettings/nextDocumentSequence yang diimpor dari db.pg.ts
//  3. jadikan `async` fungsi pembungkus terdekat tiap await yang disisipkan
// Dijalankan sekali; aman diulang (sudah-await / sudah-async dilewati).
//   node scripts/codemod-pg.mjs [--tulis]
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

const TULIS = process.argv.includes('--tulis');
const ASYNC_FNS = new Set(['all', 'get', 'run', 'withTransaction', 'getSettings', 'nextDocumentSequence']);

function daftarFile(dir) {
  const keluar = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) keluar.push(...daftarFile(p));
    else if (e.isFile() && p.endsWith('.ts') && !p.endsWith('.d.ts')) keluar.push(p);
  }
  return keluar;
}

function isFunctionLike(n) {
  return ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) || ts.isMethodDeclaration(n) ||
    ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n);
}

function daftarModifier(fn) {
  if (typeof ts.getModifiers === 'function') return ts.getModifiers(fn) ?? [];
  return (fn.modifiers ?? []); // TS lama
}

function sudahAsync(fn) {
  return daftarModifier(fn).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
}

function akhirModifier(fn) {
  const mods = daftarModifier(fn);
  if (mods.length) return { pos: mods[mods.length - 1].end, spasi: true };
  return { pos: fn.getStart(), spasi: false };
}

let totalAwait = 0, totalAsync = 0, totalImport = 0;

for (const file of daftarFile('server')) {
  const base = path.basename(file);
  if (base === 'db.ts' || base === 'migrate.ts' || base === 'db.pg.ts') continue;
  let src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ESNext, true);

  // Kumpulkan nama yang diimpor dari db.ts
  const imporDb = new Set();
  const editImport = [];
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) &&
        st.moduleSpecifier.text.endsWith('/db.ts')) {
      const baru = st.moduleSpecifier.text.replace(/\/db\.ts$/, '/db.pg.ts');
      editImport.push({ pos: st.moduleSpecifier.getStart() + 1, hapus: st.moduleSpecifier.text.length, tulis: baru });
      const nb = st.importClause?.namedBindings;
      if (nb && ts.isNamedImports(nb)) {
        for (const el of nb.elements) imporDb.add(el.propertyName?.text ?? el.name.text);
      }
    }
  }
  if (!imporDb.size) continue;

  const sisip = []; // {pos, teks}
  const ditandai = new Set(); // pos fungsi yang sudah ditandai async
  const tandaiAsync = (node) => {
    let n = node;
    while (n) {
      if (isFunctionLike(n)) {
        if (!sudahAsync(n)) {
          const { pos, spasi } = akhirModifier(n);
          if (!ditandai.has(pos)) { ditandai.add(pos); sisip.push({ pos, teks: spasi ? ' async ' : 'async ' }); totalAsync++; }
        }
        return;
      }
      n = n.parent;
    }
  };

  const kunjungi = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
        ASYNC_FNS.has(node.expression.text) && imporDb.has(node.expression.text)) {
      // Lewati bila sudah di-await (abaikan tanda kurung pembungkus)
      let p = node.parent;
      while (p && ts.isParenthesizedExpression(p)) p = p.parent;
      if (!(p && ts.isAwaitExpression(p))) {
        sisip.push({ pos: node.getStart(), teks: 'await ' });
        totalAwait++;
        tandaiAsync(node);
      }
    }
    ts.forEachChild(node, kunjungi);
  };
  kunjungi(sf);

  const semua = [...editImport.map((e) => ({ pos: e.pos, hapus: e.hapus, tulis: e.tulis })), ...sisip.map((s) => ({ pos: s.pos, hapus: 0, tulis: s.teks }))];
  if (!semua.length) continue;
  totalImport += editImport.length;
  semua.sort((a, b) => b.pos - a.pos);
  for (const e of semua) src = src.slice(0, e.pos) + e.tulis + src.slice(e.pos + e.hapus);
  if (TULIS) fs.writeFileSync(file, src);
  console.log(`${TULIS ? 'TULIS' : 'SIMULASI'} ${file}: import=${editImport.length} await=${sisip.length} async=${ditandai.size}`);
}

console.log(`\nTOTAL import=${totalImport} await=${totalAwait} async=${totalAsync} ${TULIS ? '(ditulis)' : '(simulasi — tambah --tulis)'}`);

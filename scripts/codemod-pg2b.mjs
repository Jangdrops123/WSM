// Codemod fase 2b (idempoten):
//  A. `await (CALL(...))?.x` / `await CALL(...)[i]` / `await CALL(...).y`
//     -> `(await CALL(...))?.x`  (kurung MENCAKUP await, bukan call saja)
//  B. fungsi `async` bertipe balik non-Promise (termasuk union & void)
//     -> Promise<T>.
//   node scripts/codemod-pg2b.mjs [--tulis]
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

let hitA = 0, hitB = 0;

for (const file of daftarFile('server')) {
  const base = path.basename(file);
  if (base === 'db.ts' || base === 'migrate.ts' || base === 'db.pg.ts') continue;
  let src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ESNext, true);

  const imporDb = new Set();
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) &&
        st.moduleSpecifier.text.endsWith('/db.pg.ts')) {
      const nb = st.importClause?.namedBindings;
      if (nb && ts.isNamedImports(nb)) {
        for (const el of nb.elements) imporDb.add(el.propertyName?.text ?? el.name.text);
      }
    }
  }

  const edit = [];

  // Cari akar pemanggilan-db di balik rantai akses (tanpa menembus kurung).
  const akarDbLepas = (node) => {
    let n = node;
    while (true) {
      if (ts.isParenthesizedExpression(n)) { n = n.expression; continue; }
      if (ts.isPropertyAccessExpression(n)) { n = n.expression; continue; }
      if (ts.isElementAccessExpression(n)) { n = n.expression; continue; }
      if (ts.isNonNullExpression(n)) { n = n.expression; continue; }
      if (ts.isAsExpression(n) || ts.isSatisfiesExpression(n)) { n = n.expression; continue; }
      break;
    }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) &&
        ASYNC_FNS.has(n.expression.text) && imporDb.has(n.expression.text)) return n;
    return null;
  };

  const kunjungi = (node) => {
    if (ts.isAwaitExpression(node)) {
      // Abaikan bila operan SUDAH berbentuk (await ...) atau call langsung tanpa buntut.
      let op = node.expression;
      while (ts.isParenthesizedExpression(op)) op = op.expression;
      if (ts.isAwaitExpression(op)) { /* (await x) — sudah benar */ }
      else {
        const akar = akarDbLepas(node.expression);
        if (akar) {
          // Bentuk akhir `(await CALL)` sudah benar -> lewati (idempoten).
          if (ts.isParenthesizedExpression(node.parent)) { ts.forEachChild(node, kunjungi); return; }
          // Tanpa akses buntut, `await CALL` / `await (CALL)` sudah benar -> lewati.
          let q = node.parent;
          while (q && ts.isParenthesizedExpression(q)) q = q.parent;
          const adaBuntut = q && (ts.isPropertyAccessExpression(q) || ts.isElementAccessExpression(q) ||
            ts.isNonNullExpression(q) || ts.isCallExpression(q) || ts.isAsExpression(q) ||
            ts.isSatisfiesExpression(q) || ts.isTemplateSpan(q) || ts.isBinaryExpression(q));
          if (!adaBuntut) { ts.forEachChild(node, kunjungi); return; }
          // Ada akses buntut? (induk await adalah akses / bagian rantai)
          let p = node.parent;
          while (p && ts.isParenthesizedExpression(p)) p = p.parent;
          const buntut = p && (ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p) ||
            ts.isNonNullExpression(p) || ts.isCallExpression(p) || ts.isAsExpression(p) ||
            ts.isSatisfiesExpression(p) || ts.isTemplateSpan(p) || ts.isBinaryExpression(p));
          // Struktur sekarang: `await (CALL)` atau `await CALL` + buntut di luar.
          // Target: `(await CALL)` + buntut.
          const awaitPos = node.getStart(); // posisi kata kunci `await`
          const operanPos = node.expression.getStart();
          // 1. Sisip '(' sebelum `await`
          edit.push({ pos: awaitPos, hapus: 0, tulis: '(' });
          // 2. Buang '(' pembuka operan bila ada (kasus `await (CALL)`)
          if (ts.isParenthesizedExpression(node.expression)) {
            edit.push({ pos: operanPos, hapus: 1, tulis: '' });
          }
          // 3. Tutup ')' setelah akhir CALL (sebelum buntut)
          edit.push({ pos: akar.getEnd(), hapus: 0, tulis: ')' });
          // 4. Buang ')' penutup operan bila ada
          if (ts.isParenthesizedExpression(node.expression)) {
            edit.push({ pos: node.expression.getEnd() - 1, hapus: 1, tulis: '' });
          }
          hitA++;
        }
      }
    }
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) ||
         ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) &&
        ((typeof ts.getModifiers === 'function' ? ts.getModifiers(node) : node.modifiers) ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) &&
        node.type) {
      const t = node.type.getText();
      if (t !== 'void' && t !== 'never' && t !== 'any' && !/^Promise</.test(t)) {
        edit.push({ pos: node.type.getStart(), hapus: node.type.getEnd() - node.type.getStart(), tulis: `Promise<${t}>` });
        hitB++;
      }
    }
    ts.forEachChild(node, kunjungi);
  };
  kunjungi(sf);

  if (!edit.length) continue;
  edit.sort((a, b) => b.pos - a.pos);
  // Terapkan dengan perlindungan tumpang-tindih: edit hapus menang atas sisip di posisi sama.
  let ok = true;
  const lihat = [];
  for (const e of edit) {
    if (lihat.some((d) => (e.pos >= d.pos && e.pos < d.pos + Math.max(d.hapus, 1) && !(e.pos === d.pos && e.hapus === 0 && d.hapus === 0)))) {
      if (!(e.hapus > 0)) { continue; }
    }
    lihat.push(e);
    src = src.slice(0, e.pos) + e.tulis + src.slice(e.pos + e.hapus);
  }
  if (TULIS) fs.writeFileSync(file, src);
  console.log(`${TULIS ? 'TULIS' : 'SIMULASI'} ${file}: edit=${lihat.length}`);
}

console.log(`\nTOTAL kaseA(await-kurung)=${hitA} kaseB(promise)=${hitB} ${TULIS ? '(ditulis)' : '(simulasi)'}`);

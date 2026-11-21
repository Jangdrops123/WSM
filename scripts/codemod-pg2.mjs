// Codemod fase 2 (idempoten, aman diulang):
//  A. `await get(...)?.x` / `await all(...)[0]` / `await run(...).y`
//     -> `(await get(...))?.x`  (await mengikat lebih longgar dari . ?.[ )
//  B. fungsi `async` bertipe balik non-Promise -> Promise<T>.
//   node scripts/codemod-pg2.mjs [--tulis]
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
  if (path.basename(file) === 'db.ts' || path.basename(file) === 'migrate.ts' || path.basename(file) === 'db.pg.ts') continue;
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
  if (!imporDb.size) continue;

  const edit = []; // {pos, hapus, tulis}

  // Akar pemanggilan-db di balik rantai akses: await get(...)?.x -> Call(get)
  const akarDb = (node) => {
    let n = node;
    while (true) {
      if (ts.isParenthesizedExpression(n)) return null; // sudah dikurung -> aman
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
      const op = node.expression;
      // Hanya perbaiki bila operan BUKAN pemanggilan langsung (ada akses buntut)
      const langsung =
        ts.isCallExpression(op) ||
        (ts.isParenthesizedExpression(op));
      if (!langsung) {
        const akar = akarDb(op);
        if (akar) {
          edit.push({ pos: akar.getStart(), hapus: 0, tulis: '(' });
          edit.push({ pos: akar.getEnd(), hapus: 0, tulis: ')' });
          hitA++;
        }
      }
    }
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) ||
         ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) &&
        node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) &&
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
  for (const e of edit) src = src.slice(0, e.pos) + e.tulis + src.slice(e.pos + e.hapus);
  if (TULIS) fs.writeFileSync(file, src);
  console.log(`${TULIS ? 'TULIS' : 'SIMULASI'} ${file}: kurung=${edit.filter((e) => e.tulis === '(').length} promise=${edit.filter((e) => e.tulis.startsWith('Promise<')).length}`);
}

console.log(`\nTOTAL kaseA(kurung)=${hitA} kaseB(promise)=${hitB} ${TULIS ? '(ditulis)' : '(simulasi)'}`);

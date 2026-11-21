// Codemod fase 3 — dengan type-checker:
//  A. `await` untuk SEMUA pemanggilan yang bertipe Promise (termasuk fungsi
//     lokal yang menjadi async di fase 1; mis. `if (stokMinusDiizinkan())`).
//     `return p` di fungsi async dibiarkan (valid); `void p` -> `await p`.
//  B. `: void` pada fungsi async -> `Promise<void>`.
//  C. Tanda kurung (await ...) bila ada akses buntut (. ?.[ )
//   node scripts/codemod-pg3.mjs [--tulis]
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

const TULIS = process.argv.includes('--tulis');

const configPath = ts.findConfigFile('.', ts.sys.fileExists, 'tsconfig.json');
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, '.');
const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
const checker = program.getTypeChecker();

const isPromise = (t) => {
  if (!t) return false;
  if (t.symbol?.escapedName === 'Promise') return true;
  if (t.isUnion()) return t.types.some(isPromise);
  return false;
};

let hitA = 0, hitB = 0, hitC = 0;

for (const file of program.getSourceFiles().map((s) => s.fileName)) {
  if (!/[/\\]server[/\\]/.test(file)) continue;
  if (/db\.(ts|pg\.ts)$/.test(file) || file.endsWith(`${path.sep}migrate.ts`)) continue;
  const sf = program.getSourceFile(file);
  if (!sf || sf.isDeclarationFile) continue;

  const edit = [];

  const tandaiAsync = (node) => {
    let n = node;
    while (n) {
      if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) ||
          ts.isArrowFunction(n) || ts.isMethodDeclaration(n)) {
        const mods = (typeof ts.getModifiers === 'function' ? ts.getModifiers(n) : n.modifiers) ?? [];
        if (!mods.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) {
          const p = mods.length ? mods[mods.length - 1].end : n.getStart();
          edit.push({ pos: p, hapus: 0, tulis: mods.length ? ' async ' : 'async ' });
          hitB++;
        }
        return;
      }
      n = n.parent;
    }
  };

  const kunjungi = (node) => {
    if (ts.isCallExpression(node)) {
      const t = checker.getTypeAtLocation(node);
      if (isPromise(t)) {
        // Status: sudah di-await? di-return dari fungsi async?
        // Telusuri ke atas melewati kurung/cast; berhenti di penanda pertama.
        let p = node.parent;
        let diAwait = false, diReturnAsync = false, diYield = false;
        while (p && !ts.isSourceFile(p)) {
          if (ts.isAwaitExpression(p)) { diAwait = true; break; }
          if (ts.isYieldExpression(p)) { diYield = true; break; }
          if (ts.isReturnStatement(p)) {
            let f = p.parent;
            while (f && !(ts.isFunctionDeclaration(f) || ts.isFunctionExpression(f) ||
                   ts.isArrowFunction(f) || ts.isMethodDeclaration(f))) f = f.parent;
            const mods = (typeof ts.getModifiers === 'function' ? ts.getModifiers(f) : f?.modifiers) ?? [];
            if (mods.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) diReturnAsync = true;
            break;
          }
          // Batas ekspresi majemuk yang memakai nilai promise secara langsung
          // (argumen, operan, properti) -> tetap perlu await, hentikan telusur.
          if (ts.isExpressionStatement(p) || ts.isVariableDeclaration(p) ||
              ts.isIfStatement(p) || ts.isWhileStatement(p) || ts.isDoStatement(p) ||
              ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p) ||
              ts.isBinaryExpression(p) || ts.isCallExpression(p) || ts.isTemplateSpan(p) ||
              ts.isArrayLiteralExpression(p) || ts.isSpreadElement(p) || ts.isThrowStatement(p)) break;
          p = p.parent;
        }
        if (!diReturnAsync && !diAwait && !diYield) {
          // `void foo()` -> ganti void jadi await
          if (p && ts.isVoidExpression(p)) {
            edit.push({ pos: p.getStart(), hapus: 4, tulis: 'await' });
            hitA++;
            tandaiAsync(p);
          } else {
            // Kurung bila akses buntut (. ?.[ ) menempel langsung pada call ini
            let kurung = false;
            if (p && (ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p))) {
              let o = p.expression;
              while (o && ts.isParenthesizedExpression(o)) o = o.expression;
              kurung = o === node;
            }
            edit.push({ pos: node.getStart(), hapus: 0, tulis: kurung ? '(await ' : 'await ' });
            if (kurung) edit.push({ pos: node.getEnd(), hapus: 0, tulis: ')' });
            hitA++;
            if (kurung) hitC++;
            tandaiAsync(node);
          }
        }
      }
    }
    // B. : void pada fungsi async -> Promise<void>
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) ||
         ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) && node.type) {
      const mods = (typeof ts.getModifiers === 'function' ? ts.getModifiers(node) : node.modifiers) ?? [];
      if (mods.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) {
        const tt = node.type.getText();
        if (tt === 'void') {
          edit.push({ pos: node.type.getStart(), hapus: node.type.getEnd() - node.type.getStart(), tulis: 'Promise<void>' });
          hitB++;
        }
      }
    }
    ts.forEachChild(node, kunjungi);
  };
  kunjungi(sf);

  if (!edit.length) continue;
  let src = fs.readFileSync(file, 'utf8');
  edit.sort((a, b) => b.pos - a.pos);
  // Saring edit tumpang-tindih (rentang yang bersinggungan): ambil yang terluar dulu sudah urut;
  // lewati edit yang sepenuhnya di dalam rentang edit lain yang sudah diterapkan.
  const dipakai = [];
  const bertabrakan = (e) => dipakai.some((d) => e.pos > d.pos && e.pos < d.pos + d.hapus && e.hapus > 0);
  for (const e of edit) {
    if (e.hapus > 0 && bertabrakan(e)) continue;
    if (e.hapus === 0 && dipakai.some((d) => d.pos === e.pos && d.tulis === e.tulis)) continue;
    dipakai.push(e);
    src = src.slice(0, e.pos) + e.tulis + src.slice(e.pos + e.hapus);
  }
  if (TULIS) fs.writeFileSync(file, src);
  console.log(`${TULIS ? 'TULIS' : 'SIMULASI'} ${path.relative('.', file)}: edit=${dipakai.length}`);
}

console.log(`\nTOTAL kaseA(await)=${hitA} kaseB(async/void)=${hitB} kaseC(kurung)=${hitC} ${TULIS ? '(ditulis)' : '(simulasi)'}`);

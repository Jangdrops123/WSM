// Perbaiki sisa konversi async skrip uji (file-based, aman).
// Tahap: A) rapikan sisipan async rusak; B) async-kan helper ringkas generik;
// C) await semua panggilan helper async; D) concise-arrow ber-await -> async;
// E) fungsi ber-await belum-async -> async. Ulangi C+E sampai stabil.
//   node scripts/perbaiki-uji.mjs [--tulis]
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const TULIS = process.argv.includes('--tulis');

function semuaUji() {
  const d = 'scripts';
  return fs.readdirSync(d).filter((e) => /^(uji-|bersih-uji|isi-stok-demo|tandai-pakai).*\.ts$/.test(e)).map((e) => path.join(d, e));
}

// Cek sintaks sebagai ESM (top-level await legal; yang ilegal hanya await di fn sync).
function galatESM(f) {
  try {
    execSync(`npx esbuild ${f} --format=esm --outfile=/dev/null --log-level=error`, { stdio: ['ignore', 'ignore', 'pipe'] });
    return [];
  } catch (e) {
    return String(e.stderr || e.message).split('\n').filter((l) => l.includes('ERROR'));
  }
}

const LEWATI = new Set(['scripts/uji-kontras.ts']);
const NAMA_BANTU = ['q1', 'jml', 'hitung', 'ins', 'semua', 'saldo', 'jurnalPembelian', 'bersihkan', 'bersihkanUji',
  'bersihkanProdukUji', 'siapkan', 'pulihkanKategori', 'naikkanCadangan', 'pulihkanBatasCadangan', 'resetAtauDiag'];

for (const f of semuaUji()) {
  if (LEWATI.has(f)) continue;
  let s = fs.readFileSync(f, 'utf8');
  const sebelum = s;
  // A) sisipan rusak
  s = s.replace(/casync onst (\w+) = (\(.*?\)) =>/g, 'const $1 = async $2 =>');
  s = s.replace(/casync onst (\w+) = (\(.*?\)\s*:\s*[^=]+?) =>/g, 'const $1 = async $2 =>');
  s = s.replace(/fasync unction (\w+)\(/g, 'async function $1(');
  s = s.replace(/\basync async\b/g, 'async');
  // B) helper ringkas generik: `= [<T>] (p) [: Ret] =>` -> sisipkan async
  s = s.replace(/(const \w+ = )(<[^;\n>]*>)?(\([^()\n]*(?::[^=\n]+)?\)|[A-Za-z_$][\w$]*)\s*=>/g, '$1async $2$3 =>');
  // C+E) fixpoint: await panggilan, lalu async-kan fungsi ber-await
  for (let iter = 0; iter < 4; iter++) {
    // nama fungsi async saat ini
    const asyncSet = new Set();
    for (const m of s.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*async\b/g)) asyncSet.add(m[1]);
    for (const m of s.matchAll(/async\s+function\s+([A-Za-z_$][\w$]*)/g)) asyncSet.add(m[1]);
    for (const n of NAMA_BANTU) if (new RegExp(`\\b${n}\\b\\s*=>[^;\\n]*await\\b`).test(s)) asyncSet.add(n);
    let berubah = false;
    for (const nama of [...asyncSet, ...NAMA_BANTU]) {
      const re = new RegExp(`(?<![\\w$.'\"])(?<!await\\s)(?<!async\\s)(?<!function\\s)${nama}\\s*\\(`, 'g');
      const s2 = s.replace(re, `await ${nama}(`);
      if (s2 !== s) { berubah = true; s = s2; }
    }
    // D) concise arrow ber-await -> async: `X = [<T>] (p) [: Ret] => ...await` (satu baris)
    s = s.replace(/^([ \t]*(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*)(async\s+)?(<[^;\n>]*>)?(\([^()\n]*(?::[^=\n]+)?\)|[A-Za-z_$][\w$]*)\s*=>([^\n]*\bawait\b[^\n]*)$/gm,
      (_m, head, ada, gen, params, badan) => (ada ? _m : `${head}async ${gen ?? ''}${params} =>${badan}`));
    // E) fungsi blok ber-await belum async -> async: `const N = (p) => {` / `function N(`
    // (hanya bila badannya mengandung await — cek 60 baris berikut)
    const baris = s.split('\n');
    for (let i = 0; i < baris.length; i++) {
      const mE = /^([ \t]*)(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(<[^;\n>]*>)?(\([^()\n]*(?::[^=\n]+)?\)|[A-Za-z_$][\w$]*)\s*=>\s*\{\s*$/.exec(baris[i]);
      const mF = /^([ \t]*)function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(baris[i]);
      if (!mE && !mF) continue;
      if (/\basync\b/.test(baris[i])) continue;
      const lihat = baris.slice(i + 1, i + 400).join('\n');
      if (!/\bawait\b/.test(lihat)) continue;
      if (mE) baris[i] = `${mE[1]}${mE[2]} ${mE[3]} = async ${mE[4] ?? ''}${mE[5]} => {`;
      else if (mF) baris[i] = `${mF[1]}async function ${mF[2]}(` + baris[i].slice(mF[0].length);
    }
    s = baris.join('\n');
    if (!berubah) break;
  }
  if (s !== sebelum) {
    if (TULIS) fs.writeFileSync(f, s);
    console.log(`${TULIS ? 'TULIS' : 'SIMULASI'} ${f}`);
  }
}
console.log('SELESAI. Verifikasi esbuild-esm:');
for (const f of semuaUji()) {
  const g = galatESM(f);
  if (g.length) console.log(`GAGAL: ${f}\n  ${g.slice(0, 3).join('\n  ')}`);
}

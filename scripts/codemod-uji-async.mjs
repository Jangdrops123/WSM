// Pass 2 skrip uji: fungsi yang badannya kini memakai await dijadikan async,
// dan pemanggilannya di-await. Idempoten.
//   node scripts/codemod-uji-async.mjs [--tulis]
import fs from 'node:fs';
import path from 'node:path';

const TULIS = process.argv.includes('--tulis');

function semuaUji() {
  const d = 'scripts';
  return fs.readdirSync(d).filter((e) => /^(uji-|bersih-uji|isi-stok-demo|tandai-pakai).*\.ts$/.test(e)).map((e) => path.join(d, e));
}

// Cari akhir blok seimbang mulai dari '{' di indeks i.
function akhirBlok(s, i) {
  let dalam = 0;
  let kutip = null;
  let lolos = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (kutip) {
      if (lolos) { lolos = false; continue; }
      if (c === '\\') { lolos = true; continue; }
      if (c === kutip) kutip = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { kutip = c; continue; }
    if (c === '/' && s[j + 1] === '/') { while (j < s.length && s[j] !== '\n') j++; continue; }
    if (c === '/' && s[j + 1] === '*') { j += 2; while (j < s.length && !(s[j] === '*' && s[j + 1] === '/')) j++; j++; continue; }
    if (c === '{') dalam++;
    else if (c === '}') { dalam--; if (!dalam) return j; }
  }
  return -1;
}

let total = 0;
for (const f of semuaUji()) {
  let s = fs.readFileSync(f, 'utf8');
  if (!/\bawait\s+(all|get|run|pool|ins)\b/.test(s)) continue;
  let n = 0;
  const jadiAsync = new Set();
  // Pola: [async] function nama(...) {  |  const nama = [async] (...) => {
  const re = /(^|\n)([ \t]*)(async\s+)?(function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{|(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{)/g;
  let m;
  const temu = [];
  while ((m = re.exec(s)) !== null) {
    const sudahAsync = Boolean(m[3]);
    const nama = m[5] ?? m[7];
    const buka = s.indexOf('{', m.index + m[0].length - 1);
    const tutup = akhirBlok(s, buka);
    if (tutup < 0) continue;
    temu.push({ nama, sudahAsync, buka, tutup, kepala: m[0] });
  }
  // Panah badan-ringkas: `= (a) => (await ...)` -> `= async (a) => ...`
  {
    const reRingkas = /(=\s*)(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>(\s*)(?=\(await\s)/g;
    let mm;
    while ((mm = reRingkas.exec(s)) !== null) {
      const sebelum = s.slice(0, mm.index);
      const semuaNama = [...sebelum.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*$/g)];
      const nama = semuaNama.length ? semuaNama[semuaNama.length - 1][1] : null;
      s = s.slice(0, mm.index) + mm[1] + 'async ' + mm[2] + ' =>' + mm[3] + s.slice(mm.index + mm[0].length);
      if (nama) jadiAsync.add(nama);
      n++;
      reRingkas.lastIndex = mm.index + mm[0].length + 6;
    }
  }
  // Proses dari belakang agar indeks stabil.
  for (let k = temu.length - 1; k >= 0; k--) {
    const t = temu[k];
    if (t.sudahAsync) continue;
    const badan = s.slice(t.buka, t.tutup + 1);
    if (!/\bawait\b/.test(badan)) continue;
    // Jangan sentuh callback satu-baris non-fungsi (mis. .map((r) => r.id)) — badan tanpa await sudah disaring.
    // Sisipkan 'async ' sebelum 'function' atau sebelum'const/let/var'.
    const awalKepala = s.lastIndexOf(t.kepala, t.buka);
    const sisipDi = awalKepala + (t.kepala.startsWith('\n') ? 1 : 0) + (t.kepala.match(/^[ \n\t]*/)?.[0].length ?? 0);
    s = s.slice(0, sisipDi) + 'async ' + s.slice(sisipDi);
    jadiAsync.add(t.nama);
    n++;
  }
  // await-kan pemanggilan fungsi yang baru jadi async: `nama(...);` tanpa await.
  for (const nama of jadiAsync) {
    const rePanggil = new RegExp(`(^|\\n)([ \\t]*)(?!await\\s)${nama}\\s*\\(`, 'g');
    s = s.replace(rePanggil, (_mm, nl, sp) => {
      // pastikan bukan definisi fungsi
      n++;
      return `${nl}${sp}await ${nama}(`;
    });
  }
  if (n) {
    if (TULIS) fs.writeFileSync(f, s);
    total += n;
    console.log(`${TULIS ? 'TULIS' : 'SIMULASI'} ${f}: ${n} (${[...jadiAsync].join(', ')})`);
  }
}
console.log(`TOTAL: ${total} ${TULIS ? '(ditulis)' : '(simulasi)'}`);

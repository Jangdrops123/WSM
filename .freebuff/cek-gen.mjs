import fs from 'node:fs';

const theme = fs.readFileSync('src/theme-gelap.css', 'utf8');
const gi = theme.indexOf('/* ================= BAGIAN OTOMATIS');
const cur = gi < 0 ? theme : theme.slice(0, gi);
const gen = gi < 0 ? '' : theme.slice(gi);

const norm = (s) => s.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
function parseCss(src) {
  src = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let i = 0;
  const media = [];
  const readBlock = () => {
    while (i < src.length) {
      const start = i;
      while (i < src.length && src[i] !== '{' && src[i] !== '}') i++;
      const sel = norm(src.slice(start, i));
      if (src[i] === '}') { i++; continue; }
      if (src[i] !== '{') break;
      i++;
      if (/^@(media|supports)\b/.test(sel)) { media.push(sel); readBlock(); media.pop(); }
      else if (sel.startsWith('@')) {
        let d = 1;
        while (i < src.length && d > 0) { if (src[i] === '{') d++; else if (src[i] === '}') d--; i++; }
      } else {
        const dstart = i;
        let d = 1;
        while (i < src.length && d > 0) { if (src[i] === '{') d++; else if (src[i] === '}') d--; i++; }
        out.push({ media: media[media.length - 1] || null, sel, body: src.slice(dstart, i - 1) });
      }
    }
  };
  readBlock();
  return out;
}

// index of selectors+props covered in curated and generated parts
function index(src) {
  const m = new Map();
  for (const r of parseCss(src)) {
    for (const s of r.sel.split(',')) {
      const k = s.trim();
      if (!m.has(k)) m.set(k, new Set());
      for (const part of r.body.split(';')) {
        const mm = part.match(/^\s*([a-z-]+)\s*:/);
        if (mm) m.get(k).add(mm[1]);
      }
    }
  }
  return m;
}
const curI = index(cur);
const genI = index(gen);

const src = fs.readFileSync('src/pages/pembelian/pembelian.css', 'utf8');
let total = 0, covered = 0;
for (const r of parseCss(src)) {
  if (r.media && /print/i.test(r.media)) continue;
  for (const part of r.body.split(';')) {
    const m = part.match(/^\s*(background(?:-color)?|color|border[a-z-]*)\s*:\s*(.+)$/s);
    if (!m) continue;
    const val = m[2];
    if (!/#|rgb\(|hsl\(/i.test(val)) continue;
    // light-ish? crude: white/light hex
    if (!/(#fff\b|#fef|#fd|#fc|#fa|#f5f|#f4|#f8|#f9|white|#eee|#f0|#e[0-9a-f]{5}|rgba?\(\s*2[0-9]{2}|rgba?\(255)/i.test(val)) continue;
    total++;
    const sels = r.sel.split(',').map((s) => s.trim());
    const anyCur = sels.some((s) => curI.get(s)?.has(m[1]));
    const anyGen = sels.some((s) => genI.get(s)?.has(m[1]));
    if (anyCur || anyGen) { covered++; continue; }
    console.log(`MISS  ${sels.join(', ')}\n        ${m[1]}: ${val.slice(0, 90)}`);
  }
}
console.log(`\ntotal light decls=${total} covered=${covered} missed=${total - covered}`);

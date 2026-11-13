/**
 * Generator override tema gelap.
 *
 * Membaca CSS modul lalu menulis blok override di AKHIR src/theme-gelap.css
 * untuk setiap deklarasi background/color/border yang masih memakai warna
 * terang hardcoded, memetakannya:
 *   - putih / abu terang        → permukaan gelap kaca
 *   - tint hijau/amber/merah/biru → tint gelap berwarna senada
 *   - teks gelap netral/aksen   → teks terang yang terbaca
 *   - border abu terang         → putih transparan
 *
 * Tidak disentuh (sengaja): dokumen cetak/struk/faktur/barcode/label/tanda
 * tangan, aturan @media print, dan properti yang sudah ditangani manual di
 * bagian kurasi theme-gelap.css.
 *
 * Pakai:  node scripts/gen-tema.mjs   (idempoten — blok generator ditulis
 * ulang dari sumber setiap kali dijalankan)
 */
import fs from 'node:fs';

const THEME = 'src/theme-gelap.css';
const FILES = [
  'src/styles.css',
  'src/crud.css',
  'src/pages/pembelian/pembelian.css',
  'src/pages/penjualan/penjualan.css',
  'src/pages/persediaan/persediaan.css',
  'src/pages/opname/opname.css',
  'src/pages/pengaturan/pengaturan.css',
  'src/pages/pengaturan/proses-tahunan.css',
  'src/pages/laporan/laporan.css',
  'src/pages/faktur/faktur.css',
];

const MARK_START = '/* ================= BAGIAN OTOMATIS';

/* ---------------------------------------------------------------- util -- */

const norm = (s) => s.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();

function hexRgb(h) {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return { h: 0, s: 0, l };
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (mx === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

function hsl2hex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

const HEX = /#[0-9a-f]{6}|#[0-9a-f]{3}/gi;

/* ------------------------------------------------------------ pemetaan -- */

/** background terang → gelap. null = biarkan. */
function mapBg(hex) {
  const [r, g, b] = hexRgb(hex);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (r >= 254 && g >= 254 && b >= 254) return '#131c2e'; // putih murni
  if (mn >= 228 && mx - mn <= 16) return r >= 250 ? '#131c2e' : '#172135'; // abu terang
  if (g >= r + 4 && g >= b - 6 && mx >= 230 && mn >= 210) return 'rgba(16, 185, 129, 0.12)'; // tint hijau
  if (r >= 248 && g >= 232 && b <= 232) return 'rgba(245, 158, 11, 0.14)'; // tint amber
  if (r >= 248 && g <= 246 && b <= 246 && r > g && r > b) return 'rgba(239, 68, 68, 0.13)'; // tint merah
  if (b >= g && b >= r && mn >= 225) return 'rgba(99, 102, 241, 0.16)'; // tint biru
  if (r >= 248 && g >= 244 && b <= 250 && r - b >= 6) return 'rgba(245, 158, 11, 0.14)'; // krem/warning
  if (mn >= 210 && mx - mn <= 25) return '#172135'; // sisa abu-abu muda
  return null;
}

/** teks → terbaca di atas gelap. */
function mapColor(hex) {
  const [r, g, b] = hexRgb(hex);
  const { h, s, l } = rgbHsl(r, g, b);
  if (l >= 0.93) return null; // sudah terang
  if (s < 0.12) {
    if (l >= 0.72) return null;
    if (l < 0.3) return '#e8edf5';
    if (l < 0.55) return '#cbd5e1';
    return '#a7b4c6';
  }
  if (l < 0.5) return hsl2hex(h, Math.min(s, 0.75), 0.66); // aksen gelap → terangkan
  if (l < 0.62) return hsl2hex(h, Math.min(s, 0.8), Math.min(l + 0.12, 0.7));
  return null;
}

/** warna border netral terang → putih transparan. */
function mapBorderVal(v) {
  return v.replace(HEX, (hm) => {
    const [r, g, b] = hexRgb(hm);
    const { s, l } = rgbHsl(r, g, b);
    if (l >= 0.85 && s < 0.12) return 'rgba(255, 255, 255, 0.12)';
    return hm;
  });
}

/* ------------------------------------------------------------- parser --- */

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
      if (/^@(media|supports)\b/.test(sel)) {
        media.push(sel);
        readBlock();
        media.pop();
      } else if (sel.startsWith('@')) {
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

/* --------------------------------------------------------------- utama -- */

/* Kertas/cetak: dokumen faktur (.faktur, .faktur__*, faktur-halaman/
   pratinjau/wadah), struk, opname-dok, barcode, label, tanda tangan. */
const EXCLUDE =
  /(cetak|struk|opname-dok|barcode|pratinjau(?![a-z-])|faktur__|faktur-(halaman|pratinjau|wadah)|(^|[\s,.>])faktur(?![a-z-])|(^|[\s,.>])(qr|label|ttd)(?![a-z-])|tanda-tangan)/i;
const PROPS = /^(background|background-color|color|border|border-color|border-(top|right|bottom|left)|border-(top|right|bottom|left)-color)$/;

const themeRaw = fs.readFileSync(THEME, 'utf8');
const curRaw = themeRaw.includes(MARK_START)
  ? themeRaw.slice(0, themeRaw.indexOf(MARK_START))
  : themeRaw;

/* Kurasi: selector → properti yang SUDAH ditangani manual. */
const curated = new Map();
for (const r of parseCss(curRaw)) {
  for (const s of r.sel.split(',')) {
    const key = s.trim();
    if (!curated.has(key)) curated.set(key, new Set());
    for (const part of r.body.split(';')) {
      const m = part.match(/^\s*([a-z-]+)\s*:/);
      if (m) curated.get(key).add(m[1]);
    }
  }
}

const gen = [];

for (const file of FILES) {
  if (!fs.existsSync(file)) { console.warn('! tidak ada:', file); continue; }
  let n = 0;
  for (const rule of parseCss(fs.readFileSync(file, 'utf8'))) {
    if (rule.media && /print/i.test(rule.media)) continue;
    if (EXCLUDE.test(rule.sel)) continue;

    const decls = [];
    for (const part of rule.body.split(';')) {
      const m = part.match(/^\s*([a-z-]+)\s*:\s*(.+)$/s);
      if (!m) continue;
      const prop = m[1];
      const val = m[2].trim();
      if (!PROPS.test(prop)) continue;
      if (/var\(|url\(|gradient|none|transparent|inherit|initial|unset|currentColor/i.test(val)) continue;
      if (!/#|rgb\(|hsl\(/i.test(val)) continue;

      if (prop.startsWith('background')) {
        const hm = val.match(/#[0-9a-f]{6}|#[0-9a-f]{3}/i)?.[0];
        const mp = hm ? mapBg(hm) : null;
        if (mp) decls.push([prop, val.replace(hm, mp)]);
      } else if (prop === 'color') {
        const mapped = val.replace(HEX, (h) => mapColor(h) ?? h);
        if (mapped !== val) decls.push([prop, mapped]);
      } else {
        const mapped = mapBorderVal(val);
        if (mapped !== val) decls.push([prop, mapped]);
      }
    }
    if (!decls.length) continue;

    /* Hanya selector yang belum ditangani kurasi, dan hanya prop yang belum. */
    const sels = rule.sel.split(',').map((s) => s.trim())
      .filter((s) => decls.some(([p]) => !curated.get(s)?.has(p)));
    if (!sels.length) continue;
    const finalDecls = decls.filter(([p]) => sels.some((s) => !curated.get(s)?.has(p)));
    gen.push({ media: rule.media, sel: sels.join(', '), decls: finalDecls });
    n++;
  }
  console.log(`${file}: ${n}`);
}

/* gabung per (media,sel) — deklarasi terakhir menang */
const merged = new Map();
for (const g of gen) {
  const k = `${g.media ?? ''}|${g.sel}`;
  if (!merged.has(k)) merged.set(k, { media: g.media, sel: g.sel, decls: new Map() });
  const tgt = merged.get(k);
  for (const [p, v] of g.decls) tgt.decls.set(p, v);
}

const render = (g, indent = '') =>
  `${indent}${g.sel} {\n${[...g.decls].map(([p, v]) => `${indent}  ${p}: ${v};`).join('\n')}\n${indent}}\n`;

let out = `${MARK_START} ================================================\n`;
out += `   Dibuat oleh scripts/gen-tema.mjs — jangan diedit manual.\n`;
out += `   Override warna terang sisa dari CSS modul. Jalankan ulang:\n`;
out += `   node scripts/gen-tema.mjs\n`;
out += `   ================================================ */\n\n`;

const list = [...merged.values()];
out += list.filter((g) => !g.media).map((g) => render(g)).join('\n');

const byMedia = new Map();
for (const g of list.filter((g) => g.media)) {
  if (!byMedia.has(g.media)) byMedia.set(g.media, []);
  byMedia.get(g.media).push(g);
}
for (const [m, rules] of byMedia) {
  out += `\n${m} {\n${rules.map((g) => render(g, '  ')).join('\n')}}\n`;
}

const base = themeRaw.includes(MARK_START)
  ? themeRaw.slice(0, themeRaw.indexOf(MARK_START))
  : themeRaw;
fs.writeFileSync(THEME, base.replace(/\s*$/, '\n\n') + out);
console.log(`\nTotal ${merged.size} selector → ${THEME}`);

/* Uji kontras token tema (P5) — memeriksa rasio WCAG 2.1 pasangan warna
   penting di tema TERANG dan GELAP, termasuk varian aksen & sidebar terang.
   Minimal 4.5:1 untuk teks kecil, 3:1 untuk teks besar/label grafik.

   Sumber token: src/styles.css (:root = terang, :root[data-theme="dark"]).
   Pakai:  npx tsx scripts/uji-kontras.ts   (exit 1 bila ada yang gagal) */
import fs from 'node:fs';

const CSS = fs.readFileSync('src/styles.css', 'utf8');

/* ----------------------------- parsing token ----------------------------- */

async function blok(pembuka: string): Record<string, string> {
  const i = CSS.indexOf(pembuka);
  if (i < 0) throw new Error(`blok tidak ditemukan: ${pembuka}`);
  const mulai = CSS.indexOf('{', i);
  let kedalaman = 0;
  let j = mulai;
  for (; j < CSS.length; j++) {
    if (CSS[j] === '{') kedalaman++;
    else if (CSS[j] === '}') {
      kedalaman--;
      if (kedalaman === 0) break;
    }
  }
  const isi = CSS.slice(mulai + 1, j);
  const out: Record<string, string> = {};
  for (const baris of isi.split('\n')) {
    const m = baris.match(/^\s*(--[a-z0-9-]+)\s*:\s*(.+?);?\s*$/i);
    if (m) out[m[1]] = m[2].replace(/;$/, '').trim();
  }
  return out;
}

type Warna = [number, number, number, number]; // r,g,b 0-255 + alpha 0-1

async function parse(v: string): Warna {
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const rgba = v.match(/^rgba?\(([^)]+)\)$/i);
  if (rgba) {
    const [r, g, b, a] = rgba[1].split(',').map((x) => parseFloat(x.trim()));
    return [r, g, b, a === undefined ? 1 : a];
  }
  throw new Error(`warna tidak dikenal: ${v}`);
}

/** gabung fg (di atas base) bila alpha < 1 */
function atas(fg: Warna, base: Warna): Warna {
  if (fg[3] >= 1) return fg;
  return [
    fg[0] * fg[3] + base[0] * (1 - fg[3]),
    fg[1] * fg[3] + base[1] * (1 - fg[3]),
    fg[2] * fg[3] + base[2] * (1 - fg[3]),
    1,
  ];
}

const luminansi = (c: Warna): number => {
  const f = (x: number) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};

const rasio = (a: Warna, b: Warna): number => {
  const l1 = luminansi(a);
  const l2 = luminansi(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

/* ------------------------------ pasangan --------------------------------- */

interface Pasangan {
  fg: string;
  bg: string;
  /** latar alas komposit (untuk warna transparan) — default surface */
  dasar?: string;
  min?: number; // default 4.5
}

const PASANGAN: Pasangan[] = [
  // teks utama & sekunder di permukaan
  { fg: '--text', bg: '--surface' },
  { fg: '--text', bg: '--surface-2' },
  { fg: '--text-muted', bg: '--surface' },
  { fg: '--text-muted', bg: '--surface-2' },
  // banner pilih-massal
  { fg: '--banner-text', bg: '--banner-bg' },
  { fg: '--link', bg: '--banner-bg' },
  { fg: '--banner-text', bg: '--surface', dasar: '--surface' },
  // tautan & tombol
  { fg: '--link', bg: '--surface' },
  { fg: '--accent-contrast', bg: '--accent-fill' },
  // status
  { fg: '--success', bg: '--surface' },
  { fg: '--warning', bg: '--surface' },
  { fg: '--danger', bg: '--surface' },
  { fg: '--success', bg: '--success-soft' },
  { fg: '--warning', bg: '--warning-soft' },
  { fg: '--danger', bg: '--danger-soft' },
  // baris tabel (hover & terpilih) — teks --text di atas latar hasil komposit
  { fg: '--text', bg: '--row-hover', dasar: '--surface' },
  { fg: '--text', bg: '--row-selected', dasar: '--surface' },
  { fg: '--text', bg: '--row-selected-solid', dasar: '--surface' },
  { fg: '--text-muted', bg: '--row-selected', dasar: '--surface' },
  // sidebar (bg bisa transparan → komposit di atas --bg)
  { fg: '--sidebar-text', bg: '--sidebar-bg', dasar: '--bg' },
  { fg: '--sidebar-heading', bg: '--sidebar-bg', dasar: '--bg' },
  { fg: '--sidebar-active-teks', bg: '--sidebar-active' },
  { fg: '--sidebar-hover-teks', bg: '--sidebar-hover', dasar: '--sidebar-bg', min: 4.5 },
  // label grafik (3:1 = teks besar/non-informasional kecil, pakai 3)
  { fg: '--chart-label', bg: '--surface', min: 3 },
  { fg: '--text', bg: '--surface-2' },
];

let gagal = 0;
let lulus = 0;

async function periksa(namaTema: string, t: Record<string, string>, dasarTambahan: Record<string, Warna>) {
  const warna = async (kunci: string): Promise<Warna> => {
    const v = t[kunci];
    if (!v) throw new Error(`token hilang: ${kunci}`);
    if (v.startsWith('var(')) return warna(v.slice(4, -1));
    return await parse(v);
  };
  const bgDasar = async (kunci?: string): Promise<Warna> => (kunci && dasarTambahan[kunci] ? dasarTambahan[kunci] : await warna('--surface'));

  for (const p of PASANGAN) {
    const min = p.min ?? 4.5;
    let fg = await warna(p.fg);
    let bg = await warna(p.bg);
    const dasar = p.dasar ? await warna(p.dasar) : await bgDasar(p.bg);
    bg = await atas(bg, dasar);
    fg = await atas(fg, bg);
    const r = rasio(fg, bg);
    const ok = r >= min;
    if (ok) lulus++;
    else {
      gagal++;
      console.log(`✘ ${namaTema} ${p.fg} (${fg.join(',')}) di atas ${p.bg} (${bg.join(',')}) = ${r.toFixed(2)}:1 (min ${min})`);
    }
  }
}

const terang = await blok(':root {');
const gelap = { ...terang, ...blok(':root[data-theme="dark"] {') };

// dasar komposit untuk tiap tema
const dasarTerang: Record<string, Warna> = { '--surface': await parse(terang['--surface']), '--bg': await parse(terang['--bg']) };
const dasarGelap: Record<string, Warna> = {
  '--surface': await parse(gelap['--surface']),
  '--bg': await parse(gelap['--bg']),
};

await periksa('terang', terang, dasarTerang);
await periksa('gelap', gelap, dasarGelap);

/* --------- varian aksen: kontras teks tombol (accent-contrast/fill) ------- */
async function periksaAksen(dark: boolean): void {
  const re = dark
    ? /:root\[data-theme="dark"\]\[data-aksen="(\w+)"\] \{([\s\S]*?)\}/g
    : /:root\[data-aksen="(\w+)"\] \{([\s\S]*?)\}/g;
  for (const m of CSS.matchAll(re)) {
    const t = { ...(dark ? gelap : terang) };
    for (const baris of m[2].split('\n')) {
      const mm = baris.match(/^\s*(--[a-z0-9-]+)\s*:\s*(.+?);?\s*$/i);
      if (mm) t[mm[1]] = mm[2].replace(/;$/, '').trim();
    }
    const r = rasio(await parse(t['--accent-contrast']), await parse(t['--accent-fill']));
    if (r >= 4.5) lulus++;
    else {
      gagal++;
      console.log(`✘ aksen ${dark ? 'gelap' : 'terang'}/${m[1]}: --accent-contrast di atas --accent-fill = ${r.toFixed(2)}:1`);
    }
    // tautan aksen di atas permukaan
    const surf = await parse(t['--surface']);
    const rl = rasio(await atas(await parse(t['--link']), surf), await atas(surf, dark ? dasarGelap['--bg'] : dasarTerang['--bg']));
    if (rl >= 4.5) lulus++;
    else {
      gagal++;
      console.log(`✘ aksen ${dark ? 'gelap' : 'terang'}/${m[1]}: --link di atas --surface = ${rl.toFixed(2)}:1`);
    }
  }
}
await periksaAksen(false);
await periksaAksen(true);

/* ---------------- sidebar terang (data-sidebar="terang") ----------------- */
for (const [nama, basis] of [
  ['terang', terang],
  ['gelap', gelap],
] as const) {
  const t = { ...basis };
  const m = CSS.match(/:root\[data-sidebar="terang"\] \{([\s\S]*?)\}/);
  if (m) {
    for (const baris of m[1].split('\n')) {
      const mm = baris.match(/^\s*(--[a-z0-9-]+)\s*:\s*(.+?);?\s*$/i);
      if (mm) t[mm[1]] = mm[2].replace(/;$/, '').trim();
    }
  }
  const bg = await parse(t['--sidebar-bg']);
  for (const [fgk, label] of [
    ['--sidebar-text', 'teks'],
    ['--sidebar-heading', 'judul'],
    ['--sidebar-hover-teks', 'hover'],
    ['--sidebar-active-teks', 'aktif'],
    ['--sidebar-label', 'label grup'],
  ] as const) {
    const r = rasio(await atas(await parse(t[fgk]), bg), bg);
    const min = label === 'label grup' ? 3 : 4.5;
    if (r >= min) lulus++;
    else {
      gagal++;
      console.log(`✘ sidebar terang (${nama}) ${label}: ${r.toFixed(2)}:1 (min ${min})`);
    }
  }
}

console.log(`\nHasil kontras: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);

/**
 * Tokenisasi CSS — P2 tema.
 *
 * Mengganti literal warna (hex) pada properti background/color/border di CSS
 * komponen menjadi variabel token design, sehingga tema terang & gelap cukup
 * mengganti nilai token (styles.css :root / [data-theme="dark"]).
 *
 * Sengaja DILEWATI:
 *   - @media print & selector kertas/cetak (faktur, struk, opname-dok,
 *     barcode, label, pratinjau kertas) — dokumen cetak selalu putih;
 *   - gradien, url(), transparan, nilai yang sudah memakai var();
 *   - @keyframes (warna animasi dibiarkan);
 *   - styles.css (token layer sudah ditulis manual).
 *
 * Pemetaan bersifat sadar-properti (background → permukaan, color → teks,
 * border → garis). Pakai:  node scripts/tokenisasi.mjs  (idempoten).
 */
import fs from 'node:fs';

const FILES = [
  'src/crud.css',
  'src/pages/pembelian/pembelian.css',
  'src/pages/penjualan/penjualan.css',
  'src/pages/persediaan/persediaan.css',
  'src/pages/opname/opname.css',
  'src/pages/pengaturan/pengaturan.css',
  'src/pages/pengaturan/proses-tahunan.css',
  'src/pages/laporan/laporan.css',
  'src/pages/faktur/faktur.css',
  'src/pages/pos/pos.css',
  'src/pages/dashboard/dashboard.css',
];

/* Dokumen cetak/pratinjau kertas — jangan disentuh (tetap putih). */
const EXCLUDE =
  /(cetak|struk|opname-dok|barcode|pratinjau(?![a-z-])|faktur__|faktur-(halaman|pratinjau|wadah)|(^|[\s,.>])faktur(?![a-z-])|(^|[\s,.>])(qr|label|ttd)(?![a-z-])|tanda-tangan)/i;

const PROPS = new Set([
  'background',
  'background-color',
  'color',
  'border',
  'border-color',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline',
  'outline-color',
  'accent-color',
]);

const BG = {
  '#fff': '--surface',
  '#ffffff': '--surface',
  // permukaan netral terang (header tabel, kartu sekunder, foto)
  '#f8fafd': '--surface-2',
  '#f8fafc': '--surface-2',
  '#f9fafb': '--surface-2',
  '#fafafa': '--surface-2',
  '#f5f7fa': '--surface-2',
  '#f3f4f6': '--surface-2',
  '#eef2f8': '--surface-2',
  '#f1f2f5': '--surface-2',
  '#f7f9fc': '--surface-2',
  '#fbfcff': '--surface-2',
  '#f9fbff': '--surface-2',
  '#f8f9fb': '--surface-2',
  '#fbfcfe': '--surface-2',
  '#eef2f9': '--surface-2',
  '#f4f7fc': '--row-hover',
  '#e8eefb': '--accent-soft',
  '#111827': '--tooltip-bg',
  '#1d4ed8': '--accent-fill',
  '#16a34a': '--success-fill',
  '#dc2626': '--danger-fill',
  // baris terpilih
  '#eef4ff': '--row-selected',
  '#f5f8ff': '--row-selected',
  '#edf2ff': '--row-selected',
  '#e8efff': '--row-selected',
  // tint status
  '#e7f7ee': '--success-soft',
  '#ecfdf5': '--success-soft',
  '#f0fdf4': '--success-soft',
  '#e9f7ef': '--success-soft',
  '#dcfce7': '--success-soft',
  '#fef3c7': '--warning-soft',
  '#fffbeb': '--warning-soft',
  '#fff7ed': '--warning-soft',
  '#fef9c3': '--warning-soft',
  '#fee2e2': '--danger-soft',
  '#fef2f2': '--danger-soft',
  '#ffe4e6': '--danger-soft',
  // aksen padat
  '#2563eb': '--accent-fill',
  '#4f46e5': '--accent-fill',
  '#3b82f6': '--accent-fill',
};

const CLR = {
  '#111827': '--text',
  '#0f172a': '--text',
  '#1f2937': '--text',
  '#1e293b': '--text',
  '#334155': '--text',
  '#111': '--text',
  '#111111': '--text',
  '#1a1a1a': '--text',
  '#18181b': '--text',
  '#1d2939': '--text',
  '#000': '--text',
  '#000000': '--text',
  '#4b5b74': '--text-muted',
  '#6b7280': '--text-muted',
  '#64748b': '--text-muted',
  '#94a3b8': '--text-muted',
  '#475569': '--text-muted',
  '#9ca3af': '--text-muted',
  '#667085': '--text-muted',
  '#9aa7bd': '--text-muted',
  '#8b95a5': '--text-muted',
  '#6b7280': '--text-muted',
  '#ffffff': '--accent-contrast',
  '#fff': '--accent-contrast',
  '#2563eb': '--link',
  '#1d4ed8': '--link',
  '#1e40af': '--link',
  '#4f46e5': '--link',
  '#16a34a': '--success',
  '#15803d': '--success',
  '#14532d': '--success',
  '#166534': '--success',
  '#b45309': '--warning',
  '#92400e': '--warning',
  '#a16207': '--warning',
  '#d97706': '--warning',
  '#dc2626': '--danger',
  '#b91c1c': '--danger',
  '#e11d48': '--danger',
  '#ef4444': '--danger',
  '#be123c': '--danger',
};

const BORDER = {
  '#e5e7eb': '--border',
  '#e2e8f0': '--border',
  '#e3e8ef': '--border',
  '#dfe5ec': '--border',
  '#dbe2ea': '--border',
  '#d1d5db': '--border',
  '#cbd5e1': '--border',
  '#e9edf3': '--border',
  '#eceff4': '--border',
  '#d9e2ec': '--border',
  '#f1f5f9': '--border',
  '#cfd6e0': '--border',
  '#c8d2e2': '--border',
  '#c7d4ea': '--border',
  '#e5e9f2': '--border',
  '#c7d6fb': '--accent',
  '#1d4ed8': '--accent',
  '#16a34a': '--success-fill',
  '#dc2626': '--danger-fill',
  '#bfd3f7': '--banner-border',
  '#93b4f5': '--accent',
  '#2563eb': '--accent',
  '#4f46e5': '--accent',
};

const hexRe = /#[0-9a-fA-F]{3,8}\b/g;
let TOTAL = 0;

function mapValue(prop, value) {
  if (/var\(|url\(|gradient|none|transparent|inherit|initial|unset|currentColor/i.test(value)) {
    return value;
  }
  if (!hexRe.test(value)) return value;
  hexRe.lastIndex = 0;

  let tabel;
  if (prop.startsWith('background')) tabel = BG;
  else if (prop === 'color') tabel = CLR;
  else if (prop.startsWith('border') || prop === 'outline' || prop === 'outline-color') tabel = BORDER;
  else if (prop === 'accent-color') tabel = { '#2563eb': '--accent', '#4f46e5': '--accent' };
  else return value;

  return value.replace(hexRe, (h) => {
    const token = tabel[h.toLowerCase()];
    return token ? `var(${token})` : h;
  });
}

for (const file of FILES) {
  if (!fs.existsSync(file)) {
    console.warn('! tidak ada:', file);
    continue;
  }
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  // Stack konteks per blok: rule, @media, @keyframes — skip diwarisi turunan.
  const stack = [];
  let total = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trim = line.trim();

    if (trim.endsWith('{')) {
      const sel = trim.slice(0, -1).trim();
      const at = sel.startsWith('@');
      const indukLewati = stack.some((s) => s.lewati);
      const lewati =
        indukLewati ||
        /print/i.test(sel) ||
        sel.startsWith('@keyframes') ||
        (!at && EXCLUDE.test(sel));
      stack.push({ lewati, keyframes: sel.startsWith('@keyframes') });
      continue;
    }

    if (trim === '}') {
      if (stack.length) stack.pop();
      continue;
    }

    if (stack.some((s) => s.lewati || s.keyframes)) continue;

    const m = line.match(/^(\s*)([a-z-]+)(\s*:\s*)(.+?)(;\s*)$/);
    if (!m) continue;
    const prop = m[2];
    if (!PROPS.has(prop)) continue;
    const baru = mapValue(prop, m[4]);
    if (baru !== m[4]) {
      lines[i] = `${m[1]}${prop}${m[3]}${baru}${m[5]}`;
      total++;
    }
  }

  if (total) fs.writeFileSync(file, lines.join('\n'));
  TOTAL += total;
  console.log(`${file}: ${total} deklarasi ditokenisasi`);
}
console.log(`Selesai — total ${TOTAL} deklarasi.`);

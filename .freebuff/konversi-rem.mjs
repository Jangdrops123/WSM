/**
 * Konversi sekali-jalan: px → rem pada CSS modul (AH2b).
 * v2 — regex diperbaiki: `{`/`}` penutup dipakai ulang sebagai awal aturan
 * berikutnya (lookahead), sehingga aturan berurutan ikut terkonversi.
 * - properti yang diskalakan: font-size, line-height (bila px), padding*,
 *   margin*, gap, height/min/max, width/min/max, border-radius, top/right/
 *   bottom/left, flex-basis, letter-spacing, variabel --*-lebar/tinggi.
 * - TIDAK disentuh: ukuran border (1px tetap px), box-shadow, backdrop-filter,
 *   @media print, @page, kondisi breakpoint (@media max/min-width),
 *   selector dokumen cetak (faktur/struk/label/barcode/opname-dok/ttd/qr/
 *   pratinjau/splash/ip-kop).
 * Jalankan: node .freebuff/konversi-rem.mjs
 */
import fs from 'node:fs';

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
  'src/pages/pos/pos.css',
  'src/pages/dashboard/dashboard.css',
  'src/pages/master/impor-ekspor.css',
  'src/pages/auth/login.css',
  'src/components/pratinjau.css',
  'src/theme-gelap.css',
];

const EXCLUDE_SEL =
  /(barcode|opname-(dok|cetak)|tanda-tangan|ip-kop|splash|pdf-kertas|kolom-urut__baris--kepala|label-pratinjau|(^|[\s,.>])\.(faktur|struk|cetak|pratinjau|qr|ttd)(?![a-z-]))/i;

/** Komentar dibuang dulu — kata "faktur/label" pada komentar tidak boleh
 *  menghapus aturan UI yang ikut terkonversi. */
const buangKomentar = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ');

const PROPS =
  /^(font-size|line-height|padding|padding-(top|right|bottom|left)|margin|margin-(top|right|bottom|left)|gap|row-gap|column-gap|height|min-height|max-height|width|min-width|max-width|border-radius|border-radius-(top|right|bottom|left)-(left|right)|border-radius-(top-left|top-right|bottom-right|bottom-left)|top|right|bottom|left|flex-basis|letter-spacing|--sidebar-lebar|--sidebar-ciut|--tinggi-baris|--header-tinggi|--konten-padding|--gap-kartu|--padding-kartu)$/;

const rem = (px) => {
  const v = px / 16;
  const s = v.toFixed(4).replace(/\.?0+$/, '');
  return `${s === '' || s === '-' ? '0' : s}rem`;
};

const convertValue = (val) =>
  val.replace(/(^|[\s,(])(-?\d*\.?\d+)px\b/g, (m, pre, num) => {
    const n = Number(num);
    if (n === 0) return `${pre}0`;
    return `${pre}${rem(n)}`;
  });

let total = 0;
for (const file of FILES) {
  if (!fs.existsSync(file)) {
    console.warn('! tidak ada:', file);
    continue;
  }
  const src = fs.readFileSync(file, 'utf8');
  // Potong blok @media print & @page — jangan disentuh.
  const potong = [];
  let out = src.replace(/@media[^{]*print[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, (m) => {
    potong.push(m);
    return `___PRINT_${potong.length - 1}___`;
  });
  out = out.replace(/@page[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, (m) => {
    potong.push(m);
    return `___PRINT_${potong.length - 1}___`;
  });

  let n = 0;
  // lead + spasi sebelum/sesudah selector dipertahankan; `{`/`}` badan tidak
  // dikonsumsi agar aturan berikutnya tetap punya lead.
  out = out.replace(/(^|[{}])(\s*)([^{}@]+?)(\s*)\{([^{}]*)(?=\})/g, (m, lead, sp1, sel, sp2, body) => {
    if (EXCLUDE_SEL.test(buangKomentar(sel))) return m;
    if (!/\dpx/.test(body)) return m;
    // Komentar di dalam badan disembunyikan dulu — kalau tidak, teks komentar
    // ("…besar. */ padding: 16px;") menelan deklarasi sesudahnya.
    const komentar = [];
    const disembunyikan = body.replace(/\/\*[\s\S]*?\*\//g, (c) => {
      komentar.push(c);
      return `\u0000${komentar.length - 1}\u0000`;
    });
    const baru = disembunyikan.replace(/([a-z-]+)\s*:\s*([^;]+);/g, (dm, prop, val) => {
      if (!PROPS.test(prop)) return dm;
      if (!/\dpx/.test(val)) return dm;
      const v2 = convertValue(val.trim());
      if (v2 === val.trim()) return dm;
      n++;
      return `${prop}: ${v2};`;
    }).replace(/\u0000(\d+)\u0000/g, (_, i) => komentar[Number(i)]);
    return `${lead}${sp1}${sel}${sp2}{${baru}`;
  });

  out = out.replace(/___PRINT_(\d+)___/g, (_, i) => potong[Number(i)]);
  if (n) fs.writeFileSync(file, out);
  total += n;
  console.log(`${file}: ${n}`);
}
console.log(`total ${total} deklarasi dikonversi`);

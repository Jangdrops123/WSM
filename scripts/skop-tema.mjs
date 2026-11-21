/**
 * Skop tema gelap — P2.
 *
 * theme-gelap.css dulu berlaku tanpa syarat (dimuat terakhir). Kini tema
 * dijalankan lewat token: komponen memakai var(--…), dan [data-theme="dark"]
 * menyediakan nilai gelap. File ini tetap diperlukan untuk override kaca &
 * warna sisa — semua selector di dalamnya diprefiks [data-theme="dark"]
 * agar TIDAK mengganggu tema terang.
 *
 * Pengecualian (tetap berlaku di kedua tema):
 *   - @media print — cetak/PDF SELALU putih (P4).
 *
 * Idempoten: bila sudah ada prefix, file tidak diubah.
 * Pakai:  node scripts/gen-tema.mjs && node scripts/skop-tema.mjs
 */
import fs from 'node:fs';

const FILE = 'src/theme-gelap.css';
const PREFIX = '[data-theme="dark"] ';
// Idempoten: lepaskan prefix lama dulu, lalu terapkan ulang dari awal
// (aman dijalankan berulang setelah gen-tema.mjs menulis ulang bagian auto).
const src = fs.readFileSync(FILE, 'utf8').split(PREFIX).join('');

const lines = src.split('\n');
const out = [];

/** Stack frame: { jenis: 'media'|'keyframes'|'rule', cetak: bool }. */
const stack = [];
const dalamCetak = () => stack.some((f) => f.cetak);
const dalamKeyframes = () => stack.some((f) => f.jenis === 'keyframes');
/** Posisi selector: true bila baris ini (atau lanjutannya) adalah fragmen selector. */
let posisiSelector = true;
/** Komentar multi-baris — di dalamnya semua baris dibiarkan apa adanya. */
let diKomentar = false;

const prefix = (line, trim) => {
  const indent = line.slice(0, line.length - trim.length);
  return `${indent}${PREFIX}${trim}`;
};

for (const line of lines) {
  const trim = line.trim();

  // --- pemrosesan komentar multi-baris ---
  if (diKomentar) {
    out.push(line);
    if (trim.includes('*/')) diKomentar = false;
    continue;
  }
  const bukaKomentar = trim.indexOf('/*');
  if (bukaKomentar !== -1 && !trim.includes('*/', bukaKomentar)) {
    // komentar membuka di baris ini dan belum tertutup
    out.push(line);
    diKomentar = true;
    continue;
  }
  if (bukaKomentar !== -1 && trim.includes('*/', bukaKomentar)) {
    // komentar satu baris penuh — lewati (bukan selector/deklarasi)
    if (trim.startsWith('/*')) {
      out.push(line);
      continue;
    }
  }

  // --- penutup blok ---
  if (trim === '}') {
    stack.pop();
    posisiSelector = true; // setelah blok apa pun, berikutnya selector baru
    out.push(line);
    continue;
  }

  // --- pembuka blok ---
  if (trim.endsWith('{')) {
    const sel = trim.slice(0, -1).trim();
    if (sel.startsWith('@media')) {
      const cetak = /print/i.test(sel);
      stack.push({ jenis: 'media', cetak });
      posisiSelector = !cetak;
      out.push(line);
      continue;
    }
    if (sel.startsWith('@keyframes')) {
      stack.push({ jenis: 'keyframes', cetak: false });
      posisiSelector = false;
      out.push(line);
      continue;
    }
    if (sel.startsWith('@')) {
      stack.push({ jenis: 'media', cetak: dalamCetak() });
      posisiSelector = !dalamCetak();
      out.push(line);
      continue;
    }
    // selector biasa — prefix KECUALI di dalam print/keyframes
    if (dalamCetak() || dalamKeyframes()) {
      out.push(line);
    } else {
      out.push(prefix(line, trim));
    }
    stack.push({ jenis: 'rule', cetak: false });
    posisiSelector = false;
    continue;
  }

  // --- deklarasi ---
  if (trim.endsWith(';')) {
    posisiSelector = false;
    out.push(line);
    continue;
  }

  // --- lanjutan selector multi-baris (berakhir koma) atau baris kosong ---
  if (posisiSelector) {
    if (trim === '') {
      out.push(line);
      continue;
    }
    if (trim.endsWith(',') && !dalamCetak() && !dalamKeyframes()) {
      out.push(prefix(line, trim));
      continue;
    }
    out.push(line);
    continue;
  }

  out.push(line);
}

fs.writeFileSync(FILE, out.join('\n'));
const jumlah = out.filter((l) => l.includes(PREFIX)).length;
console.log(`${FILE}: ${jumlah} baris selector di-scoping ke [data-theme="dark"].`);

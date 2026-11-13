// Generator ikon PWA NusaSuite (192/512/180 px) — tanpa dependensi gambar.
// Menggambar langsung ke piksel: kotak membulat hijau bergradasi + monogram "N"
// putih, lalu mengemasnya menjadi PNG (RGBA 8-bit) memakai zlib bawaan Node.
//
// Jalankan sekali saat ikon perlu diperbarui:  node scripts/buatIkonPwa.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AKAR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TUJUAN = resolve(AKAR, 'public');

/* ------------------------------- PNG ------------------------------------- */
const TABEL_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABEL_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function potongan(judul, data) {
  const panjang = Buffer.alloc(4);
  panjang.writeUInt32BE(data.length);
  const isi = Buffer.concat([Buffer.from(judul, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(isi));
  return Buffer.concat([panjang, isi, crc]);
}

function kePng(lebar, tinggi, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lebar, 0);
  ihdr.writeUInt32BE(tinggi, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const baris = Buffer.alloc(tinggi * (lebar * 4 + 1));
  for (let y = 0; y < tinggi; y++) {
    const awal = y * (lebar * 4 + 1);
    baris[awal] = 0; // filter: none
    rgba.copy(baris, awal + 1, y * lebar * 4, (y + 1) * lebar * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    potongan('IHDR', ihdr),
    potongan('IDAT', deflateSync(baris, { level: 9 })),
    potongan('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------ Gambar ----------------------------------- */
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const lerp = (a, b, t) => a + (b - a) * t;

function jarakSegmen(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const panjang2 = dx * dx + dy * dy;
  const t = panjang2 === 0 ? 0 : clamp(((px - x1) * dx + (py - y1) * dy) / panjang2, 0, 1);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function gambarIkon(ukuran) {
  const S = ukuran;
  const setengah = S / 2;
  const radius = S * 0.225;
  const rgba = Buffer.alloc(S * S * 4);
  const m = S * 0.285;
  const kiri = m;
  const kanan = S - m;
  const atas = m;
  const bawah = S - m;
  const tebal = S * 0.0455;

  // Warna gradasi diagonal (hijau merek → hijau gelap).
  const c1 = [0x2f, 0x8a, 0x66];
  const c2 = [0x1b, 0x53, 0x3d];

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      // Jarak bertanda ke kotak membulat → tepi halus.
      const qx = Math.abs(x + 0.5 - setengah) - (setengah - radius);
      const qy = Math.abs(y + 0.5 - setengah) - (setengah - radius);
      const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
      const tutup = clamp(0.5 - d, 0, 1);
      if (tutup <= 0) {
        rgba[i] = 0;
        rgba[i + 1] = 0;
        rgba[i + 2] = 0;
        rgba[i + 3] = 0;
        continue;
      }
      const t = clamp((x + y) / (2 * S), 0, 1);
      let r = lerp(c1[0], c2[0], t);
      let g = lerp(c1[1], c2[1], t);
      let b = lerp(c1[2], c2[2], t);

      // Monogram N: dua batang tegak + satu diagonal.
      const dn = Math.min(
        jarakSegmen(x + 0.5, y + 0.5, kiri, atas, kiri, bawah),
        jarakSegmen(x + 0.5, y + 0.5, kanan, atas, kanan, bawah),
        jarakSegmen(x + 0.5, y + 0.5, kiri, atas, kanan, bawah) * 0.92,
      );
      const putih = clamp(tebal - dn + 0.5, 0, 1);
      if (putih > 0) {
        r = lerp(r, 0xff, putih);
        g = lerp(g, 0xff, putih);
        b = lerp(b, 0xff, putih);
      }

      rgba[i] = Math.round(r);
      rgba[i + 1] = Math.round(g);
      rgba[i + 2] = Math.round(b);
      rgba[i + 3] = Math.round(tutup * 255);
    }
  }
  return kePng(S, S, rgba);
}

for (const [nama, ukuran] of [
  ['ikon-192.png', 192],
  ['ikon-512.png', 512],
  ['ikon-180.png', 180],
]) {
  writeFileSync(resolve(TUJUAN, nama), gambarIkon(ukuran));
  console.log(`✔ ${nama} (${ukuran}×${ukuran})`);
}

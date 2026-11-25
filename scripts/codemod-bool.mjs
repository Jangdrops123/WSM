// Codemod boolean literal: `aktif = 1` -> `aktif = TRUE` (dsb.) pada SQL teks
// di server/*.ts. Hanya literal; parameter `= ?` tidak disentuh (PG menerima
// 0/1 via parameter untuk kolom BOOLEAN). Idempoten.
//   node scripts/codemod-bool.mjs [--tulis]
import fs from 'node:fs';
import path from 'node:path';

const TULIS = process.argv.includes('--tulis');
const BOOL = 'aktif|bawaan|pakai|periode_aktif|direvisi|dibatalkan|dihitung_manual|diurungkan|diingat|login_shift|perlu_ditinjau|tampil|wajib_ganti|lihat_hpp|ubah_harga_kasir|hapus_transaksi|proses_tahunan|void_retur|buka_tutup_shift|lihat_laba|ubah_stok_manual|sahkan_opname|hapus_massal|kelola_pengguna|ubah_pengaturan|akses_semua_toko';

function files(d) {
  const o = [];
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) o.push(...files(p));
    else if (p.endsWith('.ts')) o.push(p);
  }
  return o;
}

const pola = [
  [new RegExp(`\\b(${BOOL})\\s*=\\s*1\\b`, 'gi'), ' = TRUE'],
  [new RegExp(`\\b(${BOOL})\\s*=\\s*0\\b`, 'gi'), ' = FALSE'],
  [new RegExp(`\\b(${BOOL})\\s*<>\\s*1\\b`, 'gi'), ' <> TRUE'],
  [new RegExp(`\\b(${BOOL})\\s*<>\\s*0\\b`, 'gi'), ' <> FALSE'],
  [new RegExp(`\\b(${BOOL})\\s*!=\\s*1\\b`, 'gi'), ' <> TRUE'],
  [new RegExp(`\\b(${BOOL})\\s*!=\\s*0\\b`, 'gi'), ' <> FALSE'],
];

let total = 0;
for (const f of files('server')) {
  if (/migrations|codemod|db\.pg\.ts|db\.ts$|[\\/]migrate\.ts$/.test(f)) continue;
  let s = fs.readFileSync(f, 'utf8');
  let n = 0;
  for (const [re, ganti] of pola) {
    s = s.replace(re, (_m, c) => { n++; return c + ganti; });
  }
  if (n) {
    if (TULIS) fs.writeFileSync(f, s);
    total += n;
    console.log(`${TULIS ? 'TULIS' : 'SIMULASI'} ${f}: ${n}`);
  }
}
console.log(`TOTAL: ${total} ${TULIS ? '(ditulis)' : '(simulasi)'}`);

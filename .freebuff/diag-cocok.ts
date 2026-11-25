// Diagnosa akar masalah skor (tie 100/100 & skor 55) — read-only.
import { cocokkanBarang, indeksBarang, tokenNormal, normalisasi } from '../server/lib/cocok.ts';
import { uraiPembelianBaris } from '../server/lib/urai.ts';

const { grup } = indeksBarang();
const cari = (nama: string) => grup.filter((g) => g.nama === nama);

const lihat = (label: string, teks: string, warna: string | null) => {
  console.log(`\n=== ${label}: teks=${JSON.stringify(teks)} warna=${warna}`);
  const h = cocokkanBarang({ teks, warna, tokens: tokenNormal(teks) });
  console.log('  hasil:', h.kecocokan, h.skor, '/', h.skor2, 'grup:', h.grup?.nama, '| alasan:', h.alasan[0] ?? '');
  for (const k of h.kandidat) {
    console.log('   kandidat', k.skor, k.grup.nama, 'g.warna=', JSON.stringify(k.grup.warna), 'tokens=', JSON.stringify(k.grup.tokens));
  }
};

// Kasus 1: "ab biru" (persis, tie 100/100 di jalur urai).
lihat('persis ab biru (dengan warna dipisah)', 'ab biru', 'biru');
lihat('persis ab biru (tanpa warna)', 'ab biru', null);

// Grup-target: warna & token sebenarnya.
for (const g of cari('ab biru').concat(cari('ab hitam'))) {
  console.log('grup', g.nama, 'kunci=', g.kunci, 'warna=', JSON.stringify(g.warna), 'tokens=', JSON.stringify(g.tokens), 'anggota.warna=', g.anggota.map((a) => a.warna));
}

// Kasus 2: jalur urai nyata.
const h2 = uraiPembelianBaris('• ab biru 2 kd');
const p2 = (h2.pratinjau ?? [])[0];
console.log('\nurAI "ab biru 2 kd":', { nama: p2?.nama, warna: p2?.warna, kecocokan: p2?.kecocokan, skor: p2?.skor, alasan: p2?.alasan });

const h3 = uraiPembelianBaris('• c hitam 2 kd');
const p3 = (h3.pratinjau ?? [])[0];
console.log('urAI "c hitam 2 kd":', { nama: p3?.nama, warna: p3?.warna, kecocokan: p3?.kecocokan, skor: p3?.skor, alasan: p3?.alasan });
console.log('grup c hitam:', cari('c hitam').map((g) => ({ warna: g.warna, tokens: g.tokens, n: g.anggota.length })));
console.log('grup c merah:', cari('c merah').map((g) => ({ warna: g.warna, tokens: g.tokens, n: g.anggota.length })));

// Kasus 3: nama+warna ganda "chx merah merah" → 55.
const h4 = uraiPembelianBaris('• chx merah merah 2 kd');
const p4 = (h4.pratinjau ?? [])[0];
console.log('\nurAI "chx merah merah 2 kd":', { nama: p4?.nama, warna: p4?.warna, kecocokan: p4?.kecocokan, skor: p4?.skor, alasan: p4?.alasan });
const g4 = cari('chx merah')[0];
console.log('grup chx merah: warna=', JSON.stringify(g4?.warna), 'tokens=', JSON.stringify(g4?.tokens));
if (g4) {
  const q = tokenNormal('chx merah');
  console.log('q tokens:', q, '→ skor tanpa warna:', cocokkanBarang({ teks: 'chx merah', tokens: q }).skor, 'dengan warna merah:', cocokkanBarang({ teks: 'chx merah', tokens: q, warna: 'merah' }).skor);
}

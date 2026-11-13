// Analisa kualitas pencocokan (AG5) terhadap katalog nyata — read-only.
// Kelas uji: nama persis, nama+warna, salah eja, warna salah, sampah.
import { cocokkanBarang, tokenNormal, indeksBarang, normalisasi, cocokkanPemasok } from '../server/lib/cocok.ts';

const t0 = Date.now();
const { grup } = indeksBarang();
console.log(`katalog: ${grup.length} grup, ${grup.reduce((n, g) => n + g.anggota.length, 0)} produk aktif (indeks ${Date.now() - t0} ms)`);

const WARNA_CTH = ['hitam', 'putih', 'merah', 'biru', 'abu', 'navy', 'tosca', 'coklat'];
type Harapan = { label: string; benar: (h: ReturnType<typeof cocokkanBarang>, exp: typeof grup[number] | null) => boolean };

// Sample grup: yang punya minimal 2 anggota (multi-size) + 1 anggota.
const sampel = grup.filter((g) => g.anggota.length >= 2).slice(0, 40).concat(grup.filter((g) => g.anggota.length === 1).slice(0, 10));

const ringkas = (h: ReturnType<typeof cocokkanBarang>) => ({
  kecocokan: h.kecocokan,
  skor: h.skor,
  skor2: h.skor2,
  grup: h.grup?.nama ?? null,
});

let n = 0;
const catat = (kelas: string, h: ReturnType<typeof cocokkanBarang>, exp: (typeof grup)[number] | null, ok: boolean, teks: string) => {
  n++;
  const cocokGrup = h.grup && exp && h.grup.kunci === exp.kunci;
  return { kelas, teks, ...ringkas(h), target: exp?.nama ?? '-', cocokTarget: Boolean(cocokGrup), ok, alasan: h.alasan[0] ?? '' };
};

const hasil: ReturnType<typeof catat>[] = [];

// 1. Nama persis (dasar tanpa size) → wajib yakin ke grup itu.
for (const g of sampel.slice(0, 30)) {
  const teks = g.nama;
  const h = cocokkanBarang({ teks });
  hasil.push(catat('persis', h, g, h.kecocokan === 'yakin' && h.grup?.kunci === g.kunci, teks));
}
// 2. Nama + warna nyata anggota → wajib yakin.
for (const g of sampel.slice(0, 20)) {
  const w = g.warna ?? g.anggota.find((a) => a.warna)?.warna;
  if (!w) continue;
  const teks = `${g.nama} ${w}`;
  const h = cocokkanBarang({ teks, warna: w });
  hasil.push(catat('nama+warna', h, g, h.kecocokan === 'yakin' && h.grup?.kunci === g.kunci, teks));
}
// 3. Salah eja (potong 1 karakter kata terakhir) → tetap ke grup yang benar.
for (const g of sampel.slice(0, 20)) {
  const kata = g.nama.split(' ');
  kata[kata.length - 1] = kata[kata.length - 1].slice(0, -1);
  const teks = kata.join(' ');
  if (!teks.trim()) continue;
  const h = cocokkanBarang({ teks });
  const ok = h.kecocokan !== 'tidak' && h.grup?.kunci === g.kunci;
  hasil.push(catat('salah-eja', h, g, ok, teks));
}
// 4. Warna yang TIDAK dimiliki → jangan yakin ke grup lain (keliru = bahaya).
for (const g of sampel.slice(0, 20)) {
  const punya = new Set(g.anggota.map((a) => a.warna).filter(Boolean));
  const salah = WARNA_CTH.find((w) => !punya.has(w));
  if (!salah) continue;
  const teks = `${g.nama} ${salah}`;
  const h = cocokkanBarang({ teks, warna: salah });
  // Bahaya bila yakin ke grup YANG BUKAN target (salah barang).
  const salahGrup = h.kecocokan === 'yakin' && h.grup && h.grup.kunci !== g.kunci;
  hasil.push(catat('warna-salah', h, g, !salahGrup, teks));
}
// 5. Sampah total → wajib 'tidak'.
for (const teks of ['jeruk peras 5 pcs', 'xxx qqwerty 2 box', 'oblak nie ma dwie sztuki', 'foobarbaz']) {
  const h = cocokkanBarang({ teks });
  hasil.push(catat('sampah', h, null, h.kecocokan === 'tidak', teks));
}
// 6. Ambiguitas: skor1-skor2 < selisih padahal ≥ yakin (dipaksa kabur).
let seri = 0;
for (const g of sampel.slice(0, 30)) {
  const h = cocokkanBarang({ teks: g.nama });
  if (h.skor >= 85 && h.skor - h.skor2 < 10) { seri++; console.log('SERI:', g.nama, h.skor, 'vs', h.skor2, '→', h.kecocokan); }
}

// Laporan per kelas.
const kelas = [...new Set(hasil.map((r) => r.kelas))];
console.log('\nkelas            n   ok  ok%   yakin kabur tidak  salah-yakin(target lain)');
for (const k of kelas) {
  const rs = hasil.filter((r) => r.kelas === k);
  const ok = rs.filter((r) => r.ok).length;
  const y = rs.filter((r) => r.kecocokan === 'yakin').length;
  const kb = rs.filter((r) => r.kecocokan === 'kabur').length;
  const td = rs.filter((r) => r.kecocokan === 'tidak').length;
  const salah = rs.filter((r) => r.kecocokan === 'yakin' && !r.cocokTarget).length;
  console.log(`${k.padEnd(16)} ${String(rs.length).padStart(3)} ${String(ok).padStart(4)} ${String(Math.round((100 * ok) / rs.length)).padStart(4)}%  ${String(y).padStart(4)} ${String(kb).padStart(4)} ${String(td).padStart(4)}   ${salah}`);
}
const gagal = hasil.filter((r) => !r.ok);
console.log(`\ngagal ${gagal.length}/${hasil.length}:`);
for (const r of gagal.slice(0, 25)) console.log(' -', r.kelas, JSON.stringify(r.teks), '→', r.kecocokan, r.skor, '/' + r.skor2, 'grup:', r.grup, 'target:', r.target, '|', r.alasan.slice(0, 90));

// Pemasok.
console.log('\n--- pemasok (katalog: hanya "Pemasok Uji")');
for (const t of ['Pemasok Uji', 'pemasok ujii', 'Pemasok Uji Baru', 'Bos ace', 'Supplier A']) {
  const h = cocokkanPemasok(t);
  console.log(' ', JSON.stringify(t), '→ cocok:', h.cocok, 'skor:', h.skor, 'saran:', h.saran.map((s) => `${s.nama}:${s.skor}`).join(', '));
}

// Waktu per panggilan (warm).
const w = Date.now();
const N = 200;
for (let i = 0; i < N; i++) cocokkanBarang({ teks: sampel[i % sampel.length].nama });
console.log(`\nrata-rata cocokkanBarang (warm): ${((Date.now() - w) / N).toFixed(2)} ms/panggilan`);

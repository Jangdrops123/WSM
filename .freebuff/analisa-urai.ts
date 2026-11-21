// Analisa END-TO-END jalur nyata: uraiPembelianBaris → cocokkanBarang
// (dengan parser warna/token persis seperti pemakaian produksi). Read-only.
import { uraiPembelianBaris, type PratinjauUrai } from '../server/lib/urai.ts';
import { indeksBarang } from '../server/lib/cocok.ts';

const { grup } = indeksBarang();
console.log(`katalog: ${grup.length} grup / ${grup.reduce((n, g) => n + g.anggota.length, 0)} produk aktif`);

const WARNA_CTH = ['hitam', 'putih', 'merah', 'biru', 'abu', 'navy', 'tosca', 'coklat'];
const sampel = grup.filter((g) => g.anggota.length >= 2).slice(0, 40).concat(grup.filter((g) => g.anggota.length === 1).slice(0, 10));

interface Baris {
  kelas: string;
  teks: string;
  target: string;
  ok: boolean;
  kecocokan: string;
  skor: number;
  grup: string | null;
  alasan: string;
}

const hasil: Baris[] = [];
const uji = (kelas: string, namaBaris: string, target: typeof grup[number] | null, cek: (p: PratinjauUrai | undefined) => boolean) => {
  const h = uraiPembelianBaris(namaBaris);
  const p = (h.pratinjau ?? [])[0];
  hasil.push({
    kelas,
    teks: namaBaris,
    target: target?.nama ?? '-',
    ok: cek(p),
    kecocokan: p?.kecocokan ?? '-',
    skor: p?.skor ?? 0,
    grup: p?.grup_barang ?? null,
    alasan: (p?.alasan ?? []).join(' | ').slice(0, 120),
  });
};

// 1. Nama persis + qty → wajib yakin ke grup itu.
for (const g of sampel.slice(0, 30)) {
  uji('persis', `• ${g.nama} 2 kd`, g, (p) => p?.kecocokan === 'yakin' && p?.grup_barang === g.nama);
}
// 2. Nama + warna nyata.
for (const g of sampel.slice(0, 20)) {
  const w = g.warna ?? g.anggota.find((a) => a.warna)?.warna;
  if (!w) continue;
  uji('nama+warna', `• ${g.nama} ${w} 2 kd`, g, (p) => p?.kecocokan === 'yakin' && p?.grup_barang === g.nama);
}
// 3. Salah eja (potong 1 huruf kata terakhir).
for (const g of sampel.slice(0, 20)) {
  const kata = g.nama.split(' ');
  kata[kata.length - 1] = kata[kata.length - 1].slice(0, -1);
  const teks = kata.join(' ').trim();
  if (!teks) continue;
  uji('salah-eja', `• ${teks} 2 kd`, g, (p) => p?.kecocokan !== 'tidak' && p?.grup_barang === g.nama);
}
// 4. Warna yang tidak dimiliki → JANGAN yakin ke grup lain.
for (const g of sampel.slice(0, 20)) {
  const punya = new Set(g.anggota.map((a) => a.warna).filter(Boolean));
  const salah = WARNA_CTH.find((w) => !punya.has(w));
  if (!salah) continue;
  uji('warna-salah', `• ${g.nama} ${salah} 2 kd`, g, (p) => !(p?.kecocokan === 'yakin' && p?.grup_barang && p.grup_barang !== g.nama));
}
// 5. Sampah → wajib tidak.
for (const teks of ['• jeruk peras 5 pcs', '• xxx qqwerty 2 box', '• foobarbaz 3 kd']) {
  uji('sampah', teks, null, (p) => p?.kecocokan === 'tidak');
}

const kelas = [...new Set(hasil.map((r) => r.kelas))];
console.log('\nkelas            n   ok  ok%   yakin kabur tidak');
for (const k of kelas) {
  const rs = hasil.filter((r) => r.kelas === k);
  const ok = rs.filter((r) => r.ok).length;
  const y = rs.filter((r) => r.kecocokan === 'yakin').length;
  const kb = rs.filter((r) => r.kecocokan === 'kabur').length;
  const td = rs.filter((r) => r.kecocokan === 'tidak').length;
  console.log(`${k.padEnd(16)} ${String(rs.length).padStart(3)} ${String(ok).padStart(4)} ${String(Math.round((100 * ok) / rs.length)).padStart(4)}%  ${String(y).padStart(4)} ${String(kb).padStart(4)} ${String(td).padStart(4)}`);
}
const gagal = hasil.filter((r) => !r.ok);
console.log(`\ngagal ${gagal.length}/${hasil.length}:`);
for (const r of gagal.slice(0, 30)) console.log(' -', r.kelas, JSON.stringify(r.teks), '→', r.kecocokan, r.skor, 'grup:', r.grup, 'target:', r.target, '|', r.alasan);

// Multi-baris nyata (pola dari smoke test browser).
console.log('\n--- skenario multi-baris');
const h = uraiPembelianBaris(['Bos ace', 'Jumat 09 okt', '• chx merah 6 kd (3kd db 42 tp 39)', '• chx abu 5 kd', '• ston hitam 4 kd', 'Total = 15 kd'].join('\n'));
for (const p of h.pratinjau ?? []) console.log(' ', JSON.stringify(p.nama), '→', p.kecocokan, p.skor, '| grup:', p.grup_barang, '| profil:', p.profil_kode, '| pasang:', p.total_pasang);
console.log(' cek:', JSON.stringify(h.cek), '| pemasok:', JSON.stringify(h.pemasok));

// Waktu rata-rata jalur nyata.
const w = Date.now();
const N = 100;
for (let i = 0; i < N; i++) uraiPembelianBaris(`• ${sampel[i % sampel.length].nama} 2 kd\nTotal = 2 kd`);
console.log(`\nrata-rata uraiPembelianBaris (warm): ${((Date.now() - w) / N).toFixed(2)} ms/baris`);

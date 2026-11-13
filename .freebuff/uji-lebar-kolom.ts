// Uji numerik lebarKolomPersen (BAGIAN K2/K4) — jalankan: npx tsx .freebuff/uji-lebar-kolom.ts
import { lebarKolomPersen, kolomAktifTabel, ukuranKertas, type TemplateFaktur } from '../src/pages/faktur/tipe.ts';

let gagal = 0;
function cek(nama: string, kondisi: boolean, detail: unknown): void {
  if (kondisi) console.log(`✔ ${nama}`);
  else {
    gagal++;
    console.log(`✘ ${nama} → ${JSON.stringify(detail)}`);
  }
}
const dekat = (a: number, b: number, eps = 0.01): boolean => Math.abs(a - b) < eps;
const jumlah = (p: Record<string, number>): number => Object.values(p).reduce((a, b) => a + b, 0);

function tpl(partial: Partial<TemplateFaktur> = {}): TemplateFaktur {
  return {
    id: 1,
    nama: 'Uji',
    jenis: 'penjualan',
    bawaan: false,
    kertas: 'A4',
    orientasi: 'portrait',
    lebar_mm: null,
    tinggi_mm: null,
    margin_atas: 12,
    margin_kanan: 12,
    margin_bawah: 12,
    margin_kiri: 12,
    skala: 100,
    ukuran_font: 10,
    aksen: '#2563eb',
    blok: {},
    urutan_kolom: [],
    teks: {},
    ...partial,
  };
}

// Lebar konten A4: 210 − margin kiri/kanan 12 mm.
const MM = ukuranKertas(tpl()).lebar - 24;
const BARIS = 10;

// 1. Default penjualan, semua otomatis → nama menyerap sisa, total pas 100%.
{
  const t = tpl();
  const kolom = kolomAktifTabel(t);
  const { persen, totalTetap, melebihi } = lebarKolomPersen(t, kolom, MM, BARIS);
  cek('penjualan: 7 kolom efektif', kolom.length === 7, kolom);
  cek('penjualan: jumlah = 100%', dekat(jumlah(persen), 100), persen);
  // Rasio tetap: no(≈4) + kode13 + qty8 + satuan8 + harga13 + diskon13 + subtotal13 ≈ 72 → nama ≈ 28%.
  cek('penjualan: nama menyerap sisa ≈ 28%', dekat(persen.nama, 28, 1), persen.nama);
  cek('penjualan: tidak melebihi', !melebihi, { totalTetap, melebihi });
}

// 2. Surat Jalan → tanpa kolom harga/diskon/subtotal (K5).
{
  const t = tpl({ jenis: 'surat_jalan' });
  const kolom = kolomAktifTabel(t);
  const { persen, melebihi } = lebarKolomPersen(t, kolom, MM, BARIS);
  cek(
    'surat_jalan: tanpa kolom harga/diskon/subtotal',
    !kolom.includes('harga') && !kolom.includes('diskon') && !kolom.includes('subtotal'),
    kolom,
  );
  cek('surat_jalan: jumlah = 100%', dekat(jumlah(persen), 100), persen);
  cek('surat_jalan: nama lebih lebar (sisa kosong)', persen.nama > 50, persen.nama);
  cek('surat_jalan: tidak melebihi', !melebihi, { melebihi });
}

// 3. Lebar tetap total > 100% → melebihi=true, totalTetap asli, hasil tetap muat 100%.
{
  const t = tpl({
    pengaturan_kolom: {
      harga: { lebar: 60, satuan_lebar: '%' },
      subtotal: { lebar: 50, satuan_lebar: '%' },
    },
  });
  const kolom = kolomAktifTabel(t);
  const { persen, totalTetap, melebihi } = lebarKolomPersen(t, kolom, MM, BARIS);
  cek('lewat 100%: melebihi = true', melebihi, { totalTetap, melebihi });
  cek('lewat 100%: totalTetap tetap angka asli (>150)', totalTetap > 150, totalTetap);
  cek('lewat 100%: hasil tetap muat 100%', dekat(jumlah(persen), 100), persen);
  cek('lewat 100%: nama dapat 8%', dekat(persen.nama, 8), persen.nama);
  cek(
    'lewat 100%: harga diskalakan faktor 92/totalTetap',
    dekat(persen.harga, (60 * 92) / totalTetap),
    { harga: persen.harga, harap: (60 * 92) / totalTetap },
  );
}

// 4. Nama juga fixed & total > 100% → semua kolom diskalakan pas 100%.
{
  const t = tpl({
    pengaturan_kolom: {
      nama: { lebar: 60, satuan_lebar: '%' },
      harga: { lebar: 50, satuan_lebar: '%' },
    },
  });
  const kolom = kolomAktifTabel(t);
  const { persen, totalTetap, melebihi } = lebarKolomPersen(t, kolom, MM, BARIS);
  cek('semua fixed: melebihi = true', melebihi, { totalTetap, melebihi });
  cek('semua fixed: jumlah = 100%', dekat(jumlah(persen), 100), persen);
}

// 5. Lebar tetap dalam mm → dikonversi dari lebar konten.
{
  const t = tpl({ pengaturan_kolom: { kode: { lebar: 30, satuan_lebar: 'mm' } } });
  const kolom = kolomAktifTabel(t);
  const { persen, totalTetap, melebihi } = lebarKolomPersen(t, kolom, MM, BARIS);
  const harap = (30 / MM) * 100;
  cek('mm→%: kode = 30 mm', dekat(persen.kode, harap), { kode: persen.kode, harap });
  cek('mm→%: jumlah = 100%, tidak melebihi', dekat(jumlah(persen), 100) && !melebihi, {
    totalTetap,
    melebihi,
  });
}

// 6. Blok kolom disembunyikan → tidak dihitung sama sekali.
{
  const t = tpl({ blok: { kolom_kode: false, kolom_diskon: false } });
  const kolom = kolomAktifTabel(t);
  const { persen, melebihi } = lebarKolomPersen(t, kolom, MM, BARIS);
  cek('blok mati: kode & diskon hilang', !('kode' in persen) && !('diskon' in persen), persen);
  cek('blok mati: jumlah = 100%', dekat(jumlah(persen), 100) && !melebihi, persen);
}

console.log(gagal === 0 ? '\nSEMUA LULUS' : `\nGAGAL: ${gagal}`);
process.exit(gagal === 0 ? 0 : 1);

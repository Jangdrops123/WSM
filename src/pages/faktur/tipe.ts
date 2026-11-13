// BAGIAN I — tipe bersama faktur: template, dokumen, ukuran kertas.

export type JenisTemplate = 'penjualan' | 'pembelian' | 'surat_jalan';

/** Pengaturan per kolom tabel item (BAGIAN K4). */
export interface AturKolom {
  /** Label ganti — kosong = pakai LABEL_KOLOM / singkatan. */
  nama?: string;
  /** Lebar tetap; null/absen = otomatis (rasio K2; nama menyerap sisa). */
  lebar?: number | null;
  satuan_lebar?: '%' | 'mm';
  /** Rata isi+header; kosong = otomatis per jenis kolom. */
  rata?: 'kiri' | 'tengah' | 'kanan';
}

export interface TemplateFaktur {
  id: number;
  nama: string;
  jenis: JenisTemplate;
  bawaan: boolean;
  kertas: string; // A4 | A5 | A6 | Letter | Legal | 58mm | 80mm | HalfA4 | custom
  orientasi: 'portrait' | 'landscape';
  lebar_mm: number | null;
  tinggi_mm: number | null;
  margin_atas: number;
  margin_kanan: number;
  margin_bawah: number;
  margin_kiri: number;
  skala: number; // % isi
  ukuran_font: number; // pt
  aksen: string; // heksadesimal
  blok: Record<string, boolean>;
  urutan_kolom: string[];
  teks: Record<string, string>;
  /** Per kolom: nama ganti, lebar (%/mm), rata — BAGIAN K4. */
  pengaturan_kolom?: Record<string, AturKolom>;
  /** 'auto' = kertas sempit → singkatan; 'ya' / 'tidak' = paksa. */
  singkat_kolom?: 'auto' | 'ya' | 'tidak';
}

export interface ItemFaktur {
  kode: string;
  nama: string;
  qty: number;
  satuan: string | null;
  harga: number;
  diskon: number;
  subtotal: number;
}

export interface FakturDTO {
  id: number;
  no_faktur: string;
  jenis: 'penjualan' | 'pembelian';
  tanggal: string;
  status: string;
  pihak: { nama: string | null; telepon: string | null; alamat: string | null };
  subtotal: number;
  diskon: number;
  pajak_persen: number;
  pajak: number;
  total: number;
  terbilang: string | null;
  catatan: string | null;
  sumber_tipe: string;
  sumber_id: number;
  no_sumber: string | null;
  /** Retur disahkan yang terkait dokumen sumber ini. */
  retur?: { id: number; no_dokumen: string; tanggal: string; total: number }[];
  /** Total setelah dikurangi seluruh retur (Net Amount). */
  total_net?: number;
}

export interface IsiFaktur {
  toko: { nama: string; alamat: string | null; telepon: string | null; logo: string | null };
  pihak: { nama: string | null; telepon: string | null; alamat: string | null };
  sumber: Record<string, unknown>;
  items: ItemFaktur[];
  no_dokumen: string;
}

/** Daftar ukuran kertas bawaan (mm) — sumber yang sama dengan server. */
export const KERTAS: Record<string, { lebar: number; tinggi: number; label: string }> = {
  A4: { lebar: 210, tinggi: 297, label: 'A4 (210 × 297 mm)' },
  A5: { lebar: 148, tinggi: 210, label: 'A5 (148 × 210 mm)' },
  A6: { lebar: 105, tinggi: 148, label: 'A6 (105 × 148 mm)' },
  Letter: { lebar: 215.9, tinggi: 279.4, label: 'Letter (216 × 279 mm)' },
  Legal: { lebar: 215.9, tinggi: 355.6, label: 'Legal (216 × 356 mm)' },
  '58mm': { lebar: 58, tinggi: 200, label: 'Struk termal 58 mm' },
  '80mm': { lebar: 80, tinggi: 200, label: 'Struk termal 80 mm' },
  HalfA4: { lebar: 279.4, tinggi: 215.9, label: 'Setengah A4 (continuous form 9.5" × 11")' },
  custom: { lebar: 210, tinggi: 297, label: 'Ukuran kustom' },
};

/** Ukuran akhir kertas (mm) setelah orientasi diperhitungkan. */
export function ukuranKertas(t: TemplateFaktur | null): { lebar: number; tinggi: number } {
  if (!t) return { lebar: 210, tinggi: 297 };
  if (t.kertas === 'custom') {
    const l = Number(t.lebar_mm) || 210;
    const t2 = Number(t.tinggi_mm) || 297;
    return t.orientasi === 'landscape' ? { lebar: t2, tinggi: l } : { lebar: l, tinggi: t2 };
  }
  const k = KERTAS[t.kertas] ?? KERTAS.A4;
  return t.orientasi === 'landscape'
    ? { lebar: k.tinggi, tinggi: k.lebar }
    : { lebar: k.lebar, tinggi: k.tinggi };
}

/** Label kolom tabel item (bisa diurutkan ulang di editor template). */
export const LABEL_KOLOM: Record<string, string> = {
  kode: 'Kode',
  nama: 'Nama Barang',
  qty: 'Jumlah',
  satuan: 'Satuan',
  harga: 'Harga',
  diskon: 'Diskon',
  subtotal: 'Subtotal',
};

/** Singkatan otomatis untuk kertas sempit (BAGIAN K3) — tidak boleh terpecah. */
export const LABEL_KOLOM_SINGKAT: Record<string, string> = {
  kode: 'Kode',
  nama: 'Barang',
  qty: 'Jml',
  satuan: 'Sat',
  harga: 'Harga',
  diskon: 'Disk',
  subtotal: 'Subtotal',
};

export const SEMUA_KOLOM = Object.keys(LABEL_KOLOM);

const URUTAN_BAWAAN = ['kode', 'nama', 'qty', 'satuan', 'harga', 'diskon', 'subtotal'];

/** Rasio lebar otomatis K2 (% dari lebar tabel) — nama barang menyerap sisa. */
export const RASIO_KOLOM: Record<string, number> = {
  kode: 13,
  qty: 8,
  satuan: 8,
  harga: 13,
  diskon: 13,
  subtotal: 13,
};

/** Rata otomatis per jenis kolom (teks kiri, angka kanan, satuan tengah). */
export const RATA_KOLOM: Record<string, 'kiri' | 'tengah' | 'kanan'> = {
  no: 'tengah',
  kode: 'kiri',
  nama: 'kiri',
  qty: 'kanan',
  satuan: 'tengah',
  harga: 'kanan',
  diskon: 'kanan',
  subtotal: 'kanan',
};

/** Lebar kolom "No" (px): sempit tetap, mengikuti jumlah digit. */
export function lebarNoPx(jumlahBaris: number): number {
  const digit = Math.max(1, String(Math.max(1, jumlahBaris)).length);
  return Math.max(28, 12 + digit * 8);
}

/**
 * Daftar kolom tabel setelah penyembunyian blok & penyaringan jenis dokumen
 * (Surat Jalan tanpa kolom harga — BAGIAN K5). Satu sumber untuk render,
 * colgroup, dan peringatan editor.
 */
export function kolomAktifTabel(t: TemplateFaktur | null): string[] {
  let kolom = (t?.urutan_kolom?.length ? t.urutan_kolom : URUTAN_BAWAAN).filter((k) => LABEL_KOLOM[k]);
  if (!blokAktif(t, 'kolom_kode', true)) kolom = kolom.filter((k) => k !== 'kode');
  if (!blokAktif(t, 'kolom_satuan', true)) kolom = kolom.filter((k) => k !== 'satuan');
  if (!blokAktif(t, 'kolom_diskon', true)) kolom = kolom.filter((k) => k !== 'diskon');
  if (t?.jenis === 'surat_jalan') kolom = kolom.filter((k) => !['harga', 'diskon', 'subtotal'].includes(k));
  if (kolom.length === 0) kolom = ['nama', 'qty'];
  return kolom;
}

/** Label kolom efektif: nama ganti → singkatan (bila aktif) → label penuh. */
export function labelKolom(t: TemplateFaktur | null, kunci: string, sempit: boolean): string {
  const ganti = t?.pengaturan_kolom?.[kunci]?.nama?.trim();
  if (ganti) return ganti;
  if (sempit && LABEL_KOLOM_SINGKAT[kunci]) return LABEL_KOLOM_SINGKAT[kunci];
  return LABEL_KOLOM[kunci] ?? kunci;
}

/**
 * Rasio lebar kolom efektif (persen). Kolom berlebar otomatis memakai rasio
 * K2; "No" dihitung dari digit baris; nama barang menyerap sisa (bila ada
 * lebar tetap untuk nama, sisanya dibagi rata ke kolom lain yang otomatis).
 */
export function lebarKolomPersen(
  t: TemplateFaktur | null,
  kolom: string[],
  lebarKontenMm: number,
  jumlahBaris: number,
): { persen: Record<string, number>; totalTetap: number; melebihi: boolean } {
  const pk = t?.pengaturan_kolom ?? {};
  const persen: Record<string, number> = {};
  const mmKePersen = (mm: number): number => (lebarKontenMm > 0 ? (mm / lebarKontenMm) * 100 : 0);

  persen['no'] = mmKePersen(lebarNoPx(jumlahBaris) * (25.4 / 96));
  let totalTetap = persen['no'];
  const otomatis: string[] = [];

  for (const k of kolom) {
    const atur = pk[k];
    if (atur?.lebar != null && atur.lebar > 0) {
      const p = atur.satuan_lebar === 'mm' ? mmKePersen(Number(atur.lebar)) : Number(atur.lebar);
      persen[k] = p;
      totalTetap += p;
    } else if (k === 'nama') {
      otomatis.push(k);
    } else {
      const p = RASIO_KOLOM[k] ?? 10;
      persen[k] = p;
      totalTetap += p;
    }
  }

  if (otomatis.includes('nama') && totalTetap < 100) {
    persen['nama'] = 100 - totalTetap;
    totalTetap = 100;
  } else if (otomatis.length > 0) {
    // Nama ikut lebar tetap → sisa dibagi rata ke kolom otomatis lain.
    const sisa = Math.max(0, 100 - totalTetap);
    for (const k of otomatis) {
      persen[k] = sisa / otomatis.length;
      totalTetap += persen[k];
    }
  }

  // Bila total melebihi kertas, skala semua kolom agar TETAP MUAT di lebar
  // halaman (nama menyisakan minimal 8%) — peringatan editor tetap menunjukkan
  // total asli agar pengguna memperbaiki pengaturannya.
  const melebihi = totalTetap >= 100.5;
  if (melebihi) {
    const adaNamaOtomatis = otomatis.includes('nama');
    const batasTetap = adaNamaOtomatis ? 92 : 100;
    const faktor = batasTetap / totalTetap;
    for (const k of Object.keys(persen)) {
      if (k === 'nama' && adaNamaOtomatis) continue;
      persen[k] = persen[k] * faktor;
    }
    if (adaNamaOtomatis) persen['nama'] = 100 - batasTetap;
    // totalTetap sengaja TIDAK diubah: peringatan editor harus menampilkan
    // jumlah asli dari pengaturan pengguna, bukan hasil penskalaan.
  }

  return { persen, totalTetap, melebihi };
}

/** Blok tampil/sembunyi — bila tidak disentuh, dianggap tampil. */
export function blokAktif(t: TemplateFaktur | null, kunci: string, bawaan = true): boolean {
  if (!t?.blok) return bawaan;
  return t.blok[kunci] !== undefined ? Boolean(t.blok[kunci]) : bawaan;
}

/**
 * Ringkasan kuantitas fisik seluruh item — mis. "32 Psg" bila satuannya sama,
 * atau "12 Psg / 10 Pcs" bila campuran. Null bila tidak ada qty > 0.
 */
export function teksTotalQty(items: ItemFaktur[]): string | null {
  const per = new Map<string, number>();
  let total = 0;
  for (const it of items) {
    const q = Number(it.qty) || 0;
    if (q <= 0) continue;
    total += q;
    const sat = (it.satuan ?? '').trim() || 'pcs';
    per.set(sat, (per.get(sat) ?? 0) + q);
  }
  if (total <= 0) return null;
  const angka = (n: number): string => n.toLocaleString('id-ID', { maximumFractionDigits: 3 });
  if (per.size === 1) return `${angka(total)} ${[...per.keys()][0]}`;
  return [...per.entries()].map(([sat, q]) => `${angka(q)} ${sat}`).join(' / ');
}

/** Tampilan angka & tanggal gaya Indonesia. */
export const rupiah = (n: number): string =>
  `Rp ${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;

export const tanggalPanjang = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso ?? '';
  return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
};

export const tanggalPendek = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso ?? '';
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

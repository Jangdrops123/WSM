// R2 — Periode tampil Riwayat & Dokumen (Pembelian/Penjualan).
// Satu pilihan (7 hari / 14 hari / 1 bulan / rentang tanggal) menyaring
// KEDUA bagian sekaligus: tabel transaksi atas + tabel dokumen bawah.

export type KodePeriode = '7' | '14' | '30' | 'rentang';

export const PILIHAN_PERIODE: { kode: KodePeriode; label: string }[] = [
  { kode: '7', label: '7 hari' },
  { kode: '14', label: '14 hari' },
  { kode: '30', label: '1 bulan' },
  { kode: 'rentang', label: '📅 Rentang tanggal' },
];

const fmtTanggal = (d: Date): string => {
  const tgl = String(d.getDate()).padStart(2, '0');
  const bln = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${bln}-${tgl}`;
};

/** Hari ini (zona lokal) dalam format YYYY-MM-DD. */
export function hariIni(): string {
  return fmtTanggal(new Date());
}

/** N hari ke belakang (inklusif hari ini): mundur(6) = 7 hari tampil. */
export function mundur(hari: number): string {
  const d = new Date();
  d.setDate(d.getDate() - hari);
  return fmtTanggal(d);
}

/**
 * Hitung {dari, sampai} dari pilihan periode.
 * Preset: sampai = hari ini, dari = mundur(n-1). Rentang: pakai input
 * pengguna (kosong = tanpa batas sisi itu).
 */
export function hitungRentang(
  periode: KodePeriode,
  dariInput: string,
  sampaiInput: string,
): { dari: string; sampai: string } {
  const valid = (s: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '');
  if (periode === 'rentang') return { dari: valid(dariInput), sampai: valid(sampaiInput) };
  const hari = periode === '14' ? 13 : periode === '30' ? 29 : 6;
  return { dari: mundur(hari), sampai: hariIni() };
}

const NAMA_BULAN = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
];

function pecah(iso: string): { t: string; b: string; th: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const b = NAMA_BULAN[Number(m[2]) - 1];
  if (!b) return null;
  return { t: String(Number(m[3])), b, th: m[1] };
}

/**
 * Label ringkas rentang: "15 Okt – 21 Okt 2026".
 * Bila sisi kosong (rentang terbuka) → "… – 21 Okt 2026" / sebaliknya.
 */
export function labelRentang(dari: string, sampai: string): string {
  const a = pecah(dari);
  const b = pecah(sampai);
  const kanan = b ? `${b.t} ${b.b} ${b.th}` : '…';
  if (!a) return `… – ${kanan}`;
  if (b && a.th === b.th && a.b === b.b) return `${a.t} – ${kanan}`;
  return `${a.t} ${a.b} ${a.th === (b?.th ?? '') ? '' : `${a.th} `}– ${kanan}`.replace('  ', ' ');
}
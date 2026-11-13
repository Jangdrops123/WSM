// Utilitas kodi — SATU-SATUNYA tempat perhitungan kodi/sisa/selisih.
// 1 kodi = isiPerKodi pcs (bawaan 20, bisa diubah di Pengaturan › Pembelian & Inbound).
// Semua qty PO/disimpan dalam PCS; fungsi ini hanya untuk tampilan & hitung.

export const ISI_KODI_BAWAAN = 20;

export function normalIsi(isi: unknown): number {
  const n = Math.floor(Number(isi));
  return Number.isFinite(n) && n > 0 ? n : ISI_KODI_BAWAAN;
}

/** pcs → { kodi, pcs }: 65 pcs @20 = 3 kodi 5 pcs. */
export function pecahKodi(totalPcs: number, isi = ISI_KODI_BAWAAN): { kodi: number; pcs: number } {
  const per = normalIsi(isi);
  const t = Math.max(0, Math.floor(Number(totalPcs) || 0));
  return { kodi: Math.floor(t / per), pcs: t % per };
}

/** kodi + pcs → pcs: 3 kodi 5 pcs @20 = 65 pcs. */
export function gabungKodi(kodi: number, pcs: number, isi = ISI_KODI_BAWAAN): number {
  const per = normalIsi(isi);
  return Math.max(0, Math.floor(Number(kodi) || 0)) * per + Math.max(0, Math.floor(Number(pcs) || 0));
}

/** "3 kodi 5 pcs" — bagian nol disembunyikan kecuali total 0 ("0 pcs"). */
export function formatKodi(totalPcs: number, isi = ISI_KODI_BAWAAN): string {
  const { kodi, pcs } = pecahKodi(totalPcs, isi);
  if (kodi === 0 && pcs === 0) return '0 pcs';
  const bagian: string[] = [];
  if (kodi > 0) bagian.push(`${kodi.toLocaleString('id-ID')} kodi`);
  if (pcs > 0) bagian.push(`${pcs.toLocaleString('id-ID')} pcs`);
  return bagian.join(' ');
}

/** "3,25 kodi" — desimal untuk ringkasan/laporan. */
export function formatKodiDesimal(totalPcs: number, isi = ISI_KODI_BAWAAN): string {
  const per = normalIsi(isi);
  const t = Math.max(0, Math.floor(Number(totalPcs) || 0));
  return `${(t / per).toLocaleString('id-ID', { maximumFractionDigits: 2 })} kodi`;
}

export type StatusPo = 'draft' | 'terkirim' | 'sebagian' | 'selesai' | 'selesai_kurang' | 'lebih' | 'kadaluwarsa' | 'batal';

export const LABEL_STATUS_PO: Record<StatusPo, string> = {
  draft: 'Draft',
  terkirim: 'Terkirim',
  sebagian: 'Sebagian',
  selesai: 'Selesai',
  selesai_kurang: 'Selesai Kurang',
  lebih: 'Ada Kelebihan',
  kadaluwarsa: 'Kadaluwarsa',
  batal: 'Dibatalkan',
};

export const KELAS_STATUS_PO: Record<StatusPo, string> = {
  draft: 'lencana--netral',
  terkirim: 'lencana--info',
  sebagian: 'lencana--peringatan',
  selesai: 'lencana--aktif',
  selesai_kurang: 'lencana--bahaya',
  lebih: 'lencana--peringatan',
  kadaluwarsa: 'lencana--peringatan',
  batal: 'lencana--netral',
};

/** Nilai filter bawaan: hanya PO aktif (draft ikut — masih butuh tindak lanjut). */
export const FILTER_PO_AKTIF = 'draft,terkirim,sebagian,lebih';
/** Nilai filter tab Selesai: semua status terminal (tersembunyi dari tampilan utama). */
export const FILTER_PO_TERMINAL = 'selesai,selesai_kurang,kadaluwarsa,batal';

/** true bila tenggat (ISO) sudah lewat hari ini — penanda manual, bukan tutup otomatis. */
export function lewatTenggat(tenggat: unknown): boolean {
  const s = String(tenggat ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const hariIni = new Date();
  const h = `${hariIni.getFullYear()}-${String(hariIni.getMonth() + 1).padStart(2, '0')}-${String(hariIni.getDate()).padStart(2, '0')}`;
  return s < h;
}

export interface ItemSisa {
  qty_pesan: number;
  total_datang: number;
}

/** sisa = max(0, pesan - datang); selisih = datang - pesan (+ = LEBIH, - = KURANG). */
export function hitungSisa(i: ItemSisa): { sisa: number; selisih: number; lebih: boolean; kurang: boolean } {
  const pesan = Math.max(0, Math.floor(Number(i.qty_pesan) || 0));
  const datang = Math.max(0, Math.floor(Number(i.total_datang) || 0));
  const selisih = datang - pesan;
  return { sisa: Math.max(0, pesan - datang), selisih, lebih: selisih > 0, kurang: datang < pesan };
}

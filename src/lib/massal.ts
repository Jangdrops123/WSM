// Utilitas aksi massal: batch per 100 + unduh daftar dilewati.

export const UKURAN_BATCH = 100;

export interface BarisDilewati {
  id?: number;
  nama: string;
  alasan: string;
}

/** Jalankan aksi per potongan (batch) berurutan; kembalikan respons tiap batch. */
export async function jalankanBertahap<R>(
  ids: number[],
  kirim: (potongan: number[]) => Promise<R>,
  onProgres?: (selesai: number, total: number) => void,
): Promise<R[]> {
  const hasil: R[] = [];
  for (let i = 0; i < ids.length; i += UKURAN_BATCH) {
    const potongan = ids.slice(i, i + UKURAN_BATCH);
    hasil.push(await kirim(potongan));
    onProgres?.(Math.min(i + UKURAN_BATCH, ids.length), ids.length);
  }
  return hasil;
}

/** Unduh daftar yang dilewati sebagai CSV (dibuka aman di Excel). */
export function unduhCsv(namaBerkas: string, kepala: string[], baris: string[][]): void {
  const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  const teks = [kepala, ...baris].map((r) => r.map(esc).join(';')).join('\r\n');
  const blob = new Blob([`\uFEFF${teks}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = namaBerkas;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Ambil semua id sesuai filter saat ini (melewati semua halaman). */
export async function ambilSemuaId(
  buatQ: (hal: number, per: number) => URLSearchParams,
  minta: (q: URLSearchParams) => Promise<{ data: readonly unknown[]; total: number }>,
): Promise<number[]> {
  const out: number[] = [];
  const per = 200;
  for (let hal = 1; hal <= 500; hal++) {
    const q = buatQ(hal, per);
    const r = await minta(q);
    out.push(...r.data.map((d) => Number((d as { id: number | string }).id)));
    if (hal * per >= r.total) break;
  }
  return out;
}

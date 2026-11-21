// BAGIAN I4 — aksi faktur: kirim WhatsApp, simpan PDF, cetak.
// Ketiganya tampil di dalam menu turun "Aksi faktur" (MenuAksi).

import { formatTanggalBulan } from '../../lib/format';

/** Normalkan nomor Indonesia ke kode negara 62 (wa.me). */
export function formatWa62(nomor: string): string {
  let n = String(nomor ?? '').replace(/[^0-9]/g, '');
  if (!n) return '';
  // Cek 620 lebih dulu: nomor ketik ganda "+62 08…" harus menjadi 628…,
  // bukan tetap 620… .
  if (n.startsWith('620')) n = `62${n.slice(3)}`;
  else if (n.startsWith('0')) n = `62${n.slice(1)}`;
  else if (n.startsWith('8')) n = `62${n}`;
  else if (n.startsWith('62')) n = `62${n.slice(2)}`;
  return n;
}

/** Nomor layak kirim bila punya 8+ digit setelah dinormalkan. */
export function nomorWaValid(nomor: string): boolean {
  return formatWa62(nomor).replace(/\D/g, '').length >= 9;
}

/** Tautan dokumen yang bisa dibuka penerima. */
export function tautanFaktur(id: number): string {
  const asal = typeof window === 'undefined' ? '' : window.location.origin;
  return `${asal}/dokumen/${id}`;
}

/** Isi pesan WhatsApp otomatis (nomor faktur, tanggal, total, tautan). */
export function pesanWaFaktur(
  faktur: { no_faktur: string; tanggal: string; total: number; id: number },
  namaToko = '',
): string {
  const tgl = formatTanggalBulan(faktur.tanggal);
  const baris = [
    namaToko ? `Halo, ${namaToko}!` : 'Halo,',
    '',
    `Berikut faktur *${faktur.no_faktur}* tanggal ${tgl} senilai Rp ${Math.round(faktur.total).toLocaleString('id-ID')}.`,
    `Tautan dokumen: ${tautanFaktur(faktur.id)}`,
    '',
    'Terima kasih.',
  ];
  return baris.join('\n');
}

/** Buka WhatsApp (wa.me) di tab baru. */
export function bukaWa(nomor: string, pesan: string): void {
  const n = formatWa62(nomor);
  const url = `https://wa.me/${n}?text=${encodeURIComponent(pesan)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Cetak / simpan PDF — memakai CSS @page sesuai ukuran kertas template,
 * sehingga "Print → Save as PDF" menghasilkan berkas dengan ukuran yang sama.
 */
export function cetakFaktur(): void {
  window.print();
}

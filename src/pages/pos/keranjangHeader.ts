// Jembatan ringan antara halaman POS dan tombol keranjang di header.
//
// Keranjang POS hidup di dalam komponen halaman (state lokal). Header hanya
// perlu mengetahui jumlah unit yang belum dibayar dan cara membuka laci
// keranjang tanpa mengubah state internal POS. Modul ini sengaja tanpa
// penyimpanan permanen: bila halaman POS ditutup, keranjangnya juga hilang.

const EVENT_JUMLAH = 'nusapos:pos-jumlah-keranjang';
const EVENT_BUKA = 'nusapos:pos-buka-keranjang';

let jumlah = 0;

/** Simpan jumlah unit terbaru dan beri tahu header (tanpa memicu render berlebih). */
export function setJumlahKeranjangPos(n: number): void {
  const baru = Math.max(0, Math.floor(Number(n) || 0));
  if (baru === jumlah) return;
  jumlah = baru;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<number>(EVENT_JUMLAH, { detail: baru }));
  }
}

export function bacaJumlahKeranjangPos(): number {
  return jumlah;
}

/** Berlangganan perubahan jumlah; mengembalikan fungsi pelepas. */
export function pantauJumlahKeranjangPos(fn: (n: number) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const dengar = (e: Event) => fn(Number((e as CustomEvent<number>).detail) || 0);
  window.addEventListener(EVENT_JUMLAH, dengar);
  return () => window.removeEventListener(EVENT_JUMLAH, dengar);
}

/** Minta halaman POS membuka laci keranjang/pembayaran. */
export function mintaBukaKeranjangPos(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(EVENT_BUKA));
  }
}

/** Nama event untuk komponen POS yang mendengarkan permintaan buka laci. */
export const EVENT_BUKA_KERANJANG_POS = EVENT_BUKA;

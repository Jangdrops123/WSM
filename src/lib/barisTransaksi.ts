/**
 * Utilitas bersama tabel transaksi (Buat PO, Pembelian, POS, Item Masuk/Keluar,
 * Retur): menjaga baris yang sedang diisi tetap terlihat di dalam wadah gulir
 * tabel, tanpa menyentuh perhitungan subtotal/diskon/total.
 *
 * Dipasang sekali lewat `pasangGulirQtyOtomatis()` di AppLayout sehingga semua
 * input Qty (`name="qty"` atau `data-qty`) di aplikasi otomatis menggulir
 * barisnya ke area pandang ketika menerima fokus — baik fokus dari Enter pada
 * pencarian, panah ↑/↓, Tab, maupun klik.
 */

/** Kelas penanda wadah baris non-tabel (mis. kartu keranjang POS Foto). */
export const KELAS_BARIS_TRANSAKSI = 'baris-transaksi';

/** Baris pemilik sebuah elemen: <tr> tabel, atau kartu keranjang POS. */
function barisDari(el: Element): HTMLElement | null {
  return (el.closest('tr') ?? el.closest('.pos-baris') ?? el.closest('.pos-item') ?? el.parentElement) as
    | HTMLElement
    | null;
}

/**
 * Gulir wadah tabel ke baris pemilik `el`.
 * `block: 'nearest'` = hanya bergeser bila baris memang di luar pandangan,
 * sehingga header sticky tidak terlewati dan tampilan tidak melompat.
 */
export function gulirKeBaris(el: Element | null | undefined): void {
  if (!el) return;
  const baris = barisDari(el);
  baris?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
}

/**
 * Gulir baris pemilik `el` DI DALAM wadah gulirnya sendiri (`.tabel-bungkus`)
 * dengan mulus, tanpa menggeser gulir jendela/halaman. Dipakai tabel Purchase
 * agar perpindahan fokus terasa estafet dan footer tetap di tempatnya.
 */
export function gulirBarisDalamWadah(el: Element | null | undefined): void {
  if (!el) return;
  const baris = el.closest('tr') as HTMLElement | null;
  const wadah = baris?.closest('.tabel-bungkus') as HTMLElement | null;
  if (!baris || !wadah) {
    gulirKeBaris(el);
    return;
  }
  const kepala = (wadah.querySelector('thead th') as HTMLElement | null)?.offsetHeight ?? 0;
  const kotakWadah = wadah.getBoundingClientRect();
  const kotakBaris = baris.getBoundingClientRect();
  const atasBatas = kotakWadah.top + kepala;
  if (kotakBaris.top < atasBatas) {
    wadah.scrollTo({ top: wadah.scrollTop - (atasBatas - kotakBaris.top) - 4, behavior: 'smooth' });
  } else if (kotakBaris.bottom > kotakWadah.bottom) {
    wadah.scrollTo({ top: wadah.scrollTop + (kotakBaris.bottom - kotakWadah.bottom) + 4, behavior: 'smooth' });
  }
}

/** Fokus + blok isi input Qty, lalu gulir barisnya ke area pandang. */
export function fokusQty(el: HTMLInputElement | null | undefined): void {
  if (!el) return;
  el.focus();
  el.select();
  gulirKeBaris(el);
}

/** Input yang dianggap "kolom Qty" untuk keperluan auto-scroll. */
function inputQty(el: EventTarget | null): HTMLInputElement | null {
  const target = el as HTMLElement | null;
  if (!target || target.tagName !== 'INPUT') return null;
  if (target.getAttribute('name') === 'qty' || target.hasAttribute('data-qty')) {
    return target as HTMLInputElement;
  }
  return null;
}

/**
 * Pasang handler global `focusin`: setiap input Qty yang menerima fokus
 * menggulir barisnya. Mengembalikan fungsi pembersih untuk efek React.
 */
export function pasangGulirQtyOtomatis(): () => void {
  const saatFokus = (e: FocusEvent) => {
    const el = inputQty(e.target);
    if (el) gulirKeBaris(el);
  };
  document.addEventListener('focusin', saatFokus);
  return () => document.removeEventListener('focusin', saatFokus);
}

/**
 * Label otomatis sel tabel untuk kartu ponsel (melengkapi DataTable).
 *
 * Aturan kartu generik `.tabel:has(thead th:nth-child(5))` di crud.css memakai
 * `data-label` tiap sel sebagai judul kotak. DataTable sudah mengisi labelnya
 * sendiri; modul ini mengisi sisanya (tabel bespoke: akuntansi, transfer,
 * persediaan, faktur, laporan, pengaturan, …) dari teks judul kolom thead.
 *
 * - Hanya mengisi sel yang BELUM berlabel; tidak menimpa label manual.
 * - Melewati tabel ber-header gabung (colspan/rowspan) agar tak salah label.
 * - Melewati sel gabung badan (colspan: baris kosong) — sudah ditangani CSS.
 * - Aman di desktop: tidak ada aturan di atas 767.98px yang memakai data-label.
 * - Sekali pasang: MutationObserver melabeli baris yang datang belakangan
 *   (data async) tanpa perlu diubah tiap halaman.
 */

function judulKolom(tabel: HTMLTableElement): string[] | null {
  const barisKepala = tabel.querySelectorAll('thead tr');
  if (barisKepala.length === 0) return null;
  // Baris header paling bawah (paling dekat ke badan) = label kolom sebenarnya.
  const baris = barisKepala[barisKepala.length - 1];
  const judul: string[] = [];
  for (const sel of Array.from(baris.children)) {
    if (!(sel instanceof HTMLTableCellElement)) return null;
    if (sel.colSpan > 1 || sel.rowSpan > 1) return null;
    judul.push((sel.textContent ?? '').replace(/\s+/g, ' ').trim());
  }
  return judul;
}

function labeliTabel(tabel: HTMLTableElement): void {
  const judul = judulKolom(tabel);
  if (!judul) return;
  for (const baris of Array.from(tabel.querySelectorAll('tbody tr'))) {
    Array.from(baris.children).forEach((sel, i) => {
      if (!(sel instanceof HTMLTableCellElement)) return;
      if (sel.hasAttribute('data-label')) return;
      if (sel.colSpan > 1) return;
      const label = judul[i] ?? '';
      if (label) sel.setAttribute('data-label', label);
    });
  }
}

function labeliAkar(akar: ParentNode): void {
  if (akar instanceof HTMLTableElement) {
    if (akar.classList.contains('tabel')) labeliTabel(akar);
    return;
  }
  const tanya = (akar as Element).querySelectorAll;
  if (typeof tanya !== 'function') return;
  for (const t of Array.from(tanya.call(akar, 'table.tabel'))) {
    if (t instanceof HTMLTableElement) labeliTabel(t);
  }
}

let terpasang = false;

/** Dipanggil sekali dari AppLayout; aman dipanggil ulang (no-op). */
export function pasangLabelTabelOtomatis(): void {
  if (typeof document === 'undefined' || terpasang) return;
  terpasang = true;
  labeliAkar(document);
  const pantau = new MutationObserver((mutasi) => {
    for (const m of mutasi) {
      for (const node of Array.from(m.addedNodes)) {
        if (!(node instanceof HTMLElement)) continue;
        // Baris yang ditambahkan langsung (data async): labeli tabel induknya.
        const induk = node.closest?.('table.tabel');
        if (induk instanceof HTMLTableElement) labeliTabel(induk);
        else labeliAkar(node);
      }
    }
  });
  pantau.observe(document.body, { childList: true, subtree: true });
}

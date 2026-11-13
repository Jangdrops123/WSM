// Pengkode Code 39 (tabel pola bit resmi) → SVG untuk cetak label/barcode.
// 0 = narrow (1 unit), 1 = wide (3 unit); 9 elemen berselang bar/space.

const POLA: Record<string, string> = {
  '0': '000110100', '1': '100100001', '2': '001100001', '3': '101100000',
  '4': '000110001', '5': '100110000', '6': '001110000', '7': '000100101',
  '8': '100100100', '9': '001100100', A: '100001001', B: '001001001',
  C: '101001000', D: '000011001', E: '100011000', F: '001011000',
  G: '000001101', H: '100001100', I: '001001100', J: '000011100',
  K: '100000011', L: '001000011', M: '101000010', N: '000010011',
  O: '100010010', P: '001010010', Q: '000000111', R: '100000110',
  S: '001000110', T: '000010110', U: '110000001', V: '011000001',
  W: '111000000', X: '010010001', Y: '110010000', Z: '011010000',
  '-': '010000101', '.': '110000100', ' ': '011000100', $: '010101000',
  '/': '010100010', '+': '010001010', '%': '000101010', '*': '010010100',
};

/** Buat SVG barcode Code 39 untuk teks (karakter tak sah diganti '-'). */
export function code39Svg(teks: string, tinggi = 40, skala = 2): string {
  const bersih = String(teks ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z\-. $/+%]/g, '-');
  const urut = ['*', ...bersih.split(''), '*'];
  const rects: string[] = [];
  let x = 0;
  for (const ch of urut) {
    const pola = POLA[ch] ?? POLA['-'];
    for (let i = 0; i < 9; i++) {
      const lebar = (pola[i] === '1' ? 3 : 1) * skala;
      if (i % 2 === 0) rects.push(`<rect x="${x}" y="0" width="${lebar}" height="${tinggi}" fill="#000"/>`);
      x += lebar;
    }
    x += skala; // jarak antar karakter
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${x}" height="${tinggi}" viewBox="0 0 ${x} ${tinggi}" role="img" aria-label="Barcode ${bersih}">${rects.join('')}</svg>`;
}

/** Cetak HTML lewat iframe tersembunyi (tanpa memblokir jendela aplikasi). */
export function cetakHtml(judul: string, isi: string, gaya: string): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;visibility:hidden;';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${judul}</title><style>@page{margin:8mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;margin:0;padding:2mm}${gaya}</style></head><body>${isi}</body></html>`,
  );
  doc.close();
  const w = frame.contentWindow;
  w?.focus();
  w?.print();
  setTimeout(() => frame.remove(), 120_000);
}

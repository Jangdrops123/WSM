// BAGIAN J3/J4 — cetak/simpan/kirim struk POS sesuai profil aktif.
// Satu sumber kebenaran HTML struk dipakai untuk: pratinjau layar (iframe),
// window.print (@page sesuai ukuran kertas), dan "Save as PDF" (judul jendela
// = STRUK-<nomor>-<tanggal> sehingga nama berkas ikut terekam browser).

export interface StrukItem {
  nama: string;
  /** SKU / kode item — tampil bila blok "kode_item" aktif. */
  kode?: string | null;
  qty: number;
  harga: number;
  jumlah: number;
}

export interface StrukData {
  namaUsaha: string;
  alamatUsaha?: string | null;
  teleponUsaha?: string | null;
  logoUrl?: string | null;
  noDokumen: string;
  tanggal: string;
  kasir: string;
  pelanggan: string | null;
  items: StrukItem[];
  subtotal: number;
  diskon: number;
  pajak: number;
  total: number;
  bayar: { metode: string; jumlah: number }[];
  kembalian: number;
  catatan?: string | null;
  /** Nomor WhatsApp pelanggan dari master — default dialog kirim struk. */
  pelangganTelepon?: string | null;
  /** Faktur otomatis (BAGIAN I) — dipakai ikon aksi di dialog sukses. */
  fakturId?: number | null;
  noFaktur?: string | null;
}

/** Profil ukuran struk (BAGIAN J4) — disimpan di tabel struk_profil. */
export interface ProfilStruk {
  id?: number;
  nama?: string;
  bawaan?: boolean;
  /** 58mm | 80mm | A4 | A5 | A6 | custom */
  kertas: string;
  /** Hanya untuk kertas = custom. */
  lebar_mm?: number | null;
  /** NULL = otomatis (thermal mengikuti isi struk). */
  tinggi_mm?: number | null;
  margin_atas: number;
  margin_kanan: number;
  margin_bawah: number;
  margin_kiri: number;
  ukuran_font: number;
  blok: Record<string, boolean>;
  teks: Record<string, string>;
}

const KERTAS_MM: Record<string, { lebar: number; tinggi: number | 'otomatis' }> = {
  '58mm': { lebar: 58, tinggi: 'otomatis' },
  '80mm': { lebar: 80, tinggi: 'otomatis' },
  A4: { lebar: 210, tinggi: 297 },
  A5: { lebar: 148, tinggi: 210 },
  A6: { lebar: 105, tinggi: 148 },
};

/** Blok diaktifkan bila tidak disentuh profil (kecuali yang memang opsional). */
export function blokStruk(p: ProfilStruk | null, kunci: string, bawaan = true): boolean {
  if (!p?.blok) return bawaan;
  return p.blok[kunci] !== undefined ? Boolean(p.blok[kunci]) : bawaan;
}

/** Profil bawaan dipakai bila server belum menjawab / kasir belum memilih. */
export const PROFIL_STRUK_BAWAAN: ProfilStruk = {
  kertas: '80mm',
  lebar_mm: null,
  tinggi_mm: null,
  margin_atas: 3,
  margin_kanan: 2,
  margin_bawah: 3,
  margin_kiri: 2,
  ukuran_font: 11,
  blok: {},
  teks: { catatan_kaki: 'Terima kasih atas kunjungan Anda' },
};

/** Ukuran kertas efektif profil (mm). */
export function ukuranStruk(p: ProfilStruk | null): { lebar: number; tinggi: number | 'otomatis' } {
  const k = p?.kertas ?? '80mm';
  if (k === 'custom') {
    return { lebar: Number(p?.lebar_mm ?? 80), tinggi: p?.tinggi_mm ? Number(p.tinggi_mm) : 'otomatis' };
  }
  return KERTAS_MM[k] ?? KERTAS_MM['80mm'];
}

const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const rupiah = (n: number): string => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

/* ------------------------- Code39 (blok QR/barcode) ---------------------- */
// Encoder Code 39 murni (tanpa pustaka): 43 karakter + start/stop '*'.
const CODE39: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw', E: 'wnnnwwnnn',
  F: 'nnwnwwnnn', G: 'nnnnnwwnw', H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn',
  K: 'wnnnnnnww', L: 'nnwnnnnww', M: 'wnwnnnnwn', N: 'nnnnwnnww', O: 'wnnnwnnwn',
  P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn', S: 'nnwnnnwwn', T: 'nnnnwnwwn',
  U: 'wwnnnnnnw', V: 'nwwnnnnnw', W: 'wwwnnnnnn', X: 'nwnnwnnnw', Y: 'wwnnwnnnn',
  Z: 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '$': 'nwnwnwnnn',
  '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn', '*': 'nwnnwnwnn',
};

/** SVG Code39 untuk teks (huruf besar/angka). Teks tak dikenal diabaikan. */
export function barcodeSvg(teks: string, tinggi = 34): string {
  const bersih = String(teks ?? '').toUpperCase().replace(/[^0-9A-Z\-. $/+%*]/g, '');
  if (!bersih) return '';
  const sempit = 2;
  const lebar = 5;
  const pola = `*${bersih}*`.split('').map((c) => CODE39[c] ?? '').filter(Boolean);
  if (pola.length === 0) return '';
  let x = 0;
  const rects: string[] = [];
  pola.forEach((p, i) => {
    for (let j = 0; j < 9; j++) {
      const w = p[j] === 'w' ? lebar : sempit;
      if (j % 2 === 0) rects.push(`<rect x="${x}" y="0" width="${w}" height="${tinggi}" />`);
      x += w;
    }
    if (i < pola.length - 1) x += sempit; // jarak antar karakter
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${x}" height="${tinggi}" viewBox="0 0 ${x} ${tinggi}" fill="#000" role="img" aria-label="Barcode ${esc(teks)}">${rects.join('')}</svg>`;
}

/* ------------------------- Dokumen HTML struk ---------------------------- */

export interface OpsiHtmlStruk {
  /** Sisipkan skrip auto-print (jendela cetak). Pratinjau layar = false. */
  autoCetak?: boolean;
  /** Judul dokumen — di browser menjadi nama berkas default "Save as PDF". */
  judul?: string;
}

/** HTML lengkap struk sesuai profil — dipakai cetak, PDF, dan pratinjau. */
export function htmlStruk(d: StrukData, p: ProfilStruk | null, opsi: OpsiHtmlStruk = {}): string {
  const profil = p ?? PROFIL_STRUK_BAWAAN;
  const ukur = ukuranStruk(profil);
  // Font proporsional per kertas bila profil tidak menentukan ukuran font:
  // 58mm ≈ 10px, 80mm ≈ 12px, A5/A4 ≈ 11px (lebar penuh area cetak).
  const fontBawaan = ukur.lebar <= 60 ? 10 : ukur.lebar <= 85 ? 12 : 11;
  const font = Math.max(6, Number(profil.ukuran_font) || fontBawaan);
  const marjin = {
    atas: Number(profil.margin_atas) || 0,
    kanan: Number(profil.margin_kanan) || 0,
    bawah: Number(profil.margin_bawah) || 0,
    kiri: Number(profil.margin_kiri) || 0,
  };
  // Kertas lebar (A5/A4): beri napas minimal 10mm agar tidak terpotong tepi.
  const lebarKertas = ukur.lebar > 100;
  const m = lebarKertas
    ? {
        atas: Math.max(10, marjin.atas),
        kanan: Math.max(10, marjin.kanan),
        bawah: Math.max(10, marjin.bawah),
        kiri: Math.max(10, marjin.kiri),
      }
    : marjin;
  const ukurBaris = ukur.lebar <= 60 ? 'sangat-ramping' : ukur.lebar <= 85 ? 'ramping' : 'lebar';

  const baris = d.items
    .map((it) => {
      const kode = blokStruk(profil, 'kode_item', true) && it.kode ? `<span class="k">${esc(it.kode)}</span> ` : '';
      return `
      <div class="i">${kode}${esc(it.nama)}</div>
      <div class="r"><span>${it.qty} × ${rupiah(it.harga)}</span><span>${rupiah(it.jumlah)}</span></div>`;
    })
    .join('');

  const bayar = blokStruk(profil, 'metode_bayar', true)
    ? d.bayar.map((b) => `<div class="r"><span>${esc(b.metode.toUpperCase())}</span><span>${rupiah(b.jumlah)}</span></div>`).join('')
    : '';

  const logo =
    blokStruk(profil, 'logo', true) && d.logoUrl
      ? `<div class="c"><img src="${esc(d.logoUrl)}" alt="" style="max-height:14mm;max-width:100%" /></div>`
      : '';
  const namaToko = blokStruk(profil, 'nama_toko', true) ? `<div class="c b besar">${esc(d.namaUsaha)}</div>` : '';
  const alamat = blokStruk(profil, 'alamat', true) && d.alamatUsaha ? `<div class="c">${esc(d.alamatUsaha)}</div>` : '';
  const telepon = blokStruk(profil, 'telepon', true) && d.teleponUsaha ? `<div class="c">Telp: ${esc(d.teleponUsaha)}</div>` : '';
  const kasir = blokStruk(profil, 'kasir', true) ? `<div class="r"><span>Kasir</span><span>${esc(d.kasir)}</span></div>` : '';
  const pelanggan = blokStruk(profil, 'pelanggan', true) && d.pelanggan ? `<div class="r"><span>Pelanggan</span><span>${esc(d.pelanggan)}</span></div>` : '';
  const barisDiskon = blokStruk(profil, 'diskon', true) && d.diskon ? `<div class="r"><span>Diskon</span><span>−${rupiah(d.diskon)}</span></div>` : '';
  const barisPajak = blokStruk(profil, 'pajak', true) && d.pajak ? `<div class="r"><span>Pajak</span><span>${rupiah(d.pajak)}</span></div>` : '';
  const barisKembalian = blokStruk(profil, 'kembalian', true) ? `<div class="r"><span>Kembalian</span><span>${rupiah(d.kembalian)}</span></div>` : '';
  const catatanKaki = blokStruk(profil, 'catatan_kaki', true)
    ? `<div class="c">${esc(profil.teks?.['catatan_kaki'] ?? 'Terima kasih atas kunjungan Anda')}</div>`
    : '';
  const qr = blokStruk(profil, 'qr', true)
    ? `<div class="c barcode">${barcodeSvg(d.noDokumen)}<div class="bc-teks">${esc(d.noDokumen)}</div></div>`
    : '';
  const catatanTransaksi = d.catatan ? `<div class="hr"></div><div class="m">${esc(d.catatan)}</div>` : '';
  const noFaktur = d.noFaktur ? `<div class="c">Faktur: ${esc(d.noFaktur)}</div>` : '';

  const tinggiPage = ukur.tinggi === 'otomatis' ? 'auto' : `${ukur.tinggi}mm`;

  return `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><title>${esc(opsi.judul ?? `Struk ${d.noDokumen}`)}</title>
<style>
  @page { size: ${ukur.lebar}mm ${tinggiPage}; margin: 0; }
  :root { --receipt-paper-width: ${ukur.lebar}mm; --receipt-font: ${font}px; }
  * { box-sizing: border-box; }
  html { background: #fff; }
  /* Struk selalu di tengah halaman; warna tetap hitam-putih walau aplikasi
     memakai Mode Malam. */
  html, body { margin: 0; padding: 0; width: 100%; background: #fff; color: #000; }
  body { display: flex; justify-content: center; align-items: flex-start;
         font-family: 'Courier New', ui-monospace, monospace; font-size: var(--receipt-font);
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .receipt-wrapper {
    width: 100%;
    max-width: var(--receipt-paper-width, 80mm);
    margin: 0 auto;
    padding: ${m.atas}mm ${m.kanan}mm ${m.bawah}mm ${m.kiri}mm;
    background: #fff;
    color: #000;
  }
  .no-print { display: none !important; }
  /* Jangan memotong ringkasan total, garis, atau barcode di batas halaman. */
  .tot, .hr, .barcode, .ttd, .catatan-kaki { break-inside: avoid; page-break-inside: avoid; }
  .c { text-align: center; } .b { font-weight: bold; } .besar { font-size: ${(font * 1.3).toFixed(1)}px; letter-spacing: .5px; }
  .k { color: #444; font-size: ${(font * 0.85).toFixed(1)}px; }
  .hr { border-top: 1px dashed #000; margin: 2px 0; }
  /* Kolom qty/harga/subtotal sejajar; nama item membungkus baris bila panjang
     (BAGIAN K — angka tidak pernah turun baris; teks memecah mengikuti kata). */
  .r { display: flex; justify-content: space-between; gap: 6px; }
  .r > span { white-space: nowrap; }
  .r > span:last-child { text-align: right; }
  .i { word-break: normal; overflow-wrap: break-word; padding-left: 2px; }
  .k { white-space: nowrap; }
  .tot { font-weight: bold; font-size: ${(font * 1.15).toFixed(1)}px; }
  .m { word-break: normal; overflow-wrap: break-word; }
  .barcode { margin-top: 2px; }
  .barcode svg { max-width: 100%; height: auto; }
  .bc-teks { font-size: ${(font * 0.8).toFixed(1)}px; letter-spacing: 1px; }
  @media print {
    @page { margin: 0 auto; }
    html, body { width: 100% !important; margin: 0 !important; padding: 0 !important;
                 display: flex; justify-content: center; align-items: flex-start; }
    .receipt-wrapper { margin: 0 auto !important; width: 100% !important;
                       max-width: var(--receipt-paper-width, 80mm); }
    .no-print { display: none !important; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style></head>
<body class="${ukurBaris}">
<div class="receipt-wrapper">
  ${logo}${namaToko}${alamat}${telepon}
  <div class="c b">${esc(d.noDokumen)}</div>
  <div class="c">${esc(d.tanggal)}</div>
  <div class="hr"></div>
  ${kasir}${pelanggan}
  <div class="hr"></div>
  <div class="m" style="width:100%">${baris}</div>
  <div class="hr"></div>
  <div class="r"><span>Subtotal</span><span>${rupiah(d.subtotal)}</span></div>
  ${barisDiskon}${barisPajak}
  <div class="r tot"><span>TOTAL</span><span>${rupiah(d.total)}</span></div>
  ${bayar}${barisKembalian}
  ${noFaktur}
  ${catatanTransaksi}
  <div class="hr"></div>
  ${catatanKaki}
  ${qr}
</div>
  ${opsi.autoCetak ? `<script>window.addEventListener('load', function () { window.focus(); window.print(); });<\/script>` : ''}
</body></html>`;
}

/** Nama berkas unduhan: STRUK-<nomor>-<tanggal>.pdf (judul jendela cetak). */
export function namaFileStruk(d: StrukData): string {
  const t = new Date();
  const tgl = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  return `STRUK-${d.noDokumen}-${tgl}`;
}

/** Buka jendela cetak struk (@page sesuai profil; tanpa header/footer browser). */
export function cetakStruk(d: StrukData, p: ProfilStruk | null): void {
  const w = window.open('', '_blank', 'width=460,height=720');
  if (!w) throw new Error('Popup cetak diblokir — izinkan popup untuk mencetak struk.');
  w.document.open();
  w.document.write(htmlStruk(d, p, { autoCetak: true, judul: namaFileStruk(d) }));
  w.document.close();
}

/**
 * Simpan struk sebagai PDF: dialog cetak browser (Save as PDF) — nama berkas
 * mengikuti judul jendela (STRUK-<nomor>-<tanggal>).
 */
export function simpanStrukPdf(d: StrukData, p: ProfilStruk | null): void {
  cetakStruk(d, p);
}

/** HTML pratinjau layar (tanpa skrip cetak) untuk iframe. */
export function pratinjauStruk(d: StrukData, p: ProfilStruk | null): string {
  return htmlStruk(d, p, { autoCetak: false, judul: `Pratinjau ${d.noDokumen}` });
}



/** Isi pesan WhatsApp struk (nama toko, nomor, tanggal, total, tautan dokumen). */
export function pesanWaStruk(d: StrukData, tautan = ''): string {
  const baris = [
    `Halo, berikut struk *${d.noDokumen}* dari ${d.namaUsaha}.`,
    `Tanggal: ${d.tanggal}`,
    `Total: ${rupiah(d.total)}`,
  ];
  if (tautan) baris.push(`Tautan dokumen: ${tautan}`);
  baris.push('', 'Terima kasih.');
  return baris.join('\n');
}

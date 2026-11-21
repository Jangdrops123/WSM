// Mesin dokumen Ekspor PDF — murni fungsi (tanpa React & tanpa CSS modul)
// sehingga pratinjau layar, cetak peramban (Save as PDF), dan skrip uji
// semuanya memakai SATU sumber tata letak yang sama.
import { kolomProduk, type KolomProduk } from './kolomProduk';

export const PX_PER_MM = 96 / 25.4;

export const KERTAS: Record<string, { lebar: number; tinggi: number; label: string; css: string }> = {
  A4: { lebar: 210, tinggi: 297, label: 'A4 (210 × 297 mm)', css: 'A4' },
  A5: { lebar: 148, tinggi: 210, label: 'A5 (148 × 210 mm)', css: 'A5' },
  Letter: { lebar: 215.9, tinggi: 279.4, label: 'Letter (216 × 279 mm)', css: 'letter' },
  Legal: { lebar: 215.9, tinggi: 355.6, label: 'Legal (216 × 356 mm)', css: 'legal' },
};

export type Template = 'laporan' | 'ringkas' | 'katalog';
export type Orientasi = 'potret' | 'lanskap';

export interface Toko {
  nama: string;
  alamat: string;
  telepon: string;
  logo: string;
}

export interface OpsiDokumen {
  template: Template;
  ukuran: string;
  orientasi: Orientasi;
  kop: boolean;
  kartuRingkasan: boolean;
  kelompok: boolean;
  tandaTangan: boolean;
  nomorHalaman: boolean;
  margin: number;
  kolomKey: string[];
  judul: string;
  toko: Toko;
  totalBaris: number;
}

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

function nilaiTeks(key: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (key.startsWith('harga_')) return rupiah(Number(v));
  const k = kolomProduk(key);
  if (k.angka) return Number(v).toLocaleString('id-ID', { maximumFractionDigits: 2 });
  return String(v);
}

/** CSS dokumen — dipakai pratinjau layar DAN cetak (Save as PDF). */
export function gayaDokumen(o: Pick<OpsiDokumen, 'ukuran' | 'orientasi' | 'margin'>): string {
  const k = KERTAS[o.ukuran] ?? KERTAS.A4;
  const sisi = o.orientasi === 'lanskap' ? 'landscape' : 'portrait';
  return `
@page { size: ${k.css} ${sisi}; margin: 0; }
.dok { font-family: Arial, Helvetica, sans-serif; font-size: 9pt; line-height: 1.45; color: #111827; padding: ${o.margin}mm; }
.dok * { box-sizing: border-box; }
.kop { display: flex; align-items: center; gap: 10px; border-bottom: 2.5px solid #111827; padding-bottom: 7px; margin-bottom: 10px; }
.kop img { width: 46px; height: 46px; object-fit: contain; flex: 0 0 auto; }
.kop .inisial { width: 46px; height: 46px; flex: 0 0 auto; border-radius: 8px; background: #111827; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 17px; font-weight: 800; letter-spacing: .5px; }
.kop .kop-teks { min-width: 0; }
.kop h1 { margin: 0; font-size: 16pt; letter-spacing: .4px; text-transform: uppercase; }
.kop p { margin: 2px 0 0; font-size: 8.5pt; color: #475569; }
.judul { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin-bottom: 9px; }
.judul h2 { margin: 0; font-size: 12.5pt; text-transform: uppercase; letter-spacing: 1px; }
.judul .meta { text-align: right; font-size: 8pt; color: #475569; }
.ringkas { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; margin-bottom: 11px; }
.ringkas > div { border: 1px solid #cbd5e1; border-radius: 6px; padding: 7px 9px; }
.ringkas span { display: block; font-size: 7.5pt; color: #64748b; text-transform: uppercase; letter-spacing: .04em; }
.ringkas strong { font-size: 12pt; font-variant-numeric: tabular-nums; }
table.tabel { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
table.tabel th, table.tabel td { border: 1px solid #cbd5e1; padding: 3px 5px; text-align: left; }
table.tabel thead th { background: #e2e8f0; font-weight: 700; font-size: 8pt; }
table.tabel td.angka, table.tabel th.angka { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
table.tabel tbody tr.belang td { background: #f8fafc; }
tr.grup td { background: #111827 !important; color: #fff !important; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; font-size: 8pt; }
tr.grup td b { float: right; font-weight: 400; opacity: .75; }
.ttd { display: flex; justify-content: flex-end; gap: 26px; margin-top: 16px; }
.ttd > div { width: 46mm; text-align: center; font-size: 8.5pt; }
.ttd .ttd-isi { margin-top: 18mm; border-top: 1px solid #111827; padding-top: 3px; }
.ttd .ttd-nama { font-weight: 700; }
.footer { margin-top: 11px; padding-top: 5px; border-top: 1px dashed #cbd5e1; display: flex; justify-content: space-between; gap: 12px; font-size: 7.5pt; color: #64748b; }
.katalog { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; }
.katalog .item { border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px; text-align: center; page-break-inside: avoid; }
.katalog .foto { height: 26mm; border-radius: 4px; background: #f1f5f9; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 7.5pt; overflow: hidden; }
.katalog .foto img { width: 100%; height: 100%; object-fit: contain; }
.katalog .item strong { display: block; margin-top: 4px; font-size: 8pt; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.katalog .item small { display: block; font-size: 7pt; color: #64748b; }
@media print {
  .katalog .item, .ttd { page-break-inside: avoid; }
  thead { display: table-header-group; }
  .footer .hal b { display: none; }
  .footer .hal::after { content: counter(page) " dari " counter(pages); }
}
`;
}

/** URL foto produk (fallback: placeholder abu-abu). */
function urlFoto(r: Record<string, unknown>): string {
  const f = String(r.nama_file_foto ?? '').trim();
  if (!f) return '';
  if (/^(https?:|\/)/.test(f)) return f;
  return `/uploads/produk/${f}`;
}

/** Tiga kartu ringkasan di bawah judul laporan. */
export function kartuRingkas(
  rows: Record<string, unknown>[],
  total: number,
  kolom: KolomProduk[],
): { label: string; nilai: string }[] {
  const adaStok = kolom.some((k) => k.key === 'stok');
  const adaBeli = kolom.some((k) => k.key === 'harga_beli');
  const stok = rows.reduce((n, r) => n + Number(r.stok ?? 0), 0);
  const nilai = rows.reduce((n, r) => n + Number(r.stok ?? 0) * Number(r.harga_beli ?? 0), 0);
  const kartu: { label: string; nilai: string }[] = [
    { label: 'Total produk', nilai: total.toLocaleString('id-ID') },
  ];
  if (adaStok) kartu.push({ label: 'Total stok', nilai: `${stok.toLocaleString('id-ID')} pcs` });
  if (adaStok && adaBeli) kartu.push({ label: 'Nilai persediaan', nilai: rupiah(nilai) });
  else if (adaBeli) {
    kartu.push({
      label: 'Total harga beli',
      nilai: rupiah(rows.reduce((n, r) => n + Number(r.harga_beli ?? 0), 0)),
    });
  } else kartu.push({ label: 'Kolom diekspor', nilai: `${kolom.length} kolom` });
  return kartu.slice(0, 3);
}

function kakiFooter(o: OpsiDokumen, tanggal: string): string {
  return `<div class="footer">
    <span>${esc(o.toko.nama)} · Dicetak ${tanggal}</span>
    <span>${o.nomorHalaman ? 'Halaman <span class="hal"><b>1</b></span>' : ''}</span>
  </div>`;
}

/** Bangun HTML dokumen (pratinjau & cetak memakai fungsi yang sama). */
export function bangunDokumen(
  rows: Record<string, unknown>[],
  o: OpsiDokumen,
  kolom: KolomProduk[],
  batas: number,
): string {
  const tanggal = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const inisial = (o.toko.nama || 'T')
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0])
    .join('')
    .toUpperCase();

  const kop = o.kop
    ? `<div class="kop">
        ${o.toko.logo ? `<img src="${esc(o.toko.logo)}" alt="" />` : `<div class="inisial">${esc(inisial)}</div>`}
        <div class="kop-teks">
          <h1>${esc(o.toko.nama)}</h1>
          ${o.toko.alamat || o.toko.telepon ? `<p>${[esc(o.toko.alamat), o.toko.telepon ? `Telp: ${esc(o.toko.telepon)}` : ''].filter(Boolean).join(' · ')}</p>` : ''}
        </div>
      </div>`
    : '';

  const judul = `<div class="judul">
      <h2>${esc(o.judul)}</h2>
      <div class="meta">Dicetak ${tanggal}<br />${rows.length} dari ${o.totalBaris} baris</div>
    </div>`;

  if (o.template === 'katalog') {
    const isi = rows
      .slice(0, batas)
      .map((r) => {
        const f = urlFoto(r);
        const harga = nilaiTeks('harga_jual', r.harga_jual);
        return `<div class="item">
          <div class="foto">${f ? `<img src="${esc(f)}" alt="" />` : 'Tanpa foto'}</div>
          <strong>${esc(r.nama_produk ?? '')}</strong>
          <small>${esc(r.kode_item ?? '')}${harga ? ` · ${harga}` : ''}</small>
        </div>`;
      })
      .join('');
    const sisa =
      rows.length > batas
        ? `<p style="grid-column:1/-1;font-size:8pt;color:#64748b">… dan ${rows.length - batas} produk lainnya.</p>`
        : '';
    return `<div class="dok">${kop}${judul}<div class="katalog">${isi}${sisa}</div>${kakiFooter(o, tanggal)}</div>`;
  }

  const ringkas =
    o.template === 'laporan' && o.kartuRingkasan
      ? `<div class="ringkas">${kartuRingkas(rows, o.totalBaris, kolom)
          .map((k) => `<div><span>${esc(k.label)}</span><strong>${esc(k.nilai)}</strong></div>`)
          .join('')}</div>`
      : '';

  const angka = (k: KolomProduk) => (k.angka || k.key.startsWith('harga_') ? 'angka' : '');
  const kepala = `<thead><tr>${kolom
    .map((k) => `<th class="${angka(k)}">${esc(k.label)}</th>`)
    .join('')}</tr></thead>`;

  const kelompokPer = o.kelompok && kolom.some((k) => k.key === 'kategori');
  const isiBaris = (daftar: Record<string, unknown>[]) =>
    daftar
      .map(
        (r, i) =>
          `<tr class="${i % 2 === 1 ? 'belang' : ''}">${kolom
            .map((k) => `<td class="${angka(k)}">${esc(nilaiTeks(k.key, r[k.key]))}</td>`)
            .join('')}</tr>`,
      )
      .join('');

  let isi = '';
  if (kelompokPer) {
    const grup = new Map<string, Record<string, unknown>[]>();
    for (const r of rows.slice(0, batas)) {
      const g = String(r.kategori || '').trim() || 'Tanpa Kategori';
      const daftar = grup.get(g) ?? [];
      daftar.push(r);
      grup.set(g, daftar);
    }
    isi = [...grup.entries()]
      .map(
        ([g, daftar]) =>
          `<tbody><tr class="grup"><td colspan="${kolom.length}">${esc(g)} <b>${daftar.length} produk</b></td></tr>${isiBaris(daftar)}</tbody>`,
      )
      .join('');
  } else {
    isi = `<tbody>${isiBaris(rows.slice(0, batas))}</tbody>`;
  }

  const sisaBaris =
    rows.length > batas
      ? `<p style="font-size:8pt;color:#64748b">… dan ${rows.length - batas} baris lainnya (tercetak lengkap).</p>`
      : '';

  const ttd = o.tandaTangan
    ? `<div class="ttd">
        <div>
          Dibuat oleh,
          <div class="ttd-isi"><div class="ttd-nama">${esc(o.toko.nama)}</div></div>
        </div>
        <div>
          Mengetahui,
          <div class="ttd-isi"><div class="ttd-nama">Pemilik / Penanggung Jawab</div></div>
        </div>
      </div>`
    : '';

  return `<div class="dok">${kop}${judul}${ringkas}<table class="tabel">${kepala}${isi}</table>${sisaBaris}${ttd}${kakiFooter(o, tanggal)}</div>`;
}

// Mesin cetak/PDF laporan (N4, diperluas X3.2): HTML + @page mengikuti ukuran
// kertas (A4, A5, A6, Letter, Legal, thermal 58/80 mm, kustom), orientasi,
// margin, skala, pilihan kolom & kop — dipakai BAIK jendela cetak MAUPUN
// pratinjau di dalam pop up (berlatar putih di kedua tema).

import type { KolomLaporan } from './tipe';
import { formatTanggal, formatTanggalWaktu } from '../../lib/format';
import { labelZona, regionalAktif } from '../../lib/regional';

export type UkuranCetak = 'A4' | 'A5' | 'A6' | 'Letter' | 'Legal' | '58mm' | '80mm' | 'custom';
export type OrientasiCetak = 'potret' | 'lanskap';

export const UKURAN_CETAK: { nilai: UkuranCetak; teks: string }[] = [
  { nilai: 'A4', teks: 'A4 (210 × 297 mm)' },
  { nilai: 'A5', teks: 'A5 (148 × 210 mm)' },
  { nilai: 'A6', teks: 'A6 (105 × 148 mm)' },
  { nilai: 'Letter', teks: 'Letter (216 × 279 mm)' },
  { nilai: 'Legal', teks: 'Legal (216 × 356 mm)' },
  { nilai: '58mm', teks: 'Thermal 58 mm' },
  { nilai: '80mm', teks: 'Thermal 80 mm' },
  { nilai: 'custom', teks: 'Kustom (ikuti margin peramban)' },
];

/** Dimensi kertas (mm) untuk pratinjau & paginasi — thermal = tinggi otomatis. */
export const DIMENSI_KERTAS: Record<UkuranCetak, { lebar: number; tinggi: number | null }> = {
  A4: { lebar: 210, tinggi: 297 },
  A5: { lebar: 148, tinggi: 210 },
  A6: { lebar: 105, tinggi: 148 },
  Letter: { lebar: 215.9, tinggi: 279.4 },
  Legal: { lebar: 215.9, tinggi: 355.6 },
  '58mm': { lebar: 58, tinggi: null },
  '80mm': { lebar: 80, tinggi: null },
  custom: { lebar: 210, tinggi: 297 },
};

/** Opsi cetak lengkap (X3.2 — semua dipilih di pop up). */
export interface OpsiCetak {
  ukuran: UkuranCetak;
  orientasi: OrientasiCetak;
  /** Margin dalam mm (1–40). */
  margin: number;
  /** Skala cetak % (75–130). */
  skala: number;
  /** Tampilkan kop toko (nama + alamat). */
  kop: boolean;
  /** Kunci kolom yang ikut dicetak (kosong = semua). */
  kolomDipilih?: string[];
  /** Sembunyikan kolom Laba pada PDF (default: aktif). */
  sembunyikanLaba?: boolean;
  /** Cetak sub-tabel rincian barang per baris (default: aktif). */
  rincianBarang?: boolean;
  /** Cetak baris Total di akhir tabel PDF (default: TIDAK — baris Total
   *  tidak lagi tampil di tabel layar, jadi nilainya hanya keluar bila
   *  pengguna mencentang opsi ini di dialog cetak). */
  tampilkanTotal?: boolean;
}

export const OPSI_CETAK_AWAL: OpsiCetak = {
  ukuran: 'A4',
  orientasi: 'potret',
  margin: 14,
  skala: 100,
  kop: true,
  sembunyikanLaba: true,
  rincianBarang: true,
  tampilkanTotal: false,
};

/** Preferensi cetak yang diingat antar laporan (localStorage). */
export type PreferensiCetak = Pick<OpsiCetak, 'sembunyikanLaba' | 'rincianBarang' | 'tampilkanTotal'>;
const KUNCI_PREFERENSI_CETAK = 'nusasuite.laporan.opsi-cetak';
const PREFERENSI_CETAK_AWAL: PreferensiCetak = { sembunyikanLaba: true, rincianBarang: true, tampilkanTotal: false };

/** Baca preferensi cetak terakhir pengguna (default: keduanya aktif). */
export function muatPreferensiCetak(): PreferensiCetak {
  try {
    const mentah = localStorage.getItem(KUNCI_PREFERENSI_CETAK);
    if (!mentah) return { ...PREFERENSI_CETAK_AWAL };
    const v = JSON.parse(mentah) as Record<string, unknown>;
    return {
      sembunyikanLaba: typeof v.sembunyikanLaba === 'boolean' ? v.sembunyikanLaba : true,
      rincianBarang: typeof v.rincianBarang === 'boolean' ? v.rincianBarang : true,
      tampilkanTotal: typeof v.tampilkanTotal === 'boolean' ? v.tampilkanTotal : false,
    };
  } catch {
    return { ...PREFERENSI_CETAK_AWAL };
  }
}

/** Simpan pilihan pengguna agar berlaku otomatis di laporan berikutnya. */
export function simpanPreferensiCetak(o: OpsiCetak): void {
  try {
    localStorage.setItem(
      KUNCI_PREFERENSI_CETAK,
      JSON.stringify({
        sembunyikanLaba: o.sembunyikanLaba !== false,
        rincianBarang: o.rincianBarang !== false,
        tampilkanTotal: o.tampilkanTotal === true,
      }),
    );
  } catch {
    /* localStorage penuh/diblokir — opsi tetap berlaku untuk sesi ini. */
  }
}

/** Ruang udara tepi kertas KHUSUS pratinjau layar (mm) — atas, kanan, bawah,
 *  kiri. Hasil cetak/PDF tidak memakai ini (margin fisik diatur @page agar
 *  simetris mengikuti opsi margin). Dialog pratinjau mengurangkan padding
 *  ini saat menghitung paginasi agar jumlah halaman tetap tepat. */
export const PADDING_PRATINJAU_MM = { atas: 10, kanan: 9, bawah: 12, kiri: 9 };

const MM = 96 / 25.4; /* px per mm pada 96dpi */

/** Aturan @page sesuai opsi (dipakai jendela cetak). */
function pageCss(o: OpsiCetak): string {
  const ukuran =
    o.ukuran === 'custom'
      ? ''
      : `size: ${o.ukuran === '58mm' || o.ukuran === '80mm' ? `${o.ukuran} auto` : `${o.ukuran} ${o.orientasi}`};`;
  const margin = o.ukuran === '58mm' ? 2 : o.ukuran === '80mm' ? 3 : o.margin;
  return `@page { ${ukuran} margin: ${margin}mm; }`;
}

/** Tinggi isi satu halaman dalam px (untuk paginasi pratinjau). */
export function tinggiHalamanPx(o: OpsiCetak): number | null {
  const d = DIMENSI_KERTAS[o.ukuran];
  if (!d.tinggi) return null;
  const margin = (o.ukuran === '58mm' ? 2 : o.ukuran === '80mm' ? 3 : o.margin) * 2;
  const tinggiMm = (o.orientasi === 'lanskap' ? d.lebar : d.tinggi) - margin;
  return Math.round(tinggiMm * MM * (o.skala / 100));
}

/** Lebar halaman dalam px (untuk skala pratinjau). */
export function lebarHalamanPx(o: OpsiCetak): number {
  const d = DIMENSI_KERTAS[o.ukuran];
  const margin = (o.ukuran === '58mm' ? 2 : o.ukuran === '80mm' ? 3 : o.margin) * 2;
  const lebarMm = (o.orientasi === 'lanskap' ? d.tinggi ?? d.lebar : d.lebar) - margin;
  return Math.round(lebarMm * MM * (o.skala / 100));
}

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sel(v: unknown, tipe: KolomLaporan['tipe']): string {
  if (v === null || v === undefined) return '—';
  if (tipe === 'rupiah') return `Rp ${Number(v).toLocaleString('id-ID')}`;
  if (tipe === 'persen') return `${Number(v).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
  if (tipe === 'angka') return Number(v).toLocaleString('id-ID', { maximumFractionDigits: 2 });
  if (tipe === 'waktu') return formatTanggalWaktu(v as Date | string | number | null | undefined);
  if (tipe === 'tanggal') return formatTanggal(v as Date | string | number | null | undefined);
  return String(v);
}

export interface MetaCetak {
  judul: string;
  deskripsi?: string;
  namaUsaha: string;
  alamatUsaha?: string;
  kolom: KolomLaporan[];
  rows: Record<string, unknown>[];
  total?: Record<string, unknown> | null;
  filter: [string, string][];
  pencetak: string;
  /** Opsi tata letak (X3.2) — default A4 potret tanpa perubahan perilaku lama. */
  opsi?: OpsiCetak;
}

/**
 * Bangun dokumen HTML laporan (satu sumber untuk jendela cetak DAN
 * pratinjau di pop up — hasilnya identik). Pratinjau tidak memuat tombol
 * cetak otomatis.
 */
export function htmlLaporan(meta: MetaCetak, pratinjau = false): string {
  const o = { ...OPSI_CETAK_AWAL, ...(meta.opsi ?? {}) };
  // Opsi pengguna: sembunyikan kolom Laba & cetak/tidak sub-tabel rincian.
  const sembunyikanLaba = o.sembunyikanLaba !== false;
  const tampilRincian = o.rincianBarang !== false;
  const tampilTotal = o.tampilkanTotal === true;
  // Kolom harga SATUAN tidak boleh dijumlahkan: pada baris Total sel ini
  // dikosongkan (nilai agregasinya ada di kolom Subtotal).
  const kolomHargaSatuan = (k: KolomLaporan) => {
    const kunci = k.kunci.trim().toLowerCase();
    return kunci === 'harga' || kunci === 'harga_satuan' || kunci === 'harga_beli' || k.label.trim().toLowerCase() === 'harga';
  };
  const kolomLaba = (k: KolomLaporan) =>
    k.kunci.toLowerCase() === 'laba' || k.label.trim().toLowerCase() === 'laba';
  // Template PDF: kolom teks "Rincian Barang" tidak dicetak sebagai kolom —
  // rinciannya dibuka ke bawah sebagai tabel tersarang di tiap baris.
  const semuaKolom = (o.kolomDipilih?.length
    ? meta.kolom.filter((k) => o.kolomDipilih!.includes(k.kunci))
    : meta.kolom
  ).filter((k) => !(sembunyikanLaba && kolomLaba(k)));
  const kolom = semuaKolom.filter((k) => k.kunci !== 'rincian_barang' && k.kunci !== 'rincian_detail');
  const kepala = kolom.map((k) => `<th class="${k.tipe === 'teks' ? '' : 'num'}">${esc(k.label)}</th>`).join('');
  const rp = (v: unknown): string => `Rp ${Number(v ?? 0).toLocaleString('id-ID')}`;
  const q2 = (v: unknown): string => Number(v ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
  const itemsDari = (r: Record<string, unknown>): Record<string, unknown>[] => {
    try {
      const v = r.rincian_detail;
      const arr: unknown = typeof v === 'string' ? JSON.parse(v) : v;
      if (!Array.isArray(arr)) return [];
      return (arr as unknown[]).filter((x) => x && typeof x === 'object') as Record<string, unknown>[];
    } catch {
      return [];
    }
  };
  const baris = meta.rows
    .map((r) => {
      const utama =
        `<tr>${kolom
          .map((k) => `<td class="${k.tipe === 'teks' ? '' : 'num'}">${esc(sel(r[k.kunci], k.tipe))}</td>`)
          .join('')}</tr>`;
      const items = itemsDari(r);
      // Opsi "Tampilkan Rincian Barang" mati → hanya tabel ringkasan utama.
      if (!items.length || !tampilRincian) return utama;
      const grup = String(r[semuaKolom[0]?.kunci ?? ''] ?? '');
      const opname = items.every((x) => x.tanggal == null && (x.selisih != null || x.sistem != null));
      const adaLaba = !sembunyikanLaba && items.some((x) => x.laba != null && Number(x.laba) !== 0);
      const n = items.length;
      const qty = items.reduce((a, x) => a + Number(x.qty ?? x.selisih ?? 0), 0);
      const sub = items.reduce((a, x) => a + Number(x.subtotal ?? 0), 0);
      const laba = items.reduce((a, x) => a + Number(x.laba ?? 0), 0);
      const judulRinci = opname
        ? `Rincian selisih • ${esc(grup)}`
        : adaLaba
          ? `Rincian barang terjual • ${esc(grup)}`
          : `Rincian barang dibeli • ${esc(grup)}`;
      const inner = opname
        ? `<table class="rincian"><thead><tr><th>Barang</th><th class="num">Sistem</th><th class="num">Fisik</th><th class="num">Selisih</th></tr></thead><tbody>${items
            .map(
              (x) =>
                `<tr><td>${esc(String(x.barang ?? '—'))}</td><td class="num">${esc(q2(x.sistem))}</td><td class="num">${esc(q2(x.fisik))}</td><td class="num">${esc(q2(x.selisih ?? x.qty))}</td></tr>`,
            )
            .join('')}<tr class="total"><td>Total rincian</td><td class="num"></td><td class="num"></td><td class="num">${esc(q2(qty))}</td></tr></tbody></table>`
        : `<table class="rincian"><thead><tr><th>Tanggal</th><th>${adaLaba ? 'No. Struk' : 'Nomor'}</th><th>Barang</th><th class="num">Qty</th><th class="num">Harga</th><th class="num">Subtotal</th>${adaLaba ? '<th class="num">Laba</th>' : ''}</tr></thead><tbody>${items
            .map(
              (x) =>
                `<tr><td class="nowrap">${esc(String(x.tanggal ?? '—').replace('T', ' ').slice(0, 16))}</td><td class="nowrap">${esc(String(x.nomor ?? '—'))}</td><td>${esc(String(x.barang ?? '—'))}</td><td class="num">${esc(q2(x.qty))}</td><td class="num">${esc(rp(x.harga))}</td><td class="num">${esc(rp(x.subtotal))}</td>${adaLaba ? `<td class="num">${esc(rp(x.laba))}</td>` : ''}</tr>`,
            )
            .join('')}<tr class="total"><td colspan="3">Total rincian</td><td class="num">${esc(q2(qty))}</td><td></td><td class="num">${esc(rp(sub))}</td>${adaLaba ? `<td class="num">${esc(rp(laba))}</td>` : ''}</tr></tbody></table>`;
      return `${utama}<tr class="baris-rincian"><td colspan="${kolom.length || 1}"><div class="rincian-kepala"><b>${judulRinci}</b><span>${n} baris • ${esc(q2(qty))} pcs</span></div>${inner}</td></tr>`;
    })
    .join('');
  const barisTotal =
    meta.total && tampilTotal
      ? `<tr class="total"><td>${meta.rows.length ? 'Total' : ''}</td>${kolom
          .slice(1)
          .map((k) => {
            const nilai = k.tipe === 'teks' || kolomHargaSatuan(k) ? '' : esc(sel(meta.total?.[k.kunci], k.tipe));
            return `<td class="${k.tipe === 'teks' ? '' : 'num'}">${nilai}</td>`;
          })
          .join('')}</tr>`
      : '';
  const filterHtml = meta.filter.map(([a, b]) => `<span class="f"><b>${esc(a)}:</b> ${esc(b)}</span>`).join(' ');
  const regCetak = regionalAktif();
  const labelCetak = labelZona(regCetak.zona);
  const waktuCetak = `${new Date().toLocaleString('id-ID', { timeZone: regCetak.zona })} ${labelCetak}`;
  const kop = o.kop
    ? `<div class="kop">
    <div><h1>${esc(meta.namaUsaha || 'Toko Retail')}</h1><p>${esc(meta.alamatUsaha ?? '')}</p></div>
    <div style="text-align:right"><b>Laporan</b><br>${esc(waktuCetak)}</div>
  </div>`
    : '';
  const skalaCss = o.skala !== 100 ? `zoom: ${o.skala / 100};` : '';
  // Pratinjau layar: beri ruang udara di dalam kertas agar kop & tabel tidak
  // menempel ke tepi. Jendela cetak (pratinjau=false) tetap margin 0 + @page.
  const paddingPratinjau = pratinjau
    ? `body { padding: ${PADDING_PRATINJAU_MM.atas}mm ${PADDING_PRATINJAU_MM.kanan}mm ${PADDING_PRATINJAU_MM.bawah}mm ${PADDING_PRATINJAU_MM.kiri}mm; }`
    : '';

  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><title>${esc(meta.judul)}</title>
<style>
  ${pageCss(o)}
  * { box-sizing: border-box; }
  /* Pratinjau & hasil cetak selalu berlatar putih (X3.2) — tema apa pun. */
  html, body { background: #fff; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 11.5px; color: #0f172a; margin: 0; ${skalaCss} }
  ${paddingPratinjau}
  .kop { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2.5px solid #0f172a; padding-bottom: 6px; margin-bottom: 8px; }
  .kop h1 { font-size: 16px; margin: 0; }
  .kop p { margin: 2px 0 0; font-size: 10.5px; color: #475569; }
  h2.judul { font-size: 13px; margin: 10px 0 4px; }
  .filter { font-size: 10px; color: #475569; margin-bottom: 8px; line-height: 1.6; }
  table { width: 100%; border-collapse: collapse; }
  /* Kepala tabel diulang di tiap halaman; baris tidak terbelah tengah (cetak multi-halaman). */
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #cbd5e1; padding: 4px 6px; text-align: left; }
  th { background: #e2e8f0; font-size: 10.5px; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  tr.total td { font-weight: 700; background: #f1f5f9; }
  tr.baris-rincian td { background: #f8fafc; }
  .rincian-kepala { display: flex; justify-content: space-between; gap: 8px; font-size: 10.5px; margin-bottom: 4px; }
  table.rincian { margin: 0; }
  table.rincian th { background: #f1f5f9; font-size: 10px; }
  table.rincian td, table.rincian th { padding: 3px 5px; }
  table.rincian tr.total td { background: #e2e8f0; }
  .kaki { margin-top: 14px; display: flex; justify-content: space-between; font-size: 10px; color: #475569; }
  @media print {
    .tombol-cetak { display: none; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
  .tombol-cetak { position: fixed; right: 16px; top: 16px; padding: 8px 16px; background: #2563eb; color: #fff; border: 0; border-radius: 8px; cursor: pointer; }
</style></head>
<body>
  ${pratinjau ? '' : '<button class="tombol-cetak" onclick="window.print()">Cetak / Simpan PDF</button>'}
  ${kop}
  <h2 class="judul">${esc(meta.judul)}</h2>
  <div class="filter">${filterHtml}</div>
  <table><thead><tr>${kepala}</tr></thead><tbody>${baris}${barisTotal}</tbody></table>
  <div class="kaki">
    <span>Dicetak oleh: ${esc(meta.pencetak)} · ${esc(waktuCetak)}</span>
    <span>${esc(meta.namaUsaha || '')}</span>
  </div>
  ${pratinjau ? '' : '<script>window.onload = () => setTimeout(() => window.print(), 250);<\/script>'}
</body></html>`;
}

/** Bangun HTML laporan lalu buka jendela cetak (Print → Save as PDF). */
export function cetakLaporan(meta: MetaCetak): Window | null {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return null;
  w.document.write(htmlLaporan(meta));
  w.document.close();
  return w;
}

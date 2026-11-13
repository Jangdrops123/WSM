// Dokumen PO untuk kirim ke supplier: ringkasan → model gambar (PNG) + teks WA.
// Memakai ulang mesin raster canvas di src/lib/gambarDok.ts (tanpa pustaka baru).
import type { GambarDok, ModelDok } from '../../lib/gambarDok';
import { formatKodi } from '../../lib/kodi';
import { PPN_PO } from './FakturPo';
import { formatRupiah, formatTanggal } from '../../lib/format';

export type TemplatePo = 'penuh' | 'awal' | 'sisa' | 'lebih' | 'selisih';

export const TEMPLATE_PO: { kode: TemplatePo; label: string; ket: string }[] = [
  { kode: 'penuh', label: 'Ringkasan PO lengkap', ket: 'Semua item + total kodi/pcs/harga' },
  { kode: 'awal', label: 'Rincian PO awal', ket: 'Hanya daftar pesanan awal & estimasi harga' },
  { kode: 'sisa', label: 'Sisa PO saja', ket: 'Hanya barang yang belum datang' },
  { kode: 'lebih', label: 'Kelebihan saja', ket: 'Hanya barang yang datang lebih' },
  { kode: 'selisih', label: 'Selisih kurang & lebih', ket: 'Gabungan kurang dan lebih' },
];

export interface PoItemDok {
  produk_nama: string;
  sku?: string | null;
  qty_pesan: number;
  total_datang: number;
  sisa: number;
  selisih: number;
  harga_beli: number;
  catatan?: string | null;
}

export interface PoDokData {
  no_po: string;
  tanggal: string;
  supplier_nama: string;
  catatan?: string | null;
  toko_nama: string;
  items: PoItemDok[];
  /** PPN 11% aktif untuk PO ini (bawaan: tidak aktif). */
  ppn_aktif?: boolean;
}

const rupiah = (n: unknown): string => formatRupiah(Number(n) || 0);

function barisItem(it: PoItemDok, isi: number, awal: boolean): ModelDok['baris'] {
  const sub = (awal ? Number(it.qty_pesan) || 0 : Number(it.total_datang) || 0) * (Number(it.harga_beli) || 0);
  const keluar: ModelDok['baris'] = [
    { kind: 'teks', teks: it.produk_nama, tebal: true },
    {
      kind: 'pasangan',
      kiri: awal
        ? `Target ${formatKodi(it.qty_pesan, isi)}`
        : `Target ${formatKodi(it.qty_pesan, isi)} | Diterima ${formatKodi(it.total_datang, isi)} | Sisa ${formatKodi(it.sisa, isi)}`,
      kanan: '',
      ukuran: 13,
    },
    {
      kind: 'pasangan',
      kiri: `${Number(awal ? it.qty_pesan : it.total_datang).toLocaleString('id-ID')} x ${rupiah(it.harga_beli)}`,
      kanan: rupiah(sub),
      ukuran: 13,
    },
  ];
  if (!awal && it.selisih > 0) keluar.push({ kind: 'teks', teks: `LEBIH ${formatKodi(it.selisih, isi)}`, ukuran: 13 });
  else if (!awal && it.selisih < 0) keluar.push({ kind: 'teks', teks: `KURANG ${formatKodi(-it.selisih, isi)}`, ukuran: 13 });
  if (it.catatan) keluar.push({ kind: 'teks', teks: `Cat.: ${it.catatan}`, ukuran: 13 });
  return keluar;
};

/** Bangun model dokumen PO sesuai template kirim. */
export function modelPo(d: PoDokData, template: TemplatePo, isi: number): ModelDok {
  let items = d.items;
  if (template === 'sisa') items = items.filter((i) => i.sisa > 0);
  else if (template === 'lebih') items = items.filter((i) => i.selisih > 0);
  else if (template === 'selisih') items = items.filter((i) => i.selisih !== 0);
  const judul =
    template === 'penuh'
      ? 'PURCHASE ORDER'
      : template === 'awal'
        ? 'RINCIAN PURCHASE ORDER AWAL'
        : template === 'sisa'
          ? 'SISA PURCHASE ORDER'
          : template === 'lebih'
            ? 'KELEBIHAN BARANG'
            : 'SELISIH KURANG & LEBIH';
  const awal = template === 'awal';
  const baris: ModelDok['baris'] = [
    { kind: 'teks', teks: d.toko_nama, rata: 'tengah', tebal: true, ukuran: 20 },
    { kind: 'teks', teks: judul, rata: 'tengah', tebal: true, ukuran: 17 },
    { kind: 'garis' },
    { kind: 'pasangan', kiri: 'No. PO', kanan: d.no_po, tebal: true },
    { kind: 'pasangan', kiri: 'Tanggal', kanan: formatTanggal(d.tanggal) },
    { kind: 'pasangan', kiri: 'Pemasok', kanan: d.supplier_nama || '—' },
    { kind: 'garis' },
  ];
  if (items.length === 0) {
    baris.push({ kind: 'teks', teks: template === 'penuh' ? 'Tidak ada item.' : 'Tidak ada data untuk template ini.', rata: 'tengah', ukuran: 13 });
  }
  for (const it of items) baris.push(...barisItem(it, isi, awal));
  baris.push({ kind: 'garis' });
  const tPesan = items.reduce((n, i) => n + (Number(i.qty_pesan) || 0), 0);
  const tDatang = items.reduce((n, i) => n + (Number(i.total_datang) || 0), 0);
  const tSisa = items.reduce((n, i) => n + (Number(i.sisa) || 0), 0);
  baris.push({ kind: 'pasangan', kiri: 'Total pesan', kanan: formatKodi(tPesan, isi), tebal: true });
  if (!awal) {
    baris.push({ kind: 'pasangan', kiri: 'Total datang', kanan: formatKodi(tDatang, isi) });
    baris.push({ kind: 'pasangan', kiri: 'Total sisa', kanan: formatKodi(tSisa, isi), tebal: true });
  }
  {
    const tDasar = items.reduce(
      (n, i) => n + (awal ? Number(i.qty_pesan) || 0 : Number(i.total_datang) || 0) * (Number(i.harga_beli) || 0),
      0,
    );
    const ppn = d.ppn_aktif === true ? tDasar * PPN_PO : 0;
    baris.push({
      kind: 'pasangan',
      kiri: awal ? 'Subtotal estimasi PO' : 'Subtotal diterima',
      kanan: rupiah(tDasar),
      tebal: true,
    });
    if (ppn > 0) baris.push({ kind: 'pasangan', kiri: 'PPN (11%)', kanan: rupiah(ppn) });
    baris.push({
      kind: 'pasangan',
      kiri: awal ? 'GRAND TOTAL ESTIMASI PO' : 'GRAND TOTAL',
      kanan: rupiah(tDasar + ppn),
      tebal: true,
      ukuran: 18,
    });
  }
  if (d.catatan) baris.push({ kind: 'teks', teks: `Catatan: ${d.catatan}`, ukuran: 13 });
  baris.push({ kind: 'garis' });
  baris.push({ kind: 'teks', teks: 'Terima kasih.', rata: 'tengah', ukuran: 13 });
  return { baris };
}

export function gambarPo(d: PoDokData, template: TemplatePo, isi: number): GambarDok {
  const nama = `${d.no_po}-${template}`.replace(/[^0-9A-Za-z-]+/g, '_');
  return { model: modelPo(d, template, isi), lebarPx: 520, namaBerkas: `${nama}.png` };
}

/** Pesan WhatsApp otomatis untuk PO. */
export function pesanWaPo(d: PoDokData, template: TemplatePo, isi: number): string {
  const items = d.items;
  const tPesan = items.reduce((n, i) => n + (Number(i.qty_pesan) || 0), 0);
  const tDatang = items.reduce((n, i) => n + (Number(i.total_datang) || 0), 0);
  const kurang = items.reduce((n, i) => n + Math.max(0, (Number(i.qty_pesan) || 0) - (Number(i.total_datang) || 0)), 0);
  const lebih = items.reduce((n, i) => n + Math.max(0, (Number(i.total_datang) || 0) - (Number(i.qty_pesan) || 0)), 0);
  const nominal = (qty: (i: PoItemDok) => number): number =>
    items.reduce((n, i) => n + qty(i) * (Number(i.harga_beli) || 0), 0);
  const tDiterima = nominal((i) => Number(i.total_datang) || 0);
  const tEstimasi = nominal((i) => Number(i.qty_pesan) || 0);
  const nomKurang = nominal((i) => Math.max(0, (Number(i.qty_pesan) || 0) - (Number(i.total_datang) || 0)));
  const nomLebih = nominal((i) => Math.max(0, (Number(i.total_datang) || 0) - (Number(i.qty_pesan) || 0)));
  const judul =
    template === 'penuh'
      ? 'Purchase Order'
      : template === 'awal'
        ? 'Rincian PO awal'
        : template === 'sisa'
          ? 'Sisa PO (belum diterima)'
          : template === 'lebih'
            ? 'Kelebihan barang PO'
            : 'Selisih PO (kurang & lebih)';
  let rincian: string[];
  if (template === 'penuh') {
    const grand = tDiterima + (d.ppn_aktif === true ? tDiterima * PPN_PO : 0);
    rincian = [
      `Total pesan: ${formatKodi(tPesan, isi)}`,
      `Total diterima: ${formatKodi(tDatang, isi)}`,
      `Grand total ${d.ppn_aktif === true ? '(+PPN 11%)' : '(tanpa PPN)'}: ${rupiah(grand)}`,
    ];
  } else if (template === 'awal') {
    const grand = tEstimasi + (d.ppn_aktif === true ? tEstimasi * PPN_PO : 0);
    rincian = [`Total pesan: ${formatKodi(tPesan, isi)}`, `Grand total estimasi PO: ${rupiah(grand)}`];
  } else if (template === 'sisa') {
    rincian = [`Total sisa: ${formatKodi(kurang, isi)}`, `Grand total nominal sisa PO: ${rupiah(nomKurang)}`];
  } else if (template === 'lebih') {
    rincian = [`Total kelebihan: ${formatKodi(lebih, isi)}`, `Grand total nominal kelebihan: ${rupiah(nomLebih)}`];
  } else {
    rincian = [
      `Total kurang: ${formatKodi(kurang, isi)} (${rupiah(nomKurang)})`,
      `Total lebih: ${formatKodi(lebih, isi)} (${rupiah(nomLebih)})`,
      `Grand total nominal selisih: ${rupiah(nomKurang + nomLebih)}`,
    ];
  }
  return [
    `Halo, ${d.supplier_nama || 'Bapak/Ibu'}!`,
    '',
    `${judul} *${d.no_po}* tanggal ${formatTanggal(d.tanggal)}:`,
    ...rincian,
    '',
    'Terima kasih.',
  ].join('\n');
}

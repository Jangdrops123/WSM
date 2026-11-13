// ============================================================================
// SPESIFIKASI DOKUMEN TEMPLATE PO — satu sumber untuk cetak/PDF (FakturPo),
// gambar WhatsApp (fakturPng), dan teks WA (poDok).
//
// Tiap template punya: judul dokumen, filter baris, kolom tabel, dasar qty
// nominal, dan label total/grand total sendiri.
// ============================================================================
import { formatRupiah } from '../../lib/format';

export type VarianDokPo = 'penuh' | 'awal' | 'sisa' | 'lebih' | 'selisih';

export type KolomKunci =
  | 'no'
  | 'nama'
  | 'size'
  | 'target'
  | 'datang'
  | 'sisa'
  | 'lebih'
  | 'selisih'
  | 'status'
  | 'harga'
  | 'nominal';

export interface KolomDokPo {
  kunci: KolomKunci;
  label: string;
  rata: 'kiri' | 'tengah' | 'kanan';
  /** Lebar relatif (%) — total 100 per template. */
  lebar: number;
}

export const JUDUL_VARIAN: Record<VarianDokPo, string> = {
  penuh: 'FAKTUR STATUS PO',
  awal: 'RINCIAN PURCHASE ORDER (PO)',
  sisa: 'LAPORAN SISA PO (BELUM DITERIMA)',
  lebih: 'LAPORAN KELEBIHAN BARANG PO',
  selisih: 'LAPORAN SELISIH PO (KURANG & LEBIH)',
};

export const KOLOM_VARIAN: Record<VarianDokPo, KolomDokPo[]> = {
  penuh: [
    { kunci: 'no', label: 'No', rata: 'tengah', lebar: 4.5 },
    { kunci: 'nama', label: 'Deskripsi Barang', rata: 'kiri', lebar: 32 },
    { kunci: 'size', label: 'Size', rata: 'tengah', lebar: 6 },
    { kunci: 'target', label: 'Target PO', rata: 'tengah', lebar: 9 },
    { kunci: 'datang', label: 'Fisik Diterima', rata: 'tengah', lebar: 9 },
    { kunci: 'sisa', label: 'Sisa / Selisih', rata: 'tengah', lebar: 9 },
    { kunci: 'harga', label: 'Harga Satuan', rata: 'kanan', lebar: 13 },
    { kunci: 'nominal', label: 'Subtotal Diterima', rata: 'kanan', lebar: 17.5 },
  ],
  awal: [
    { kunci: 'no', label: 'No', rata: 'tengah', lebar: 5 },
    { kunci: 'nama', label: 'Deskripsi Barang', rata: 'kiri', lebar: 38 },
    { kunci: 'size', label: 'Size', rata: 'tengah', lebar: 7 },
    { kunci: 'target', label: 'Target PO (Psg)', rata: 'tengah', lebar: 14 },
    { kunci: 'harga', label: 'Harga Satuan', rata: 'kanan', lebar: 16 },
    { kunci: 'nominal', label: 'Estimasi Subtotal', rata: 'kanan', lebar: 20 },
  ],
  sisa: [
    { kunci: 'no', label: 'No', rata: 'tengah', lebar: 5 },
    { kunci: 'nama', label: 'Deskripsi Barang', rata: 'kiri', lebar: 40 },
    { kunci: 'size', label: 'Size', rata: 'tengah', lebar: 7 },
    { kunci: 'sisa', label: 'Sisa PO (Psg)', rata: 'tengah', lebar: 14 },
    { kunci: 'harga', label: 'Harga Satuan', rata: 'kanan', lebar: 14 },
    { kunci: 'nominal', label: 'Nominal Sisa', rata: 'kanan', lebar: 20 },
  ],
  lebih: [
    { kunci: 'no', label: 'No', rata: 'tengah', lebar: 5 },
    { kunci: 'nama', label: 'Deskripsi Barang', rata: 'kiri', lebar: 40 },
    { kunci: 'size', label: 'Size', rata: 'tengah', lebar: 7 },
    { kunci: 'lebih', label: 'Kelebihan (Psg)', rata: 'tengah', lebar: 14 },
    { kunci: 'harga', label: 'Harga Satuan', rata: 'kanan', lebar: 14 },
    { kunci: 'nominal', label: 'Nominal Kelebihan', rata: 'kanan', lebar: 20 },
  ],
  selisih: [
    { kunci: 'no', label: 'No', rata: 'tengah', lebar: 5 },
    { kunci: 'nama', label: 'Deskripsi Barang', rata: 'kiri', lebar: 31 },
    { kunci: 'size', label: 'Size', rata: 'tengah', lebar: 6 },
    { kunci: 'status', label: 'Status (KURANG / LEBIH)', rata: 'tengah', lebar: 15 },
    { kunci: 'selisih', label: 'Qty Selisih (Psg)', rata: 'tengah', lebar: 13 },
    { kunci: 'harga', label: 'Harga Satuan', rata: 'kanan', lebar: 13 },
    { kunci: 'nominal', label: 'Nominal Selisih', rata: 'kanan', lebar: 17 },
  ],
};

export const LABEL_TOTAL_QTY: Record<VarianDokPo, string> = {
  penuh: 'Total Kuantitas',
  awal: 'Total Kuantitas Target',
  sisa: 'Total Kuantitas Sisa',
  lebih: 'Total Kuantitas Kelebihan',
  selisih: 'Total Kuantitas Selisih',
};

export const LABEL_NILAI_TOTAL: Record<VarianDokPo, string> = {
  penuh: 'Nilai Diterima',
  awal: 'Nilai Estimasi PO',
  sisa: 'Nilai Nominal Sisa',
  lebih: 'Nilai Nominal Kelebihan',
  selisih: 'Nilai Nominal Selisih',
};

export const JUDUL_RINGKASAN: Record<VarianDokPo, string> = {
  penuh: 'Ringkasan Status PO:',
  awal: 'Ringkasan PO Awal:',
  sisa: 'Ringkasan Sisa PO:',
  lebih: 'Ringkasan Kelebihan:',
  selisih: 'Ringkasan Selisih:',
};

export const PESAN_KOSONG = 'Tidak ada data barang untuk kategori ini';

export interface ItemDokPo {
  kode?: string | null;
  nama: string;
  size?: string | number | null;
  /** Qty target (pasang/pcs). */
  qty: number;
  harga: number;
  /** Qty fisik diterima (pasang/pcs). */
  datang?: number;
  luarPo?: boolean;
}

export interface BarisDokPo {
  no: number;
  kode: string;
  nama: string;
  size: string;
  luar: boolean;
  target: number;
  datang: number;
  /** target − datang (negatif = kelebihan). */
  sisa: number;
  kurang: number;
  lebih: number;
  /** |target − datang|. */
  selisih: number;
  status: 'KURANG' | 'LEBIH' | 'PAS';
  harga: number;
  /** Qty dasar nominal template ini. */
  qtyNominal: number;
  nominal: number;
}

const bulat = (n: unknown): number => Math.floor(Number(n) || 0);

/** Tebak size dari akhir nama barang ("Ab Biru 40" → "40"). */
const tebakSize = (nama: string): string => {
  const m = String(nama ?? '').match(/(\d+(?:[.,]\d+)?)\s*$/);
  return m ? m[1].replace(',', '.') : '—';
};

/** Bangun baris tabel sesuai filter template. */
export function bangunBarisDok(varian: VarianDokPo, items: ItemDokPo[]): BarisDokPo[] {
  const baris = items.map((it, idx) => {
    const target = Math.max(0, bulat(it.qty));
    const datang = Math.max(0, bulat(it.datang ?? 0));
    const sisa = target - datang;
    const kurang = Math.max(0, -sisa);
    const lebih = Math.max(0, sisa * -1);
    const selisih = Math.abs(sisa);
    const status: BarisDokPo['status'] = sisa > 0 ? 'KURANG' : sisa < 0 ? 'LEBIH' : 'PAS';
    const harga = Number(it.harga) || 0;
    const qtyNominal =
      varian === 'penuh'
        ? datang
        : varian === 'sisa'
          ? kurang
          : varian === 'lebih'
            ? lebih
            : varian === 'selisih'
              ? selisih
              : target;
    return {
      no: idx + 1,
      kode: String(it.kode ?? ''),
      nama: String(it.nama || '—'),
      size: String(it.size ?? tebakSize(String(it.nama ?? ''))),
      luar: it.luarPo === true,
      target,
      datang,
      sisa,
      kurang,
      lebih,
      selisih,
      status,
      harga,
      qtyNominal,
      nominal: qtyNominal * harga,
    };
  });
  const sesuai = (b: BarisDokPo): boolean => {
    // Barang Non-PO hanya relevan pada ringkasan lengkap.
    if (varian === 'sisa') return !b.luar && b.sisa > 0;
    if (varian === 'lebih') return !b.luar && b.sisa < 0;
    if (varian === 'selisih') return !b.luar && b.sisa !== 0;
    return true;
  };
  return baris.filter(sesuai).map((b, i) => ({ ...b, no: i + 1 }));
}

/** Teks sel tabel untuk satu baris. */
export function teksSel(kunci: KolomKunci, b: BarisDokPo): string {
  switch (kunci) {
    case 'no':
      return String(b.no);
    case 'nama':
      return b.nama;
    case 'size':
      return b.size;
    case 'target':
      return b.target.toLocaleString('id-ID');
    case 'datang':
      return b.datang.toLocaleString('id-ID');
    case 'sisa':
      return b.sisa.toLocaleString('id-ID');
    case 'lebih':
      return b.lebih.toLocaleString('id-ID');
    case 'selisih':
      return b.selisih.toLocaleString('id-ID');
    case 'status':
      return b.status;
    case 'harga':
      return formatRupiah(b.harga);
    case 'nominal':
      return formatRupiah(b.nominal);
  }
}

export interface RingkasDokPo {
  nominalTarget: number;
  totalTarget: number;
  totalDatang: number;
  totalQty: number;
  totalNominal: number;
  totalKurang: number;
  totalLebih: number;
  nominalKurang: number;
  nominalLebih: number;
}

export function ringkasDokPo(baris: BarisDokPo[]): RingkasDokPo {
  return baris.reduce<RingkasDokPo>(
    (r, b) => ({
      nominalTarget: r.nominalTarget + b.target * b.harga,
      totalTarget: r.totalTarget + b.target,
      totalDatang: r.totalDatang + b.datang,
      totalQty: r.totalQty + b.qtyNominal,
      totalNominal: r.totalNominal + b.nominal,
      totalKurang: r.totalKurang + b.kurang,
      totalLebih: r.totalLebih + b.lebih,
      nominalKurang: r.nominalKurang + b.kurang * b.harga,
      nominalLebih: r.nominalLebih + b.lebih * b.harga,
    }),
    {
      nominalTarget: 0,
      totalTarget: 0,
      totalDatang: 0,
      totalQty: 0,
      totalNominal: 0,
      totalKurang: 0,
      totalLebih: 0,
      nominalKurang: 0,
      nominalLebih: 0,
    },
  );
}

/** Kunci kolom kuantitas pada tfoot, per template. */
export const KOLOM_TOTAL_QTY: Record<VarianDokPo, KolomKunci[]> = {
  penuh: ['target', 'datang', 'sisa'],
  awal: ['target'],
  sisa: ['sisa'],
  lebih: ['lebih'],
  selisih: ['selisih'],
};

export interface RingkasanNominal {
  baris: { label: string; nilai: number }[];
  grandLabel: string;
  grand: number;
}

/** Ringkasan nominal kanan bawah — PPN hanya untuk template dokumen utuh. */
export function ringkasanNominalPo(
  varian: VarianDokPo,
  ringkas: RingkasDokPo,
  ppn: { aktif: boolean; persen: number },
): RingkasanNominal {
  const baris: { label: string; nilai: number }[] = [];
  if (varian === 'selisih') {
    baris.push({ label: 'Total Nominal Kurang', nilai: ringkas.nominalKurang });
    baris.push({ label: 'Total Nominal Lebih', nilai: ringkas.nominalLebih });
  } else {
    const label =
      varian === 'penuh'
        ? 'Subtotal Barang Diterima'
        : varian === 'awal'
          ? 'Subtotal Estimasi PO'
          : varian === 'sisa'
            ? 'Subtotal Nominal Sisa'
            : 'Subtotal Nominal Kelebihan';
    baris.push({ label, nilai: ringkas.totalNominal });
  }
  const tarif = ppn.aktif ? Math.max(0, Number(ppn.persen) || 0) : 0;
  if (tarif > 0 && (varian === 'penuh' || varian === 'awal')) {
    baris.push({ label: `PPN (${tarif.toLocaleString('id-ID')}%)`, nilai: Math.round(ringkas.totalNominal * (tarif / 100)) });
  }
  const grand = baris.reduce((n, r) => n + r.nilai, 0);
  const grandLabel =
    varian === 'penuh'
      ? 'Grand Total Tagihan'
      : varian === 'awal'
        ? 'Grand Total Estimasi PO'
        : varian === 'sisa'
          ? 'Grand Total Nominal Sisa PO'
          : varian === 'lebih'
            ? 'Grand Total Nominal Kelebihan'
            : 'Grand Total Nominal Selisih';
  return { baris, grandLabel, grand };
}

/** Baris ringkasan atas (kanan) — judul + pasangan label/nilai. */
export function metaRingkasanPo(
  varian: VarianDokPo,
  ringkas: RingkasDokPo,
  opts: { gudang?: string | null; kodiAktif: boolean; isiKodi: number },
): [string, string][] {
  const isi = opts.isiKodi > 0 ? opts.isiKodi : 20;
  const pasang = (n: number): string =>
    `${n.toLocaleString('id-ID')} Pasang${opts.kodiAktif ? ` / ${(n / isi).toFixed(1)} Kodi` : ''}`;
  if (varian === 'penuh') {
    const status =
      ringkas.totalDatang === ringkas.totalTarget
        ? 'PO Lengkap / Selesai (100%)'
        : ringkas.totalDatang > ringkas.totalTarget
          ? 'Selesai (Dengan Over-Delivery)'
          : 'Sebagian Diterima (Partial)';
    return [
      ['Status Pemenuhan:', status],
      ['Total Kuantitas Target:', pasang(ringkas.totalTarget)],
      ['Total Fisik Diterima:', pasang(ringkas.totalDatang)],
      ['Total Nilai Target PO:', formatRupiah(ringkas.nominalTarget)],
    ];
  }
  const gudang = String(opts.gudang || '—');
  if (varian === 'awal') {
    return [
      ['Gudang Tujuan:', gudang],
      ['Total Kuantitas Target:', pasang(ringkas.totalQty)],
      ['Total Estimasi PO:', formatRupiah(ringkas.totalNominal)],
    ];
  }
  if (varian === 'sisa') {
    return [
      ['Gudang Tujuan:', gudang],
      ['Total Kuantitas Sisa:', pasang(ringkas.totalQty)],
      ['Total Nominal Sisa PO:', formatRupiah(ringkas.totalNominal)],
    ];
  }
  if (varian === 'lebih') {
    return [
      ['Gudang Tujuan:', gudang],
      ['Total Kuantitas Kelebihan:', pasang(ringkas.totalQty)],
      ['Total Nominal Kelebihan:', formatRupiah(ringkas.totalNominal)],
    ];
  }
  return [
    ['Gudang Tujuan:', gudang],
    ['Total Kuantitas Selisih:', pasang(ringkas.totalQty)],
    ['Total Nominal Selisih:', formatRupiah(ringkas.nominalKurang + ringkas.nominalLebih)],
  ];
}

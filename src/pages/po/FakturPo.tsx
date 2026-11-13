// Dokumen faktur PO gaya Purchasing Executive Hub — dipakai di modal Detail PO
// (Laporan), area cetak Detail PO (PDF/Print), dan pengiriman PNG/WA ke vendor.
// Satu sumber tampilan agar layar, modal, cetak, dan ekspor selalu sama.
import { formatRupiah, formatTanggal } from '../../lib/format';
import {
  JUDUL_RINGKASAN,
  JUDUL_VARIAN,
  KOLOM_TOTAL_QTY,
  KOLOM_VARIAN,
  LABEL_NILAI_TOTAL,
  LABEL_TOTAL_QTY,
  PESAN_KOSONG,
  bangunBarisDok,
  metaRingkasanPo,
  ringkasDokPo,
  ringkasanNominalPo,
  teksSel,
  type ItemDokPo,
  type KolomKunci,
  type VarianDokPo,
} from './templateDokPo';

export interface FakturPoItem {
  kode: string;
  nama: string;
  /** Size terpisah bila ada; kosong → ditebak dari akhir nama ("Ab Biru 40" → 40). */
  size?: string | number | null;
  /** Qty dalam PASANG/PCS (base unit — harga & subtotal selalu berbasis ini). */
  qty: number;
  harga: number;
  /** Qty datang (PCS). Bila diisi, selisih vs qty ditandai Kurang/Kelebihan. */
  datang?: number;
  /** Barang luar PO (tidak tercantum di PO awal) — target dianggap 0. */
  luarPo?: boolean;
}

export interface FakturPoProps {
  /** Nama perusahaan — tampil besar di kop. */
  tokoNama: string;
  usahaAlamat?: string | null;
  usahaTelepon?: string | null;
  usahaEmail?: string | null;
  /** Teks badge kop (mis. jenis template kirim). */
  judul?: string;
  /** Baris kecil di bawah badge (mis. label template kirim). */
  subJudul?: string | null;
  noPo: string;
  tanggal: string;
  pemasokNama: string;
  pemasokAlamat?: string | null;
  pemasokTelepon?: string | null;
  gudang?: string | null;
  catatan?: string | null;
  items: FakturPoItem[];
  /** Barang datang di luar PO — ditampilkan di bawah baris barang PO. */
  luarPoItems?: FakturPoItem[];
  isiKodi: number;
  kodiAktif: boolean;
  /** PPN aktif untuk PO ini (`is_tax_enabled`). Bawaan: tidak aktif. */
  ppnAktif?: boolean;
  /** Tarif PPN dalam persen (bawaan 11). */
  ppnPersen?: number;
  /** Gaya ramping 80mm untuk pratinjau thermal (layar saja). */
  ramping?: boolean;
  /**
   * Template dokumen (bawaan 'penuh'): menentukan judul, filter baris, kolom,
   * dan dasar nominal. Lihat templateDokPo.ts.
   */
  template?: VarianDokPo;
  /**
   * Nomor PO induk bila dokumen ini PO susulan. Bila terisi, kop menampilkan
   * badge "PO SUSULAN" + baris "Ref. PO Induk" dan kotak pemasok menampilkan
   * "Jenis Pesanan: Tambahan / Susulan dari …". Kosong = PO normal.
   */
  refPoNomor?: string | null;
}

/** Baca flag PPN dari data PO (Postgres boolean / SQLite 0-1 / string). */
export function ppnAktifDari(po: Record<string, unknown> | null | undefined): boolean {
  const v = po?.is_tax_enabled;
  return v === true || v === 1 || v === '1' || v === 'true';
}

/* ------------------------- Ukuran kertas cetak ------------------------- */

export type UkuranKertasPo = 'A4' | 'Letter' | 'T80';

/* Faktur PO supplier SELALU dokumen A4/Letter resmi — layout struk thermal
   (T80/80mm) dilarang untuk dokumen ini. */
export const OPSI_KERTAS_PO: { kode: UkuranKertasPo; label: string }[] = [
  { kode: 'A4', label: 'A4 (Default)' },
  { kode: 'Letter', label: 'Letter' },
];

const KUNCI_KERTAS_PO = 'po_ukuran_kertas';

export function bacaKertasPo(): UkuranKertasPo {
  try {
    const v = localStorage.getItem(KUNCI_KERTAS_PO);
    if (v === 'Letter') return v;
  } catch { /* abaikan */ }
  return 'A4';
}

export function simpanKertasPo(u: UkuranKertasPo): void {
  try {
    localStorage.setItem(KUNCI_KERTAS_PO, u);
  } catch { /* abaikan */ }
}

/** Aturan @page untuk mode print/export PDF — A4 portrait sebagai bawaan. */
export function aturanKertasPo(u: UkuranKertasPo): string {
  if (u === 'Letter') return '@page { size: Letter portrait; margin: 12mm; }';
  if (u === 'T80') return '@page { size: 80mm auto; margin: 3mm; }';
  return '@page { size: A4 portrait; margin: 10mm 12mm 10mm 12mm; }';
}

/** Dropdown pilihan ukuran kertas — dipakai di Detail PO & modal Laporan. */
export function PilihKertasPo({ nilai, onUbah }: { nilai: UkuranKertasPo; onUbah: (u: UkuranKertasPo) => void }) {
  return (
    <label className="po-sebaris">
      <span>Kertas</span>
      <select
        value={nilai}
        onChange={(e) => onUbah(e.target.value as UkuranKertasPo)}
        aria-label="Ukuran kertas cetak"
        title="Ukuran kertas saat cetak / simpan PDF"
      >
        {OPSI_KERTAS_PO.map((o) => (
          <option key={o.kode} value={o.kode}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

const ANGKA = [
  '', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan',
  'sepuluh', 'sebelas',
];

/** 1500000 → "Satu juta lima ratus ribu rupiah" (port dari server/lib/faktur.ts). */
export function terbilangPo(nilai: number): string {
  const n = Math.floor(Math.abs(Number(nilai) || 0));
  if (n === 0) return 'Nol rupiah';
  const tulis = (x: number): string => {
    if (x < 12) return ANGKA[x];
    if (x < 20) return `${tulis(x - 10)} belas`;
    if (x < 100) return `${tulis(Math.floor(x / 10))} puluh${x % 10 ? ` ${tulis(x % 10)}` : ''}`;
    if (x < 200) return `seratus${x % 100 ? ` ${tulis(x % 100)}` : ''}`;
    if (x < 1000) return `${tulis(Math.floor(x / 100))} ratus${x % 100 ? ` ${tulis(x % 100)}` : ''}`;
    if (x < 2000) return `seribu${x % 1000 ? ` ${tulis(x % 1000)}` : ''}`;
    if (x < 1e6) return `${tulis(Math.floor(x / 1000))} ribu${x % 1000 ? ` ${tulis(x % 1000)}` : ''}`;
    if (x < 1e9) return `${tulis(Math.floor(x / 1e6))} juta${x % 1e6 ? ` ${tulis(x % 1e6)}` : ''}`;
    return `${tulis(Math.floor(x / 1e9))} miliar${x % 1e9 ? ` ${tulis(x % 1e9)}` : ''}`;
  };
  const kalimat = `${tulis(n)} rupiah`;
  return kalimat.charAt(0).toUpperCase() + kalimat.slice(1);
}

/** Sel Jumlah selalu satu baris: "5 Kodi (100 Psg)" vs "100 Psg". */
export function jumlahFaktur(qty: number, isiKodi: number, kodiAktif: boolean): string {
  const q = Math.max(0, Math.floor(Number(qty) || 0));
  if (!kodiAktif) return `${q.toLocaleString('id-ID')} Psg`;
  const per = isiKodi > 0 ? isiKodi : 20;
  const k = Math.floor(q / per);
  if (k <= 0) return `${q.toLocaleString('id-ID')} Psg`;
  return `${k.toLocaleString('id-ID')} Kodi (${q.toLocaleString('id-ID')} Psg)`;
}

/** Tebak size dari akhir nama barang ("Ab Biru 40" → "40"); "—" bila tak ada. */
export function sizeDariNama(nama: string): string {
  const m = String(nama ?? '').match(/(\d+(?:[.,]\d+)?)\s*$/);
  return m ? m[1].replace(',', '.') : '—';
}

/** Penanda selisih datang vs pesan — selalu tampil bila `datang` diisi. */
export function LencanaSelisihPo({ qty, datang }: { qty: number; datang: number }) {
  const selisih = Math.floor(Number(datang) || 0) - Math.floor(Number(qty) || 0);
  if (selisih === 0) return null;
  const abs = Math.abs(selisih).toLocaleString('id-ID');
  return selisih < 0 ? (
    <span className="lencana lencana--bahaya">Selisih: −{abs} Psg (Kurang)</span>
  ) : (
    <span className="lencana lencana--aktif">Selisih: +{abs} Psg (Kelebihan)</span>
  );
}

/** PPN dokumen faktur PO — mengikuti template hub (11%). */
export const PPN_PO = 0.11;

/* ------------------------- Floating action bar faktur ------------------------- */

/** Bar aksi melayang di kanan atas pratinjau faktur: cetak/PDF + kirim gambar.
    Disembunyikan otomatis saat cetak (CSS .po-invoice-aksi). */
export function AksiFakturPo({
  bisaCetak,
  sibuk,
  onCetak,
  onKirimGambar,
}: {
  bisaCetak: boolean;
  sibuk?: boolean;
  onCetak: () => void;
  onKirimGambar: () => void;
}) {
  return (
    <div className="po-invoice-aksi" role="toolbar" aria-label="Aksi faktur PO">
      <button
        type="button"
        className="hub-btn hub-btn--gelap"
        disabled={!bisaCetak || sibuk}
        onClick={onCetak}
        title={bisaCetak ? 'Cetak / simpan PDF (A4 pas 1 halaman)' : 'Anda tidak punya izin mencetak PO'}
      >
        🖨️ Print / Download PDF
      </button>
      <button
        type="button"
        className="hub-btn hub-btn--wa"
        disabled={!bisaCetak || sibuk}
        onClick={onKirimGambar}
        title={bisaCetak ? 'Render faktur sebagai gambar lalu kirim via WhatsApp' : 'Anda tidak punya izin mencetak PO'}
      >
        {sibuk ? 'Menyiapkan…' : '💬 WhatsApp'}
      </button>
    </div>
  );
}

const RATA: Record<'kiri' | 'tengah' | 'kanan', 'left' | 'center' | 'right'> = {
  kiri: 'left',
  tengah: 'center',
  kanan: 'right',
};

export function FakturPo(p: FakturPoProps) {
  const varian = p.template ?? 'penuh';
  const judul = p.judul ?? JUDUL_VARIAN[varian];
  const isi = p.isiKodi > 0 ? p.isiKodi : 20;
  const kolom = KOLOM_VARIAN[varian];
  const luarPo = p.luarPoItems ?? [];
  const inisial = (p.tokoNama || 'T').trim().charAt(0).toUpperCase();
  // Penanda PO susulan — otomatis untuk semua 5 template (cetak PDF & PNG WA).
  const refInduk = String(p.refPoNomor ?? '').trim();
  const susulan = refInduk !== '';

  // Barang Non-PO hanya ikut pada template "Ringkasan PO lengkap".
  const semua: ItemDokPo[] = [
    ...p.items.map((i) => ({
      kode: i.kode,
      nama: i.nama,
      size: i.size,
      qty: i.qty,
      harga: i.harga,
      datang: i.datang,
    })),
    ...(varian === 'penuh'
      ? luarPo.map((i) => ({
          kode: i.kode,
          nama: i.nama,
          size: i.size,
          qty: 0,
          harga: i.harga,
          datang: i.datang,
          luarPo: true,
        }))
      : []),
  ];
  const baris = bangunBarisDok(varian, semua);
  const ringkas = ringkasDokPo(baris);
  const nominal = ringkasanNominalPo(varian, ringkas, {
    aktif: p.ppnAktif === true,
    persen: Number(p.ppnPersen ?? 11),
  });
  const meta = metaRingkasanPo(varian, ringkas, {
    gudang: p.gudang,
    kodiAktif: p.kodiAktif,
    isiKodi: isi,
  });

  /** Nilai footer tabel untuk kolom kuantitas. */
  const totalKolom = (k: KolomKunci): string => {
    switch (k) {
      case 'target':
        return ringkas.totalTarget.toLocaleString('id-ID');
      case 'datang':
        return ringkas.totalDatang.toLocaleString('id-ID');
      case 'sisa':
        return (ringkas.totalTarget - ringkas.totalDatang).toLocaleString('id-ID');
      case 'lebih':
        return ringkas.totalLebih.toLocaleString('id-ID');
      case 'selisih':
        return ringkas.totalQty.toLocaleString('id-ID');
      default:
        return '';
    }
  };
  const kunciQty = KOLOM_TOTAL_QTY[varian];
  const idxQty = Math.max(0, kolom.findIndex((k) => kunciQty.includes(k.kunci)));

  return (
    <div className={`hub-a4 po-invoice-container${p.ramping ? ' po-faktur--t80' : ''}`}>
      <div className="hub-a4__kop">
        <div className="hub-a4__brand">
          <span className="hub-a4__logo" aria-hidden="true">{inisial}</span>
          <div>
            <h4>{p.tokoNama || 'Toko'}</h4>
            {[p.usahaAlamat, [p.usahaTelepon ? `Telp: ${p.usahaTelepon}` : '', p.usahaEmail ?? ''].filter(Boolean).join(' | ')]
              .filter(Boolean)
              .map((t, i) => (
                <p key={i}>{t}</p>
              ))}
          </div>
        </div>
        <div className="hub-a4__badge">
          <div className="hub-a4__badge-judul">
            {susulan && <span className="hub-a4__susulan">PO SUSULAN</span>}
            <span>{judul}</span>
          </div>
          <strong>{p.noPo}</strong>
          <small>Tanggal: {formatTanggal(p.tanggal)}</small>
          {susulan && <small className="hub-a4__ref">Ref. PO Induk: {refInduk}</small>}
        </div>
      </div>

      <div className="hub-a4__meta">
        <div>
          <h5>Pemasok / Supplier:</h5>
          <div className="nama">{p.pemasokNama || '—'}</div>
          {p.pemasokAlamat && <p>{p.pemasokAlamat}</p>}
          {p.pemasokTelepon && <p>Kontak: {p.pemasokTelepon}</p>}
          <p>Gudang Tujuan: {p.gudang || '—'}</p>
          {susulan && (
            <p className="hub-a4__jenis">Jenis Pesanan: Tambahan / Susulan dari {refInduk}</p>
          )}
        </div>
        <div className="kanan">
          <h5>{JUDUL_RINGKASAN[varian]}</h5>
          {meta.map(([label, nilai]) => (
            <div className="baris" key={label}>
              <span>{label}</span>
              <span>{nilai}</span>
            </div>
          ))}
        </div>
      </div>

      <table className="hub-a4__tabel">
        <colgroup>
          {kolom.map((k) => (
            <col key={k.kunci} style={{ width: `${k.lebar}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {kolom.map((k) => (
              <th key={k.kunci} style={{ textAlign: RATA[k.rata] }}>{k.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {baris.length === 0 && (
            <tr>
              <td colSpan={kolom.length} style={{ textAlign: 'center' }}>{PESAN_KOSONG}</td>
            </tr>
          )}
          {baris.map((b) => (
            <tr key={`${b.kode}-${b.no}`} className={b.luar ? 'hub-a4__baris-luar' : undefined}>
              {kolom.map((k) => {
                const sembunyi = b.luar && (k.kunci === 'target' || k.kunci === 'sisa' || k.kunci === 'selisih');
                const nilai = sembunyi ? '—' : teksSel(k.kunci, b);
                if (k.kunci === 'nama') {
                  return (
                    <td key={k.kunci}>
                      <strong>{b.nama}</strong>
                      {b.luar && ' '}
                      {b.luar && <span className="hub-a4__badge-luar">Non-PO</span>}
                    </td>
                  );
                }
                if (k.kunci === 'status') {
                  return (
                    <td key={k.kunci} style={{ textAlign: 'center', fontWeight: 800, color: b.status === 'LEBIH' ? '#1d4ed8' : '#b45309' }}>
                      {b.status}
                    </td>
                  );
                }
                return (
                  <td
                    key={k.kunci}
                    style={{
                      textAlign: RATA[k.rata],
                      fontWeight: k.kunci === 'size' || k.kunci === 'nominal' ? 700 : undefined,
                    }}
                  >
                    {nilai}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={idxQty} style={{ textAlign: 'right', textTransform: 'uppercase', fontSize: '10px' }}>
              {LABEL_TOTAL_QTY[varian]}:
            </td>
            {idxQty > 0 &&
              kolom.slice(idxQty).map((k) => {
                if (kunciQty.includes(k.kunci)) {
                  return (
                    <td key={k.kunci} style={{ textAlign: 'center', fontWeight: 800 }}>{totalKolom(k.kunci)}</td>
                  );
                }
                if (k.kunci === 'nominal') {
                  return (
                    <td key={k.kunci} style={{ textAlign: 'right', textTransform: 'uppercase', fontSize: '10px' }}>
                      {LABEL_NILAI_TOTAL[varian]}: {formatRupiah(ringkas.totalNominal)}
                    </td>
                  );
                }
                return <td key={k.kunci}></td>;
              })}
          </tr>
        </tfoot>
      </table>

      <div className="hub-a4__bawah">
        <div className="hub-a4__catatan">
          <h5>Catatan &amp; Rekonsiliasi Pengiriman:</h5>
          {p.catatan && p.catatan.trim() ? (
            <p className="hub-a4__catatan-isi">{p.catatan.trim()}</p>
          ) : (
            <p className="hub-a4__catatan-kosong">Catatan: -</p>
          )}
          {luarPo.length > 0 && varian === 'penuh' && (
            <p className="hub-a4__catatan-nonpo">
              * Tanda [Non-PO] menunjukkan item yang tidak tercantum dalam PO awal namun diterima di fisik gudang.
            </p>
          )}
        </div>
        <div className="hub-a4__total">
          {nominal.baris.map((r) => (
            <div className="baris" key={r.label}>
              <span>{r.label}:</span>
              <strong>{formatRupiah(r.nilai)}</strong>
            </div>
          ))}
          <div className="grand">
            <span>{nominal.grandLabel}:</span>
            <strong>{formatRupiah(nominal.grand)}</strong>
          </div>
        </div>
      </div>

      <div className="hub-a4__ttd">
        <div className="hub-a4__ttd-grid">
          <div>
            <p className="jabatan">Dibuat Oleh (Purchasing)</p>
            <p className="nama">( Staff Purchasing )</p>
          </div>
          <div>
            <p className="jabatan">Pemeriksa (Gudang)</p>
            <p className="nama">( Kepala Gudang )</p>
          </div>
          <div>
            <p className="jabatan">Disetujui Pemasok</p>
            <p className="nama">( {p.pemasokNama || '—'} )</p>
          </div>
        </div>
        <p className="hub-a4__kaki">
          Dokumen ini dibuat otomatis oleh Sistem Purchasing Executive pada {new Date().toLocaleString('id-ID')}. Valid tanpa tanda tangan basah jika dicetak elektronik.
        </p>
      </div>
    </div>
  );
}

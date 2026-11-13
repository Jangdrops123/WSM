import type { ReactNode } from 'react';
import { Modal } from '../crud/Modal';
import { formatRupiah, formatTanggal } from '../../lib/format';
import './rincian-retur.css';

/** Satu baris barang pada dokumen retur (penjualan maupun pembelian). */
export interface ItemRetur {
  product_name: string;
  sku: string;
  qty_returned: number;
  unit_price: number;
  subtotal: number;
}

/**
 * Rincian barang retur versi ringkas untuk sel tabel: dua barang pertama
 * sebagai chip, sisanya dibuka lewat tombol "+ N barang lainnya…".
 * Dipakai halaman Retur Penjualan dan Retur Pembelian agar seragam.
 */
export function RincianBarangRetur({ items, onBuka }: { items?: ItemRetur[]; onBuka: () => void }) {
  const daftar = items ?? [];
  if (daftar.length === 0) return <span className="teks-redup">—</span>;
  const tampil = daftar.slice(0, 2);
  const sisa = daftar.length - tampil.length;
  return (
    <div className="rincian-retur">
      {tampil.map((i, n) => (
        <span className="rincian-retur__chip" key={`${i.sku}-${n}`}>
          {i.product_name}
          <em>({i.qty_returned} pcs)</em>
        </span>
      ))}
      {sisa > 0 && (
        <button type="button" className="rincian-retur__lebih" onClick={onBuka}>
          + {sisa} barang lainnya…
        </button>
      )}
    </div>
  );
}

export interface InfoRetur {
  label: string;
  nilai: string;
}

const LENCANA_STATUS: Record<string, string> = {
  disahkan: 'lencana--aktif',
  draft: 'lencana--netral',
  batal: 'lencana--bahaya',
};

/**
 * Modal Detail Dokumen Retur: identitas dokumen, tabel barang yang diretur,
 * lalu total + status di kaki modal. Satu komponen untuk penjualan & pembelian.
 */
export function ModalDetailRetur({
  judul,
  dokumen,
  info,
  total,
  status,
  pengembalian,
  onTutup,
}: {
  judul: string;
  dokumen: { no_dokumen: string; tanggal: string; alasan?: string | null; items?: ItemRetur[] };
  /** Baris identitas tambahan (No. penjualan, pelanggan, kasir, pemasok, …). */
  info?: InfoRetur[];
  total: number;
  status: string;
  /** Keterangan pengembalian dana (akun kas / piutang) bila diketahui. */
  pengembalian?: string | null;
  onTutup: () => void;
}) {
  const items = dokumen.items ?? [];
  const totalQty = items.reduce((n, i) => n + Number(i.qty_returned ?? 0), 0);
  return (
    <Modal
      judul={judul}
      lebar="lebar"
      onTutup={onTutup}
      aksi={
        <button type="button" className="tombol" onClick={onTutup}>
          Tutup
        </button>
      }
    >
      <div className="retur-detail">
        <div className="retur-detail__info">
          <div>
            <span>No. Retur</span>
            <b>{dokumen.no_dokumen}</b>
          </div>
          <div>
            <span>Tanggal</span>
            <b>{formatTanggal(dokumen.tanggal)}</b>
          </div>
          {(info ?? []).map((x) => (
            <div key={x.label}>
              <span>{x.label}</span>
              <b>{x.nilai}</b>
            </div>
          ))}
          <div>
            <span>Alasan Retur</span>
            <b>{dokumen.alasan || '—'}</b>
          </div>
        </div>

        <div className="retur-detail__tabel">
          <table className="tabel">
            <colgroup>
              <col style={{ width: '14%' }} />
              <col style={{ width: '34%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '20%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Nama Produk</th>
                <th className="kolom-qty">Qty Retur</th>
                <th className="rata-kanan">Harga Satuan</th>
                <th className="rata-kanan">Subtotal Retur</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className="tabel-kosong">
                    Rincian barang tidak tercatat untuk retur ini.
                  </td>
                </tr>
              )}
              {items.map((i, n) => (
                <tr key={`${i.sku}-${n}`}>
                  <td>
                    <code>{i.sku || '—'}</code>
                  </td>
                  <td>{i.product_name}</td>
                  <td className="kolom-qty">{i.qty_returned}</td>
                  <td className="rata-kanan">{formatRupiah(Number(i.unit_price))}</td>
                  <td className="rata-kanan">{formatRupiah(Number(i.subtotal))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="retur-detail__kaki">
          <div>
            <span>Total Qty Retur</span>
            <b>{totalQty.toLocaleString('id-ID')} pcs</b>
          </div>
          <div>
            <span>Status</span>
            <b>
              <span className={`lencana ${LENCANA_STATUS[status] ?? 'lencana--netral'}`}>{status}</span>
            </b>
          </div>
          {pengembalian ? (
            <div>
              <span>Pengembalian</span>
              <b>{pengembalian}</b>
            </div>
          ) : null}
          <div>
            <span>Total Nominal Retur</span>
            <b className="retur-detail__total">{formatRupiah(Number(total))}</b>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** Pembungkus kecil agar pemakaian di tabel tetap terbaca. */
export function SelRincian({ children }: { children: ReactNode }) {
  return <div className="sel-rincian">{children}</div>;
}

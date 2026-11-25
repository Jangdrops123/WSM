// Riwayat kedatangan barang per tanggal (GRN) — satu tampilan untuk panel
// Laporan PO, pratinjau faktur, cetak/PDF, dan gambar PNG WhatsApp.
// Sumber data: `riwayat_kedatangan` dari GET /api/po/:id (server/routes/po.ts).
import { Icon } from '../../components/Icon';
import { formatRupiah, formatTanggalWaktu } from '../../lib/format';

export interface RiwayatItemKedatangan {
  product_id?: number;
  product_name: string;
  size?: string | null;
  qty_received: number;
  unit_price: number;
  subtotal: number;
}

export interface RiwayatKedatangan {
  receipt_id: number;
  /** Nomor PO asal (diisi pada laporan gabungan induk + susulan). */
  no_po?: string | null;
  receipt_no: string;
  received_date: string;
  received_date_wib?: string | null;
  received_by?: string | null;
  notes?: string | null;
  total_qty?: number;
  total_nilai?: number;
  items: RiwayatItemKedatangan[];
}

const angka = (n: unknown): number => {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
};

/** Tanggal & jam kedatangan dalam WIB — "22/11/2026 14:30 WIB". */
export function waktuKedatangan(r: RiwayatKedatangan): string {
  const siap = String(r.received_date_wib ?? '').trim();
  if (siap) return siap;
  const t = formatTanggalWaktu(r.received_date);
  return t === '—' ? t : `${t} WIB`;
}

/** Total qty datang satu kedatangan (dari server, atau dihitung ulang). */
export function totalQtyKedatangan(r: RiwayatKedatangan): number {
  const dariServer = angka(r.total_qty);
  if (dariServer > 0) return dariServer;
  return r.items.reduce((n, it) => n + angka(it.qty_received), 0);
}

/** Total nilai datang satu kedatangan (unit price × qty diterima). */
export function totalNilaiKedatangan(r: RiwayatKedatangan): number {
  const dariServer = angka(r.total_nilai);
  if (dariServer > 0) return dariServer;
  return r.items.reduce((n, it) => n + angka(it.subtotal), 0);
}

/** Ambil & rapikan `riwayat_kedatangan` dari respons API (aman untuk data lama). */
export function riwayatDari(po: Record<string, unknown> | null | undefined): RiwayatKedatangan[] {
  const mentah = (po?.riwayat_kedatangan ?? po?.receipt_batches) as unknown;
  if (!Array.isArray(mentah)) return [];
  return mentah
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r, i) => ({
      receipt_id: angka(r.receipt_id) || i + 1,
      no_po: r.no_po ? String(r.no_po) : null,
      receipt_no: String(r.receipt_no ?? '—'),
      received_date: String(r.received_date ?? ''),
      received_date_wib: r.received_date_wib ? String(r.received_date_wib) : null,
      received_by: r.received_by ? String(r.received_by) : null,
      notes: r.notes ? String(r.notes) : null,
      total_qty: angka(r.total_qty),
      total_nilai: angka(r.total_nilai),
      items: (Array.isArray(r.items) ? (r.items as Record<string, unknown>[]) : []).map((it) => ({
        product_id: angka(it.product_id),
        product_name: String(it.product_name ?? '—'),
        size: it.size ? String(it.size) : null,
        qty_received: angka(it.qty_received),
        unit_price: angka(it.unit_price),
        subtotal: angka(it.subtotal),
      })),
    }));
}

/**
 * Blok rincian kedatangan per tanggal.
 * `layar` menandai salinan khusus layar (disembunyikan saat mencetak) agar
 * dokumen cetak tidak memuat rincian dua kali.
 */
export function RiwayatKedatanganPo({ data, layar = false }: { data: RiwayatKedatangan[]; layar?: boolean }) {
  const kelas = `po-riwayat${layar ? ' po-riwayat--layar' : ''}`;
  if (data.length === 0) {
    return (
      <div className={`${kelas} po-riwayat--kosong`}>
        <Icon nama="box" size={15} /> Belum ada riwayat kedatangan barang untuk PO ini.
      </div>
    );
  }
  return (
    <section className={kelas} aria-label="Riwayat kedatangan barang per tanggal">
      <h4 className="po-riwayat__judul">
        <Icon nama="box" size={15} /> Riwayat Kedatangan Barang per Tanggal ({data.length}x Penerimaan)
      </h4>
      {data.map((r, i) => {
        const qty = totalQtyKedatangan(r);
        const nilai = totalNilaiKedatangan(r);
        return (
          <div className="po-riwayat__blok" key={`${r.receipt_id}-${i}`}>
            <div className="po-riwayat__kepala">
              <span className="po-riwayat__nomor">Kedatangan #{i + 1}</span>
              <span className="po-riwayat__tanggal"><Icon nama="calendar" size={13} /> {waktuKedatangan(r)}</span>
              <span>No. Penerimaan (GRN): <strong>{r.receipt_no}</strong></span>
              <span>Total Qty Datang: <strong>{qty.toLocaleString('id-ID')} pcs</strong></span>
              {r.no_po ? <span>PO: <strong>{r.no_po}</strong></span> : null}
              {r.received_by && r.received_by !== '—' ? <span>Penerima: {r.received_by}</span> : null}
            </div>
            {r.notes ? <p className="po-riwayat__catatan"><Icon nama="file-text" size={13} /> {r.notes}</p> : null}
            <table className="po-riwayat__tabel">
              <colgroup>
                <col style={{ width: '5%' }} />
                <col style={{ width: '41%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '18%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ textAlign: 'center' }}>No</th>
                  <th style={{ textAlign: 'left' }}>Nama Barang</th>
                  <th style={{ textAlign: 'center' }}>Size</th>
                  <th style={{ textAlign: 'right' }}>Qty Datang</th>
                  <th style={{ textAlign: 'right' }}>Harga</th>
                  <th style={{ textAlign: 'right' }}>Subtotal Datang</th>
                </tr>
              </thead>
              <tbody>
                {r.items.map((it, j) => (
                  <tr key={`${r.receipt_id}-${it.product_id ?? j}-${j}`}>
                    <td style={{ textAlign: 'center' }}>{j + 1}</td>
                    <td>{it.product_name}</td>
                    <td style={{ textAlign: 'center' }}>{it.size || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{angka(it.qty_received).toLocaleString('id-ID')}</td>
                    <td style={{ textAlign: 'right' }}>{formatRupiah(angka(it.unit_price))}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatRupiah(angka(it.subtotal))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} style={{ textAlign: 'right' }}>TOTAL KEDATANGAN #{i + 1}</td>
                  <td style={{ textAlign: 'right' }}>{qty.toLocaleString('id-ID')}</td>
                  <td />
                  <td style={{ textAlign: 'right' }}>{formatRupiah(nilai)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        );
      })}
    </section>
  );
}

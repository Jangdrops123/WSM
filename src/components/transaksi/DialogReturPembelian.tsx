import { useState } from 'react';
import { Modal } from '../crud/Modal';
import { formatRupiah } from '../../lib/format';

export interface ItemReturTersedia {
  product_id: number;
  nama: string;
  sku: string;
  /** Qty maksimal yang masih boleh diretur (satuan dokumen). */
  qty_maks: number;
  harga: number;
}

/**
 * Form retur pembelian: pilih qty per barang yang dikembalikan ke pemasok.
 * Dipakai modul Pembelian dan PO (retur dijalankan pada faktur hasil PO).
 */
export function DialogReturPembelian({
  judul,
  deskripsi,
  items,
  sibuk = false,
  onKirim,
  onTutup,
}: {
  judul: string;
  deskripsi: string;
  items: ItemReturTersedia[];
  sibuk?: boolean;
  onKirim: (items: { product_id: number; qty: number }[], alasan: string) => void | Promise<void>;
  onTutup: () => void;
}) {
  const [qty, setQty] = useState<Record<number, string>>(() => {
    const awal: Record<number, string> = {};
    for (const it of items) awal[it.product_id] = '';
    return awal;
  });
  const [alasan, setAlasan] = useState('');

  const baris = items.map((it) => {
    const n = Math.max(0, Math.min(Number(qty[it.product_id]) || 0, it.qty_maks));
    return { ...it, qty: n };
  });
  const dipilih = baris.filter((b) => b.qty > 0);
  const total = dipilih.reduce((a, b) => a + b.qty * b.harga, 0);
  const siap = dipilih.length > 0 && alasan.trim().length > 0;

  return (
    <Modal
      judul={judul}
      lebar="lebar"
      kelas="modal--retur-beli"
      onTutup={onTutup}
      sedangKirim={sibuk}
      aksi={
        <>
          <button type="button" className="tombol tombol--netral" onClick={onTutup} disabled={sibuk}>
            Kembali
          </button>
          <button
            type="button"
            className="tombol tombol--primer"
            disabled={!siap || sibuk}
            onClick={() => void onKirim(dipilih.map((d) => ({ product_id: d.product_id, qty: d.qty })), alasan.trim())}
          >
            {sibuk ? 'Menyimpan…' : 'Simpan Retur'}
          </button>
        </>
      }
    >
      {/* Satu kolom vertikal: tabel item (100%) → alasan retur → ringkasan.
          Tidak ada grid 2 kolom/scroll internal sempit yang memotong tabel. */}
      <div className="retur-beli">
        <p className="teks-redup teks-kecil">{deskripsi}</p>

        <div className="retur-beli__tabel">
          <table className="tabel tabel--retur tabel-transaksi">
            <colgroup>
              <col style={{ width: '45%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '17%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Nama Barang</th>
                <th className="rata-tengah">Bisa Diretur</th>
                <th className="rata-kanan">Harga</th>
                <th className="rata-tengah">Qty Retur</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td className="tabel-kosong" colSpan={4}>
                    Tidak ada barang yang bisa diretur pada dokumen ini.
                  </td>
                </tr>
              ) : (
                baris.map((it) => (
                  <tr key={it.product_id}>
                    <td className="retur-beli__nama">
                      <span className="retur-beli__judul">{it.nama}</span>
                      {it.sku && <span className="retur-beli__sku">{it.sku}</span>}
                    </td>
                    <td className="rata-tengah">{it.qty_maks.toLocaleString('id-ID')}</td>
                    <td className="rata-kanan">{formatRupiah(it.harga)}</td>
                    <td className="rata-tengah">
                      <input
                        className="retur-beli__qty"
                        name="qty"
                        type="number"
                        min={0}
                        max={it.qty_maks}
                        value={qty[it.product_id]}
                        placeholder="0"
                        onChange={(e) => setQty((q) => ({ ...q, [it.product_id]: e.target.value }))}
                        aria-label={`Qty retur ${it.nama} (maks. ${it.qty_maks})`}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <label className="bidang retur-beli__alasan">
          <span>Alasan retur *</span>
          <textarea
            value={alasan}
            rows={3}
            maxLength={500}
            placeholder="mis. barang rusak / salah kirim dari pemasok"
            onChange={(e) => setAlasan(e.target.value)}
          />
        </label>

        <p className="teks-redup teks-kecil retur-beli__ringkas">
          Nilai retur: <strong>{formatRupiah(total)}</strong> — stok keluar dari gudang dokumen dan hutang pemasok berkurang.
        </p>
      </div>
    </Modal>
  );
}

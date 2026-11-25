import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '../../lib/api';
import { beritahu } from '../../components/crud/Toast';
import { IconButton } from '../../components/IconButton';
import { useSegarkanModul } from '../../lib/segarkan';
import { formatRupiah, formatTanggal } from '../../lib/format';
import { ModalDetailRetur, RincianBarangRetur, type ItemRetur } from '../../components/transaksi/RincianRetur';

interface BarisReturBeli {
  id: number;
  no_dokumen: string;
  tanggal: string;
  alasan: string | null;
  total: number;
  status: string;
  no_pembelian: string | null;
  no_po: string | null;
  pemasok: string | null;
  pembuat: string | null;
  items?: ItemRetur[];
}

const lencanaStatus = (status: string): string =>
  status === 'disahkan' ? 'lencana--aktif' : status === 'batal' ? 'lencana--bahaya' : 'lencana--netral';

/**
 * Pembelian ▸ Retur — daftar retur pembelian beserta rincian barangnya.
 * Pembuatan retur pembelian sudah tidak tersedia; halaman ini menampilkan
 * riwayat dokumen lama: kolom "Rincian Barang" ringkas + modal Detail Dokumen.
 */
export function ReturPembelianPage() {
  const [baris, setBaris] = useState<BarisReturBeli[]>([]);
  const [sibuk, setSibuk] = useState(true);
  const [detail, setDetail] = useState<BarisReturBeli | null>(null);

  const muat = useCallback(() => {
    setSibuk(true);
    return apiGet<{ data: BarisReturBeli[] }>('/api/pembelian/returns?per=100')
      .then((r) => setBaris(r.data))
      .catch((e: Error) => beritahu(e.message, 'galat'))
      .finally(() => setSibuk(false));
  }, []);

  useEffect(() => {
    void muat();
  }, [muat]);
  // Tombol Refresh global di topbar: muat ulang daftar retur pembelian.
  useSegarkanModul(muat);

  const totalNilai = baris.reduce((n, b) => n + Number(b.total ?? 0), 0);

  return (
    <div className="halaman">
      <section className="kartu">
        <div className="kartu__kepala kartu__kepala--kompak">
          <div>
            <h3>Retur Pembelian</h3>
            <p className="teks-redup teks-kecil">
              Daftar retur pembelian beserta barang yang dikembalikan ke pemasok.
            </p>
          </div>
          <span className="teks-redup teks-kecil">
            {baris.length} retur · total <strong>{formatRupiah(totalNilai)}</strong>
          </span>
        </div>

        <div className="tabel-bungkus">
          <table className="tabel">
            <thead>
              <tr>
                <th>No. Retur</th>
                <th>Tanggal</th>
                <th>No. Pembelian</th>
                <th>Pemasok</th>
                <th>Alasan</th>
                <th>Rincian Barang</th>
                <th className="rata-kanan">Total</th>
                <th>Status</th>
                <th className="rata-kanan">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {sibuk && baris.length === 0 ? (
                <tr>
                  <td className="tabel-kosong" colSpan={9}>
                    Memuat…
                  </td>
                </tr>
              ) : baris.length === 0 ? (
                <tr>
                  <td className="tabel-kosong" colSpan={9}>
                    Belum ada retur pembelian. Daftar ini menampilkan riwayat retur pembelian yang pernah tercatat.
                  </td>
                </tr>
              ) : (
                baris.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <code>{b.no_dokumen}</code>
                    </td>
                    <td className="whitespace-nowrap">{formatTanggal(b.tanggal)}</td>
                    <td>{b.no_pembelian ?? b.no_po ?? '—'}</td>
                    <td>{b.pemasok ?? '—'}</td>
                    <td>{b.alasan ?? '—'}</td>
                    <td>
                      <RincianBarangRetur items={b.items} onBuka={() => setDetail(b)} />
                    </td>
                    <td className="rata-kanan whitespace-nowrap">{formatRupiah(Number(b.total))}</td>
                    <td>
                      <span className={`lencana ${lencanaStatus(b.status)}`}>{b.status}</span>
                    </td>
                    <td className="rata-kanan">
                      <IconButton
                        label={`Detail retur ${b.no_dokumen}`}
                        ikon="eye"
                        ukuran="baris"
                        onClick={() => setDetail(b)}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {detail && (
        <ModalDetailRetur
          judul={`Detail Retur ${detail.no_dokumen}`}
          dokumen={{
            no_dokumen: detail.no_dokumen,
            tanggal: detail.tanggal,
            alasan: detail.alasan,
            items: detail.items,
          }}
          info={[
            { label: 'No. Pembelian', nilai: detail.no_pembelian ?? detail.no_po ?? '—' },
            { label: 'Pemasok', nilai: detail.pemasok ?? '—' },
            { label: 'Dicatat oleh', nilai: detail.pembuat ?? '—' },
          ]}
          total={Number(detail.total)}
          status={detail.status}
          onTutup={() => setDetail(null)}
        />
      )}
    </div>
  );
}

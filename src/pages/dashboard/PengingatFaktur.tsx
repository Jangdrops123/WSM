import { useState } from 'react';
import { IconButton } from '../../components/IconButton';
import { Icon } from '../../components/Icon';
import { beritahu } from '../../components/crud/Toast';
import { apiPut } from '../../lib/api';
import { formatRupiah, formatTanggal } from '../../lib/format';
import { DialogWa } from '../faktur/DialogWa';
import type { BarisPengingat, DataPengingat } from './tipe';

const LABEL_URGENSI: Record<BarisPengingat['urgensi'], string> = {
  terlambat: 'Terlambat',
  dekat: 'Perlu diingat',
  aman: 'Masih lama',
};

/** Isi pesan pengingat WhatsApp (faktur, sisa tagihan, jatuh tempo). */
function pesanPengingat(b: BarisPengingat): string {
  return [
    `Halo ${b.pihak},`,
    '',
    `Pengingat pembayaran faktur *${b.no_faktur}* senilai *${formatRupiah(b.sisa)}*${
      b.jatuh_tempo ? ` (jatuh tempo ${formatTanggal(b.jatuh_tempo)})` : ''
    }.`,
    b.urgensi === 'terlambat'
      ? 'Mohon maaf, pembayaran sudah melewati jatuh tempo — mohon segera diselesaikan. Terima kasih.'
      : 'Mohon melakukan pembayaran sebelum jatuh tempo. Terima kasih.',
  ].join('\n');
}

/**
 * Kartu "Pengingat Faktur Belum Lunas": daftar piutang penjualan + hutang
 * pembelian yang belum lunas, dengan penanda urgensi (terlambat = merah,
 * menjelang jatuh tempo = kuning), aksi kirim WhatsApp & catat pembayaran,
 * serta pengaturan pengingat (1/3/7 hari + harian setelah terlambat).
 */
export function PengingatFaktur({
  data,
  onBayar,
  onMuatUlang,
}: {
  data: DataPengingat;
  onBayar: (baris: BarisPengingat, tipe: 'piutang' | 'hutang') => void;
  onMuatUlang: () => void;
}) {
  const [tab, setTab] = useState<'piutang' | 'hutang'>('piutang');
  const [wa, setWa] = useState<BarisPengingat | null>(null);
  const [menyimpan, setMenyimpan] = useState(false);

  const daftar = tab === 'piutang' ? data.piutang : data.hutang;

  async function simpanPengaturan(patch: { hari_sebelum?: number; terlambat_harian?: boolean }) {
    setMenyimpan(true);
    try {
      await apiPut('/api/dashboard/pengingat-pengaturan', {
        hari_sebelum: patch.hari_sebelum ?? data.pengaturan.hariSebelum,
        terlambat_harian: patch.terlambat_harian ?? data.pengaturan.terlambatHarian,
      });
      window.dispatchEvent(new CustomEvent('pengingat-berubah'));
      onMuatUlang();
    } catch (e) {
      beritahu(e instanceof Error ? e.message : 'Gagal menyimpan pengaturan pengingat.', 'galat');
    } finally {
      setMenyimpan(false);
    }
  }

  return (
    <section className="kartu">
      <div className="kartu__kepala kartu__kepala--kompak">
        <h3>Pengingat Faktur Belum Lunas</h3>
        <span className="teks-redup">
          {data.terlambat > 0
            ? `${data.terlambat} faktur terlambat`
            : 'Tidak ada faktur terlambat'}
        </span>
      </div>

      <div className="pengingat__alat" style={{ marginBottom: 14 }}>
        <div className="pengingat-tab">
          <button type="button" className={tab === 'piutang' ? 'aktif' : ''} onClick={() => setTab('piutang')}>
            Piutang ({data.piutang.length})
          </button>
          <button type="button" className={tab === 'hutang' ? 'aktif' : ''} onClick={() => setTab('hutang')}>
            Hutang ({data.hutang.length})
          </button>
        </div>

        <div className="pengingat__setelan">
          <span>Ingatkan</span>
          <select
            value={data.pengaturan.hariSebelum}
            disabled={menyimpan}
            onChange={(e) => void simpanPengaturan({ hari_sebelum: Number(e.target.value) })}
          >
            <option value={1}>1 hari sebelum jatuh tempo</option>
            <option value={3}>3 hari sebelum jatuh tempo</option>
            <option value={7}>7 hari sebelum jatuh tempo</option>
          </select>
          <label>
            <input
              type="checkbox"
              checked={data.pengaturan.terlambatHarian}
              disabled={menyimpan}
              onChange={(e) => void simpanPengaturan({ terlambat_harian: e.target.checked })}
            />
            setiap hari setelah terlambat
          </label>
          <IconButton ikon="rotate-ccw" label="Muat ulang pengingat" onClick={onMuatUlang} />
        </div>
      </div>

      {daftar.length === 0 ? (
        <p className="pengingat-kosong">
          <Icon nama="circle-check" size={18} />
          {tab === 'piutang'
            ? 'Semua piutang penjualan sudah lunas — tidak ada tagihan yang perlu diingatkan.'
            : 'Semua hutang pembelian sudah lunas — tidak ada tagihan yang perlu diingatkan.'}
        </p>
      ) : (
        <div className="dash-tabel-wrap">
          <table className="dash-tabel">
            <thead>
              <tr>
                <th>{tab === 'piutang' ? 'Pelanggan' : 'Pemasok'}</th>
                <th>Faktur</th>
                <th>Jatuh Tempo</th>
                <th className="kanan">Sisa Tagihan</th>
                <th>Status</th>
                <th className="kanan">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {daftar.map((b) => (
                <tr key={b.id} className={b.urgensi !== 'aman' ? `pengingat-baris--${b.urgensi}` : ''}>
                  <td>
                    {b.pihak}
                    {b.perlu_ingat && (
                      <span title="Perlu diingat">
                        <Icon nama="bell" size={13} className="pengingat-tanda" />
                      </span>
                    )}
                  </td>
                  <td>{b.no_faktur}</td>
                  <td>{b.jatuh_tempo ? formatTanggal(b.jatuh_tempo) : '—'}</td>
                  <td className="kanan">{formatRupiah(b.sisa)}</td>
                  <td>
                    <span className={`urgensi urgensi--${b.urgensi}`}>{LABEL_URGENSI[b.urgensi]}</span>
                  </td>
                  <td className="kanan">
                    <span className="tombol-baris">
                      <IconButton
                        ikon="whatsapp"
                        label={`Kirim pengingat WhatsApp ke ${b.pihak}`}
                        onClick={() => setWa(b)}
                      />
                      <button
                        type="button"
                        className="tombol tombol--kecil"
                        onClick={() => onBayar(b, tab)}
                      >
                        Catat bayar
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {wa && (
        <DialogWa
          faktur={{ id: 0, no_faktur: wa.no_faktur, tanggal: wa.jatuh_tempo ?? '', total: wa.sisa }}
          pihakNama={wa.pihak}
          teleponAwal={wa.telepon ?? ''}
          pesanLain={pesanPengingat(wa)}
          onTutup={() => setWa(null)}
        />
      )}
    </section>
  );
}

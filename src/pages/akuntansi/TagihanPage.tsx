import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '../../lib/api';
import { useSegarkanModul } from '../../lib/segarkan';
import { beritahu } from '../../components/crud/Toast';
import { Modal } from '../../components/crud/Modal';
import { useSesi } from '../../lib/sesi';
import { can } from '../../lib/hak';
import { rp, type Tagihan } from './tipe';
import { bukaWa, formatWa62, nomorWaValid } from '../faktur/aksi';
import './akuntansi.css';

interface RiwayatBayar {
  id: number;
  tanggal: string;
  jumlah: number;
  akun_kode: string;
  akun_nama: string;
  pembuat: string | null;
}

const EMBER = ['0-30', '31-60', '61-90', '>90'] as const;

/** Piutang / Hutang — umur (aging), pelunasan parsial, riwayat pembayaran. */
export function TagihanPage({ tipe }: { tipe: 'piutang' | 'hutang' }) {
  const [baris, setBaris] = useState<Tagihan[]>([]);
  const [aging, setAging] = useState<Record<string, number>>({});
  const [totalSisa, setTotalSisa] = useState(0);
  const [bayarTarget, setBayarTarget] = useState<Tagihan | null>(null);
  const [jumlah, setJumlah] = useState('');
  const [metode, setMetode] = useState('tunai');
  const [kirim, setKirim] = useState(false);
  const [riwayat, setRiwayat] = useState<RiwayatBayar[] | null>(null);
  const judul = tipe === 'piutang' ? 'Piutang Usaha' : 'Hutang Usaha';
  // AX — pelunasan menggerakkan kas (posting) = sel Sahkan.
  const info = useSesi().info;
  const bisaBayar = can(info, 'akuntansi', 'sahkan');

  const muat = useCallback(async () => {
    const r = await apiGet<{ baris: Tagihan[]; aging: Record<string, number>; total_sisa: number }>(
      `/api/akuntansi/${tipe}`,
    );
    setBaris(r.baris);
    setAging(r.aging);
    setTotalSisa(r.total_sisa);
  }, [tipe]);

  useEffect(() => {
    void muat().catch((e: Error) => beritahu(e.message, 'galat'));
  }, [muat]);
  // Tombol Refresh global di topbar: muat ulang daftar tagihan.
  useSegarkanModul(muat);

  const bayar = async () => {
    if (!bayarTarget) return;
    setKirim(true);
    try {
      await apiPost(`/api/akuntansi/${tipe}/${bayarTarget.id}/bayar`, { jumlah: Number(jumlah), metode });
      beritahu('Pembayaran dicatat dan mutasi kas diperbarui.', 'sukses');
      setBayarTarget(null);
      setJumlah('');
      await muat();
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    } finally {
      setKirim(false);
    }
  };

  /** Pengingat tagihan via WhatsApp — nomor otomatis dari master pelanggan. */
  const kirimPengingat = (t: Tagihan) => {
    if (!nomorWaValid(t.entitas_telepon ?? '')) {
      beritahu('Nomor WhatsApp pelanggan belum ada di master. Lengkapi di Master › Pelanggan.', 'galat');
      return;
    }
    const tempo = t.jatuh_tempo ? String(t.jatuh_tempo).slice(0, 10) : '—';
    bukaWa(
      String(t.entitas_telepon),
      [
        `Halo ${t.entitas ?? 'Bapak/Ibu'},`,
        '',
        `Kami mengingatkan tagihan *${t.no_dokumen}* tanggal ${String(t.tanggal_dok).slice(0, 10)}:`,
        `Total: Rp ${rp(t.total)}`,
        `Sudah dibayar: Rp ${rp(t.terbayar)}`,
        `Sisa: *Rp ${rp(t.sisa)}*`,
        `Jatuh tempo: ${tempo}`,
        '',
        'Terima kasih.',
      ].join('\n'),
    );
  };

  const lihatRiwayat = async (t: Tagihan) => {
    try {
      const r = await apiGet<{ data: RiwayatBayar[] }>(`/api/akuntansi/pembayaran/${tipe}/${t.id}`);
      setRiwayat(r.data);
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    }
  };

  return (
    <div className="halaman akuntansi">
      {/* ============ Satu kartu terpadu: header + isi ============ */}
      <section className="kartu" data-tur="tagihan">
        <div className="kartu__kepala kartu__kepala--kompak kepala-kartu">
          <div>
            <h3>{judul}</h3>
            <p className="teks-redup teks-kecil">{tipe === 'piutang' ? 'Tagihan pelanggan, umur jatuh tempo, dan pelunasan.' : 'Tagihan pemasok, umur jatuh tempo, dan pelunasan.'}</p>
          </div>
          <span className="teks-redup teks-kecil akuntansi__total-kepala">
            Total sisa: <strong>{rp(totalSisa)}</strong>
          </span>
        </div>
        {/* Filter umur: pill terpisah dengan jarak label ↔ nominal 6px. */}
        <div className="akuntansi-aging" role="group" aria-label={`Umur ${judul.toLowerCase()}`}>
          {EMBER.map((e) => (
            <div className="akuntansi-aging__pill" key={e}>
              <span className="akuntansi-aging__label">Umur {e} hari</span>
              <span className="akuntansi-aging__nilai">{rp(aging[e] ?? 0)}</span>
            </div>
          ))}
        </div>
        <div className="tabel-bungkus">
          <table className="tabel">
            <thead>
              <tr>
                <th style={{ width: 130 }}>Dokumen</th>
                <th>{tipe === 'piutang' ? 'Pelanggan' : 'Pemasok'}</th>
                <th style={{ width: 110 }}>Tanggal</th>
                <th style={{ width: 110 }}>Jatuh Tempo</th>
                <th className="rata-kanan" style={{ width: 120 }}>Total</th>
                <th className="rata-kanan" style={{ width: 120 }}>Terbayar</th>
                <th className="rata-kanan" style={{ width: 120 }}>Sisa</th>
                <th style={{ width: 100 }}>Umur</th>
                <th style={{ width: 170 }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {baris.length === 0 && (
                <tr><td colSpan={9} className="tabel-kosong">Tidak ada {tipe} berjalan. {tipe === 'piutang' ? 'Penjualan kredit membuat piutang otomatis.' : 'Pembelian kredit membuat hutang otomatis.'}</td></tr>
              )}
              {baris.map((t) => (
                <tr key={t.id} className={t.telat_hari > 0 ? 'baris-terlambat' : ''}>
                  <td><code>{t.no_dokumen}</code></td>
                  <td>{t.entitas ?? '—'}</td>
                  <td>{String(t.tanggal_dok).slice(0, 10)}</td>
                  <td>{t.jatuh_tempo ? String(t.jatuh_tempo).slice(0, 10) : '—'}</td>
                  <td className="rata-kanan">{rp(t.total)}</td>
                  <td className="rata-kanan">{rp(t.terbayar)}</td>
                  <td className="rata-kanan"><strong>{rp(t.sisa)}</strong></td>
                  <td>
                    <span className={`lencana ${t.umur_ember === '>90' ? 'lencana--bahaya' : 'lencana--aktif'}`}>{t.umur_hari} hr</span>
                    {t.telat_hari > 0 && <span className="teks-redup teks-kecil"> · telat {t.telat_hari} hr</span>}
                  </td>
                  <td>
                    <span className="aksi-baris">
                      {bisaBayar && (
                        <button type="button" className="tombol tombol--kecil" onClick={() => { setBayarTarget(t); setJumlah(String(Math.round(t.sisa))); }}>
                          Bayar
                        </button>
                      )}
                      {tipe === 'piutang' && (
                        <button
                          type="button"
                          className="tombol tombol--kecil"
                          onClick={() => kirimPengingat(t)}
                          title={
                            t.entitas_telepon
                              ? `Kirim pengingat ke ${formatWa62(t.entitas_telepon)} (pelanggan)`
                              : 'Nomor WhatsApp pelanggan belum ada di master'
                          }
                        >
                          💬 WA
                        </button>
                      )}
                      <button type="button" className="tombol tombol--kecil" onClick={() => void lihatRiwayat(t)}>
                        Riwayat
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {bayarTarget && (
        <Modal
          judul={`Bayar ${tipe} ${bayarTarget.no_dokumen}`}
          lebar="kecil"
          onTutup={() => setBayarTarget(null)}
          aksi={
            <>
              <button type="button" className="tombol" onClick={() => setBayarTarget(null)}>Batal</button>
              <button type="button" className="tombol tombol--primer" disabled={kirim || !(Number(jumlah) > 0)} onClick={() => void bayar()}>
                {kirim ? 'Menyimpan…' : 'Catat Pembayaran'}
              </button>
            </>
          }
        >
          <p className="teks-kecil teks-redup">Sisa tagihan: <strong>{rp(bayarTarget.sisa)}</strong> (pelunasan parsial diperbolehkan).</p>
          <div className="form-grid">
            <label>
              Jumlah (Rp)
              <input type="number" min={0} className="input-cari" value={jumlah} onChange={(e) => setJumlah(e.target.value)} />
            </label>
            <label>
              Metode bayar
              <select className="input-pilih" value={metode} onChange={(e) => setMetode(e.target.value)}>
                <option value="tunai">Tunai (Kas Kasir)</option>
                <option value="transfer">Transfer (Bank)</option>
                <option value="qris">QRIS/EDC (Kas Dalam Penyelesaian)</option>
              </select>
            </label>
          </div>
        </Modal>
      )}

      {riwayat && (
        <Modal
          judul="Riwayat Pembayaran"
          lebar="sedang"
          onTutup={() => setRiwayat(null)}
          aksi={<button type="button" className="tombol" onClick={() => setRiwayat(null)}>Tutup</button>}
        >
          {riwayat.length === 0 ? (
            <p className="teks-redup">Belum ada pembayaran tercatat.</p>
          ) : (
            <div className="tabel-bungkus">
              <table className="tabel">
                <thead>
                  <tr>
                    <th>Tanggal</th>
                    <th>Akun Kas</th>
                    <th>Pencatat</th>
                    <th className="rata-kanan">Jumlah</th>
                  </tr>
                </thead>
                <tbody>
                  {riwayat.map((r) => (
                    <tr key={r.id}>
                      <td>{String(r.tanggal).slice(0, 10)}</td>
                      <td>{r.akun_kode} {r.akun_nama}</td>
                      <td>{r.pembuat ?? '—'}</td>
                      <td className="rata-kanan">{rp(r.jumlah)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

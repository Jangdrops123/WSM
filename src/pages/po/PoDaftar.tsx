import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BarPeriode, type NilaiPeriode } from '../../components/BarPeriode';
import { FooterDaftar } from '../../components/crud/FooterDaftar';
import { beritahu } from '../../components/crud/Toast';
import { IconButton } from '../../components/IconButton';
import { DialogBatal } from '../../components/transaksi/DialogBatal';
import { ambilOpsi, apiPost } from '../../lib/api';
import { useBarisOtomatis } from '../../lib/barisOtomatis';
import { formatRupiah, formatTanggal } from '../../lib/format';
import { bolehKelolaTransaksi, can, MODUL_PO, pesanIzin } from '../../lib/hak';
import { useSegarkanModul } from '../../lib/segarkan';
import { useSesi } from '../../lib/sesi';
import { hitungRentang, labelRentang } from '../../lib/periode';
import { LABEL_STATUS_PO, KELAS_STATUS_PO, FILTER_PO_AKTIF, FILTER_PO_TERMINAL, formatKodi, lewatTenggat, type StatusPo } from '../../lib/kodi';
import './po.css';
import './po-hub.css';

type Baris = Record<string, any>;

const FILTER_STATUS: { kode: string; label: string }[] = [
  { kode: FILTER_PO_AKTIF, label: 'Aktif / Proses (bawaan)' },
  { kode: 'draft', label: 'Draft' },
  { kode: 'terkirim,sebagian', label: 'Proses' },
  { kode: 'lebih', label: 'Lebih (Over-delivered)' },
  { kode: FILTER_PO_TERMINAL, label: 'Selesai (semua terminal)' },
  { kode: 'selesai,selesai_kurang', label: 'Selesai' },
  { kode: 'kadaluwarsa', label: 'Kadaluwarsa' },
  { kode: 'batal', label: 'Dibatalkan' },
  { kode: '', label: 'Semua status' },
];

/** Tab cepat: Aktif (bawaan) · Selesai/terminal · Semua. */
const CHIP_STATUS: { kode: string; label: string }[] = [
  { kode: FILTER_PO_AKTIF, label: 'Aktif / Proses' },
  { kode: FILTER_PO_TERMINAL, label: 'Selesai' },
  { kode: '', label: 'Semua Status' },
];

/** Daftar PO — filter status/supplier/tanggal, cari nomor PO, badge status. */
export function PoDaftar() {
  const [data, setData] = useState<Baris[]>([]);
  const [total, setTotal] = useState(0);
  const [hal, setHal] = useState(1);
  const [isiKodi, setIsiKodi] = useState(20);
  const [cari, setCari] = useState('');
  const [cariTunda, setCariTunda] = useState('');
  const [filterStatus, setFilterStatus] = useState(FILTER_PO_AKTIF);
  const [filterSupplier, setFilterSupplier] = useState('');
  const [periode, setPeriode] = useState<NilaiPeriode>({ periode: '30', dariInput: '', sampaiInput: '' });
  const [sibuk, setSibuk] = useState(true);
  // Standar kolom AKSI: Lihat | Batal.
  const [batalPo, setBatalPo] = useState<Baris | null>(null);
  const [batalSibuk, setBatalSibuk] = useState(false);
  const navigasi = useNavigate();
  const [opsiSupplier, setOpsiSupplier] = useState<{ id: number; label: string }[]>([]);
  const areaRef = useRef<HTMLDivElement>(null);
  const { per, mode, setMode } = useBarisOtomatis({ kunci: 'po-daftar', areaRef, total, hal, setHal });

  const sesiInfo = useSesi().info;
  const bisaHapus = can(sesiInfo, MODUL_PO, 'hapus');
  const bisaTambah = can(sesiInfo, MODUL_PO, 'tambah');
  const bisaUbah = can(sesiInfo, MODUL_PO, 'ubah');
  const bolehKelola = bolehKelolaTransaksi(sesiInfo);

  const { dari: tglDari, sampai: tglSampai } = hitungRentang(periode.periode, periode.dariInput, periode.sampaiInput);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setCariTunda(cari);
      setHal(1);
    }, 150);
    return () => window.clearTimeout(t);
  }, [cari]);

  useEffect(() => {
    ambilOpsi('pemasok').then(setOpsiSupplier).catch(() => setOpsiSupplier([]));
  }, []);

  const muat = useCallback(async () => {
    setSibuk(true);
    try {
      const q = new URLSearchParams({ hal: String(hal), per: String(per), cari: cariTunda });
      if (filterStatus) q.set('status', filterStatus);
      if (filterSupplier) q.set('supplier_id', filterSupplier);
      if (tglDari) q.set('dari', tglDari);
      if (tglSampai) q.set('sampai', tglSampai);
      const r = await (await import('../../lib/api')).apiGet<{ data: Baris[]; total: number; isi_per_kodi: number }>(
        `/api/po?${q.toString()}`,
      );
      setData(r.data);
      setTotal(r.total);
      if (r.isi_per_kodi) setIsiKodi(r.isi_per_kodi);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibuk(false);
    }
  }, [hal, per, cariTunda, filterStatus, filterSupplier, tglDari, tglSampai]);

  useEffect(() => {
    void muat();
  }, [muat]);
  useSegarkanModul(muat);

  /** Batal PO — alasan wajib, tanpa password (bukan transaksi stok/kas). */
  const kirimBatal = async (alasan: string) => {
    if (!batalPo || batalSibuk) return;
    setBatalSibuk(true);
    try {
      await apiPost(`/api/po/${batalPo.id}/status`, { status: 'batal', alasan });
      beritahu(`PO ${batalPo.no_po} dibatalkan.`);
      setBatalPo(null);
      await muat();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setBatalSibuk(false);
    }
  };

  const totalHal = Math.max(1, Math.ceil(total / per));

  return (
    <div className="halaman po-daftar po-modul" ref={areaRef}>
      <section className="kartu po-daftar-filter">

        <div className="po-filter po-filter--dengan-aksi">
          <label className="bidang bidang--cari">
            <span>Cari nomor PO / pemasok</span>
            <input value={cari} onChange={(e) => setCari(e.target.value)} placeholder="PO-202601-0001…" aria-label="Cari nomor PO" />
          </label>
          <label className="bidang bidang--sempit">
            <span>Status</span>
            <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setHal(1); }} aria-label="Filter status">
              {FILTER_STATUS.map((s) => (
                <option key={s.kode} value={s.kode}>{s.label}</option>
              ))}
            </select>
          </label>
          <label className="bidang bidang--sempit">
            <span>Pemasok</span>
            <select value={filterSupplier} onChange={(e) => { setFilterSupplier(e.target.value); setHal(1); }} aria-label="Filter pemasok">
              <option value="">Semua pemasok</option>
              {opsiSupplier.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </label>
          <span className="po-filter__aksi">
            {bisaTambah ? (
              <Link className="hub-btn hub-btn--buat" to="/po/buat">
                + Buat PO
              </Link>
            ) : (
              <button type="button" className="hub-btn hub-btn--buat" disabled title={pesanIzin(sesiInfo, MODUL_PO, 'tambah', 'membuat PO')}>
                + Buat PO
              </button>
            )}
          </span>
        </div>
        <div className="tombol-baris po-chip-grup" role="group" aria-label="Filter cepat status PO" style={{ marginTop: 8 }}>
          {CHIP_STATUS.map((c) => (
            <button
              key={c.label}
              type="button"
              className={`tombol tombol--kecil${filterStatus === c.kode ? ' tombol--primer' : ' tombol--netral'}`}
              aria-pressed={filterStatus === c.kode}
              onClick={() => { setFilterStatus(c.kode); setHal(1); }}
              title={c.kode ? `Tampilkan PO berstatus ${c.label}` : 'Tampilkan semua PO'}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 8 }}>
          <BarPeriode nilai={periode} onUbah={(n) => { setPeriode(n); setHal(1); }} ringkasan={`Menampilkan ${labelRentang(tglDari, tglSampai)} · ${total} PO`} />
        </div>

        {sibuk ? (
          <div style={{ display: 'grid', gap: 8, marginTop: 12 }} aria-busy="true" aria-label="Memuat PO">
            {[0, 1, 2].map((i) => (
              <div key={i} className="po-skeleton" />
            ))}
          </div>
        ) : data.length === 0 ? (
          <div className="po-kosong" style={{ marginTop: 12 }}>
            <div className="po-kosong-ikon" aria-hidden="true">📦</div>
            <strong>Belum ada Purchase Order</strong>
            <p>Buat PO pertama untuk memesan barang ke pemasok — lalu kirim dan catat barang datang bertahap.</p>
            {bisaTambah && (
              <Link className="tombol tombol--primer" to="/po/buat" style={{ marginTop: 8 }}>
                + Buat PO pertama
              </Link>
            )}
          </div>
        ) : (
          <div className="tabel-bungkus po-tabel-gulir" style={{ marginTop: 12 }}>
            <table className="tabel po-tabel">
              <thead>
                <tr>
                  <th>No. PO</th>
                  <th>Pemasok</th>
                  <th>Tanggal</th>
                  <th className="rata-kanan">Pesan</th>
                  <th className="rata-kanan">Datang</th>
                  <th className="rata-kanan">Sisa</th>
                  <th className="rata-kanan">Selisih</th>
                  <th>Status</th>
                  <th className="rata-kanan">Total</th>
                  <th className="rata-tengah">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {data.map((b) => {
                  const pesan = Number(b.pesan_pcs) || 0;
                  const datang = Number(b.datang_pcs) || 0;
                  const sisa = Math.max(0, pesan - datang);
                  const selisih = datang - pesan;
                  const st = String(b.status) as StatusPo;
                  return (
                    <tr key={b.id}>
                      <td data-label="No. PO">
                        <Link to={`/po/${b.id}`}><strong>{String(b.no_po)}</strong></Link>
                      </td>
                      <td data-label="Pemasok">{String(b.supplier_nama ?? '—')}</td>
                      <td data-label="Tanggal">{formatTanggal(b.tanggal)}</td>
                      <td data-label="Pesan" className="rata-kanan">{formatKodi(pesan, isiKodi)}</td>
                      <td data-label="Datang" className="rata-kanan">{formatKodi(datang, isiKodi)}</td>
                      <td data-label="Sisa" className="rata-kanan">
                        {sisa > 0 ? <span className="lencana lencana--bahaya">{formatKodi(sisa, isiKodi)}</span> : '—'}
                      </td>
                      <td data-label="Selisih" className="rata-kanan">
                        {selisih > 0 ? (
                          <span className="lencana lencana--peringatan">+{formatKodi(selisih, isiKodi)}</span>
                        ) : selisih < 0 ? (
                          <span className="lencana lencana--bahaya">{formatKodi(-selisih, isiKodi)} kurang</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td data-label="Status">
                        <span className={`lencana ${KELAS_STATUS_PO[st] ?? 'lencana--netral'}`}>{LABEL_STATUS_PO[st] ?? st}</span>
                        {lewatTenggat(b.tenggat) && (st === 'terkirim' || st === 'sebagian' || st === 'lebih') && (
                          <span className="lencana lencana--peringatan" title={`Tenggat ${String(b.tenggat).slice(0, 10)} sudah lewat — ubah status manual via kolom Aksi.`}>
                            ⚠ Lewat tenggat
                          </span>
                        )}
                      </td>
                      <td data-label="Total" className="rata-kanan">{formatRupiah(Number(b.total_harga) || 0)}</td>
                      <td data-label="Aksi" className="rata-tengah">
                        {/* Standar 2 aksi: Lihat | Batal. Kirim/Terima/
                            Ubah status manual ada di halaman Detail PO. */}
                        <span className="aksi-baris po-aksi">
                          <IconButton
                            label="Lihat detail PO"
                            ikon="eye"
                            ukuran="baris"
                            onClick={() => navigasi(`/po/${b.id}`)}
                          />
                          {/* PO susulan — form terisi dari PO ini, nomor PO tetap baru. */}
                          <IconButton
                            label="Buat PO Susulan"
                            ikon="copy"
                            ukuran="baris"
                            disabled={!bisaTambah}
                            alasan={!bisaTambah ? pesanIzin(sesiInfo, MODUL_PO, 'tambah', 'membuat PO susulan') : undefined}
                            onClick={() => navigasi(`/po/buat?ref_po_id=${b.id}`)}
                          />
                          {/* Edit PO — Draft cukup izin Ubah; PO terkirim/sebagian
                              butuh Administrator atau Hak Khusus "Hapus transaksi". */}
                          {['draft', 'terkirim', 'sebagian'].includes(st) && (
                            <IconButton
                              label="Edit PO"
                              ikon="pencil"
                              ukuran="baris"
                              disabled={st === 'draft' ? !bisaUbah : !bolehKelola}
                              alasan={
                                st === 'draft'
                                  ? pesanIzin(sesiInfo, MODUL_PO, 'ubah', 'mengubah PO')
                                  : 'butuh Hak Khusus Hapus transaksi'
                              }
                              onClick={() => navigasi(`/po/edit/${b.id}`)}
                            />
                          )}
                          <IconButton
                            label="Batalkan PO"
                            ikon="trash"
                            warna="bahaya"
                            ukuran="baris"
                            disabled={
                              !['draft', 'terkirim', 'sebagian', 'lebih'].includes(st) || !bolehKelola || !bisaHapus
                            }
                            alasan={
                              !bolehKelola
                                ? 'butuh Hak Khusus Hapus transaksi'
                                : !bisaHapus
                                  ? pesanIzin(sesiInfo, MODUL_PO, 'hapus', 'membatalkan PO')
                                  : 'status PO tidak bisa dibatalkan'
                            }
                            onClick={() => setBatalPo(b)}
                          />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <FooterDaftar mode={mode} onMode={setMode} hal={hal} totalHal={totalHal} total={total} onHal={setHal} />
      </section>

      {batalPo && (
        <DialogBatal
          judul={`Batalkan PO ${batalPo.no_po}?`}
          deskripsi="PO yang sudah ada barang datang tidak bisa dibatalkan. PO batal tidak memengaruhi stok maupun hutang."
          labelKonfirmasi="Ya, batalkan PO"
          sibuk={batalSibuk}
          onTutup={() => setBatalPo(null)}
          onKirim={(alasan) => void kirimBatal(alasan)}
        />
      )}

    </div>
  );
}

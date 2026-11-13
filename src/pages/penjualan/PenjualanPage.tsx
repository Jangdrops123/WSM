import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { Modal } from '../../components/crud/Modal';
import { beritahu } from '../../components/crud/Toast';
import { apiGet, apiPost } from '../../lib/api';
import { bolehKelolaTransaksi, can, pesanIzin } from '../../lib/hak';
import { useSesi } from '../../lib/sesi';
import { DialogBatal } from '../../components/transaksi/DialogBatal';
import { useSegarkanModul } from '../../lib/segarkan';
import { formatAngka, formatRupiah, formatTanggal, formatTanggalWaktu } from '../../lib/format';
import { modePosTerakhir, rutePos, setModePosTerakhir } from '../../lib/pengguna';
import { DialogWa } from '../faktur/DialogWa';
import { BarPeriode, type NilaiPeriode } from '../../components/BarPeriode';
import { hitungRentang, labelRentang } from '../../lib/periode';
import { DialogLayanan, strukDariSale, type BarisRiwayat, type DetailJual } from '../pos/DialogPos';
import { ModalDetailRetur, RincianBarangRetur, type ItemRetur } from '../../components/transaksi/RincianRetur';
import { cetakStruk, pesanWaStruk, PROFIL_STRUK_BAWAAN, type ProfilStruk, type StrukData } from '../pos/struk';
import { gambarStrukDok } from '../../lib/gambarDok';
import { useUsaha } from '../../lib/usaha';
import './penjualan.css';

type Tab = 'riwayat' | 'retur' | 'piutang';

/* NET SALES — angka Riwayat memakai nilai setelah retur disahkan, sama dengan
   yang tampil di modal Detail Penjualan. Nilai asli transaksi tetap tersimpan
   di server (audit trail), hanya tampilan tabel yang memakai nilai bersih. */
const qtyBersihJual = (s: BarisRiwayat): number =>
  Number(s.total_qty_net ?? Math.max(0, Number(s.total_qty ?? 0) - Number(s.qty_retur ?? 0)));
const nilaiBersihJual = (s: BarisRiwayat): number =>
  Number(s.total_net ?? Math.max(0, Number(s.total ?? 0) - Number(s.total_retur ?? 0)));
const adaReturJual = (s: BarisRiwayat): boolean =>
  Boolean(s.has_return) || Number(s.qty_retur ?? 0) > 0 || Number(s.total_retur ?? 0) > 0;

interface BarisRetur {
  id: number;
  no_dokumen: string;
  tanggal: string;
  alasan: string | null;
  total: number;
  status: string;
  no_penjualan: string;
  pelanggan: string | null;
  kasir: string | null;
  /** Rincian barang yang diretur (dari sale_return_items). */
  items?: ItemRetur[];
}

interface BarisPiutang {
  id: number;
  jatuh_tempo: string | null;
  total: number;
  terbayar: number;
  status: string;
  no_dokumen: string;
  tanggal: string;
  pelanggan: string | null;
  sisa: number;
}

/** Baris faktur untuk Bagian bawah — Dokumen (dari /api/faktur). */
interface BarisFaktur {
  id: number;
  no_faktur: string;
  tanggal: string;
  pihak_nama: string | null;
  pihak_telepon: string | null;
  total: number;
  status: string;
  no_sumber: string | null;
}

const lencanaStatus = (s: string) =>
  s === 'disahkan' || s === 'lunas'
    ? 'lencana--aktif'
    : s === 'batal'
      ? 'lencana--bahaya'
      : 'lencana--netral';

/**
 * M3 + M7 — Tombol split "Transaksi Baru (POS)":
 * klik utama = buka POS mode terakhir; panah kecil = pilih mode (Foto / Tanpa Foto).
 * Tooltip teks saat hover/fokus, label aksesibilitas "Buka POS".
 */
function TombolPos({ tengah = false }: { tengah?: boolean }) {
  const navigate = useNavigate();
  const [buka, setBuka] = useState(false);
  const wadah = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!buka) return;
    const onDown = (e: MouseEvent) => {
      if (!wadah.current?.contains(e.target as Node)) setBuka(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setBuka(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [buka]);

  const bukaMode = (mode: 'foto' | 'cepat') => {
    setModePosTerakhir(mode);
    setBuka(false);
    navigate(rutePos(mode));
  };

  return (
    <div className={`pos-split ${tengah ? 'pos-split--tengah' : ''}`} ref={wadah}>
      <button
        type="button"
        className="tombol tombol--primer pos-split__utama tombol-tip"
        data-tip="Buka POS"
        aria-label="Buka POS"
        onClick={() => navigate(rutePos(modePosTerakhir()))}
      >
        <Icon nama="pos" size={17} />
        Transaksi Baru (POS)
      </button>
      <button
        type="button"
        className="tombol tombol--primer pos-split__panah"
        data-tip="Pilih mode POS"
        aria-label="Pilih mode POS"
        aria-haspopup="menu"
        aria-expanded={buka}
        onClick={() => setBuka((b) => !b)}
      >
        <Icon nama={buka ? 'chevron-up' : 'chevron-down'} size={16} />
      </button>
      {buka && (
        <div className="pos-split__menu" role="menu">
          <button type="button" role="menuitem" onClick={() => bukaMode('foto')}>
            POS Mode Foto
          </button>
          <button type="button" role="menuitem" onClick={() => bukaMode('cepat')}>
            POS Mode Tanpa Foto
          </button>
        </div>
      )}
    </div>
  );
}

/** Halaman Penjualan: Riwayat | Retur | Piutang (tab = rute). */
export function PenjualanPage({ tab }: { tab: Tab }) {
  const navigasi = useNavigate();
  const [sibuk, setSibuk] = useState(true);
  const [riwayat, setRiwayat] = useState<BarisRiwayat[]>([]);
  const [retur, setRetur] = useState<BarisRetur[]>([]);
  // Baris retur yang sedang dibuka modal Detail Dokumen Retur-nya.
  const [detailRetur, setDetailRetur] = useState<BarisRetur | null>(null);
  const [piutang, setPiutang] = useState<BarisPiutang[]>([]);

  // Identitas usaha global — cetak ulang/kirim struk memakai data terbaru.
  const usaha = useUsaha();
  const [profil, setProfil] = useState<ProfilStruk | null>(null);

  // R2 — periode tampil: satu pilihan menyaring riwayat transaksi + dokumen.
  const [periode, setPeriode] = useState<NilaiPeriode>({ periode: '7', dariInput: '', sampaiInput: '' });
  const { dari: tglDari, sampai: tglSampai } = hitungRentang(periode.periode, periode.dariInput, periode.sampaiInput);
  // R2 — dokumen bawah: faktur penjualan terbit pada periode tampil.
  const [dokumen, setDokumen] = useState<BarisFaktur[]>([]);
  const [totalDokumen, setTotalDokumen] = useState(0);
  const [sibukDokumen, setSibukDokumen] = useState(false);
  const [dlgWaDok, setDlgWaDok] = useState<BarisFaktur | null>(null);
  const dokumenRef = useRef<HTMLHeadingElement>(null);
  // --- 3 Token Switcher (khusus tab riwayat): Input / Riwayat / Dokumen.
  // Input = kasir POS (rute sendiri); Riwayat & Dokumen = dua tampilan terpisah.
  const [pandangan, setPandangan] = useState<'riwayat' | 'dokumen'>('riwayat');

  const [lihatId, setLihatId] = useState<number | null>(null);
  const [detail, setDetail] = useState<DetailJual | null>(null);
  const [waStruk, setWaStruk] = useState<StrukData | null>(null);
  const [layanan, setLayanan] = useState<BarisRiwayat | null>(null);
  // Token Batal (void) & Edit transaksi — Administrator / Hak Khusus.
  const sesiInfo = useSesi().info;
  const bolehKelola = bolehKelolaTransaksi(sesiInfo);
  const bolehBatal = bolehKelola && can(sesiInfo, 'penjualan', 'hapus');
  const bolehEdit = bolehKelola && can(sesiInfo, 'penjualan', 'ubah');
  const [batalBaris, setBatalBaris] = useState<BarisRiwayat | null>(null);
  const [batalSibuk, setBatalSibuk] = useState(false);
  /** Galat void tampil di dalam modal (password salah / transaksi ditolak). */
  const [batalGalat, setBatalGalat] = useState<string | null>(null);

  const bukaBatal = (s: BarisRiwayat) => {
    setBatalGalat(null);
    setBatalBaris(s);
  };

  const ubahPeriode = (n: NilaiPeriode) => {
    let v = n;
    if (n.periode === 'rentang' && !n.dariInput && !n.sampaiInput) {
      const r = hitungRentang('7', '', '');
      v = { ...n, dariInput: r.dari, sampaiInput: r.sampai };
    }
    setPeriode(v);
  };

  const loncatDokumen = () => {
    // Tautan faktur di riwayat → pindah ke tab Dokumen (bukan scroll bawah lagi).
    setPandangan('dokumen');
    setTimeout(() => dokumenRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  // Token Input = buka kasir POS (form input penjualan yang sebenarnya).
  const bukaInputPos = (): void => {
    navigasi(rutePos(modePosTerakhir()));
  };

  const muat = useCallback(() => {
    setSibuk(true);
    const q = new URLSearchParams({ per: '100' });
    if (tglDari) q.set('dari', tglDari);
    if (tglSampai) q.set('sampai', tglSampai);
    return Promise.all([
      apiGet<{ data: BarisRiwayat[] }>(`/api/pos/sales?${q.toString()}`),
      apiGet<{ data: BarisRetur[] }>('/api/pos/returns?per=100'),
      apiGet<{ data: BarisPiutang[] }>('/api/pos/receivables?per=100'),
    ])
      .then(([rw, rt, pg]) => {
        setRiwayat(rw.data);
        setRetur(rt.data);
        setPiutang(pg.data);
      })
      .catch((e: Error) => beritahu(e.message, 'galat'))
      .finally(() => setSibuk(false));
  }, [tglDari, tglSampai]);

  useEffect(() => {
    void muat();
  }, [muat]);
  // Tombol Refresh global di topbar: riwayat + retur + piutang + dokumen.
  useSegarkanModul(muat);

  // R2 — dokumen bawah: faktur penjualan pada periode tampil.
  const muatDokumen = useCallback(async () => {
    setSibukDokumen(true);
    try {
      const q = new URLSearchParams({ hal: '1', per: '100', jenis: 'penjualan' });
      if (tglDari) q.set('dari', tglDari);
      if (tglSampai) q.set('sampai', tglSampai);
      const r = await apiGet<{ data: BarisFaktur[]; total: number }>(`/api/faktur?${q.toString()}`);
      setDokumen(r.data);
      setTotalDokumen(r.total);
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    } finally {
      setSibukDokumen(false);
    }
  }, [tglDari, tglSampai]);

  useEffect(() => {
    if (tab === 'riwayat') void muatDokumen();
  }, [muatDokumen, tab]);
  useSegarkanModul(muatDokumen);

  // Profil struk untuk cetak ulang / kirim (J3/J4).
  useEffect(() => {
    void apiGet<{ data: ProfilStruk[] }>('/api/struk/profil')
      .catch(() => null)
      .then((sp) => {
        if (sp) setProfil(sp.data.find((x) => x.bawaan) ?? sp.data[0] ?? null);
      })
      .catch(() => undefined);
  }, []);

  // Dialog "Lihat" — detail penjualan tersimpan.
  useEffect(() => {
    if (lihatId == null) {
      setDetail(null);
      return;
    }
    apiGet<{ data: DetailJual }>(`/api/pos/sales/${lihatId}`)
      .then((r) => setDetail(r.data))
      .catch((e: Error) => {
        beritahu(e.message, 'galat');
        setLihatId(null);
      });
  }, [lihatId]);

  // Token Edit: muat transaksi ke form kasir aktif (POS) dengan ?edit=<id>.
  const bukaEdit = (id: number) => {
    setLihatId(null);
    navigasi(`${rutePos(modePosTerakhir())}?edit=${id}`);
  };

  const batalkan = async (alasan: string, sandi: string) => {
    if (!batalBaris || batalSibuk) return;
    setBatalSibuk(true);
    setBatalGalat(null);
    try {
      await apiPost(`/api/pos/sales/${batalBaris.id}/void`, { sandi, alasan });
      beritahu(`Penjualan ${batalBaris.no_dokumen} dibatalkan — stok & kas sudah dipulihkan.`);
      setBatalBaris(null);
      await muat();
    } catch (e) {
      // Jangan pernah menampilkan teks teknis PostgreSQL mentah ke pengguna.
      const mentah = (e as Error).message;
      const pesan = /current transaction is aborted|SQLSTATE|constraint|violates/i.test(mentah)
        ? 'Proses pembatalan gagal dan tidak ada data yang berubah. Muat ulang daftar lalu coba lagi.'
        : mentah;
      setBatalGalat(pesan);
      beritahu(pesan, 'galat');
    } finally {
      setBatalSibuk(false);
    }
  };

  // Ringkasan retur untuk modal detail: hanya retur DISAHKAN yang mengurangi
  // nilai transaksi (retur batal tidak boleh mengubah Net Sales).
  const returSah = (detail?.retur ?? []).filter((r) => r.status === 'disahkan');
  const totalRetur = returSah.reduce((a, r) => a + Number(r.total), 0);
  const adaRetur = returSah.length > 0;
  const subtotalAwal = Number(detail?.subtotal ?? 0);
  const totalBersih = Math.max(0, Number(detail?.total ?? 0) - totalRetur);
  const returPenuh =
    !!detail && detail.items.length > 0 && detail.items.every((i) => Number(i.qty_retur ?? 0) >= Number(i.qty));
  // Akumulasi qty barang: Awal (saat transaksi disahkan) − Retur (disahkan) = Net.
  // qty_retur per baris berasal dari server (hanya retur berstatus disahkan) dan
  // dibatasi maksimal sebesar qty baris agar Net tidak pernah negatif.
  const totalQtyAwal = (detail?.items ?? []).reduce((a, i) => a + (Number(i.qty) || 0), 0);
  const totalQtyRetur = (detail?.items ?? []).reduce(
    (a, i) => a + Math.min(Number(i.qty) || 0, Math.max(0, Number(i.qty_retur ?? 0))),
    0,
  );
  const totalQtyNet = Math.max(0, totalQtyAwal - totalQtyRetur);
  const labelStatus = !detail
    ? ''
    : returPenuh
      ? 'Retur Penuh'
      : adaRetur
        ? `${detail.status} (Ada Retur)`
        : detail.status;

  // Z1 — ribon "Riwayat | Retur | Piutang" DIHAPUS: ketiganya kini halaman
  // mandiri dari sub-menu sidebar (/penjualan, /penjualan/retur, /penjualan/piutang).
  const judulTab =
    tab === 'retur' ? 'Retur Penjualan' : tab === 'piutang' ? 'Piutang Penjualan' : 'Riwayat & Dokumen';

  return (
    <div className="halaman">
      {tab === 'riwayat' && (
        <>
          {/* ============ Satu kartu terpadu: header + token + isi ============ */}
          <section className="kartu">
            <div className="tokenbar kepala-kartu">
            <div>
              <h3>Modul Penjualan</h3>
              <p className="teks-redup teks-kecil">
                Kelola formulir kasir/penjualan, riwayat transaksi, dan cetak faktur/struk.
              </p>
            </div>
            <div className="token-grup" role="tablist" aria-label="Navigasi modul penjualan">
              <button
                type="button"
                role="tab"
                aria-selected={false}
                className="token"
                onClick={bukaInputPos}
                title="Input Penjualan — buka kasir POS (mode terakhir)"
                aria-label="Input Penjualan"
              >
                <Icon nama="plus" size={16} />
                <span>Input Penjualan</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={pandangan === 'riwayat'}
                className={`token${pandangan === 'riwayat' ? ' token--aktif' : ''}`}
                onClick={() => setPandangan('riwayat')}
                title="Riwayat Transaksi"
                aria-label="Riwayat Transaksi"
              >
                <Icon nama="menu" size={16} />
                <span>Riwayat Transaksi</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={pandangan === 'dokumen'}
                className={`token${pandangan === 'dokumen' ? ' token--aktif' : ''}`}
                onClick={() => setPandangan('dokumen')}
                title="Dokumen (Faktur & Struk)"
                aria-label="Dokumen (Faktur & Struk)"
              >
                <Icon nama="faktur" size={16} />
                <span>Dokumen (Faktur &amp; Struk)</span>
              </button>
            </div>
            </div>

        {/* ============ Isi terpadu: Riwayat Transaksi ============ */}
        {pandangan === 'riwayat' && (
          <>
          <BarPeriode
            nilai={periode}
            onUbah={ubahPeriode}
            ringkasan={`Menampilkan ${labelRentang(tglDari, tglSampai)} · ${riwayat.length} transaksi · ${totalDokumen} faktur`}
          />
          <section className="dok-seksi dok-seksi--riwayat" aria-label="Riwayat transaksi">
            <div className="dok-judul dok-judul--riwayat">
              <span className="dok-judul__ikon" aria-hidden="true">
                🧾
              </span>
              <h4 className="bagian-judul">Riwayat transaksi</h4>
              <span className="dok-hitung dok-hitung--riwayat">{riwayat.length} transaksi</span>
            </div>
          {sibuk ? (
            <p className="teks-redup">Memuat…</p>
          ) : riwayat.length === 0 ? (
            <div className="penjualan-kosong">
              <p>Belum ada penjualan. Mulai transaksi pertama</p>
              <TombolPos tengah />
            </div>
          ) : (
            <>
            <div className="tabel-bungkus sembunyi-hp">
              <table className="tabel tabel--aksi dok-tabel--riwayat">
                <thead>
                  <tr>
                    <th>No. Dokumen</th>
                    <th>Waktu</th>
                    <th>Pelanggan</th>
                    <th>Kasir</th>
                    <th>Metode</th>
                    <th className="rata-kanan">Total Qty</th>
                    <th className="rata-kanan">Total</th>
                    <th>Status</th>
                    <th>Faktur</th>
                    <th className="kolom-aksi">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {riwayat.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <span className="kode-dok kode-dok--sj">{s.no_dokumen}</span>
                      </td>
                      <td className="whitespace-nowrap">{formatTanggalWaktu(s.tanggal)}</td>
                      <td>{s.pelanggan ?? 'Umum'}</td>
                      <td>{s.kasir ?? '—'}</td>
                      <td>{s.metode ?? '—'}</td>
                      <td className="rata-kanan whitespace-nowrap">
                        {qtyBersihJual(s).toLocaleString('id-ID')}
                        {Number(s.qty_retur ?? 0) > 0 && (
                          <div className="teks-redup teks-kecil">(Retur {Number(s.qty_retur).toLocaleString('id-ID')})</div>
                        )}
                      </td>
                      <td className="rata-kanan whitespace-nowrap">
                        {formatRupiah(nilaiBersihJual(s))}
                        {Number(s.total_retur ?? 0) > 0 && (
                          <div className="teks-redup teks-kecil">Retur −{formatRupiah(Number(s.total_retur))}</div>
                        )}
                      </td>
                      <td>
                        {adaReturJual(s) ? (
                          <span className="lencana lencana--peringatan">
                            {s.status} (Ada Retur)
                          </span>
                        ) : (
                          <span className={`lencana ${lencanaStatus(s.status)}`}>{s.status}</span>
                        )}
                      </td>
                      <td>
                        {s.no_faktur ? (
                          <button type="button" className="tautan-faktur" onClick={loncatDokumen} title="Lihat di tab Dokumen">
                            {s.no_faktur} ↓
                          </button>
                        ) : (
                          <span className="teks-redup">—</span>
                        )}
                      </td>
                      <td className="kolom-aksi">
                        {/* Standar 3 aksi: Lihat | Batal | Retur. Cetak & Kirim
                            WhatsApp pindah ke dalam modal Detail (Token Edit). */}
                        <IconButton
                          label="Lihat detail"
                          ikon="eye"
                          ukuran="baris"
                          onClick={() => setLihatId(s.id)}
                        />
                        <IconButton
                          label="Batal (void) transaksi"
                          ikon="trash"
                          warna="bahaya"
                          ukuran="baris"
                          disabled={s.status !== 'disahkan' || !bolehBatal}
                          alasan={
                            s.status !== 'disahkan'
                              ? 'hanya transaksi disahkan'
                              : !bolehKelola
                                ? 'butuh Hak Khusus Hapus transaksi'
                                : pesanIzin(sesiInfo, 'penjualan', 'hapus', 'membatalkan transaksi')
                          }
                          onClick={() => bukaBatal(s)}
                        />
                        <IconButton
                          label="Retur penjualan"
                          ikon="rotate-ccw"
                          ukuran="baris"
                          disabled={s.status !== 'disahkan'}
                          alasan="hanya transaksi disahkan"
                          onClick={() => setLayanan(s)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="hp-daftar hp-daftar--riwayat">
              {riwayat.map((s) => (
                <article className="hp-kartu" key={`hp-rw-${s.id}`}>
                  <div className="hp-kartu__atas">
                    <span className="hp-kartu__kode kode-dok kode-dok--sj">{s.no_dokumen}</span>
                    <span className="hp-kartu__kanan">{formatTanggalWaktu(s.tanggal)}</span>
                  </div>
                  <div className="hp-kartu__nama">{formatRupiah(nilaiBersihJual(s))}</div>
                  <div className="teks-redup teks-kecil">
                    Total Qty: {qtyBersihJual(s).toLocaleString('id-ID')}
                    {Number(s.qty_retur ?? 0) > 0 ? ` (Retur ${Number(s.qty_retur).toLocaleString('id-ID')})` : ''}
                  </div>
                  <div className="hp-kartu__sub">
                    {s.pelanggan ?? 'Umum'} · {s.metode ?? '—'} ·{' '}
                    {adaReturJual(s) ? (
                      <span className="lencana lencana--peringatan">{s.status} (Ada Retur)</span>
                    ) : (
                      <span className={`lencana ${lencanaStatus(s.status)}`}>{s.status}</span>
                    )}
                  </div>
                  <div className="hp-grid">
                    <div className="hp-sel"><div className="hp-label">Kasir</div><div className="hp-nilai">{s.kasir ?? '—'}</div></div>
                    <div className="hp-sel"><div className="hp-label">Faktur</div><div className="hp-nilai">{s.no_faktur ?? '—'}</div></div>
                  </div>
                  <div className="hp-aksi">
                    <button type="button" className="tombol tombol--kecil" onClick={() => setLihatId(s.id)}>Lihat</button>
                    <button
                      type="button"
                      className="tombol tombol--kecil tombol--bahaya"
                      disabled={s.status !== 'disahkan' || !bolehBatal}
                      onClick={() => bukaBatal(s)}
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      className="tombol tombol--kecil"
                      disabled={s.status !== 'disahkan'}
                      onClick={() => setLayanan(s)}
                    >
                      Retur
                    </button>
                  </div>
                </article>
              ))}
            </div>
            </>
          )}
          </section>
          </>
        )}

        {/* ----------------- TAMPILAN 3: Dokumen (Faktur & Struk) ---------- */}
        {pandangan === 'dokumen' && (
          <>
          <BarPeriode
            nilai={periode}
            onUbah={ubahPeriode}
            ringkasan={`Menampilkan ${labelRentang(tglDari, tglSampai)} · ${riwayat.length} transaksi · ${totalDokumen} faktur`}
          />
          <section className="dok-seksi dok-seksi--dokumen" aria-label="Dokumen faktur terbit">
            <div className="dok-judul dok-judul--dokumen" ref={dokumenRef} style={{ scrollMarginTop: 12 }}>
              <span className="dok-judul__ikon" aria-hidden="true">
                📄
              </span>
              <h4 className="bagian-judul">Dokumen (faktur terbit)</h4>
              <span className="dok-hitung dok-hitung--dokumen">{totalDokumen} faktur</span>
            </div>
            <p className="teks-redup teks-kecil dok-sub">
              Hanya transaksi yang sudah disahkan (punya faktur) pada periode tampil. Satu set aksi Dokumen: lihat,
              WhatsApp, simpan PDF, cetak.
            </p>
            <div className="tabel-bungkus sembunyi-hp">
              <table className="tabel dok-tabel--dokumen">
                <thead>
                  <tr>
                    <th>No. faktur</th>
                    <th>Tanggal</th>
                    <th>Pelanggan</th>
                    <th>Dokumen sumber</th>
                    <th className="rata-kanan">Total</th>
                    <th>Status</th>
                    <th className="rata-kanan">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {sibukDokumen && dokumen.length === 0 ? (
                    <tr>
                      <td className="tabel-kosong" colSpan={7}>
                        Memuat…
                      </td>
                    </tr>
                  ) : dokumen.length === 0 ? (
                    <tr>
                      <td className="tabel-kosong" colSpan={7}>
                        Belum ada faktur penjualan pada periode tampil.
                      </td>
                    </tr>
                  ) : (
                    dokumen.map((f) => (
                      <tr key={f.id}>
                        <td>
                          <code className="kode-dok kode-dok--inv">{f.no_faktur}</code>
                        </td>
                        <td className="whitespace-nowrap teks-kecil">{formatTanggal(f.tanggal)}</td>
                        <td>{f.pihak_nama || '—'}</td>
                        <td>
                          <code className="kode-dok kode-dok--sj">{f.no_sumber || '—'}</code>
                        </td>
                        <td className="rata-kanan">
                          <strong>{formatRupiah(Number(f.total))}</strong>
                        </td>
                        <td>
                          <span className={`lencana ${f.status === 'batal' ? 'lencana--bahaya' : 'lencana--aktif'}`}>
                            {f.status === 'batal' ? 'Batal' : 'Terbit'}
                          </span>
                        </td>
                        <td className="rata-kanan">
                          <span className="aksi-baris">
                            <IconButton label="Lihat faktur" ikon="eye" ukuran="baris" onClick={() => navigasi(`/penjualan/dokumen/${f.id}`)} />
                            <IconButton label="Kirim via WhatsApp" ikon="whatsapp" ukuran="baris" onClick={() => setDlgWaDok(f)} />
                            <IconButton
                              label="Simpan (PDF)"
                              ikon="download"
                              ukuran="baris"
                              onClick={() => navigasi(`/penjualan/dokumen/${f.id}?cetak=1`)}
                            />
                            <IconButton
                              label="Cetak"
                              ikon="printer"
                              ukuran="baris"
                              onClick={() => navigasi(`/penjualan/dokumen/${f.id}?cetak=1`)}
                            />
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="hp-daftar hp-daftar--dokumen">
              {sibukDokumen && dokumen.length === 0 ? (
                <div className="hp-kartu"><div className="hp-kartu__sub">Memuat…</div></div>
              ) : dokumen.length === 0 ? (
                <div className="hp-kartu"><div className="hp-kartu__sub">Belum ada faktur penjualan pada periode tampil.</div></div>
              ) : (
                dokumen.map((f) => (
                  <article className="hp-kartu" key={`hp-dok-${f.id}`}>
                    <div className="hp-kartu__atas">
                      <span className="hp-kartu__kode kode-dok kode-dok--inv">{f.no_faktur}</span>
                      <span className="hp-kartu__kanan">{formatTanggal(f.tanggal)}</span>
                    </div>
                    <div className="hp-kartu__nama">{formatRupiah(Number(f.total))}</div>
                    <div className="hp-kartu__sub">{f.pihak_nama || '—'} · {f.no_sumber || '—'} · <span className={`lencana ${f.status === 'batal' ? 'lencana--bahaya' : 'lencana--aktif'}`}>{f.status === 'batal' ? 'Batal' : 'Terbit'}</span></div>
                    <div className="hp-ikonbar">
                      <IconButton label="Lihat faktur" ikon="eye" ukuran="baris" onClick={() => navigasi(`/penjualan/dokumen/${f.id}`)} />
                      <IconButton label="Kirim via WhatsApp" ikon="whatsapp" ukuran="baris" onClick={() => setDlgWaDok(f)} />
                      <IconButton label="Simpan (PDF)" ikon="download" ukuran="baris" onClick={() => navigasi(`/penjualan/dokumen/${f.id}?cetak=1`)} />
                      <IconButton label="Cetak" ikon="printer" ukuran="baris" onClick={() => navigasi(`/penjualan/dokumen/${f.id}?cetak=1`)} />
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
          </>
        )}
        </section>
        </>
      )}
      {/* ============ Retur / Piutang: kartu mandiri ============ */}
      {tab !== 'riwayat' && (
      <section className="kartu">
        <div className="kartu__kepala kartu__kepala--kompak">
          <div>
            <h3>{judulTab}</h3>
            <p className="teks-redup teks-kecil">
              {tab === 'retur'
                ? 'Daftar retur penjualan yang tercatat di POS.'
                : 'Piutang penjualan (kredit) beserta jatuh tempo dan pelunasannya.'}
            </p>
          </div>
          <TombolPos />
        </div>

        {/* ------------------------------- Retur ----------------------------- */}
        {tab === 'retur' && (
          <div className="tabel-bungkus">
            <table className="tabel">
              <thead>
                <tr>
                  <th>No. Retur</th>
                  <th>Tanggal</th>
                  <th>No. Penjualan</th>
                  <th>Pelanggan</th>
                  <th>Kasir</th>
                  <th>Alasan</th>
                  <th>Rincian Barang</th>
                  <th className="rata-kanan">Total</th>
                  <th>Status</th>
                  <th className="rata-kanan">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {sibuk ? (
                  <tr>
                    <td className="tabel-kosong" colSpan={10}>
                      Memuat…
                    </td>
                  </tr>
                ) : retur.length === 0 ? (
                  <tr>
                    <td className="tabel-kosong" colSpan={10}>
                      Belum ada retur penjualan. Retur dibuat dari aksi Retur pada tab Riwayat.
                    </td>
                  </tr>
                ) : (
                  retur.map((x) => (
                    <tr key={x.id}>
                      <td>{x.no_dokumen}</td>
                      <td className="whitespace-nowrap">{formatTanggal(x.tanggal)}</td>
                      <td>{x.no_penjualan}</td>
                      <td>{x.pelanggan ?? 'Umum'}</td>
                      <td>{x.kasir ?? '—'}</td>
                      <td>{x.alasan ?? '—'}</td>
                      <td>
                        <RincianBarangRetur items={x.items} onBuka={() => setDetailRetur(x)} />
                      </td>
                      <td className="rata-kanan whitespace-nowrap">
                        {formatRupiah(Number(x.total))}
                      </td>
                      <td>
                        <span className={`lencana ${lencanaStatus(x.status)}`}>{x.status}</span>
                      </td>
                      <td className="rata-kanan">
                        <IconButton
                          label={`Detail retur ${x.no_dokumen}`}
                          ikon="eye"
                          ukuran="baris"
                          onClick={() => setDetailRetur(x)}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ------------------------------ Piutang ---------------------------- */}
        {tab === 'piutang' && (
          <div className="tabel-bungkus">
            <table className="tabel">
              <thead>
                <tr>
                  <th>No. Penjualan</th>
                  <th>Tanggal</th>
                  <th>Pelanggan</th>
                  <th>Jatuh Tempo</th>
                  <th className="rata-kanan">Total</th>
                  <th className="rata-kanan">Terbayar</th>
                  <th className="rata-kanan">Sisa</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sibuk ? (
                  <tr>
                    <td className="tabel-kosong" colSpan={8}>
                      Memuat…
                    </td>
                  </tr>
                ) : piutang.length === 0 ? (
                  <tr>
                    <td className="tabel-kosong" colSpan={8}>
                      Belum ada piutang. Piutang tercatat otomatis saat penjualan dibayar kredit.
                    </td>
                  </tr>
                ) : (
                  piutang.map((p) => (
                    <tr key={p.id}>
                      <td>{p.no_dokumen}</td>
                      <td className="whitespace-nowrap">{formatTanggal(p.tanggal)}</td>
                      <td>{p.pelanggan ?? '—'}</td>
                      <td className="whitespace-nowrap">{p.jatuh_tempo ? formatTanggal(p.jatuh_tempo) : '—'}</td>
                      <td className="rata-kanan whitespace-nowrap">{formatRupiah(Number(p.total))}</td>
                      <td className="rata-kanan whitespace-nowrap">{formatRupiah(Number(p.terbayar))}</td>
                      <td className="rata-kanan whitespace-nowrap">
                        <strong>{formatRupiah(Number(p.sisa))}</strong>
                      </td>
                      <td>
                        <span className={`lencana ${lencanaStatus(p.status)}`}>{p.status}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
      )}

      {/* ------------------------- Dialog "Lihat" --------------------------- */}
      {lihatId != null && (
        <Modal
          judul={detail ? `Penjualan ${detail.no_dokumen}` : 'Detail penjualan'}
          lebar="lebar"
          onTutup={() => setLihatId(null)}
          aksi={
            <>
              <button type="button" className="tombol tombol--netral" onClick={() => setLihatId(null)}>
                Tutup
              </button>
              {detail && (
                <>
                  <button
                    type="button"
                    className="tombol tombol--netral"
                    onClick={() => {
                      void strukDariSale(detail.id, usaha.nama)
                        .then((s) => cetakStruk(s, profil ?? PROFIL_STRUK_BAWAAN))
                        .catch((e: Error) => beritahu(e.message, 'galat'));
                    }}
                  >
                    Cetak struk
                  </button>
                  <button
                    type="button"
                    className="tombol tombol--netral"
                    onClick={() => {
                      void strukDariSale(detail.id, usaha.nama)
                        .then((s) => {
                          setWaStruk(s);
                          setLihatId(null);
                        })
                        .catch((e: Error) => beritahu(e.message, 'galat'));
                    }}
                  >
                    Kirim WhatsApp
                  </button>
                  {/* Token Edit — muat transaksi ke form kasir aktif. */}
                  <button
                    type="button"
                    className="tombol tombol--primer"
                    disabled={detail.status !== 'disahkan' || !bolehEdit}
                    title={
                      detail.status !== 'disahkan'
                        ? 'Hanya transaksi disahkan yang bisa diedit'
                        : !bolehKelola
                          ? 'Butuh Hak Khusus Hapus transaksi'
                          : pesanIzin(sesiInfo, 'penjualan', 'ubah', 'mengedit transaksi')
                    }
                    onClick={() => bukaEdit(detail.id)}
                  >
                    <Icon nama="pencil" size={16} /> Edit Transaksi
                  </button>
                </>
              )}
            </>
          }
        >
          {!detail ? (
            <p className="teks-redup">Memuat…</p>
          ) : (
            <div className="penjualan-detail">
              <div className="penjualan-detail__info">
                <div>
                  <span>Waktu</span>
                  <b>{formatTanggalWaktu(detail.tanggal)}</b>
                </div>
                <div>
                  <span>Pelanggan</span>
                  <b>{detail.pelanggan ?? 'Umum'}</b>
                </div>
                <div>
                  <span>Kasir</span>
                  <b>{detail.kasir ?? '—'}</b>
                </div>
                <div>
                  <span>Status</span>
                  <b>
                    <span
                      className={`lencana ${
                        returPenuh
                          ? 'lencana--bahaya'
                          : adaRetur
                            ? 'lencana--peringatan'
                            : lencanaStatus(detail.status)
                      }`}
                    >
                      {labelStatus}
                    </span>
                  </b>
                </div>
                <div>
                  <span>{adaRetur ? 'Subtotal Awal' : 'Subtotal'}</span>
                  <b>{formatRupiah(subtotalAwal)}</b>
                </div>
                <div>
                  <span>Diskon</span>
                  <b>{formatRupiah(Number(detail.diskon))}</b>
                </div>
                <div>
                  <span>Pajak</span>
                  <b>{formatRupiah(Number(detail.pajak))}</b>
                </div>
                {adaRetur && (
                  <div>
                    <span>Total Retur Penjualan</span>
                    <b className="penjualan-nilai-retur">
                      −{formatRupiah(totalRetur)}
                      <small className="penjualan-retur-dok">
                        {returSah.map((r) => r.no_dokumen).join(', ')}
                      </small>
                    </b>
                  </div>
                )}
                <div>
                  <span>{adaRetur ? 'Total Bersih (Net Sales)' : 'Total'}</span>
                  <b className={adaRetur ? 'penjualan-nilai-net' : undefined}>
                    {formatRupiah(adaRetur ? totalBersih : Number(detail.total))}
                  </b>
                </div>
              </div>

              {/* Akumulasi Qty — tetap terbaca walau ada retur (Net = Awal − Retur). */}
              <div className="penjualan-qty" role="group" aria-label="Akumulasi kuantitas barang">
                <div className="penjualan-qty__kotak">
                  <span>Total Qty Awal</span>
                  <b>
                    {formatAngka(totalQtyAwal)}
                    <small>Psg / Pcs</small>
                  </b>
                </div>
                <div
                  className={`penjualan-qty__kotak ${
                    totalQtyRetur > 0 ? 'penjualan-qty__kotak--retur' : 'penjualan-qty__kotak--kosong'
                  }`}
                >
                  <span>Total Qty Retur</span>
                  <b>
                    {totalQtyRetur > 0 ? `−${formatAngka(totalQtyRetur)}` : '0'}
                    <small>Psg / Pcs</small>
                  </b>
                </div>
                <div className="penjualan-qty__kotak penjualan-qty__kotak--net">
                  <span>Total Qty Net (Bersih)</span>
                  <b>
                    {formatAngka(totalQtyNet)}
                    <small>Psg / Pcs</small>
                  </b>
                </div>
              </div>

              <table className="tabel tabel-detail-item">
                <colgroup>
                  <col style={{ width: '32%' }} />
                  <col style={{ width: '16%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '14%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Produk</th>
                    <th>SKU</th>
                    <th className="kolom-qty">Qty Awal</th>
                    <th className="kolom-qty">Qty Retur</th>
                    <th className="kolom-qty">Qty Net</th>
                    <th className="rata-kanan">Harga</th>
                    <th className="rata-kanan">Subtotal Net</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((i, n) => {
                    const qtyAwal = Number(i.qty);
                    const qtyRetur = Math.min(qtyAwal, Math.max(0, Number(i.qty_retur ?? 0)));
                    const qtyNet = Math.max(0, qtyAwal - qtyRetur);
                    const subNet = Math.max(0, Number(i.subtotal) - qtyRetur * Number(i.harga));
                    const penuh = qtyRetur > 0 && qtyNet === 0;
                    return (
                      <tr key={`${i.product_id}-${n}`} className={penuh ? 'penjualan-baris--retur-penuh' : undefined}>
                        <td>
                          <span className="penjualan-nama-produk">{i.nama_produk}</span>
                          {qtyRetur > 0 && (
                            <span className={`penjualan-retur-badge${penuh ? ' penjualan-retur-badge--penuh' : ''}`}>
                              ↩ {penuh ? 'Full Retur' : 'Diretur'}: {qtyRetur} pcs
                            </span>
                          )}
                        </td>
                        <td>{i.sku}</td>
                        <td className="kolom-qty">{qtyAwal}</td>
                        <td className="kolom-qty">{qtyRetur > 0 ? qtyRetur : '—'}</td>
                        <td className="kolom-qty kolom-qty--net">{qtyNet}</td>
                        <td className="rata-kanan">{formatRupiah(Number(i.harga))}</td>
                        <td className="rata-kanan">{formatRupiah(subNet)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <h4 className="penjualan-detail__sub">Pembayaran</h4>
              <table className="tabel">
                <thead>
                  <tr>
                    <th>Metode</th>
                    <th className="rata-kanan">Jumlah</th>
                    <th>Referensi</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.payments.length === 0 ? (
                    <tr>
                      <td className="tabel-kosong" colSpan={3}>
                        Belum ada pembayaran tercatat.
                      </td>
                    </tr>
                  ) : (
                    detail.payments.map((p, n) => (
                      <tr key={n}>
                        <td>{p.metode}</td>
                        <td className="rata-kanan">{formatRupiah(Number(p.jumlah))}</td>
                        <td>{p.referensi ?? '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              {(detail.retur ?? []).length > 0 && (
                <>
                  <h4 className="penjualan-detail__sub">Retur</h4>
                  <table className="tabel">
                    <thead>
                      <tr>
                        <th>No. Retur</th>
                        <th>Tanggal</th>
                        <th className="rata-kanan">Total</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.retur ?? []).map((r) => (
                        <tr key={r.id}>
                          <td>{r.no_dokumen}</td>
                          <td>{formatTanggal(r.tanggal)}</td>
                          <td className="rata-kanan">{formatRupiah(Number(r.total))}</td>
                          <td>
                            <span className={`lencana ${lencanaStatus(r.status)}`}>{r.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}
        </Modal>
      )}

      {/* ----------------- Detail Dokumen Retur (barang diretur) ------------- */}
      {detailRetur && (
        <ModalDetailRetur
          judul={`Detail Retur ${detailRetur.no_dokumen}`}
          dokumen={{
            no_dokumen: detailRetur.no_dokumen,
            tanggal: detailRetur.tanggal,
            alasan: detailRetur.alasan,
            items: detailRetur.items,
          }}
          info={[
            { label: 'No. Penjualan', nilai: detailRetur.no_penjualan },
            { label: 'Pelanggan', nilai: detailRetur.pelanggan ?? 'Umum' },
            { label: 'Kasir', nilai: detailRetur.kasir ?? '—' },
          ]}
          total={Number(detailRetur.total)}
          status={detailRetur.status}
          onTutup={() => setDetailRetur(null)}
        />
      )}

      {/* ------------------- Token Batal (void) penjualan ------------------- */}
      {batalBaris && (
        <DialogBatal
          judul={`Batalkan penjualan ${batalBaris.no_dokumen}?`}
          deskripsi="Transaksi dibatalkan permanen: stok kembali ke gudang, kas/piutang dibalik, dan faktur sumber ikut dibatalkan."
          butuhSandi
          sibuk={batalSibuk}
          galat={batalGalat}
          onKirim={batalkan}
          onTutup={() => setBatalBaris(null)}
        />
      )}

      {/* ----------------- Retur dari daftar (Admin + password) ------------- */}
      {layanan && (
        <DialogLayanan
          namaUsaha={usaha.nama}
          profil={profil}
          langkahAwal={{ mode: 'retur', sale: layanan }}
          onSelesai={() => {
            setLayanan(null);
            void muat();
          }}
          onTutup={() => setLayanan(null)}
        />
      )}

      {/* --------------------- R2 — WA faktur dari Dokumen ------------------ */}
      {dlgWaDok && (
        <DialogWa
          faktur={{
            id: Number(dlgWaDok.id),
            no_faktur: String(dlgWaDok.no_faktur),
            tanggal: String(dlgWaDok.tanggal),
            total: Number(dlgWaDok.total),
          }}
          teleponAwal={String(dlgWaDok.pihak_telepon ?? '')}
          pihakNama={String(dlgWaDok.pihak_nama ?? '')}
          onTutup={() => setDlgWaDok(null)}
        />
      )}

      {/* --------------------------- Kirim struk ---------------------------- */}
      {waStruk && (
        <DialogWa
          faktur={{
            id: 0,
            no_faktur: waStruk.noDokumen,
            tanggal: waStruk.tanggal,
            total: waStruk.total,
          }}
          pihakNama={waStruk.pelanggan ?? ''}
          pesanLain={pesanWaStruk(waStruk)}
          gambar={gambarStrukDok(waStruk, profil)}
          onTutup={() => setWaStruk(null)}
        />
      )}
    </div>
  );
}

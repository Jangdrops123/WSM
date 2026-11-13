import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Modal } from '../../components/crud/Modal';
import { beritahu } from '../../components/crud/Toast';
import { apiDelete, apiGet, apiPost, apiPut } from '../../lib/api';
import { formatRupiah, formatTanggal, formatTanggalWaktu } from '../../lib/format';
import { bolehKelolaTransaksi, can, MODUL_PO, pesanIzin } from '../../lib/hak';
import { useSegarkanModul } from '../../lib/segarkan';
import { useSesi } from '../../lib/sesi';
import { useIdentitas } from '../../lib/identitas';
import { useUsaha } from '../../lib/usaha';
import { LABEL_STATUS_PO, lewatTenggat, formatKodi, type StatusPo } from '../../lib/kodi';
import { bagikanGambar, bisaBagikanGambar, bukaWa, formatWa62, nomorWaValid, unduhBlob } from '../../lib/gambarPo';
import { TEMPLATE_PO, pesanWaPo, type PoDokData, type TemplatePo } from './poDok';
import { fakturPoKePng } from './fakturPng';
import { FakturPo, PilihKertasPo, aturanKertasPo, bacaKertasPo, ppnAktifDari, simpanKertasPo, type UkuranKertasPo } from './FakturPo';
import { pakaiKodi } from './pakaiKodi';
import './po.css';
import './po-hub.css';

type Baris = Record<string, any>;

/** Salin gambar PNG ke clipboard (desktop) agar bisa ditempel di WhatsApp Web. */
async function salinGambar(blob: Blob): Promise<boolean> {
  try {
    const klip = navigator.clipboard as Clipboard & {
      write?: (items: ClipboardItem[]) => Promise<void>;
    };
    if (!klip?.write || typeof ClipboardItem === 'undefined') return false;
    await klip.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

/** Detail PO — ringkasan, kirim PO, kirim sisa/lebih, tutup, riwayat terima. */
export function PoDetail() {
  const { id } = useParams();
  const navigasi = useNavigate();
  const sesiInfo = useSesi().info;
  const identitas = useIdentitas();
  const usaha = useUsaha();
  const bisaUbah = can(sesiInfo, MODUL_PO, 'ubah');
  const bisaHapus = can(sesiInfo, MODUL_PO, 'hapus');
  const bisaCetak = can(sesiInfo, MODUL_PO, 'cetak');
  const bolehKelola = bolehKelolaTransaksi(sesiInfo);

  const [po, setPo] = useState<Baris | null>(null);
  const [isiKodi, setIsiKodi] = useState(20);
  const { kodiAktif } = pakaiKodi();
  const [sibuk, setSibuk] = useState(true);
  const [sibukAksi, setSibukAksi] = useState(false);
  const [konfirmHapus, setKonfirmHapus] = useState(false);
  const [konfirmTutup, setKonfirmTutup] = useState(false);
  const [konfirmBatal, setKonfirmBatal] = useState(false);
  const [dlgKirim, setDlgKirim] = useState(false);
  const [tujuan, setTujuan] = useState('');
  const [template, setTemplate] = useState<TemplatePo>('penuh');
  const [nomorWa, setNomorWa] = useState('');
  /** Opsi: simpan nomor yang diketik ke master pemasok (bila master kosong/beda). */
  const [simpanKeMaster, setSimpanKeMaster] = useState(false);
  const [sibukGambar, setSibukGambar] = useState(false);
  const [kertas, setKertas] = useState<UkuranKertasPo>('A4');
  const [statusManual, setStatusManual] = useState('');
  /** Catatan faktur (opsional) — quick edit tersimpan ke purchase_orders.catatan. */
  const [catatan, setCatatan] = useState('');
  const [sibukCatatan, setSibukCatatan] = useState(false);
  const sentuhCatatan = useRef(false);
  /** Nomor WA sudah diketik manual → jangan ditimpa nomor master saat muat ulang. */
  const sentuhNomorWa = useRef(false);
  // Tab header: detail PO (bawaan) atau riwayat penerimaan (GRN).
  const [tab, setTab] = useState<'detail' | 'riwayat'>('detail');

  const muat = useCallback(async () => {
    setSibuk(true);
    try {
      const r = await apiGet<{ data: Baris; isi_per_kodi: number }>(`/api/po/${id}`);
      setPo(r.data);
      if (r.isi_per_kodi) setIsiKodi(r.isi_per_kodi);
      // Sinkronisasi otomatis dari master pemasok (hanya bila belum diketik manual).
      if (!sentuhNomorWa.current && r.data.supplier_telepon) setNomorWa(String(r.data.supplier_telepon));
      if (!sentuhCatatan.current) setCatatan(String(r.data.catatan ?? ''));
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibuk(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    void muat();
  }, [muat]);
  useEffect(() => {
    setKertas(bacaKertasPo());
  }, []);
  useSegarkanModul(muat);
  // Pindah tab dimulai dari atas halaman — detail PO bisa sangat panjang,
  // jadi riwayat penerimaan tidak pernah terbuka di tengah gulir.
  useEffect(() => {
    for (const sel of ['.app-utama', '.konten']) {
      document.querySelector<HTMLElement>(sel)?.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [tab]);

  if (sibuk) {
    return (
      <div className="halaman">
        <section className="kartu" aria-busy="true" aria-label="Memuat PO">
          <div className="po-skeleton" />
          <div className="po-skeleton" />
        </section>
      </div>
    );
  }
  if (!po) {
    return (
      <div className="halaman">
        <section className="kartu">
          <div className="po-kosong">
            <div className="po-kosong-ikon" aria-hidden="true">📄</div>
            <strong>PO tidak ditemukan</strong>
            <p>Mungkin sudah dihapus. Kembali ke daftar PO.</p>
            <Link className="tombol tombol--netral" to="/po" style={{ marginTop: 8 }}>‹ Daftar PO</Link>
          </div>
        </section>
      </div>
    );
  }

  const st = String(po.status) as StatusPo;
  const items = (po.items as Baris[]) ?? [];
  const diLuar = (po.di_luar_po as Baris[]) ?? [];
  const receipts = (po.receipts as Baris[]) ?? [];
  const susulan = (po.susulan as Baris[]) ?? [];
  const tPesan = items.reduce((n, i) => n + (Number(i.qty_pesan) || 0), 0);
  const tDatang = items.reduce((n, i) => n + (Number(i.total_datang) || 0), 0);
  const tSisa = items.reduce((n, i) => n + (Number(i.sisa) || 0), 0);

  const dokData = (): PoDokData => ({
    no_po: String(po.no_po),
    tanggal: String(po.tanggal),
    supplier_nama: String(po.supplier_nama ?? ''),
    catatan: po.catatan as string | null,
    toko_nama: identitas.nama || 'Toko',
    ppn_aktif: ppnAktifDari(po as Record<string, unknown> | null),
    items: items.map((i) => ({
      produk_nama: String(i.produk_nama ?? ''),
      sku: (i.sku as string) ?? null,
      qty_pesan: Number(i.qty_pesan) || 0,
      total_datang: Number(i.total_datang) || 0,
      sisa: Number(i.sisa) || 0,
      selisih: Number(i.selisih) || 0,
      harga_beli: Number(i.harga_beli) || 0,
      catatan: (i.catatan as string) ?? null,
    })),
  });

  const kirimPo = async () => {
    if (sibukAksi) return;
    setSibukAksi(true);
    try {
      await apiPost(`/api/po/${po.id}/kirim`, { tujuan: tujuan.trim() || undefined });
      beritahu(`PO ${po.no_po} terkirim.`);
      setDlgKirim(false);
      await muat();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibukAksi(false);
    }
  };

  const tutupPo = async () => {
    if (sibukAksi) return;
    setSibukAksi(true);
    try {
      await apiPost(`/api/po/${po.id}/tutup`, {});
      beritahu('PO ditutup.');
      setKonfirmTutup(false);
      await muat();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibukAksi(false);
    }
  };

  const hapusPo = async () => {
    if (sibukAksi) return;
    setSibukAksi(true);
    try {
      await apiDelete(`/api/po/${po.id}`);
      beritahu(`PO ${po.no_po} dihapus.`);
      navigasi('/po');
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibukAksi(false);
    }
  };

  /**
   * Seluruh item PO — filter baris, kolom, & nominal ditentukan per template di
   * FakturPo/fakturPng (satu sumber: templateDokPo.ts).
   */
  const barisFaktur = () =>
    items.map((i) => ({
      kode: String(i.kode_item ?? i.sku ?? ''),
      nama: String(i.produk_nama ?? ''),
      qty: Number(i.qty_pesan) || 0,
      harga: Number(i.harga_beli) || 0,
      datang: Number(i.total_datang) || 0,
    }));
  /** Barang datang di luar PO — hanya dipakai template Ringkasan PO lengkap. */
  const barisLuarFaktur = () =>
    diLuar.map((i) => ({
      kode: String(i.kode_item ?? i.sku ?? ''),
      nama: String(i.produk_nama ?? ''),
      qty: 0,
      harga: Number(i.harga_beli) || 0,
      datang: Number(i.total_datang) || 0,
      luarPo: true,
    }));

  /** PNG dari template faktur resmi A4 (bukan raster struk). */
  const pngFaktur = async () =>
    fakturPoKePng(
      {
        tokoNama: identitas.nama || usaha.nama || 'Toko',
        usahaAlamat: usaha.alamat || null,
        usahaTelepon: usaha.telepon || null,
        usahaEmail: usaha.email || null,
        template,
        noPo: String(po.no_po),
        tanggal: String(po.tanggal),
        pemasokNama: String(po.supplier_nama ?? ''),
        pemasokAlamat: po.supplier_alamat as string | null,
        pemasokTelepon: po.supplier_telepon as string | null,
        gudang: po.gudang_nama as string | null,
        catatan: po.catatan as string | null,
        items: barisFaktur(),
        luarPoItems: barisLuarFaktur(),
        isiKodi: isiKodi,
        kodiAktif,
        // PO susulan → badge & referensi PO induk ikut di gambar WhatsApp.
        refPoNomor: po.parent_no_po ? String(po.parent_no_po) : null,
      },
      `PO-${String(po.no_po)}.png`.replace(/[^0-9A-Za-z-.]+/g, '_'),
    );

  /** Simpan nomor WhatsApp yang diketik ke profil pemasok (master suppliers). */
  const simpanNomorKePemasok = async (): Promise<boolean> => {
    const nomor = nomorWa.trim();
    if (!nomor || !bisaUbah) return false;
    try {
      const r = await apiPut<{ data: Baris }>(`/api/po/${po.id}/telepon-supplier`, { telepon: nomor });
      setPo(r.data);
      setSimpanKeMaster(false);
      sentuhNomorWa.current = true;
      beritahu(`Nomor WhatsApp disimpan ke profil pemasok ${String(po.supplier_nama ?? '')}.`);
      return true;
    } catch (err) {
      beritahu((err as Error).message, 'galat');
      return false;
    }
  };

  const kirimGambarWa = async () => {
    if (sibukGambar) return;
    if (!nomorWaValid(nomorWa)) {
      beritahu('Nomor WhatsApp belum valid — isi dulu (contoh: 08123456789).', 'galat');
      return;
    }
    setSibukGambar(true);
    try {
      // Nomor baru yang dicentang "simpan ke pemasok" disimpan dulu.
      if (simpanKeMaster) await simpanNomorKePemasok();
      const { blob, namaBerkas } = await pngFaktur();
      if (bisaBagikanGambar()) {
        const hasil = await bagikanGambar(blob, namaBerkas, String(po.no_po), pesanWaPo(dokData(), template, isiKodi));
        if (hasil === 'dibagikan') {
          beritahu('Gambar terkirim — lanjutkan di WhatsApp.');
          return;
        }
        if (hasil === 'batal') return;
      }
      // Desktop: unduh + salin gambar ke clipboard, lalu buka WhatsApp Web
      // dengan pesan terisi — admin cukup menekan Ctrl+V.
      const tersalin = await salinGambar(blob);
      unduhBlob(blob, namaBerkas);
      beritahu(
        tersalin
          ? `Gambar ${namaBerkas} diunduh & disalin ke clipboard — tekan Ctrl+V di WhatsApp Web.`
          : `Gambar ${namaBerkas} diunduh — lampirkan manual di WhatsApp.`,
        'info',
        7000,
      );
      bukaWa(nomorWa, pesanWaPo(dokData(), template, isiKodi));
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibukGambar(false);
    }
  };

  const catatanKotor = catatan !== String(po.catatan ?? '');

  /** Simpan catatan faktur (opsional) — tampil di kotak rekonsiliasi semua faktur. */
  const simpanCatatan = async () => {
    if (sibukCatatan || !catatanKotor) return;
    setSibukCatatan(true);
    try {
      const r = await apiPut<{ data: Baris }>(`/api/po/${po.id}/catatan`, { catatan });
      setPo(r.data);
      setCatatan(String(r.data.catatan ?? ''));
      sentuhCatatan.current = false;
      beritahu('Catatan faktur disimpan.');
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibukCatatan(false);
    }
  };

  const aktif = ['terkirim', 'sebagian', 'lebih'].includes(st);
  const terminal = ['selesai', 'selesai_kurang', 'kadaluwarsa', 'batal'].includes(st);
  const lewat = lewatTenggat(po.tenggat) && aktif;

  /** Ubah status manual generik (kadaluwarsa / buka kembali langsung). */
  const ubahStatusPo = async (target: 'kadaluwarsa' | 'terkirim') => {
    if (sibukAksi) return;
    setSibukAksi(true);
    try {
      await apiPost(`/api/po/${po.id}/status`, { status: target });
      beritahu(target === 'kadaluwarsa' ? `PO ${po.no_po} ditandai Kadaluwarsa.` : `PO ${po.no_po} dibuka kembali (Proses).`);
      await muat();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibukAksi(false);
    }
  };

  /** Batalkan PO (konfirmasi dulu) — hanya bila belum ada barang datang. */
  const batalPo = async () => {
    if (sibukAksi) return;
    setSibukAksi(true);
    try {
      await apiPost(`/api/po/${po.id}/status`, { status: 'batal' });
      beritahu(`PO ${po.no_po} dibatalkan.`);
      setKonfirmBatal(false);
      await muat();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibukAksi(false);
    }
  };

  /** Simpan tenggat PO draft (PUT butuh items — kirim ulang items yang ada). */
  const simpanTenggat = async (nilai: string) => {
    if (sibukAksi || st !== 'draft') return;
    setSibukAksi(true);
    try {
      await apiPut(`/api/po/${po.id}`, {
        items: items.map((i) => ({
          product_id: Number(i.product_id),
          qty_pesan: Number(i.qty_pesan) || 0,
          harga_beli: Number(i.harga_beli) || 0,
          catatan: (i.catatan as string) ?? null,
        })),
        tenggat: nilai || null,
      });
      beritahu(nilai ? `Tenggat PO diset ${nilai}.` : 'Tenggat PO dihapus.');
      await muat();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibukAksi(false);
    }
  };

  /** Stepper siklus manual: Proses → Pengiriman → Diterima → Selesai. */
  const TAHAP_SIKLUS = ['Proses', 'Pengiriman', 'Diterima', 'Selesai'] as const;
  const tahapAktif = st === 'draft' ? 0 : st === 'terkirim' ? 1 : st === 'sebagian' || st === 'lebih' ? 2 : 3;
  const opsiManual = [
    ...(st === 'draft' && bisaUbah ? [{ kode: 'kirim', label: 'Tandai Terkirim (Pengiriman)' }] : []),
    ...(aktif && bisaUbah ? [{ kode: 'kadaluwarsa', label: 'Tandai Kadaluwarsa' }] : []),
    ...(aktif && bisaHapus ? [
      { kode: 'tutup', label: 'Tutup PO → Selesai (selisih diabaikan)' },
      { kode: 'batal', label: 'Batalkan PO' },
    ] : []),
    ...(terminal && bisaUbah ? [{ kode: 'buka', label: 'Buka kembali → Proses' }] : []),
  ];
  const pilihStatusManual = (kode: string) => {
    setStatusManual('');
    if (kode === 'kirim' && st === 'draft') setDlgKirim(true);
    else if (kode === 'tutup' && aktif) setKonfirmTutup(true);
    else if (kode === 'batal' && aktif) setKonfirmBatal(true);
    else if (kode === 'kadaluwarsa' && aktif) void ubahStatusPo('kadaluwarsa');
    else if (kode === 'buka' && terminal) void ubahStatusPo('terkirim');
  };

  return (
    <div className="halaman po-modul">
      <div className="po-bar">
        <h2>
          {String(po.no_po)}{' '}
          <span className={`hub-pil ${st === 'lebih' ? 'hub-pil--lebih' : ['selesai', 'selesai_kurang'].includes(st) ? 'hub-pil--lengkap' : 'hub-pil--kurang'}`}>
            {LABEL_STATUS_PO[st] ?? st}
          </span>
        </h2>
        <div className="po-bar__aksi">
          <Link className="hub-btn hub-btn--gelap" to="/po">‹ Daftar</Link>
          <Link
            className="hub-btn hub-btn--sky"
            to={`/po/buat?ref_po_id=${po.id}`}
            title={`Buat PO baru yang menaut ke ${String(po.no_po)} (nomor PO tetap baru)`}
          >
            + Buat PO Susulan
          </Link>
          <button
            type="button"
            className={`hub-btn ${tab === 'riwayat' ? 'hub-btn--sky' : 'hub-btn--gelap'}`}
            aria-pressed={tab === 'riwayat'}
            onClick={() => setTab(tab === 'riwayat' ? 'detail' : 'riwayat')}
            title="Riwayat penerimaan barang (GRN) PO ini"
          >
            📜 Riwayat Penerimaan{receipts.length ? ` (${receipts.length})` : ''}
          </button>
          {aktif && (
            <Link className="hub-btn hub-btn--sky" to={`/po/terima?po=${po.id}`}>
              📥 Barang Datang
            </Link>
          )}
        </div>
      </div>
      <p className="teks-redup teks-kecil po-bar__sub">
        {String(po.supplier_nama)} · {formatTanggal(po.tanggal)} · Gudang {String(po.gudang_nama ?? '')} ·
        Total {formatKodi(tPesan, isiKodi)} · {formatRupiah(Number(po.total_harga) || 0)}
      </p>
      {(po.parent_po_id || susulan.length > 0) && (
        <div className="po-tautan-susulan">
          {po.parent_po_id ? (
            <Link className="po-tautan-susulan__pil" to={`/po/${Number(po.parent_po_id)}`}>
              🔗 Susulan dari: {String(po.parent_no_po ?? `PO #${Number(po.parent_po_id)}`)}
            </Link>
          ) : null}
          {susulan.map((s) => (
            <Link key={s.id} className="po-tautan-susulan__pil" to={`/po/${s.id}`}>
              🔗 Memiliki PO Susulan: {String(s.no_po)}
            </Link>
          ))}
        </div>
      )}

      {tab === 'detail' && (
      <>
      <section className="kartu">

        {(po.dikirim_pada || po.catatan || po.tenggat || lewat) && (
          <p className="teks-redup teks-kecil">
            {po.dikirim_pada ? `Dikirim ${formatTanggalWaktu(po.dikirim_pada)}${po.dikirim_tujuan ? ` → ${po.dikirim_tujuan}` : ''}. ` : ''}
            {po.tenggat ? `Tenggat ${formatTanggal(po.tenggat)}. ` : ''}
            {po.catatan ? `Catatan: ${po.catatan}` : ''}
            {lewat && (
              <span className="lencana lencana--peringatan" title="Periode PO sudah lewat tetapi barang belum lengkap — ubah status manual menjadi Kadaluwarsa bila perlu.">
                ⚠ Lewat tenggat
              </span>
            )}
          </p>
        )}

        <div className="po-siklus" aria-label="Siklus PO">
          {TAHAP_SIKLUS.map((t, i) => (
            <Fragment key={t}>
              {i > 0 && <span className="po-siklus__garis" aria-hidden="true" />}
              <span
                className={`po-siklus__tahap${i === tahapAktif ? ' po-siklus__tahap--aktif' : i < tahapAktif ? ' po-siklus__tahap--lewat' : ''}`}
                aria-current={i === tahapAktif ? 'step' : undefined}
              >
                {`${i + 1}. ${t}`}
              </span>
            </Fragment>
          ))}
        </div>

        <div className="hub-stats" style={{ marginBottom: 12, marginTop: 8 }}>
          <div className="hub-stat">
            <div className="hub-stat__atas"><span className="hub-stat__judul">Total dipesan</span><span className="hub-stat__ikon hub-stat__ikon--sky" aria-hidden="true">🛒</span></div>
            <div className="hub-stat__angka"><strong>{tPesan.toLocaleString('id-ID')}</strong><span className="hub-stat__kodi hub-stat__kodi--sky">{formatKodi(tPesan, isiKodi)}</span></div>
            <p>{tPesan.toLocaleString('id-ID')} pcs · 1 kodi = {isiKodi} pcs</p>
          </div>
          <div className="hub-stat">
            <div className="hub-stat__atas"><span className="hub-stat__judul">Total datang</span><span className="hub-stat__ikon hub-stat__ikon--hijau" aria-hidden="true">🚚</span></div>
            <div className="hub-stat__angka"><strong className="hijau">{tDatang.toLocaleString('id-ID')}</strong><span className="hub-stat__kodi hub-stat__kodi--hijau">{formatKodi(tDatang, isiKodi)}</span></div>
            <p>{tDatang.toLocaleString('id-ID')} pcs sudah masuk gudang</p>
          </div>
          <div className="hub-stat">
            <div className="hub-stat__atas"><span className="hub-stat__judul">Total sisa</span><span className="hub-stat__ikon hub-stat__ikon--amber" aria-hidden="true">⏳</span></div>
            <div className="hub-stat__angka"><strong className="amber">{tSisa.toLocaleString('id-ID')}</strong><span className="hub-stat__kodi hub-stat__kodi--amber">{formatKodi(tSisa, isiKodi)}</span></div>
            <p>{tSisa.toLocaleString('id-ID')} pcs belum datang</p>
          </div>
          <div className="hub-stat">
            <div className="hub-stat__atas"><span className="hub-stat__judul">Total harga</span><span className="hub-stat__ikon hub-stat__ikon--indigo" aria-hidden="true">👛</span></div>
            <span className="hub-stat__nominal">{formatRupiah(Number(po.total_harga) || 0)}</span>
            <p>Nilai PO keseluruhan</p>
          </div>
        </div>

        <div className="tabel-bungkus po-tabel-gulir">
          <table className="tabel po-tabel">
            <thead>
              <tr>
                <th>Barang</th>
                <th className="rata-kanan">Kodi pesan</th>
                <th className="rata-kanan">Pcs pesan</th>
                <th className="rata-kanan">Datang</th>
                <th className="rata-kanan">Sisa</th>
                <th className="rata-kanan">Selisih</th>
                <th className="rata-kanan">Harga</th>
                <th className="rata-kanan">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const selisih = Number(it.selisih) || 0;
                return (
                  <tr key={it.product_id}>
                    <td data-label="Barang">
                      <strong>{String(it.produk_nama)}</strong>
                      <div className="teks-redup teks-kecil">{String(it.kode_item ?? it.sku ?? '')}</div>
                      {it.catatan ? <div className="teks-kecil">📝 {String(it.catatan)}</div> : null}
                      {it.catatan_datang ? <div className="teks-kecil teks-redup">📦 {String(it.catatan_datang)}</div> : null}
                    </td>
                    <td data-label="Kodi pesan" className="rata-kanan">{Math.floor((Number(it.qty_pesan) || 0) / isiKodi).toLocaleString('id-ID')} kodi</td>
                    <td data-label="Pcs pesan" className="rata-kanan">{(Number(it.qty_pesan) || 0).toLocaleString('id-ID')} pcs</td>
                    <td data-label="Datang" className="rata-kanan">{formatKodi(Number(it.total_datang) || 0, isiKodi)}</td>
                    <td data-label="Sisa" className="rata-kanan">
                      {(Number(it.sisa) || 0) > 0 ? <span className="lencana lencana--bahaya">{formatKodi(Number(it.sisa), isiKodi)}</span> : '—'}
                    </td>
                    <td data-label="Selisih" className="rata-kanan">
                      {selisih > 0 ? (
                        <span className="lencana lencana--peringatan">+{formatKodi(selisih, isiKodi)}</span>
                      ) : selisih < 0 ? (
                        <span className="lencana lencana--bahaya">{formatKodi(-selisih, isiKodi)}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td data-label="Harga" className="rata-kanan">{formatRupiah(Number(it.harga_beli) || 0)}</td>
                    <td data-label="Subtotal" className="rata-kanan">{formatRupiah((Number(it.qty_pesan) || 0) * (Number(it.harga_beli) || 0))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="po-footer-sticky" style={{ position: 'static', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginTop: 8 }}>
          <span className="teks-redup teks-kecil">TOTAL</span>
          <span><strong>{formatKodi(tPesan, isiKodi)}</strong> <span className="teks-redup">({tPesan.toLocaleString('id-ID')} pcs)</span></span>
          <span className="po-total">
            <span>Total <strong>{formatRupiah(Number(po.total_harga) || 0)}</strong></span>
          </span>
        </div>

        {diLuar.length > 0 && (
          <>
            <h4 style={{ marginTop: 12 }}>Barang di luar PO</h4>
            <div className="tabel-bungkus po-tabel-gulir">
              <table className="tabel po-tabel">
                <thead>
                  <tr>
                    <th>Barang</th>
                    <th className="rata-kanan">Datang</th>
                  </tr>
                </thead>
                <tbody>
                  {diLuar.map((l) => (
                    <tr key={l.product_id} className="po-terima-lebih">
                      <td data-label="Barang">
                        <strong>{String(l.produk_nama)}</strong> <span className="lencana lencana--peringatan">Di luar PO</span>
                      </td>
                      <td data-label="Datang" className="rata-kanan">{formatKodi(Number(l.total_datang) || 0, isiKodi)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="tombol-baris" style={{ marginTop: 12 }}>
          {/* Token Edit — PO draft cukup izin Ubah; PO terkirim/sebagian butuh
              Administrator atau Hak Khusus "Hapus transaksi". */}
          {['draft', 'terkirim', 'sebagian', 'lebih'].includes(st) && (st === 'draft' ? bisaUbah : bolehKelola) && (
            <Link className="tombol tombol--netral" to={`/po/edit/${po.id}`} title="Muat ulang PO ini ke form untuk diperbaiki">
              ✏️ Edit PO
            </Link>
          )}
          {st === 'draft' && (
            <button
              type="button" className="tombol tombol--primer"
              disabled={!bisaUbah} title={bisaUbah ? undefined : pesanIzin(sesiInfo, MODUL_PO, 'ubah', 'mengirim PO')}
              onClick={() => setDlgKirim(true)}
            >
              Kirim PO
            </button>
          )}
          {aktif && bisaUbah && (
            <button type="button" className="tombol tombol--netral" onClick={() => setKonfirmTutup(true)}>
              Tutup PO
            </button>
          )}
          {opsiManual.length > 0 && (
            <label className="po-sebaris">
              <span>Ubah status manual</span>
              <select value={statusManual} onChange={(e) => pilihStatusManual(e.target.value)} aria-label="Ubah status manual">
                <option value="">Pilih…</option>
                {opsiManual.map((o) => (
                  <option key={o.kode} value={o.kode}>{o.label}</option>
                ))}
              </select>
            </label>
          )}
          {st === 'draft' && bisaHapus && (
            <button type="button" className="tombol tombol--bahaya" onClick={() => setKonfirmHapus(true)}>
              Hapus Draft
            </button>
          )}
          {st === 'draft' && bisaUbah && (
            <label className="po-sebaris">
              <span>Tenggat (opsional)</span>
              <input
                type="date"
                defaultValue={String(po.tenggat ?? '').slice(0, 10)}
                key={String(po.tenggat ?? 'x')}
                onChange={(e) => void simpanTenggat(e.target.value)}
                aria-label="Tanggal tenggat PO"
                title="Batas periode PO — bila terlewati & barang belum lengkap, muncul badge Lewat tenggat"
              />
            </label>
          )}
        </div>
      </section>

      <section className="kartu">
        <div className="kartu__kepala">
          <div>
            <h3>Kirim ke Supplier</h3>
            <p className="teks-redup teks-kecil">Pilih template → cetak / simpan PDF atau kirim gambarnya via WhatsApp. Semua memuat total kodi, tanggal &amp; no. PO.</p>
          </div>
        </div>
        <div className="po-template-grid" role="radiogroup" aria-label="Template pengiriman">
          {TEMPLATE_PO.map((t) => (
            <button
              key={t.kode}
              type="button"
              role="radio"
              aria-checked={template === t.kode}
              className={`po-template-opsi${template === t.kode ? ' po-template-opsi--aktif' : ''}`}
              onClick={() => setTemplate(t.kode)}
            >
              <strong>{t.label}</strong>
              <span className="teks-redup teks-kecil">{t.ket}</span>
            </button>
          ))}
        </div>
        <div className="po-filter" style={{ marginTop: 12 }}>
          <label className="bidang">
            <span>Nomor WhatsApp supplier</span>
            <input
              type="tel"
              value={nomorWa}
              onChange={(e) => {
                sentuhNomorWa.current = true;
                setNomorWa(e.target.value);
              }}
              placeholder="08123456789"
            />
            <small className="teks-redup">
              {nomorWa.trim()
                ? `Terkirim ke ${formatWa62(nomorWa)}.`
                : 'Nomor di master pemasok kosong — ketik manual atau isi di Master › Pemasok.'}
            </small>
            {String(po.supplier_telepon ?? '').trim() !== '' && (
              <small className="teks-redup">
                Master pemasok: {String(po.supplier_telepon)}.
              </small>
            )}
          </label>
          {nomorWa.trim() !== '' && nomorWa.trim() !== String(po.supplier_telepon ?? '').trim() && (
            <label className="po-sebaris" title="Simpan nomor ini agar PO berikutnya terisi otomatis">
              <input
                type="checkbox"
                checked={simpanKeMaster}
                onChange={(e) => setSimpanKeMaster(e.target.checked)}
                disabled={!bisaUbah}
              />
              <span>Simpan nomor ini ke profil pemasok</span>
            </label>
          )}
        </div>
        <div className="po-filter" style={{ marginTop: 12 }}>
          <label className="bidang" style={{ flex: '1 1 100%' }}>
            <span>✏️ Catatan faktur (opsional) — tampil di kotak &quot;Catatan &amp; Rekonsiliasi Pengiriman&quot;</span>
            <textarea
              value={catatan}
              onChange={(e) => { sentuhCatatan.current = true; setCatatan(e.target.value); }}
              onBlur={() => { if (catatanKotor && bisaUbah) void simpanCatatan(); }}
              rows={3}
              maxLength={2000}
              placeholder="cth. Instruksi pengiriman khusus, syarat pembayaran, info barang rusak…"
              disabled={!bisaUbah}
              aria-label="Catatan faktur PO"
            />
            <small className="teks-redup">
              {catatanKotor ? 'Ada perubahan belum disimpan — klik Simpan atau klik di luar kolom.' : 'Kosongkan untuk menampilkan "Catatan: -" di faktur.'}
            </small>
          </label>
        </div>
        <div className="tombol-baris" style={{ marginTop: 8 }}>
          <button type="button" className="tombol tombol--netral" disabled={!bisaUbah || sibukCatatan || !catatanKotor} onClick={() => void simpanCatatan()}>
            {sibukCatatan ? 'Menyimpan…' : '💾 Simpan catatan'}
          </button>
        </div>
        <div className="po-aksi-faktur">
          <PilihKertasPo
            nilai={kertas}
            onUbah={(u) => {
              setKertas(u);
              simpanKertasPo(u);
            }}
          />
          <div className="po-aksi-faktur__tombol">
            <button
              type="button"
              className="tombol tombol--netral"
              disabled={!bisaCetak || sibukGambar}
              onClick={() => window.print()}
              title={bisaCetak ? 'Cetak / simpan PDF' : pesanIzin(sesiInfo, MODUL_PO, 'cetak', 'mencetak PO')}
            >
              🖨️ Print / Download PDF
            </button>
            <button
              type="button"
              className="tombol tombol--netral"
              disabled={!bisaUbah || !nomorWa.trim() || nomorWa.trim() === String(po.supplier_telepon ?? '').trim()}
              onClick={() => void simpanNomorKePemasok()}
              title="Perbarui nomor telepon/WhatsApp di master pemasok"
            >
              💾 Simpan nomor ke pemasok
            </button>
            <button
              type="button"
              className="tombol tombol--wa"
              disabled={!bisaCetak || sibukGambar}
              onClick={() => void kirimGambarWa()}
              title="Render faktur sebagai gambar lalu kirim via WhatsApp"
            >
              {sibukGambar ? 'Menyiapkan…' : '💬 WhatsApp'}
            </button>
          </div>
        </div>

        {/* Area cetak — hanya ini yang tampil di kertas/PDF (faktur resmi). */}
        <style>{aturanKertasPo(kertas)}</style>
        <div className="po-cetak" aria-hidden="true">
          <FakturPo
            tokoNama={identitas.nama || usaha.nama || 'Toko'}
            usahaAlamat={usaha.alamat || null}
            usahaTelepon={usaha.telepon || null}
            usahaEmail={usaha.email || null}
            template={template}
            noPo={String(po.no_po)}
            tanggal={String(po.tanggal)}
            pemasokNama={String(po.supplier_nama ?? '')}
            pemasokAlamat={po.supplier_alamat as string | null}
            pemasokTelepon={po.supplier_telepon as string | null}
            gudang={po.gudang_nama as string | null}
            catatan={po.catatan as string | null}
            items={barisFaktur()}
            luarPoItems={barisLuarFaktur()}
            isiKodi={isiKodi}
            kodiAktif={kodiAktif}
            ppnAktif={ppnAktifDari(po as Record<string, unknown> | null)}
            refPoNomor={po.parent_no_po ? String(po.parent_no_po) : null}
          />
        </div>
      </section>
      </>
      )}

      {tab === 'riwayat' && (
      <section className="kartu">
        <div className="kartu__kepala">
          <div>
            <h3>Riwayat Penerimaan</h3>
            <p className="teks-redup teks-kecil">{receipts.length} kali barang datang · stok tercatat di Kartu Stok.</p>
          </div>
          <button type="button" className="tombol tombol--netral tombol--kecil" onClick={() => setTab('detail')}>
            ‹ Detail PO
          </button>
        </div>
        {receipts.length === 0 ? (
          <p className="teks-redup">Belum ada barang datang.</p>
        ) : (
          <div className="tabel-bungkus po-tabel-gulir">
            <table className="tabel po-tabel">
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>No. surat jalan</th>
                  <th className="rata-kanan">Total datang</th>
                  <th>Catatan</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Tanggal">{formatTanggalWaktu(r.tanggal)}</td>
                    <td data-label="Surat jalan">{String(r.no_surat_jalan ?? '—')}</td>
                    <td data-label="Total datang" className="rata-kanan">{formatKodi(Number(r.total_pcs) || 0, isiKodi)}</td>
                    <td data-label="Catatan">{String(r.catatan ?? '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      )}

      {dlgKirim && (
        <Modal
          judul={`Kirim PO ${po.no_po}`}
          onTutup={() => setDlgKirim(false)}
          aksi={
            <>
              <button type="button" className="tombol tombol--netral" onClick={() => setDlgKirim(false)}>Batal</button>
              <button type="button" className="tombol tombol--primer" disabled={sibukAksi} onClick={() => void kirimPo()}>
                {sibukAksi ? 'Mengirim…' : 'Tandai Terkirim'}
              </button>
            </>
          }
        >
          <label className="bidang">
            <span>Tujuan kirim (nama / nomor / email — tercatat di PO)</span>
            <input value={tujuan} onChange={(e) => setTujuan(e.target.value)} placeholder="cth. WA 0812… / email supplier" maxLength={160} autoFocus />
          </label>
          <p className="teks-redup teks-kecil" style={{ marginTop: 8 }}>
            Status berubah menjadi “Terkirim” dan waktu kirim dicatat. Setelah itu kirim ringkasan lewat bagian “Kirim ke Supplier” di bawah.
          </p>
        </Modal>
      )}

      {konfirmTutup && (
        <Modal
          judul={`Tutup PO ${po.no_po}?`}
          onTutup={() => setKonfirmTutup(false)}
          aksi={
            <>
              <button type="button" className="tombol tombol--netral" onClick={() => setKonfirmTutup(false)}>Batal</button>
              <button type="button" className="tombol tombol--primer" disabled={sibukAksi} onClick={() => void tutupPo()}>
                {sibukAksi ? 'Menutup…' : 'Ya, tutup PO'}
              </button>
            </>
          }
        >
          <p>
            {tSisa > 0
              ? `Masih ada sisa ${formatKodi(tSisa, isiKodi)} — PO akan ditandai “Selesai Kurang” (badge merah).`
              : 'Semua barang sudah datang — PO akan ditandai “Selesai”.'}
          </p>
        </Modal>
      )}

      {konfirmBatal && (
        <Modal
          judul={`Batalkan PO ${po.no_po}?`}
          onTutup={() => setKonfirmBatal(false)}
          aksi={
            <>
              <button type="button" className="tombol tombol--netral" onClick={() => setKonfirmBatal(false)}>Batal</button>
              <button type="button" className="tombol tombol--bahaya" disabled={sibukAksi} onClick={() => void batalPo()}>
                {sibukAksi ? 'Membatalkan…' : 'Ya, batalkan PO'}
              </button>
            </>
          }
        >
          <p>PO dinyatakan <strong>Dibatalkan</strong> dan disembunyikan dari tampilan aktif. PO yang sudah ada barang datang tidak bisa dibatalkan.</p>
        </Modal>
      )}

      {konfirmHapus && (
        <Modal
          judul={`Hapus PO ${po.no_po}?`}
          onTutup={() => setKonfirmHapus(false)}
          aksi={
            <>
              <button type="button" className="tombol tombol--netral" onClick={() => setKonfirmHapus(false)}>Batal</button>
              <button type="button" className="tombol tombol--bahaya" disabled={sibukAksi} onClick={() => void hapusPo()}>
                Ya, hapus draft
              </button>
            </>
          }
        >
          <p>Draft PO yang dihapus tidak bisa dikembalikan.</p>
        </Modal>
      )}
    </div>
  );
}

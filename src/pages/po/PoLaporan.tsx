import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarPeriode, type NilaiPeriode } from '../../components/BarPeriode';
import { Modal } from '../../components/crud/Modal';
import { beritahu } from '../../components/crud/Toast';
import { AksiFakturPo, FakturPo, PilihKertasPo, aturanKertasPo, bacaKertasPo, ppnAktifDari, simpanKertasPo, sizeDariNama, type FakturPoProps, type UkuranKertasPo } from './FakturPo';
import { fakturPoKePng } from './fakturPng';
import { pakaiKodi, tampilQty } from './pakaiKodi';
import { gambarPo, type PoDokData } from './poDok';
import { ambilOpsi, apiGet, apiPost, apiPut } from '../../lib/api';
import { bagikanGambar, bisaBagikanGambar, bukaWa, dokKePng, unduhBlob } from '../../lib/gambarPo';
import { formatWa62, nomorWaValid } from '../faktur/aksi';
import { formatRupiah, formatTanggal } from '../../lib/format';
import { can, MODUL_PO, pesanIzin } from '../../lib/hak';
import { hitungRentang, labelRentang } from '../../lib/periode';
import { useSegarkanModul } from '../../lib/segarkan';
import { useUsaha } from '../../lib/usaha';
import { useSesi } from '../../lib/sesi';
import { KELAS_STATUS_PO, LABEL_STATUS_PO, FILTER_PO_AKTIF, FILTER_PO_TERMINAL, gabungKodi, type StatusPo } from '../../lib/kodi';
import './po.css';
import './po-hub.css';

type Baris = Record<string, unknown>;

interface Kartu {
  po_aktif: number;
  total_sisa_pcs: number;
  total_lebih_pcs: number;
  total_pembelian: number;
  isi_per_kodi: number;
}

/** Hasil produk dari GET /api/pembelian/produk-cari. */
interface HasilCari {
  product_id: number;
  produk: string;
  sku: string;
  kode_item: string | null;
  harga_beli: number;
  harga_terakhir: number | null;
}

/** Tambah barang/size ke PO draft milik supplier — interaktif dari monitoring. */
function ModalTambahBarang({
  supplier,
  draftPo,
  isi,
  kodiAktif,
  onTutup,
  onSelesai,
}: {
  supplier: string;
  draftPo: { id: number; no_po: string }[];
  isi: number;
  kodiAktif: boolean;
  onTutup: () => void;
  onSelesai: () => void;
}) {
  const [poId, setPoId] = useState(draftPo[0]?.id ?? 0);
  const [teks, setTeks] = useState('');
  const [hasil, setHasil] = useState<HasilCari[]>([]);
  const [pilih, setPilih] = useState<HasilCari | null>(null);
  const [kodi, setKodi] = useState('0');
  const [pcs, setPcs] = useState('1');
  const [harga, setHarga] = useState('0');
  const [sibuk, setSibuk] = useState(false);
  // true = permintaan pencarian produk sedang berjalan (untuk pesan kosong).
  const [mencari, setMencari] = useState(false);
  // Indeks hasil tersorot lewat ↑/↓ — hasil teratas otomatis tersorot (0).
  const [sorot, setSorot] = useState(0);

  useEffect(() => {
    const q = teks.trim();
    if (q.length < 2 || pilih) {
      setHasil([]);
      setMencari(false);
      return;
    }
    setMencari(true);
    const t = window.setTimeout(async () => {
      try {
        const r = await apiGet<{ data: HasilCari[] }>(`/api/pembelian/produk-cari?cari=${encodeURIComponent(q)}`);
        setHasil(r.data ?? []);
        setSorot(0);
      } catch {
        setHasil([]);
      } finally {
        setMencari(false);
      }
    }, 200);
    return () => window.clearTimeout(t);
  }, [teks, pilih]);

  const pilihProduk = (h: HasilCari) => {
    setPilih(h);
    setHarga(String(h.harga_terakhir ?? h.harga_beli ?? 0));
    setHasil([]);
    setTeks(h.produk);
  };
  const batalPilih = () => {
    setPilih(null);
    setTeks('');
    setHasil([]);
  };

  const qty = gabungKodi(Number(kodi) || 0, Number(pcs) || 0, isi);

  const simpan = async () => {
    if (!poId) {
      beritahu('Pilih dulu PO draft tujuannya.', 'galat');
      return;
    }
    if (!pilih) {
      beritahu('Cari lalu pilih barang dulu.', 'galat');
      return;
    }
    if (!(qty > 0)) {
      beritahu('Qty harus lebih dari 0.', 'galat');
      return;
    }
    if (sibuk) return;
    setSibuk(true);
    try {
      const cur = await apiGet<{ data: Baris }>(`/api/po/${poId}`);
      const lama = (((cur.data.items as Baris[]) ?? []) as Baris[]).map((i) => ({
        product_id: Number(i.product_id),
        qty_pesan: Number(i.qty_pesan) || 0,
        harga_beli: Number(i.harga_beli) || 0,
        catatan: (i.catatan as string) ?? null,
      }));
      await apiPut(`/api/po/${poId}`, {
        items: [...lama, { product_id: Number(pilih.product_id), qty_pesan: qty, harga_beli: Number(harga) || 0 }],
      });
      beritahu(`“${pilih.produk}” (${tampilQty(qty, isi, kodiAktif)}) masuk PO.`);
      onSelesai();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibuk(false);
    }
  };

  return (
    <Modal
      judul={`Tambah barang — ${supplier}`}
      onTutup={onTutup}
      aksi={
        <>
          <button type="button" className="tombol tombol--netral" onClick={onTutup}>
            Batal
          </button>
          <button type="button" className="tombol tombol--primer" disabled={sibuk || !pilih || !poId} onClick={() => void simpan()}>
            {sibuk ? 'Menyimpan…' : 'Tambah ke PO'}
          </button>
        </>
      }
    >
      <label className="bidang">
        <span>PO draft tujuan</span>
        <select value={poId} onChange={(e) => setPoId(Number(e.target.value))} aria-label="PO draft tujuan">
          {draftPo.map((d) => (
            <option key={d.id} value={d.id}>{d.no_po}</option>
          ))}
        </select>
      </label>
      <label className="bidang" style={{ marginTop: 8 }}>
        <span>Cari barang / size (min. 2 huruf)</span>
        <input
          value={teks}
          onChange={(e) => { setTeks(e.target.value); if (pilih) setPilih(null); setSorot(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              if (!hasil.length) return;
              e.preventDefault();
              setSorot((i) => Math.min(hasil.length - 1, i + 1));
              return;
            }
            if (e.key === 'ArrowUp') {
              if (!hasil.length) return;
              e.preventDefault();
              setSorot((i) => Math.max(0, i - 1));
              return;
            }
            if (e.key === 'Enter') {
              const pilihan = hasil[Math.min(sorot, hasil.length - 1)];
              if (!pilihan) return;
              e.preventDefault();
              pilihProduk(pilihan);
              return;
            }
            if (e.key === 'Escape') setHasil([]);
          }}
          placeholder="cth. Ab Biru 42 / DG00308…"
          aria-label="Cari barang"
          aria-controls="po-tambah-hasil"
          aria-expanded={hasil.length > 0}
          role="combobox"
          autoComplete="off"
          autoFocus
        />
      </label>
      {hasil.length > 0 && (
        <div className="po-tambah-hasil" id="po-tambah-hasil" style={{ marginTop: 4 }} role="listbox" aria-label="Hasil pencarian barang">
          {hasil.map((h, i) => (
            <button
              key={h.product_id}
              type="button"
              role="option"
              aria-selected={i === sorot}
              className={i === sorot ? 'terpilih' : undefined}
              onMouseEnter={() => setSorot(i)}
              onClick={() => pilihProduk(h)}
            >
              <strong>{h.produk}</strong>{' '}
              <span className="teks-redup teks-kecil">{h.kode_item ?? h.sku} · {formatRupiah(h.harga_terakhir ?? h.harga_beli ?? 0)}</span>
            </button>
          ))}
          <p className="teks-redup teks-kecil" style={{ margin: '2px 4px' }} aria-hidden>
            ↑↓: pilih · Enter: masukkan ke PO
          </p>
        </div>
      )}
      {/* Pesan jelas saat master produk tidak punya kecocokan (mis. produk
          belum terdaftar / semua nonaktif). */}
      {!pilih && teks.trim().length >= 2 && !mencari && hasil.length === 0 && (
        <p className="teks-redup teks-kecil" role="status" style={{ marginTop: 4 }}>
          Tidak ada produk aktif yang cocok dengan “{teks.trim()}”.
        </p>
      )}
      {pilih && (
        <div className="po-tambah-pilih" style={{ marginTop: 8 }}>
          <div>
            <strong>{pilih.produk}</strong>{' '}
            <span className="teks-redup teks-kecil">{pilih.kode_item ?? pilih.sku}</span>{' '}
            <button type="button" className="tombol tombol--kecil tombol--netral" onClick={batalPilih}>
              Ganti
            </button>
          </div>
          <div className="po-filter">
            {kodiAktif && (
              <label className="bidang">
                <span>Kodi (1 kodi = {isi} pcs)</span>
                <input type="number" min="0" value={kodi} onChange={(e) => setKodi(e.target.value)} aria-label="Jumlah kodi" />
              </label>
            )}
            <label className="bidang">
              <span>Pasang / pcs</span>
              <input type="number" min="0" value={pcs} onChange={(e) => setPcs(e.target.value)} aria-label="Jumlah pcs" />
            </label>
            <label className="bidang">
              <span>Harga beli /pcs (Rp)</span>
              <input type="number" min="0" value={harga} onChange={(e) => setHarga(e.target.value)} aria-label="Harga beli" />
            </label>
          </div>
          <p className="teks-redup teks-kecil" style={{ margin: 0 }}>
            Total: <strong>{tampilQty(qty, isi, kodiAktif)}</strong> ({qty.toLocaleString('id-ID')} pcs) · Subtotal {formatRupiah(qty * (Number(harga) || 0))}
          </p>
        </div>
      )}
      <p className="teks-redup teks-kecil" style={{ marginTop: 8 }}>
        Hanya PO berstatus Draft yang bisa ditambah (aturan server). Setelah dikirim, tambah barang lewat penerimaan “Di luar PO”.
      </p>
    </Modal>
  );
}

/** Laporan PO — kartu ringkasan + tabel selisih + export CSV/PDF. */
export function PoLaporan() {
  const sesiInfo = useSesi().info;
  const bisaEkspor = can(sesiInfo, MODUL_PO, 'ekspor');
  const bisaCetak = can(sesiInfo, MODUL_PO, 'cetak');
  const bisaUbah = can(sesiInfo, MODUL_PO, 'ubah');
  const bisaHapus = can(sesiInfo, MODUL_PO, 'hapus');

  const [data, setData] = useState<Baris[]>([]);
  const [kartu, setKartu] = useState<Kartu | null>(null);
  const [sibuk, setSibuk] = useState(true);
  const [periode, setPeriode] = useState<NilaiPeriode>({ periode: '30', dariInput: '', sampaiInput: '' });
  const [filterSupplier, setFilterSupplier] = useState('');
  const [filterStatus, setFilterStatus] = useState(FILTER_PO_AKTIF);
  const [opsiSupplier, setOpsiSupplier] = useState<{ id: number; label: string }[]>([]);
  const [detailRingkas, setDetailRingkas] = useState<Baris | null>(null);
  const [detail, setDetail] = useState<Baris | null>(null);
  const [detailSibuk, setDetailSibuk] = useState(false);
  const { kodiAktif } = pakaiKodi();
  const [kertas, setKertas] = useState<UkuranKertasPo>('A4');
  const [sibukGambar, setSibukGambar] = useState(false);
  const [nomorWa, setNomorWa] = useState('');
  const [statusManual, setStatusManual] = useState('');
  const [konfirmManual, setKonfirmManual] = useState<{ aksi: 'tutup' | 'batal' } | null>(null);
  const [tambahSup, setTambahSup] = useState<string | null>(null);
  const usaha = useUsaha();
  /** Hub: pemasok terpilih → PO aktif → rincian item untuk monitoring & faktur. */
  const [hubSup, setHubSup] = useState('');
  const [hubDetail, setHubDetail] = useState<Baris | null>(null);
  const [hubSibuk, setHubSibuk] = useState(false);
  /** Modal Catat Penerimaan (qty tambahan per item). */
  const [terimaBuka, setTerimaBuka] = useState(false);
  const [terimaRows, setTerimaRows] = useState<Record<number, string>>({});
  const [terimaTgl, setTerimaTgl] = useState(() => new Date().toISOString().slice(0, 10));
  const [terimaSibuk, setTerimaSibuk] = useState(false);
  const { dari: tglDari, sampai: tglSampai } = hitungRentang(periode.periode, periode.dariInput, periode.sampaiInput);

  useEffect(() => {
    ambilOpsi('pemasok').then(setOpsiSupplier).catch(() => setOpsiSupplier([]));
  }, []);

  const muat = useCallback(async () => {
    setSibuk(true);
    try {
      const q = new URLSearchParams();
      if (tglDari) q.set('dari', tglDari);
      if (tglSampai) q.set('sampai', tglSampai);
      if (filterSupplier) q.set('supplier_id', filterSupplier);
      if (filterStatus) q.set('status', filterStatus);
      const r = await apiGet<{ kartu: Kartu; data: Baris[] }>(`/api/po/laporan/ringkasan?${q.toString()}`);
      setData(r.data);
      setKartu(r.kartu);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibuk(false);
    }
  }, [tglDari, tglSampai, filterSupplier, filterStatus]);

  useEffect(() => {
    void muat();
  }, [muat]);
  useSegarkanModul(muat);

  /** Buka rincian item satu PO (modal "Lihat Detail Barang"). */
  const bukaDetail = async (b: Baris) => {
    setDetailRingkas(b);
    setDetail(null);
    setDetailSibuk(true);
    setKonfirmManual(null);
    setStatusManual('');
    try {
      const r = await apiGet<{ data: Baris }>(`/api/po/${b.id}`);
      setDetail(r.data);
      if (r.data.supplier_telepon) setNomorWa(String(r.data.supplier_telepon));
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setDetailSibuk(false);
    }
  };

  const tutupDetail = () => {
    setDetailRingkas(null);
    setDetail(null);
    setKonfirmManual(null);
    setStatusManual('');
  };

  useEffect(() => {
    setKertas(bacaKertasPo());
  }, []);

  /** Data dokumen PO dari rincian modal — untuk PNG/WA (template lengkap). */
  const dokDataModal = (): PoDokData | null => {
    if (!detail) return null;
    const items = ((detail.items as Baris[]) ?? []).map((i) => ({
      produk_nama: String(i.produk_nama ?? ''),
      sku: (i.sku as string) ?? null,
      qty_pesan: Number(i.qty_pesan) || 0,
      total_datang: Number(i.total_datang) || 0,
      sisa: Number(i.sisa) || 0,
      selisih: Number(i.selisih) || 0,
      harga_beli: Number(i.harga_beli) || 0,
      catatan: (i.catatan as string) ?? null,
    }));
    return {
      no_po: String(detail.no_po ?? ''),
      tanggal: String(detail.tanggal ?? ''),
      supplier_nama: String(detail.supplier_nama ?? ''),
      catatan: detail.catatan as string | null,
      toko_nama: 'Toko',
      ppn_aktif: ppnAktifDari(detail),
      items,
    };
  };

  const kirimGambarWaModal = async () => {
    const dok = dokDataModal();
    if (!dok || sibukGambar) return;
    if (!nomorWaValid(nomorWa)) {
      beritahu('Nomor WhatsApp belum valid — isi dulu (contoh: 08123456789).', 'galat');
      return;
    }
    setSibukGambar(true);
    try {
      const g = gambarPo(dok, 'penuh', isi);
      const png = await dokKePng(g.model, g.lebarPx);
      const pesan = `Faktur PO *${dok.no_po}* — ${dok.supplier_nama}. Terima kasih.`;
      if (bisaBagikanGambar()) {
        const hasil = await bagikanGambar(png, g.namaBerkas, dok.no_po, pesan);
        if (hasil === 'dibagikan') {
          beritahu('Gambar terkirim — lanjutkan di WhatsApp.');
          return;
        }
        if (hasil === 'batal') return;
      }
      unduhBlob(png, g.namaBerkas);
      beritahu('Gambar diunduh — lampirkan manual di WhatsApp (wa.me hanya teks).', 'info', 5000);
      bukaWa(nomorWa, pesan);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibukGambar(false);
    }
  };

  /** Ubah status manual dari modal: kirim/kadaluwarsa/buka langsung; tutup & batal via konfirmasi. */
  const segarkanDetail = async () => {
    if (detailRingkas) await bukaDetail(detailRingkas);
    await muat();
  };
  const pilihStatusManual = async (kode: string) => {
    setStatusManual('');
    if (!detail) return;
    const st = String(detail.status);
    if (kode === 'kirim' && st === 'draft') {
      try {
        await apiPost(`/api/po/${detail.id}/kirim`, {});
        beritahu(`PO ${detail.no_po} terkirim.`);
        await segarkanDetail();
      } catch (err) {
        beritahu((err as Error).message, 'galat');
      }
    } else if ((kode === 'tutup' || kode === 'batal') && ['terkirim', 'sebagian', 'lebih'].includes(st)) {
      setKonfirmManual({ aksi: kode });
    } else if (kode === 'kadaluwarsa' && ['terkirim', 'sebagian', 'lebih'].includes(st)) {
      try {
        await apiPost(`/api/po/${detail.id}/status`, { status: 'kadaluwarsa' });
        beritahu(`PO ${detail.no_po} ditandai Kadaluwarsa.`);
        await segarkanDetail();
      } catch (err) {
        beritahu((err as Error).message, 'galat');
      }
    } else if (kode === 'buka' && ['selesai', 'selesai_kurang', 'kadaluwarsa', 'batal'].includes(st)) {
      try {
        await apiPost(`/api/po/${detail.id}/status`, { status: 'terkirim' });
        beritahu(`PO ${detail.no_po} dibuka kembali (Proses).`);
        await segarkanDetail();
      } catch (err) {
        beritahu((err as Error).message, 'galat');
      }
    }
  };
  const eksekusiManual = async () => {
    if (!detail || !konfirmManual) return;
    try {
      if (konfirmManual.aksi === 'tutup') {
        await apiPost(`/api/po/${detail.id}/tutup`, {});
        beritahu('PO ditutup (Selesai).');
      } else {
        await apiPost(`/api/po/${detail.id}/status`, { status: 'batal' });
        beritahu(`PO ${detail.no_po} dibatalkan.`);
      }
      setKonfirmManual(null);
      await segarkanDetail();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    }
  };
  const opsiManualModal = detail
    ? [
      ...(String(detail.status) === 'draft' && bisaUbah ? [{ kode: 'kirim', label: 'Tandai Terkirim' }] : []),
      ...(['terkirim', 'sebagian', 'lebih'].includes(String(detail.status)) && bisaUbah
        ? [{ kode: 'kadaluwarsa', label: 'Tandai Kadaluwarsa' }]
        : []),
      ...(['terkirim', 'sebagian', 'lebih'].includes(String(detail.status)) && bisaHapus
        ? [{ kode: 'tutup', label: 'Tutup PO → Selesai' }, { kode: 'batal', label: 'Batalkan PO' }]
        : []),
      ...(['selesai', 'selesai_kurang', 'kadaluwarsa', 'batal'].includes(String(detail.status)) && bisaUbah
        ? [{ kode: 'buka', label: 'Buka kembali → Proses' }]
        : []),
    ]
    : [];

  /** Hub: daftar pemasok unik dari data laporan. */
  const hubDaftarSup = useMemo(() => {
    const m = new Map<string, { nama: string; jumlahPo: number }>();
    for (const b of data) {
      const nama = String(b.supplier_nama ?? '—');
      const g = m.get(nama) ?? { nama, jumlahPo: 0 };
      g.jumlahPo += 1;
      m.set(nama, g);
    }
    return [...m.values()].sort((a, b) => a.nama.localeCompare(b.nama));
  }, [data]);

  /** Hub: PO aktif pemasok = non-draft terbaru (terkirim/sebagian/lebih diutamakan). */
  const hubPoAktif = useMemo(() => {
    if (!hubSup) return null;
    const milik = data.filter((b) => String(b.supplier_nama ?? '—') === hubSup);
    if (milik.length === 0) return null;
    const jalan = milik.filter((b) => ['terkirim', 'sebagian', 'lebih'].includes(String(b.status)));
    const urut = (r: Baris[]) => [...r].sort((a, b) => String(b.tanggal ?? '').localeCompare(String(a.tanggal ?? '')));
    return urut(jalan.length > 0 ? jalan : milik)[0];
  }, [data, hubSup]);

  const muatHub = useCallback(async (id: number) => {
    setHubSibuk(true);
    try {
      const r = await apiGet<{ data: Baris }>(`/api/po/${id}`);
      setHubDetail(r.data);
      const awal: Record<number, string> = {};
      for (const it of ((r.data.items as Baris[]) ?? [])) awal[Number(it.product_id)] = '';
      setTerimaRows(awal);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
      setHubDetail(null);
    } finally {
      setHubSibuk(false);
    }
  }, []);

  useEffect(() => {
    if (hubPoAktif) void muatHub(Number(hubPoAktif.id));
    else setHubDetail(null);
  }, [hubPoAktif, muatHub]);

  /** Simpan penerimaan nyata (tambah stok + status otomatis via server). */
  const simpanTerima = async () => {
    if (!hubDetail || terimaSibuk) return;
    const items = Object.entries(terimaRows)
      .map(([pid, v]) => ({ product_id: Number(pid), qty_datang: Math.floor(Number(v) || 0) }))
      .filter((i) => i.qty_datang > 0);
    if (items.length === 0) {
      beritahu('Isi minimal satu qty datang (pasang) yang lebih dari 0.', 'galat');
      return;
    }
    setTerimaSibuk(true);
    try {
      const r = await apiPost<{ data: Baris; lebih: { product_id: number; pesan: number; datang: number }[] }>(
        `/api/po/${hubDetail.id}/terima`,
        { items, tanggal: terimaTgl },
      );
      setHubDetail(r.data);
      setTerimaBuka(false);
      if (r.lebih && r.lebih.length > 0) beritahu(`Tersimpan — ${r.lebih.length} barang melebihi target (Over-Delivery).`, 'info', 5000);
      else beritahu('Penerimaan tersimpan — stok bertambah, status PO diperbarui.');
      await muat();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setTerimaSibuk(false);
    }
  };

  const hubItems = ((hubDetail?.items as Baris[]) ?? []) as Baris[];
  const hubPesan = hubItems.reduce((n, i) => n + (Math.floor(Number(i.qty_pesan) || 0)), 0);
  const hubDatang = hubItems.reduce((n, i) => n + (Math.floor(Number(i.total_datang) || 0)), 0);
  const hubSisa = hubPesan - hubDatang;
  // Subtotal = item PO + barang Non-PO (target 0 tetapi tetap bernilai).
  const hubNominal =
    hubItems.reduce((n, i) => n + (Math.floor(Number(i.total_datang) || 0)) * (Number(i.harga_beli) || 0), 0) +
    (((hubDetail?.di_luar_po as Baris[]) ?? [])).reduce(
      (n, i) => n + (Math.floor(Number(i.total_datang) || 0)) * (Number(i.harga_beli) || 0),
      0,
    );
  const hubPpnAktif = ppnAktifDari(hubDetail);
  const hubGrand = hubNominal + (hubPpnAktif ? Math.round(hubNominal * 0.11) : 0);
  const hubPersen = hubPesan > 0 ? Math.round((hubDatang / hubPesan) * 100) : 0;
  const hubStatusBadge =
    hubSisa === 0 ? { label: 'Lengkap (Pass)', kelas: 'hub-pil--lengkap' }
    : hubSisa < 0 ? { label: `Lebih +${Math.abs(hubSisa).toLocaleString('id-ID')} Psg`, kelas: 'hub-pil--lebih' }
    : { label: `Sisa ${hubSisa.toLocaleString('id-ID')} Psg`, kelas: 'hub-pil--kurang' };


  const isi = kartu?.isi_per_kodi || 20;

  /** Monitoring per pemasok — agregat dari data laporan (ikut periode/filter). */
  const perSup = useMemo(() => {
    const m = new Map<
      string,
      {
        nama: string;
        jumlahPo: number;
        pesan: number;
        datang: number;
        sisa: number;
        lebih: number;
        draft: { id: number; no_po: string }[];
      }
    >();
    for (const b of data) {
      const nama = String(b.supplier_nama ?? '—');
      let g = m.get(nama);
      if (!g) {
        g = { nama, jumlahPo: 0, pesan: 0, datang: 0, sisa: 0, lebih: 0, draft: [] };
        m.set(nama, g);
      }
      g.jumlahPo += 1;
      g.pesan += Number(b.pesan_pcs) || 0;
      g.datang += Number(b.datang_pcs) || 0;
      g.sisa += Number(b.sisa_pcs) || 0;
      g.lebih += Math.max(0, Number(b.selisih_pcs) || 0);
      if (String(b.status) === 'draft') g.draft.push({ id: Number(b.id), no_po: String(b.no_po) });
    }
    return [...m.values()].sort((a, b) => b.pesan - a.pesan);
  }, [data]);

  const unduhCsv = () => {
    if (!bisaEkspor) {
      beritahu(pesanIzin(sesiInfo, MODUL_PO, 'ekspor', 'mengekspor laporan'), 'galat');
      return;
    }
    const baris = [
      ['No PO', 'Pemasok', 'Tanggal', kodiAktif ? 'Qty Pesan' : 'Qty Pesan (pcs)', kodiAktif ? 'Qty Datang' : 'Qty Datang (pcs)', 'Sisa (pcs)', 'Selisih (pcs)', 'Status', 'Total Harga'],
      ...data.map((b) => [
        String(b.no_po),
        String(b.supplier_nama ?? ''),
        formatTanggal(String(b.tanggal ?? '')),
        tampilQty(Number(b.pesan_pcs) || 0, isi, kodiAktif),
        tampilQty(Number(b.datang_pcs) || 0, isi, kodiAktif),
        String(b.sisa_pcs),
        String(b.selisih_pcs),
        LABEL_STATUS_PO[String(b.status) as StatusPo] ?? String(b.status),
        String(b.total_harga ?? 0),
      ]),
    ];
    const csv = `﻿${baris.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `laporan-po-${tglDari || 'semua'}_${tglSampai || 'semua'}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    beritahu('Laporan PO diunduh (CSV, bisa dibuka di Excel).');
  };

  const hubFakturItems = hubItems.map((it) => ({
    kode: String(it.kode_item ?? it.sku ?? ''),
    nama: String(it.produk_nama ?? ''),
    qty: Math.floor(Number(it.qty_pesan) || 0),
    harga: Number(it.harga_beli) || 0,
    datang: Math.floor(Number(it.total_datang) || 0),
  }));

  /** Barang datang di luar PO (target 0) untuk tabel faktur. */
  const luarFakturDari = (dok: Baris | null) =>
    (((dok?.di_luar_po as Baris[]) ?? [])).map((it) => ({
      kode: String(it.kode_item ?? it.sku ?? ''),
      nama: String(it.produk_nama ?? ''),
      qty: 0,
      harga: Number(it.harga_beli) || 0,
      datang: Math.floor(Number(it.total_datang) || 0),
      luarPo: true,
    }));

  /** Props faktur resmi PO aktif hub — satu template untuk layar, cetak, & PNG. */
  const propsFakturHub = (): FakturPoProps | null => {
    if (!hubDetail) return null;
    return {
      tokoNama: usaha.nama || 'Toko',
      usahaAlamat: usaha.alamat || null,
      usahaTelepon: usaha.telepon || null,
      usahaEmail: usaha.email || null,
      noPo: String(hubDetail.no_po ?? ''),
      tanggal: String(hubDetail.tanggal ?? ''),
      pemasokNama: String(hubDetail.supplier_nama ?? ''),
      pemasokAlamat: hubDetail.supplier_alamat as string | null,
      pemasokTelepon: hubDetail.supplier_telepon as string | null,
      gudang: hubDetail.gudang_nama as string | null,
      catatan: hubDetail.catatan as string | null,
      items: hubFakturItems,
      luarPoItems: luarFakturDari(hubDetail),
      isiKodi: isi,
      kodiAktif,
      ppnAktif: ppnAktifDari(hubDetail),
      // PO susulan: badge & referensi PO induk ikut di semua template.
      refPoNomor: hubDetail.parent_no_po ? String(hubDetail.parent_no_po) : null,
    };
  };

  /** Unduh PNG langsung dari template faktur resmi (tanpa lewat link web). */
  const unduhPngHub = async () => {
    const props = propsFakturHub();
    if (!props || !hubDetail || sibukGambar) return;
    setSibukGambar(true);
    try {
      const { blob, namaBerkas } = await fakturPoKePng(
        props,
        `${String(hubDetail.no_po ?? 'po')}-hub.png`.replace(/[^0-9A-Za-z-.]+/g, '_'),
      );
      unduhBlob(blob, namaBerkas);
      beritahu('Gambar faktur PO diunduh (PNG).');
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibukGambar(false);
    }
  };

  return (
    <div className="halaman po-modul" style={{ paddingTop: 16 }}>
      {/* ================= HUB EKSEKUTIF (gaya template) ================= */}
      <div className="hub">
        <div className="hub-baris">
          <div className="hub-kartu hub-kartu--pemasok">
            <label className="hub-bidang">
              <span>🏢 Pilih Pemasok / Supplier:</span>
              <select value={hubSup} onChange={(e) => setHubSup(e.target.value)} aria-label="Pilih pemasok hub">
                <option value="">— Pilih pemasok —</option>
                {hubDaftarSup.map((g) => (
                  <option key={g.nama} value={g.nama}>{g.nama} — {g.jumlahPo} PO</option>
                ))}
              </select>
            </label>
            <div className="hub-po-meta">
              <div>
                <small>No. PO Aktif</small>
                <strong>{hubPoAktif ? String(hubPoAktif.no_po) : '—'}</strong>
                {hubDetail && <span className={`hub-pil ${hubStatusBadge.kelas}`} style={{ marginTop: 4 }}>{hubStatusBadge.label}</span>}
              </div>
              <div>
                <small>Tanggal PO</small>
                <strong>{hubPoAktif ? formatTanggal(String(hubPoAktif.tanggal ?? '')) : '—'}</strong>
              </div>
            </div>
          </div>
          <div className="hub-konversi">
            <div>
              <span className="hub-konversi__tag">Konversi Kodi</span>
              {kodiAktif ? (
                <>
                  <span className="hub-konversi__sub">Pasti &amp; Otomatis</span>
                  <p className="hub-konversi__rumus">1 Kodi = {isi} Pasang</p>
                  <p className="hub-konversi__ket">Konversi tersedia sesuai Pengaturan Pembelian &amp; Inbound.</p>
                </>
              ) : <p className="hub-konversi__ket">Konversi kodi disembunyikan di Pengaturan Pembelian &amp; Inbound.</p>}
            </div>
            <span className="hub-konversi__ikon" aria-hidden="true">🧮</span>
          </div>
        </div>

        {hubSibuk ? (
          <div className="hub-kartu" aria-busy="true" aria-label="Memuat hub pemasok">
            <div className="po-skeleton" /><div className="po-skeleton" />
          </div>
        ) : hubDetail ? (
          <>
            <div className="hub-stats">
              <div className="hub-stat">
                <div className="hub-stat__atas">
                  <span className="hub-stat__judul">Total Target PO</span>
                  <span className="hub-stat__ikon hub-stat__ikon--sky" aria-hidden="true">🛒</span>
                </div>
                <div className="hub-stat__angka">
                  <strong>{hubPesan.toLocaleString('id-ID')}</strong>
                  {kodiAktif && <span className="hub-stat__kodi hub-stat__kodi--sky">{(hubPesan / isi).toFixed(1)} Kodi</span>}
                </div>
                <p>Total kuantitas barang di-order</p>
              </div>
              <div className="hub-stat">
                <div className="hub-stat__atas">
                  <span className="hub-stat__judul">Total Diterima</span>
                  <span className="hub-stat__ikon hub-stat__ikon--hijau" aria-hidden="true">🚚</span>
                </div>
                <div className="hub-stat__angka">
                  <strong className="hijau">{hubDatang.toLocaleString('id-ID')}</strong>
                  {kodiAktif && <span className="hub-stat__kodi hub-stat__kodi--hijau">{(hubDatang / isi).toFixed(1)} Kodi</span>}
                </div>
                <p>Realisasi fisik barang masuk</p>
              </div>
              <div className="hub-stat">
                <div className="hub-stat__atas">
                  <span className="hub-stat__judul">Sisa / Selisih PO</span>
                  <span className="hub-stat__ikon hub-stat__ikon--amber" aria-hidden="true">⏳</span>
                </div>
                <div className="hub-stat__angka">
                  <strong className="amber">{hubSisa.toLocaleString('id-ID')}</strong>
                  {kodiAktif && <span className="hub-stat__kodi hub-stat__kodi--amber">{(hubSisa / isi).toFixed(1)} Kodi</span>}
                </div>
                <p>{hubSisa > 0 ? 'Jumlah pasang belum terisi' : hubSisa < 0 ? 'Kelebihan pengiriman' : 'PO sudah lengkap'}</p>
              </div>
              <div className="hub-stat">
                <div className="hub-stat__atas">
                  <span className="hub-stat__judul">Total Nominal Tagihan</span>
                  <span className="hub-stat__ikon hub-stat__ikon--indigo" aria-hidden="true">👛</span>
                </div>
                <span className="hub-stat__nominal">{formatRupiah(hubGrand)}</span>
                <div className="hub-maju">
                  <div className="hub-maju__rel"><span style={{ width: `${Math.min(hubPersen, 100)}%` }} /></div>
                  <small>{hubPersen}%</small>
                </div>
              </div>
            </div>

            <div className="hub-panel">
              <div className="hub-panel__kepala">
                <div>
                  <h3>📋 Monitoring Realisasi Penerimaan PO per Size</h3>
                  <p>Tabel monitoring dinamis dengan aturan selisih kurang/lebih dan konversi otomatis pasang ke kodi.</p>
                </div>
                <div className="hub-legenda">
                  <span>Legenda Status:</span>
                  <span className="hub-pil hub-pil--kurang">Sisa / Kurang</span>
                  <span className="hub-pil hub-pil--lengkap">Lengkap</span>
                  <span className="hub-pil hub-pil--lebih">Over-Delivery (+Lebih)</span>
                </div>
              </div>
              <div className="hub-gulir">
                <table className="hub-tabel">
                  <thead>
                    <tr>
                      <th>No</th>
                      <th>Deskripsi Barang</th>
                      <th style={{ textAlign: 'center' }}>Size</th>
                      <th>Target PO</th>
                      <th>Realisasi Diterima</th>
                      <th>Sisa / Selisih</th>
                      <th style={{ textAlign: 'right' }}>Harga Satuan (Pasang)</th>
                      <th style={{ textAlign: 'center' }}>Status Pemenuhan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hubItems.map((it, idx) => {
                      const pesan = Math.floor(Number(it.qty_pesan) || 0);
                      const datang = Math.floor(Number(it.total_datang) || 0);
                      const sisa = pesan - datang;
                      const pil = sisa > 0
                        ? { label: `Sisa ${sisa.toLocaleString('id-ID')} Psg${kodiAktif ? ` (${(sisa / isi).toFixed(1)} Kodi)` : ''}`, kelas: 'hub-pil--kurang' }
                        : sisa < 0
                          ? { label: `Lebih +${Math.abs(sisa).toLocaleString('id-ID')} Psg${kodiAktif ? ` (+${(Math.abs(sisa) / isi).toFixed(1)} Kodi)` : ''}`, kelas: 'hub-pil--lebih' }
                          : { label: 'Lengkap (Pass)', kelas: 'hub-pil--lengkap' };
                      return (
                        <tr key={String(it.product_id)}>
                          <td style={{ color: '#94a3b8', fontSize: '0.75rem' }}>{idx + 1}</td>
                          <td><strong>{String(it.produk_nama ?? '')}</strong></td>
                          <td style={{ textAlign: 'center', fontWeight: 800 }}>{sizeDariNama(String(it.produk_nama ?? ''))}</td>
                          <td className="hub-td--target">
                            <span className="hub-angka hub-angka--sky">{pesan.toLocaleString('id-ID')}</span>
                            {kodiAktif && <span className="hub-kodi hub-kodi--sky">({(pesan / isi).toFixed(1)} Kodi)</span>}
                          </td>
                          <td className="hub-td--datang">
                            <span className="hub-angka hub-angka--hijau">{datang.toLocaleString('id-ID')}</span>
                            {kodiAktif && <span className="hub-kodi hub-kodi--hijau">({(datang / isi).toFixed(1)} Kodi)</span>}
                          </td>
                          <td className="hub-td--sisa">
                            <span className={`hub-angka ${sisa > 0 ? 'hub-angka--amber' : sisa < 0 ? 'hub-angka--indigo' : 'hub-angka--redup'}`}>
                              {sisa.toLocaleString('id-ID')}
                            </span>
                            {kodiAktif && <span className="hub-kodi">({(sisa / isi).toFixed(1)} Kodi)</span>}
                          </td>
                          <td style={{ textAlign: 'right' }}>{formatRupiah(Number(it.harga_beli) || 0)}</td>
                          <td style={{ textAlign: 'center' }}><span className={`hub-pil ${pil.kelas}`}>{pil.label}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3} style={{ textAlign: 'right', textTransform: 'uppercase', fontSize: '0.7rem', color: '#64748b' }}>Total Ringkasan:</td>
                      <td className="hub-td--target">{hubPesan.toLocaleString('id-ID')} Psg{kodiAktif ? ` (${(hubPesan / isi).toFixed(1)} Kodi)` : ''}</td>
                      <td className="hub-td--datang">{hubDatang.toLocaleString('id-ID')} Psg{kodiAktif ? ` (${(hubDatang / isi).toFixed(1)} Kodi)` : ''}</td>
                      <td className="hub-td--sisa">{hubSisa.toLocaleString('id-ID')} Psg{kodiAktif ? ` (${(hubSisa / isi).toFixed(1)} Kodi)` : ''}</td>
                      <td colSpan={2} style={{ textAlign: 'right' }}>Subtotal: <span style={{ color: '#312e81', fontWeight: 800 }}>{formatRupiah(hubNominal)}</span></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div>
              <div className="hub-a4judul" style={{ marginBottom: 12 }}>
                <div>
                  <h3>🧾 Pratinjau Dokumen Faktur (Ukuran Standar A4)</h3>
                  <p>Tampilan berikut dicetak secara akurat pada kertas A4 saat dikirim ke printer atau PDF.</p>
                </div>
                <AksiFakturPo
                  bisaCetak={bisaCetak}
                  sibuk={sibukGambar}
                  onCetak={() => window.print()}
                  onKirimGambar={() => void unduhPngHub()}
                />
              </div>
              <FakturPo
                tokoNama={usaha.nama || 'Toko'}
                usahaAlamat={usaha.alamat || null}
                usahaTelepon={usaha.telepon || null}
                usahaEmail={usaha.email || null}
                noPo={String(hubDetail.no_po ?? '')}
                tanggal={String(hubDetail.tanggal ?? '')}
                pemasokNama={String(hubDetail.supplier_nama ?? '')}
                pemasokAlamat={hubDetail.supplier_alamat as string | null}
                pemasokTelepon={hubDetail.supplier_telepon as string | null}
                gudang={hubDetail.gudang_nama as string | null}
                catatan={hubDetail.catatan as string | null}
                items={hubFakturItems}
                luarPoItems={luarFakturDari(hubDetail)}
                isiKodi={isi}
                kodiAktif={kodiAktif}
                ppnAktif={hubPpnAktif}
              />
              {hubDetail && <style>{aturanKertasPo(kertas)}</style>}
              <div className="po-cetak" aria-hidden="true">
                <FakturPo
                  tokoNama={usaha.nama || 'Toko'}
                  usahaAlamat={usaha.alamat || null}
                  usahaTelepon={usaha.telepon || null}
                  usahaEmail={usaha.email || null}
                  noPo={String(hubDetail.no_po ?? '')}
                  tanggal={String(hubDetail.tanggal ?? '')}
                  pemasokNama={String(hubDetail.supplier_nama ?? '')}
                  pemasokAlamat={hubDetail.supplier_alamat as string | null}
                  pemasokTelepon={hubDetail.supplier_telepon as string | null}
                  gudang={hubDetail.gudang_nama as string | null}
                  catatan={hubDetail.catatan as string | null}
                  items={hubFakturItems}
                  luarPoItems={luarFakturDari(hubDetail)}
                  isiKodi={isi}
                  kodiAktif={kodiAktif}
                  ppnAktif={hubPpnAktif}
                />
              </div>
            </div>
          </>
        ) : (
          <div className="hub-kartu">
            <p className="teks-redup teks-kecil" style={{ margin: 0 }}>
              {hubSup ? 'Memuat rincian PO aktif…' : 'Pilih pemasok di atas untuk menampilkan monitoring & faktur PO aktifnya.'}
            </p>
          </div>
        )}

        {terimaBuka && hubDetail && (
          <Modal
            judul={`Simulasikan Penerimaan Barang — ${String(hubDetail.no_po)}`}
            onTutup={() => setTerimaBuka(false)}
            aksi={
              <>
                <button type="button" className="tombol tombol--netral" onClick={() => setTerimaBuka(false)}>Batal</button>
                <button type="button" className="hub-btn hub-btn--sky" disabled={terimaSibuk} onClick={() => void simpanTerima()}>
                  {terimaSibuk ? 'Menyimpan…' : 'Simpan & Update Status'}
                </button>
              </>
            }
          >
            <p className="teks-redup teks-kecil" style={{ marginTop: 0 }}>
              Isi qty <strong>tambahan yang datang sekarang</strong> (pasang) per barang — tersimpan nyata ke penerimaan &amp; stok.
            </p>
            <label className="bidang" style={{ marginBottom: 8 }}>
              <span>Tanggal terima</span>
              <input type="date" value={terimaTgl} onChange={(e) => setTerimaTgl(e.target.value)} aria-label="Tanggal terima" />
            </label>
            <div className="hub-modal__daftar">
              {hubItems.map((it) => {
                const pid = Number(it.product_id);
                const pesan = Math.floor(Number(it.qty_pesan) || 0);
                const datang = Math.floor(Number(it.total_datang) || 0);
                return (
                  <div key={pid} className="hub-modal__baris">
                    <div>
                      <strong>{String(it.produk_nama ?? '')}</strong>
                      <small>Target PO: {tampilQty(pesan, isi, kodiAktif)} � Sudah datang: {tampilQty(datang, isi, kodiAktif)}</small>
                    </div>
                    <input
                      type="number" min="0" value={terimaRows[pid] ?? ''}
                      onChange={(e) => setTerimaRows((m) => ({ ...m, [pid]: e.target.value }))}
                      placeholder="0" aria-label={`Qty datang ${String(it.produk_nama ?? '')}`}
                    />
                  </div>
                );
              })}
            </div>
          </Modal>
        )}
      </div>
      {/* ================= AKHIR HUB ================= */}

      <section className="kartu">
        <div className="kartu__kepala">
          <div>
            <h3>Laporan PO</h3>
            <p className="teks-redup teks-kecil">Selisih kurang/lebih, riwayat pembelian, dan kartu ringkasan periode.</p>
          </div>
          <span className="tombol-baris">
            <button
              type="button" className="tombol tombol--kecil tombol--netral"
              disabled={!bisaEkspor} title={bisaEkspor ? 'Unduh CSV (Excel)' : pesanIzin(sesiInfo, MODUL_PO, 'ekspor', 'mengekspor laporan')}
              onClick={unduhCsv}
            >
              Export Excel
            </button>
            <button
              type="button" className="tombol tombol--kecil"
              disabled={!bisaCetak} title={bisaCetak ? 'Cetak / simpan PDF' : pesanIzin(sesiInfo, MODUL_PO, 'cetak', 'mencetak laporan')}
              onClick={() => window.print()}
            >
              Simpan (PDF)
            </button>
          </span>
        </div>

        {kartu && (
          <div className="po-grid" style={{ marginBottom: 12 }}>
            <div className="po-kartu-angka"><small>PO aktif</small><strong>{kartu.po_aktif}</strong><small>terkirim / sebagian / lebih</small></div>
            <div className="po-kartu-angka"><small>Total sisa</small><strong>{tampilQty(kartu.total_sisa_pcs, isi, kodiAktif)}</strong><small>{Number(kartu.total_sisa_pcs).toLocaleString('id-ID')} pcs</small></div>
            <div className="po-kartu-angka"><small>Total kelebihan</small><strong>{tampilQty(kartu.total_lebih_pcs, isi, kodiAktif)}</strong><small>{Number(kartu.total_lebih_pcs).toLocaleString('id-ID')} pcs</small></div>
            <div className="po-kartu-angka"><small>Total pembelian periode</small><strong>{formatRupiah(Number(kartu.total_pembelian) || 0)}</strong>{kodiAktif && <small>1 kodi = {isi} pcs</small>}</div>
          </div>
        )}

        {perSup.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <h4 style={{ margin: '4px 0 0' }}>Monitoring per Pemasok</h4>
            <p className="teks-redup teks-kecil" style={{ margin: '0 0 4px' }}>
              Progress pengiriman tiap supplier — mengikuti periode &amp; filter aktif.{kodiAktif ? ` 1 kodi = ${isi} pcs.` : ''}
            </p>
            <div className="po-sup-grid">
              {perSup.map((g) => {
                const persen = g.pesan > 0
                  ? Math.min(100, Math.round((g.datang / g.pesan) * 100))
                  : g.datang > 0 ? 100 : 0;
                const statusSup = g.lebih > 0
                  ? { label: 'Lebih', kelas: 'lencana--peringatan' }
                  : g.pesan > 0 && g.sisa === 0
                    ? { label: 'Selesai', kelas: 'lencana--aktif' }
                    : { label: 'Proses', kelas: 'lencana--info' };
                const barKelas = g.lebih > 0
                  ? 'po-sup-bar po-sup-bar--lebih'
                  : persen >= 100 ? 'po-sup-bar po-sup-bar--penuh' : 'po-sup-bar';
                return (
                  <div key={g.nama} className="po-sup-kartu">
                    <div className="po-sup-kartu__kepala">
                      <strong title={g.nama}>{g.nama}</strong>
                      <span className={`lencana ${statusSup.kelas}`}>{statusSup.label}</span>
                    </div>
                    <div className={barKelas} role="progressbar" aria-valuenow={persen} aria-valuemin={0} aria-valuemax={100} aria-label={`Progress pengiriman ${g.nama}`}>
                      <span style={{ width: `${persen}%` }} />
                    </div>
                    <div className="po-sup-meta">
                      <span>{persen}% datang</span>
                      <span>{g.jumlahPo} PO</span>
                      <span>Pesan {tampilQty(g.pesan, isi, kodiAktif)}</span>
                      <span>Datang {tampilQty(g.datang, isi, kodiAktif)}</span>
                      {g.sisa > 0 && <span>Sisa {tampilQty(g.sisa, isi, kodiAktif)}</span>}
                      {g.lebih > 0 && <span>Lebih {tampilQty(g.lebih, isi, kodiAktif)}</span>}
                    </div>
                    <div className="po-sup-aksi">
                      <button
                        type="button"
                        className="tombol tombol--kecil"
                        disabled={!bisaUbah || g.draft.length === 0}
                        title={
                          !bisaUbah
                            ? pesanIzin(sesiInfo, MODUL_PO, 'ubah', 'menambah barang PO')
                            : g.draft.length === 0
                              ? 'Supplier ini tak punya PO draft — tambah barang hanya bisa ke PO draft'
                              : `Tambah barang ke PO draft ${g.nama}`
                        }
                        onClick={() => setTambahSup(g.nama)}
                      >
                        ＋ Tambah barang
                      </button>
                      {g.draft.length === 0 && (
                        <Link className="tombol tombol--kecil tombol--netral" to="/po/buat">
                          Buat PO baru
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="po-filter">
          <label className="bidang">
            <span>Pemasok</span>
            <select value={filterSupplier} onChange={(e) => setFilterSupplier(e.target.value)} aria-label="Filter pemasok">
              <option value="">Semua pemasok</option>
              {opsiSupplier.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className="bidang">
            <span>Status</span>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} aria-label="Filter status">
              <option value={FILTER_PO_AKTIF}>Aktif / Proses (bawaan)</option>
              <option value="draft">Draft</option>
              <option value="terkirim,sebagian">Proses</option>
              <option value="lebih">Lebih (Over-delivered)</option>
              <option value={FILTER_PO_TERMINAL}>Selesai (semua terminal)</option>
              <option value="selesai,selesai_kurang">Selesai</option>
              <option value="kadaluwarsa">Kadaluwarsa</option>
              <option value="batal">Dibatalkan</option>
              <option value="">Semua status</option>
            </select>
          </label>
        </div>
        <div className="tombol-baris po-chip-grup" role="group" aria-label="Filter cepat status laporan PO" style={{ marginTop: 8 }}>
          {[
            { kode: FILTER_PO_AKTIF, label: 'Aktif / Proses' },
            { kode: FILTER_PO_TERMINAL, label: 'Selesai' },
            { kode: '', label: 'Semua Status' },
          ].map((c) => (
            <button
              key={c.label}
              type="button"
              className={`tombol tombol--kecil${filterStatus === c.kode ? ' tombol--primer' : ' tombol--netral'}`}
              aria-pressed={filterStatus === c.kode}
              onClick={() => setFilterStatus(c.kode)}
              title={c.kode ? `Tampilkan PO berstatus ${c.label}` : 'Tampilkan semua PO'}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 8 }}>
          <BarPeriode nilai={periode} onUbah={setPeriode} ringkasan={`Menampilkan ${labelRentang(tglDari, tglSampai)} · ${data.length} PO`} />
        </div>

        {sibuk ? (
          <div style={{ display: 'grid', gap: 8, marginTop: 12 }} aria-busy="true" aria-label="Memuat laporan">
            {[0, 1, 2].map((i) => (
              <div key={i} className="po-skeleton" />
            ))}
          </div>
        ) : data.length === 0 ? (
          <div className="po-kosong" style={{ marginTop: 12 }}>
            <div className="po-kosong-ikon" aria-hidden="true">📊</div>
            <strong>Tidak ada data periode ini</strong>
            <p>Ubah periode atau filter — atau buat PO baru dan catat barang datang.</p>
          </div>
        ) : (
          <div className="tabel-bungkus po-tabel-gulir" style={{ marginTop: 12 }}>
            <table className="tabel po-tabel">
              <thead>
                <tr>
                  <th>No. PO</th>
                  <th>Pemasok</th>
                  <th>Tanggal</th>
                  <th className="rata-kanan">{kodiAktif ? 'Qty pesan' : 'Qty pesan (pcs)'}</th>
                  <th className="rata-kanan">{kodiAktif ? 'Qty datang' : 'Qty datang (pcs)'}</th>
                  <th className="rata-kanan">Sisa</th>
                  <th className="rata-kanan">Selisih</th>
                  <th>Status</th>
                  <th className="rata-kanan">Total</th>
                  <th className="rata-tengah">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {data.map((b) => {
                  const st = String(b.status) as StatusPo;
                  const selisih = Number(b.selisih_pcs) || 0;
                  return (
                    <tr key={String(b.id)}>
                      <td data-label="No. PO"><strong>{String(b.no_po)}</strong></td>
                      <td data-label="Pemasok">{String(b.supplier_nama ?? '—')}</td>
                      <td data-label="Tanggal">{formatTanggal(String(b.tanggal ?? ''))}</td>
                      <td data-label="Qty pesan" className="rata-kanan">{tampilQty(Number(b.pesan_pcs) || 0, isi, kodiAktif)}</td>
                      <td data-label="Qty datang" className="rata-kanan">{tampilQty(Number(b.datang_pcs) || 0, isi, kodiAktif)}</td>
                      <td data-label="Sisa" className="rata-kanan">
                        {(Number(b.sisa_pcs) || 0) > 0 ? (
                          <span className="lencana lencana--bahaya">{tampilQty(Number(b.sisa_pcs), isi, kodiAktif)}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td data-label="Selisih" className="rata-kanan">
                        {selisih > 0 ? (
                          <span className="lencana lencana--peringatan">+{tampilQty(selisih, isi, kodiAktif)}</span>
                        ) : selisih < 0 ? (
                          <span className="lencana lencana--bahaya">{tampilQty(-selisih, isi, kodiAktif)}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td data-label="Status">
                        <span className={`lencana ${KELAS_STATUS_PO[st] ?? 'lencana--netral'}`}>{LABEL_STATUS_PO[st] ?? st}</span>
                      </td>
                      <td data-label="Total" className="rata-kanan">{formatRupiah(Number(b.total_harga) || 0)}</td>
                      <td data-label="Aksi" className="rata-tengah">
                        <button
                          type="button"
                          className="tombol tombol--kecil tombol--netral"
                          onClick={() => void bukaDetail(b)}
                          title={`Lihat rincian barang ${String(b.no_po)}`}
                          aria-label={`Lihat detail barang ${String(b.no_po)}`}
                        >
                          👁 Detail
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="po-footer-sticky" style={{ position: 'static', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginTop: 8 }}>
          <span className="teks-redup teks-kecil">TOTAL</span>
          <span><strong>{tampilQty(data.reduce((n, b) => n + (Number(b.pesan_pcs) || 0), 0), isi, kodiAktif)}</strong> dipesan</span>
          <span className="po-total">
            <span>Sisa <strong>{tampilQty(data.reduce((n, b) => n + (Number(b.sisa_pcs) || 0), 0), isi, kodiAktif)}</strong></span>
            <span>Total <strong>{formatRupiah(data.reduce((n, b) => n + (Number(b.total_harga) || 0), 0))}</strong></span>
          </span>
        </div>

        {tambahSup && (() => {
          const g = perSup.find((x) => x.nama === tambahSup);
          if (!g) return null;
          return (
            <ModalTambahBarang
              supplier={g.nama}
              draftPo={g.draft}
              isi={isi}
              kodiAktif={kodiAktif}
              onTutup={() => setTambahSup(null)}
              onSelesai={() => { setTambahSup(null); void muat(); }}
            />
          );
        })()}

        {detailRingkas && (
          <Modal
            judul={`Rincian barang ${String(detailRingkas.no_po)}`}
            lebar="lebar"
            onTutup={tutupDetail}
            aksi={
              // Ekspor & kirim sudah ada di floating action bar kanan atas modal;
              // footer hanya menyisakan status di kiri dan dua tombol di kanan.
              <div className="po-modal-kaki">
                {opsiManualModal.length > 0 ? (
                  <label className="po-sebaris">
                    <span>Ubah status</span>
                    <select value={statusManual} onChange={(e) => void pilihStatusManual(e.target.value)} aria-label="Ubah status manual">
                      <option value="">Pilih…</option>
                      {opsiManualModal.map((o) => (
                        <option key={o.kode} value={o.kode}>{o.label}</option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <span />
                )}
                <div className="po-modal-kaki__kanan">
                  <button type="button" className="tombol tombol--netral" onClick={tutupDetail}>
                    Tutup
                  </button>
                  <Link className="tombol tombol--primer" to={`/po/${String(detailRingkas.id)}`}>
                    Buka Detail PO
                  </Link>
                </div>
              </div>
            }
          >
            {detailSibuk || !detail ? (
              <div style={{ display: 'grid', gap: 8 }} aria-busy="true" aria-label="Memuat rincian barang">
                {[0, 1].map((i) => (
                  <div key={i} className="po-skeleton" />
                ))}
              </div>
            ) : (
              <>
                <div className="tombol-baris" style={{ marginBottom: 8 }}>
                  <PilihKertasPo
                    nilai={kertas}
                    onUbah={(u) => {
                      setKertas(u);
                      simpanKertasPo(u);
                    }}
                  />
                  <label className="po-sebaris">
                    <span>WA supplier</span>
                    <input
                      type="tel" value={nomorWa} onChange={(e) => setNomorWa(e.target.value)}
                      placeholder="08123456789" aria-label="Nomor WhatsApp supplier"
                    />
                  </label>
                  {nomorWa.trim() ? (
                    <span className="teks-redup teks-kecil">→ {formatWa62(nomorWa)}</span>
                  ) : null}
                </div>
                {konfirmManual && (
                  <p className="teks-kecil" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '8px 10px' }}>
                    {konfirmManual.aksi === 'tutup' ? (
                      <>Tutup PO <strong>{String(detail.no_po)}</strong> menjadi Selesai? Selisih/kurang yang tersisa diabaikan.</>
                    ) : (
                      <>Batalkan PO <strong>{String(detail.no_po)}</strong>? PO disembunyikan dari tampilan aktif. PO yang sudah ada barang datang tidak bisa dibatalkan.</>
                    )}{' '}
                    <button type="button" className={`tombol tombol--kecil ${konfirmManual.aksi === 'tutup' ? 'tombol--primer' : 'tombol--bahaya'}`} onClick={() => void eksekusiManual()}>
                      {konfirmManual.aksi === 'tutup' ? 'Ya, tutup' : 'Ya, batalkan'}
                    </button>{' '}
                    <button type="button" className="tombol tombol--kecil tombol--netral" onClick={() => setKonfirmManual(null)}>
                      Batal
                    </button>
                  </p>
                )}
                <AksiFakturPo
                  bisaCetak={bisaCetak && !detailSibuk}
                  sibuk={sibukGambar}
                  onCetak={() => window.print()}
                  onKirimGambar={() => void kirimGambarWaModal()}
                />
                <FakturPo
                  tokoNama={usaha.nama || 'Toko'}
                  usahaAlamat={usaha.alamat || null}
                  usahaTelepon={usaha.telepon || null}
                  usahaEmail={usaha.email || null}
                  noPo={String(detail.no_po ?? detailRingkas.no_po)}
                  tanggal={String(detail.tanggal ?? detailRingkas.tanggal ?? '')}
                  pemasokNama={String(detail.supplier_nama ?? detailRingkas.supplier_nama ?? '')}
                  pemasokAlamat={detail.supplier_alamat as string | null}
                  pemasokTelepon={detail.supplier_telepon as string | null}
                  gudang={detail.gudang_nama as string | null}
                  catatan={detail.catatan as string | null}
                  items={((detail.items as Baris[]) ?? []).map((it) => ({
                    kode: String(it.kode_item ?? it.sku ?? ''),
                    nama: String(it.produk_nama ?? ''),
                    qty: Number(it.qty_pesan) || 0,
                    harga: Number(it.harga_beli) || 0,
                    datang: Number(it.total_datang) || 0,
                  }))}
                  luarPoItems={luarFakturDari(detail)}
                  isiKodi={isi}
                  kodiAktif={kodiAktif}
                  ppnAktif={ppnAktifDari(detail)}
                  ramping={kertas === 'T80'}
                />
              </>
            )}
          </Modal>
        )}

        {/* Aturan @page mengikuti pilihan kertas (A4 portrait bawaan). */}
        {detailRingkas && detail && !detailSibuk && <style>{aturanKertasPo(kertas)}</style>}
        {detailRingkas && detail && !detailSibuk && (
          <div className="po-cetak" aria-hidden="true">
            <FakturPo
              tokoNama={usaha.nama || 'Toko'}
                  usahaAlamat={usaha.alamat || null}
                  usahaTelepon={usaha.telepon || null}
                  usahaEmail={usaha.email || null}
              noPo={String(detail.no_po ?? detailRingkas.no_po)}
              tanggal={String(detail.tanggal ?? detailRingkas.tanggal ?? '')}
              pemasokNama={String(detail.supplier_nama ?? detailRingkas.supplier_nama ?? '')}
              pemasokAlamat={detail.supplier_alamat as string | null}
                  pemasokTelepon={detail.supplier_telepon as string | null}
              gudang={detail.gudang_nama as string | null}
              catatan={detail.catatan as string | null}
              items={((detail.items as Baris[]) ?? []).map((it) => ({
                kode: String(it.kode_item ?? it.sku ?? ''),
                nama: String(it.produk_nama ?? ''),
                qty: Number(it.qty_pesan) || 0,
                harga: Number(it.harga_beli) || 0,
                datang: Number(it.total_datang) || 0,
              }))}
              luarPoItems={luarFakturDari(detail)}
              isiKodi={isi}
              kodiAktif={kodiAktif}
              ppnAktif={ppnAktifDari(detail)}
            />
          </div>
        )}

        {/* Area cetak laporan (disembunyikan saat modal faktur terbuka). */}
        {!detailRingkas && (
        <div className="po-cetak" aria-hidden="true">
          <h2>Laporan Purchase Order</h2>
          <div className="po-cetak-meta">Periode: {tglDari || '—'} s/d {tglSampai || '—'}</div>
          <table>
            <thead>
              <tr>
                <th>No PO</th>
                <th>Pemasok</th>
                <th>Tanggal</th>
                <th>Qty Pesan</th>
                <th>Qty Datang</th>
                <th>Sisa</th>
                <th>Selisih</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((b) => (
                <tr key={String(b.id)}>
                  <td>{String(b.no_po)}</td>
                  <td>{String(b.supplier_nama ?? '')}</td>
                  <td>{formatTanggal(String(b.tanggal ?? ''))}</td>
                  <td>{tampilQty(Number(b.pesan_pcs) || 0, isi, kodiAktif)}</td>
                  <td>{tampilQty(Number(b.datang_pcs) || 0, isi, kodiAktif)}</td>
                  <td>{tampilQty(Number(b.sisa_pcs) || 0, isi, kodiAktif)}</td>
                  <td>{tampilQty(Number(b.selisih_pcs) || 0, isi, kodiAktif)}</td>
                  <td>{LABEL_STATUS_PO[String(b.status) as StatusPo] ?? String(b.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </section>
    </div>
  );
}

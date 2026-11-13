import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '../../components/crud/Modal';
import { beritahu } from '../../components/crud/Toast';
import {
  ambilOpsi,
  apiDelete,
  apiGet,
  apiPost,
  apiPut,
  type ResponsDaftar,
} from '../../lib/api';
import { DialogImporExcel } from './DialogImporExcel';
import { DialogEksporExcel } from './DialogEksporExcel';
import { DialogEksporPdf } from './DialogEksporPdf';
import { kompresGambar } from '../../lib/foto';
import { formatAngka } from '../../lib/format';
import { useSegarkanModul } from '../../lib/segarkan';
import { UnggahFotoMassal } from './UnggahFotoMassal';
import {
  DialogHasilMassal,
  DialogHapusMassal,
  ProgresMassal,
  type AksiMassalItem,
  type HasilMassalState,
} from '../../components/crud/AksiMassal';
import { DataTable } from '../../components/crud/DataTable';
import { MobileList } from '../../components/MobileList';
import { FooterDaftar } from '../../components/crud/FooterDaftar';
import { useBarisOtomatis } from '../../lib/barisOtomatis';
import { usePilihan } from '../../lib/pilihan';
import { IconButton } from '../../components/IconButton';
import { MenuAksi } from '../../components/MenuAksi';
import { TombolScan } from '../../components/ScanKamera';
import { ambilSemuaId, jalankanBertahap, type BarisDilewati } from '../../lib/massal';
import { cetakHtml, code39Svg } from '../../lib/code39';
import { useSearchParams } from 'react-router-dom';
import { DetailProduk, resetCacheDetail } from './DetailProduk';

type SebelumProduk = { id: number; category_id: number | null; brand_id: number | null; satuan_dasar_id: number | null; aktif: number; harga_jual: number };
type RespSetAktif = { berhasil: number; sebelum: { produk?: SebelumProduk[] } };
type RespUbah = { berhasil: number; sebelum: { produk: SebelumProduk[] } };
type RespHapus = { berhasil: number; dilewati: BarisDilewati[]; saran?: string };
type PraUbah = {
  baris: { nama: string; perubahan: { label: string; sebelum: string; sesudah: string }[] }[];
  total: number;
};
type ModeDialogUbah = 'ubah' | 'kategori' | 'merek' | 'profil';

type Opsi = { id: number; label: string };

type KonversiState = { unit_id: number | ''; jumlah: string };

type FormProduk = {
  id: number | null;
  kode_item: string;
  foto_url: string;
  nama: string;
  deskripsi: string;
  category_id: number | '';
  brand_id: number | '';
  satuan_dasar_id: number | '';
  /** Profil size produk (X5.2) — '' = ikut kategori. */
  size_profile_id: number | '';
  aktif: number;
  sku: string;
  barcode: string;
  harga_beli: string;
  harga_jual: string;
  stok_min: string;
  /** Stok awal (produk baru saja) — ditulis ke gudang tujuan saat Simpan. */
  stok_awal: string;
  /** Gudang tujuan alokasi stok awal (produk baru saja). */
  gudang_id: number | '';
  konversi: KonversiState[];
};

export function ProdukPage() {
  const [data, setData] = useState<Record<string, any>[]>([]);
  const [total, setTotal] = useState(0);
  const [hal, setHal] = useState(1);
  const areaRef = useRef<HTMLDivElement>(null);
  const { per, mode: modeBaris, setMode: setModeBaris } = useBarisOtomatis({
    kunci: 'produk',
    areaRef,
    total,
    hal,
    setHal,
  });
  const seqMuat = useRef(0);
  const [cari, setCari] = useState('');
  const [cariTunda, setCariTunda] = useState('');
  const [kategori, setKategori] = useState('');
  const [merek, setMerek] = useState('');
  const [aktif, setAktif] = useState('');
  const [gudang, setGudang] = useState('');
  const [urut, setUrut] = useState('nama');
  const [arah, setArah] = useState<'ASC' | 'DESC'>('ASC');
  const [sibuk, setSibuk] = useState(false);

  // --- Pop up detail (?produk=KODE_ITEM) ------------------------------------
  const [searchParams, setSearchParams] = useSearchParams();
  const kodeDetail = searchParams.get('produk') ?? '';
  const dorongDetail = useRef(false);
  const [sinyalDetail, setSinyalDetail] = useState(0);

  const [opsiKategori, setOpsiKategori] = useState<Opsi[]>([]);
  const [opsiMerek, setOpsiMerek] = useState<Opsi[]>([]);
  const [opsiSatuan, setOpsiSatuan] = useState<Opsi[]>([]);
  const [opsiProfil, setOpsiProfil] = useState<Opsi[]>([]);
  const [opsiGudang, setOpsiGudang] = useState<Opsi[]>([]);
  /** Gudang bawaan (Pengaturan) — default dropdown Gudang Tujuan produk baru. */
  const [gudangBawaan, setGudangBawaan] = useState('');

  const [form, setForm] = useState<FormProduk | null>(null);
  const [kirim, setKirim] = useState(false);
  const [hapusTarget, setHapusTarget] = useState<Record<string, any> | null>(null);
  /** Konfirmasi hapus permanen: per baris / terpilih / seluruh isi Sampah. */
  const [dlgPermanen, setDlgPermanen] = useState<{ ids: number[]; info: string; semua: boolean } | null>(null);
  // Dialog Impor/Ekspor Excel & Ekspor PDF (wizard empat langkah + panel pengaturan).
  const [dialogImpor, setDialogImpor] = useState(false);
  const [dialogEksporExcel, setDialogEksporExcel] = useState(false);
  const [dialogEksporPdf, setDialogEksporPdf] = useState(false);
  const [massalBuka, setMassalBuka] = useState(false);
  const [fotoSibuk, setFotoSibuk] = useState(false);
  const [layarKecil, setLayarKecil] = useState(() => window.matchMedia('(max-width: 767px)').matches);

  const [filterBuka, setFilterBuka] = useState(false);
  const [overflowBuka, setOverflowBuka] = useState(false);
  const [modePilih, setModePilih] = useState(false);

  // --- Pilih & aksi massal -------------------------------------------------
  const [modeSampah, setModeSampah] = useState(false);
  const [sampahTotal, setSampahTotal] = useState(0);
  const pilihan = usePilihan([cariTunda, kategori, merek, aktif, gudang, modeSampah]);
  const [sedangMassal, setSedangMassal] = useState(false);
  const [progresMassal, setProgresMassal] = useState<number | null>(null);
  const [hasilMassal, setHasilMassal] = useState<HasilMassalState | null>(null);
  const [dialogUbah, setDialogUbah] = useState<ModeDialogUbah | null>(null);
  const [praUbah, setPraUbah] = useState<PraUbah | null>(null);
  const [formMassal, setFormMassal] = useState({
    category_id: '',
    brand_id: '',
    satuan_dasar_id: '',
    size_profile_id: '',
    aktif: '',
    hargaCara: '',
    hargaNilai: '',
  });
  const [bukaHapusMassal, setBukaHapusMassal] = useState(false);
  const [namaHapus, setNamaHapus] = useState<string[] | null>(null);
  const [memuatNamaHapus, setMemuatNamaHapus] = useState(false);
  const [dataCetak, setDataCetak] = useState<Record<string, any>[] | null>(null);
  const [memuatCetak, setMemuatCetak] = useState(false);
  const [fotoTarget, setFotoTarget] = useState<number[] | null>(null);

  // Tampilan kartu per produk pada layar <768px (tabel diganti kartu).
  useEffect(() => {
    const onUbah = () => setLayarKecil(window.matchMedia('(max-width: 767px)').matches);
    const mq = window.matchMedia('(max-width: 767px)');
    mq.addEventListener('change', onUbah);
    window.addEventListener('resize', onUbah);
    return () => {
      mq.removeEventListener('change', onUbah);
      window.removeEventListener('resize', onUbah);
    };
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setCariTunda(cari);
      setHal(1);
    }, 350);
    return () => window.clearTimeout(t);
  }, [cari]);

  const muatOpsi = useCallback(() => {
    ambilOpsi('kategori').then(setOpsiKategori).catch((e: Error) => beritahu(e.message, 'galat'));
    ambilOpsi('merek').then(setOpsiMerek).catch((e: Error) => beritahu(e.message, 'galat'));
    ambilOpsi('satuan').then(setOpsiSatuan).catch((e: Error) => beritahu(e.message, 'galat'));
    ambilOpsi('gudang').then(setOpsiGudang).catch((e: Error) => beritahu(e.message, 'galat'));
    apiGet<{ data: Opsi[] }>('/api/profil-size/opsi')
      .then((r) => setOpsiProfil(r.data))
      .catch((e: Error) => beritahu(e.message, 'galat'));
  }, []);

  useEffect(() => {
    muatOpsi();
    void apiGet<{ pengaturan: Record<string, string> }>('/api/meta')
      .then((m) => setGudangBawaan(m.pengaturan['gudang_bawaan'] ?? ''))
      .catch(() => undefined);
  }, [muatOpsi]);

  // Default Gudang Tujuan produk baru: gudang bawaan bila ada di daftar,
  // selain itu gudang aktif pertama ("Gudang Utama").
  useEffect(() => {
    if (!form || form.id || form.gudang_id !== '' || opsiGudang.length === 0) return;
    const cocok = opsiGudang.some((o) => String(o.id) === gudangBawaan);
    setForm({ ...form, gudang_id: cocok ? Number(gudangBawaan) : opsiGudang[0].id });
  }, [form, opsiGudang, gudangBawaan]);

  const muat = useCallback(async () => {
    const seq = ++seqMuat.current;
    setSibuk(true);
    try {
      const q = new URLSearchParams({ hal: String(hal), per: String(per), cari: cariTunda, urut, arah });
      if (kategori) q.set('kategori', kategori);
      if (merek) q.set('merek', merek);
      if (aktif !== '') q.set('aktif', aktif);
      if (gudang) q.set('gudang', gudang);
      if (modeSampah) q.set('sampah', '1');
      const r = await apiGet<ResponsDaftar<Record<string, any>> & { sampah_total?: number }>(`/api/master/produk?${q.toString()}`);
      if (seq !== seqMuat.current) return; // respons usang (per/hal berubah)
      setData(r.data);
      setTotal(r.total);
      setSampahTotal(Number(r.sampah_total ?? 0));
      setSinyalDetail((s) => s + 1); // pop up terbuka → muat ulang setelah mutasi
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      if (seq === seqMuat.current) setSibuk(false);
    }
  }, [hal, per, cariTunda, urut, arah, kategori, merek, aktif, gudang, modeSampah]);

  useEffect(() => {
    void muat();
  }, [muat]);
  // Tombol Refresh global di topbar: muat ulang daftar produk.
  useSegarkanModul(muat);

  const totalHal = Math.max(1, Math.ceil(total / per));

  // --- Aksi massal ---------------------------------------------------------
  const idsHalaman = data.map((b) => Number(b.id));

  const buatQ = (hal_: number, per_: number) => {
    const q = new URLSearchParams({ hal: String(hal_), per: String(per_), cari: cariTunda, urut, arah });
    if (kategori) q.set('kategori', kategori);
    if (merek) q.set('merek', merek);
    if (aktif !== '') q.set('aktif', aktif);
    if (gudang) q.set('gudang', gudang);
    if (modeSampah) q.set('sampah', '1');
    return q;
  };

  /** Ambil seluruh id sesuai filter (semua halaman) untuk "Pilih semua sesuai filter". */
  const muatSemuaId = () => ambilSemuaId(buatQ, (q) => apiGet<ResponsDaftar<Record<string, any>>>(`/api/master/produk?${q.toString()}`));
  const pilihSemuaFilter = () =>
    muatSemuaId()
      .then((ids) => pilihan.pilihFilter(ids))
      .catch((e: Error) => beritahu(e.message, 'galat'));

  const toggleSampah = () => {
    setModeSampah((s) => !s);
    setHal(1);
  };

  // --- Pop up detail --------------------------------------------------------
  const bukaDetail = (b: Record<string, any>) => {
    dorongDetail.current = true;
    setSearchParams({ produk: String(b.kode_item ?? b.id) });
  };
  /** Ganti produk dari dalam pop up (Sebelumnya/Berikutnya) — replace agar Back tetap menutup. */
  const gantiDetail = (kunci: string) => setSearchParams({ produk: kunci }, { replace: true });
  const tutupDetail = () => {
    if (dorongDetail.current) {
      dorongDetail.current = false;
      window.history.back(); // tombol Back = tutup pop up (URL sinkron)
    } else {
      setSearchParams({}, { replace: true });
    }
  };
  /** Cetak label satu produk dari pop up — memakai dialog cetak yang sama. */
  const cetakSatu = async (id: number) => {
    try {
      const r = await apiGet<{ data: Record<string, any> }>(`/api/master/produk/${id}`);
      setDataCetak([r.data]);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    }
  };

  /** Nonaktifkan / Aktifkan massal — batch 100 + urungkan 10 detik. */
  const setAktifMassal = async (nilai: 0 | 1) => {
    const ids = [...pilihan.terpilih];
    if (!ids.length) return;
    setSedangMassal(true);
    setProgresMassal(0);
    try {
      const hasil = await jalankanBertahap(
        ids,
        (potongan) => apiPost<RespSetAktif>('/api/master/produk/massal/set-aktif', { ids: potongan, aktif: nilai }),
        (s, t) => setProgresMassal(Math.round((s / t) * 100)),
      );
      const sebelum = hasil.flatMap((h) => h.sebelum?.produk ?? []);
      const berhasil = hasil.reduce((a, h) => a + h.berhasil, 0);
      setHasilMassal({
        judul: nilai === 1 ? 'Aktifkan Produk' : 'Nonaktifkan Produk',
        berhasil,
        dilewati: [],
        onUrungkan: sebelum.length
          ? async () => {
              await apiPost('/api/master/produk/massal/urungkan', { produk: sebelum });
              beritahu('Perubahan status diurungkan.');
              setHasilMassal(null);
              resetCacheDetail();
              await muat();
            }
          : undefined,
      });
      pilihan.bersihkan();
      resetCacheDetail();
      await muat();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSedangMassal(false);
      setProgresMassal(null);
    }
  };

  const bukaDialogUbah = (mode: ModeDialogUbah) => {
    setFormMassal({ category_id: '', brand_id: '', satuan_dasar_id: '', size_profile_id: '', aktif: '', hargaCara: '', hargaNilai: '' });
    setPraUbah(null);
    setDialogUbah(mode);
  };

  const ubahFormMassal = (patch: Partial<typeof formMassal>) => {
    setFormMassal((f) => ({ ...f, ...patch }));
    setPraUbah(null); // pratinjau kedaluwarsa saat form berubah
  };

  const patchDariForm = (): Record<string, unknown> | null => {
    const patch: Record<string, unknown> = {};
    if (dialogUbah === 'kategori') {
      if (formMassal.category_id) patch.category_id = Number(formMassal.category_id);
    } else if (dialogUbah === 'merek') {
      if (formMassal.brand_id) patch.brand_id = Number(formMassal.brand_id);
    } else if (dialogUbah === 'profil') {
      // AF2 — "Ikut kategori" = override dilepas (null).
      patch.size_profile_id = formMassal.size_profile_id === '' ? null : Number(formMassal.size_profile_id);
    } else {
      if (formMassal.category_id) patch.category_id = Number(formMassal.category_id);
      if (formMassal.brand_id) patch.brand_id = Number(formMassal.brand_id);
      if (formMassal.satuan_dasar_id) patch.satuan_dasar_id = Number(formMassal.satuan_dasar_id);
      if (formMassal.aktif !== '') patch.aktif = Number(formMassal.aktif);
      if (formMassal.hargaCara && formMassal.hargaNilai !== '') {
        patch.harga = { cara: formMassal.hargaCara, nilai: Number(formMassal.hargaNilai) };
      }
    }
    return Object.keys(patch).length ? patch : null;
  };

  const pratinjauMassal = async () => {
    const patch = patchDariForm();
    if (!patch) return beritahu('Pilih minimal satu perubahan.', 'galat');
    setSedangMassal(true);
    try {
      setPraUbah(await apiPost<PraUbah>('/api/master/produk/massal/ubah/pratinjau', { ids: [...pilihan.terpilih], patch }));
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSedangMassal(false);
    }
  };

  const terapkanMassal = async () => {
    const patch = patchDariForm();
    if (!patch) return;
    const ids = [...pilihan.terpilih];
    setSedangMassal(true);
    setProgresMassal(0);
    try {
      const hasil = await jalankanBertahap(
        ids,
        (potongan) => apiPost<RespUbah>('/api/master/produk/massal/ubah', { ids: potongan, patch }),
        (s, t) => setProgresMassal(Math.round((s / t) * 100)),
      );
      const sebelumProduk = hasil.flatMap((h) => h.sebelum.produk);
      const berhasil = hasil.reduce((a, h) => a + h.berhasil, 0);
      setDialogUbah(null);
      setPraUbah(null);
      setHasilMassal({
        judul: 'Ubah Massal Selesai',
        berhasil,
        dilewati: [],
        onUrungkan:
          sebelumProduk.length
            ? async () => {
                await apiPost('/api/master/produk/massal/urungkan', { produk: sebelumProduk });
                beritahu('Perubahan massal diurungkan.');
                setHasilMassal(null);
                resetCacheDetail();
                await muat();
              }
            : undefined,
      });
      pilihan.bersihkan();
      resetCacheDetail();
      await muat();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSedangMassal(false);
      setProgresMassal(null);
    }
  };

  /** Buka dialog hapus massal — ambil 5 nama pertama untuk konfirmasi. */
  const bukaHapus = async () => {
    setBukaHapusMassal(true);
    setMemuatNamaHapus(true);
    setNamaHapus(null);
    try {
      const ids = [...pilihan.terpilih].slice(0, 5);
      const daftar = await Promise.all(
        ids.map((id) =>
          apiGet<{ data: Record<string, any> }>(`/api/master/produk/${id}`)
            .then((r) => String(r.data.nama))
            .catch(() => '(data tidak ditemukan)'),
        ),
      );
      setNamaHapus(daftar);
    } finally {
      setMemuatNamaHapus(false);
    }
  };

  const konfirmasiHapusMassal = async () => {
    const ids = [...pilihan.terpilih];
    setSedangMassal(true);
    setProgresMassal(0);
    try {
      const hasil = await jalankanBertahap(
        ids,
        (potongan) => apiPost<RespHapus>('/api/master/produk/massal/hapus', { ids: potongan }),
        (s, t) => setProgresMassal(Math.round((s / t) * 100)),
      );
      const berhasil = hasil.reduce((a, h) => a + h.berhasil, 0);
      const dilewati = hasil.flatMap((h) => h.dilewati ?? []);
      const saran = hasil.find((h) => h.saran)?.saran;
      setBukaHapusMassal(false);
      setNamaHapus(null);
      setHasilMassal({ judul: 'Hasil Hapus Massal', berhasil, dilewati, saran });
      pilihan.bersihkan();
      resetCacheDetail();
      await muat();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSedangMassal(false);
      setProgresMassal(null);
    }
  };

  /** Pulihkan dari Sampah (massal atau per baris). */
  const pulihkan = async (ids: number[]) => {
    if (!ids.length) return;
    setSedangMassal(true);
    setProgresMassal(0);
    try {
      const hasil = await jalankanBertahap(
        ids,
        (potongan) => apiPost<{ berhasil: number }>('/api/master/produk/massal/pulihkan', { ids: potongan }),
        (s, t) => setProgresMassal(Math.round((s / t) * 100)),
      );
      const n = hasil.reduce((a, h) => a + h.berhasil, 0);
      beritahu(`${n} produk dipulihkan dari Sampah.`);
      pilihan.bersihkan();
      resetCacheDetail();
      await muat();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSedangMassal(false);
      setProgresMassal(null);
    }
  };

  const eksporTerpilih = () => {
    if (!pilihan.jumlah) return beritahu('Belum ada produk yang dipilih.', 'galat');
    setDialogEksporExcel(true);
  };

  /** Ambil detail produk terpilih untuk pratinjau cetak label/barcode. */
  const siapkanCetak = async () => {
    setMemuatCetak(true);
    try {
      const ids = [...pilihan.terpilih].slice(0, 200);
      const daftar = await Promise.all(
        ids.map((id) => apiGet<{ data: Record<string, any> }>(`/api/master/produk/${id}`).then((r) => r.data)),
      );
      setDataCetak(daftar);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setMemuatCetak(false);
    }
  };

  const escHtml = (s: unknown) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const labelHtml = (p: Record<string, any>): string => {
    const teks = String(p.barcode || p.sku || p.kode_item || '');
    return (
      `<div class="label-produk">` +
      `<h5>${escHtml(p.nama)}</h5>` +
      `<div class="kode-label">${escHtml(p.kode_item ?? '')} · ${escHtml(p.sku ?? '')}</div>` +
      `<div>${escHtml(p.kategori_nama ?? '—')}</div>` +
      `<div class="harga-label">Rp${formatAngka(Number(p.harga_jual ?? 0))}</div>` +
      code39Svg(teks, 40, 2) +
      `<div class="teks-barcode">${escHtml(teks)}</div>` +
      `</div>`
    );
  };

  const labelGrid = dataCetak ? dataCetak.map((p) => labelHtml(p)).join('') : '';

  const gayaCetak =
    '@page{margin:8mm}' +
    '.grid-label{display:flex;flex-wrap:wrap;gap:4mm}' +
    '.label-produk{width:60mm;height:38mm;border:1px dashed #999;border-radius:2mm;padding:2mm 3mm;display:flex;flex-direction:column;justify-content:space-between;page-break-inside:avoid;font-family:Arial,sans-serif;font-size:9pt}' +
    '.label-produk h5{margin:0;font-size:10pt}' +
    '.kode-label{font-family:"Courier New",monospace;font-size:8pt;color:#333}' +
    '.harga-label{font-weight:bold;font-size:11pt}' +
    '.label-produk svg{width:100%;height:9mm}' +
    '.teks-barcode{text-align:center;font-family:"Courier New",monospace;font-size:7pt;letter-spacing:1.5px}';

  /** Hapus permanen dari Sampah — dijalankan hanya setelah konfirmasi dialog. */
  const konfirmasiPermanen = async () => {
    if (!dlgPermanen) return;
    setSedangMassal(true);
    try {
      const r = await apiPost<{ berhasil: number; dilewati: { id: number; nama: string; alasan: string }[] }>(
        '/api/master/produk/massal/permanen',
        dlgPermanen.semua ? {} : { ids: dlgPermanen.ids },
      );
      beritahu(`${r.berhasil} produk dihapus permanen.${r.dilewati.length ? ` ${r.dilewati.length} dilewati (${r.dilewati[0].nama}: ${r.dilewati[0].alasan}).` : ''}`);
      pilihan.bersihkan();
      resetCacheDetail();
      setDlgPermanen(null);
      await muat();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSedangMassal(false);
    }
  };

  const aksiBar: AksiMassalItem[] = modeSampah
    ? [
        { kode: 'pulihkan', label: 'Pulihkan', ikon: 'rotate-ccw', primer: true, jalan: () => void pulihkan([...pilihan.terpilih]) },
        {
          kode: 'permanen',
          label: 'Hapus Permanen',
          ikon: 'trash',
          bahaya: true,
          jalan: () => {
            if (!pilihan.jumlah) return beritahu('Belum ada produk yang dipilih.', 'galat');
            setDlgPermanen({ ids: [...pilihan.terpilih], info: `${pilihan.jumlah} produk terpilih`, semua: false });
          },
        },
      ]
    : [
        { kode: 'nonaktif', label: 'Nonaktifkan', ikon: 'power', jalan: () => void setAktifMassal(0) },
        { kode: 'aktif', label: 'Aktifkan', ikon: 'circle-check', jalan: () => void setAktifMassal(1) },
        { kode: 'ubah', label: 'Ubah Massal', ikon: 'pencil', jalan: () => bukaDialogUbah('ubah') },
        { kode: 'kat', label: 'Pindah Kategori', ikon: 'folder-input', jalan: () => bukaDialogUbah('kategori') },
        { kode: 'profil', label: 'Atur Profil Size', ikon: 'sliders', jalan: () => bukaDialogUbah('profil') },
        { kode: 'merek', label: 'Pindah Merek', ikon: 'tag', jalan: () => bukaDialogUbah('merek') },
        { kode: 'ekspor', label: 'Ekspor Excel', ikon: 'download', jalan: () => eksporTerpilih() },
        { kode: 'ekspor-pdf', label: 'Ekspor PDF', ikon: 'file-down', jalan: () => setDialogEksporPdf(true) },
        { kode: 'cetak', label: memuatCetak ? 'Menyiapkan label…' : 'Cetak Label', ikon: 'printer', jalan: () => void siapkanCetak() },
        {
          kode: 'foto',
          label: 'Unggah Foto',
          ikon: 'image-up',
          jalan: () => {
            setFotoTarget([...pilihan.terpilih]);
            setMassalBuka(true);
          },
        },
        { kode: 'hapus', label: 'Hapus', ikon: 'trash', bahaya: true, jalan: () => void bukaHapus() },
      ];

  const buatBaru = () => {
    muatOpsi(); // segarkan daftar kategori/merek/satuan (bisa saja baru dibuat di tab lain)
    setForm({
      id: null,
      kode_item: '',
      foto_url: '',
      nama: '',
      deskripsi: '',
      category_id: '',
      brand_id: '',
      satuan_dasar_id: '',
      size_profile_id: '',
      aktif: 1,
      sku: '',
      barcode: '',
      harga_beli: '',
      harga_jual: '',
      stok_min: '0',
      stok_awal: '',
      gudang_id: '',
      konversi: [],
    });
  };

  const ubahProduk = async (baris: Record<string, any>) => {
    muatOpsi();
    try {
      const r = await apiGet<{ data: Record<string, any> }>(`/api/master/produk/${baris.id}`);
      const p = r.data;
      setForm({
        id: Number(p.id),
        kode_item: String(p.kode_item ?? ''),
        foto_url: String(p.foto_url ?? ''),
        nama: String(p.nama ?? ''),
        deskripsi: String(p.deskripsi ?? ''),
        category_id: p.category_id ?? '',
        brand_id: p.brand_id ?? '',
        satuan_dasar_id: p.satuan_dasar_id ?? '',
        size_profile_id: p.size_profile_id ?? '',
        aktif: Number(p.aktif ?? 1),
        sku: String(p.sku ?? ''),
        barcode: String(p.barcode ?? ''),
        harga_beli: String(p.harga_beli ?? 0),
        harga_jual: String(p.harga_jual ?? 0),
        stok_min: String(p.stok_min ?? 0),
        // Ubah produk: stok diatur lewat Penyesuaian/Opname — kolom alokasi disembunyikan.
        stok_awal: '',
        gudang_id: '',
        konversi: (p.konversi ?? []).map((k: Record<string, any>) => ({
          unit_id: Number(k.unit_id),
          jumlah: String(k.jumlah_per_satuan_dasar),
        })),
      });
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    }
  };

  const ubahKonversi = (ki: number, patch: Partial<KonversiState>) => {
    setForm((f) => (f ? { ...f, konversi: f.konversi.map((x, i) => (i === ki ? { ...x, ...patch } : x)) } : f));
  };
  const tambahKonversi = () => setForm((f) => (f ? { ...f, konversi: [...f.konversi, { unit_id: '', jumlah: '' }] } : f));
  const hapusKonversi = (ki: number) => setForm((f) => (f ? { ...f, konversi: f.konversi.filter((_, i) => i !== ki) } : f));

  const simpan = async () => {
    if (!form) return;
    if (!form.nama.trim()) return beritahu('Nama produk wajib diisi.', 'galat');
    if (!form.sku.trim()) return beritahu('SKU wajib diisi.', 'galat');
    if (Number(form.harga_beli) < 0 || Number(form.harga_jual) < 0) {
      return beritahu('Harga tidak boleh negatif.', 'galat');
    }
    // Stok awal produk baru wajib punya gudang tujuan (Gudang Utama bila tak diubah).
    if (!form.id && Number(form.stok_awal || 0) > 0 && form.gudang_id === '') {
      return beritahu('Pilih gudang tujuan untuk stok awal.', 'galat');
    }

    setKirim(true);
    try {
      const body = {
        kode_item: form.kode_item.trim(),
        nama: form.nama.trim(),
        sku: form.sku.trim(),
        barcode: form.barcode.trim() || null,
        deskripsi: form.deskripsi.trim() || null,
        category_id: form.category_id === '' ? null : Number(form.category_id),
        brand_id: form.brand_id === '' ? null : Number(form.brand_id),
        satuan_dasar_id: form.satuan_dasar_id === '' ? null : Number(form.satuan_dasar_id),
        size_profile_id: form.size_profile_id === '' ? null : Number(form.size_profile_id),
        harga_beli: Number(form.harga_beli || 0),
        harga_jual: Number(form.harga_jual || 0),
        stok_min: Number(form.stok_min || 0),
        // Hanya produk baru: alokasi stok awal ke gudang tujuan (ubah → diabaikan server).
        ...(!form.id
          ? { gudang_id: form.gudang_id === '' ? null : form.gudang_id, stok_awal: Number(form.stok_awal || 0) }
          : {}),
        aktif: form.aktif,
        konversi: form.konversi
          .filter((k) => k.unit_id !== '' && Number(k.jumlah) > 0)
          .map((k) => ({ unit_id: Number(k.unit_id), jumlah_per_satuan_dasar: Number(k.jumlah) })),
      };
      if (form.id) await apiPut(`/api/master/produk/${form.id}`, body);
      else await apiPost('/api/master/produk', body);
      beritahu(form.id ? 'Produk diperbarui.' : 'Produk ditambahkan.');
      if (form.id) resetCacheDetail(form.id);
      setForm(null);
      await muat();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setKirim(false);
    }
  };

  const nonaktifkan = async (baris: Record<string, any>) => {
    try {
      const r = await apiGet<{ data: Record<string, any> }>(`/api/master/produk/${baris.id}`);
      const p = r.data;
      await apiPut(`/api/master/produk/${p.id}`, { ...p, aktif: Number(p.aktif) === 1 ? 0 : 1 });
      beritahu(Number(baris.aktif) === 1 ? 'Produk dinonaktifkan.' : 'Produk diaktifkan.');
      resetCacheDetail(Number(baris.id));
      await muat();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    }
  };

  const konfirmasiHapus = async () => {
    if (!hapusTarget) return;
    try {
      await apiDelete(`/api/master/produk/${hapusTarget.id}`);
      beritahu('Produk berhasil dihapus secara permanen.', 'sukses');
      resetCacheDetail(Number(hapusTarget.id));
      if (kodeDetail && String(hapusTarget.kode_item ?? hapusTarget.id) === kodeDetail) tutupDetail();
      setHapusTarget(null);
      await muat();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
      setHapusTarget(null);
    }
  };

  const ekspor = () => setDialogEksporExcel(true);

  // Foto produk pada form (produk harus sudah tersimpan) — kompres lalu unggah.
  const gantiFotoForm = async (file: File | undefined) => {
    if (!file || !form?.id) return;
    setFotoSibuk(true);
    try {
      const dataUrl = await kompresGambar(file);
      const r = await apiPost<{ url: string }>('/api/master/produk/foto', {
        target: 'produk',
        id: form.id,
        data_base64: dataUrl,
        nama_file: file.name,
      });
      setForm((f) => (f ? { ...f, foto_url: r.url } : f));
      beritahu('Foto produk diperbarui.');
      if (form?.id) resetCacheDetail(form.id);
      await muat();
      window.dispatchEvent(new CustomEvent('produk-berubah'));
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setFotoSibuk(false);
    }
  };

  const hapusFotoForm = async () => {
    if (!form?.id) return;
    setFotoSibuk(true);
    try {
      await apiPost('/api/master/produk/foto/hapus', { target: 'produk', id: form.id });
      setForm((f) => (f ? { ...f, foto_url: '' } : f));
      beritahu('Foto produk dihapus.');
      if (form?.id) resetCacheDetail(form.id);
      await muat();
      window.dispatchEvent(new CustomEvent('produk-berubah'));
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setFotoSibuk(false);
    }
  };

  const opsiSatuanTanpaDasar = (satuanDasar: number | '') => opsiSatuan.filter((o) => o.id !== Number(satuanDasar));

  return (
    <div className="halaman halaman--fit">
      <section className="kartu kartu--daftar">
        <div className="kartu__kepala kartu__kepala--kompak">
          <div>
            <h3>Produk</h3>
            <p className="teks-redup teks-kecil kartu__deskripsi">Satu baris = satu produk; produk adalah unit stok, harga, dan barcode.</p>
          </div>
          <span className="kartu__jumlah">{total} produk{!modeSampah && sampahTotal > 0 ? ` · ${sampahTotal} di sampah` : ''}</span>
          <div className="tombol-baris">
            {modeSampah ? (
              <>
                <IconButton
                  label="Kembali dari Sampah"
                  ikon="chevron-left"
                  ukuran="toolbar"
                  arah="bawah"
                  onClick={toggleSampah}
                />
                <IconButton
                  label="Kosongkan Sampah"
                  ikon="trash"
                  ukuran="toolbar"
                  arah="bawah"
                  warna="bahaya"
                  disabled={sampahTotal === 0}
                  onClick={() => setDlgPermanen({ ids: [], info: `seluruh isi Sampah (${sampahTotal} produk)`, semua: true })}
                />
              </>
            ) : (
              <>
                {/* Opsi A — 2 tombol: Tambah (primer) + Aksi (menu turun). */}
                <MenuAksi
                  label="Aksi produk"
                  items={[
                    { label: 'Ekspor Excel', jalan: () => ekspor() },
                    { label: 'Impor Excel', jalan: () => setDialogImpor(true) },
                    { label: 'Unggah Foto Massal', jalan: () => { setFotoTarget(null); setMassalBuka(true); } },
                    { label: `Lihat Sampah${sampahTotal > 0 ? ` (${sampahTotal})` : ''}`, jalan: () => toggleSampah() },
                  ]}
                />
                {/* Satu-satunya tombol solid di toolbar */}
                <span className="tambah-overflow">
                <IconButton
                  label="Tambah Produk"
                  ikon="plus"
                  ukuran="toolbar"
                  warna="primer"
                  arah="bawah"
                  onClick={buatBaru}
                />
                </span>
              </>
            )}
          </div>
        </div>

        <div className="alat-tabel toolbar-kompak">
          <div className="cari-scan">
          <input
            className="input-cari"
            type="search"
            placeholder="Cari kode item, nama, SKU, atau barcode…"
            value={cari}
            onChange={(e) => {
              setCari(e.target.value);
              setHal(1);
            }}
          />
          <TombolScan onHasil={(t) => { setCari(t); setHal(1); }} />
          </div>
          <span className="filter-inline">
            <select className="input-pilih" value={kategori} onChange={(e) => { setKategori(e.target.value); setHal(1); }} aria-label="Kategori">
              <option value="">Semua kategori</option>
              {opsiKategori.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
            <select className="input-pilih" value={merek} onChange={(e) => { setMerek(e.target.value); setHal(1); }} aria-label="Merek">
              <option value="">Semua merek</option>
              {opsiMerek.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
            <select className="input-pilih" value={aktif} onChange={(e) => { setAktif(e.target.value); setHal(1); }} aria-label="Status">
              <option value="">Semua status</option>
              <option value="1">Aktif</option>
              <option value="0">Nonaktif</option>
            </select>
            <select className="input-pilih" value={gudang} onChange={(e) => { setGudang(e.target.value); setHal(1); }} aria-label="Gudang" title="Kelompokkan produk per gudang">
              <option value="">Semua gudang</option>
              {opsiGudang.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </span>
          <span className="tombol-filter filter-mobile">
            <IconButton label="Filter" ikon="sliders" ukuran="toolbar" arah="bawah" onClick={() => setFilterBuka(true)} />
            {(kategori || merek || aktif || gudang) && <span className="tombol-filter__badge">{[kategori, merek, aktif, gudang].filter(Boolean).length}</span>}
          </span>
          {/* AL2 — tambah + overflow di ujung kanan toolbar (hanya mobile). */}
          <span className="toolbar-kompak__tambah filter-mobile">
            <IconButton label="Tambah Produk" ikon="plus" ukuran="toolbar" warna="primer" arah="bawah" onClick={buatBaru} />
          </span>
          <span className="toolbar-kompak__overflow filter-mobile">
            <IconButton label="Aksi lainnya" ikon="kebab" ukuran="toolbar" arah="bawah" onClick={() => setOverflowBuka((b) => !b)} />
            {overflowBuka && (
              <span className="toolbar-kompak__menu" role="menu">
                <button type="button" onClick={() => { setOverflowBuka(false); ekspor(); }}>Ekspor Excel</button>
                <button type="button" onClick={() => { setOverflowBuka(false); setDialogImpor(true); }}>Impor Excel</button>
                <button type="button" onClick={() => { setOverflowBuka(false); setFotoTarget(null); setMassalBuka(true); }}>Unggah Foto Massal</button>
                <button type="button" onClick={() => { setOverflowBuka(false); toggleSampah(); }}>Lihat Sampah{sampahTotal > 0 ? ` (${sampahTotal})` : ''}</button>
              </span>
            )}
          </span>
          {(kategori || merek || aktif || gudang) && (
            <span className="chip-aktif filter-mobile" aria-label="Filter aktif">
              {kategori && <span className="chip-aktif__item">{opsiKategori.find((o) => String(o.id) === kategori)?.label ?? kategori}<button type="button" aria-label="Hapus filter kategori" onClick={() => { setKategori(''); setHal(1); }}>×</button></span>}
              {merek && <span className="chip-aktif__item">{opsiMerek.find((o) => String(o.id) === merek)?.label ?? merek}<button type="button" aria-label="Hapus filter merek" onClick={() => { setMerek(''); setHal(1); }}>×</button></span>}
              {aktif && <span className="chip-aktif__item">{aktif === '1' ? 'Aktif' : 'Nonaktif'}<button type="button" aria-label="Hapus filter status" onClick={() => { setAktif(''); setHal(1); }}>×</button></span>}
              {gudang && <span className="chip-aktif__item">{opsiGudang.find((o) => String(o.id) === gudang)?.label ?? gudang}<button type="button" aria-label="Hapus filter gudang" onClick={() => { setGudang(''); setHal(1); }}>×</button></span>}
            </span>
          )}
        </div>
        {filterBuka && (
          <div className="lembar-filter-overlay" onMouseDown={() => setFilterBuka(false)}>
            <div className="lembar-filter" role="dialog" aria-label="Filter produk" onMouseDown={(e) => e.stopPropagation()}>
              <h4>Filter Produk</h4>
              <label className="bidang"><span>Kategori</span>
                <select value={kategori} onChange={(e) => setKategori(e.target.value)}>
                  <option value="">Semua kategori</option>
                  {opsiKategori.map((o) => (<option key={o.id} value={o.id}>{o.label}</option>))}
                </select>
              </label>
              <label className="bidang"><span>Merek</span>
                <select value={merek} onChange={(e) => setMerek(e.target.value)}>
                  <option value="">Semua merek</option>
                  {opsiMerek.map((o) => (<option key={o.id} value={o.id}>{o.label}</option>))}
                </select>
              </label>
              <label className="bidang"><span>Status</span>
                <select value={aktif} onChange={(e) => setAktif(e.target.value)}>
                  <option value="">Semua status</option>
                  <option value="1">Aktif</option>
                  <option value="0">Nonaktif</option>
                </select>
              </label>
              <label className="bidang"><span>Gudang</span>
                <select value={gudang} onChange={(e) => setGudang(e.target.value)}>
                  <option value="">Semua gudang</option>
                  {opsiGudang.map((o) => (<option key={o.id} value={o.id}>{o.label}</option>))}
                </select>
              </label>
              <div className="lembar-filter__aksi">
                <button type="button" className="tombol tombol--netral" onClick={() => { setKategori(''); setMerek(''); setAktif(''); setGudang(''); setHal(1); }}>Reset</button>
                <button type="button" className="tombol tombol--primer" onClick={() => { setHal(1); setFilterBuka(false); }}>Terapkan</button>
              </div>
            </div>
          </div>
        )}

        {layarKecil ? (
          <>
          <MobileList
            sibuk={sibuk}
            kosong={`Tidak ada produk${cariTunda ? ` untuk "${cariTunda}"` : ''}.`}
            onBuka={(id) => { const b = data.find((x) => Number(x.id) === id); if (b) bukaDetail(b); }}
            terpilih={pilihan.terpilih}
            modePilih={modePilih}
            onTogglePilih={(id) => pilihan.toggle(id, false, idsHalaman)}
            onMasukModePilih={(id) => { setModePilih(true); if (!pilihan.terpilih.has(id)) pilihan.toggle(id, false, idsHalaman); }}
            onKeluarModePilih={() => { setModePilih(false); pilihan.bersihkan(); }}
            labelPilih="produk"
            data={data.map((b) => ({
              id: Number(b.id),
              aria: `Buka ${b.nama}`,
              judul: b.nama,
              sub: `${b.kode_item ?? '—'} · ${b.sku ?? '—'}`,
              chip: (
                <>
                  <span>{b.kategori_nama ?? 'Tanpa kategori'} · {b.merek_nama ?? 'Tanpa merek'}</span>
                  {Array.isArray(b.stok_rinci) && b.stok_rinci.length > 0 && (
                    <span>Gudang: {(b.stok_rinci as { gudang_kode: string; qty: number }[]).map((g) => `${g.gudang_kode} ${formatAngka(Number(g.qty ?? 0))}`).join(' · ')}</span>
                  )}
                  <span className={`lencana ${Number(b.aktif) === 1 ? 'lencana--aktif' : 'lencana--mati'}`}>{Number(b.aktif) === 1 ? 'Aktif' : 'Nonaktif'}</span>
                </>
              ),
              kanan: (
                <span className="mobile-list__nilai">
                  <span>Stok {formatAngka(Number(b.stok_total ?? 0))}</span>
                  <strong>Rp {formatAngka(Number(b.harga_jual ?? 0))}</strong>
                </span>
              ),
              thumbnail: (<span className="foto-thumb">{b.foto_url ? <img src={b.foto_url} alt="" loading="lazy" /> : 'Foto'}</span>),
              aksi: modeSampah
                ? [
                    { label: 'Pulihkan', jalan: () => void pulihkan([Number(b.id)]) },
                    { label: 'Hapus Permanen', bahaya: true, jalan: () => setDlgPermanen({ ids: [Number(b.id)], info: `"${String(b.nama ?? `#${b.id}`)}"`, semua: false }) },
                  ]
                : [
                    { label: 'Ubah', jalan: () => void ubahProduk(b) },
                    { label: Number(b.aktif) === 1 ? 'Nonaktifkan' : 'Aktifkan', jalan: () => void nonaktifkan(b) },                    { label: 'Hapus', bahaya: true, jalan: () => setHapusTarget(b) },
                  ],
            }))}
          />
          {modePilih && (
            <div className="mobile-pilih-bar">
              <span>{pilihan.jumlah} dipilih</span>
              <button type="button" onClick={() => { setModePilih(false); pilihan.bersihkan(); }}>Batal pilih</button>
            </div>
          )}
          </>
        ) : (
        <DataTable
          pilihan={pilihan}
          idsHalaman={idsHalaman}
          label="produk"
          total={total}
          onPilihSemua={pilihSemuaFilter}
          areaRef={areaRef}
          seleksiDiFooter
          kepala={
            <>
              <th className="rata-tengah">Foto</th>
              <th onClick={() => { setUrut('kode_item'); setArah(urut === 'kode_item' && arah === 'ASC' ? 'DESC' : 'ASC'); }}>
                Kode Item{urut === 'kode_item' && <span className="urut-tanda"> {arah === 'ASC' ? '▲' : '▼'}</span>}
              </th>
              <th onClick={() => { setUrut('nama'); setArah(urut === 'nama' && arah === 'ASC' ? 'DESC' : 'ASC'); }}>
                Nama Produk{urut === 'nama' && <span className="urut-tanda"> {arah === 'ASC' ? '▲' : '▼'}</span>}
              </th>
              <th className="kolom-opsional">Kategori</th>
              <th className="kolom-opsional">Merek</th>
              <th title="Sebaran stok per gudang (mengikuti hak akses peran)">Gudang</th>
              <th className="rata-tengah" title="Profil size produk (P = Pria, W = Wanita)">Profil</th>
              <th className="rata-tengah">SKU</th>
              <th className="rata-tengah">Status</th>
              <th className="rata-kanan kolom-aksi">Aksi</th>
            </>
          }
          baris={data.map((b) => ({
            id: Number(b.id),
            aria: `Pilih ${b.nama}`,
            kelas: 'baris-detail',
            onKlik: () => bukaDetail(b),
            isi: [
              <td key="foto" className="rata-tengah">
                <span className="foto-thumb">{b.foto_url ? <img src={b.foto_url} alt="" loading="lazy" /> : 'Foto'}</span>
              </td>,
              <td key="kode"><code>{b.kode_item ?? '—'}</code></td>,
              <td key="nama">
                <strong>{b.nama}</strong>
                <div className="teks-redup teks-kecil">
                  {gudang && b.stok_gudang !== null && b.stok_gudang !== undefined
                    ? <>stok {formatAngka(Number(b.stok_gudang ?? 0))} di {opsiGudang.find((o) => String(o.id) === gudang)?.label ?? 'gudang'} · dibuat {String(b.dibuat_pada ?? '').slice(0, 10)}</>
                    : <>stok {formatAngka(Number(b.stok_total ?? 0))} · dibuat {String(b.dibuat_pada ?? '').slice(0, 10)}</>}
                </div>
              </td>,
              <td key="kat" className="kolom-opsional">{b.kategori_nama ?? '—'}</td>,
              <td key="merek" className="kolom-opsional">{b.merek_nama ?? '—'}</td>,
              <td key="gudang">
                {Array.isArray(b.stok_rinci) && b.stok_rinci.length > 0 ? (
                  <span className="teks-kecil">
                    {(b.stok_rinci as { warehouse_id: number; gudang_kode: string; gudang_nama: string; qty: number }[]).map((gr) => (
                      <span key={gr.warehouse_id} title={`${gr.gudang_nama} — stok ${formatAngka(Number(gr.qty ?? 0))}`} style={{ display: 'inline-block', marginRight: 8 }}>
                        <code>{gr.gudang_kode}</code> {formatAngka(Number(gr.qty ?? 0))}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="teks-redup" title="Belum ada stok di gudang mana pun">—</span>
                )}
              </td>,
              <td key="profil" className="rata-tengah">
                {b.profil_size ? (
                  <span
                    className={`lencana ${/wanita|women/i.test(String(b.profil_size)) ? 'lencana--peringatan' : 'lencana--aktif'}`}
                    title={`Profil size: ${b.profil_size}`}
                  >
                    {/wanita|women/i.test(String(b.profil_size)) ? 'W' : /pria|men/i.test(String(b.profil_size)) ? 'P' : /anak|kid/i.test(String(b.profil_size)) ? 'A' : '•'}
                  </span>
                ) : (
                  <span className="teks-redup" title="Ikut kategori (resolusi otomatis)">—</span>
                )}
              </td>,
              <td key="sku" className="rata-tengah"><code>{b.sku ?? '—'}</code></td>,
              <td key="status" className="rata-tengah">
                {modeSampah ? (
                  <span className="lencana lencana--bahaya">Sampah</span>
                ) : (
                  <span className={`lencana ${Number(b.aktif) === 1 ? 'lencana--aktif' : 'lencana--mati'}`}>
                    {Number(b.aktif) === 1 ? 'Aktif' : 'Nonaktif'}
                  </span>
                )}
              </td>,
              <td key="aksi" className="rata-kanan kolom-aksi">
                {modeSampah ? (
                  <span className="aksi-baris">
                    <IconButton
                      label="Pulihkan"
                      ikon="rotate-ccw"
                      stopPropagation
                      onClick={() => void pulihkan([Number(b.id)])}
                    />
                    <IconButton
                      label="Hapus Permanen"
                      ikon="trash"
                      warna="bahaya"
                      stopPropagation
                      onClick={() => setDlgPermanen({ ids: [Number(b.id)], info: `"${String(b.nama ?? `#${b.id}`)}"`, semua: false })}
                    />
                  </span>
                ) : (
                  <span className="aksi-baris">
                    <IconButton
                      label="Ubah"
                      ikon="pencil"
                      stopPropagation
                      onClick={() => void ubahProduk(b)}
                    />
                    <IconButton
                      label={Number(b.aktif) === 1 ? 'Nonaktifkan' : 'Aktifkan'}
                      ikon={Number(b.aktif) === 1 ? 'power' : 'circle-check'}
                      warna={Number(b.aktif) === 1 ? 'netral' : 'sukses'}
                      stopPropagation
                      onClick={() => void nonaktifkan(b)}
                    />
                    <IconButton
                      label="Hapus"
                      ikon="trash"
                      warna="bahaya"
                      duaKetuk
                      stopPropagation
                      onClick={() => setHapusTarget(b)}
                    />
                  </span>
                )}
              </td>,
            ],
          }))}
          colSpan={11}
          kosong={sibuk && data.length === 0 ? 'Memuat…' : `Tidak ada produk${cariTunda ? ` untuk "${cariTunda}"` : ''}.`}
          stickyAksi
        />
        )}
        {sedangMassal && pilihan.jumlah > 0 && progresMassal !== null && !bukaHapusMassal && !dialogUbah && (
          <ProgresMassal nilai={progresMassal} keterangan={`Memproses batch… ${progresMassal}%`} />
        )}

        <FooterDaftar
          mode={modeBaris}
          onMode={setModeBaris}
          hal={hal}
          totalHal={totalHal}
          total={total}
          onHal={setHal}
          seleksi={{
            jumlah: pilihan.jumlah,
            total,
            semuaFilter: pilihan.semuaFilter,
            label: 'produk',
            onPilihSemua: pilihSemuaFilter,
            onBatal: pilihan.bersihkan,
            aksi: aksiBar,
          }}
        />
      </section>

      {dialogImpor && (
        <DialogImporExcel
          entitas="produk"
          judul="Produk"
          templateUrl="/api/master/produk/template"
          templateNama="template-produk.xlsx"
          onTutup={() => setDialogImpor(false)}
          onSelesai={() => {
            resetCacheDetail();
            return muat();
          }}
        />
      )}

      {dialogEksporExcel && (
        <DialogEksporExcel
          entitas="produk"
          judul="Produk"
          opsiKategori={opsiKategori}
          terpilih={[...pilihan.terpilih]}
          onTutup={() => setDialogEksporExcel(false)}
        />
      )}

      {dialogEksporPdf && (
        <DialogEksporPdf
          entitas="produk"
          judul="Data Produk"
          opsiKategori={opsiKategori}
          terpilih={[...pilihan.terpilih]}
          onTutup={() => setDialogEksporPdf(false)}
        />
      )}

      {form && (
        <Modal
          judul={form.id ? 'Ubah Produk' : 'Tambah Produk'}
          lebar="lebar"
          onTutup={() => setForm(null)}
          sedangKirim={kirim}
          aksi={
            <>
              <button type="button" className="tombol tombol--netral" onClick={() => setForm(null)} disabled={kirim}>Batal</button>
              <button type="button" className="tombol tombol--primer" onClick={() => void simpan()} disabled={kirim}>
                {kirim ? 'Menyimpan…' : 'Simpan Produk'}
              </button>
            </>
          }
        >
          <div className="form-grid">
            <label className="bidang">
              <span>Kode Item</span>
              <input
                value={form.kode_item}
                onChange={(e) => setForm({ ...form, kode_item: e.target.value })}
                placeholder="Kosongkan → otomatis BRG-…"
                maxLength={40}
              />
            </label>
            <label className="bidang bidang--dua">
              <span>Nama Produk <em className="wajib">*</em></span>
              <input value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} placeholder="Mis. Kaos Distro Hitam" />
            </label>
            <label className="bidang">
              <span>Kategori</span>
              <select value={String(form.category_id)} onChange={(e) => setForm({ ...form, category_id: e.target.value === '' ? '' : Number(e.target.value) })}>
                <option value="">— pilih —</option>
                {opsiKategori.map((o) => (<option key={o.id} value={o.id}>{o.label}</option>))}
              </select>
            </label>
            <label className="bidang">
              <span>Merek</span>
              <select value={String(form.brand_id)} onChange={(e) => setForm({ ...form, brand_id: e.target.value === '' ? '' : Number(e.target.value) })}>
                <option value="">— pilih —</option>
                {opsiMerek.map((o) => (<option key={o.id} value={o.id}>{o.label}</option>))}
              </select>
            </label>
            <label className="bidang">
              <span>Satuan Dasar</span>
              <select value={String(form.satuan_dasar_id)} onChange={(e) => setForm({ ...form, satuan_dasar_id: e.target.value === '' ? '' : Number(e.target.value) })}>
                <option value="">— pilih —</option>
                {opsiSatuan.map((o) => (<option key={o.id} value={o.id}>{o.label}</option>))}
              </select>
            </label>
            <label className="bidang">
              <span>Profil size</span>
              <select
                value={String(form.size_profile_id)}
                onChange={(e) => setForm({ ...form, size_profile_id: e.target.value === '' ? '' : Number(e.target.value) })}
              >
                <option value="">Ikut kategori (resolusi otomatis)</option>
                {opsiProfil.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="bidang">
              <span>SKU <em className="wajib">*</em></span>
              <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="KAOS-001" maxLength={64} />
            </label>
            <label className="bidang">
              <span>Barcode</span>
              <input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} placeholder="899…" />
            </label>
            <label className="bidang">
              <span>Harga Beli</span>
              <input type="number" min={0} value={form.harga_beli} onChange={(e) => setForm({ ...form, harga_beli: e.target.value })} />
            </label>
            <label className="bidang">
              <span>Harga Jual</span>
              <input type="number" min={0} value={form.harga_jual} onChange={(e) => setForm({ ...form, harga_jual: e.target.value })} />
            </label>
            <label className="bidang">
              <span>Stok Minimum</span>
              <input type="number" min={0} value={form.stok_min} onChange={(e) => setForm({ ...form, stok_min: e.target.value })} />
            </label>
            {!form.id && (
              <>
                <label className="bidang">
                  <span>Stok Awal</span>
                  <input
                    type="number"
                    min={0}
                    value={form.stok_awal}
                    onChange={(e) => setForm({ ...form, stok_awal: e.target.value })}
                    placeholder="0"
                  />
                </label>
                <label className="bidang">
                  <span>Gudang Tujuan</span>
                  <select
                    value={String(form.gudang_id)}
                    onChange={(e) => setForm({ ...form, gudang_id: e.target.value === '' ? '' : Number(e.target.value) })}
                  >
                    {opsiGudang.length === 0 && <option value="">— belum ada gudang —</option>}
                    {opsiGudang.map((o) => (<option key={o.id} value={o.id}>{o.label}</option>))}
                  </select>
                </label>
              </>
            )}
            <label className="bidang bidang--dua">
              <span>Deskripsi</span>
              <textarea
                value={form.deskripsi}
                onChange={(e) => setForm({ ...form, deskripsi: e.target.value })}
                rows={3}
                maxLength={2000}
                placeholder="Deskripsi singkat produk — tampil di tab Info Umum pop up detail…"
              />
            </label>
            <div className="bidang bidang--dua">
              <span>Foto Produk{form.id ? '' : ' — simpan produk dulu untuk mengunggah'}</span>
              <div className="tombol-baris">
                <span className="foto-thumb foto-thumb--besar">{form.foto_url ? <img src={form.foto_url} alt="" /> : 'Foto'}</span>
                <label
                  className="tombol tombol--kecil tombol--netral"
                  style={{ cursor: form.id && !fotoSibuk ? 'pointer' : 'not-allowed', opacity: form.id && !fotoSibuk ? 1 : 0.55 }}
                >
                  {fotoSibuk ? 'Memproses…' : 'Ganti Foto'}
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    disabled={!form.id || fotoSibuk}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      void gantiFotoForm(f);
                    }}
                  />
                </label>
                {form.foto_url && (
                  <button type="button" className="tombol tombol--kecil tombol--bahaya" onClick={() => void hapusFotoForm()} disabled={fotoSibuk}>
                    Hapus Foto
                  </button>
                )}
              </div>
            </div>
            <label className="bidang bidang--centang">
              <input type="checkbox" checked={form.aktif === 1} onChange={(e) => setForm({ ...form, aktif: e.target.checked ? 1 : 0 })} />
              <span>Produk aktif</span>
            </label>
          </div>

          <div className="panel-kepala">
            <h4>Konversi Satuan</h4>
            <div className="tombol-baris">
              <button type="button" className="tombol tombol--netral tombol--kecil" onClick={tambahKonversi}>
                + Tambah konversi
              </button>
            </div>
          </div>

          <div className="konversi-panel">
            <p className="teks-redup teks-kecil">
              Konversi satuan (contoh: 1 lusin = 12 pcs, 1 kodi = 20 pcs) — dihitung dari satuan dasar produk.
            </p>
            {form.konversi.map((k, ki) => (
              <div className="konversi-baris" key={ki}>
                <input
                  type="number"
                  min={0}
                  className="konversi-baris__jumlah"
                  value={k.jumlah}
                  placeholder="Jumlah"
                  onChange={(e) => ubahKonversi(ki, { jumlah: e.target.value })}
                />
                <span className="teks-redup">=</span>
                <select
                  value={String(k.unit_id)}
                  onChange={(e) => ubahKonversi(ki, { unit_id: e.target.value === '' ? '' : Number(e.target.value) })}
                >
                  <option value="">— satuan —</option>
                  {opsiSatuanTanpaDasar(form.satuan_dasar_id).map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
                <span className="teks-redup teks-kecil">dari satuan dasar</span>
                <button type="button" className="tombol tombol--kecil tombol--bahaya" onClick={() => hapusKonversi(ki)}>
                  Hapus
                </button>
              </div>
            ))}
            {form.konversi.length === 0 && (
              <p className="teks-redup">Belum ada konversi satuan. Klik “+ Tambah konversi”.</p>
            )}
          </div>

        </Modal>
      )}

      {hapusTarget && (
        <Modal
          judul="Hapus Produk Permanen?"
          lebar="kecil"
          onTutup={() => setHapusTarget(null)}
          aksi={
            <>
              <button type="button" className="tombol tombol--netral" onClick={() => setHapusTarget(null)}>Batal</button>
              <button type="button" className="tombol tombol--bahaya" onClick={() => void konfirmasiHapus()}>Hapus Permanen</button>
            </>
          }
        >
          <p>
            Apakah Anda yakin ingin menghapus produk ini secara permanen? Data produk dan
            riwayatnya akan dihapus bersih dari sistem.
          </p>
          <p className="teks-redup teks-kecil">
            Produk: <strong>{String(hapusTarget.nama)}</strong>. Tindakan ini tidak dapat dibatalkan.
          </p>
        </Modal>
      )}

      {dlgPermanen && (
        <Modal
          judul={dlgPermanen.semua ? 'Kosongkan Sampah?' : 'Hapus Permanen?'}
          lebar="kecil"
          onTutup={() => setDlgPermanen(null)}
          sedangKirim={sedangMassal}
          aksi={
            <>
              <button type="button" className="tombol tombol--netral" onClick={() => setDlgPermanen(null)} disabled={sedangMassal}>Batal</button>
              <button type="button" className="tombol tombol--bahaya" onClick={() => void konfirmasiPermanen()} disabled={sedangMassal}>
                {sedangMassal ? 'Menghapus…' : 'Hapus Permanen'}
              </button>
            </>
          }
        >
          <p>
            Apakah Anda yakin ingin menghapus {dlgPermanen.semua ? <strong>{dlgPermanen.info}</strong> : <>data <strong>{dlgPermanen.info}</strong></>} secara permanen?
          </p>
          <p className="teks-redup teks-kecil">
            Data yang dihapus tidak dapat dikembalikan.
          </p>
        </Modal>
      )}

      {massalBuka && (
        <UnggahFotoMassal
          tutup={() => setMassalBuka(false)}
          selesai={() => {
            resetCacheDetail();
            void muat();
            // X4.2 — foto langsung tampil di POS tanpa muat ulang halaman.
            window.dispatchEvent(new CustomEvent('produk-berubah'));
          }}
          produkTerpilih={fotoTarget ?? undefined}
        />
      )}

      {dialogUbah && (
        <Modal
          judul={
            dialogUbah === 'ubah'
              ? 'Ubah Massal'
              : dialogUbah === 'kategori'
                ? 'Pindah Kategori'
                : dialogUbah === 'merek'
                  ? 'Pindah Merek'
                  : 'Atur Profil Size'
          }
          lebar="lebar"
          onTutup={() => {
            setDialogUbah(null);
            setPraUbah(null);
          }}
          sedangKirim={sedangMassal}
          aksi={
            <>
              <span className="teks-redup teks-kecil">{pilihan.jumlah} produk dipilih</span>
              <button
                type="button"
                className="tombol tombol--netral"
                onClick={() => {
                  setDialogUbah(null);
                  setPraUbah(null);
                }}
                disabled={sedangMassal}
              >
                Batal
              </button>
              {!praUbah ? (
                <button type="button" className="tombol tombol--primer" onClick={() => void pratinjauMassal()} disabled={sedangMassal}>
                  {sedangMassal ? 'Memeriksa…' : 'Pratinjau'}
                </button>
              ) : (
                <button type="button" className="tombol tombol--primer" onClick={() => void terapkanMassal()} disabled={sedangMassal}>
                  {sedangMassal ? 'Menerapkan…' : `Terapkan (${praUbah.total} produk)`}
                </button>
              )}
            </>
          }
        >
          <div className="form-grid">
            {dialogUbah === 'ubah' && (
              <>
                <label className="bidang">
                  <span>Kategori (kosong = tidak diubah)</span>
                  <select value={formMassal.category_id} onChange={(e) => ubahFormMassal({ category_id: e.target.value })}>
                    <option value="">— tidak diubah —</option>
                    {opsiKategori.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="bidang">
                  <span>Merek (kosong = tidak diubah)</span>
                  <select value={formMassal.brand_id} onChange={(e) => ubahFormMassal({ brand_id: e.target.value })}>
                    <option value="">— tidak diubah —</option>
                    {opsiMerek.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="bidang">
                  <span>Satuan Dasar</span>
                  <select value={formMassal.satuan_dasar_id} onChange={(e) => ubahFormMassal({ satuan_dasar_id: e.target.value })}>
                    <option value="">— tidak diubah —</option>
                    {opsiSatuan.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="bidang">
                  <span>Status</span>
                  <select value={formMassal.aktif} onChange={(e) => ubahFormMassal({ aktif: e.target.value })}>
                    <option value="">— tidak diubah —</option>
                    <option value="1">Aktif</option>
                    <option value="0">Nonaktif</option>
                  </select>
                </label>
                <label className="bidang">
                  <span>Harga Jual — cara</span>
                  <select value={formMassal.hargaCara} onChange={(e) => ubahFormMassal({ hargaCara: e.target.value })}>
                    <option value="">— tidak diubah —</option>
                    <option value="naik_persen">Naik (% )</option>
                    <option value="turun_persen">Turun (% )</option>
                    <option value="naik_nominal">Naik (Rp)</option>
                    <option value="turun_nominal">Turun (Rp)</option>
                    <option value="tetap">Harga tetap (Rp)</option>
                  </select>
                </label>
                <label className="bidang">
                  <span>Nilai perubahan</span>
                  <input
                    type="number"
                    min={0}
                    value={formMassal.hargaNilai}
                    onChange={(e) => ubahFormMassal({ hargaNilai: e.target.value })}
                    placeholder="Mis. 10 (persen) atau 5000 (Rp)"
                    disabled={!formMassal.hargaCara}
                  />
                </label>
              </>
            )}
            {dialogUbah === 'kategori' && (
              <label className="bidang">
                <span>Kategori baru <em className="wajib">*</em></span>
                <select value={formMassal.category_id} onChange={(e) => ubahFormMassal({ category_id: e.target.value })}>
                  <option value="">— pilih kategori —</option>
                  {opsiKategori.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {dialogUbah === 'merek' && (
              <label className="bidang">
                <span>Merek baru <em className="wajib">*</em></span>
                <select value={formMassal.brand_id} onChange={(e) => ubahFormMassal({ brand_id: e.target.value })}>
                  <option value="">— pilih merek —</option>
                  {opsiMerek.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {dialogUbah === 'profil' && (
              <>
                <label className="bidang bidang--lebar">
                  <span>Profil size untuk produk terpilih <em className="wajib">*</em></span>
                  <select value={formMassal.size_profile_id} onChange={(e) => ubahFormMassal({ size_profile_id: e.target.value })}>
                    <option value="">— Ikut kategori —</option>
                    {opsiProfil.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="teks-redup teks-kecil bidang--lebar">
                  Profil size menandai pola ukuran barang ini. "Ikut kategori" mengikuti profil kategori
                  produk — pilih hanya bila produk ini butuh profil sendiri.
                </p>
              </>
            )}
          </div>

          {praUbah ? (
            <>
              <h4 className="bagian-judul">
                Pratinjau sebelum → sesudah ({praUbah.total} produk)
              </h4>
              <div className="pratinjau-massal">
                <table className="tabel">
                  <thead>
                    <tr>
                      <th>Produk</th>
                      <th>Perubahan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {praUbah.baris.map((r) => (
                      <tr key={r.nama}>
                        <td>{r.nama}</td>
                        <td>
                          {r.perubahan.map((p) => (
                            <div key={p.label}>
                              <strong>{p.label}:</strong> {p.sebelum} → <strong>{p.sesudah}</strong>
                            </div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="teks-redup teks-kecil">
                Hanya kolom yang diisi yang diubah; kolom kosong dibiarkan. Klik Terapkan untuk menjalankan (batch per 100).
              </p>
            </>
          ) : (
            <p className="teks-redup teks-kecil">
              Isi kolom yang ingin diubah (kosong = tidak diubah), lalu klik <strong>Pratinjau</strong> untuk melihat sebelum → sesudah.
            </p>
          )}
          {sedangMassal && progresMassal !== null && <ProgresMassal nilai={progresMassal} keterangan={`Memproses batch… ${progresMassal}%`} />}
        </Modal>
      )}

      {bukaHapusMassal && (
        <DialogHapusMassal
          judul="Hapus Massal Produk?"
          labelJumlah="produk"
          jumlah={pilihan.jumlah}
          namaAwal={namaHapus ?? []}
          memuatNama={memuatNamaHapus}
          sedang={sedangMassal}
          saran="Produk yang sudah tercatat di penjualan/pembelian/stok akan dilewati — sarannya: Nonaktifkan."
          progres={sedangMassal && progresMassal !== null ? <ProgresMassal nilai={progresMassal} keterangan={`Menghapus… ${progresMassal}%`} /> : undefined}
          onBatal={() => {
            if (!sedangMassal) {
              setBukaHapusMassal(false);
              setNamaHapus(null);
            }
          }}
          onHapus={() => void konfirmasiHapusMassal()}
        />
      )}

      {hasilMassal && <DialogHasilMassal hasil={hasilMassal} onTutup={() => setHasilMassal(null)} />}

      {dataCetak && (
        <Modal
          judul={`Cetak Label / Barcode (${dataCetak.length} produk)`}
          lebar="lebar"
          onTutup={() => setDataCetak(null)}
          aksi={
            <>
              <span className="teks-redup teks-kecil">Barcode Code 39 dari barcode/SKU produk</span>
              <button type="button" className="tombol tombol--netral" onClick={() => setDataCetak(null)}>
                Batal
              </button>
              <button
                type="button"
                className="tombol tombol--primer"
                onClick={() => cetakHtml('Cetak Label Produk', `<div class="grid-label">${labelGrid}</div>`, gayaCetak)}
              >
                Cetak
              </button>
            </>
          }
        >
          <div className="grid-label" dangerouslySetInnerHTML={{ __html: labelGrid }} />
          {labelGrid === '' && <p className="teks-redup">Produk terpilih tidak memiliki barcode/SKU untuk dicetak.</p>}
        </Modal>
      )}

      {kodeDetail && (
        <DetailProduk
          kode={kodeDetail}
          daftar={data.map((b) => ({ id: Number(b.id), kode_item: b.kode_item, nama: b.nama }))}
          sinyal={sinyalDetail}
          onTutup={tutupDetail}
          onGanti={gantiDetail}
          onUbah={(baris) => void ubahProduk(baris)}
          onNonaktif={(baris) => void nonaktifkan(baris)}
          onHapus={(baris) => setHapusTarget(baris)}
          onCetak={(id) => void cetakSatu(id)}
          onBerubah={() => void muat()}
        />
      )}
    </div>
  );
}

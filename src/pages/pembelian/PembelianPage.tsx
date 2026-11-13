import { Fragment, useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CariBarang, type HasilProduk } from '../../components/CariBarang';
import { Modal } from '../../components/crud/Modal';
import { IconButton } from '../../components/IconButton';
import { Icon, type NamaIcon } from '../../components/Icon';
import { ScanKamera, TombolScan } from '../../components/ScanKamera';
import { DialogWa } from '../faktur/DialogWa';
import { BarPeriode, type NilaiPeriode } from '../../components/BarPeriode';
import { hitungRentang, labelRentang } from '../../lib/periode';
import { beritahu } from '../../components/crud/Toast';
import { FooterDaftar } from '../../components/crud/FooterDaftar';
import { useBarisOtomatis } from '../../lib/barisOtomatis';
import { ambilOpsi, apiGet, apiPost, apiPut } from '../../lib/api';
import { useSegarkanModul } from '../../lib/segarkan';
import { useSesi } from '../../lib/sesi';
import { TIP_GUDANG_TERKUNCI, idGudangBawaan, idGudangTerkunci } from '../../lib/gudang';
import { putarUmpanBalikScan } from '../../lib/umpanBalikScan';
import { bolehKelolaTransaksi, can, pesanIzin, type AksiMatriks } from '../../lib/hak';

import { formatAngka, formatRupiah, formatTanggal, formatTanggalWaktu } from '../../lib/format';
import { useGardaForm } from '../../lib/gardaForm';
import { gulirKeBaris } from '../../lib/barisTransaksi';
import './pembelian.css';

type Baris = Record<string, any>;
type Opsi = { id: number; label: string };
/** Baris item mode Biasa — kini menyerupai keranjang kasir: identitas tampil
 *  (kode/SKU, nama) ikut tersimpan di baris sehingga tabel tak perlu dropdown
 *  produk; satuan_opsi = satuan dasar + konversi dari hasil pencarian. */
type ItemForm = {
  kunci: string;
  product_id: string;
  qty: string;
  unit_id: string;
  harga_beli: string;
  diskon: string;
  diskon_mode: 'rp' | 'persen';
  diskon_persen: string;
  kode: string;
  nama: string;
  satuan_opsi: { id: string; label: string; faktor: number }[];
  stok: number;
};

/** Status dokumen: draft (PO) → diterima (GRN) → disahkan (Faktur). */
const STATUS: Record<string, { label: string; lencana: string }> = {
  draft: { label: 'Draft (PO)', lencana: 'lencana--netral' },
  diterima: { label: 'Diterima (GRN)', lencana: 'lencana--peringatan' },
  disahkan: { label: 'Disahkan (Faktur)', lencana: 'lencana--aktif' },
  batal: { label: 'Dibatalkan', lencana: 'lencana--bahaya' },
};

/** Pemilih metode di bagian atas halaman — keduanya memakai draft & alur yang sama. */
const METODE: { kode: string; label: string; ket: string; ikon: NamaIcon; title: string }[] = [
  { kode: 'biasa', label: 'Biasa', ket: 'Form manual: pemasok, gudang tujuan, tanggal, tabel item (produk, jumlah, satuan, harga beli, diskon), total, dan pajak.', ikon: 'pencil', title: 'Mode Biasa — form manual' },
  { kode: 'scan', label: 'Scan Barcode', ket: 'Pindai barcode box (paket) atau produk satuan lewat scanner USB / kamera HP — semua hasil masuk tabel draft yang bisa direvisi (SKU, jumlah, hapus/tambah baris) sebelum "Sahkan & Masukkan ke Gudang".', ikon: 'scan', title: 'Mode Scan Barcode' },
];
const METODE_LABEL: Record<string, string> = { biasa: 'Biasa', scan: 'Scan Barcode', chatbot: 'Chatbot' };

function hariIni(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

const formKosong = () => ({ pemasok: '', gudang: '', tanggal: hariIni(), no_po: '', pajak: '0' });

const kunciItem = (): string => `i${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** Baris item langsung dari hasil pencarian (tambah cepat / dokumen lama). */
function barisDariHasil(h: HasilProduk, qty = 1): ItemForm {
  const satuan_opsi: ItemForm['satuan_opsi'] = [
    ...(h.satuan_dasar_id ? [{ id: String(h.satuan_dasar_id), label: h.satuan_dasar ?? 'Satuan dasar', faktor: 1 }] : []),
    ...h.konversi
      .filter((k) => k.unit_id !== h.satuan_dasar_id)
      .map((k) => ({ id: String(k.unit_id), label: k.nama, faktor: k.jumlah_per_satuan_dasar })),
  ];
  return {
    kunci: kunciItem(),
    product_id: String(h.product_id),
    qty: String(qty),
    unit_id: h.satuan_dasar_id ? String(h.satuan_dasar_id) : (satuan_opsi[0]?.id ?? ''),
    harga_beli: String(h.harga_terakhir ?? h.harga_beli ?? 0),
    diskon: '0',
    diskon_mode: 'rp',
    diskon_persen: '',
    kode: h.kode_item ?? h.sku,
    nama: h.produk,
    satuan_opsi,
    stok: h.stok,
  };
}

// --- scan barcode ----------------------------------------------------------

/** Baris draft hasil scan: baris box terikat komposisi standar paket (boleh disesuaikan). */
type BarisScan = {
  kunci: string;
  product_id: string;
  unit_id: string;
  qty: string;
  harga_beli: string;
  diskon: string;
  pack_id: number | null;
  pack_nama: string | null;
  jumlah_box: number;
  standar_qty: number | null;
  standar_product_id: number | null;
  sumber: 'box' | 'satuan' | 'manual';
};

type LogScan = { barcode: string; tipe: string; pack_id: number | null; product_id: number | null };

const kunciBaris = (): string => `s${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** Baris hasil scan box yang disesuaikan: qty/produk beda dari komposisi standar box. */
function barisBeda(b: BarisScan): boolean {
  if (b.standar_qty === null || !b.pack_id) return false;
  const qty = Number(b.qty) || 0;
  return Number(b.product_id) !== Number(b.standar_product_id) || qty !== b.jumlah_box * Number(b.standar_qty);
}

function alasanBeda(b: BarisScan): string {
  const alasan: string[] = [];
  if (Number(b.product_id) !== Number(b.standar_product_id)) alasan.push('produk diganti dari komposisi standar');
  const qty = Number(b.qty) || 0;
  if (qty !== b.jumlah_box * Number(b.standar_qty ?? 0)) {
    alasan.push(`jumlah ${qty} ≠ ${b.jumlah_box} box × ${b.standar_qty} pcs`);
  }
  return alasan.join('; ');
}

/** SKU produk baru dari dialog "barcode belum terdaftar". */
function slugSku(nama: string): string {
  return nama.trim().replace(/\s+/g, '-').toUpperCase().slice(0, 40) || 'SKU-BARU';
}

export function PembelianPage({ tampilan = 'semua' }: { tampilan?: 'semua' | 'input' | 'riwayat' }) {
  const navigasi = useNavigate();
  // --- daftar dokumen (bersama untuk ketiga metode) ---
  const [data, setData] = useState<Baris[]>([]);
  const [total, setTotal] = useState(0);
  const [hal, setHal] = useState(1);
  const areaRef = useRef<HTMLDivElement>(null);
  // AJ — baris per halaman otomatis (Otomatis/20/50/100) + footer terpadu.
  const { per, mode: modeBaris, setMode: setModeBaris } = useBarisOtomatis({
    kunci: 'pembelian-riwayat',
    areaRef,
    total,
    hal,
    setHal,
  });
  const [cari, setCari] = useState('');
  const [cariTunda, setCariTunda] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterMetode, setFilterMetode] = useState('');
  // R2 — periode tampil: satu pilihan menyaring daftar transaksi + dokumen.
  const [periode, setPeriode] = useState<NilaiPeriode>({ periode: '7', dariInput: '', sampaiInput: '' });
  const { dari: tglDari, sampai: tglSampai } = hitungRentang(periode.periode, periode.dariInput, periode.sampaiInput);
  // R2 — dokumen bawah: faktur pembelian terbit pada periode tampil.
  const [dokumen, setDokumen] = useState<Baris[]>([]);
  const [totalDokumen, setTotalDokumen] = useState(0);
  const [sibukDokumen, setSibukDokumen] = useState(false);
  const [dlgWaDok, setDlgWaDok] = useState<Baris | null>(null);
  const dokumenRef = useRef<HTMLHeadingElement>(null);
  const [sibuk, setSibuk] = useState(false);
  // --- 3 Token Switcher: Input / Riwayat / Dokumen (satu modul terintegrasi).
  // Default Riwayat agar halaman ringan; prop tampilan (rute) hanya menentukan awal.
  const [tabAktif, setTabAktif] = useState<'input' | 'riwayat' | 'dokumen'>(
    tampilan === 'input' ? 'input' : 'riwayat',
  );
  // AX — tombol aksi mengikuti matriks peran (delapan sel) + keadaan dokumen.
  const sesiInfo = useSesi().info;
  const bisa = (...a: AksiMatriks[]): boolean => can(sesiInfo, 'pembelian', ...a);
  // Token Batal/Edit transaksi — Administrator atau Hak Khusus "Hapus transaksi".
  const bolehKelola = bolehKelolaTransaksi(sesiInfo);
  const tipIzin = (sel: AksiMatriks | AksiMatriks[], operasi?: string): string | undefined =>
    bisa(...(Array.isArray(sel) ? sel : [sel])) ? undefined : pesanIzin(sesiInfo, 'pembelian', sel, operasi);
  useEffect(() => {
    setTabAktif(tampilan === 'input' ? 'input' : 'riwayat');
  }, [tampilan]);
  const pilihTab = (t: 'input' | 'riwayat' | 'dokumen'): void => {
    setTabAktif(t);
    // Sinkron URL agar refresh/bookmark tetap konsisten.
    if (t === 'input' && tampilan !== 'input') navigasi('/pembelian');
    else if (t !== 'input' && tampilan !== 'riwayat') navigasi('/pembelian/riwayat');
  };
  // Setelah simpan sukses dari tab Input → otomatis ke Riwayat.
  const selesaiSimpanKeRiwayat = async (): Promise<void> => {
    await muat();
    pilihTab('riwayat');
  };

  // --- opsi form ---
  const [opsiPemasok, setOpsiPemasok] = useState<Opsi[]>([]);
  const [opsiGudang, setOpsiGudang] = useState<Opsi[]>([]);
  // WI — pengguna dengan akses satu gudang: gudang form dikunci ke gudang itu.
  const gudangTerkunci = idGudangTerkunci(sesiInfo, opsiGudang);
  const [petaProduk, setPetaProduk] = useState<Map<number, Baris>>(new Map());

  // --- form Biasa ---
  const [metode, setMetode] = useState('biasa');
  const [aktif, setAktif] = useState<Baris | null>(null);
  const [form, setForm] = useState(formKosong());
  // WI2 — gudang default transaksi otomatis terpilih saat form dibuka.
  const gudangBawaan = idGudangBawaan(sesiInfo, opsiGudang);
  useEffect(() => {
    if (gudangTerkunci !== null) {
      setForm((f) => (f.gudang ? f : { ...f, gudang: String(gudangTerkunci) }));
      return;
    }
    if (gudangBawaan !== null) setForm((f) => (f.gudang ? f : { ...f, gudang: String(gudangBawaan) }));
  }, [gudangTerkunci, gudangBawaan]);
  const [items, setItems] = useState<ItemForm[]>([]);
  const [sibukSimpan, setSibukSimpan] = useState(false);
  // --- keranjang item (autocomplete gaya Kasir Tanpa Foto) ---
  const [fokusCari, setFokusCari] = useState(0); // token: >0 = pinta fokus ke kolom cari
  const [barisSorot, setBarisSorot] = useState<string | null>(null); // baris +1 (merge) disorot sebentar
  const [barisTerpilih, setBarisTerpilih] = useState<string | null>(null); // target Delete
  // --- navigasi keyboard mode Biasa (G2): qty hanya angka, ↑↓ antar baris,
  //     Delete + Undo 5 detik, Esc/F2 kembali ke kolom cari ---------------
  const kolomRefs = useRef(new Map<string, HTMLInputElement | HTMLSelectElement>());
  const [qtyTeks, setQtyTeks] = useState<Record<string, string>>({}); // buffer ketik Qty
  const qtySebelum = useRef<Record<string, string>>({}); // nilai Qty saat fokus masuk
  const [undoHapus, setUndoHapus] = useState<{ baris: ItemForm; idx: number } | null>(null);
  const undoTimer = useRef<number | null>(null);
  /** Set kunci baris yang Qty-nya sedang "terblok" — ketikan angka pertama
   *  menimpa seluruh isi (bukan menggandeng di belakang angka lama). */
  const qtyBlok = useRef<Set<string>>(new Set());
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabNavigasi = useRef<string | null>(null); // tab tujuan ↑/↓ — fokus diserahkan setelah mount
  const [dlgBaru, setDlgBaru] = useState<{ nama: string; sku: string; harga: string; barcode: string } | null>(null);

  // --- modal ---
  const [mode, setMode] = useState<null | 'terima' | 'sahkan' | 'lihat' | 'batal'>(null);
  const [modalAktif, setModalAktif] = useState<Baris | null>(null);
  // Sibuk khusus lapisan modal aksi (Terima/Sahkan/Batal) — terpisah dari
  // sibukSimpan form input, sehingga penyimpanan form yang masih berjalan
  // tidak pernah mengunci tombol modal (anti-freeze). Satu nilai cukup
  // karena hanya satu modal aksi yang terbuka dalam satu waktu.
  const [sibukModal, setSibukModal] = useState(false);
  // Penjaga kirim-ganda: state sibuk bisa basi pada klik beruntun dalam satu
  // tick (dua POST terima = 409 kedua). Ref dibaca sinkron saat klik.
  const aksiRef = useRef(false);
  const [detail, setDetail] = useState<Baris | null>(null);
  /** Riwayat pemindaian barcode dokumen (modal Lihat, metode Scan). */
  const [riwayatPindai, setRiwayatPindai] = useState<Baris[]>([]);
  const [noFaktur, setNoFaktur] = useState('');
  const [jatuhTempo, setJatuhTempo] = useState('');
  const [alasanBatal, setAlasanBatal] = useState('');
  // --- hasil pengesahan: faktur otomatis (BAGIAN I) ---
  const [fakturBaru, setFakturBaru] = useState<{
    id: number;
    no_faktur: string;
    total: number;
    tanggal: string;
    pemasokNama: string;
  } | null>(null);
  const [dlgWaFaktur, setDlgWaFaktur] = useState(false);

  // --- scan barcode ---
  const [scanTeks, setScanTeks] = useState('');
  const [scanBaris, setScanBaris] = useState<BarisScan[]>([]);
  const [scanLog, setScanLog] = useState<LogScan[]>([]);
  const [scanAktivitas, setScanAktivitas] = useState<string[]>([]);
  const [scanProses, setScanProses] = useState(false);
  const [dialogBarcode, setDialogBarcode] = useState<string | null>(null);
  const [dlgMode, setDlgMode] = useState<'pilihan' | 'produk' | 'box'>('pilihan');
  const [dlgProduk, setDlgProduk] = useState({ nama: '', sku: '', harga: '' });
  const [dlgBox, setDlgBox] = useState<{ kode: string; nama: string; isi: { product_id: string; qty: string }[] }>({
    kode: '',
    nama: '',
    isi: [{ product_id: '', qty: '1' }],
  });
  /** Pop up pindai kamera HP (komponen bersama, mode berkelanjutan). */
  const [pindai, setPindai] = useState(false);
  const scanInputRef = useRef<HTMLInputElement | null>(null);

  // --- muat daftar & opsi -------------------------------------------------
  useEffect(() => {
    const t = window.setTimeout(() => {
      setCariTunda(cari);
      setHal(1);
    }, 350);
    return () => window.clearTimeout(t);
  }, [cari]);

  useEffect(() => {
    if (tabAktif !== 'input') return;
    ambilOpsi('pemasok').then(setOpsiPemasok).catch((e: Error) => beritahu(e.message, 'galat'));
    ambilOpsi('gudang').then(setOpsiGudang).catch((e: Error) => beritahu(e.message, 'galat'));
    muatProduk('');
  }, [tabAktif]);

  // Gudang terkunci hanya berlaku untuk dokumen BARU; mode Ubah selalu
  // mengikuti gudang dokumen yang sedang diedit.
  useEffect(() => {
    if (gudangTerkunci === null || aktif) return;
    setForm((f) => (Number(f.gudang) === gudangTerkunci ? f : { ...f, gudang: String(gudangTerkunci) }));
  }, [gudangTerkunci, aktif]);

  // ISOLASI GUDANG MUTLAK — peta produk (opsi select chat/scan) dikunci ke
  // gudang tujuan bila gudang diberikan: peta diganti (bukan digabung) agar
  // barang gudang lain tidak bisa dipilih. Tanpa gudang = global (tampilan).
  const muatProduk = (q: string, gudang?: number) => {
    const param = new URLSearchParams();
    if (q) param.set('cari', q);
    if (gudang) param.set('gudang_id', String(gudang));
    const qs = param.toString();
    apiGet<{ data: Baris[] }>(`/api/stock/produk${qs ? `?${qs}` : ''}`)
      .then((r) => {
        setPetaProduk((lama) => {
          // Terkunci gudang: ganti seluruh peta agar sisa global tidak bocor.
          const peta = gudang ? new Map<number, Baris>() : new Map(lama);
          for (const v of r.data) peta.set(Number(v.id), v);
          return peta;
        });
      })
      .catch((e: Error) => beritahu(e.message, 'galat'));
  };

  // Ganti gudang tujuan: kunci ulang peta produk ke katalog gudang baru.
  useEffect(() => {
    if (tabAktif !== 'input') return;
    const gid = Number(form.gudang) || 0;
    if (gid) muatProduk('', gid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabAktif, form.gudang]);

  const ubahPeriode = (n: NilaiPeriode) => {
    let v = n;
    if (n.periode === 'rentang' && !n.dariInput && !n.sampaiInput) {
      const r = hitungRentang('7', '', '');
      v = { ...n, dariInput: r.dari, sampaiInput: r.sampai };
    }
    setPeriode(v);
    setHal(1);
  };

  const loncatDokumen = () => {
    // Tautan faktur di riwayat → pindah ke tab Dokumen (bukan scroll bawah lagi).
    setTabAktif('dokumen');
    if (tampilan !== 'riwayat') navigasi('/pembelian/riwayat');
    setTimeout(() => dokumenRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const muat = useCallback(async () => {
    setSibuk(true);
    try {
      const q = new URLSearchParams({ hal: String(hal), per: String(per), cari: cariTunda });
      if (filterStatus) q.set('status', filterStatus);
      if (filterMetode) q.set('metode', filterMetode);
      if (tglDari) q.set('dari', tglDari);
      if (tglSampai) q.set('sampai', tglSampai);
      const r = await apiGet<{ data: Baris[]; total: number }>(`/api/pembelian?${q.toString()}`);
      setData(r.data);
      setTotal(r.total);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibuk(false);
    }
  }, [hal, per, cariTunda, filterStatus, filterMetode, tglDari, tglSampai]);

  useEffect(() => {
    if (tabAktif === 'input') return;
    void muat();
  }, [muat, tabAktif]);
  // Tombol Refresh global di topbar: riwayat + dokumen (tanpa menyentuh draft input).
  useSegarkanModul(muat);

  // R2 — dokumen bawah: faktur pembelian pada periode tampil.
  const muatDokumen = useCallback(async () => {
    setSibukDokumen(true);
    try {
      const q = new URLSearchParams({ hal: '1', per: '100', jenis: 'pembelian' });
      if (tglDari) q.set('dari', tglDari);
      if (tglSampai) q.set('sampai', tglSampai);
      const r = await apiGet<{ data: Baris[]; total: number }>(`/api/faktur?${q.toString()}`);
      setDokumen(r.data);
      setTotalDokumen(r.total);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibukDokumen(false);
    }
  }, [tglDari, tglSampai]);

  useEffect(() => {
    if (tabAktif === 'input') return;
    void muatDokumen();
  }, [muatDokumen, tabAktif]);
  useSegarkanModul(muatDokumen);

  const totalHal = Math.max(1, Math.ceil(total / per));

  // --- perhitungan total (identik dengan server) --------------------------
  const hitungDari = (list: { qty: string; harga_beli: string; diskon: string }[]) => {
    let subtotal = 0;
    let diskon = 0;
    for (const i of list) {
      subtotal += (Number(i.qty) || 0) * (Number(i.harga_beli) || 0);
      diskon += Number(i.diskon) || 0;
    }
    const dasar = subtotal - diskon;
    const pajak = Math.round((dasar * (Number(form.pajak) || 0)) / 100);
    return { subtotal, diskon, dasar, pajak, total: dasar + pajak };
  };
  const hitung = () => hitungDari(items);

  const labelProduk = (v: Baris): string => `${v.sku} — ${v.produk}`;

  // --- aksi form ----------------------------------------------------------
  const resetForm = () => {
    setAktif(null);
    setForm(formKosong());
    setItems([]);
    setBarisTerpilih(null);
  };

  const bukaUbah = async (b: Baris) => {
    try {
      const r = await apiGet<{ data: Baris }>(`/api/pembelian/${b.id}`);
      const d = r.data;
      // AW4 — Token Edit: dokumen draft/diterima/disahkan bisa dibuka ke form.
      // Dokumen yang sudah disahkan direkonsiliasi stok, hutang & fakturnya.
      const statusDok = String(d.status);
      if (!['draft', 'diterima', 'disahkan'].includes(statusDok)) {
        beritahu(`Dokumen berstatus "${d.status}" tidak bisa diubah.`, 'galat');
        return;
      }
      if (statusDok !== 'draft' && !(bolehKelola && bisa('ubah'))) {
        beritahu(
          'Edit dokumen yang sudah diterima/disahkan butuh Administrator atau Hak Khusus "Hapus transaksi".',
          'galat',
        );
        return;
      }
      setMode(null);
      setAktif(d);
      setMetode('biasa');
      pilihTab('input');
      setForm({
        pemasok: String(d.supplier_id),
        gudang: String(d.warehouse_id),
        tanggal: String(d.tanggal).slice(0, 10),
        no_po: String(d.no_po ?? ''),
        pajak: String(d.pajak_persen ?? 0),
      });
      const daftar: ItemForm[] = (d.items ?? []).map((i: Baris) => ({
        kunci: kunciItem(),
        product_id: String(i.product_id),
        qty: String(i.qty),
        unit_id: i.unit_id ? String(i.unit_id) : '',
        harga_beli: String(i.harga_beli),
        diskon: String(i.diskon ?? 0),
        diskon_mode: 'rp',
        diskon_persen: '',
        kode: i.sku ?? '',
        nama: i.produk ?? '',
        satuan_opsi: i.satuan_dasar_id
          ? [{ id: String(i.satuan_dasar_id), label: i.satuan_dasar ?? 'Satuan dasar', faktor: 1 }]
          : [],
        stok: 0,
      }));
      setItems(daftar);
      setBarisTerpilih(null);
      // Perkaya opsi satuan (konversi) & kode item; kegagalan tak fatal — baris tetap tampil dari data dokumen.
      const ids = daftar.map((b) => b.product_id).filter(Boolean).join(',');
      if (ids) {
        apiGet<{ data: HasilProduk[] }>(
          `/api/pembelian/produk-cari?ids=${encodeURIComponent(ids)}&supplier_id=${d.supplier_id}&gudang_id=${d.warehouse_id}`,
        )
          .then((rv) => {
            const peta = new Map(rv.data.map((h) => [h.product_id, h]));
            setItems((lama) =>
              lama.map((b) => {
                const h = peta.get(Number(b.product_id));
                if (!h) return b;
                const satuan_opsi: ItemForm['satuan_opsi'] = [
                  ...(h.satuan_dasar_id
                    ? [{ id: String(h.satuan_dasar_id), label: h.satuan_dasar ?? 'Satuan dasar', faktor: 1 }]
                    : []),
                  ...h.konversi
                    .filter((k) => k.unit_id !== h.satuan_dasar_id)
                    .map((k) => ({ id: String(k.unit_id), label: k.nama, faktor: k.jumlah_per_satuan_dasar })),
                ];
                const cocok = satuan_opsi.find((o) => o.id === b.unit_id);
                return { ...b, kode: h.kode_item ?? b.kode, satuan_opsi, unit_id: cocok ? b.unit_id : (satuan_opsi[0]?.id ?? b.unit_id) };
              }),
            );
          })
          .catch(() => undefined);
      }
      setPetaProduk((peta) => {
        const baru = new Map(peta);
        for (const i of d.items ?? []) {
          const id = Number(i.product_id);
          if (!baru.has(id)) {
            baru.set(id, { id, sku: i.sku, produk: i.produk, harga_beli: i.harga_beli, satuan_dasar_id: i.satuan_dasar_id });
          }
        }
        return baru;
      });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    }
  };

  const bangunPayload = (): Record<string, unknown> | null => {
    if (!form.pemasok) {
      beritahu('Pilih pemasok.', 'galat');
      return null;
    }
    if (!form.gudang) {
      beritahu('Pilih gudang tujuan.', 'galat');
      return null;
    }
    const isi = items
      .filter((i) => i.product_id)
      .map((i) => ({
        product_id: Number(i.product_id),
        qty: Number(i.qty),
        unit_id: i.unit_id ? Number(i.unit_id) : null,
        harga_beli: Number(i.harga_beli) || 0,
        diskon: Number(i.diskon) || 0,
      }));
    if (isi.length === 0) {
      beritahu('Tambahkan minimal satu item pembelian.', 'galat');
      return null;
    }
    for (const i of isi) {
      if (!(i.qty > 0)) {
        beritahu('Jumlah setiap item harus lebih dari 0.', 'galat');
        return null;
      }
      if (i.harga_beli < 0 || i.diskon < 0) {
        beritahu('Harga beli/diskon tidak boleh negatif.', 'galat');
        return null;
      }
    }
    const pajak = Number(form.pajak) || 0;
    if (pajak < 0 || pajak > 100) {
      beritahu('Pajak harus antara 0–100%.', 'galat');
      return null;
    }
    const [y, m, d] = form.tanggal.split('-').map(Number);
    const tanggal = new Date(y || new Date().getFullYear(), (m || 1) - 1, d || 1, 12).toISOString();
    return {
      metode_input: metode,
      supplier_id: Number(form.pemasok),
      warehouse_id: Number(form.gudang),
      tanggal,
      no_po: form.no_po.trim() || null,
      pajak_persen: pajak,
      items: isi,
    };
  };

  // --- keranjang item mode Biasa (autocomplete gaya Kasir Tanpa Foto) -------
  const kunciKolom = (kunci: string, kolom: number) => `${kunci}:${kolom}`;

  /**
   * Satuan "utuh" (pcs, lusin, kodi, dus, box…) tidak menerima desimal —
   * koma dikunci. Satuan ukur (kg, liter, m…) boleh memakai koma.
   */
  const SATUAN_UTUH = ['pcs', 'pc', 'pcs.', 'lusin', 'lsn', 'kodi', 'kd', 'dus', 'box', 'box', 'karton', 'ktn', 'pack', 'pak', 'set', 'pasang', 'pas', 'rim', 'bal', 'zak', 'rol', 'ktk', 'trash', 'lusin', 'kodi'];
  const bolehDesimal = (it: ItemForm) => {
    const label = (it.satuan_opsi.find((o) => o.id === it.unit_id)?.label ?? '').toLowerCase().trim();
    if (!label) return true; // satuan belum dipilih — biarkan (akan divalidasi server)
    return !SATUAN_UTUH.some((u) => label === u || label.startsWith(u + ' '));
  };

  /** Fokus kolom tertentu pada baris ke-idx; kolom 0 (Qty) otomatis terblok. */
  const fokusSel = (idx: number, kolom: number) => {
    const it = items[idx];
    if (!it) return;
    setBarisTerpilih(it.kunci);
    const el = kolomRefs.current.get(kunciKolom(it.kunci, kolom));
    if (!el) return;
    el.focus();
    if (kolom === 0) (el as HTMLInputElement).select();
    // Navigasi ↑/↓: baris tujuan selalu ikut tergulir ke area pandang.
    gulirKeBaris(el);
  };

  const keKolomCari = () => setFokusCari((t) => t + 1);

  /**
   * Navigasi keyboard satu sel (Qty / Harga / Diskon):
   *   ↑↓  antar baris (↑ di baris pertama → kolom cari)
   *   Enter konfirmasi → kolom cari
   *   Esc  → kolom cari
   *   Delete hapus baris (Undo 5 detik)
   * Kolom Satuan memakai perilaku bawaan <select> (↑↓ memilih satuan).
   */
  const onKunciSel = (e: ReactKeyboardEvent<HTMLInputElement>, idx: number, kolom: number) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (idx < items.length - 1) fokusSel(idx + 1, kolom);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (idx === 0) keKolomCari();
      else fokusSel(idx - 1, kolom);
      return;
    }
    if (e.key === 'Enter') {
      if (e.ctrlKey || e.metaKey) return; // Ctrl+Enter = Simpan Draft (pintasan global)
      e.preventDefault();
      if (kolom === 0) commitQty(items[idx].kunci);
      keKolomCari();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (kolom === 0) commitQty(items[idx].kunci);
      keKolomCari();
      return;
    }
  };

  /** Keluar kolom Qty: kosong / 0 → kembali ke nilai sebelum diedit. */
  const commitQty = (kunci: string) => {
    qtyBlok.current.delete(kunci);
    setQtyTeks((s) => {
      if (!(kunci in s)) return s;
      const c = { ...s };
      delete c[kunci];
      return c;
    });
    const t = qtyTeks[kunci];
    if (t === undefined) return;
    const n = Number(String(t).replace(',', '.'));
    const nilai = t.trim() && Number.isFinite(n) && n > 0 ? String(n) : (qtySebelum.current[kunci] ?? '1');
    ubahItem(kunci, { qty: nilai });
  };

  /** Hapus baris terpilih — bisa diurungkan selama 5 detik. */
  const hapusBarisUndo = (idx: number) => {
    const it = items[idx];
    if (!it) return;
    setUndoHapus({ baris: it, idx });
    setItems((l) => l.filter((x) => x.kunci !== it.kunci));
    setBarisTerpilih(null);
    setQtyTeks((s) => {
      if (!(it.kunci in s)) return s;
      const c = { ...s };
      delete c[it.kunci];
      return c;
    });
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndoHapus(null), 5000);
    keKolomCari();
  };

  const urungkanHapus = () => {
    if (!undoHapus) return;
    const { baris, idx } = undoHapus;
    setItems((l) => {
      const c = [...l];
      c.splice(Math.min(idx, c.length), 0, baris);
      return c;
    });
    setUndoHapus(null);
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    setBarisTerpilih(baris.kunci);
  };

  /**
   * Hasil pencarian → baris keranjang. Produk sama sudah ada = jumlah +1
   * (tanpa baris ganda). Fokus SELALU kembali ke kolom cari (dikosongkan)
   * agar operator bisa mengetik & menambah barang berikutnya tanpa jeda —
   * pindah ke tabel cukup via Tab / Panah Bawah dari kolom cari kosong.
   */
  const tambahItem = (h: HasilProduk) => {
    const id = String(h.product_id);
    const idx = items.findIndex((x) => x.product_id === id);
    let kunciBaru: string;
    if (idx >= 0) {
      const kunci = items[idx].kunci;
      kunciBaru = kunci;
      setItems(items.map((x, i) => (i === idx ? { ...x, qty: String((Number(x.qty) || 0) + 1) } : x)));
      setBarisSorot(kunci);
      window.setTimeout(() => setBarisSorot((s) => (s === kunci ? null : s)), 1400);
    } else {
      const baru = barisDariHasil(h);
      kunciBaru = baru.kunci;
      // FIFO: baris baru selalu di bawah (urutan input = urutan tampil).
      setItems([...items, baru]);
      setBarisSorot(baru.kunci);
      window.setTimeout(() => setBarisSorot((s) => (s === baru.kunci ? null : s)), 1400);
    }
    // Baris baru bisa lahir di luar area gulir tabel: gulir agar terlihat & tandai
    // terpilih, TANPA memindahkan kursor. Fokus tetap di kolom cari (dikosongkan)
    // baik dari Enter/klik dropdown maupun scan barcode, sehingga input beruntun
    // tidak terputus. Masuk ke tabel tetap manual via Tab / Panah Bawah.
    setBarisTerpilih(kunciBaru);
    requestAnimationFrame(() => {
      const el = kolomRefs.current.get(kunciKolom(kunciBaru, 0));
      if (el) gulirKeBaris(el);
    });
    setFokusCari((t) => t + 1);
  };

  /** Ubah satu baris + konsekuensinya: harga ikut konversi satuan, diskon % dihitung ulang. */
  const ubahItem = (kunci: string, patch: Partial<ItemForm>) =>
    setItems((list) =>
      list.map((b) => {
        if (b.kunci !== kunci) return b;
        const baru: ItemForm = { ...b, ...patch };
        if (patch.unit_id !== undefined && patch.harga_beli === undefined) {
          const fLama = b.satuan_opsi.find((o) => o.id === b.unit_id)?.faktor ?? 1;
          const fBaru = baru.satuan_opsi.find((o) => o.id === baru.unit_id)?.faktor ?? 1;
          if (fLama > 0 && fBaru > 0 && fLama !== fBaru) {
            baru.harga_beli = String(Math.round(((Number(b.harga_beli) || 0) * fBaru) / fLama));
          }
        }
        if (baru.diskon_mode === 'persen') {
          const p = Number(baru.diskon_persen) || 0;
          baru.diskon = String(
            Math.round(((Number(baru.qty) || 0) * (Number(baru.harga_beli) || 0) * p) / 100),
          );
        }
        return baru;
      }),
    );

  const bukaProdukBaru = (teks: string) => {
    const t = teks.trim();
    const tampakBarcode = t !== '' && !/\s/.test(t) && /[A-Za-z0-9]/.test(t);
    setDlgBaru({
      nama: t !== '' && /\s/.test(t) ? t : '',
      sku: '',
      harga: '',
      barcode: tampakBarcode ? t : '',
    });
  };

  const simpanProdukBaru = async () => {
    if (!dlgBaru) return;
    const nama = dlgBaru.nama.trim();
    const harga = Number(dlgBaru.harga) || 0;
    if (!nama) {
      beritahu('Nama produk wajib diisi.', 'galat');
      return;
    }
    if (!(harga > 0)) {
      beritahu('Harga beli harus lebih dari 0.', 'galat');
      return;
    }
    const sku = dlgBaru.sku.trim() || slugSku(nama);
    setSibukSimpan(true);
    try {
      const r = await apiPost<{ id: number }>('/api/master/produk', {
        nama,
        sku,
        barcode: dlgBaru.barcode.trim() || null,
        deskripsi: 'Didaftarkan cepat dari mode Biasa Pembelian',
        satuan_dasar_id: null,
        harga_beli: harga,
        harga_jual: harga * 2,
        stok_min: 0,
      });
      setDlgBaru(null);
      const rv = await apiGet<{ data: HasilProduk[] }>(
        `/api/pembelian/produk-cari?ids=${encodeURIComponent(String(r.id))}&supplier_id=${form.pemasok}&gudang_id=${form.gudang}`,
      );
      beritahu(`Produk "${nama}" terdaftar (SKU ${sku}).`);
      const baru = rv.data.find((v) => v.sku === sku) ?? rv.data[0];
      if (!baru) return;
      tambahItem(baru);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibukSimpan(false);
    }
  };

  const simpan = async () => {
    const payload = bangunPayload();
    if (!payload) return;
    setSibukSimpan(true);
    try {
      if (aktif) {
        await apiPut(`/api/pembelian/${aktif.id}`, payload);
        beritahu(`Draft ${aktif.no_dokumen} diperbarui.`);
      } else {
        await apiPost(`/api/pembelian`, payload);
        beritahu('Draft pembelian dibuat. Lanjutkan ke Terima (GRN) lalu Sahkan di daftar.');
      }
      resetForm();
      await selesaiSimpanKeRiwayat();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibukSimpan(false);
    }
  };

  // Fokus otomatis ke kolom cari: saat mode Biasa dibuka (awal halaman & ganti
  // tab metode) dan saat pemasok+gudang terisi sehingga kolom cari aktif.
  const cariAktif = !!form.pemasok && !!form.gudang;
  useEffect(() => {
    if (metode === 'biasa' && cariAktif) setFokusCari((t) => t + 1);
  }, [metode, cariAktif]);

  // Pintasan mode Biasa: F2 = kolom cari, Ctrl+Enter = Simpan Draft,
  // Delete = hapus baris terpilih (saat fokus tidak sedang di input).
  useEffect(() => {
    if (metode !== 'biasa') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        setFokusCari((t) => t + 1);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void simpan();
        return;
      }
      if (e.key === 'Delete' && barisTerpilih && !dlgBaru) {
        const el = e.target as HTMLElement | null;
        // Sel baris (Qty/Harga/Diskon) boleh memakai Delete untuk hapus baris —
        // sama dengan POS Tanpa Foto; input lain (kolom cari, form) tetap bawaan.
        if (el?.dataset?.sel !== '1') {
          const tag = el?.tagName;
          if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
        }
        const idx = items.findIndex((x) => x.kunci === barisTerpilih);
        if (idx >= 0) hapusBarisUndo(idx);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // --- scan barcode -------------------------------------------------------

  const catatScan = (teks: string) =>
    setScanAktivitas((l) => [...l.slice(-8), `${new Date().toLocaleTimeString('id-ID')} ${teks}`]);

  /** Masukkan produk hasil scan ke peta agar bisa dipilih ulang di tabel. */
  const gabungProdukScan = (v: Baris) =>
    setPetaProduk((peta) => {
      const baru = new Map(peta);
      baru.set(Number(v.id), v);
      return baru;
    });

  /** Tambah 1 box: semua isi paket masuk draft; baris box se-SKU digabung (× jumlah_box). */
  const tambahBox = (pack: Baris) =>
    setScanBaris((list) => {
      const idPack = Number(pack.id);
      const perSku = new Map<number, number>();
      for (const it of (pack.items ?? []) as Baris[]) {
        perSku.set(Number(it.product_id), Number(it.qty_per_box) || 0);
      }
      // Baris yang sudah ada: jumlah_box +1 (qty ikut naik, kecuali sudah diedit manual).
      const out = list.map((b) => {
        if (b.pack_id !== idPack) return b;
        const jumlah_box = b.jumlah_box + 1;
        const bersih = Number(b.qty) === (jumlah_box - 1) * Number(b.standar_qty ?? 0);
        const tambahan = perSku.get(Number(b.standar_product_id)) ?? 0;
        const qty = bersih ? jumlah_box * Number(b.standar_qty) : (Number(b.qty) || 0) + tambahan;
        return { ...b, jumlah_box, qty: String(qty) };
      });
      // Isi box yang belum punya baris: buat baru dengan jumlah box berjalan
      // (scan pertama = 1 box; scan berikutnya mengikuti baris yang sudah ada).
      const jumlahBox =
        out
          .filter((b) => b.pack_id === idPack)
          .reduce((m, b) => Math.max(m, b.jumlah_box), 0) || 1;
      const baru: BarisScan[] = [];
      for (const it of (pack.items ?? []) as Baris[]) {
        const vid = Number(it.product_id);
        if (out.some((b) => b.pack_id === idPack && Number(b.standar_product_id) === vid)) continue;
        baru.push({
          kunci: kunciBaris(),
          product_id: String(vid),
          unit_id: it.satuan_dasar_id ? String(it.satuan_dasar_id) : '',
          qty: String(jumlahBox * (Number(it.qty_per_box) || 0)),
          harga_beli: String(it.harga_beli ?? 0),
          diskon: '0',
          pack_id: idPack,
          pack_nama: pack.nama ?? null,
          jumlah_box: jumlahBox,
          standar_qty: Number(it.qty_per_box) || null,
          standar_product_id: vid,
          sumber: 'box',
        });
      }
      return [...out, ...baru];
    });

  /** Tambah/akumulasi 1 pcs produk satuan (scan berulang menambah jumlah). */
  const tambahSatuan = (v: Baris) =>
    setScanBaris((list) => {
      const idx = list.findIndex((b) => b.pack_id === null && Number(b.product_id) === Number(v.id));
      if (idx >= 0) {
        const out = [...list];
        out[idx] = { ...out[idx], qty: String((Number(out[idx].qty) || 0) + 1) };
        return out;
      }
      return [
        ...list,
        {
          kunci: kunciBaris(),
          product_id: String(v.id),
          unit_id: v.satuan_dasar_id ? String(v.satuan_dasar_id) : '',
          qty: '1',
          harga_beli: String(v.harga_beli ?? 0),
          diskon: '0',
          pack_id: null,
          pack_nama: null,
          jumlah_box: 0,
          standar_qty: null,
          standar_product_id: null,
          sumber: 'satuan' as const,
        },
      ];
    });

  /** Proses satu barcode: box → seluruh isi; satuan → +1 pcs; tak dikenal → dialog. */
  const prosesBarcode = async (teksMasuk?: string) => {
    const barcode = (teksMasuk ?? scanTeks).trim();
    if (!barcode) return;
    setScanProses(true);
    try {
      const r = await apiPost<{ tipe: string; barcode: string; pack: Baris | null; produk: Baris | null }>(
        '/api/pembelian/scan',
        // ISOLASI GUDANG — scan dikunci ke gudang tujuan draft; server
        // menolak barang/box yang tidak terdaftar di gudang itu (400).
        { barcode, gudang_id: Number(form.gudang) || undefined },
      );
      if (r.tipe === 'box' && r.pack) {
        for (const it of (r.pack.items ?? []) as Baris[]) {
          gabungProdukScan({
            id: it.product_id,
            sku: it.sku,
            produk: it.produk,
            harga_beli: it.harga_beli,
            satuan_dasar_id: it.satuan_dasar_id,
          });
        }
        tambahBox(r.pack);
        putarUmpanBalikScan('ok');
        catatScan(`📦 ${r.pack.nama} (${r.pack.kode_box}) — ${(r.pack.items as Baris[]).length} SKU × ${r.pack.total_pcs} pcs/box`);
        beritahu(`Box "${r.pack.nama}" masuk draft — ${r.pack.total_pcs} pcs per box.`);
      } else if (r.tipe === 'satuan' && r.produk) {
        const prd: Baris = { ...r.produk, id: r.produk.product_id };
        gabungProdukScan(prd);
        tambahSatuan(prd);
        putarUmpanBalikScan('ok');
        catatScan(`▪ ${prd.sku} — +1 pcs`);
      } else {
        putarUmpanBalikScan('gagal');
        catatScan(`✕ ${barcode} — belum terdaftar`);
        setDialogBarcode(barcode);
        setDlgMode('pilihan');
        setDlgProduk({ nama: '', sku: '', harga: '' });
        setDlgBox({ kode: '', nama: '', isi: [{ product_id: '', qty: '1' }] });
        scanInputRef.current?.focus();
        return;
      }
      setScanLog((l) => [
        ...l,
        {
          barcode,
          tipe: r.tipe,
          pack_id: r.pack ? Number(r.pack.id) : null,
          product_id: r.produk ? Number(r.produk.product_id) : null,
        },
      ]);
      setScanTeks('');
      scanInputRef.current?.focus();
    } catch (err) {
      // Gagal jaringan / ditolak server (mis. barang beda gudang) = peringatan.
      putarUmpanBalikScan('gagal');
      beritahu((err as Error).message, 'galat');
    } finally {
      setScanProses(false);
    }
  };

  /** Edit satu baris draft scan; ganti SKU menimpa satuan & harga dengan produk lain. */
  const ubahBarisScan = (kunci: string, patch: Partial<BarisScan>) =>
    setScanBaris((list) =>
      list.map((b) => {
        if (b.kunci !== kunci) return b;
        const baru: BarisScan = { ...b, ...patch };
        if (patch.product_id !== undefined && patch.product_id !== b.product_id) {
          const v = petaProduk.get(Number(patch.product_id));
          if (v) {
            baru.unit_id = v.satuan_dasar_id ? String(v.satuan_dasar_id) : '';
            baru.harga_beli = patch.harga_beli ?? String(v.harga_beli ?? 0);
          }
        }
        return baru;
      }),
    );

  const tambahBarisManual = () =>
    setScanBaris((l) => [
      ...l,
      {
        kunci: kunciBaris(),
        product_id: '',
        unit_id: '',
        qty: '1',
        harga_beli: '0',
        diskon: '0',
        pack_id: null,
        pack_nama: null,
        jumlah_box: 0,
        standar_qty: null,
        standar_product_id: null,
        sumber: 'manual',
      },
    ]);

  const resetScan = () => {
    setScanBaris([]);
    setScanLog([]);
    setScanAktivitas([]);
  };

  /** Daftarkan produk baru dari dialog barcode tak dikenal → langsung masuk draft. */
  const daftarkanProdukDlg = async () => {
    if (!dialogBarcode) return;
    const nama = dlgProduk.nama.trim();
    const harga = Number(dlgProduk.harga) || 0;
    if (!nama) {
      beritahu('Nama produk wajib diisi.', 'galat');
      return;
    }
    if (!(harga > 0)) {
      beritahu('Harga beli harus lebih dari 0.', 'galat');
      return;
    }
    const sku = dlgProduk.sku.trim() || slugSku(nama);
    setSibukSimpan(true);
    try {
      await apiPost('/api/master/produk', {
        nama,
        sku,
        barcode: dialogBarcode,
        deskripsi: `Didaftarkan dari scan barcode ${dialogBarcode}`,
        category_id: null,
        brand_id: null,
        satuan_dasar_id: null,
        harga_beli: harga,
        harga_jual: harga * 2,
        stok_min: 0,
      });
      beritahu(`Produk "${nama}" terdaftar — barcode ${dialogBarcode} kini milik SKU ${sku}.`);
      await muatProduk('');
      const kode = dialogBarcode;
      setDialogBarcode(null);
      await prosesBarcode(kode);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibukSimpan(false);
    }
  };

  /** Daftarkan barcode tak dikenal sebagai box (paket) baru → scan langsung mengembang isi box. */
  const daftarkanBoxDlg = async () => {
    if (!dialogBarcode) return;
    const items = dlgBox.isi
      .filter((x) => x.product_id)
      .map((x) => ({ product_id: Number(x.product_id), qty: Number(x.qty) || 1 }));
    if (!dlgBox.kode.trim() || !dlgBox.nama.trim()) {
      beritahu('Kode & nama box wajib diisi.', 'galat');
      return;
    }
    if (items.length === 0) {
      beritahu('Isi box minimal 1 produk.', 'galat');
      return;
    }
    setSibukSimpan(true);
    try {
      await apiPost('/api/master/paket', {
        kode_box: dlgBox.kode.trim(),
        barcode_box: dialogBarcode,
        nama: dlgBox.nama.trim(),
        items,
      });
      beritahu(`Box "${dlgBox.nama.trim()}" terdaftar (${items.length} SKU) — barcode ${dialogBarcode} kini membuka box ini.`);
      const kode = dialogBarcode;
      setDialogBarcode(null);
      await prosesBarcode(kode);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibukSimpan(false);
    }
  };

  const payloadScan = () => {
    const [y, m, d] = form.tanggal.split('-').map(Number);
    const tanggal = new Date(y || new Date().getFullYear(), (m || 1) - 1, d || 1, 12).toISOString();
    return {
      metode_input: 'scan',
      supplier_id: Number(form.pemasok),
      warehouse_id: Number(form.gudang),
      tanggal,
      no_po: form.no_po.trim() || null,
      pajak_persen: Number(form.pajak) || 0,
      items: scanBaris.map((b) => ({
        product_id: Number(b.product_id),
        qty: Number(b.qty),
        unit_id: b.unit_id ? Number(b.unit_id) : null,
        harga_beli: Number(b.harga_beli) || 0,
        diskon: Number(b.diskon) || 0,
        pack_id: b.pack_id,
        sumber_scan: b.sumber,
      })),
      scan_logs: scanLog,
    };
  };

  /** Simpan sebagai draft (PO) — tanpa pengesahan, stok belum bergerak. */
  const simpanDraftScan = async () => {
    if (!scanValid) return;
    setSibukSimpan(true);
    try {
      const r = await apiPost<{ data: Baris }>('/api/pembelian', payloadScan());
      beritahu(`Draft ${r.data.no_dokumen} tersimpan dari hasil scan.`);
      resetScan();
      await muat();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibukSimpan(false);
    }
  };

  /** Sahkan & masukkan stok: draft → Terima (GRN) → Sahkan (faktur) dalam satu langkah. */
  const sahkanScan = async () => {
    if (!scanValid) return;
    setSibukSimpan(true);
    try {
      const r = await apiPost<{ data: Baris }>('/api/pembelian', payloadScan());
      await apiPost(`/api/pembelian/${r.data.id}/terima`, {});
      await apiPost(`/api/pembelian/${r.data.id}/sahkan`, {});
      const pcs = totalPcsBox + totalSatuan;
      beritahu(
        `${r.data.no_dokumen} disahkan — stok masuk gudang${totalBox ? ` (${totalBox} box · ${pcs} pcs)` : ` (${pcs} pcs)`}.`,
      );
      resetScan();
      await selesaiSimpanKeRiwayat();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibukSimpan(false);
    }
  };


  // Scanner USB: fokuskan kotak scan otomatis bila ketikan datang dari luar input.
  useEffect(() => {
    if (metode !== 'scan') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable))
        return;
      scanInputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [metode]);

  useEffect(() => {
    if (metode === 'scan') scanInputRef.current?.focus();
  }, [metode]);

  // ↑/↓ di bilah tab: serahkan fokus ke tab tujuan SETELAH autofocus bawaan
  // mode tujuan (mis. input Scan) selesai — agar ↑/↓ bisa ditekan beruntun.
  useEffect(() => {
    const kode = tabNavigasi.current;
    if (!kode || kode !== metode) return;
    tabNavigasi.current = null;
    tabRefs.current[kode]?.focus();
  }, [metode]);

  // --- modal aksi ---------------------------------------------------------
  const bukaModal = async (m: 'terima' | 'sahkan' | 'lihat' | 'batal', b: Baris) => {
    setModalAktif(b);
    setDetail(null);
    setMode(m);
    setAlasanBatal('');
    setNoFaktur('');
    setJatuhTempo('');
    setRiwayatPindai([]);
    try {
      const r = await apiGet<{ data: Baris }>(`/api/pembelian/${b.id}`);
      setDetail(r.data);
      if (m === 'lihat') {
        const rp = await apiGet<{ data: Baris[] }>(`/api/pembelian/${b.id}/riwayat-input`).catch(() => ({ data: [] as Baris[] }));
        setRiwayatPindai(rp.data);
      }
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    }
  };

  const konfirmasiTerima = async () => {
    if (!modalAktif || sibukModal || aksiRef.current) return;
    aksiRef.current = true;
    setSibukModal(true);
    try {
      // GRN menerima harga Rp 0 apa adanya — pencatatan persediaan/jurnal
      // penuh baru diproses saat pengesahan faktur.
      await apiPost(`/api/pembelian/${modalAktif.id}/terima`, {});
      beritahu(`${modalAktif.no_dokumen} diterima (GRN) — stok & jurnal menyusul saat pengesahan.`);
      setMode(null);
      // Refresh daftar best-effort: kegagalannya tidak boleh menutupi sukses.
      try {
        await muat();
      } catch (e) {
        console.error('[Pembelian] muat() setelah terima gagal:', e);
      }
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      aksiRef.current = false;
      setSibukModal(false);
    }
  };

  const konfirmasiSahkan = async () => {
    if (!modalAktif || sibukModal || aksiRef.current) return;
    aksiRef.current = true;
    setSibukModal(true);
    try {
      const r = await apiPost<{ faktur?: { id: number; no_faktur: string } | null }>(
        `/api/pembelian/${modalAktif.id}/sahkan`,
        {
          no_faktur: noFaktur.trim() || undefined,
          jatuh_tempo: jatuhTempo || undefined,
        },
      );
      beritahu(`${modalAktif.no_dokumen} disahkan — stok masuk, jurnal persediaan/hutang & faktur tercatat.`);
      // BAGIAN I4: dialog sukses memperlihatkan ikon aksi faktur.
      if (r.faktur) {
        setFakturBaru({
          ...r.faktur,
          total: Number(modalAktif.total ?? 0),
          tanggal: String(modalAktif.tanggal ?? new Date().toISOString()),
          pemasokNama: String(modalAktif.pemasok_nama ?? modalAktif.supplier_nama ?? ''),
        });
      }
      setMode(null);
      // Refresh daftar best-effort: kegagalannya tidak boleh menutupi sukses.
      try {
        await muat();
      } catch (e) {
        console.error('[Pembelian] muat() setelah sahkan gagal:', e);
      }
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      aksiRef.current = false;
      setSibukModal(false);
    }
  };

  const konfirmasiBatal = async () => {
    if (!modalAktif || sibukModal || aksiRef.current) return;
    if (modalAktif.status === 'disahkan' && !alasanBatal.trim()) {
      beritahu('Alasan pembatalan wajib diisi.', 'galat');
      return;
    }
    aksiRef.current = true;
    setSibukModal(true);
    try {
      await apiPost(`/api/pembelian/${modalAktif.id}/batal`, { alasan: alasanBatal });
      beritahu(
        modalAktif.status === 'disahkan'
          ? `${modalAktif.no_dokumen} dibatalkan — stok, jurnal & hutang dipulihkan.`
          : `${modalAktif.no_dokumen} dibatalkan.`,
      );
      setMode(null);
      // Refresh daftar best-effort: kegagalannya tidak boleh menutupi sukses.
      try {
        await muat();
      } catch (e) {
        console.error('[Pembelian] muat() setelah batal gagal:', e);
      }
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      aksiRef.current = false;
      setSibukModal(false);
    }
  };

  /** AW3 — Buat draft baru dari dokumen (nomor baru, tidak menggandakan). */
  const salinDraft = async (b: Baris) => {
    try {
      const r = await apiPost<{ id: number }>(`/api/pembelian/${b.id}/salin`, {});
      beritahu(`Draft baru dibuat dari ${b.no_dokumen}.`);
      await muat();
      void r;
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    }
  };

  const t = hitung();
  const tScan = hitungDari(scanBaris);

  /** Baris box yang disesuaikan (qty/produk beda dari komposisi standar box). */
  const barisBedaKini = (b: BarisScan): boolean => barisBeda(b);

  /** Ringkasan per box: jumlah box & total pcs per paket + penanda beda komposisi. */
  const ringkasBox = (() => {
    const peta = new Map<number, { pack_id: number; nama: string; jumlah_box: number; pcs: number; beda: boolean }>();
    for (const b of scanBaris) {
      if (!b.pack_id || b.standar_qty === null) continue;
      const r =
        peta.get(b.pack_id) ??
        { pack_id: b.pack_id, nama: b.pack_nama ?? `Box #${b.pack_id}`, jumlah_box: 0, pcs: 0, beda: false };
      r.jumlah_box = Math.max(r.jumlah_box, b.jumlah_box);
      r.pcs += Number(b.qty) || 0;
      if (barisBedaKini(b)) r.beda = true;
      peta.set(b.pack_id, r);
    }
    return [...peta.values()];
  })();
  const totalBox = ringkasBox.reduce((n, r) => n + r.jumlah_box, 0);
  const totalPcsBox = ringkasBox.reduce((n, r) => n + r.pcs, 0);
  const totalSatuan = scanBaris.filter((b) => b.pack_id === null).reduce((n, b) => n + (Number(b.qty) || 0), 0);

  /** Draft valid: tiap baris punya SKU, jumlah > 0, tak ada produk kembar dalam satu paket. */
  const adaDuplikat = (() => {
    const set = new Set<string>();
    for (const b of scanBaris) {
      const k = `${b.product_id}|${b.pack_id ?? -1}`;
      if (set.has(k)) return true;
      set.add(k);
    }
    return false;
  })();
  const scanValid =
    scanBaris.length > 0 &&
    !adaDuplikat &&
    scanBaris.every((b) => b.product_id && Number(b.qty) > 0 && Number(b.harga_beli) >= 0) &&
    !!form.pemasok &&
    !!form.gudang;
  const metodeAktif = METODE.find((m) => m.kode === metode) ?? METODE[0];

  /** Semua produk terurut untuk select SKU scan & dialog pendaftaran box. */
  const opsiScan = [...petaProduk.values()].sort((x, y) => labelProduk(x).localeCompare(labelProduk(y)));

  /** Header form bersama (metode Biasa & Scan): pemasok, gudang, tanggal, PO, pajak. */
  /**
   * Ganti gudang tujuan: stok tiap baris yang sudah ada disesuaikan ke stok
   * gudang baru (qty & harga tidak diubah). Autocomplete ikut memakai gudang
   * baru lewat `posisi` CariBarang (efek debounce me-query ulang otomatis).
   */
  const gantiGudang = (idBaru: string) => {
    setForm({ ...form, gudang: idBaru });
    const ids = items.map((x) => x.product_id).filter(Boolean);
    if (!idBaru || ids.length === 0) return;
    apiGet<{ data: HasilProduk[] }>(
      `/api/pembelian/produk-cari?ids=${encodeURIComponent(ids.join(','))}&supplier_id=${encodeURIComponent(form.pemasok)}&gudang_id=${encodeURIComponent(idBaru)}`,
    )
      .then((rv) => {
        const peta = new Map(rv.data.map((h) => [String(h.product_id), h]));
        setItems((lama) =>
          lama.map((b) => {
            const h = peta.get(b.product_id);
            return h ? { ...b, stok: h.stok } : b;
          }),
        );
      })
      .catch(() => undefined);
  };

  const kepalaForm = () => (
    <div className="form-grid form-grid--kepala5" style={{ marginTop: 10 }}>
      <label className="bidang">
        <span>Pemasok *</span>
        <select value={form.pemasok} onChange={(e) => setForm({ ...form, pemasok: e.target.value })}>
          <option value="">— Pilih pemasok —</option>
          {opsiPemasok.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="bidang" title={gudangTerkunci !== null ? TIP_GUDANG_TERKUNCI : undefined}>
        <span>Gudang tujuan *{gudangTerkunci !== null ? ' 🔒' : ''}</span>
        <select
          value={form.gudang}
          onChange={(e) => gantiGudang(e.target.value)}
          disabled={gudangTerkunci !== null && !aktif}
        >
          <option value="">— Pilih gudang —</option>
          {opsiGudang.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="bidang">
        <span>Tanggal *</span>
        <input type="date" value={form.tanggal} onChange={(e) => setForm({ ...form, tanggal: e.target.value })} />
      </label>
      <label className="bidang">
        <span>No. PO (opsional)</span>
        <input
          type="text"
          value={form.no_po}
          onChange={(e) => setForm({ ...form, no_po: e.target.value })}
          placeholder="Referensi PO suplier"
          maxLength={60}
        />
      </label>
      <label className="bidang">
        <span>Pajak (%)</span>
        <input
          type="number"
          min={0}
          max={100}
          step="any"
          value={form.pajak}
          onChange={(e) => setForm({ ...form, pajak: e.target.value })}
        />
      </label>
    </div>
  );

  /* Form input dikunci setinggi viewport (tanpa scroll luar): hanya tabel
     item yang menggulir di dalam; riwayat/dokumen tetap menggulir normal. */
  // Garda navigasi: cegah item/draft belum disimpan hilang saat pindah modul.
  const kotorRef = useRef(false);
  kotorRef.current =
    tabAktif === 'input' &&
    (items.length > 0 || scanBaris.length > 0 || form.pemasok !== '' || form.gudang !== '');
  const simpanGarda = async () => {
    if (metode === 'scan') await simpanDraftScan();
    else await simpan();
  };
  const buangGarda = () => {
    resetForm();
    resetScan();
  };
  const { garda } = useGardaForm({
    aktif: kotorRef.current,
    simpan: simpanGarda,
    masihKotor: () => kotorRef.current,
    buang: buangGarda,
  });

  const kunciForm = tabAktif === 'input';
  return (
    <div className={kunciForm ? 'halaman halaman--fit' : 'halaman'}>
      {/* ============ Satu kartu terpadu: header + token + isi ============ */}
      <section className={kunciForm ? 'kartu kartu--transaksi-fit' : 'kartu'}>
        <div className="tokenbar kepala-kartu">
        <div>
          <h3>Modul Pembelian</h3>
          <p className="teks-redup teks-kecil">
            Kelola formulir transaksi, riwayat pembelian, dan cetak dokumen faktur.
          </p>
        </div>
        {/* Kanan header: switcher metode (khusus tab Input) di kiri token utama. */}
        <div className="tokenbar-kanan">
        {tabAktif === 'input' && (
        <div
          className="metode-pilih"
          role="tablist"
          aria-label="Metode input pembelian"
          onKeyDown={(e) => {
            const i = METODE.findIndex((m) => m.kode === metode);
            if (i < 0) return;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              // Perpindahan antar tab mode hanya dengan ↑/↓ (bukan Tab, bukan ←/→).
              e.preventDefault();
              const n = (i + (e.key === 'ArrowDown' ? 1 : METODE.length - 1)) % METODE.length;
              const kode = METODE[n].kode;
              tabNavigasi.current = kode;
              setMetode(kode);
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
            }
          }}
        >
          {METODE.map((m) => (
            <button
              key={m.kode}
              ref={(el) => {
                tabRefs.current[m.kode] = el;
              }}
              type="button"
              role="tab"
              tabIndex={metode === m.kode ? 0 : -1}
              aria-selected={metode === m.kode}
              aria-label={m.title}
              title={m.title}
              className={`metode-pilih__tombol ${metode === m.kode ? 'metode-pilih__tombol--aktif' : ''}`}
              onClick={() => setMetode(m.kode)}
            >
              <Icon nama={m.ikon} size={16} />
              <span className="metode-pilih__label">{m.label}</span>
            </button>
          ))}
        </div>
        )}
        <div className="token-grup" role="tablist" aria-label="Navigasi modul pembelian">
          <button
            type="button"
            role="tab"
            aria-selected={tabAktif === 'input'}
            className={`token${tabAktif === 'input' ? ' token--aktif' : ''}`}
            onClick={() => pilihTab('input')}
            title="Input Pembelian"
            aria-label="Input Pembelian"
          >
            <Icon nama="plus" size={16} />
            <span>Input Pembelian</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tabAktif === 'riwayat'}
            className={`token${tabAktif === 'riwayat' ? ' token--aktif' : ''}`}
            onClick={() => pilihTab('riwayat')}
            title="Riwayat Transaksi"
            aria-label="Riwayat Transaksi"
          >
            <Icon nama="menu" size={16} />
            <span>Riwayat Transaksi</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tabAktif === 'dokumen'}
            className={`token${tabAktif === 'dokumen' ? ' token--aktif' : ''}`}
            onClick={() => pilihTab('dokumen')}
            title="Dokumen (Faktur)"
            aria-label="Dokumen (Faktur)"
          >
            <Icon nama="faktur" size={16} />
            <span>Dokumen (Faktur)</span>
          </button>
        </div>
        </div>
        </div>
      {/* ============ TAMPILAN 1: Input Pembelian ============ */}
      {tabAktif === 'input' && (
      <>

        {metode === 'biasa' ? (            <div className="form-beli">
              {aktif && (
                <h4 className="bagian-judul">Ubah {String(aktif.no_dokumen ?? '')} — nomor tetap, perubahan tercatat di log</h4>
              )}
              <p className="teks-redup teks-kecil">{metodeAktif.ket}</p>

              {kepalaForm()}
            {opsiPemasok.length === 0 && (
              <p className="teks-redup teks-kecil">Belum ada pemasok — buat dulu di Master › Pemasok.</p>
            )}

            <h4 className="bagian-judul">Item pembelian</h4>

            <div className="transaksi-grid">
            <div className="transaksi-utama">
            <div className="keranjang-kepala">
              <CariBarang
                posisi={{ supplier_id: form.pemasok, gudang_id: form.gudang }}
                aktif={!!form.pemasok && !!form.gudang}
                fokusToken={fokusCari}
                onPilih={tambahItem}
                onProdukBaru={bukaProdukBaru}
                onTanggaBawah={() => {
                  if (items.length > 0) fokusSel(0, 0);
                }}
              />
              <span className="keranjang-ringkas">
                <strong>{items.length}</strong> jenis item ·{' '}
                <strong>{formatAngka(items.reduce((a, x) => a + (Number(x.qty) || 0), 0))}</strong> total qty
              </span>
            </div>

            {undoHapus && (
              <div className="baris-undo" role="status">
                <span>
                  Baris <strong>{undoHapus.baris.nama}</strong> dihapus.
                </span>
                <button type="button" className="tombol tombol--kecil" onClick={urungkanHapus}>
                  Urungkan (5 detik)
                </button>
              </div>
            )}

            {items.length === 0 ? (
              <p className="keranjang-kosong">Ketik atau scan barang untuk mulai.</p>
            ) : (
              <div className="tabel-bungkus">
                <table className="tabel tabel--item-beli tabel--keranjang tabel-transaksi">
                  <thead>
                    <tr>
                      <th className="rata-tengah" style={{ width: 44 }}>
                        No
                      </th>
                      <th style={{ width: '15%' }}>Kode Item / SKU</th>
                      <th style={{ width: '25%' }}>Nama Produk</th>
                      <th className="rata-kanan">Jumlah</th>
                      <th>Satuan</th>
                      <th className="rata-kanan">Harga Beli</th>
                      <th className="rata-kanan">Diskon</th>
                      <th className="rata-kanan">Subtotal</th>
                      <th className="rata-tengah">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => {
                      const nilai = (Number(it.qty) || 0) * (Number(it.harga_beli) || 0);
                      const sub = nilai - (Number(it.diskon) || 0);
                      return (
                        <tr
                          key={it.kunci}
                          className={`${barisSorot === it.kunci ? 'baris-sorot' : ''}${barisTerpilih === it.kunci ? ' baris-aktif' : ''}`}
                          onMouseDown={() => setBarisTerpilih(it.kunci)}
                        >
                          <td className="rata-tengah" data-label="No">
                            {idx + 1}
                          </td>
                          <td className="teks-kecil" data-label="Kode">
                            {it.kode}
                          </td>
                          <td data-label="Produk">
                            {it.nama}
                          </td>
                          <td className="rata-kanan" data-label="Jumlah">
                            {/* Tanpa tombol +/−: Qty diganti hanya dengan tombol angka
                                (koma bila satuan mengizinkan desimal). */}
                            <input
                              ref={(el) => {
                                if (el) kolomRefs.current.set(kunciKolom(it.kunci, 0), el);
                              }}
                              className="input-angka input-qty"
                              type="text"
                              inputMode={bolehDesimal(it) ? 'decimal' : 'numeric'}
                              data-sel="1"
                              name="qty"
                              value={qtyTeks[it.kunci] ?? it.qty}
                              onFocus={(e) => {
                                qtySebelum.current[it.kunci] = it.qty;
                                setBarisTerpilih(it.kunci);
                                qtyBlok.current.add(it.kunci); // angka terblok
                                e.target.select();
                              }}
                              onChange={(e) => {
                                let v = e.target.value.replace(/[^\d.,]/g, '');
                                if ((v.includes(',') || v.includes('.')) && !bolehDesimal(it)) {
                                  v = v.replace(/[.,]/g, ''); // satuan utuh: koma ditolak
                                } else {
                                  v = v.replace(/\./g, ',');
                                  const ik = v.indexOf(',');
                                  if (ik >= 0) v = v.slice(0, ik + 1) + v.slice(ik + 1).replace(/,/g, '');
                                }
                                setQtyTeks((s) => ({ ...s, [it.kunci]: v }));
                                const n = Number(v.replace(',', '.'));
                                if (v.trim() && Number.isFinite(n) && n > 0) ubahItem(it.kunci, { qty: String(n) });
                              }}
                              onBlur={() => commitQty(it.kunci)}
                              onKeyDown={(e) => {
                                // Blok angka: ketikan angka PERTAMA menggantikan seluruh isi,
                                // sehingga tidak bergantung pada seleksi browser.
                                if (qtyBlok.current.has(it.kunci) && !e.ctrlKey && !e.metaKey && !e.altKey) {
                                  if (/^[0-9]$/.test(e.key)) {
                                    e.preventDefault();
                                    qtyBlok.current.delete(it.kunci);
                                    setQtyTeks((s) => ({ ...s, [it.kunci]: e.key }));
                                    if (Number(e.key) > 0) ubahItem(it.kunci, { qty: e.key });
                                    return;
                                  }
                                  if (e.key === 'Backspace' || e.key === 'Delete') {
                                    e.preventDefault();
                                    qtyBlok.current.delete(it.kunci);
                                    setQtyTeks((s) => ({ ...s, [it.kunci]: '' }));
                                    return;
                                  }
                                  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
                                    qtyBlok.current.delete(it.kunci); // geser kursor = blok lepas
                                  }
                                }
                                if (!bolehDesimal(it) && (e.key === ',' || e.key === '.')) {
                                  e.preventDefault(); // satuan utuh tidak boleh desimal
                                  return;
                                }
                                onKunciSel(e, idx, 0);
                              }}
                              aria-label={`Jumlah ${it.nama}`}
                            />
                          </td>
                          <td data-label="Satuan">
                            <select
                              ref={(el) => {
                                if (el) kolomRefs.current.set(kunciKolom(it.kunci, 1), el);
                              }}
                              value={it.unit_id}
                              onChange={(e) => ubahItem(it.kunci, { unit_id: e.target.value })}
                              onFocus={() => setBarisTerpilih(it.kunci)}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                  e.preventDefault();
                                  keKolomCari();
                                }
                              }}
                              data-sel="1"
                              aria-label={`Satuan ${it.nama}`}
                            >
                              {it.satuan_opsi.length === 0 && <option value="">— Satuan —</option>}
                              {it.satuan_opsi.map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="rata-kanan" data-label="Harga Beli">
                            <input
                              ref={(el) => {
                                if (el) kolomRefs.current.set(kunciKolom(it.kunci, 2), el);
                              }}
                              className="input-angka input-ribuan"
                              inputMode="numeric"
                              data-sel="1"
                              value={formatAngka(Number(it.harga_beli) || 0)}
                              onChange={(e) => ubahItem(it.kunci, { harga_beli: e.target.value.replace(/\D/g, '') })}
                              onFocus={(e) => {
                                setBarisTerpilih(it.kunci);
                                e.target.select();
                              }}
                              onKeyDown={(e) => onKunciSel(e, idx, 2)}
                              aria-label={`Harga beli ${it.nama}`}
                            />
                          </td>
                          <td className="rata-kanan" data-label="Diskon">
                            <div className="diskon-kontrol">
                              <input
                                ref={(el) => {
                                  if (el) kolomRefs.current.set(kunciKolom(it.kunci, 3), el);
                                }}
                                className="input-angka"
                                inputMode="numeric"
                                data-sel="1"
                                value={
                                  it.diskon_mode === 'persen'
                                    ? it.diskon_persen
                                    : formatAngka(Number(it.diskon) || 0)
                                }
                                onChange={(e) => {
                                  const v = e.target.value.replace(/\D/g, '');
                                  ubahItem(it.kunci, it.diskon_mode === 'persen' ? { diskon_persen: v } : { diskon: v });
                                }}
                                onFocus={(e) => {
                                  setBarisTerpilih(it.kunci);
                                  e.target.select();
                                }}
                                onKeyDown={(e) => onKunciSel(e, idx, 3)}
                                aria-label={`Diskon ${it.nama}`}
                              />
                              <select
                                value={it.diskon_mode}
                                onChange={(e) =>
                                  ubahItem(
                                    it.kunci,
                                    e.target.value === 'persen'
                                      ? { diskon_mode: 'persen', diskon_persen: '0', diskon: '0' }
                                      : { diskon_mode: 'rp', diskon_persen: '' },
                                  )
                                }
                                aria-label={`Mode diskon ${it.nama}`}
                              >
                                <option value="rp">Rp</option>
                                <option value="persen">%</option>
                              </select>
                            </div>
                          </td>
                          <td className="rata-kanan whitespace-nowrap" data-label="Subtotal">
                            {formatRupiah(sub)}
                          </td>
                          <td className="rata-tengah" data-label="Aksi">
                            <button
                              type="button"
                              className="tombol tombol--kecil tombol--bahaya"
                              onClick={() => {
                                const idx = items.findIndex((x) => x.kunci === it.kunci);
                                if (idx >= 0) hapusBarisUndo(idx);
                              }}
                            >
                              Hapus
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            </div>
            <div className="transaksi-ringkas">
            <div className="ringkas-beli">
              <div className="ringkas-beli__baris">
                <span>Subtotal</span>
                <strong>{formatRupiah(t.subtotal)}</strong>
              </div>
              <div className="ringkas-beli__baris">
                <span>Diskon item</span>
                <strong>− {formatRupiah(t.diskon)}</strong>
              </div>
              <div className="ringkas-beli__baris">
                <span>Dasar (sebelum pajak)</span>
                <strong>{formatRupiah(t.dasar)}</strong>
              </div>
              <div className="ringkas-beli__baris">
                <span>Pajak ({formatAngka(Number(form.pajak) || 0)}%)</span>
                <strong>{formatRupiah(t.pajak)}</strong>
              </div>                <div className="ringkas-beli__total">
                <span>Total</span>
                <strong>{formatRupiah(t.total)}</strong>
              </div>
            </div>
            </div>

            <div className="tombol-baris transaksi-aksi" style={{ marginTop: 12 }} data-tur="simpan-beli">
              <button
                type="button"
                className="tombol tombol--primer"
                onClick={() => void simpan()}
                disabled={sibukSimpan || items.length === 0}
                // AH1c — tombol nonaktif tetap terbaca + alasannya jelas.
                title={
                  sibukSimpan
                    ? 'Menyimpan draft…'
                    : items.length === 0
                      ? !form.pemasok || !form.gudang
                        ? 'Pilih pemasok & gudang dulu'
                        : 'Tambahkan minimal satu barang dulu'
                      : undefined
                }
              >
                {sibukSimpan ? 'Menyimpan…' : aktif ? 'Simpan Perubahan' : 'Simpan Draft (PO)'}
              </button>
              {aktif && (
                <button type="button" className="tombol tombol--netral" onClick={resetForm} disabled={sibukSimpan}>
                  Batal Ubah
                </button>
              )}
              <span className="teks-redup teks-kecil">
                Draft belum menggerakkan stok — stok & jurnal dibuat saat faktur disahkan. (Ctrl+Enter = simpan · F2 =
                kolom cari)
              </span>
            </div>

            </div>

            {dlgBaru && (
              <Modal
                judul="Produk Baru Cepat"
                lebar="kecil"
                onTutup={() => setDlgBaru(null)}
                sedangKirim={sibukSimpan}
                aksi={
                  <>
                    <button type="button" className="tombol tombol--netral" onClick={() => setDlgBaru(null)}>
                      Batal
                    </button>
                    <button
                      type="button"
                      className="tombol tombol--primer"
                      onClick={() => void simpanProdukBaru()}
                      disabled={sibukSimpan}
                    >
                      {sibukSimpan ? 'Mendaftarkan…' : 'Daftarkan & Tambahkan'}
                    </button>
                  </>
                }
              >
                {dlgBaru.barcode && (
                  <p className="teks-redup teks-kecil">
                    Barcode <code>{dlgBaru.barcode}</code> belum terdaftar — daftarkan sebagai barcode produk baru ini,
                    atau kelola lengkapnya di Master › Barang.
                  </p>
                )}
                <div className="form-grid">
                  <label className="bidang">
                    <span>Nama produk *</span>
                    <input
                      value={dlgBaru.nama}
                      onChange={(e) => setDlgBaru({ ...dlgBaru, nama: e.target.value })}
                      placeholder="mis. Kaos Polos Hitam"
                    />
                  </label>
                  <label className="bidang">
                    <span>SKU</span>
                    <input
                      value={dlgBaru.sku}
                      onChange={(e) => setDlgBaru({ ...dlgBaru, sku: e.target.value })}
                      placeholder="otomatis dari nama bila kosong"
                    />
                  </label>
                  <label className="bidang">
                    <span>Harga beli *</span>
                    <input
                      type="number"
                      min={0}
                      value={dlgBaru.harga}
                      onChange={(e) => setDlgBaru({ ...dlgBaru, harga: e.target.value })}
                      placeholder="mis. 45000"
                    />
                  </label>
                  <label className="bidang">
                    <span>Barcode</span>
                    <input
                      value={dlgBaru.barcode}
                      onChange={(e) => setDlgBaru({ ...dlgBaru, barcode: e.target.value })}
                      placeholder="opsional — dari kolom cari"
                    />
                  </label>
                </div>
                <p className="teks-redup teks-kecil">
                  Produk didaftarkan via Master Data, lalu langsung masuk daftar item.
                </p>
              </Modal>
            )}
          </div>
        ) : metode === 'scan' ? (            <div className="scan-panel">
              <p className="teks-redup teks-kecil">{metodeAktif.ket}</p>
              {kepalaForm()}
            {opsiPemasok.length === 0 && (
              <p className="teks-redup teks-kecil">Belum ada pemasok — buat dulu di Master › Pemasok.</p>
            )}

            <div className="scan-baris-input">
              <input
                ref={scanInputRef}
                className="scan-input"
                value={scanTeks}
                onChange={(e) => setScanTeks(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void prosesBarcode();
                  }
                }}
                placeholder="Pindai barcode (scanner USB / ketik manual) lalu Enter…"
                aria-label="Barcode"
                disabled={scanProses}
                autoFocus
              />
              <button
                type="button"
                className="tombol tombol--primer"
                onClick={() => void prosesBarcode()}
                disabled={scanProses || !scanTeks.trim()}
              >
                {scanProses ? 'Memproses…' : 'Proses'}
              </button>
              <button type="button" className="tombol" onClick={() => setPindai(true)} disabled={scanProses}>
                📷 Kamera HP
              </button>
            {pindai && (
              <ScanKamera
                judul="Pindai barcode pembelian"
                mode="berkelanjutan"
                onHasil={(t) => void prosesBarcode(t)}
                onTutup={() => setPindai(false)}
              />
            )}
            </div>

            {scanAktivitas.length > 0 && (
              <ul className="scan-aktivitas">
                {[...scanAktivitas].reverse().map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            )}

            {ringkasBox.length > 0 && (
              <div className="scan-ringkasan">
                {ringkasBox.map((r) => (
                  <span key={r.pack_id} className={`scan-box-chip${r.beda ? ' scan-box-chip--beda' : ''}`}>
                    📦 {r.nama} — {r.jumlah_box} box · {r.pcs} pcs{r.beda ? ' · ⚠ disesuaikan' : ''}
                  </span>
                ))}
                <span className="scan-box-chip scan-box-chip--total">
                  Total: {totalBox} box · {totalPcsBox + totalSatuan} pcs
                  {ringkasBox.length > 0 && totalSatuan > 0 ? ` (termasuk ${totalSatuan} satuan)` : ''}
                </span>
              </div>
            )}

            <div className="transaksi-grid">
            <div className="transaksi-utama">
            {scanBaris.length === 0 ? (
              <div className="scan-kosong">
                Belum ada hasil scan. Pindai <strong>barcode box</strong> (seluruh isi box masuk draft) atau{' '}
                <strong>barcode produk satuan</strong> (1 pcs per scan) — scanner USB langsung mengetik ke kotak di
                atas, atau pakai tombol 📷 untuk kamera HP.
              </div>
            ) : (
              <div className="tabel-bungkus">
                <table className="tabel tabel--item-beli tabel--scan tabel-transaksi">
                  <thead>
                    <tr>
                      <th>SKU *</th>
                      <th className="rata-kanan">Jumlah *</th>
                      <th className="rata-kanan">Harga beli *</th>
                      <th className="rata-kanan">Diskon</th>
                      <th>Asal</th>
                      <th className="rata-kanan">Subtotal</th>
                      <th className="rata-tengah">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scanBaris.map((b) => {
                      const beda = barisBedaKini(b);
                      const sub = (Number(b.qty) || 0) * (Number(b.harga_beli) || 0) - (Number(b.diskon) || 0);
                      return (
                        <Fragment key={b.kunci}>
                          <tr className={beda ? 'baris-waspadai' : ''}>
                            <td>
                              <select
                                value={b.product_id}
                                onChange={(e) => ubahBarisScan(b.kunci, { product_id: e.target.value })}
                                aria-label="SKU"
                              >
                                <option value="">— Pilih SKU —</option>
                                {opsiScan.map((o) => (
                                  <option key={o.id} value={o.id}>
                                    {labelProduk(o)}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <input
                                className="input-angka"
                                type="number"
                                min={0}
                                step="any"
                                value={b.qty}
                                onChange={(e) => ubahBarisScan(b.kunci, { qty: e.target.value })}
                                name="qty"
                                aria-label="Jumlah"
                              />
                            </td>
                            <td>
                              <input
                                className="input-angka"
                                type="number"
                                min={0}
                                step="any"
                                value={b.harga_beli}
                                onChange={(e) => ubahBarisScan(b.kunci, { harga_beli: e.target.value })}
                                aria-label="Harga beli"
                              />
                            </td>
                            <td>
                              <input
                                className="input-angka"
                                type="number"
                                min={0}
                                step="any"
                                value={b.diskon}
                                onChange={(e) => ubahBarisScan(b.kunci, { diskon: e.target.value })}
                                aria-label="Diskon"
                              />
                            </td>
                            <td className="teks-kecil whitespace-nowrap">
                              {b.pack_id ? `📦 ${b.jumlah_box} box` : b.sumber === 'manual' ? '✎ Manual' : '▪ Satuan'}
                            </td>
                            <td className="rata-kanan whitespace-nowrap">{formatRupiah(sub)}</td>
                            <td className="rata-tengah">
                              <button
                                type="button"
                                className="tombol tombol--bahaya tombol--kecil"
                                onClick={() => setScanBaris((l) => l.filter((x) => x.kunci !== b.kunci))}
                              >
                                Hapus
                              </button>
                            </td>
                          </tr>
                          {beda && (
                            <tr className="baris-catatan">
                              <td colSpan={7}>
                                ⚠ Beda dari komposisi standar{b.pack_nama ? ` box "${b.pack_nama}"` : ''}:{' '}
                                {alasanBeda(b)} — boleh dibiarkan bila memang disengaja.
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            </div>
            {scanBaris.length > 0 && (
              <div className="tombol-baris transaksi-aksi" style={{ marginTop: 8 }}>
                <button type="button" className="tombol tombol--kecil" onClick={tambahBarisManual}>
                  + Tambah baris manual
                </button>
                <button type="button" className="tombol tombol--kecil tombol--netral" onClick={resetScan}>
                  Kosongkan draft scan
                </button>
              </div>
            )}
            {scanBaris.length > 0 && (
              <div className="transaksi-ringkas">
                <div className="ringkas-beli">
                  <div className="ringkas-beli__baris">
                    <span>Baris draft</span>
                    <strong>{scanBaris.length}</strong>
                  </div>
                  <div className="ringkas-beli__baris">
                    <span>Box · pcs</span>
                    <strong>
                      {totalBox} box · {totalPcsBox + totalSatuan} pcs
                    </strong>
                  </div>
                  <div className="ringkas-beli__baris">
                    <span>Total diskon</span>
                    <strong>{formatRupiah(tScan.diskon)}</strong>
                  </div>
                  <div className="ringkas-beli__total">
                    <span>Total</span>
                    <strong>{formatRupiah(tScan.total)}</strong>
                  </div>
                </div>
              </div>
            )}

            <div className="tombol-baris transaksi-aksi" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="tombol tombol--primer"
                onClick={() => void sahkanScan()}
                disabled={!scanValid || sibukSimpan}
              >
                {sibukSimpan ? 'Memproses…' : 'Sahkan & Masukkan ke Gudang'}
              </button>
              <button
                type="button"
                className="tombol"
                onClick={() => void simpanDraftScan()}
                disabled={!scanValid || sibukSimpan}
              >
                Simpan Draft (PO) saja
              </button>
              {!scanValid ? (
                <span className="teks-redup teks-kecil">
                  Tombol sahkan aktif setelah draft valid: pemasok & gudang terpilih, minimal 1 baris dengan SKU,
                  jumlah & harga beli terisi{adaDuplikat ? ', tanpa SKU kembar dalam satu box' : ''}.
                </span>
              ) : (
                <span className="teks-redup teks-kecil">
                  "Sahkan & Masukkan ke Gudang" = Draft (PO) → Terima (GRN) → Sahkan (faktur) otomatis — stok & jurnal
                  bergerak saat itu juga.
                </span>
              )}
            </div>

            </div>

            {dialogBarcode && (
              <Modal
                judul="Barcode belum terdaftar"
                onTutup={() => setDialogBarcode(null)}
                aksi={
                  dlgMode === 'produk' ? (
                    <button
                      type="button"
                      className="tombol tombol--primer"
                      onClick={() => void daftarkanProdukDlg()}
                      disabled={sibukSimpan}
                    >
                      Daftarkan & masukkan ke draft
                    </button>
                  ) : dlgMode === 'box' ? (
                    <button
                      type="button"
                      className="tombol tombol--primer"
                      onClick={() => void daftarkanBoxDlg()}
                      disabled={sibukSimpan}
                    >
                      Daftarkan box
                    </button>
                  ) : null
                }
              >
                <p>
                  Barcode <strong>{dialogBarcode}</strong> belum terdaftar di master produk maupun paket/box.
                </p>
                {dlgMode === 'pilihan' && (
                  <div className="dialog-pilihan">
                    <button type="button" className="tombol" onClick={() => setDlgMode('produk')}>
                      🆕 Daftarkan produk baru (dengan barcode ini)
                    </button>
                    <button type="button" className="tombol" onClick={() => setDlgMode('box')}>
                      📦 Daftarkan sebagai box (paket multi-SKU)
                    </button>
                    <button type="button" className="tombol tombol--netral" onClick={() => setDialogBarcode(null)}>
                      ✖ Abaikan
                    </button>
                  </div>
                )}
                {dlgMode === 'produk' && (
                  <div className="form-grid" style={{ marginTop: 10 }}>
                    <label className="bidang">
                      <span>Nama produk *</span>
                      <input
                        value={dlgProduk.nama}
                        onChange={(e) => setDlgProduk({ ...dlgProduk, nama: e.target.value })}
                        placeholder="mis. Kaos Polos Hitam"
                      />
                    </label>
                    <label className="bidang">
                      <span>SKU</span>
                      <input
                        value={dlgProduk.sku}
                        onChange={(e) => setDlgProduk({ ...dlgProduk, sku: e.target.value })}
                        placeholder="otomatis dari nama bila kosong"
                      />
                    </label>
                    <label className="bidang">
                      <span>Harga beli *</span>
                      <input
                        type="number"
                        min={0}
                        value={dlgProduk.harga}
                        onChange={(e) => setDlgProduk({ ...dlgProduk, harga: e.target.value })}
                        placeholder="mis. 45000"
                      />
                    </label>
                    <p className="teks-redup teks-kecil" style={{ gridColumn: '1 / -1' }}>
                      Produk baru dibuat dengan barcode {dialogBarcode}, lalu otomatis ditambahkan ke draft sebagai 1
                      pcs.
                    </p>
                  </div>
                )}
                {dlgMode === 'box' && (
                  <div style={{ marginTop: 10 }}>
                    <div className="form-grid">
                      <label className="bidang">
                        <span>Kode box *</span>
                        <input
                          value={dlgBox.kode}
                          onChange={(e) => setDlgBox({ ...dlgBox, kode: e.target.value })}
                          placeholder="mis. BOX-2026-001"
                        />
                      </label>
                      <label className="bidang">
                        <span>Nama box *</span>
                        <input
                          value={dlgBox.nama}
                          onChange={(e) => setDlgBox({ ...dlgBox, nama: e.target.value })}
                          placeholder="mis. Paket Hemat Lebaran"
                        />
                      </label>
                    </div>
                    <h4 className="bagian-judul">Isi box (per 1 box)</h4>
                    {dlgBox.isi.map((it, i) => (
                      <div className="scan-box-baris" key={i}>
                        <select
                          value={it.product_id}
                          onChange={(e) =>
                            setDlgBox({
                              ...dlgBox,
                              isi: dlgBox.isi.map((x, j) => (j === i ? { ...x, product_id: e.target.value } : x)),
                            })
                          }
                        >
                          <option value="">— Pilih produk —</option>
                          {opsiScan.map((o) => (
                            <option key={o.id} value={o.id}>
                              {labelProduk(o)}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min={1}
                          className="input-angka"
                          value={it.qty}
                          placeholder="pcs/box"
                          onChange={(e) =>
                            setDlgBox({
                              ...dlgBox,
                              isi: dlgBox.isi.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)),
                            })
                          }
                        />
                        <button
                          type="button"
                          className="tombol tombol--kecil tombol--bahaya"
                          onClick={() => setDlgBox({ ...dlgBox, isi: dlgBox.isi.filter((_, j) => j !== i) })}
                          disabled={dlgBox.isi.length <= 1}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="tombol tombol--kecil"
                      onClick={() => setDlgBox({ ...dlgBox, isi: [...dlgBox.isi, { product_id: '', qty: '1' }] })}
                    >
                      + Tambah item box
                    </button>
                    <p className="teks-redup teks-kecil" style={{ marginTop: 8 }}>
                      Barcode {dialogBarcode} menjadi barcode box — scan berikutnya menambah isi box ini ke draft.
                    </p>
                  </div>
                )}
              </Modal>
            )}

          </div>
        ) : (
          <div className="metode-kerangka">
            <h4 className="bagian-judul">Metode {metodeAktif.label} — menyusul</h4>
            <p className="teks-redup">{metodeAktif.ket}</p>
            <p className="teks-redup teks-kecil">
              Metode ini memakai <strong>dokumen draft dan alur pengesahan yang sama</strong> dengan metode Biasa:
              setiap dokumen tetap melewati Draft (PO) → Terima (GRN) → Sahkan (Faktur), dan muncul di daftar di bawah.
            </p>
          </div>
        )}
      </>
      )}

      {/* ============ TAMPILAN 2: Riwayat Transaksi ============ */}
      {tabAktif === 'riwayat' && (
      <>
        <BarPeriode
          nilai={periode}
          onUbah={ubahPeriode}
          ringkasan={`Menampilkan ${labelRentang(tglDari, tglSampai)} · ${total} transaksi · ${totalDokumen} faktur`}
        />

        <section className="dok-seksi dok-seksi--riwayat" aria-label="Riwayat transaksi">
          <div className="dok-judul dok-judul--riwayat">
            <span className="dok-judul__ikon" aria-hidden="true">
              🧾
            </span>
            <h4 className="bagian-judul">Riwayat transaksi</h4>
            <span className="dok-hitung dok-hitung--riwayat">{total} transaksi</span>
          </div>
        <div className="alat-tabel">
          <div className="cari-scan">
          <input
            className="input-cari"
            type="search"
            placeholder="Cari no. dokumen / GRN / faktur / pemasok…"
            value={cari}
            onChange={(e) => {
              setCari(e.target.value);
              setHal(1);
            }}
          />
          <TombolScan onHasil={(t) => { setCari(t); setHal(1); }} />
          </div>
          <select
            className="input-pilih"
            value={filterStatus}
            onChange={(e) => {
              setFilterStatus(e.target.value);
              setHal(1);
            }}
            aria-label="Filter status"
          >
            <option value="">Semua status</option>
            {Object.entries(STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
          <select
            className="input-pilih"
            value={filterMetode}
            onChange={(e) => {
              setFilterMetode(e.target.value);
              setHal(1);
            }}
            aria-label="Filter metode"
          >
            <option value="">Semua metode</option>
            {METODE.map((m) => (
              <option key={m.kode} value={m.kode}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div ref={areaRef} className="tabel-bungkus sembunyi-hp">
          <table className="tabel">
            <thead>
              <tr>
                <th>No. dokumen</th>
                <th>Tanggal</th>
                <th>Pemasok</th>
                <th>Gudang</th>
                <th className="rata-kanan">Item</th>
                <th className="rata-kanan">Total Qty</th>
                <th className="rata-kanan">Total</th>
                <th className="rata-tengah">Status</th>
                <th className="rata-kanan">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {sibuk && data.length === 0 ? (
                <tr>
                  <td colSpan={9} className="tabel-kosong">
                    Memuat…
                  </td>
                </tr>
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={9} className="tabel-kosong">
                    Belum ada dokumen pembelian{cariTunda ? ` untuk "${cariTunda}"` : ''}.
                  </td>
                </tr>
              ) : (
                data.map((b) => {
                  const info = STATUS[b.status] ?? { label: b.status, lencana: 'lencana--netral' };
                  return (
                    <tr key={b.id}>
                      <td>
                        <code className="kode-dok kode-dok--sj">{b.no_dokumen}</code>
                        {b.no_po && <div className="teks-redup teks-kecil">PO: {b.no_po}</div>}
                        {b.no_grn && <div className="teks-redup teks-kecil">GRN: {b.no_grn}</div>}
                        {b.no_faktur && (
                          <button type="button" className="tautan-faktur" onClick={loncatDokumen} title="Lihat di tab Dokumen">
                            Faktur: <span className="kode-dok kode-dok--inv">{b.no_faktur}</span> ↓
                          </button>
                        )}
                        <div className="teks-redup teks-kecil">{METODE_LABEL[b.metode_input] ?? b.metode_input}</div>
                      </td>
                      <td className="whitespace-nowrap teks-kecil">
                        {formatTanggal(b.tanggal)}
                        {b.disahkan_pada && <div className="teks-redup">disahkan {formatTanggalWaktu(b.disahkan_pada)}</div>}
                      </td>
                      <td>{b.pemasok}</td>
                      <td className="whitespace-nowrap">
                        <strong>{b.gudang_kode}</strong>
                        <div className="teks-redup teks-kecil">{b.gudang_nama}</div>
                      </td>
                      <td className="rata-kanan">{b.jumlah_item}</td>
                      <td className="rata-kanan">{Number(b.jumlah_qty ?? 0).toLocaleString('id-ID')}</td>
                      <td className="rata-kanan">
                        <strong>{formatRupiah(Number(b.total))}</strong>
                      </td>
                      <td className="rata-tengah">
                        <span className={`lencana ${info.lencana}`}>{info.label}</span>
                      </td>
                      <td className="rata-kanan">
                        {/* Standar 2 aksi: Lihat | Batal. Alur dokumen
                            (Terima/Sahkan/Edit/Salin) pindah ke modal Detail. */}
                        <span className="aksi-baris">
                          <IconButton
                            label="Lihat detail transaksi"
                            ikon="eye"
                            ukuran="baris"
                            onClick={() => void bukaModal('lihat', b)}
                          />
                          <IconButton
                            label="Batal transaksi"
                            ikon="trash"
                            warna="bahaya"
                            ukuran="baris"
                            disabled={b.status === 'batal' || !bolehKelola || !bisa('hapus')}
                            alasan={
                              b.status === 'batal'
                                ? 'dokumen sudah dibatalkan'
                                : !bolehKelola
                                  ? 'butuh Hak Khusus Hapus transaksi'
                                  : tipIzin('hapus', 'membatalkan dokumen')
                            }
                            onClick={() => void bukaModal('batal', b)}
                          />
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* MOBILE OTOMATIS — Riwayat pembelian jadi kartu (<=767px). */}
        <div className="hp-daftar hp-daftar--riwayat">
          {sibuk && data.length === 0 ? (
            <div className="hp-kartu"><div className="hp-kartu__sub">Memuat…</div></div>
          ) : data.length === 0 ? (
            <div className="hp-kartu"><div className="hp-kartu__sub">Belum ada dokumen pembelian{cariTunda ? ` untuk "${cariTunda}"` : ''}.</div></div>
          ) : (
            data.map((b) => {
              const infoHp = STATUS[b.status] ?? { label: b.status, lencana: 'lencana--netral' };
              return (
                <article className="hp-kartu" key={`hp-beli-${b.id}`}>
                  <div className="hp-kartu__atas">
                    <span className="hp-kartu__kode kode-dok kode-dok--sj">{b.no_dokumen}</span>
                    <span className="hp-kartu__kanan">{formatTanggal(b.tanggal)}</span>
                  </div>
                  <div className="hp-kartu__nama">{formatRupiah(Number(b.total))}</div>
                  <div className="hp-kartu__sub">{b.pemasok} · {b.gudang_kode} · <span className={`lencana ${infoHp.lencana}`}>{infoHp.label}</span></div>
                  <div className="hp-grid">
                    <div className="hp-sel"><div className="hp-label">Item</div><div className="hp-nilai">{b.jumlah_item}</div></div>
                    <div className="hp-sel"><div className="hp-label">Total Qty</div><div className="hp-nilai">{Number(b.jumlah_qty ?? 0).toLocaleString('id-ID')}</div></div>
                    <div className="hp-sel"><div className="hp-label">Faktur</div><div className="hp-nilai">{b.no_faktur ?? '—'}</div></div>
                  </div>
                  <div className="hp-aksi">
                    <button type="button" className="tombol tombol--kecil" onClick={() => void bukaModal('lihat', b)}>Lihat</button>
                    <button
                      type="button"
                      className="tombol tombol--kecil tombol--bahaya"
                      disabled={b.status === 'batal' || !bolehKelola || !bisa('hapus')}
                      onClick={() => void bukaModal('batal', b)}
                    >
                      Batal
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </div>

        <FooterDaftar mode={modeBaris} onMode={setModeBaris} hal={hal} totalHal={totalHal} total={total} onHal={setHal} />

        </section>
      </>
      )}

      {/* ============ TAMPILAN 3: Dokumen (Faktur) ============ */}
      {tabAktif === 'dokumen' && (
      <>
        <BarPeriode
          nilai={periode}
          onUbah={ubahPeriode}
          ringkasan={`Menampilkan ${labelRentang(tglDari, tglSampai)} · ${total} transaksi · ${totalDokumen} faktur`}
        />

        <section className="dok-seksi dok-seksi--dokumen" aria-label="Dokumen faktur terbit">
          <div className="dok-judul dok-judul--dokumen" style={{ scrollMarginTop: 12 }}>
            <span className="dok-judul__ikon" aria-hidden="true">
              📄
            </span>
            <h4 className="bagian-judul" ref={dokumenRef} style={{ scrollMarginTop: 12 }}>
              Dokumen (faktur terbit)
            </h4>
            <span className="dok-hitung dok-hitung--dokumen">{totalDokumen} faktur</span>
          </div>
        <p className="teks-redup teks-kecil dok-sub">
          Hanya transaksi yang sudah disahkan (punya faktur) pada periode tampil. Satu set aksi Dokumen: lihat,
          WhatsApp, simpan PDF, cetak.
        </p>
        <div className="tabel-bungkus sembunyi-hp">
          <table className="tabel">
            <thead>
              <tr>
                <th>No. faktur</th>
                <th>Tanggal</th>
                <th>Pemasok</th>
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
                    Belum ada faktur pembelian pada periode tampil.
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
                        <IconButton label="Lihat faktur" ikon="eye" onClick={() => navigasi(`/pembelian/dokumen/${f.id}`)} />
                        <IconButton label="Kirim via WhatsApp" ikon="whatsapp" onClick={() => setDlgWaDok(f)} />
                        <IconButton
                          label="Simpan (PDF)"
                          ikon="download"
                          onClick={() => navigasi(`/pembelian/dokumen/${f.id}?cetak=1`)}
                        />
                        <IconButton label="Cetak" ikon="printer" onClick={() => navigasi(`/pembelian/dokumen/${f.id}?cetak=1`)} />
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {/* MOBILE OTOMATIS — Dokumen pembelian jadi kartu (<=767px). */}
        <div className="hp-daftar hp-daftar--dokumen">
          {sibukDokumen && dokumen.length === 0 ? (
            <div className="hp-kartu"><div className="hp-kartu__sub">Memuat…</div></div>
          ) : dokumen.length === 0 ? (
            <div className="hp-kartu"><div className="hp-kartu__sub">Belum ada faktur pembelian pada periode tampil.</div></div>
          ) : (
            dokumen.map((f) => (
              <article className="hp-kartu" key={`hp-belidok-${f.id}`}>
                <div className="hp-kartu__atas">
                  <span className="hp-kartu__kode kode-dok kode-dok--inv">{f.no_faktur}</span>
                  <span className="hp-kartu__kanan">{formatTanggal(f.tanggal)}</span>
                </div>
                <div className="hp-kartu__nama">{formatRupiah(Number(f.total))}</div>
                <div className="hp-kartu__sub">{f.pihak_nama || '—'} · {f.no_sumber || '—'} · <span className={`lencana ${f.status === 'batal' ? 'lencana--bahaya' : 'lencana--aktif'}`}>{f.status === 'batal' ? 'Batal' : 'Terbit'}</span></div>
                <div className="hp-ikonbar">
                  <IconButton label="Lihat faktur" ikon="eye" onClick={() => navigasi(`/pembelian/dokumen/${f.id}`)} />
                  <IconButton label="Kirim via WhatsApp" ikon="whatsapp" onClick={() => setDlgWaDok(f)} />
                  <IconButton label="Simpan (PDF)" ikon="download" onClick={() => navigasi(`/pembelian/dokumen/${f.id}?cetak=1`)} />
                  <IconButton label="Cetak" ikon="printer" onClick={() => navigasi(`/pembelian/dokumen/${f.id}?cetak=1`)} />
                </div>
              </article>
            ))
          )}
        </div>
        </section>
      </>
      )}
      </section>
      {garda}

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

      {/* ============ Modal: konfirmasi GRN ============ */}
      {mode === 'terima' && modalAktif && (
        <Modal
          judul={`Terima Barang (GRN) — ${modalAktif.no_dokumen}`}
          onTutup={() => setMode(null)}
          sedangKirim={sibukModal}
          aksi={
            <div className="tombol-baris">
              <button type="button" className="tombol tombol--netral" onClick={() => setMode(null)} disabled={sibukModal}>
                Kembali
              </button>
              <button type="button" className="tombol" onClick={() => void konfirmasiTerima()} disabled={sibukModal}>
                {sibukModal ? 'Memproses…' : 'Konfirmasi Diterima'}
              </button>
            </div>
          }
        >
          <p className="teks-redup teks-kecil">
            Status menjadi <strong>Diterima (GRN)</strong> dengan nomor GRN otomatis dan waktu penerimaan tercatat.
            Stok &amp; jurnal <strong>belum</strong> dibuat — baru saat pengesahan faktur.
          </p>
          <h4 className="bagian-judul">Item diterima</h4>
          <div className="daftar-item">
            {!detail ? (
              <p className="teks-redup">Memuat…</p>
            ) : (
              (detail.items ?? []).map((i: Baris) => (
                <div className="baris-item" key={i.id}>
                  <div className="baris-item__info">
                    <strong>
                      {i.sku} — {i.produk}
                    </strong>
                    <span className="teks-redup teks-kecil">{[i.size, i.warna].filter(Boolean).join(' / ')}</span>
                  </div>
                  <span className="kartu-ringkas">
                    {formatAngka(Number(i.qty))} {i.satuan ?? 'pcs'} × {formatRupiah(Number(i.harga_beli))}
                  </span>
                </div>
              ))
            )}
          </div>
        </Modal>
      )}

      {/* ============ Modal: pengesahan faktur ============ */}
      {mode === 'sahkan' && modalAktif && (
        <Modal
          judul={`Sahkan Faktur — ${modalAktif.no_dokumen}`}
          onTutup={() => setMode(null)}
          sedangKirim={sibukModal}
          aksi={
            <div className="tombol-baris">
              <button type="button" className="tombol tombol--netral" onClick={() => setMode(null)} disabled={sibukModal}>
                Kembali
              </button>
              <button type="button" className="tombol" onClick={() => void konfirmasiSahkan()} disabled={sibukModal}>
                {sibukModal ? 'Memproses…' : 'Sahkan & Catat Stok'}
              </button>
            </div>
          }
        >
          <p className="teks-redup teks-kecil">
            Pengesahan membuat <strong>stok masuk</strong> (kartu stok), <strong>jurnal persediaan/hutang</strong>, dan
            baris hutang pemasok sekaligus — dalam satu transaksi. Total{' '}
            <strong>{formatRupiah(Number(modalAktif.total))}</strong>.
          </p>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <label className="bidang">
              <span>No. faktur pembelian</span>
              <input
                type="text"
                value={noFaktur}
                onChange={(e) => setNoFaktur(e.target.value)}
                placeholder="Kosongkan = nomor otomatis FP-…"
                maxLength={60}
              />
            </label>
            <label className="bidang">
              <span>Jatuh tempo (opsional)</span>
              <input type="date" value={jatuhTempo} onChange={(e) => setJatuhTempo(e.target.value)} />
            </label>
          </div>
          <p className="teks-redup teks-kecil">
            Jatuh tempo dikosongkan = tunai saat ini; bila dikosongkan dan pemasok punya termin, termin pemasok dipakai.
          </p>
          <h4 className="bagian-judul">Item disahkan</h4>
          <div className="daftar-item">
            {!detail ? (
              <p className="teks-redup">Memuat…</p>
            ) : (
              (detail.items ?? []).map((i: Baris) => (
                <div className="baris-item" key={i.id}>
                  <div className="baris-item__info">
                    <strong>
                      {i.sku} — {i.produk}
                    </strong>
                    <span className="teks-redup teks-kecil">
                      {[i.size, i.warna].filter(Boolean).join(' / ')} · {formatRupiah(Number(i.subtotal))}
                    </span>
                  </div>
                  <span className="kartu-ringkas">
                    {formatAngka(Number(i.qty))} {i.satuan ?? 'pcs'}
                  </span>
                </div>
              ))
            )}
          </div>
        </Modal>
      )}

      {/* ============ Modal: detail dokumen ============ */}
      {mode === 'lihat' && modalAktif && (
        <Modal
          lebar="lebar"
          judul={`Dokumen ${modalAktif.no_dokumen}`}
          onTutup={() => setMode(null)}
          aksi={
            <div className="tombol-baris">
              <button type="button" className="tombol tombol--netral" onClick={() => setMode(null)}>
                Tutup
              </button>
              {modalAktif.status === 'draft' && (
                <>
                  <button
                    type="button"
                    className="tombol tombol--primer"
                    disabled={!bisa('ubah')}
                    title={tipIzin('ubah', 'Terima barang')}
                    onClick={() => void bukaModal('terima', modalAktif)}
                  >
                    Terima barang
                  </button>
                  <button
                    type="button"
                    className="tombol tombol--netral"
                    disabled={!bisa('ubah')}
                    title={tipIzin('ubah', 'mengubah draft')}
                    onClick={() => void bukaUbah(modalAktif)}
                  >
                    <Icon nama="pencil" size={16} /> Edit Transaksi
                  </button>
                </>
              )}
              {modalAktif.status === 'diterima' && (
                <>
                  <button
                    type="button"
                    className="tombol tombol--primer"
                    disabled={!bisa('sahkan')}
                    title={tipIzin('sahkan', 'Mengesahkan dokumen')}
                    onClick={() => void bukaModal('sahkan', modalAktif)}
                  >
                    Sahkan faktur
                  </button>
                  <button
                    type="button"
                    className="tombol tombol--netral"
                    disabled={!bisa('ubah') || !bolehKelola}
                    title="Edit dokumen diterima (stok baru bergerak saat disahkan)"
                    onClick={() => void bukaUbah(modalAktif)}
                  >
                    <Icon nama="pencil" size={16} /> Edit Transaksi
                  </button>
                </>
              )}
              {modalAktif.status === 'disahkan' && (
                <>
                  <button
                    type="button"
                    className="tombol tombol--netral"
                    disabled={!bisa('ubah') || !bolehKelola}
                    title="Muat ulang seluruh data ke form — stok, hutang & faktur direkonsiliasi otomatis"
                    onClick={() => void bukaUbah(modalAktif)}
                  >
                    <Icon nama="pencil" size={16} /> Edit Transaksi
                  </button>
                </>
              )}
              {modalAktif.status === 'batal' && (
                <button
                  type="button"
                  className="tombol tombol--netral"
                  disabled={!bisa('tambah')}
                  title={tipIzin('tambah', 'menyalin dokumen')}
                  onClick={() => void salinDraft(modalAktif)}
                >
                  Buat draft baru
                </button>
              )}
            </div>
          }
        >
          {!detail ? (
            <p className="teks-redup">Memuat…</p>
          ) : (
            <>
              <div className="form-grid">
                <div className="bidang">
                  <span>Status</span>
                  <div>
                    <span className={`lencana ${(STATUS[detail.status] ?? {}).lencana ?? 'lencana--netral'}`}>
                      {(STATUS[detail.status] ?? { label: detail.status }).label}
                    </span>
                  </div>
                </div>
                <div className="bidang">
                  <span>Metode input</span>
                  <div>{METODE_LABEL[detail.metode_input] ?? detail.metode_input}</div>
                </div>
                <div className="bidang">
                  <span>Tanggal</span>
                  <div>{formatTanggal(detail.tanggal)}</div>
                </div>
                <div className="bidang">
                  <span>Pemasok</span>
                  <div>{detail.pemasok}</div>
                </div>
                <div className="bidang">
                  <span>Gudang tujuan</span>
                  <div>
                    {detail.gudang_kode} — {detail.gudang_nama}
                  </div>
                </div>
                <div className="bidang">
                  <span>No. PO</span>
                  <div>{detail.no_po ?? '—'}</div>
                </div>
                <div className="bidang">
                  <span>No. GRN</span>
                  <div>{detail.no_grn ?? '—'}</div>
                </div>
                <div className="bidang">
                  <span>No. faktur</span>
                  <div>{detail.no_faktur ?? '—'}</div>
                </div>
                {detail.jurnal && (
                  <div className="bidang">
                    <span>Jurnal</span>
                    <div>
                      <code>{detail.jurnal.no_jurnal}</code> ({detail.jurnal.status})
                    </div>
                  </div>
                )}
                {detail.hutang && (
                  <div className="bidang">
                    <span>Hutang pemasok</span>
                    <div>
                      {formatRupiah(Number(detail.hutang.total))}
                      {detail.hutang.jatuh_tempo ? ` · jatuh tempo ${formatTanggal(detail.hutang.jatuh_tempo)}` : ' · tunai'}
                      {' · '}
                      {detail.hutang.status}
                    </div>
                  </div>
                )}
              </div>

              <h4 className="bagian-judul">Item</h4>
              <div className="tabel-bungkus">
                <table className="tabel tabel-detail-item">
                  <colgroup>
                    <col style={{ width: '34%' }} />
                    <col style={{ width: '15%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '14%' }} />
                    <col style={{ width: '11%' }} />
                    <col style={{ width: '14%' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Produk</th>
                      <th className="kolom-qty">Jumlah</th>
                      <th>Satuan</th>
                      <th className="rata-kanan">Harga beli</th>
                      <th className="rata-kanan">Diskon</th>
                      <th className="rata-kanan">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.items ?? []).map((i: Baris) => (
                      <tr key={i.id}>
                        <td>
                          <strong>{i.sku}</strong> — {i.produk}
                        </td>
                        <td className="kolom-qty">{formatAngka(Number(i.qty))}</td>
                        <td>{i.satuan ?? '—'}</td>
                        <td className="rata-kanan">{formatRupiah(Number(i.harga_beli))}</td>
                        <td className="rata-kanan">{formatRupiah(Number(i.diskon))}</td>
                        <td className="rata-kanan">{formatRupiah(Number(i.subtotal))}</td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={5} className="rata-kanan teks-redup">
                        Subtotal
                      </td>
                      <td className="rata-kanan">{formatRupiah(Number(detail.subtotal))}</td>
                    </tr>
                    <tr>
                      <td colSpan={5} className="rata-kanan teks-redup">
                        Diskon
                      </td>
                      <td className="rata-kanan">− {formatRupiah(Number(detail.diskon))}</td>
                    </tr>
                    <tr>
                      <td colSpan={5} className="rata-kanan teks-redup">
                        Pajak ({formatAngka(Number(detail.pajak_persen) || 0)}%)
                      </td>
                      <td className="rata-kanan">{formatRupiah(Number(detail.pajak))}</td>
                    </tr>
                    <tr>
                      <td colSpan={5} className="rata-kanan">
                        <strong>Total</strong>
                      </td>
                      <td className="rata-kanan">
                        <strong>{formatRupiah(Number(detail.total))}</strong>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {riwayatPindai.length > 0 && (
                <>
                  <h4 className="bagian-judul">Riwayat pemindaian barcode</h4>
                  <ul className="riwayat-pindai">
                    {riwayatPindai.map((rc) => (
                      <li key={rc.id} className="riwayat-pindai__baris">
                        <span>{String(rc.pesan_user)}</span>
                        <span className="teks-redup teks-kecil">{formatTanggalWaktu(String(rc.waktu))}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </Modal>
      )}

      {/* ============ Modal: pembatalan ============ */}
      {mode === 'batal' && modalAktif && (
        <Modal
          judul={`Batal ${modalAktif.no_dokumen}`}
          onTutup={() => setMode(null)}
          sedangKirim={sibukModal}
          aksi={
            <div className="tombol-baris">
              <button type="button" className="tombol tombol--netral" onClick={() => setMode(null)} disabled={sibukModal}>
                Kembali
              </button>
              <button type="button" className="tombol tombol--bahaya" onClick={() => void konfirmasiBatal()} disabled={sibukModal}>
                {sibukModal ? 'Memproses…' : 'Batalkan Dokumen'}
              </button>
            </div>
          }
        >
          <p className="teks-redup teks-kecil">
            {modalAktif.status === 'disahkan'
              ? 'Dokumen sudah disahkan: stok hasil pembelian ditarik kembali (kartu stok tetap tercatat), jurnal & hutang dibatalkan. Bila stok sudah terpakai transaksi lain, pembatalan ditolak — selesaikan lewat Opname.'
              : modalAktif.status === 'diterima'
                ? 'Penerimaan (GRN) dibatalkan — dokumen kembali ke status draft. Belum ada stok/jurnal yang dibuat.'
                : 'Draft dapat dibatalkan tanpa alasan. Dokumen tetap tersimpan dengan status Dibatalkan.'}
          </p>
          <label className="bidang" style={{ marginTop: 12 }}>
            <span>
              Alasan{modalAktif.status === 'disahkan' ? ' *' : ' (opsional)'}
            </span>
            <textarea
              rows={3}
              value={alasanBatal}
              onChange={(e) => setAlasanBatal(e.target.value)}
              placeholder="Contoh: salah pesan, harga disepakati ulang"
            />
          </label>
        </Modal>
      )}

      {/* BAGIAN I4 — dialog sukses pengesahan: ikon aksi faktur (tooltip). */}
      {fakturBaru && (
        <Modal
          judul="Faktur dibuat otomatis"
          onTutup={() => setFakturBaru(null)}
          aksi={
            <>
              <button type="button" className="tombol tombol--netral" onClick={() => setFakturBaru(null)}>
                Tutup
              </button>
              <Link className="tombol tombol--primer" to={`/pembelian/dokumen/${fakturBaru.id}`}>
                Buka faktur
              </Link>
            </>
          }
        >
          <p>
            Faktur <b>{fakturBaru.no_faktur}</b> tersimpan di Riwayat & Dokumen — bisa dibuka ulang, dicetak,
            disimpan PDF, atau dikirim via WhatsApp.
          </p>
          <div className="aksi-baris" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
            <IconButton label="Kirim via WhatsApp" ikon="whatsapp" onClick={() => setDlgWaFaktur(true)} />
            <IconButton
              label="Simpan (PDF)"
              ikon="download"
              onClick={() => navigasi(`/pembelian/dokumen/${fakturBaru.id}?cetak=1`)}
            />
            <IconButton
              label="Cetak"
              ikon="printer"
              onClick={() => navigasi(`/pembelian/dokumen/${fakturBaru.id}?cetak=1`)}
            />
          </div>
          {dlgWaFaktur && (
            <DialogWa
              faktur={{
                id: fakturBaru.id,
                no_faktur: fakturBaru.no_faktur,
                tanggal: fakturBaru.tanggal,
                total: fakturBaru.total,
              }}
              pihakNama={fakturBaru.pemasokNama}
              onTutup={() => setDlgWaFaktur(false)}
            />
          )}
        </Modal>
      )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Modal } from '../../components/crud/Modal';
import { beritahu } from '../../components/crud/Toast';
import { putarUmpanBalikScan } from '../../lib/umpanBalikScan';
import { ModalCariBarang, type BarisHasilCari } from '../../components/ModalCariBarang';
import { useGardaForm } from '../../lib/gardaForm';
import { apiGet, apiPost } from '../../lib/api';
import { formatRupiah, formatTanggal } from '../../lib/format';
import { can, MODUL_PO } from '../../lib/hak';
import { useSesi } from '../../lib/sesi';
import { KELAS_STATUS_PO, LABEL_STATUS_PO, type StatusPo } from '../../lib/kodi';
import { pakaiKodi, tampilQty } from './pakaiKodi';
import { cocokkanKodeScan } from './scanCocok';
import { gulirBarisDalamWadah, gulirKeBaris } from '../../lib/barisTransaksi';
import './po.css';
import './po-hub.css';

type Baris = Record<string, any>;

function hariIni(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Barang Datang — penerimaan harian per PO (full page).
 * Isi "Datang Hari Ini" langsung di tiap baris → simpan sekali:
 * server mencatat receipt, menambah stok, menghitung ulang sisa,
 * dan otomatis menutup PO menjadi Selesai bila semua terpenuhi.
 */
export function PoTerima() {
  const [params, setParams] = useSearchParams();
  const navigasi = useNavigate();
  const sesiInfo = useSesi().info;
  const boleh = can(sesiInfo, MODUL_PO, 'ubah');

  const [cariPo, setCariPo] = useState('');
  const [hasilPo, setHasilPo] = useState<Baris[]>([]);
  const [poTerbuka, setPoTerbuka] = useState(false);
  const [po, setPo] = useState<Baris | null>(null);
  const [isiKodi, setIsiKodi] = useState(20);
  const { kodiAktif } = pakaiKodi();
  /** Qty "Datang Hari Ini" per product_id (string input, bawaan '0'). */
  const [qty, setQty] = useState<Record<number, string>>({});
  const [tanggal, setTanggal] = useState(hariIni());
  const [noSj, setNoSj] = useState('');
  const [catatan, setCatatan] = useState('');
  const [sibuk, setSibuk] = useState(false);
  const [konfirmLebih, setKonfirmLebih] = useState<null | { daftar: string[] }>(null);
  const sibukRef = useRef(false);
  const poAktifRef = useRef<number | null>(null);
  /** Barang luar PO (tidak tercantum di PO) — target 0, tetap menambah stok. */
  const [luarRows, setLuarRows] = useState<Baris[]>([]);
  const [luarBuka, setLuarBuka] = useState(false);
  const [cariLuar, setCariLuar] = useState('');
  const [hasilLuar, setHasilLuar] = useState<Baris[]>([]);
  /** Indeks hasil yang tersorot lewat ↑/↓ (0 = hasil teratas). */
  /** Enter-Triggered Search — hasil pencarian barang luar tampil di pop-up modal. */
  const [modalLuar, setModalLuar] = useState<Baris[] | null>(null);
  const [mencariLuar, setMencariLuar] = useState(false);
  const cariLuarRef = useRef<HTMLInputElement>(null);
  /** Input "Datang Hari Ini" per product_id — tujuan fokus saat Tab dari pencarian. */
  const qtyRefs = useRef<Record<number, HTMLInputElement | null>>({});
  /** product_id barang luar PO terakhir yang ditambahkan (target Tab). */
  const terakhirLuarRef = useRef<number | null>(null);

  // --- Scan barcode / kode item (F2) — Tabel 2 "Diterima sekarang" ---------
  const scanRef = useRef<HTMLInputElement>(null);
  const [scanTeks, setScanTeks] = useState('');
  /** Kilat visual hasil scan: 'ok' = hijau, 'gagal' = merah (auto hilang). */
  const [kilatScan, setKilatScan] = useState<'ok' | 'gagal' | null>(null);
  const kilatTimer = useRef<number | null>(null);

  const muatPo = useCallback(async (id: number) => {
    poAktifRef.current = id;
    try {
      const r = await apiGet<{ data: Baris; isi_per_kodi: number }>(`/api/po/${id}`);
      if (poAktifRef.current !== id) return;
      setPo(r.data);
      if (r.isi_per_kodi) setIsiKodi(r.isi_per_kodi);
      // Reset kolom "Datang Hari Ini" tiap ganti/muat ulang PO.
      const awal: Record<number, string> = {};
      for (const it of (r.data.items as Baris[])) {
        awal[Number(it.product_id)] = '0';
      }
      // Barang luar PO yang pernah diterima tetap tampil (akumulasi sudah datang).
      const luarAwal: Baris[] = ((r.data.di_luar_po as Baris[]) ?? []).map((x) => ({
        product_id: Number(x.product_id),
        produk_nama: String(x.produk_nama ?? ''),
        kode_item: x.kode_item ?? null,
        sku: x.sku ?? null,
        harga_beli: Number(x.harga_beli) || 0,
        sudah: Number(x.total_datang) || 0,
      }));
      for (const x of luarAwal) awal[x.product_id] = '0';
      setLuarRows(luarAwal);
      setLuarBuka(false);
      setCariLuar('');
      setHasilLuar([]);
      setQty(awal);
      setKonfirmLebih(null);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    }
  }, []);

  // ?po= di URL (dari Daftar/Detail) langsung membuka PO tersebut.
  useEffect(() => {
    const id = Number(params.get('po') ?? 0);
    if (id > 0) {
      void muatPo(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autocomplete PO: debounce 250ms.
  useEffect(() => {
    const q = cariPo.trim();
    if (q.length < 1) {
      setHasilPo([]);
      setPoTerbuka(false);
      return;
    }
    const t = window.setTimeout(async () => {
      try {
        const r = await apiGet<{ data: Baris[] }>(`/api/po/cari-po?q=${encodeURIComponent(q)}`);
        setHasilPo(r.data);
        setPoTerbuka(true);
      } catch {
        /* diam */
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [cariPo]);

  /** Kode persis (barcode / SKU / kode item) pada hasil pencarian barang luar. */
  const cocokKodeLuar = (h: Baris, q: string): boolean => {
    const k = q.toLowerCase();
    const barcode = (h as { barcode?: string | null }).barcode;
    return (
      (barcode ? String(barcode).toLowerCase() === k : false) ||
      String(h.sku ?? '').toLowerCase() === k ||
      (h.kode_item ? String(h.kode_item).toLowerCase() === k : false)
    );
  };

  /**
   * Enter di kolom cari barang luar — SATU-SATUNYA pemicu pencarian:
   * kode persis unik → langsung masuk tabel; selain itu → pop-up modal hasil.
   */
  const cariLuarSekarang = async (mentah?: string) => {
    const q = (mentah ?? cariLuar).trim();
    if (!q || !po) return;
    const gudang = po.warehouse_id ? `&gudang_id=${encodeURIComponent(String(po.warehouse_id))}` : '';
    setMencariLuar(true);
    try {
      const r = await apiGet<{ data: Baris[] }>(`/api/pembelian/produk-cari?cari=${encodeURIComponent(q)}${gudang}`);
      const daftar = r.data ?? [];
      const persis = daftar.filter((h) => cocokKodeLuar(h, q));
      setHasilLuar(daftar);
      if (persis.length === 1) {
        tambahBarangLuar(persis[0]);
        return;
      }
      setModalLuar(daftar);
      if (daftar.length === 0) {
        putarUmpanBalikScan('gagal');
        beritahu(`Barang tidak ditemukan untuk "${q}".`, 'info', 2500);
      }
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    } finally {
      setMencariLuar(false);
    }
  };

  const petaLuar = new Map<string, Baris>();
  for (const h of modalLuar ?? []) petaLuar.set(String(h.product_id), h);
  const barisModalLuar: BarisHasilCari[] = (modalLuar ?? []).map((h) => ({
    key: String(h.product_id),
    kode: String(h.kode_item ?? h.sku ?? ''),
    nama: String(h.produk ?? ''),
    kategori: (h as { kategori?: string | null }).kategori ?? null,
    stok: Number(h.stok ?? 0),
    harga: Number(h.harga_terakhir ?? h.harga_beli) || 0,
  }));

  /**
   * Pilih hasil autocomplete barang luar PO.
   * - Belum ada di tabel → tambahkan sebagai baris [ Luar PO ] (target 0)
   *   dengan Qty Datang Hari Ini bawaan 1.
   * - Sudah ada (item PO awal maupun luar PO) → JANGAN duplikat.
   * Fokus SELALU tetap di input pencarian (alur scan berkelanjutan) dan teks
   * pencarian dikosongkan; Tab dipakai bila ingin masuk ke tabel.
   */
  const tambahBarangLuar = (h: Baris) => {
    const pid = Number(h.product_id);
    if (!Number.isInteger(pid) || pid <= 0) return;
    const sudahAda =
      luarRows.some((r) => Number(r.product_id) === pid) ||
      ((po?.items as Baris[] | undefined) ?? []).some((i) => Number(i.product_id) === pid);
    setCariLuar('');
    setHasilLuar([]);
    setModalLuar(null);
    terakhirLuarRef.current = pid;
    // Jangan pindahkan fokus keluar dari kolom cari — pengguna lanjut scan.
    cariLuarRef.current?.focus();
    if (sudahAda) return;
    setLuarRows((prev) => [
      ...prev,
      {
        product_id: pid,
        produk_nama: String(h.produk ?? ''),
        kode_item: h.kode_item ?? null,
        sku: h.sku ?? null,
        harga_beli: Number(h.harga_terakhir ?? h.harga_beli) || 0,
        sudah: 0,
      },
    ]);
    // Bawaan 1 pcs per barang baru; panel cari tetap terbuka untuk barang berikutnya.
    setQty((d) => ({ ...d, [pid]: d[pid] ?? '1' }));
  };

  /** Umpan balik hasil scan — memakai preferensi Suara & Getar Scan. */
  const bunyiScan = useCallback((berhasil: boolean) => {
    putarUmpanBalikScan(berhasil ? 'ok' : 'gagal');
  }, []);

  const kilatkanScan = useCallback((jenis: 'ok' | 'gagal') => {
    setKilatScan(jenis);
    if (kilatTimer.current !== null) window.clearTimeout(kilatTimer.current);
    kilatTimer.current = window.setTimeout(() => setKilatScan(null), 700);
  }, []);

  // F2 = fokus otomatis ke kolom scan (shortcut ini juga tampil di kolomnya).
  useEffect(() => {
    const padaTombol = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'F2') return;
      e.preventDefault();
      const el = scanRef.current;
      if (!el) return;
      el.focus();
      el.select();
    };
    window.addEventListener('keydown', padaTombol);
    return () => window.removeEventListener('keydown', padaTombol);
  }, []);

  // Bersihkan timer kilat & AudioContext saat halaman ditinggalkan.
  useEffect(
    () => () => {
      if (kilatTimer.current !== null) window.clearTimeout(kilatTimer.current);
    },
    [],
  );

  /**
   * Proses satu hasil scan (Enter dari scanner fisik atau ketik manual).
   * Cocokkan barcode / SKU / kode item dengan baris Tabel 2 (item PO maupun
   * barang luar PO), lalu tambah qty +1 pcs. Kode yang tidak ada di PO ditolak
   * dengan bunyi rendah + kilat merah (tidak diam-diam masuk ke tabel).
   */
  const prosesScan = () => {
    const kode = scanTeks.trim();
    const el = scanRef.current;
    if (!po) {
      beritahu('Pilih PO dulu sebelum memindai barang.', 'galat');
      return;
    }
    if (!kode) return;
    const semuaBaris = [...((po.items as Baris[] | undefined) ?? []), ...luarRows];
    const cocok = cocokkanKodeScan(semuaBaris, kode);
    setScanTeks('');
    el?.focus();
    if (!cocok) {
      bunyiScan(false);
      kilatkanScan('gagal');
      beritahu(`Kode "${kode}" tidak ada dalam PO ${String(po.no_po ?? 'ini')}.`, 'galat');
      return;
    }
    const pid = Number(cocok.product_id);
    const baru = Math.min(9_999_999, (Number(qty[pid]) || 0) + 1);
    setQty((d) => ({ ...d, [pid]: String(baru) }));
    bunyiScan(true);
    kilatkanScan('ok');
    // Hasil scan langsung terlihat: gulir baris yang qty-nya bertambah ke area
    // pandang, tanpa memindahkan fokus dari kolom scan (scan beruntun lancar).
    requestAnimationFrame(() => gulirKeBaris(qtyRefs.current[pid]));
    // Peringatan bila akumulasi (sudah datang + scan hari ini) melebihi target.
    const itPo = ((po.items as Baris[] | undefined) ?? []).find((x) => Number(x.product_id) === pid);
    if (itPo) {
      const target = Number(itPo.qty_pesan) || 0;
      const total = (Number(itPo.total_datang) || 0) + baru;
      if (target > 0 && total > target) {
        beritahu(
          `Scan melebihi sisa target PO ${String(itPo.produk_nama)} — ${tampilQty(total, isiKodi, kodiAktif)} dari ${tampilQty(target, isiKodi, kodiAktif)}. Simpan tetap meminta konfirmasi LEBIH.`,
          'info',
          3200,
        );
      }
    }
  };

  const hapusBarangLuar = (pid: number) => {
    setLuarRows((prev) => prev.filter((r) => Number(r.product_id) !== pid));
    setQty((d) => {
      const c = { ...d };
      delete c[pid];
      return c;
    });
  };

  const pilihPo = (b: Baris) => {
    setCariPo('');
    setHasilPo([]);
    setPoTerbuka(false);
    setParams({ po: String(b.id) }, { replace: true });
    void muatPo(Number(b.id));
  };

  const qtyNum = (pid: number): number => Math.max(0, Math.floor(Number(qty[pid]) || 0));

  const ubahQty = (pid: number, mentah: string) => {
    // Backspace/Delete sampai kosong → kembali ke 0; angka nol di depan dibuang.
    const bersih = mentah.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '').slice(0, 7);
    setQty((d) => ({ ...d, [pid]: bersih === '' ? '0' : bersih }));
  };

  /** Isi semua sisa target ke kolom Datang Hari Ini. */
  const isiSemuaSisa = () => {
    if (!po) return;
    setQty((d) => {
      const c = { ...d };
      for (const it of po.items as Baris[]) {
        const sisa = Number(it.sisa) || 0;
        if (sisa > 0) c[Number(it.product_id)] = String(sisa);
      }
      return c;
    });
  };

  /** Semua input "Datang Hari Ini" (item PO + Luar PO) dalam urutan tampil. */
  const inputQtyUrut = (): HTMLInputElement[] =>
    Array.from(document.querySelectorAll<HTMLInputElement>('input[data-datang-qty="1"]'));

  /** Pindahkan fokus ke input qty tetangga (↑/↓/Tab/Enter); false bila di ujung. */
  const geserFokusQty = (dari: HTMLInputElement, arah: 1 | -1): boolean => {
    const daftar = inputQtyUrut();
    const i = daftar.indexOf(dari);
    if (i < 0) return false;
    const target = daftar[i + arah];
    if (!target) return false;
    target.focus();
    target.select();
    return true;
  };

  /**
   * Keyboard input cari barang luar PO: Enter memicu pencarian (exact match →
   * langsung masuk, selain itu pop-up modal). Navigasi ↑/↓/Enter/Esc saat modal
   * terbuka ditangani oleh ModalCariBarang.
   */
  const tombolCariLuar = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void cariLuarSekarang();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setModalLuar(null);
      setCariLuar('');
      return;
    }
    // Tab: lompat ke tabel — qty barang yang baru ditambahkan, atau qty pertama.
    if (e.key === 'Tab' && !e.shiftKey) {
      const daftar = inputQtyUrut();
      const terakhir = terakhirLuarRef.current;
      const targetTab =
        (terakhir !== null ? qtyRefs.current[terakhir] : null) ?? daftar[daftar.length - 1] ?? daftar[0];
      if (!targetTab) return;
      e.preventDefault();
      targetTab.focus();
      targetTab.select();
      setHasilLuar([]);
    }
  };

  /**
   * Fokus masuk ke input "Datang Hari Ini" (klik, klik label, Tab, ↑/↓, atau
   * program): blok angkanya dan gulir barisnya agar selalu terlihat jelas —
   * termasuk saat tabel lebih tinggi dari area pandang.
   */
  const fokusQtyBaris = (e: FocusEvent<HTMLInputElement>) => {
    e.currentTarget.select();
    // Gulir DI DALAM wadah tabel saja agar halaman tidak ikut bergeser.
    gulirBarisDalamWadah(e.currentTarget);
  };

  /** Kembali ke input cari barang luar dari kolom Datang Hari Ini. */
  const kembaliKeCariLuar = () => {
    const el = cariLuarRef.current;
    if (!el) return;
    el.focus();
    el.select();
  };

  /**
   * Navigasi keyboard kolom "Datang Hari Ini" — SATU rantai untuk baris PO
   * maupun baris [ Luar PO ]:
   *  ↑/↓        : pindah vertikal antar baris (termasuk PO ⇄ Luar PO)
   *  Enter/Tab  : pindah ke baris berikutnya; di baris luar PO terakhir
   *               (paling bawah) fokus kembali ke pencarian barang luar.
   *  Esc        : kembali ke pencarian barang luar.
   */
  const tombolQtyTabel = (e: KeyboardEvent<HTMLElement>, dariLuar: boolean) => {
    const el = e.currentTarget as HTMLInputElement;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      geserFokusQty(el, e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      kembaliKeCariLuar();
      return;
    }
    if (e.key !== 'Enter' && e.key !== 'Tab') return;
    e.preventDefault();
    if (geserFokusQty(el, 1)) return;
    // Ujung rantai: baris Luar PO paling bawah → kembali ke input pencarian.
    if (dariLuar) kembaliKeCariLuar();
  };

  const kumpulkan = (): { product_id: number; qty_datang: number }[] => {
    const keluar: { product_id: number; qty_datang: number }[] = [];
    for (const [pidStr, mentah] of Object.entries(qty)) {
      const q = Math.max(0, Math.floor(Number(mentah) || 0));
      if (q > 0) keluar.push({ product_id: Number(pidStr), qty_datang: q });
    }
    return keluar;
  };

  const daftarLebih = (): string[] => {
    if (!po) return [];
    const lebih: string[] = [];
    for (const it of po.items as Baris[]) {
      const pid = Number(it.product_id);
      const total = (Number(it.total_datang) || 0) + qtyNum(pid);
      if (total > (Number(it.qty_pesan) || 0)) {
        lebih.push(`${it.produk_nama} (pesan ${tampilQty(Number(it.qty_pesan), isiKodi, kodiAktif)}, jadi ${tampilQty(total, isiKodi, kodiAktif)})`);
      }
    }
    return lebih;
  };

  const simpan = async () => {
    if (sibukRef.current) return;
    if (!boleh) {
      beritahu('Peran Anda belum memiliki izin Ubah pada Pembelian.', 'galat');
      return;
    }
    if (!po) {
      beritahu('Pilih PO dulu.', 'galat');
      return;
    }
    const items = kumpulkan();
    if (items.length === 0) {
      beritahu('Isi minimal satu qty Datang Hari Ini lebih dari 0.', 'galat');
      return;
    }
    if (daftarLebih().length > 0 && !konfirmLebih) {
      setKonfirmLebih({ daftar: daftarLebih() });
      return;
    }
    sibukRef.current = true;
    setSibuk(true);
    try {
      await apiPost<{ receipt_id: number }>(`/api/po/${po.id}/terima`, {
        tanggal: new Date(`${tanggal}T12:00:00`).toISOString(),
        no_surat_jalan: noSj.trim() || null,
        catatan: catatan.trim() || null,
        items,
      });
      beritahu('Berhasil mencatat barang masuk & stok terupdate.');
      setKonfirmLebih(null);
      selesaiRef.current = true; // simpan sukses → tanpa dialog konfirmasi
      navigasi('/po');
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      sibukRef.current = false;
      setSibuk(false);
    }
  };

  const itemsPo = (po?.items as Baris[] | undefined) ?? [];
  const rows = kumpulkan();

  /* ------------- Garda navigasi: perubahan belum disimpan ---------------- */
  // Barang Datang tidak punya draft: kotor = ada qty datang > 0, atau header
  // (tanggal / surat jalan / catatan) diubah dari nilai awalnya.
  const selesaiRef = useRef(false);
  const kotor =
    !selesaiRef.current &&
    (rows.length > 0 || noSj.trim() !== '' || catatan.trim() !== '' || tanggal !== hariIni());
  const kotorRef = useRef(kotor);
  kotorRef.current = kotor;

  /** Tombol merah dialog: kosongkan qty & header lalu lanjut ke halaman tujuan. */
  const buangForm = (): void => {
    const nol: Record<number, string> = {};
    for (const it of itemsPo) nol[Number(it.product_id)] = '0';
    for (const it of luarRows) nol[Number(it.product_id)] = '0';
    setQty(nol);
    setNoSj('');
    setCatatan('');
    setTanggal(hariIni());
  };

  const { garda } = useGardaForm({
    aktif: kotor,
    mode: 'tinggalkan',
    judul: 'Perubahan Belum Disimpan',
    pesan:
      'Data penginputan Barang Datang saat ini belum disimpan. Apakah Anda yakin ingin meninggalkan halaman ini dan menghapus inputan?',
    simpan: async () => {
      await simpan();
    },
    masihKotor: () => kotorRef.current,
    buang: buangForm,
  });
  const totalItem = rows.length;
  const totalPcs = rows.reduce((n, i) => n + i.qty_datang, 0);
  const hargaPeta = new Map([
    ...itemsPo.map((it) => [Number(it.product_id), Number(it.harga_beli) || 0] as [number, number]),
    ...luarRows.map((it) => [Number(it.product_id), Number(it.harga_beli) || 0] as [number, number]),
  ]);
  const totalRp = rows.reduce((n, i) => n + i.qty_datang * (hargaPeta.get(i.product_id) ?? 0), 0);

  /** Status ringkas per baris (sudah + input hari ini vs target). */
  const badgeBaris = (it: Baris): { kelas: string; teks: string; lebih: boolean } => {
    const pesan = Number(it.qty_pesan) || 0;
    const total = (Number(it.total_datang) || 0) + qtyNum(Number(it.product_id));
    if (total > pesan) return { kelas: 'lencana--peringatan', teks: 'Kelebihan', lebih: true };
    if (pesan > 0 && total === pesan) return { kelas: 'lencana--aktif', teks: 'Pas', lebih: false };
    return { kelas: 'lencana--bahaya', teks: 'Kurang', lebih: false };
  };

  return (
    <div className="halaman po-modul">
      {garda}
      <section className="kartu po-terima-padat">

        <div className="po-terima-topbar">
          <div className="cari-barang">
            <input
              className="cari-barang__input"
              value={cariPo}
              onChange={(e) => setCariPo(e.target.value)}
              placeholder="Cari: nomor PO / nama pemasok / nama barang…"
              aria-label="Cari PO"
              role="combobox"
              aria-expanded={poTerbuka}
            />
            {poTerbuka && hasilPo.length > 0 && (
              <div className="cari-barang__dropdown" role="listbox">
                {hasilPo.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className="cari-barang__baris"
                    role="option"
                    aria-selected="false"
                    onClick={() => pilihPo(b)}
                    style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, borderBottom: '1px solid var(--border)', cursor: 'pointer', font: 'inherit', color: 'var(--teks)' }}
                  >
                    <span className="cari-barang__baris-utama">
                      <span className="cari-barang__kode">{String(b.no_po)}</span>
                      <span className="cari-barang__nama">{String(b.supplier_nama)} · sisa {tampilQty(Number(b.sisa_pcs), isiKodi, kodiAktif)} ({Number(b.sisa_item)} item)</span>
                      <span className="cari-barang__meta">{formatTanggal(b.tanggal)} · {LABEL_STATUS_PO[String(b.status) as StatusPo] ?? b.status}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            {poTerbuka && cariPo.trim() && hasilPo.length === 0 && (
              <p className="cari-barang__hint">Tidak ada PO aktif yang cocok — coba kata lain.</p>
            )}
          </div>
          <span className="po-terima-aksi">
            {po && (
              <>
                <button type="button" className="tombol tombol--kecil" onClick={isiSemuaSisa}>
                  Isi semua sisa
                </button>
                <Link className="tombol tombol--kecil tombol--netral" to={`/po/${po.id}`}>
                  Detail PO
                </Link>
              </>
            )}
          </span>
        </div>

        {!po && (
          <div className="po-kosong">
            <div className="po-kosong-ikon" aria-hidden="true">🚚</div>
            <strong>Belum ada PO dipilih</strong>
            <p>Ketik nomor PO, nama pemasok, atau nama barang yang masih bersisa di kolom cari di atas.</p>
          </div>
        )}

        {po && (
          <>
            <div className="po-terima-kartu" aria-label="Informasi PO">
              <div className="po-terima-kartu__item">
                <span>Nomor PO</span>
                <strong>{String(po.no_po)}</strong>
              </div>
              <div className="po-terima-kartu__item">
                <span>Pemasok / Supplier</span>
                <strong>{String(po.supplier_nama ?? '—')}</strong>
              </div>
              <div className="po-terima-kartu__item">
                <span>Tanggal Order</span>
                <strong>{formatTanggal(po.tanggal)}</strong>
              </div>
              <div className="po-terima-kartu__item">
                <span>Gudang Tujuan</span>
                <strong>{String(po.gudang_nama ?? '—')}</strong>
              </div>
              <div className="po-terima-kartu__status">
                <span className={`lencana ${KELAS_STATUS_PO[String(po.status) as StatusPo] ?? 'lencana--netral'}`}>
                  {LABEL_STATUS_PO[String(po.status) as StatusPo] ?? String(po.status)}
                </span>
              </div>
            </div>

            <div className="po-terima-meta">
              <label className="bidang">
                <span>Tanggal Terima</span>
                <input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} aria-label="Tanggal Terima" />
              </label>
              <label className="bidang">
                <span>Nomor Surat Jalan / No. Resi Supplier</span>
                <input value={noSj} onChange={(e) => setNoSj(e.target.value)} placeholder="Opsional" maxLength={80} aria-label="Nomor Surat Jalan" />
              </label>
              <label className="bidang">
                <span>Catatan</span>
                <input value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Opsional" maxLength={400} aria-label="Catatan penerimaan" />
              </label>
            </div>

            {/* SCAN BARCODE — di atas Tabel 2 (Diterima sekarang). Scanner HID
                mengirim karakter + Enter; Enter di sini menambah +1 pcs. */}
            <div className="po-scan">
              <label className="bidang po-scan__bidang" htmlFor="po-scan-input">
                <span>Scan Barcode / Kode Item</span>
                <span className={`po-scan__input ${kilatScan ? `po-scan__input--${kilatScan}` : ''}`}>
                  <input
                    id="po-scan-input"
                    ref={scanRef}
                    value={scanTeks}
                    onChange={(e) => setScanTeks(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        prosesScan();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setScanTeks('');
                        e.currentTarget.blur();
                      }
                    }}
                    placeholder="Arahkan scanner, atau ketik barcode / SKU / kode item lalu Enter…"
                    aria-label="Scan barcode atau kode item"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <kbd className="po-scan__kbd" title="Tekan F2 untuk fokus ke kolom scan">F2</kbd>
                </span>
              </label>
              <p className="po-scan__petunjuk">
                Scan masuk otomatis ke tabel Diterima sekarang (+1 pcs); scan ulang menambah qty. Tekan
                <kbd className="po-scan__kbd-inline">F2</kbd> kapan saja untuk fokus ke kolom ini.
              </p>
            </div>

            <div className="tabel-bungkus po-tabel-gulir">
              <table className="tabel po-tabel po-tabel--datang">
                <thead>
                  <tr>
                    <th>Nama &amp; Varian Produk</th>
                    <th className="rata-kanan">Target PO</th>
                    <th className="rata-kanan">Sudah Datang</th>
                    <th className="rata-kanan">Sisa Target</th>
                    <th className="rata-kanan">Datang Hari Ini</th>
                    <th className="rata-tengah">Status Ringkas</th>
                  </tr>
                </thead>
                <tbody>
                  {itemsPo.map((it, idx) => {
                    const pid = Number(it.product_id);
                    const pesan = Number(it.qty_pesan) || 0;
                    const sudah = Number(it.total_datang) || 0;
                    const sisa = Number(it.sisa) || 0;
                    const badge = badgeBaris(it);
                    return (
                      <tr key={it.product_id} className={badge.lebih ? 'po-terima-lebih' : ''}>
                        <td data-label="Nama & Varian Produk">
                          <strong>{String(it.produk_nama)}</strong>
                          <div className="teks-redup teks-kecil">{String(it.kode_item ?? it.sku ?? '')}</div>
                        </td>
                        <td data-label="Target PO" className="rata-kanan">{tampilQty(pesan, isiKodi, kodiAktif)}</td>
                        <td data-label="Sudah Datang" className="rata-kanan">{tampilQty(sudah, isiKodi, kodiAktif)}</td>
                        <td data-label="Sisa Target" className="rata-kanan">
                          {sisa > 0 ? tampilQty(sisa, isiKodi, kodiAktif) : <span className="teks-redup">habis</span>}
                        </td>
                        <td data-label="Datang Hari Ini" className="rata-kanan">
                          <span className="po-terima-qty">
                            <input
                              ref={(el) => { qtyRefs.current[pid] = el; }}
                              type="text" inputMode="numeric" pattern="[0-9]*" value={qty[pid] ?? '0'}
                              aria-label={`Datang hari ini ${it.produk_nama}`}
                              data-po-baris={idx} data-po-kolom="qty" data-datang-qty="1"
                              onKeyDown={(e) => tombolQtyTabel(e, false)}
                              onChange={(e) => ubahQty(pid, e.target.value)}
                              onFocus={fokusQtyBaris}
                            />
                            <span className="teks-redup">pcs</span>
                          </span>
                        </td>
                        <td data-label="Status Ringkas" className="rata-tengah">
                          <span className={`lencana ${badge.kelas}`}>{badge.teks}</span>
                        </td>
                      </tr>
                    );
                  })}
                  {luarRows.map((it) => {
                    const pid = Number(it.product_id);
                    return (
                      <tr key={`luar-${pid}`} className="po-terima-luar">
                        <td data-label="Nama & Varian Produk">
                          <strong>{String(it.produk_nama)}</strong>
                          <div className="teks-redup teks-kecil">
                            {String(it.kode_item ?? it.sku ?? '')}
                            {' '}
                            <button
                              type="button"
                              className="po-luar__hapus"
                              title="Keluarkan barang dari daftar luar PO"
                              aria-label={`Hapus ${String(it.produk_nama)} dari luar PO`}
                              onClick={() => hapusBarangLuar(pid)}
                            >
                              ✕
                            </button>
                          </div>
                        </td>
                        <td data-label="Target PO" className="rata-kanan">
                          0 pcs{kodiAktif ? <span className="teks-redup"> (0 kodi)</span> : null}
                        </td>
                        <td data-label="Sudah Datang" className="rata-kanan">{tampilQty(Number(it.sudah) || 0, isiKodi, kodiAktif)}</td>
                        <td data-label="Sisa Target" className="rata-kanan"><span className="teks-redup">—</span></td>
                        <td data-label="Datang Hari Ini" className="rata-kanan">
                          <span className="po-terima-qty">
                            <input
                              ref={(el) => { qtyRefs.current[pid] = el; }}
                              type="text" inputMode="numeric" pattern="[0-9]*" value={qty[pid] ?? '0'}
                              aria-label={`Datang hari ini ${String(it.produk_nama)}`}
                              data-datang-qty="1"
                              onKeyDown={(e) => tombolQtyTabel(e, true)}
                              onChange={(e) => ubahQty(pid, e.target.value)}
                              onFocus={fokusQtyBaris}
                            />
                            <span className="teks-redup">pcs</span>
                          </span>
                        </td>
                        <td data-label="Status Ringkas" className="rata-tengah">
                          <span className="lencana lencana--luar">Luar PO</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="po-luar">
              {!luarBuka && (
                <button
                  type="button"
                  className="tombol tombol--netral tombol--kecil po-luar__tombol"
                  onClick={() => setLuarBuka(true)}
                >
                  ＋ Tambah Barang Luar PO
                </button>
              )}
              {luarBuka && (
                <div
                  className="cari-barang po-luar__cari"
                  onBlur={(e) => {
                    // Klik/Tab keluar dari area cari → tutup dropdown.
                    if (!e.currentTarget.contains(e.relatedTarget)) setHasilLuar([]);
                  }}
                >
                  <input
                    ref={cariLuarRef}
                    className="cari-barang__input"
                    value={cariLuar}
                    onChange={(e) => {
                      // Pencarian TIDAK dijalankan saat mengetik — hanya Enter.
                      setCariLuar(e.target.value);
                      setHasilLuar([]);
                    }}
                    onKeyDown={tombolCariLuar}
                    placeholder="Cari master produk: nama / SKU / barcode / kode item…"
                    aria-label="Cari barang luar PO"
                    autoComplete="off"
                    role="combobox"
                    aria-expanded={hasilLuar.length > 0}
                    aria-controls="po-luar-hasil"
                    autoFocus
                  />
                  {mencariLuar && <p className="cari-barang__hint">Mencari…</p>}
                  {!mencariLuar && cariLuar.trim() && hasilLuar.length === 0 && (
                    <p className="cari-barang__hint">Tekan Enter untuk mencari barang.</p>
                  )}
                  {modalLuar !== null && (
                    <ModalCariBarang
                      judul="Hasil pencarian barang"
                      kata={cariLuar.trim()}
                      baris={barisModalLuar}
                      onCari={(k) => {
                        setCariLuar(k);
                        void cariLuarSekarang(k);
                      }}
                      onPilih={(b) => {
                        const h = petaLuar.get(String(b.key));
                        if (h) tambahBarangLuar(h);
                        else setModalLuar(null);
                      }}
                      onTutup={() => {
                        setModalLuar(null);
                        cariLuarRef.current?.focus();
                      }}
                      labelAksi="Tambah"
                    />
                  )}
                  <button
                    type="button"
                    className="tombol tombol--kecil tombol--netral"
                    onClick={() => { setLuarBuka(false); setCariLuar(''); setHasilLuar([]); }}
                  >
                    Tutup
                  </button>
                </div>
              )}
            </div>
            <p className="teks-redup teks-kecil" style={{ margin: 0 }}>
              Enter: tambah ke tabel &amp; tetap di pencarian | Tab: pindah fokus ke tabel | ↑/↓: navigasi autocomplete | Esc: tutup dropdown.
            </p>
            {luarRows.length > 0 && (
              <p className="teks-redup teks-kecil" style={{ margin: 0 }}>
                Barang luar PO tetap menambah stok, tetapi tidak dihitung dalam pemenuhan target PO.
              </p>
            )}
          </>
        )}
      </section>

      {po && (
        <div className="po-footer-sticky kartu">
          <span className="teks-redup teks-kecil">{totalItem} item</span>
          <span>Total: <strong>{totalPcs.toLocaleString('id-ID')} Pasang</strong><span className="teks-redup"> / {kodiAktif ? tampilQty(totalPcs, isiKodi, true) : `${totalPcs.toLocaleString('id-ID')} pcs`}</span></span>
          <span className="po-total">
            <span>Total <strong>{formatRupiah(totalRp)}</strong></span>
            <button type="button" className="tombol tombol--netral" disabled={sibuk} onClick={() => navigasi('/po')}>
              Batal
            </button>
            <button type="button" className="tombol tombol--emerald" disabled={sibuk || totalPcs === 0} onClick={() => void simpan()}>
              {sibuk ? 'Menyimpan…' : 'Simpan & Update Stok'}
            </button>
          </span>
        </div>
      )}

      {konfirmLebih && (
        <Modal
          judul="Qty melebihi sisa PO"
          onTutup={() => setKonfirmLebih(null)}
          aksi={
            <>
              <button type="button" className="tombol tombol--netral" onClick={() => setKonfirmLebih(null)}>
                Periksa lagi
              </button>
              <button type="button" className="tombol tombol--primer" disabled={sibuk} onClick={() => { setKonfirmLebih(null); void simpan(); }}>
                Ya, simpan sebagai LEBIH
              </button>
            </>
          }
        >
          <p>Barang berikut datang <strong>lebih</strong> dari yang dipesan — akan ditandai badge oranye "LEBIH":</p>
          <ul>
            {konfirmLebih.daftar.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  );
}

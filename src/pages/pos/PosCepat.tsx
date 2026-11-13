import { useEffect, useRef, useState, type KeyboardEvent as KunciEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { beritahu } from '../../components/crud/Toast';
import { IconButton } from '../../components/IconButton';
import { TombolScan } from '../../components/ScanKamera';
import { Modal } from '../../components/crud/Modal';
import { ambilOpsi, apiDelete, apiGet, apiPost } from '../../lib/api';
import { formatAngka, formatRupiah } from '../../lib/format';
import { rutePos, setModePosTerakhir } from '../../lib/pengguna';
import {
  DialogBayar,
  DialogLayanan,
  DialogShiftBuka,
  DialogShiftTutup,
  DialogStruk,
  DialogTahan,
  DialogTertahan,
  type BarisTertahan,
} from './DialogPos';
import type { StrukData } from './struk';
import type { ProfilStruk } from './struk';
import { DialogPiutang } from './DialogPiutang';
import type { BarisKeranjang, Opsi, SaranCari, ShiftAktif } from './tipe';
import { buangPindahMode, gabungDiskonBaris, peekPindahMode, simpanPindahMode } from './pindahMode';
import { useGardaForm } from '../../lib/gardaForm';
import { PopupTutorial, mintaBukaTutorial } from '../../components/PopupTutorial';
import { JamTransaksi } from './JamTransaksi';
import { useUsaha } from '../../lib/usaha';
import { useSesi } from '../../lib/sesi';
import { TIP_GUDANG_TERKUNCI, idGudangBawaan, idGudangTerkunci } from '../../lib/gudang';
import { putarUmpanBalikScan } from '../../lib/umpanBalikScan';
import { ModalCariBarang, type BarisHasilCari } from '../../components/ModalCariBarang';
import './pos.css';
import './pos-deep-teal.css';
import './pos-sage.css';

type NamaDialog = 'bayar' | 'tahan' | 'tertahan' | 'shift-buka' | 'shift-tutup' | 'layanan' | 'piutang' | null;
/** Sel keranjang yang sedang difokus: baris (r) dan kolom (0 jumlah, 1 diskon, 2 harga). */
type PosisiSel = { r: number; c: number };

/** Debounce pencarian — syarat: maksimal 100ms. */

/** Contoh: hasil saran menyesuaikan Master Data — minta 200 barang cocok,
 *  dropdown scroll (bukan patokan 10). Naikkan/turunkan sesuai isi master. */
const BATAS_SARAN_CONTOH = 200;

/** "20*kaos" → qty 20 + kata "kaos"; "kaos" biasa → qty 1. */
function pisahCari(masukan: string): { qty: number; kata: string } {
  const m = /^(\d+)\s*\*\s*(.*)$/.exec(masukan.trim());
  if (m) return { qty: Math.max(1, parseInt(m[1], 10) || 1), kata: m[2].trim() };
  return { qty: 1, kata: masukan.trim() };
}


/** Sel angka keranjang (jumlah / diskon / harga). Nilai mentah dijaga saat mengedit. */
function Sel({
  b,
  r,
  c,
  nilai,
  aktif,
  teks,
  onUbah,
  onFokus,
  onKeluar,
  onKunci,
}: {
  b: BarisKeranjang;
  r: number;
  c: number;
  nilai: string;
  aktif: boolean;
  teks: string | undefined;
  onUbah: (b: BarisKeranjang, c: number, v: string) => void;
  onFokus: (r: number, c: number) => void;
  onKeluar: (b: BarisKeranjang, c: number) => void;
  onKunci: (e: KunciEvent<HTMLInputElement>, r: number, c: number) => void;
}) {
  const label = c === 0 ? 'Jumlah' : c === 1 ? 'Diskon' : 'Harga';
  const tampil = teks ?? (aktif ? nilai : formatAngka(Number(nilai) || 0));
  return (
    <input
      className={`pos-sel-input ${aktif ? 'fokus' : ''}`}
      data-produk={b.productId}
      data-kolom={c}
      name={c === 0 ? 'qty' : undefined}
      inputMode="numeric"
      aria-label={`${label} ${b.nama}`}
      value={tampil}
      onFocus={() => onFokus(r, c)}
      onChange={(e) => onUbah(b, c, e.target.value)}
      onBlur={() => onKeluar(b, c)}
      onKeyDown={(e) => onKunci(e, r, c)}
    />
  );
}

/**
 * POS Mode Tanpa Foto (/pos/cepat) — tabel ramping tanpa gambar, keyboard penuh:
 *   kursor di pencarian saat buka & setiap item ditambahkan; autocomplete indeks
 *   (awalan + awalan kata, batas dinamis ?batas=N menyesuaikan Master Data,
 *   huruf cocok ditebalkan, debounce 80ms);
 *   "20*kaos" + Enter = 20 buah; Tab/Shift+Tab antar sel (jumlah, diskon, harga);
 *   Delete hapus baris; F4 bayar (dialog keyboard penuh), F8 tahan, F9 tertahan,
 *   Esc batal. Struk, jurnal, dan stok memakai jalur API yang sama dengan Mode Foto.
 */
export function PosCepat() {
  const navigate = useNavigate();
  // M5 — isi keranjang dipindahkan dari mode lain (dibaca sekali saat mount).
  const [pindahan] = useState(peekPindahMode);
  const [konfirmasiMode, setKonfirmasiMode] = useState(false);
  // Enter-Triggered Search — hasil pencarian tampil di pop-up modal.
  const [modalHasil, setModalHasil] = useState<SaranCari[] | null>(null);
  const [modalKata, setModalKata] = useState('');
  const [modalQty, setModalQty] = useState(1);
  const [cari, setCari] = useState('');
  const [keranjang, setKeranjang] = useState<BarisKeranjang[]>(() => pindahan?.items ?? []);
  const [gudangOpsi, setGudangOpsi] = useState<Opsi[]>([]);
  const [gudangId, setGudangId] = useState(() => pindahan?.gudangId ?? 0);
  // WI — kasir dengan akses satu gudang: form terkunci di gudang itu.
  const sesiInfo = useSesi().info;
  const gudangTerkunci = idGudangTerkunci(sesiInfo, gudangOpsi);
  useEffect(() => {
    if (gudangTerkunci !== null) setGudangId(gudangTerkunci);
  }, [gudangTerkunci]);
  const [shift, setShift] = useState<ShiftAktif | null>(null);
  // Identitas usaha global — header, bayar & struk selalu memakai data terbaru
  // Pengaturan ▸ Profil Usaha tanpa perlu muat ulang halaman.
  const usaha = useUsaha();
  const [pajakPersen, setPajakPersen] = useState(0);
  const [dialog, setDialog] = useState<NamaDialog>(null);
  const [struk, setStruk] = useState<StrukData | null>(null);
  const [sel, setSel] = useState<PosisiSel | null>(null);
  const [teks, setTeks] = useState<Record<string, string>>({});
  // AP1/AP4 — menu titik-tiga, popover shift, sheet rincian (tampilan saja).
  const [menuBuka, setMenuBuka] = useState(false);
  const [shiftBuka, setShiftBuka] = useState(false);
  const [rincianBuka, setRincianBuka] = useState(false);
  const [tertahanJumlah, setTertahanJumlah] = useState(0);
  const [sorotId, setSorotId] = useState<number | null>(null);
  const kartuRef = useRef<HTMLDivElement>(null);
  // BAGIAN J3/J4 — profil struk aktif & cetak otomatis setelah bayar.
  const [profilStruk, setProfilStruk] = useState<ProfilStruk | null>(null);
  const [cetakOtomatis, setCetakOtomatis] = useState(false);

  const cariRef = useRef<HTMLInputElement>(null);
  const tabelRef = useRef<HTMLTableSectionElement>(null);
  const idPermintaan = useRef(0);
  const stateTerbaru = useRef({ dialog, struk, keranjang });
  const cariNilai = useRef(cari);
  stateTerbaru.current = { dialog, struk, keranjang };
  cariNilai.current = cari;

  const totalQty = keranjang.reduce((a, b) => a + b.qty, 0);
  const subtotal = keranjang.reduce((a, b) => a + b.qty * b.harga, 0);
  const diskonTotal = keranjang.reduce((a, b) => a + (b.diskon ?? 0), 0);
  const dasar = Math.max(0, subtotal - diskonTotal);
  const pajak = Math.round((dasar * pajakPersen) / 100);
  const total = dasar + pajak;

  /* --------------------------- muat data awal ---------------------------- */
  // M4/M6 — catat mode ini sebagai mode POS terakhir (tombol POS / F9),
  // dan buang payload pindahan mode setelah dipakai.
  useEffect(() => {
    setModePosTerakhir('cepat');
    buangPindahMode();
  }, []);

  /* AP4 — badge jumlah transaksi tertahan (tampilan saja). */
  useEffect(() => {
    let batal = false;
    apiGet<{ data: BarisTertahan[] }>('/api/pos/held')
      .then((r) => {
        if (!batal) setTertahanJumlah(r.data.length);
      })
      .catch(() => undefined);
    return () => {
      batal = true;
    };
  }, [dialog]);

  /* AP5 — papan ketik: footer tetap terlihat lewat visualViewport. */
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const el = document.querySelector('.pos-shell--cepat') as HTMLElement | null;
    const atur = () => {
      document.documentElement.style.setProperty('--pos-vv', `${vv.height}px`);
      el?.classList.toggle('pos-shell--kbd', vv.height < window.innerHeight * 0.85);
    };
    atur();
    vv.addEventListener('resize', atur);
    return () => vv.removeEventListener('resize', atur);
  }, []);

  /* AP3 — item baru tergulir ke pandangan & disorot singkat. */
  const jumlahBaris = keranjang.length;
  useEffect(() => {
    if (jumlahBaris === 0) return;
    const akhir = keranjang[jumlahBaris - 1];
    setSorotId(akhir.productId);
    const t = window.setTimeout(() => setSorotId(null), 1200);
    requestAnimationFrame(() => {
      kartuRef.current?.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const baris = tabelRef.current?.lastElementChild as HTMLElement | null;
      baris?.scrollIntoView({ block: 'nearest' });
    });
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumlahBaris]);

  const ambilSaran = (q: string) =>
    apiGet<{ data: SaranCari[]; terbatas?: boolean }>(
      // berstok=1 — kasir hanya boleh mencari barang yang benar-benar ada
      // stoknya di gudang aktif (isolasi gudang, bukan sekadar katalog).
      `/api/pos/cari?cari=${encodeURIComponent(q)}&batas=${BATAS_SARAN_CONTOH}${gudangId > 0 ? `&gudang=${gudangId}` : ''}&berstok=1`,
    ).then((r) => r.data);

  useEffect(() => {
    (async () => {
      try {
        const [meta, sh, go, struk] = await Promise.all([
          apiGet<{ pengaturan: Record<string, string> }>('/api/meta'),
          apiGet<{ data: ShiftAktif | null }>('/api/pos/shift/aktif'),
          ambilOpsi('gudang'),
          apiGet<{ data: ProfilStruk[]; pengaturan: { cetak_otomatis: boolean } }>('/api/struk/profil').catch(() => null),
        ]);
        const pajakAwal = Number(meta.pengaturan['pajak_persen'] ?? 0) || 0;
        setPajakPersen(pajakAwal);
        setShift(sh.data);
        setGudangOpsi(go);
        // WI2 — default sesi: gudang terkunci → gudang default → opsi pertama.
        setGudangId(
          (prev) => prev || idGudangTerkunci(sesiInfo, go) || idGudangBawaan(sesiInfo, go) || go[0]?.id || 0,
        );
        if (struk) {
          setProfilStruk(struk.data.find((x) => x.bawaan) ?? struk.data[0] ?? null);
          setCetakOtomatis(Boolean(struk.pengaturan?.cetak_otomatis));
        }
        cariRef.current?.focus();
      } catch (e) {
        beritahu((e as Error).message, 'galat');
      }
    })();
  }, []);

  /* ------------------------- ganti mode POS (M5) ------------------------- */
  // Seluruh diskon baris digabung jadi diskon kasir — total tetap sama.
  const gantiKeFoto = () => {
    const g = gabungDiskonBaris(keranjang);
    simpanPindahMode({ dari: 'cepat', items: g.items, diskon: g.diskon, gudangId });
    setModePosTerakhir('foto');
    navigate(rutePos('foto'));
  };

  const tanyaGantiMode = () => {
    if (keranjang.length > 0) setKonfirmasiMode(true);
    else gantiKeFoto();
  };

  /* ------------- Enter-Triggered Search (tanpa query saat mengetik) ------- */
  /* --------------------------- keranjang --------------------------------- */
  const tambah = (s: SaranCari, qty: number): boolean => {
    if (s.harga <= 0) {
      beritahu(`${s.nama} belum punya harga jual — atur di Master › Produk.`, 'galat');
      return false;
    }
    if (s.stok <= 0) {
      beritahu(`Stok ${s.nama} habis di gudang terpilih.`, 'galat');
      return false;
    }
    const i = keranjang.findIndex((b) => b.productId === s.product_id);
    const sekarang = i >= 0 ? keranjang[i].qty : 0;
    const jumlah = Math.max(1, qty);
    if (sekarang + jumlah > s.stok) {
      beritahu(`Stok ${s.nama} di gudang terpilih sisa ${s.stok}.`, 'galat');
      return false;
    }
    if (i >= 0) {
      setKeranjang(keranjang.map((b, idx) => (idx === i ? { ...b, qty: b.qty + jumlah } : b)));
    } else {
      setKeranjang([
        ...keranjang,
        { productId: s.product_id, nama: s.nama, sku: s.sku, harga: Number(s.harga), qty: jumlah, stok: s.stok, diskon: 0 },
      ]);
    }
    return true;
  };

  const terimaSaran = (s: SaranCari | undefined, qty: number, kataAsli: string) => {
    if (!s) {
      // ISOLASI GUDANG — pencarian terkunci gudang aktif: tanpa hasil berarti
      // barang tidak terdaftar di gudang ini.
      const labelGudang = gudangOpsi.find((o) => o.id === gudangId)?.label;
      putarUmpanBalikScan('gagal');
      beritahu(
        labelGudang ? `Barang ini tidak terdaftar di ${labelGudang}.` : `Tidak ada produk cocok dengan "${kataAsli}".`,
        'info',
        2500,
      );
      return;
    }
    if (!tambah(s, qty)) {
      putarUmpanBalikScan('gagal');
      return;
    }
    putarUmpanBalikScan('ok');
    setCari('');
    setModalHasil(null);
    setModalKata('');
    setModalQty(1);
    setSel(null);
    cariRef.current?.focus();
  };

  /**
   * Daftar awal (input kosong): katalog gudang aktif — dipakai saat kasir
   * menekan ↑/↓ di kolom pencarian tanpa mengetik apa pun.
   */
  const ambilAwal = async (): Promise<SaranCari[]> => {
    const r = await apiGet<{
      data: {
        id: number;
        kode_item: string | null;
        nama: string;
        sku: string;
        barcode: string | null;
        stok_min: number;
        harga: number;
        stok: number;
      }[];
    }>(`/api/pos/produk${gudangId > 0 ? `?gudang=${gudangId}` : ''}`);
    return r.data.map((p) => ({
      product_id: p.id,
      nama: p.nama,
      kode_item: p.kode_item,
      sku: p.sku,
      barcode: p.barcode,
      stok_min: Number(p.stok_min) || 0,
      harga: Number(p.harga) || 0,
      stok: Number(p.stok) || 0,
    }));
  };

  /**
   * Buka Pop-Up Hasil Pencarian tanpa menekan Enter — dipakai panah ↑/↓.
   * Kata kunci kosong → tampilkan daftar awal barang gudang aktif.
   */
  const bukaModalCari = async (kata: string): Promise<void> => {
    const k = kata.trim();
    try {
      const data = k ? await ambilSaran(k) : await ambilAwal();
      setModalKata(k);
      setModalQty(1);
      setModalHasil(data);
      if (data.length === 0) {
        putarUmpanBalikScan('gagal');
        beritahu(
          k ? `Barang tidak ditemukan untuk "${k}".` : 'Belum ada barang berstok di gudang aktif.',
          'info',
          2500,
        );
      }
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    }
  };

  /** Cari ulang dari dalam modal (kata kunci diubah lalu Enter). */
  const cariModal = async (k: string): Promise<void> => {
    try {
      const data = await ambilSaran(k);
      setModalKata(k);
      setModalHasil(data);
      if (data.length === 0) {
        putarUmpanBalikScan('gagal');
        beritahu(`Barang tidak ditemukan untuk "${k}".`, 'info', 2500);
      }
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    }
  };

  const petaModal = new Map<string, SaranCari>();
  for (const s of modalHasil ?? []) petaModal.set(String(s.product_id), s);
  const barisModal: BarisHasilCari[] = (modalHasil ?? []).map((s) => ({
    key: s.product_id,
    kode: s.kode_item || s.sku || s.barcode || '',
    nama: s.nama,
    kategori: (s as { kategori?: string | null }).kategori ?? null,
    stok: s.stok,
    harga: s.harga,
  }));

  // kodeLangsung: hasil pindaian kamera HP (melewati state cari yang async).
  const konfirmasiCari = async (kodeLangsung?: string) => {
    const sumber = kodeLangsung ?? cari;
    const { qty, kata: k } = pisahCari(sumber);
    if (!k) {
      beritahu(sumber.trim() ? 'Format qty: 20*kaos (angka, bintang, lalu nama produk).' : 'Ketik nama / SKU / barcode produk dulu.', 'info', 2500);
      return;
    }
    // Enter = satu-satunya pemicu pencarian.
    try {
      const id = ++idPermintaan.current;
      const data = await ambilSaran(k);
      if (id !== idPermintaan.current) return;
      const q = k.toLowerCase();
      const persis = data.filter(
        (s) =>
          (s.barcode ? s.barcode.toLowerCase() === q : false) ||
          s.sku.toLowerCase() === q ||
          (s.kode_item ? s.kode_item.toLowerCase() === q : false),
      );
      // 1x scan kode persis → langsung masuk keranjang + bunyi sukses.
      if (persis.length === 1) {
        terimaSaran(persis[0], qty, k);
        return;
      }
      // Banyak hasil / pencarian umum → pop-up modal.
      setModalKata(k);
      setModalQty(qty);
      setModalHasil(data);
      if (data.length === 0) {
        putarUmpanBalikScan('gagal');
        beritahu(`Barang tidak ditemukan untuk "${k}".`, 'info', 2500);
      }
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    }
  };

  const hapusBaris = (r: number) => {
    if (r < 0 || r >= keranjang.length) return;
    const id = keranjang[r].productId;
    setKeranjang(keranjang.filter((_, i) => i !== r));
    setTeks((t) => {
      const salinan = { ...t };
      for (const kunci of Object.keys(salinan)) if (kunci.startsWith(`${id}:`)) delete salinan[kunci];
      return salinan;
    });
    setSel(null);
    cariRef.current?.focus();
  };

  const kosongkanKeranjang = () => {
    if (keranjang.length === 0) return;
    setKeranjang([]);
    setTeks({});
    setSel(null);
    beritahu('Keranjang dikosongkan.', 'info', 2500);
    cariRef.current?.focus();
  };

  const kunciSelTeks = (productId: number, c: number): string => `${productId}:${c}`;

  /* AP3 — stepper kartu ponsel memakai logika jumlah yang sama. */
  const ubahQty = (b: BarisKeranjang, delta: number) => {
    const qty = Math.max(1, Math.min(b.stok, b.qty + delta));
    setKeranjang((ks) =>
      ks.map((x) =>
        x.productId !== b.productId
          ? x
          : { ...x, qty, diskon: Math.min(x.diskon ?? 0, qty * x.harga) },
      ),
    );
  };

  const ubahSel = (b: BarisKeranjang, c: number, v: string) => {
    const bersih = v.replace(/\D/g, '');
    const key = kunciSelTeks(b.productId, c);
    setTeks((t) => ({ ...t, [key]: bersih }));
    if (bersih === '') return; // biarkan nilai lama sampai blur
    const n = Number(bersih);
    setKeranjang((ks) =>
      ks.map((x) => {
        if (x.productId !== b.productId) return x;
        if (c === 0) {
          const qty = Math.max(1, Math.min(x.stok, n));
          return { ...x, qty, diskon: Math.min(x.diskon ?? 0, qty * x.harga) };
        }
        if (c === 2) {
          const harga = n;
          return { ...x, harga, diskon: Math.min(x.diskon ?? 0, x.qty * harga) };
        }
        return { ...x, diskon: Math.min(n, Math.max(0, x.qty * x.harga)) };
      }),
    );
  };

  const akhiriSel = (b: BarisKeranjang, c: number) => {
    const key = kunciSelTeks(b.productId, c);
    setTeks((t) => {
      if (!(key in t)) return t;
      const salinan = { ...t };
      delete salinan[key];
      return salinan;
    });
  };

  /* --------------------------- fokus & navigasi -------------------------- */
  const fokusCari = () => {
    setSel(null);
    cariRef.current?.focus();
    cariRef.current?.select();
  };

  const fokusSel = (r: number, c: number) => {
    const b = keranjang[r];
    if (!b) return;
    setSel({ r, c });
    const el = tabelRef.current?.querySelector<HTMLInputElement>(
      `input[data-produk="${b.productId}"][data-kolom="${c}"]`,
    );
    el?.focus();
    el?.select();
  };

  const kunciSel = (e: KunciEvent<HTMLInputElement>, r: number, c: number) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      if (!e.shiftKey) {
        if (c < 2) fokusSel(r, c + 1);
        else if (r < keranjang.length - 1) fokusSel(r + 1, 0);
        else fokusCari();
      } else {
        if (c > 0) fokusSel(r, c - 1);
        else if (r > 0) fokusSel(r - 1, 2);
        else fokusCari();
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      fokusCari();
      return;
    }
    if (e.key === 'Delete') {
      e.preventDefault();
      hapusBaris(r);
      return;
    }
    if (e.key === 'ArrowDown' && r < keranjang.length - 1) {
      e.preventDefault();
      fokusSel(r + 1, c);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (r > 0) fokusSel(r - 1, c);
      else fokusCari();
    }
  };

  /* --------------------------- transaksi --------------------------------- */
  const tutupDialog = () => {
    setDialog(null);
    cariRef.current?.focus();
  };

  const bukaBayar = () => {
    if (keranjang.length === 0) {
      beritahu('Keranjang kosong — cari produk dulu, Enter untuk menambah.', 'info', 2500);
      return;
    }
    if (!shift) {
      beritahu('Buka kasir dulu sebelum bertransaksi.', 'galat');
      setDialog('shift-buka');
      return;
    }
    setDialog('bayar');
  };

  const tahanTransaksi = async (nama: string) => {
    await apiPost('/api/pos/held', {
      nama,
      data: { items: keranjang, diskon: 0, pajak_persen: pajakPersen, gudangId },
    });
    setKeranjang([]);
    setTeks({});
    setSel(null);
    tutupDialog();
    beritahu('Transaksi ditahan — lanjutkan dengan F9.', 'sukses');
  };

  const lanjutkanTertahan = async (b: BarisTertahan) => {
    if (!b.data) return;
    setKeranjang((b.data.items ?? []).map((x) => ({ ...x, diskon: x.diskon ?? 0 })));
    setTeks({});
    setSel(null);
    if (b.data.gudangId) setGudangId(b.data.gudangId);
    await apiDelete(`/api/pos/held/${b.id}`);
    tutupDialog();
    beritahu('Transaksi tertahan dimuat kembali.', 'sukses');
  };

  /* --------------------------- keyboard global --------------------------- */
  const handlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  handlerRef.current = (e: KeyboardEvent) => {
    const s = stateTerbaru.current;
    if (s.dialog || s.struk) return; // modal yang mengurus keyboard-nya sendiri
    if (e.key === 'F1') {
      e.preventDefault();
      fokusCari();
      return;
    }
    if (e.key === 'F2') {
      e.preventDefault();
      tanyaGantiMode();
      return;
    }
    if (e.key === 'F3') {
      e.preventDefault();
      setRincianBuka(true);
      requestAnimationFrame(() => {
        document.getElementById('pos-pajak')?.focus();
      });
      return;
    }
    if (e.key === 'F4' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) {
      e.preventDefault();
      bukaBayar();
      return;
    }
    if (e.key === 'F8') {
      e.preventDefault();
      if (e.shiftKey) kosongkanKeranjang();
      else if (s.keranjang.length > 0) setDialog('tahan');
      return;
    }
    if (e.key === 'F9') {
      e.preventDefault();
      setDialog('tertahan');
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      const t = e.target as HTMLElement | null;
      if (t && t.classList.contains('pos-sel-input')) {
        fokusCari();
        return;
      }
      const { kata: k } = pisahCari(cariNilai.current);
      if (k) {
        setCari('');
        setModalHasil(null);
        setModalKata('');
        return;
      }
      kosongkanKeranjang();
    }
  };

  useEffect(() => {
    const f = (e: KeyboardEvent) => handlerRef.current(e);
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, []);

  // Garda navigasi: keranjang belum dibayar ikut ditahan dulu (nama otomatis).
  const kotorRef = useRef(false);
  kotorRef.current = keranjang.length > 0;
  const { garda, minta } = useGardaForm({
    aktif: kotorRef.current,
    simpan: () =>
      tahanTransaksi(
        `Otomatis ${new Date().toLocaleString('id-ID', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
      ),
    masihKotor: () => kotorRef.current,
    buang: () => kosongkanKeranjang(),
    labelSimpan: 'Tahan & Pindah',
    lewati: (t) => t.startsWith('/penjualan/pos'),
  });

  /* --------------------------- render ------------------------------------ */
  return (
    <div className="pos-shell pos-shell--cepat">
      <PopupTutorial />
      {garda}
      <header className="pos-kepala">
        {/* AP1 ponsel: kembali · judul · chip shift · titik-tiga (satu baris 52px). */}
        <button type="button" className="pos-kembali pos-hanya-ap" aria-label="Kembali ke Penjualan" onClick={() => minta('/penjualan')}>
          ‹
        </button>
        <h1 className="pos-judul-ap pos-hanya-ap">POS Tanpa Foto</h1>
        <button
          type="button"
          className={`pos-shift-chip pos-hanya-ap ${shift ? '' : 'pos-shift-chip--tutup'}`}
          aria-label={shift ? 'Status shift — ketuk untuk rincian' : 'Shift belum dibuka — ketuk untuk membuka'}
          aria-expanded={shiftBuka}
          onClick={() => setShiftBuka((b) => !b)}
        >
          <span className="pos-shift-chip__titik" aria-hidden="true" />
          <span className="pos-shift-chip__teks">{shift ? 'Shift aktif' : 'Shift tutup'}</span>
        </button>
        <button
          type="button"
          className="pos-menu-btn pos-hanya-ap"
          aria-label="Menu POS"
          aria-expanded={menuBuka}
          onClick={() => setMenuBuka((b) => !b)}
        >
          ⋮
        </button>
        <div className="pos-kepala__judul pos-lama">
          {/* M5 — jejak: Penjualan > POS (Mode Tanpa Foto) */}
          <Link className="pos-jejak" to="/penjualan">
            Penjualan
          </Link>
          <span className="pos-pemisah" aria-hidden="true">›</span>
          POS (Mode Tanpa Foto) <span className="pos-toko">{usaha.nama}</span>
        </div>
        <div className="pos-kepala__tengah pos-lama">
          {shift ? (
            <div className="pos-shift">
              <span>
                Shift aktif · Kas awal <b>{formatRupiah(Number(shift.kas_awal))}</b>
              </span>
              <span>
                <b>{shift.ringkasan?.jumlah_transaksi ?? 0}</b> transaksi · tunai <b>{formatRupiah(shift.ringkasan?.tunai ?? 0)}</b>
              </span>
              <button type="button" className="tombol" onClick={() => setDialog('shift-tutup')}>
                Tutup Kasir
              </button>
            </div>
          ) : (
            <div className="pos-shift pos-shift--tutup">
              <b>Shift belum dibuka</b>
              <button type="button" className="tombol tombol--primer" onClick={() => setDialog('shift-buka')}>
                Buka Kasir
              </button>
            </div>
          )}
        </div>
        <div className="pos-kepala__kanan pos-lama">
          <JamTransaksi />
          <button
            type="button"
            className="pos-fullscreen-btn"
            title="Layar penuh [F11]"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void document.documentElement.requestFullscreen?.().catch(() => undefined);
            }}
          >
            ⛶ <span className="pos-kbd">F11</span>
          </button>
          <button type="button" className="tombol" onClick={() => setDialog('layanan')}>
            Riwayat &amp; Layanan
          </button>
          <button
            type="button"
            className="tombol"
            onClick={() => setDialog('piutang')}
            title="Pelunasan / cicilan piutang pelanggan langsung dari kasir"
          >
            💳 Bayar Piutang
          </button>
          <button type="button" className="pos-tombol-keluar" onClick={tanyaGantiMode}>
            Mode Foto <span className="pos-kbd">F2</span>
          </button>
          <span className="pos-panduan-ikon">
            <IconButton ikon="message-circle" label="Panduan halaman ini" arah="bawah" ukuran="toolbar" onClick={() => mintaBukaTutorial()} />
          </span>
          <IconButton
            ikon="chevron-left"
            label="Kembali ke Penjualan"
            arah="bawah"
            ukuran="toolbar"
            onClick={() => minta('/penjualan')}
          />
        </div>
      </header>
      {(menuBuka || shiftBuka) && (
        <button type="button" className="pos-latar" aria-label="Tutup menu" onClick={() => { setMenuBuka(false); setShiftBuka(false); }} />
      )}
      {shiftBuka && (
        <div className="pos-pop pos-pop--shift" role="dialog" aria-label="Status shift">
          <div className="pos-pop__judul">Status shift</div>
          {shift ? (
            <>
              <div className="pos-pop__baris"><span>Kas awal</span><b>{formatRupiah(Number(shift.kas_awal))}</b></div>
              <div className="pos-pop__baris"><span>Jumlah transaksi</span><b>{shift.ringkasan?.jumlah_transaksi ?? 0}</b></div>
              <div className="pos-pop__baris"><span>Penjualan tunai</span><b>{formatRupiah(shift.ringkasan?.tunai ?? 0)}</b></div>
              <div className="pos-pop__aksi">
                <button type="button" className="tombol" onClick={() => { setShiftBuka(false); setDialog('shift-tutup'); }}>Tutup Kasir</button>
              </div>
            </>
          ) : (
            <>
              <div className="pos-pop__baris"><span>Status</span><b>Shift belum dibuka</b></div>
              <div className="pos-pop__aksi">
                <button type="button" className="tombol tombol--primer" onClick={() => { setShiftBuka(false); setDialog('shift-buka'); }}>Buka Kasir</button>
              </div>
            </>
          )}
        </div>
      )}
      {menuBuka && (
        <div className="pos-pop pos-pop--menu" role="menu" aria-label="Menu POS">
          <div className="pos-pop__menu">
            <button type="button" onClick={() => { setMenuBuka(false); setDialog('layanan'); }}>🕘 Riwayat &amp; Layanan</button>
            <button type="button" onClick={() => { setMenuBuka(false); setDialog('piutang'); }}>💳 Bayar Piutang</button>
            <button type="button" onClick={() => { setMenuBuka(false); tanyaGantiMode(); }}>🖼️ Ganti mode (Foto / Tanpa Foto)</button>
            <button type="button" onClick={() => { setMenuBuka(false); mintaBukaTutorial(); }}>💬 Panduan dan pintasan</button>
            {shift ? (
              <button type="button" onClick={() => { setMenuBuka(false); setDialog('shift-tutup'); }}>🔒 Tutup Kasir</button>
            ) : (
              <button type="button" onClick={() => { setMenuBuka(false); setDialog('shift-buka'); }}>🔓 Buka Kasir</button>
            )}
          </div>
        </div>
      )}

      <div className="pos-badan pos-badan--cepat">
        <div className="pos-cari-cepat">
          <div className="pos-cari-bar">
          <div className="pos-cari pos-cari--cepat">
            <span className="pos-cari__ikon" aria-hidden>
              <svg width="1em" height="1em" style={{ fontSize: '0.9375rem' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            </span>
            <input
              ref={cariRef}
              autoFocus
              value={cari}
              placeholder="Cari nama / SKU / barcode"
              aria-label="Cari produk"
              onChange={(e) => setCari(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void konfirmasiCari();
                  return;
                }
                // ↑/↓ = langsung buka pop-up hasil (Enter = pilih/saring).
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  void bukaModalCari(cari);
                  return;
                }
                if (e.key === 'Tab' && keranjang.length > 0) {
                  e.preventDefault();
                  fokusSel(0, 0);
                }
              }}
            />
            <TombolScan mode="berkelanjutan" onHasil={(t) => { setCari(t); void konfirmasiCari(t); }} judul="Pindai barcode produk" />
            {modalHasil !== null && (
              <ModalCariBarang
                judul="Hasil pencarian barang"
                kata={modalKata}
                baris={barisModal}
                onCari={(k) => void cariModal(k)}
                onPilih={(b) => {
                  const s = petaModal.get(String(b.key));
                  if (s) terimaSaran(s, modalQty, modalKata);
                  else setModalHasil(null);
                }}
                onTutup={() => {
                  setModalHasil(null);
                  setModalKata('');
                  cariRef.current?.focus();
                }}
                labelAksi="Tambah"
              />
            )}
          </div>

          </div>
          <div className="pos-chipbar" aria-label="Opsi pencarian">
            <span className="pos-mode-switch" role="group" aria-label="Mode tampilan (F2 untuk ganti)">
              <button type="button" onClick={tanyaGantiMode} title="Ganti ke Mode Foto [F2]">
                ▦ Mode Foto
              </button>
              <button type="button" className="aktif" aria-pressed="true" title="Tanpa Foto (Teks) [F2]">
                ☰ Tanpa Foto <span className="pos-kbd">F2</span>
              </button>
            </span>
            <span className="pos-chip pos-chip--pilih" title={gudangTerkunci !== null ? TIP_GUDANG_TERKUNCI : undefined}>
              <span className="pos-chip__teks">
                Gudang: {gudangOpsi.find((o) => o.id === gudangId)?.label ?? '—'}
                {gudangTerkunci !== null ? ' 🔒' : ''}
              </span>
              <select
                value={gudangId}
                onChange={(e) => setGudangId(Number(e.target.value))}
                aria-label="Gudang"
                disabled={gudangTerkunci !== null}
              >
                {gudangOpsi.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </span>
          </div>

          <div className="pos-cepat-petunjuk">
            F1 cari · F2 ganti mode · F3 diskon/pajak · ↑↓ saran · Enter tambah · Ctrl+Enter bayar · F8 tahan · F9 tertahan · Esc batal
          </div>
        </div>

        <div className="pos-tabel-keranjang pos-tabel-keranjang--tabel">
          <table className="pos-tabel-cepat tabel-transaksi">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Produk</th>
                <th>SKU</th>
                <th className="num">Jumlah</th>
                <th className="num">Diskon</th>
                <th className="num">Harga</th>
                <th className="num">Subtotal</th>
                <th aria-label="Aksi" />
              </tr>
            </thead>
            <tbody ref={tabelRef}>
              {keranjang.map((b, r) => (
                <tr key={b.productId} className={`${sel?.r === r ? 'aktif' : ''}${sorotId === b.productId ? ' pos-baris-masuk' : ''}`}>
                  <td className="num pos-td-redup">{r + 1}</td>
                  <td className="pos-td-nama">{b.nama}</td>
                  <td className="pos-td-redup">{b.sku}</td>
                  <td className="num pos-td-sel">
                    <Sel
                      b={b}
                      r={r}
                      c={0}
                      nilai={String(b.qty)}
                      teks={teks[kunciSelTeks(b.productId, 0)]}
                      aktif={sel?.r === r && sel.c === 0}
                      onUbah={ubahSel}
                      onFokus={(rr, cc) => setSel({ r: rr, c: cc })}
                      onKeluar={akhiriSel}
                      onKunci={kunciSel}
                    />
                  </td>
                  <td className="num pos-td-sel">
                    <Sel
                      b={b}
                      r={r}
                      c={1}
                      nilai={String(b.diskon ?? 0)}
                      teks={teks[kunciSelTeks(b.productId, 1)]}
                      aktif={sel?.r === r && sel.c === 1}
                      onUbah={ubahSel}
                      onFokus={(rr, cc) => setSel({ r: rr, c: cc })}
                      onKeluar={akhiriSel}
                      onKunci={kunciSel}
                    />
                  </td>
                  <td className="num pos-td-sel">
                    <Sel
                      b={b}
                      r={r}
                      c={2}
                      nilai={String(b.harga)}
                      teks={teks[kunciSelTeks(b.productId, 2)]}
                      aktif={sel?.r === r && sel.c === 2}
                      onUbah={ubahSel}
                      onFokus={(rr, cc) => setSel({ r: rr, c: cc })}
                      onKeluar={akhiriSel}
                      onKunci={kunciSel}
                    />
                  </td>
                  <td className="num pos-td-total">{formatRupiah(b.qty * b.harga - (b.diskon ?? 0))}</td>
                  <td>
                    <button
                      type="button"
                      className="pos-sel-hapus"
                      aria-label={`Hapus ${b.nama}`}
                      onClick={() => hapusBaris(r)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {keranjang.length === 0 && (
            <p className="pos-kosong-sebaris"><span aria-hidden="true">🧺</span> Keranjang kosong — ketik produk di pencarian, Enter untuk menambah.</p>
          )}
        </div>

        {/* AP3 ponsel: kartu daftar — nama selalu terbaca 2 baris + hapus 44px. */}
        <div className="pos-kartu-cepat" ref={kartuRef} aria-label="Keranjang">
          {keranjang.length === 0 && (
            <p className="pos-kosong-sebaris"><span aria-hidden="true">🧺</span> Keranjang kosong — ketik produk di pencarian.</p>
          )}
          {keranjang.map((b, r) => (
            <article key={b.productId} className={`pos-item ${sorotId === b.productId ? 'pos-baris-masuk' : ''}`}>
              <div className="pos-item__atas">
                <span className="pos-item__no">{r + 1}</span>
                <span className="pos-item__nama">{b.nama}</span>
                <button type="button" className="pos-item__hapus" aria-label={`Hapus ${b.nama}`} onClick={() => hapusBaris(r)}>✕</button>
              </div>
              {b.sku && <div className="pos-item__sku">{b.sku}</div>}
              <div className="pos-item__bawah">
                <span className="pos-step">
                  <button type="button" aria-label={`Kurangi ${b.nama}`} onClick={() => ubahQty(b, -1)}>−</button>
                  <input inputMode="numeric" aria-label={`Jumlah ${b.nama}`} value={teks[kunciSelTeks(b.productId, 0)] ?? String(b.qty)} onChange={(e) => ubahSel(b, 0, e.target.value)} onBlur={() => akhiriSel(b, 0)} />
                  <button type="button" aria-label={`Tambah ${b.nama}`} onClick={() => ubahQty(b, 1)}>+</button>
                </span>
                <label className="pos-mini">Rp <input inputMode="numeric" aria-label={`Harga ${b.nama}`} value={teks[kunciSelTeks(b.productId, 2)] ?? formatAngka(b.harga)} onChange={(e) => ubahSel(b, 2, e.target.value)} onBlur={() => akhiriSel(b, 2)} /></label>
                <label className="pos-mini">−Rp <input inputMode="numeric" aria-label={`Diskon ${b.nama}`} value={teks[kunciSelTeks(b.productId, 1)] ?? formatAngka(b.diskon ?? 0)} onChange={(e) => ubahSel(b, 1, e.target.value)} onBlur={() => akhiriSel(b, 1)} /></label>
                <b className="pos-item__sub">{formatRupiah(b.qty * b.harga - (b.diskon ?? 0))}</b>
              </div>
            </article>
          ))}
        </div>

        <footer className="pos-ringkas pos-ringkas--cepat">
          <div className={`pos-sheet ${rincianBuka ? '' : 'pos-sheet--tutup'}`}>
            <div className="pos-total-ap">
              <div className="pos-total">
                <span>Total</span>
                <b>{formatRupiah(total)}</b>
                <small>Total Qty: {formatAngka(totalQty)}</small>
              </div>
              <button type="button" className="pos-rincian-btn" aria-expanded={rincianBuka} onClick={() => setRincianBuka((b) => !b)}>
                Rincian {rincianBuka ? '▾' : '▴'}
              </button>
            </div>
            <div className="pos-sheet__isi pos-ringkas__angka">
              <div className="r"><span>Subtotal</span><span>{formatRupiah(subtotal)}</span></div>
              <div className="r"><span>Diskon</span><span>− {formatRupiah(diskonTotal)}</span></div>
              <div className="r"><span>Pajak (%)</span><input id="pos-pajak" inputMode="numeric" aria-label="Persentase pajak" value={String(pajakPersen)} onChange={(e) => setPajakPersen(Math.min(100, Number(e.target.value.replace(/\D/g, '')) || 0))} /></div>
              <div className="r"><span>Pajak</span><span>{formatRupiah(pajak)}</span></div>
            </div>
          </div>
          <div className="pos-aksi pos-aksi--cepat">
            <button type="button" className="pos-aksi__ikon" aria-label="Tahan transaksi (F8)" title="Tahan (F8)" onClick={() => setDialog('tahan')} disabled={keranjang.length === 0}>⏸</button>
            <button type="button" className="pos-aksi__ikon" aria-label={`Transaksi tertahan (F9)${tertahanJumlah > 0 ? `, ${tertahanJumlah} menunggu` : ''}`} title="Tertahan (F9)" onClick={() => setDialog('tertahan')}>📋{tertahanJumlah > 0 && <span className="pos-aksi__badge">{tertahanJumlah}</span>}</button>
            <button type="button" className="tombol pos-aksi-bayar pos-bayar" onClick={bukaBayar} disabled={keranjang.length === 0}>
              Bayar {formatRupiah(total)} <span className="pos-bayar__kbd">Ctrl+Enter</span>
            </button>
          </div>
        </footer>
      </div>

      {/* ------------------------- dialog (sama dengan Mode Foto) ----------- */}
      {dialog === 'bayar' && (
        <DialogBayar
          total={total}
          items={keranjang}
          diskon={0}
          pajakPersen={pajakPersen}
          gudangId={gudangId}
          namaUsaha={usaha.nama}
          alamatUsaha={usaha.alamat || null}
          teleponUsaha={usaha.telepon || null}
          logoUrl={usaha.logo || null}
          modePos="cepat"
          onTutup={tutupDialog}
          onSukses={(s) => {
            setStruk(s);
            setKeranjang([]);
            setTeks({});
            setSel(null);
            setDialog(null);
            apiGet<{ data: ShiftAktif | null }>('/api/pos/shift/aktif')
              .then((x) => setShift(x.data))
              .catch(() => undefined);
            cariRef.current?.focus();
          }}
        />
      )}
      {dialog === 'tahan' && <DialogTahan onSimpan={tahanTransaksi} onTutup={tutupDialog} />}
      {dialog === 'tertahan' && <DialogTertahan onLanjut={lanjutkanTertahan} onTutup={tutupDialog} />}
      {dialog === 'shift-buka' && (
        <DialogShiftBuka
          onTutup={tutupDialog}
          onSukses={(sh) => {
            setShift(sh);
            setDialog(null);
            beritahu('Shift dibuka — selamat bertugas!', 'sukses');
            cariRef.current?.focus();
          }}
        />
      )}
      {dialog === 'shift-tutup' && shift && (
        <DialogShiftTutup
          shift={shift}
          onTutup={tutupDialog}
          onSukses={() => {
            setShift(null);
            beritahu('Shift ditutup.', 'sukses');
          }}
        />
      )}
      {dialog === 'layanan' && (
        <DialogLayanan namaUsaha={usaha.nama} profil={profilStruk} onTutup={tutupDialog} />
      )}
      {dialog === 'piutang' && (
        <DialogPiutang
          onTutup={tutupDialog}
          onSukses={() => {
            apiGet<{ data: ShiftAktif | null }>('/api/pos/shift/aktif')
              .then((x) => setShift(x.data))
              .catch(() => undefined);
          }}
        />
      )}
      {struk && (
        <DialogStruk
          struk={struk}
          profil={profilStruk}
          cetakOtomatis={cetakOtomatis}
          onBaru={() => {
            setStruk(null);
            setKeranjang([]);
            setTeks({});
            setSel(null);
            cariRef.current?.focus();
          }}
          onTutup={() => {
            setStruk(null);
            cariRef.current?.focus();
          }}
        />
      )}
      {/* M5 — konfirmasi ganti mode bila keranjang tidak kosong. */}
      {konfirmasiMode && (
        <Modal
          judul="Ganti mode POS?"
          lebar="kecil"
          onTutup={() => setKonfirmasiMode(false)}
          aksi={
            <>
              <button
                type="button"
                className="tombol tombol--netral"
                onClick={() => setKonfirmasiMode(false)}
              >
                Batal
              </button>
              <button
                type="button"
                className="tombol tombol--primer"
                onClick={() => {
                  setKonfirmasiMode(false);
                  gantiKeFoto();
                }}
              >
                Ganti mode
              </button>
            </>
          }
        >
          <p>
            Keranjang berisi <b>{keranjang.length}</b> baris. Isi keranjang akan dipindahkan ke{' '}
            <b>Mode Foto</b> — tidak ada barang yang hilang.
          </p>
        </Modal>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { beritahu } from '../../components/crud/Toast';
import { Modal } from '../../components/crud/Modal';
import { IconButton } from '../../components/IconButton';
import { TombolScan } from '../../components/ScanKamera';
import { ambilOpsi, apiDelete, apiGet, apiPost } from '../../lib/api';
import { formatAngka, formatRupiah } from '../../lib/format';
import { setModePosTerakhir } from '../../lib/pengguna';
import { useGardaForm } from '../../lib/gardaForm';
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
import {
  type BarisKeranjang,
  type Opsi,
  type ProdukPos,
  type ShiftAktif,
} from './tipe';
import { buangPindahMode, peekPindahMode } from './pindahMode';
import { PopupTutorial, mintaBukaTutorial } from '../../components/PopupTutorial';
import { useSesi } from '../../lib/sesi';
import { TIP_GUDANG_TERKUNCI, idGudangBawaan, idGudangTerkunci } from '../../lib/gudang';
import { putarUmpanBalikScan } from '../../lib/umpanBalikScan';
import { JamTransaksi } from './JamTransaksi';
import { useUsaha } from '../../lib/usaha';
import './pos.css';
import './pos-deep-teal.css';
import './pos-sage.css';

type NamaDialog = 'bayar' | 'tahan' | 'tertahan' | 'shift-buka' | 'shift-tutup' | 'layanan' | 'piutang' | null;

/** Batas awal kartu hasil; sisanya lewat tombol "Tampilkan lebih banyak". */
const BATAS_AWAL = 24;

/**
 * X4.1/X4.2 — Foto produk dengan skeleton + fallback placeholder bertema.
 * Gagal muat (404/jaringan) jatuh ke inisial tanpa ikon rusak; peringatan
 * dicatat ke konsol, bukan ke pengguna.
 */
function FotoProduk({ src, nama, kategoriId }: { src: string | null; nama: string; kategoriId: number | null }) {
  const [adaGalat, setAdaGalat] = useState(false);
  const [sibuk, setSibuk] = useState(!!src);
  const inisial = nama
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((k) => k.charAt(0))
    .join('')
    .toUpperCase();
  // Warna aksen halus per kategori (turunkan hue dari id kategori).
  const hue = kategoriId ? (kategoriId * 47) % 360 : 220;

  if (!src || adaGalat) {
    return (
      <div
        className="pos-kartu__kosong"
        style={{ '--aksen-inisial': `hsl(${hue} 45% 55%)` } as React.CSSProperties}
        aria-hidden="true"
      >
        {inisial || ' Barang'}
      </div>
    );
  }
  return (
    <img
      className={`pos-kartu__foto ${sibuk ? 'pos-kartu__foto--skeleton' : ''}`}
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onLoad={() => setSibuk(false)}
      onError={() => {
        console.warn(`[POS] Gagal memuat foto "${nama}" (${src}) — memakai placeholder.`);
        setAdaGalat(true);
        setSibuk(false);
      }}
    />
  );
}

/** Izinkan menjual barang stok habis? (opsi kasir, tersimpan lokal). */
const KUNCI_BOLEH_HABIS = 'nusapos.pos.boleh-habis';
const bacaBolehHabis = () => localStorage.getItem(KUNCI_BOLEH_HABIS) === 'true';

/* Y1.4 — ukuran kartu (kecil / sedang / besar): dipilih lewat ikon di bilah atas
   dan disimpan per pengguna. Nilai = lebar minimum kartu (token --kartu-min). */
type UkuranKartu = 'kecil' | 'sedang' | 'besar';
const KUNCI_UKURAN_KARTU = 'nusapos.pos.kartu-ukuran';
const URUTAN_UKURAN: UkuranKartu[] = ['kecil', 'sedang', 'besar'];
const UKURAN_PX: Record<UkuranKartu, string> = { kecil: '132px', sedang: '160px', besar: '196px' };
const LABEL_UKURAN: Record<UkuranKartu, string> = { kecil: 'Kecil', sedang: 'Sedang', besar: 'Besar' };
function bacaUkuranKartu(): UkuranKartu {
  const v = localStorage.getItem(KUNCI_UKURAN_KARTU);
  return (URUTAN_UKURAN as string[]).includes(v ?? '') ? (v as UkuranKartu) : 'sedang';
}

/**
 * POS Mode Foto — layar penuh kasir:
 *   kiri grid kartu produk (foto, nama, harga, stok), kanan keranjang;
 *   keyboard penuh (F2/F4/F8/F9, panah, +/-, Delete, Esc), scan barcode,
 *   pembayaran campuran, shift kasir, void & retur PIN supervisor.
 */
export function PosFoto({ modeAwal }: { modeAwal?: 'foto' | 'teks' }) {
  // M5 — isi keranjang dipindahkan dari mode lain (dibaca sekali saat mount).
  const [pindahan] = useState(peekPindahMode);
  // SINGLE-PAGE DUAL-MODE — Foto & Teks satu halaman, ganti instan tanpa
  // navigasi/reload. Keranjang, gudang, shift, diskon ikut utuh (satu state).
  const KUNCI_TAMPIL = 'nusapos.pos.tampil';
  const [modeTampil, setModeTampil] = useState<'foto' | 'teks'>(() => {
    if (modeAwal === 'foto' || modeAwal === 'teks') return modeAwal;
    try {
      return localStorage.getItem(KUNCI_TAMPIL) === 'teks' ? 'teks' : 'foto';
    } catch {
      return 'foto';
    }
  });
  const [produk, setProduk] = useState<ProdukPos[]>([]);
  // Identitas usaha global — header, bayar & struk selalu memakai data terbaru
  // Pengaturan ▸ Profil Usaha tanpa perlu muat ulang halaman.
  const usaha = useUsaha();
  const [cari, setCari] = useState('');
  const [kategoriId, setKategoriId] = useState<number | null>(null);
  const [gudangOpsi, setGudangOpsi] = useState<Opsi[]>([]);
  const [gudangId, setGudangId] = useState(0);
  // WI — kasir dengan akses satu gudang: form terkunci di gudang itu.
  const sesiInfo = useSesi().info;
  const gudangTerkunci = idGudangTerkunci(sesiInfo, gudangOpsi);
  const [shift, setShift] = useState<ShiftAktif | null>(null);
  const [keranjang, setKeranjang] = useState<BarisKeranjang[]>(() => pindahan?.items ?? []);
  const [diskon, setDiskon] = useState(() =>
    pindahan && pindahan.diskon > 0 ? String(pindahan.diskon) : '',
  );
  const [pajakPersen, setPajakPersen] = useState(0);
  const [fokus, setFokus] = useState(0);
  const [barisTerpilih, setBarisTerpilih] = useState(0);
  // Sorot singkat item keranjang yang baru masuk (animasi .pos-baris-masuk).
  const [sorotId, setSorotId] = useState<number | null>(null);
  const [dialog, setDialog] = useState<NamaDialog>(null);
  const [struk, setStruk] = useState<StrukData | null>(null);
  const [bantuanTerbuka, setBantuanTerbuka] = useState(false);
  // BAGIAN J1 — pencarian grid HANYA saat Enter (tanpa live-typing).
  // `kataTunda` = kata kunci yang sudah di-Enter; `paksaSemua` = tampilkan
  // seluruh katalog (Enter pada input kosong / chip kategori "Semua").
  const [kataTunda, setKataTunda] = useState('');
  const [paksaSemua, setPaksaSemua] = useState(false);
  const [batas, setBatas] = useState(BATAS_AWAL);
  // BAGIAN J3/J4 — profil struk aktif & cetak otomatis setelah bayar.
  const [profilStruk, setProfilStruk] = useState<ProfilStruk | null>(null);
  const [cetakOtomatis, setCetakOtomatis] = useState(false);
  // X4.3 — boleh tambah barang stok habis (opsi kasir, tersimpan lokal).
  const [bolehHabis, setBolehHabis] = useState(bacaBolehHabis);
  // Y1.4 — ukuran kartu per pengguna; Y1.1 — rasio gambar dari pengaturan POS;
  // Y1.4 — keranjang menjadi laci bawah pada layar sempit (<1024px).
  const [ukuranKartu, setUkuranKartu] = useState<UkuranKartu>(bacaUkuranKartu);
  const [rasioFoto, setRasioFoto] = useState('1/1');
  const [laciBuka, setLaciBuka] = useState(false);
  // AP1/AP4 — menu titik-tiga, popover shift, sheet rincian (tampilan saja).
  const [menuBuka, setMenuBuka] = useState(false);
  const [shiftBuka, setShiftBuka] = useState(false);
  const [rincianBuka, setRincianBuka] = useState(false);
  const [tertahanJumlah, setTertahanJumlah] = useState(0);
  const [fokusAngka, setFokusAngka] = useState<'diskon' | 'pajak' | null>(null);
  // Pelanggan & catatan transaksi (panel kanan) — masuk payload /api/pos/sales.
  const [pelangganId, setPelangganId] = useState('');
  const [pelangganOpsi, setPelangganOpsi] = useState<Opsi[]>([]);
  const [pelangganMemuat, setPelangganMemuat] = useState(false);
  const [catatan, setCatatan] = useState('');
  // Token Edit — ?edit=<id> memuat ulang penjualan ke keranjang & dialog bayar.
  const [params] = useSearchParams();
  const editId = Number(params.get('edit') ?? 0) || null;
  // WI — gudang terkunci menang, kecuali saat mengedit dokumen (mengikuti
  // gudang dokumen yang sedang dimuat).
  useEffect(() => {
    if (gudangTerkunci !== null && !editId) setGudangId(gudangTerkunci);
  }, [gudangTerkunci, editId]);
  const navigasi = useNavigate();
  const [pembayaranLama, setPembayaranLama] = useState<{ metode: string; jumlah: number }[]>([]);
  const [tambahPelanggan, setTambahPelanggan] = useState(false);
  const [namaPelangganBaru, setNamaPelangganBaru] = useState('');
  const [teleponPelangganBaru, setTeleponPelangganBaru] = useState('');
  const [simpanPelanggan, setSimpanPelanggan] = useState(false);
  const namaPelangganTerpilih = pelangganOpsi.find((o) => o.id === Number(pelangganId))?.label ?? null;

  // Opsi pelanggan dimuat malas (saat dropdown difokus) agar buka kasir tetap ringan.
  const muatPelanggan = async () => {
    if (pelangganOpsi.length > 0 || pelangganMemuat) return;
    setPelangganMemuat(true);
    try {
      setPelangganOpsi(await ambilOpsi('pelanggan'));
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    } finally {
      setPelangganMemuat(false);
    }
  };

  // [+ Baru] — pelanggan cepat tanpa pindah ke Master Data.
  const simpanPelangganBaru = async () => {
    const nama = namaPelangganBaru.trim();
    if (!nama || simpanPelanggan) return;
    setSimpanPelanggan(true);
    try {
      // Badan lengkap: limit_piutang wajib angka (kolom NOT NULL) dan
      // aktif boolean — nilai default generik (null) ditolak database.
      const r = await apiPost<{ id: number }>('/api/master/pelanggan', {
        nama,
        telepon: teleponPelangganBaru.trim() || null,
        alamat: null,
        limit_piutang: 0,
        aktif: true,
      });
      setPelangganOpsi(await ambilOpsi('pelanggan'));
      setPelangganId(String(r.id));
      setTambahPelanggan(false);
      setNamaPelangganBaru('');
      setTeleponPelangganBaru('');
      beritahu(`Pelanggan "${nama}" ditambahkan.`, 'sukses');
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    } finally {
      setSimpanPelanggan(false);
    }
  };

  const cariRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  /** Pindahkan fokus DOM ke kartu/baris katalog indeks ke-i (navigasi keyboard). */
  const fokusKeDaftar = (i: number): void => {
    const el =
      stateTerbaru.current.modeTampil === 'teks'
        ? tabelRef.current?.querySelectorAll('[data-baris]')[i]?.querySelector('button')
        : gridRef.current?.children[i]?.querySelector('button');
    (el as HTMLElement | undefined)?.focus();
  };
  const keranjangRef = useRef<HTMLDivElement>(null);
  const bufferPindai = useRef<string[]>([]);
  const waktuPindai = useRef(0);
  const tabelRef = useRef<HTMLDivElement>(null);
  const stateTerbaru = useRef({ keranjang, dialog, struk, fokus, terlihat: [] as ProdukPos[], barisTerpilih, gudangId, produk, modeTampil: 'foto' as 'foto' | 'teks' });
  const cariRefValue = useRef(cari);

  const stokGudang = (p: ProdukPos): number => Number(p.stok_gudang[String(gudangId)] ?? 0);

  const kategori = useMemo(() => {
    const peta = new Map<number, string>();
    for (const p of produk) if (p.category_id && p.kategori) peta.set(p.category_id, p.kategori);
    return [...peta.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [produk]);

  /** Terapkan kata kunci ke grid (dipanggil HANYA dari Enter). */
  const terapkanCari = (kata: string): void => {
    setKataTunda(kata.trim());
    setPaksaSemua(kata.trim() === '');
    setFokus(0);
    setBatas(BATAS_AWAL);
  };

  // Pencarian multi-kata: SEMUA kata harus cocok di nama / kode / SKU / barcode.
  const terlihatSemua = useMemo(() => {
    const kata = kataTunda.toLowerCase().split(/\s+/).filter(Boolean);
    return produk.filter((p) => {
      if (kategoriId !== null && p.category_id !== kategoriId) return false;
      // Tanpa kata: chip kategori terpilih ATAU pengguna minta seluruh katalog.
      if (kata.length === 0) return kategoriId !== null || paksaSemua;
      const serendah = [p.nama, p.kode_item ?? '', p.sku, p.barcode ?? ''].join(' ').toLowerCase();
      return kata.every((k) => serendah.includes(k));
    });
  }, [produk, kataTunda, kategoriId, paksaSemua]);

  const terlihat = useMemo(() => terlihatSemua.slice(0, batas), [terlihatSemua, batas]);
  /** Grid tampil bila ada kata kunci, chip kategori terpilih, atau mode semua. */
  const gridTampil = kataTunda !== '' || kategoriId !== null || paksaSemua;

  // Sinkronkan snapshot terbaru untuk handler keyboard global.
  stateTerbaru.current = { keranjang, dialog, struk, fokus, terlihat, barisTerpilih, gudangId, produk, modeTampil };
  cariRefValue.current = cari;

  /* ------------------------- muat data awal ------------------------------ */
  // M4/M6 — catat mode ini sebagai mode POS terakhir (tombol POS / F9),
  // dan buang payload pindahan mode setelah dipakai.
  useEffect(() => {
    setModePosTerakhir(modeTampil === 'foto' ? 'foto' : 'cepat');
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
    const el = document.querySelector('.pos-shell:not(.pos-shell--cepat)') as HTMLElement | null;
    const atur = () => {
      document.documentElement.style.setProperty('--pos-vv', `${vv.height}px`);
      el?.classList.toggle('pos-shell--kbd', vv.height < window.innerHeight * 0.85);
    };
    atur();
    vv.addEventListener('resize', atur);
    return () => vv.removeEventListener('resize', atur);
  }, []);

  // ISOLASI GUDANG KETAT (ala Mode Tanpa Foto): grid HANYA memuat produk yang
  // punya catatan saldo di gudang aktif (?gudang=...). Barang gudang lain tidak
  // pernah masuk katalog, kategori, maupun hasil scan barcode.
  const segarkanProduk = useCallback(async (gid?: number) => {
    const id = gid ?? stateTerbaru.current.gudangId;
    if (!id) return;
    try {
      const g = await apiGet<{ data: ProdukPos[] }>(`/api/pos/produk?gudang=${id}`);
      setProduk(g.data);
    } catch {
      /* biarkan daftar lama — jaringan/endpoint sementara tidak tersedia */
    }
  }, []);

  // AUTOISOLASI SWITCH GUDANG: ganti gudang aktif → grid direfresh terkunci ke
  // gudang baru + keranjang dikosongkan agar barang antar-gudang tidak tercampur.
  const gudangPertama = useRef(true);
  const lewatiIsolasi = useRef(false);
  useEffect(() => {
    if (!gudangId) return;
    if (gudangPertama.current) {
      gudangPertama.current = false;
      return;
    }
    if (lewatiIsolasi.current) {
      // Muatan transaksi tertahan: keranjang milik gudang itu — refresh grid saja.
      lewatiIsolasi.current = false;
      void segarkanProduk(gudangId);
      return;
    }
    setKeranjang([]);
    setDiskon('');
    setBarisTerpilih(0);
    setKategoriId(null);
    setCari('');
    void segarkanProduk(gudangId);
    beritahu('Gudang diganti — grid & keranjang disesuaikan ke gudang baru.', 'info', 2500);
  }, [gudangId, segarkanProduk]);

  useEffect(() => {
    (async () => {
      try {
        const [s, go, struk] = await Promise.all([
          apiGet<{ data: ShiftAktif | null }>('/api/pos/shift/aktif'),
          ambilOpsi('gudang'),
          apiGet<{ data: ProfilStruk[]; pengaturan: { cetak_otomatis: boolean } }>('/api/struk/profil').catch(() => null),
        ]);
        setShift(s.data);
        setGudangOpsi(go);
        if (struk) {
          setProfilStruk(struk.data.find((x) => x.bawaan) ?? struk.data[0] ?? null);
          setCetakOtomatis(Boolean(struk.pengaturan?.cetak_otomatis));
        }
        // M5 — gudang dipertahankan dari mode lain bila ada pindahan mode,
        // sama seperti Mode Tanpa Foto (opsi pertama sebagai bawaan).
        const terkunci = idGudangTerkunci(sesiInfo, go);
        // WI2 — gudang default pengguna terpilih otomatis, lalu opsi pertama.
        const awal = terkunci ?? (pindahan?.gudangId || idGudangBawaan(sesiInfo, go) || go[0]?.id || 0);
        // Mode edit: gudang mengikuti dokumen (diisi efek Token Edit di bawah).
        if (!editId) setGudangId(awal);
        // Grid langsung dikunci ke gudang aktif — tidak pernah memuat global.
        if (awal) {
          const g = await apiGet<{
            data: ProdukPos[];
            pengaturan: { pajak_persen: number; nama_usaha: string; pos_foto_rasio?: string };
          }>(`/api/pos/produk?gudang=${awal}`);
          setProduk(g.data);
          setPajakPersen(Number(g.pengaturan.pajak_persen) || 0);
          // Y1.1 — rasio gambar kartu mengikuti pengaturan POS (bawaan 1:1).
          setRasioFoto(g.pengaturan.pos_foto_rasio === '4/3' ? '4/3' : '1/1');
        }
        cariRef.current?.focus();
      } catch (e) {
        beritahu((e as Error).message, 'galat');
      }
    })();
  }, []);

  /* --------------------- Token Edit (?edit=<id>) ------------------------- */
  // Memuat ulang transaksi lama ke keranjang, pelanggan, diskon, PPN, dan
  // metode bayar; penyimpanan memakai PUT sehingga server merekonsiliasi
  // stok, kas, piutang, dan snapshot faktur.
  useEffect(() => {
    if (!editId) return;
    (async () => {
      try {
        const r = await apiGet<{ data: Record<string, any> }>(`/api/pos/sales/${editId}`);
        const s = r.data;
        const wh = Number(s.warehouse_id);
        if (wh) {
          lewatiIsolasi.current = true;
          setGudangId(wh);
        }
        setPembayaranLama(
          ((s.payments ?? []) as Record<string, any>[]).map((p) => ({
            metode: String(p.metode),
            jumlah: Number(p.jumlah) || 0,
          })),
        );
        setPelangganId(s.customer_id ? String(s.customer_id) : '');
        setCatatan(String(s.notes ?? ''));
        setDiskon(Number(s.diskon) > 0 ? String(Number(s.diskon)) : '');
        // PPN tersimpan sebagai nominal — hitung ulang tarifnya untuk form.
        const dasar = Math.max(0, Number(s.subtotal) - Number(s.diskon));
        setPajakPersen(dasar > 0 ? Math.round((Number(s.pajak) / dasar) * 100) : 0);
        setKeranjang(
          ((s.items ?? []) as Record<string, any>[]).map((i) => ({
            productId: Number(i.product_id),
            nama: String(i.nama_produk ?? ''),
            sku: String(i.sku ?? ''),
            harga: Number(i.harga) || 0,
            qty: Number(i.qty) || 0,
            stok: Number(i.qty) || 0,
            diskon: Number(i.diskon) || 0,
          })),
        );
        setBarisTerpilih(0);
        beritahu(`Mengedit ${String(s.no_dokumen)} — ubah data lalu simpan.`, 'info', 4000);
      } catch (e) {
        beritahu((e as Error).message, 'galat');
      }
    })();
  }, [editId]);

  // Fokuskan kartu/baris yang sedang dipilih keyboard (grid maupun tabel teks).
  useEffect(() => {
    if (modeTampil === 'teks') {
      const baris = tabelRef.current?.querySelectorAll('[data-baris]')[fokus] as HTMLElement | undefined;
      baris?.scrollIntoView({ block: 'nearest' });
      return;
    }
    const el = gridRef.current?.children[fokus] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [fokus, terlihat.length, modeTampil]);

  // Auto-scroll + sorot: item keranjang terbaru selalu terlihat tanpa scroll manual.
  const jumlahBaris = keranjang.length;
  useEffect(() => {
    if (jumlahBaris === 0) return;
    const akhir = keranjang[jumlahBaris - 1];
    setSorotId(akhir.productId);
    const t = window.setTimeout(() => setSorotId(null), 1200);
    requestAnimationFrame(() => {
      keranjangRef.current?.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumlahBaris]);

  /* ------------------------- aksi keranjang ------------------------------ */

  // X4.2 — foto hasil unggah (massal/tunggal) tampil tanpa muat ulang halaman:
  // daftar produk disegarkan saat jendela kembali fokus atau ada event
  // 'produk-berubah' dari Master Produk (tetap terkunci ke gudang aktif).
  useEffect(() => {
    const onSegar = () => void segarkanProduk();
    window.addEventListener('focus', onSegar);
    window.addEventListener('produk-berubah', onSegar);
    return () => {
      window.removeEventListener('focus', onSegar);
      window.removeEventListener('produk-berubah', onSegar);
    };
  }, [segarkanProduk]);

  /** true bila barang benar-benar masuk keranjang — dipakai umpan balik kartu (Y1.2). */
  const tambah = (p: ProdukPos): boolean => {
    const stok = stokGudang(p);
    const harga = Number(p.harga);
    if (harga <= 0) {
      beritahu(`${p.nama} belum punya harga jual — atur di Master › Produk.`, 'galat');
      return false;
    }
    if (stok <= 0 && !bolehHabis) {
      beritahu(`Stok ${p.nama} habis di gudang terpilih.`, 'galat');
      return false;
    }
    const i = keranjang.findIndex((b) => b.productId === p.id);
    const qtySkrg = i >= 0 ? keranjang[i].qty : 0;
    if (stok > 0 && qtySkrg + 1 > stok) {
      beritahu(`Stok ${p.nama} di gudang terpilih sisa ${stok}.`, 'galat');
      return false;
    }
    if (i >= 0) {
      setKeranjang(keranjang.map((b, idx) => (idx === i ? { ...b, qty: b.qty + 1 } : b)));
      setBarisTerpilih(i);
    } else {
      setKeranjang([
        ...keranjang,
        { productId: p.id, nama: p.nama, sku: p.sku, harga, qty: 1, stok },
      ]);
      setBarisTerpilih(keranjang.length);
    }
    // J1: kolom cari tetap fokus setelah barang ditambahkan.
    cariRef.current?.focus();
    return true;
  };

  /** Pilih barang (klik maupun Enter): tambah + reset pencarian siap transaksi berikut.
   *  Mengosongkan input, mengembalikan fokus, dan mereset filter/batas katalog
   *  sehingga grid kembali ke kondisi siap (atau filter kategori bila ada chip).
   *  Hanya saat tambah() berhasil — stok habis/harga nol tidak mereset ketikan. */
  const pilihProduk = (p: ProdukPos): boolean => {
    if (!tambah(p)) return false;
    setCari('');
    setKataTunda('');
    setBatas(BATAS_AWAL);
    cariRef.current?.focus();
    cariRef.current?.select();
    return true;
  };

  // Y1.2 — umpan balik singkat saat kartu diklik: animasi kecil sekali jalan
  // (kelas dilepas lewat onAnimationEnd agar tidak menumpuk).
  const pukulKartu = (el: HTMLElement) => {
    el.classList.remove('pos-kartu--pukul');
    void el.offsetWidth; // paksa reflow supaya animasi bisa berjalan ulang
    el.classList.add('pos-kartu--pukul');
  };

  const ubahQty = (i: number, d: number) => {
    setKeranjang(keranjang.map((b, idx) => (idx === i ? { ...b, qty: Math.max(1, Math.min(b.stok, b.qty + d)) } : b)));
  };

  const aturQty = (i: number, nilai: number) => {
    if (!Number.isFinite(nilai)) return;
    const batas = Math.max(1, Math.min(keranjang[i]?.stok ?? nilai, Math.trunc(nilai)));
    if (batas < 1) return;
    setKeranjang(keranjang.map((b, idx) => (idx === i ? { ...b, qty: batas } : b)));
  };

  const hapusBaris = (i: number) => {
    if (i < 0 || i >= keranjang.length) return;
    setKeranjang(keranjang.filter((_, idx) => idx !== i));
    setBarisTerpilih(Math.max(0, Math.min(i, keranjang.length - 2)));
  };

  const kosongkanKeranjang = () => {
    if (keranjang.length === 0) return;
    setKeranjang([]);
    setDiskon('');
    setBarisTerpilih(0);
    beritahu('Keranjang dikosongkan.', 'info', 2500);
  };

  /* ----------------- ganti mode tampilan (in-place, M5 baru) -------------- */
  // Satu halaman: hanya tukar DOM grid ↔ tabel. Tidak ada navigasi, tidak ada
  // reload — keranjang, diskon, gudang, dan shift tetap utuh apa adanya.
  const gantiModeTampil = (m: 'foto' | 'teks') => {
    setModeTampil((lama) => {
      if (lama === m) return lama;
      try {
        localStorage.setItem(KUNCI_TAMPIL, m);
      } catch {
        /* abaikan */
      }
      setModePosTerakhir(m === 'foto' ? 'foto' : 'cepat');
      return m;
    });
    setFokus(0);
    requestAnimationFrame(() => cariRef.current?.focus());
  };

  const tanyaGantiMode = () => {
    gantiModeTampil(modeTampil === 'foto' ? 'teks' : 'foto');
  };

  const pindaiBarcode = (kode: string): boolean => {
    const kunci = kode.trim().toLowerCase();
    if (!kunci) return false;
    const p = produk.find(
      (x) =>
        (x.barcode ?? '').toLowerCase() === kunci ||
        x.sku.toLowerCase() === kunci ||
        (x.kode_item ?? '').toLowerCase() === kunci,
    );
    if (p) {
      tambah(p);
      putarUmpanBalikScan('ok');
      return true;
    }
    // ISOLASI GUDANG — katalog terkunci gudang aktif: barcode tak cocok
    // berarti barang tidak terdaftar di gudang ini (bukan sekadar typo).
    const labelGudang = gudangOpsi.find((o) => o.id === gudangId)?.label;
    putarUmpanBalikScan('gagal');
    beritahu(
      labelGudang ? `Barang ini tidak terdaftar di ${labelGudang}.` : `Barcode "${kode.trim()}" tidak ditemukan.`,
      'galat',
    );
    return false;
  };

  /* ------------------------- transaksi tertahan --------------------------- */
  const tahanTransaksi = async (nama: string) => {
    await apiPost('/api/pos/held', {
      nama,
      data: { items: keranjang, diskon: Number(diskon) || 0, pajak_persen: pajakPersen, gudangId },
    });
    setKeranjang([]);
    setDiskon('');
    setDialog(null);
    beritahu('Transaksi ditahan — lanjutkan dengan F9.', 'sukses');
  };

  const muatTertahan = async () => {
    setDialog('tertahan');
  };

  const lanjutkanTertahan = async (b: BarisTertahan) => {
    if (!b.data) return;
    setKeranjang(b.data.items ?? []);
    setDiskon(b.data.diskon ? String(b.data.diskon) : '');
    setPajakPersen(Number(b.data.pajak_persen ?? pajakPersen));
    // Keranjang tertahan milik gudangnya sendiri — jangan dikosongkan isolasi.
    if (b.data.gudangId && b.data.gudangId !== stateTerbaru.current.gudangId) {
      lewatiIsolasi.current = true;
      setGudangId(b.data.gudangId);
    }
    await apiDelete(`/api/pos/held/${b.id}`);
    setDialog(null);
    beritahu('Transaksi tertahan dimuat kembali.', 'sukses');
  };

  /* ------------------------- total ---------------------------------------- */
  const subtotal = keranjang.reduce((a, b) => a + b.qty * b.harga, 0);
  const totalQty = keranjang.reduce((a, b) => a + b.qty, 0);
  const diskonNum = Math.max(0, Number(diskon.replace(/\D/g, '')) || 0);
  const dasar = Math.max(0, subtotal - diskonNum);
  const pajak = Math.round((dasar * pajakPersen) / 100);
  const total = dasar + pajak;

  const bukaBayar = () => {
    if (keranjang.length === 0) {
      beritahu('Keranjang kosong — pilih produk dulu (Enter).', 'info', 2500);
      return;
    }
    if (!shift) {
      beritahu('Buka kasir dulu sebelum bertransaksi.', 'galat');
      setDialog('shift-buka');
      return;
    }
    setDialog('bayar');
  };

  /* ------------------------- keyboard global ------------------------------ */
  const handlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  handlerRef.current = (e: KeyboardEvent) => {
    const s = stateTerbaru.current;
    const target = e.target as HTMLElement | null;
    const diInput =
      !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);

    // Fungsi yang selalu aktif (kecuali saat dialog terbuka — biarkan modal yang mengurus).
    if (!s.dialog && !s.struk) {
      if (e.key === 'F1') {
        e.preventDefault();
        cariRef.current?.focus();
        cariRef.current?.select();
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
          document.getElementById('pos-diskon')?.focus();
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
        void muatTertahan();
        return;
      }
      if (e.key === '?' && !diInput) {
        e.preventDefault();
        setBantuanTerbuka((b) => !b);
        return;
      }
      if (e.key === 'Escape') {
        // Esc: hilangkan sorotan & kembalikan fokus ke pencarian.
        // (Kosongkan keranjang pindah ke Shift+F8 — Esc tidak lagi menghapus.)
        e.preventDefault();
        setFokus(-1);
        cariRef.current?.focus();
        cariRef.current?.select();
        return;
      }
    }
    if (s.dialog || s.struk) return;
    if (diInput) return;

    // Enter: akhiri scan barcode bila buffer terisi, kalau tidak tambah kartu fokus.
    if (e.key === 'Enter') {
      e.preventDefault();
      const buffer = bufferPindai.current.join('');
      bufferPindai.current = [];
      if (buffer.length >= 3) {
        pindaiBarcode(buffer);
        return;
      }
      const p = s.terlihat[s.fokus];
      if (p) pilihProduk(p);
      return;
    }

    // Buffer pengetikan cepat = scanner barcode.
    if (e.key.length === 1) {
      const now = Date.now();
      if (now - waktuPindai.current > 60) bufferPindai.current = [];
      waktuPindai.current = now;
      bufferPindai.current.push(e.key);
      return;
    }

    const kolom = () => {
      // Mode teks = daftar 1 kolom (tulus ke bawah/atas per baris).
      if (stateTerbaru.current.modeTampil === 'teks') return 1;
      const grid = gridRef.current;
      const kartu = grid?.firstElementChild as HTMLElement | null;
      if (!grid || !kartu) return 4;
      return Math.max(1, Math.floor((grid.clientWidth + 10) / (kartu.offsetWidth + 10)));
    };

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setFokus(Math.min(s.terlihat.length - 1, s.fokus + 1));
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setFokus(Math.max(0, s.fokus - 1));
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      // ArrowUp di paling atas (atau tanpa sorotan): kembali ke pencarian.
      if (e.key === 'ArrowUp' && s.fokus <= 0) {
        setFokus(-1);
        cariRef.current?.focus();
        cariRef.current?.select();
        return;
      }
      const langkah = e.key === 'ArrowDown' ? kolom() : -kolom();
      const lanjut = Math.max(0, Math.min(s.terlihat.length - 1, s.fokus + langkah));
      setFokus(lanjut);
      // Ikutkan fokus DOM agar Enter langsung menambah barang tersorot.
      requestAnimationFrame(() => fokusKeDaftar(lanjut));
      return;
    }
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      ubahQty(s.barisTerpilih, 1);
      return;
    }
    if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      ubahQty(s.barisTerpilih, -1);
      return;
    }
    if (e.key === 'Delete') {
      e.preventDefault();
      hapusBaris(s.barisTerpilih);
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

  /* ------------------------- render --------------------------------------- */
  return (
    <div className="pos-shell">
      <PopupTutorial />
      {garda}
      <header className="pos-kepala">
        {/* AP1 ponsel: kembali · judul · chip shift · titik-tiga (satu baris 52px). */}
        <button type="button" className="pos-kembali pos-hanya-ap" aria-label="Kembali ke Penjualan" onClick={() => minta('/penjualan')}>
          ‹
        </button>
        <h1 className="pos-judul-ap pos-hanya-ap">POS {modeTampil === 'foto' ? 'Foto' : 'Teks'}</h1>
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
          {/* M5 — jejak: Penjualan > POS (satu halaman, dua mode tampilan) */}
          <Link className="pos-jejak" to="/penjualan">
            Penjualan
          </Link>
          <span className="pos-pemisah" aria-hidden="true">›</span>
          POS (Mode {modeTampil === 'foto' ? 'Foto' : 'Teks'}) <span className="pos-toko">{usaha.nama}</span>
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
          <button type="button" className="pos-tombol-keluar" onClick={tanyaGantiMode} title="Ganti mode tampilan — halaman & keranjang tetap sama [F2]">
            {modeTampil === 'foto' ? 'Mode Tanpa Foto' : 'Mode Foto'} <span className="pos-kbd">F2</span>
          </button>
          <span className="pos-panduan-ikon">
            <IconButton ikon="message-circle" label="Panduan halaman ini" arah="bawah" ukuran="toolbar" onClick={() => mintaBukaTutorial()} />
          </span>
          {/* Y1.4 — ukuran kartu (kecil → sedang → besar), tersimpan per pengguna. */}
          <IconButton
            ikon="grid"
            label={`Ukuran kartu: ${LABEL_UKURAN[ukuranKartu]} — klik untuk mengganti`}
            arah="bawah"
            ukuran="toolbar"
            aktif={ukuranKartu !== 'sedang'}
            onClick={() => {
              setUkuranKartu((u) => {
                const baru = URUTAN_UKURAN[(URUTAN_UKURAN.indexOf(u) + 1) % URUTAN_UKURAN.length];
                localStorage.setItem(KUNCI_UKURAN_KARTU, baru);
                return baru;
              });
            }}
          />
          {/* Y1.3 — tombol "Pintasan (F1)" berupa ikon keyboard di bilah atas:
              latar solid, tidak menutupi kartu. */}
          <div className="pos-bantuan">
            {bantuanTerbuka && (
              <div className="pos-bantuan__panel">
                <h4>Pintasan keyboard</h4>
                <dl>
                  <dt>F1</dt>
                  <dd>Fokus pencarian</dd>
                  <dt>F2</dt>
                  <dd>Ganti mode Foto / Teks (satu halaman, keranjang utuh)</dd>
                  <dt>F3</dt>
                  <dd>Fokus diskon</dd>
                  <dt>← ↑ ↓ →</dt>
                  <dd>Berpindah kartu/baris (↓ dari pencarian langsung ke barang)</dd>
                  <dt>Enter</dt>
                  <dd>Tambah ke keranjang / scan</dd>
                  <dt>Ctrl+Enter / F4</dt>
                  <dd>Bayar</dd>
                  <dt>+ / −</dt>
                  <dd>Ubah jumlah item terpilih</dd>
                  <dt>Delete</dt>
                  <dd>Hapus item terpilih</dd>
                  <dt>F4</dt>
                  <dd>Bayar</dd>
                  <dt>F8</dt>
                  <dd>Tahan transaksi (Shift+F8 = kosongkan)</dd>
                  <dt>F9</dt>
                  <dd>Transaksi tertahan</dd>
                  <dt>Esc</dt>
                  <dd>Hilangkan sorotan & kembali ke pencarian (kosongkan: Shift+F8)</dd>
                </dl>
              </div>
            )}
            <IconButton
              ikon="keyboard"
              label="Pintasan (F1)"
              arah="bawah"
              ukuran="toolbar"
              aktif={bantuanTerbuka}
              onClick={() => setBantuanTerbuka((b) => !b)}
            />
          </div>
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
              {Number(shift.ringkasan?.tunai_piutang ?? 0) > 0 && (
                <div className="pos-pop__baris"><span>Piutang tunai</span><b>{formatRupiah(Number(shift.ringkasan?.tunai_piutang))}</b></div>
              )}
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
            <button type="button" onClick={() => { setMenuBuka(false); tanyaGantiMode(); }}>⌨️ Ganti mode (Foto / Tanpa Foto)</button>
            <button type="button" onClick={() => { setMenuBuka(false); setBantuanTerbuka(true); mintaBukaTutorial(); }}>💬 Panduan dan pintasan</button>
            {shift ? (
              <button type="button" onClick={() => { setMenuBuka(false); setDialog('shift-tutup'); }}>🔒 Tutup Kasir</button>
            ) : (
              <button type="button" onClick={() => { setMenuBuka(false); setDialog('shift-buka'); }}>🔓 Buka Kasir</button>
            )}
          </div>
        </div>
      )}

      <div className="pos-badan">
        <section className="pos-kiri">
          <div className="pos-filter">
            <div className="pos-cari">
              <span className="pos-cari__ikon" aria-hidden>
                <svg width="1em" height="1em" style={{ fontSize: '0.9375rem' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
              </span>
              <input
                ref={cariRef}
                id="pos-search-input"
                autoFocus
                value={cari}
                placeholder="Cari nama / SKU / barcode"
                aria-label="Cari produk"
                onChange={(e) => {
                  // Live-typing DIMATIKAN: hanya menampung kata kunci sementara.
                  setCari(e.target.value);
                  setFokus(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    // Enter = satu-satunya pemicu: exact match menambah barang,
                    // selain itu filter grid katalog (TANPA pop-up modal).
                    e.preventDefault();
                    const k = cari.trim();
                    if (!k) {
                      terapkanCari('');
                      cariRef.current?.focus();
                      return;
                    }
                    const kunci = k.toLowerCase();
                    const persis = produk.some(
                      (x) =>
                        (x.barcode ?? '').toLowerCase() === kunci ||
                        x.sku.toLowerCase() === kunci ||
                        (x.kode_item ?? '').toLowerCase() === kunci,
                    );
                    if (persis && pindaiBarcode(k)) {
                      setCari('');
                      setPaksaSemua(false);
                      cariRef.current?.focus();
                      return;
                    }
                    terapkanCari(k);
                    cariRef.current?.focus();
                    return;
                  }
                  if (e.key === 'ArrowDown' && terlihat.length > 0) {
                    // ↓ dari pencarian: sorot & fokus ke baris/kartu pertama.
                    e.preventDefault();
                    setFokus(0);
                    requestAnimationFrame(() => fokusKeDaftar(0));
                  }
                }}
              />
              <TombolScan
                judul="Pindai barcode produk"
                mode="berkelanjutan"
                onHasil={(t) => {
                  if (pindaiBarcode(t)) setCari('');
                  else setCari(t);
                }}
              />
            </div>
            <div className="pos-chipbar" aria-label="Opsi pencarian">
              <span className="pos-mode-switch" role="group" aria-label="Mode tampilan (F2 untuk ganti, tanpa pindah halaman)">
                <button
                  type="button"
                  className={modeTampil === 'foto' ? 'aktif' : ''}
                  aria-pressed={modeTampil === 'foto'}
                  onClick={() => gantiModeTampil('foto')}
                  title="Mode Foto [F2]"
                >
                  ▦ Mode Foto
                </button>
                <button
                  type="button"
                  className={modeTampil === 'teks' ? 'aktif' : ''}
                  aria-pressed={modeTampil === 'teks'}
                  onClick={() => gantiModeTampil('teks')}
                  title="Tanpa Foto (Teks) [F2] — keranjang tetap utuh"
                >
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
              <button
                type="button"
                className="pos-chip"
                aria-pressed={bolehHabis}
                title="Opsional: barang stok habis masih boleh dimasukkan ke keranjang"
                onClick={() => {
                  setBolehHabis((v) => {
                    localStorage.setItem(KUNCI_BOLEH_HABIS, String(!v));
                    return !v;
                  });
                }}
              >
                <span className="pos-chip__teks">{bolehHabis ? '✓ ' : ''}Jual stok habis</span>
              </button>
            </div>
          </div>

          <div className="pos-kategori">
            <button
              type="button"
              className={kategoriId === null ? 'aktif' : ''}
              onClick={() => {
                setKategoriId(null);
                // "Semua" = tampilkan kembali seluruh katalog gudang aktif.
                if (!cari.trim()) terapkanCari('');
              }}
            >
              Semua
            </button>
            {kategori.map(([id, nama]) => (
              <button key={id} type="button" className={kategoriId === id ? 'aktif' : ''} onClick={() => setKategoriId(id)}>
                {nama}
              </button>
            ))}
          </div>

          {modeTampil === 'foto' ? (
          <div
            id="pos-view-grid"
            className="pos-grid"
            ref={gridRef}
            role="list"
            aria-label="Produk"
            style={
              {
                // Y1.1/Y1.4 — lebar minimum kartu (ukuran per pengguna) & rasio gambar
                // (pengaturan POS) diumpan ke CSS lewat variabel.
                '--kartu-pengguna': UKURAN_PX[ukuranKartu],
                '--kartu-rasio': rasioFoto === '4/3' ? '4 / 3' : '1 / 1',
              } as React.CSSProperties
            }
          >
            {/* J1: sebelum ada kata kunci, tampilkan keadaan kosong yang rapi. */}
            {!gridTampil && (
              <div className="pos-grid__kosong">
                <svg width="1em" height="1em" style={{ fontSize: '2.75rem' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <p>Ketik nama, kode item, SKU, atau scan barcode untuk menampilkan barang.</p>
              </div>
            )}
            {gridTampil &&
              terlihat.map((p, i) => {
              const stok = stokGudang(p);
              const harga = p.harga;
              const habis = stok <= 0;
              // Y1.2 — badge status: habis (merah) / menipis (kuning) / aman (hijau).
              const menipis = !habis && p.stok_min > 0 && stok < p.stok_min;
              const labelStok = habis ? 'Habis' : menipis ? 'Menipis' : `Stok ${stok}`;
              const kelasStok = habis ? 'pos-kartu__stok--habis' : menipis ? 'pos-kartu__stok--menipis' : 'pos-kartu__stok--ada';
              return (
                <div className="pos-kartu__wrap" key={p.id}>
                  <button
                    type="button"
                    role="listitem"
                    tabIndex={i === fokus ? 0 : -1}
                    className={`pos-kartu ${i === fokus ? 'terpilih' : ''} ${habis ? 'pos-kartu--habis' : ''}`}
                    onFocus={() => setFokus(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setFokus(i);
                      // Y1.2 — klik/tap menambah 1 ke keranjang + umpan balik singkat.
                      // pilihProduk: reset pencarian & fokus siap item berikutnya.
                      if (pilihProduk(p)) pukulKartu(e.currentTarget);
                    }}
                    onAnimationEnd={(e) => {
                      if (e.animationName === 'pos-pukul') e.currentTarget.classList.remove('pos-kartu--pukul');
                    }}
                    title={habis ? 'Stok habis' : undefined}
                    aria-label={`${p.nama}, ${formatRupiah(harga)}, ${habis ? 'stok habis' : `stok ${stok}`}`}
                  >
                    {/* X4.2 — foto dengan skeleton & fallback placeholder bertema. */}
                    <FotoProduk src={p.foto_url} nama={p.nama} kategoriId={p.category_id} />
                    <div className="pos-kartu__isi">
                      <div className="pos-kartu__nama">{p.nama}</div>
                      <div className="pos-kartu__sku">{p.sku}</div>
                      {/* Y1.2 — harga kiri, badge stok kanan; boleh turun baris (wrap). */}
                      <div className="pos-kartu__bawah">
                        <span className="pos-kartu__harga">{formatRupiah(harga)}</span>
                        <span
                          className={`pos-kartu__stok ${kelasStok}`}
                          title={habis ? 'Stok habis' : undefined}
                        >
                          {labelStok}
                        </span>
                      </div>
                    </div>
                  </button>
                </div>
              );
            })}
            {gridTampil && terlihatSemua.length === 0 && (
              <p className="pos-keranjang__kosong">Barang tidak ditemukan.</p>
            )}
            {gridTampil && terlihatSemua.length > batas && (
              <button
                type="button"
                className="pos-tombol-lebih"
                onClick={() => setBatas((b) => b + BATAS_AWAL)}
              >
                Tampilkan lebih banyak ({terlihatSemua.length - batas} sisanya)
              </button>
            )}
          </div>
          ) : (
          /* TAMPILAN 2 — tabel teks ringkas (in-place, state & keranjang sama). */
          <div id="pos-view-table" className="pos-tabel-mode" ref={tabelRef} role="region" aria-label="Produk (tabel teks)">
            {!gridTampil && (
              <p className="pos-keranjang__kosong">Ketik nama, kode item, SKU, atau scan barcode untuk menampilkan barang.</p>
            )}
            {gridTampil && terlihatSemua.length === 0 && (
              <p className="pos-keranjang__kosong">Barang tidak ditemukan.</p>
            )}
            {gridTampil && terlihatSemua.length > 0 && (
              <table className="pos-tabel-cepat">
                <colgroup>
                  <col className="pos-kol-no" />
                  <col className="pos-kol-barcode" />
                  <col className="pos-kol-nama" />
                  <col className="pos-kol-stok" />
                  <col className="pos-kol-harga" />
                  <col className="pos-kol-aksi" />
                </colgroup>
                <thead>
                  <tr>
                    <th className="pos-th-no">#</th>
                    <th>Barcode</th>
                    <th>Nama Produk</th>
                    <th className="num">Stok</th>
                    <th className="num">Harga</th>
                    <th className="pos-th-aksi">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {terlihat.map((p, i) => {
                    const stok = stokGudang(p);
                    const habis = stok <= 0;
                    const menipis = !habis && p.stok_min > 0 && stok < p.stok_min;
                    return (
                      <tr key={p.id} data-baris className={i === fokus ? 'aktif' : ''}>
                        <td className="pos-td-no">{i + 1}</td>
                        <td className="pos-td-barcode">{p.barcode ?? p.sku}</td>
                        <td className="pos-td-nama">{p.nama}</td>
                        <td className={`num pos-saran__stok pos-saran__stok--${habis ? 'habis' : menipis ? 'menipis' : 'ada'}`}>
                          {habis ? 'Habis' : String(stok)}
                        </td>
                        <td className="num pos-td-total">{formatRupiah(Number(p.harga))}</td>
                        <td className="num">
                          <button
                            type="button"
                            className="pos-tabel-tambah"
                            onFocus={() => setFokus(i)}
                            onClick={(e) => {
                              setFokus(i);
                              if (pilihProduk(p)) pukulKartu(e.currentTarget);
                            }}
                            aria-label={`Tambah ${p.nama} ke keranjang`}
                          >
                            + Tambah
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {gridTampil && terlihatSemua.length > batas && (
              <button
                type="button"
                className="pos-tombol-lebih"
                onClick={() => setBatas((b) => b + BATAS_AWAL)}
              >
                Tampilkan lebih banyak ({terlihatSemua.length - batas} sisanya)
              </button>
            )}
          </div>
          )}
        </section>

        {/* Y1.4 — layar sempit (<1024px): keranjang jadi laci bawah dengan
            pegangan yang menampilkan jumlah item & total tanpa membuka laci. */}
        <button
          type="button"
          className="pos-laci"
          aria-expanded={laciBuka}
          aria-label={laciBuka ? 'Tutup keranjang' : 'Buka keranjang'}
          onClick={() => setLaciBuka((b) => !b)}
        >
          <span className="pos-laci__item">Keranjang ({keranjang.length})</span>
          <b>{formatRupiah(total)}</b>
          <span className="pos-laci__tanda" aria-hidden="true">
            {laciBuka ? '▾' : '▴'}
          </span>
        </button>

        <aside className={`pos-kanan ${laciBuka ? 'pos-kanan--buka' : ''}`}>
          {/* Pelanggan + catatan transaksi — ikut payload Bayar & tercetak di nota. */}
          <div className="pos-pelanggan">
            <div className="pos-pelanggan__baris">
              <select
                value={pelangganId}
                onFocus={() => void muatPelanggan()}
                onChange={(e) => setPelangganId(e.target.value)}
                aria-label="Pelanggan"
                title={namaPelangganTerpilih ?? 'Pelanggan Umum'}
              >
                <option value="">Pelanggan Umum</option>
                {pelangganOpsi.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="pos-pelanggan__tambah"
                title="Tambah pelanggan baru"
                onClick={() => {
                  setNamaPelangganBaru('');
                  setTeleponPelangganBaru('');
                  setTambahPelanggan(true);
                }}
              >
                + Baru
              </button>
            </div>
            <textarea
              value={catatan}
              onChange={(e) => setCatatan(e.target.value.slice(0, 500))}
              rows={2}
              maxLength={500}
              placeholder="Catatan transaksi (tampil di nota)…"
              aria-label="Catatan transaksi"
            />
          </div>
          <div className="pos-keranjang" ref={keranjangRef}>
            {keranjang.length === 0 && <p className="pos-keranjang__kosong">Keranjang kosong — klik produk atau pindai barcode.</p>}
            {keranjang.map((b, i) => (
              <div
                key={b.productId}
                className={`pos-baris ${i === barisTerpilih ? 'terpilih' : ''}${sorotId === b.productId ? ' pos-baris-masuk' : ''}`}
                onClick={() => setBarisTerpilih(i)}
              >
                <div className="pos-baris__nama">{b.nama}</div>
                <div className="pos-baris__jumlah">{formatRupiah(b.qty * b.harga)}</div>
                <div className="pos-baris__sku">{b.sku}</div>
                <div className="pos-baris__kontrol">
                  <button type="button" onClick={() => ubahQty(i, -1)} aria-label={`Kurangi ${b.nama}`}>
                    −
                  </button>
                  <input
                    type="number"
                    className="pos-baris__qty"
                    name="qty"
                    min={1}
                    value={b.qty}
                    aria-label={`Jumlah ${b.nama}`}
                    onFocus={() => setBarisTerpilih(i)}
                    onChange={(e) => {
                      const mentah = e.target.value;
                      if (mentah === '') return;
                      const n = Number.parseInt(mentah, 10);
                      if (!Number.isFinite(n)) return;
                      aturQty(i, n < 1 ? 1 : n);
                    }}
                    onBlur={(e) => {
                      const n = Number.parseInt(e.target.value, 10);
                      if (e.target.value === '' || !Number.isFinite(n) || n < 1) aturQty(i, 1);
                    }}
                    onKeyDown={(e) => {
                      // Enter di Qty = selesai ubah jumlah → kembali ke pencarian
                      // (siap produk/barcode berikutnya), bukan sekadar blur.
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        cariRef.current?.focus();
                      }
                      else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        ubahQty(i, 1);
                      } else if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        ubahQty(i, -1);
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button type="button" onClick={() => ubahQty(i, 1)} aria-label={`Tambah ${b.nama}`}>
                    +
                  </button>
                  <span className="pos-baris__harga">@ {formatRupiah(b.harga)}</span>
                  <button type="button" className="pos-baris__hapus" onClick={() => hapusBaris(i)} aria-label={`Hapus ${b.nama}`}>
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="pos-ringkas">
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
              <div className="pos-sheet__isi">
                <div className="r"><span>Subtotal</span><span>{formatRupiah(subtotal)}</span></div>
                <div className="r">
                  <span>Diskon (Rp)</span>
                  <input
                    id="pos-diskon"
                    inputMode="numeric"
                    placeholder="0"
                    value={fokusAngka === 'diskon' ? diskon.replace(/\D/g, '') : diskon ? formatAngka(Number(diskon.replace(/\D/g, '')) || 0) : diskon}
                    onFocus={() => setFokusAngka('diskon')}
                    onBlur={() => setFokusAngka(null)}
                    onChange={(e) => setDiskon(e.target.value.replace(/\D/g, ''))}
                    aria-label="Diskon nominal"
                  />
                </div>
                <div className="r">
                  <span>Pajak (%)</span>
                  <input
                    inputMode="numeric"
                    placeholder="0"
                    value={fokusAngka === 'pajak' ? String(pajakPersen) : formatAngka(pajakPersen)}
                    onFocus={() => setFokusAngka('pajak')}
                    onBlur={() => setFokusAngka(null)}
                    onChange={(e) => setPajakPersen(Math.min(100, Number(e.target.value.replace(/\D/g, '')) || 0))}
                    aria-label="Persentase pajak"
                  />
                </div>
                <div className="r"><span>Pajak</span><span>{formatRupiah(pajak)}</span></div>
              </div>
            </div>
            <div className="pos-aksi">
              <button type="button" className="pos-aksi__ikon" aria-label="Tahan transaksi (F8)" title="Tahan (F8)" onClick={() => setDialog('tahan')} disabled={keranjang.length === 0}>⏸</button>
              <button type="button" className="pos-aksi__ikon" aria-label={`Transaksi tertahan (F9)${tertahanJumlah > 0 ? `, ${tertahanJumlah} menunggu` : ''}`} title="Tertahan (F9)" onClick={() => void muatTertahan()}>📋{tertahanJumlah > 0 && <span className="pos-aksi__badge">{tertahanJumlah}</span>}</button>
              <button type="button" className="tombol pos-aksi-bayar pos-bayar" onClick={bukaBayar} disabled={keranjang.length === 0}>
                Bayar {formatRupiah(total)} <span className="pos-bayar__kbd">Ctrl+Enter</span>
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* ------------------------- dialog ------------------------------------ */}
      {dialog === 'bayar' && (
        <DialogBayar
          total={total}
          items={keranjang}
          diskon={diskonNum}
          pajakPersen={pajakPersen}
          pelangganIdAwal={pelangganId}
          namaPelangganAwal={namaPelangganTerpilih}
          teleponPelangganAwal={pelangganOpsi.find((o) => o.id === Number(pelangganId))?.telepon ?? null}
          catatanAwal={catatan}
          gudangId={gudangId}
          namaUsaha={usaha.nama}
          alamatUsaha={usaha.alamat || null}
          teleponUsaha={usaha.telepon || null}
          logoUrl={usaha.logo || null}
          editId={editId}
          pembayaranAwal={pembayaranLama}
          onTutup={() => setDialog(null)}            onSukses={(s) => {
              setStruk(s);
              setKeranjang([]);
              setDiskon('');
              setPelangganId('');
              setCatatan('');
              setPembayaranLama([]);
              setDialog(null);
              // Keluar dari mode edit tanpa memuat ulang halaman (struk tetap tampil).
              if (editId) {
                navigasi(modeTampil === 'teks' ? '/penjualan/pos/tanpa-foto' : '/penjualan/pos/foto', { replace: true });
              }
              // Muat ulang stok grid agar angka segar (tetap terkunci gudang aktif).
              apiGet<{ data: ProdukPos[] }>(`/api/pos/produk?gudang=${stateTerbaru.current.gudangId || gudangId}`).then((g) => setProduk(g.data)).catch(() => undefined);
            apiGet<{ data: ShiftAktif | null }>('/api/pos/shift/aktif').then((sh) => setShift(sh.data)).catch(() => undefined);
          }}
        />
      )}
      {tambahPelanggan && (
        <Modal
          judul="Pelanggan Baru"
          lebar="kecil"
          onTutup={() => setTambahPelanggan(false)}
          sedangKirim={simpanPelanggan}
          aksi={
            <>
              <button type="button" className="tombol" onClick={() => setTambahPelanggan(false)} disabled={simpanPelanggan}>
                Batal
              </button>
              <button type="button" className="tombol tombol--primer" onClick={simpanPelangganBaru} disabled={simpanPelanggan || namaPelangganBaru.trim() === ''}>
                {simpanPelanggan ? 'Menyimpan…' : 'Simpan'}
              </button>
            </>
          }
        >
          <div className="pos-dialog">
            <label htmlFor="pos-pelangganbaru-nama">Nama pelanggan</label>
            <input
              id="pos-pelangganbaru-nama"
              autoFocus
              value={namaPelangganBaru}
              maxLength={160}
              placeholder="cth: Budi Santoso"
              onChange={(e) => setNamaPelangganBaru(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void simpanPelangganBaru();
              }}
            />
            <label htmlFor="pos-pelangganbaru-telepon">Telepon (opsional)</label>
            <input
              id="pos-pelangganbaru-telepon"
              inputMode="tel"
              value={teleponPelangganBaru}
              maxLength={40}
              placeholder="cth: 0812…"
              onChange={(e) => setTeleponPelangganBaru(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void simpanPelangganBaru();
              }}
            />
          </div>
        </Modal>
      )}
      {dialog === 'tahan' && <DialogTahan onSimpan={tahanTransaksi} onTutup={() => setDialog(null)} />}
      {dialog === 'tertahan' && <DialogTertahan onLanjut={lanjutkanTertahan} onTutup={() => setDialog(null)} />}
      {dialog === 'shift-buka' && (
        <DialogShiftBuka
          onTutup={() => setDialog(null)}
          onSukses={(sh) => {
            setShift(sh);
            setDialog(null);
            beritahu('Shift dibuka — selamat bertugas!', 'sukses');
          }}
        />
      )}
      {dialog === 'shift-tutup' && shift && (
        <DialogShiftTutup
          shift={shift}
          onTutup={() => setDialog(null)}
          onSukses={() => {
            setShift(null);
            beritahu('Shift ditutup.', 'sukses');
          }}
        />
      )}
      {dialog === 'layanan' && (
        <DialogLayanan namaUsaha={usaha.nama} profil={profilStruk} onTutup={() => setDialog(null)} />
      )}
      {dialog === 'piutang' && (
        <DialogPiutang
          onTutup={() => setDialog(null)}
          onSukses={() => {
            apiGet<{ data: ShiftAktif | null }>('/api/pos/shift/aktif')
              .then((sh) => setShift(sh.data))
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
            cariRef.current?.focus();
          }}
          onTutup={() => setStruk(null)}
        />
      )}
      {/* M5 baru — tidak ada konfirmasi ganti mode: satu halaman, keranjang
          tidak pernah berpindah ke mana-mana. */}
    </div>
  );
}

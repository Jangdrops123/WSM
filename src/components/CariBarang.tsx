import { useEffect, useRef, useState } from 'react';
import { apiGet } from '../lib/api';
import { beritahu } from './crud/Toast';
import { TombolScan } from './ScanKamera';
import { putarUmpanBalikScan } from '../lib/umpanBalikScan';
import { ModalCariBarang, type BarisHasilCari } from './ModalCariBarang';

/** Satu baris hasil pencarian produk (dari GET /api/pembelian/produk-cari). */
export type HasilProduk = {
  product_id: number;
  sku: string;
  barcode: string | null;
  harga_beli: number;
  produk: string;
  kode_item: string | null;
  satuan_dasar_id: number | null;
  satuan_dasar: string | null;
  stok: number;
  harga_terakhir: number | null;
  konversi: { unit_id: number; nama: string; jumlah_per_satuan_dasar: number }[];
};

type PosisiCari = {
  supplier_id: string;
  gudang_id: string;
};

type Props = {
  posisi: PosisiCari;
  /** Kolom cari hanya aktif bila pemasok & gudang sudah dipilih. */
  aktif: boolean;
  /** Token naik = kolom cari di-fokus & dikosongkan (usai tiap item ditambahkan). */
  fokusToken: number;
  /** dariScanner=true bila input berasal dari scan barcode. Fokus kolom cari tetap
   *  dipertahankan untuk semua jalur; parameter ini hanya informasi asal input. */
  onPilih: (h: HasilProduk, dariScanner?: boolean) => void;
  /** Buka form cepat tambah produk (mis. saat barcode belum terdaftar). */
  onProdukBaru: (teksSaatIni: string) => void;
  /**
   * Panah Bawah dari kolom cari saat modal tertutup → masuk ke daftar item
   * (baris pertama).
   */
  onTanggaBawah?: () => void;
  /**
   * Filter ketat hasil pencarian (mis. hanya item PO aktif yang bersisa).
   * Diterapkan ke semua jalur: exact match, modal, dan scan barcode.
   */
  filterHasil?: (h: HasilProduk) => boolean;
};

/** Kode persis: barcode, SKU, atau kode item sama 100% dengan kata kunci. */
function cocokPersis(h: HasilProduk, q: string): boolean {
  const k = q.toLowerCase();
  return (
    (h.barcode ? h.barcode.toLowerCase() === k : false) ||
    (h.sku ? h.sku.toLowerCase() === k : false) ||
    (h.kode_item ? h.kode_item.toLowerCase() === k : false)
  );
}

/**
 * Kolom cari utama mode Biasa — pencarian dipicu ENTER (Enter-Triggered Search).
 *
 * Mengetik hanya memperbarui teks (tanpa query/dropdown). Saat Enter:
 *  - kode persis (barcode/SKU/kode item) yang unik → langsung ditambahkan
 *    ke tabel + bunyi sukses, input dikosongkan, fokus tetap di pencarian;
 *  - selain itu → pop-up modal hasil pencarian (↑/↓, Enter, Esc).
 */
export function CariBarang({ posisi, aktif, fokusToken, onPilih, onProdukBaru, onTanggaBawah, filterHasil }: Props) {
  const [teks, setTeks] = useState('');
  const [sibuk, setSibuk] = useState(false);
  /** null = modal tertutup; selain itu daftar hasil yang ditampilkan. */
  const [hasil, setHasil] = useState<HasilProduk[] | null>(null);
  const [kataCari, setKataCari] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const tokenRef = useRef(fokusToken);
  tokenRef.current = fokusToken;

  const url = (q: string) =>
    `/api/pembelian/produk-cari?cari=${encodeURIComponent(q)}&supplier_id=${encodeURIComponent(posisi.supplier_id)}&gudang_id=${encodeURIComponent(posisi.gudang_id)}`;

  /** Ambil hasil pencarian dari server (selalu menerapkan filter modul). */
  const ambil = async (q: string): Promise<HasilProduk[]> => {
    const r = await apiGet<{ data: HasilProduk[] }>(url(q));
    return filterHasil ? r.data.filter(filterHasil) : r.data;
  };

  /** Tambah produk lalu SELALU kembalikan fokus ke kolom cari (teks dikosongkan). */
  const pilih = (h: HasilProduk, dariScanner = false) => {
    setTeks('');
    setHasil(null);
    setKataCari('');
    inputRef.current?.focus();
    // WI3 — bunyi/getar sukses hanya untuk jalur scan / exact match.
    if (dariScanner) putarUmpanBalikScan('ok');
    onPilih(h, dariScanner);
  };

  // Fokus + kosongkan tiap token naik (usai item ditambahkan / ganti metode).
  useEffect(() => {
    if (fokusToken === 0) return;
    inputRef.current?.focus();
    setTeks('');
    setHasil(null);
    setKataCari('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fokusToken]);

  /**
   * Satu-satunya pemicu pencarian (Enter / hasil scan kamera):
   * exact match unik → langsung masuk; lainnya → buka pop-up modal.
   */
  const jalankanCari = async (mentah?: string) => {
    const q = (mentah ?? teks).trim();
    if (!q || !aktif) return;
    setSibuk(true);
    try {
      const daftar = await ambil(q);
      const persis = daftar.filter((h) => cocokPersis(h, q));
      if (persis.length === 1) {
        pilih(persis[0], true);
        return;
      }
      setKataCari(q);
      setHasil(daftar);
      if (daftar.length === 0) putarUmpanBalikScan('gagal');
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    } finally {
      setSibuk(false);
    }
  };

  const peta = new Map<string, HasilProduk>();
  for (const h of hasil ?? []) peta.set(String(h.product_id), h);
  const barisModal: BarisHasilCari[] = (hasil ?? []).map((h) => ({
    key: h.product_id,
    kode: h.kode_item || h.sku || h.barcode || '',
    nama: h.produk,
    kategori: (h as { kategori?: string | null }).kategori ?? null,
    stok: h.stok,
    harga: h.harga_terakhir !== null ? h.harga_terakhir : h.harga_beli,
    satuan: h.satuan_dasar,
  }));

  if (!aktif) {
    return (
      <div className="cari-barang cari-barang--nonaktif">
        <input
          className="cari-barang__input"
          placeholder="Cari / scan: kode item, nama, SKU, barcode... (F2)"
          disabled
          aria-label="Cari barang"
        />
        <p className="cari-barang__hint">Pilih pemasok &amp; gudang dulu</p>
      </div>
    );
  }

  return (
    <div className="cari-barang">
      <div className="cari-scan">
        <input
          ref={inputRef}
          id="search-item-input"
          className="cari-barang__input"
          value={teks}
          placeholder="Cari / scan: kode item, nama, SKU, barcode... (F2)"
          aria-label="Cari barang"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            // Pencarian TIDAK dijalankan saat mengetik — hanya Enter.
            setTeks(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void jalankanCari();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              onTanggaBawah?.();
            } else if (e.key === 'Escape') {
              setHasil(null);
              setTeks('');
            } else if (e.key === 'Tab' && teks.trim() === '') {
              // Kolom cari kosong + Tab → pindah ke baris pertama tabel item.
              e.preventDefault();
              onTanggaBawah?.();
            }
          }}
        />
        <TombolScan
          onHasil={(t) => {
            setTeks(t);
            void jalankanCari(t);
          }}
          judul="Pindai barcode produk"
        />
      </div>
      {sibuk && <span className="cari-barang__status">Mencari…</span>}

      {hasil !== null && (
        <ModalCariBarang
          judul="Hasil pencarian barang"
          kata={kataCari}
          baris={barisModal}
          onCari={(k) => void jalankanCari(k)}
          onPilih={(b) => {
            const h = peta.get(String(b.key));
            if (h) pilih(h);
            else setHasil(null);
          }}
          onTutup={() => {
            setHasil(null);
            setKataCari('');
            inputRef.current?.focus();
          }}
          onProdukBaru={(k) => {
            setHasil(null);
            onProdukBaru(k);
          }}
          labelAksi="Tambah"
        />
      )}
    </div>
  );
}

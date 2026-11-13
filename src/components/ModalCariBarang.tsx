import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatAngka, formatRupiah } from '../lib/format';
import './modalCariBarang.css';

/** Satu baris hasil pencarian barang yang ditampilkan di pop-up modal. */
export type BarisHasilCari = {
  /** Identitas unik baris (biasanya product_id). */
  key: number | string;
  kode: string;
  nama: string;
  kategori?: string | null;
  stok?: number | null;
  harga?: number | null;
  satuan?: string | null;
};

type Props = {
  /** Kata kunci yang dipakai saat modal dibuka (terisi di input modal). */
  kata: string;
  /** Hasil pencarian untuk kata kunci tersebut. */
  baris: BarisHasilCari[];
  /** Enter di input modal dengan kata kunci berubah → cari ulang. */
  onCari: (kata: string) => void;
  onPilih: (b: BarisHasilCari) => void;
  onTutup: () => void;
  /** Opsional — tombol "+ Produk baru" saat barang tidak ditemukan. */
  onProdukBaru?: (kata: string) => void;
  /** Judul kecil di kiri header modal. */
  judul?: string;
  /** Label tombol kolom AKSI. */
  labelAksi?: string;
};

/**
 * POP-UP HASIL PENCARIAN BARANG (Enter-triggered search).
 *
 * Muncul setelah pengguna menekan Enter di kolom pencarian utama. Keyboard
 * penuh: ↑/↓ pindah baris (auto-scroll), Enter memilih baris, Esc menutup.
 * Setelah memilih, fokus dikembalikan ke kolom pencarian utama oleh pemanggil.
 */
export function ModalCariBarang({
  kata,
  baris,
  onCari,
  onPilih,
  onTutup,
  onProdukBaru,
  judul = 'Hasil pencarian',
  labelAksi = 'Pilih',
}: Props) {
  const [teks, setTeks] = useState(kata);
  const [sorot, setSorot] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const isiRef = useRef<HTMLDivElement>(null);
  const barisRef = useRef<HTMLTableSectionElement>(null);

  // Hasil baru (setelah cari ulang) → sorotan kembali ke baris pertama.
  useEffect(() => {
    setSorot(0);
    isiRef.current?.scrollTo({ top: 0 });
  }, [baris]);

  // Kunci gulir halaman selama modal terbuka; SELALU dibersihkan saat modal
  // ditutup (Esc, klik luar, atau setelah memilih barang).
  useEffect(() => {
    const sebelumnya = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = sebelumnya;
    };
  }, []);

  // Input modal langsung terfokus agar kata kunci bisa diubah tanpa mouse.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  // Baris tersorot selalu terlihat (daftar panjang) — gulir mulus estafet.
  useEffect(() => {
    barisRef.current
      ?.querySelector('.mcb-baris--aktif')
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [sorot, baris.length]);

  const pilih = (b: BarisHasilCari | undefined) => {
    if (!b) return;
    onPilih(b);
  };

  // Portal ke <body>: overlay fixed selalu terpusat di viewport, tidak terpengaruh
  // transform/backdrop-filter wadah pemanggil (POS, tabel transaksi, dsb.).
  return createPortal(
    <div
      className="mcb-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onTutup();
      }}
    >
      <div
        className="mcb-modal"
        role="dialog"
        aria-modal="true"
        aria-label={judul}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onTutup();
            return;
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (baris.length) setSorot((s) => Math.min(s + 1, baris.length - 1));
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (baris.length) setSorot((s) => Math.max(s - 1, 0));
            return;
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            const q = teks.trim();
            // Kata kunci diubah → cari ulang; sama dengan hasil saat ini → pilih baris.
            if (q && q !== kata.trim()) {
              onCari(q);
              return;
            }
            pilih(baris[Math.min(sorot, baris.length - 1)]);
          }
        }}
      >
        <div className="mcb-kepala">
          <span className="mcb-judul">{judul}</span>
          <input
            ref={inputRef}
            className="mcb-input"
            value={teks}
            onChange={(e) => setTeks(e.target.value)}
            placeholder="Ubah kata kunci lalu Enter untuk mencari lagi…"
            aria-label="Kata kunci pencarian barang"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="mcb-tutup" onClick={onTutup}>
            ✕ Tutup (Esc)
          </button>
        </div>

        <div className="mcb-isi" ref={isiRef}>
          {baris.length === 0 ? (
            <div className="mcb-kosong">
              <strong>Barang tidak ditemukan</strong>
              Tidak ada barang yang cocok dengan “{kata}”.
            </div>
          ) : (
            <table className="mcb-tabel">
              <thead>
                <tr>
                  <th>Kode / SKU</th>
                  <th>Nama Barang</th>
                  <th>Kategori</th>
                  <th className="mcb-nomor">Stok Gudang</th>
                  <th className="mcb-nomor">Harga</th>
                  <th className="mcb-aksi">Aksi</th>
                </tr>
              </thead>
              <tbody ref={barisRef}>
                {baris.map((b, i) => (
                  <tr
                    key={b.key}
                    className={i === sorot ? 'mcb-baris--aktif' : undefined}
                    aria-selected={i === sorot}
                    onMouseEnter={() => setSorot(i)}
                    onClick={() => pilih(b)}
                  >
                    <td data-label="Kode / SKU" className="mcb-kode">{b.kode || '—'}</td>
                    <td data-label="Nama Barang" className="mcb-nama">{b.nama}</td>
                    <td data-label="Kategori">{b.kategori || '—'}</td>
                    <td data-label="Stok Gudang" className={`mcb-nomor ${stokKelas(b.stok)}`}>
                      {b.stok == null ? '—' : formatAngka(b.stok)}
                      {b.satuan ? ` ${b.satuan}` : ''}
                    </td>
                    <td data-label="Harga" className="mcb-nomor">
                      {b.harga == null ? '—' : formatRupiah(b.harga)}
                    </td>
                    <td data-label="Aksi" className="mcb-aksi">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          pilih(b);
                        }}
                      >
                        {labelAksi}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="mcb-kaki">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> pilih · <kbd>Enter</kbd> masukkan · <kbd>Esc</kbd> tutup
          </span>
          {onProdukBaru && (
            <button type="button" onClick={() => onProdukBaru(teks.trim())}>
              + Produk baru
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Warna stok: habis merah, menipis kuning (batas minimum diketahui pemanggil). */
function stokKelas(stok: number | null | undefined): string {
  if (stok == null) return '';
  if (stok <= 0) return 'mcb-stok--habis';
  return '';
}

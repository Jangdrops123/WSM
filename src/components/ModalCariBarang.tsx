import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatAngka, formatRupiah } from '../lib/format';
import { adalahEnter, diLayarPonsel, useEnterSekali } from '../lib/enterPonsel';
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
  /**
   * Varian halaman transaksi non-POS: tinggi hasil min(460px, 55vh) dan aksen
   * sorot lebih tegas. POS sengaja TIDAK memakai varian ini agar perilaku dan
   * tampilan pencariannya tetap sama.
   */
  nonPos?: boolean;
  /**
   * Hanya untuk pemanggil non-POS: Enter untuk memilih baru aktif 150ms
   * sesudah modal tampil. Enter pembuka tidak boleh langsung memilih baris.
   */
  abaikanEnterPembuka?: boolean;
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
  nonPos = false,
  abaikanEnterPembuka = false,
}: Props) {
  const [teks, setTeks] = useState(kata);
  const [sorot, setSorot] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const isiRef = useRef<HTMLDivElement>(null);
  const barisAktifRef = useRef<HTMLTableRowElement>(null);
  // Waktu buka dipakai sebagai pengaman agar Enter yang masih berasal dari
  // tekanan pembuka tidak langsung memilih baris pertama.
  const openedAt = useRef(Date.now());
  // Enter baru boleh diproses setelah modal selesai dirender (satu frame).
  const siapEnter = useRef(false);

  useEffect(() => {
    openedAt.current = Date.now();
    if (!abaikanEnterPembuka) {
      siapEnter.current = true;
      return;
    }
    siapEnter.current = false;
    const t = window.setTimeout(() => {
      siapEnter.current = true;
    }, 0);
    return () => window.clearTimeout(t);
  }, [abaikanEnterPembuka]);

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
  // Di ponsel jangan fokus otomatis: keyboard virtual harus tertutup agar
  // seluruh pop-up hasil terlihat. Pengguna tinggal mengetuk input bila perlu.
  useEffect(() => {
    if (diLayarPonsel()) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  // Baris tersorot selalu terlihat (daftar panjang) — gulir mulus estafet.
  useEffect(() => {
    barisAktifRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
  }, [sorot, baris.length]);

  const pilih = (b: BarisHasilCari | undefined) => {
    if (!b) return;
    onPilih(b);
  };

  const jalankanEnter = useEnterSekali(() => {
    const q = teks.trim();
    // Kata kunci diubah → cari ulang; sama dengan hasil saat ini → pilih baris.
    if (q && q !== kata.trim()) {
      onCari(q);
      return;
    }
    pilih(baris[Math.min(sorot, baris.length - 1)]);
  });

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
        className={`mcb-modal${nonPos ? ' mcb-modal--nonpos' : ''}`}
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
          if (adalahEnter(e)) {
            e.preventDefault();
            if (abaikanEnterPembuka) {
              e.stopPropagation();
              // Jangan mencampur keydown pembuka dengan keyup penutup.
              // Abaikan Enter selama frame render + 150ms pertama.
              if (!siapEnter.current || Date.now() - openedAt.current < 150) return;
            }
            jalankanEnter('keydown');
          }
        }}
        onKeyUp={(e) => {
          if (adalahEnter(e)) {
            e.preventDefault();
            // Jalur non-POS memakai keydown saja; keyup tidak boleh menutup
            // modal yang baru dibuka. POS tetap memakai fallback keyup lama.
            if (abaikanEnterPembuka) {
              e.stopPropagation();
              return;
            }
            jalankanEnter('keyup');
          }
        }}
      >
        <form
          className="mcb-kepala"
          onSubmit={(e) => {
            e.preventDefault();
            if (abaikanEnterPembuka) {
              e.stopPropagation();
              if (!siapEnter.current || Date.now() - openedAt.current < 150) return;
            }
            jalankanEnter('submit');
          }}
        >
          <span className="mcb-judul">{judul}</span>
          <input
            ref={inputRef}
            className="mcb-input"
            type="search"
            enterKeyHint="search"
            value={teks}
            onChange={(e) => setTeks(e.target.value)}
            placeholder="Ubah kata kunci lalu Enter untuk mencari lagi…"
            aria-label="Kata kunci pencarian barang"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="tombol-cari-ponsel" aria-label="Cari barang" title="Cari">
            🔍
          </button>
          <button type="button" className="mcb-tutup" onClick={onTutup}>
            ✕ Tutup (Esc)
          </button>
        </form>

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
              <tbody>
                {baris.map((b, i) => (
                  <tr
                    key={b.key}
                    ref={i === sorot ? barisAktifRef : undefined}
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

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type FocusEvent as ReactFocusEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon, type NamaIcon } from './Icon';

/**
 * Tombol ikon seragam untuk Master Data.
 *
 * Sumber teks hanya satu: prop `label`. Teks itu dipakai sekaligus sebagai
 * tooltip, `aria-label`, dan `title` (perangkat sentuh) sehingga tidak ada
 * tombol ikon tanpa nama.
 *
 * Perilaku tooltip (spesifikasi BAGIAN F):
 *  - hover     → muncul setelah 150 ms, hilang seketika saat kursor keluar;
 *  - fokus Tab → muncul seketika, hilang saat fokus berpindah, Esc menutup;
 *  - sentuh    → tekan lama 400 ms menampilkan teks, ketukan singkat tetap
 *                menjalankan aksi;
 *  - duaKetuk  → ketukan pertama mengunci teks ("Hapus?"), ketukan kedua
 *                menjalankan aksi (dialog konfirmasi tetap dibuka seperti biasa);
 *  - alasan    → tooltip menjadi "Label (alasan)" untuk tombol disabled;
 *  - arah      → otomatis dibalik bila menyentuh tepi layar (atas ↔ bawah),
 *                panah digeser mengikuti pusat tombol.
 *
 * Handler hover ada pada pembungkus <span> agar tombol `disabled` (yang tidak
 * menerima event pointer di browser) tetap bisa memunculkan tooltip alasannya.
 * Tooltip dirender lewat portal ke <body> dengan position:fixed sehingga tidak
 * terpotong `overflow` pembungkus tabel, dan z-index di atas tabel & modal.
 */

export type ArahTooltip = 'atas' | 'bawah';
export type VarianTombol = 'netral' | 'primer' | 'bahaya' | 'sukses';

const TUNDA_HOVER = 150; // ms — cepat, tapi tidak berkedip saat mouse lewat
const TUNDA_SENTUH = 400; // ms — tekan lama
const TAHAN_SENTUH = 1400; // ms — teks tetap terbaca setelah jari diangkat
const TAHAN_TERKUNCI = 4000; // ms — masa berlaku ketukan pertama ("Hapus?")

let koarsen: boolean | null = null;
/** true bila perangkat tidak punya hover (layar sentuh murni). */
function sentuh(): boolean {
  if (koarsen === null && typeof window !== 'undefined') {
    koarsen = window.matchMedia('(hover: none), (pointer: coarse)').matches;
  }
  return koarsen ?? false;
}

interface Props {
  /** Teks aksi: sumber tunggal untuk tooltip, aria-label, dan title. */
  label: string;
  ikon: NamaIcon;
  onClick?: (e: ReactMouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  /** Alasan tombol nonaktif → tooltip menjadi "Label (alasan)". */
  alasan?: string;
  warna?: VarianTombol;
  /** 'baris' = 32×32 (kolom Aksi) · 'toolbar' = 36×36 (di atas tabel). */
  ukuran?: 'baris' | 'toolbar';
  /** Arah awal tooltip; otomatis dibalik bila menyentuh tepi layar. */
  arah?: ArahTooltip;
  /** Penanda tombol terpilih/aktif: latar lembut + outline. */
  aktif?: boolean;
  /** Ketukan pertama (sentuh) hanya mengunci teks, ketukan kedua menjalankan aksi. */
  duaKetuk?: boolean;
  className?: string;
  /** kelas tambahan untuk pembungkus (mis. pemisah grup toolbar). */
  classNameWadah?: string;
  stopPropagation?: boolean;
  'data-testid'?: string;
}

export function IconButton({
  label,
  ikon,
  onClick,
  disabled = false,
  alasan,
  warna = 'netral',
  ukuran = 'baris',
  arah: arahUsul = 'atas',
  aktif = false,
  duaKetuk = false,
  className = '',
  classNameWadah = '',
  stopPropagation = false,
  'data-testid': testid,
}: Props) {
  const tombolRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const [tampil, setTampil] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0, panah: 0 });
  const [arah, setArah] = useState<ArahTooltip>(arahUsul);
  const [terkunci, setTerkunci] = useState(false);

  // Teks tunggal: label + alasan (bila disabled) + penanda ketukan pertama.
  const teks = disabled ? (alasan ? `${label} (${alasan})` : label) : terkunci ? `${label}?` : label;

  const bersihkan = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  /** Jadwalkan callback; id timer dikosongkan otomatis agar tidak dianggap hidup. */
  const setelah = (ms: number, fn: () => void) => {
    bersihkan();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      fn();
    }, ms);
  };

  const sembunyikan = () => {
    bersihkan();
    setTampil(false);
    setTerkunci(false);
  };

  // Posisi: ukur tooltip, lalu geser/balik arah agar tidak keluar layar.
  useLayoutEffect(() => {
    if (!tampil || !tombolRef.current || !tipRef.current) return;
    const r = tombolRef.current.getBoundingClientRect();
    const tw = tipRef.current.offsetWidth;
    const th = tipRef.current.offsetHeight;
    let a: ArahTooltip = arahUsul;
    let y = a === 'atas' ? r.top - th - 6 : r.bottom + 6;
    if (y < 8) {
      a = 'bawah';
      y = r.bottom + 6;
    }
    if (y + th > window.innerHeight - 8) {
      a = 'atas';
      y = r.top - th - 6;
    }
    if (y < 8) y = 8;
    let x = r.left + r.width / 2 - tw / 2;
    x = Math.min(Math.max(8, x), Math.max(8, window.innerWidth - tw - 8));
    // Panah mengikuti pusat tombol, dibatasi agar tetap di dalam kotak tooltip.
    const panah = Math.min(Math.max(r.left + r.width / 2 - x, 14), Math.max(14, tw - 14));
    setPos({ x, y, panah });
    setArah(a);
  }, [tampil, arahUsul]);

  // Esc menutup; gulir/resize menyembunyikan agar tidak menempel di posisi salah.
  useEffect(() => {
    if (!tampil) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') sembunyikan();
    };
    const onGulir = () => sembunyikan();
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onGulir, true);
    window.addEventListener('resize', onGulir);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onGulir, true);
      window.removeEventListener('resize', onGulir);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tampil]);

  useEffect(() => () => bersihkan(), []);

  const masuk = () => {
    if (sentuh()) return;
    setelah(TUNDA_HOVER, () => setTampil(true));
  };

  const keluar = () => {
    if (sentuh()) return;
    sembunyikan();
  };

  const fokus = (_e: ReactFocusEvent<HTMLSpanElement>) => {
    if (sentuh()) return;
    bersihkan();
    setTampil(true);
  };

  const lepasFokus = () => sembunyikan();

  const tekan = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (e.pointerType !== 'touch') return;
    setelah(TUNDA_SENTUH, () => setTampil(true));
  };

  const angkat = () => {
    if (timer.current !== null) {
      // Ketukan singkat: batalkan tekan lama — aksi tetap dijalankan onClick.
      bersihkan();
      return;
    }
    if (tampil) setelah(TAHAN_SENTUH, () => setTampil(false));
  };

  return (
    <span
      className={['ikon-btn-wadah', classNameWadah].filter(Boolean).join(' ')}
      onMouseEnter={masuk}
      onMouseLeave={keluar}
      onPointerDown={tekan}
      onPointerUp={angkat}
      onPointerCancel={bersihkan}
      onFocus={fokus}
      onBlur={lepasFokus}
    >
      <button
        ref={tombolRef}
        type="button"
        className={[
          'ikon-btn',
          `ikon-btn--${ukuran}`,
          `ikon-btn--${warna}`,
          aktif ? 'ikon-btn--aktif' : '',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        aria-label={teks}
        // `title` untuk perangkat sentuh; disembunyikan selama tooltip kustom
        // tampil agar teks tidak muncul dua kali.
        title={tampil ? undefined : teks}
        disabled={disabled}
        data-testid={testid}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            // Esc menutup tooltip; rambatkan agar modal/popup ikut menutup.
            sembunyikan();
            return;
          }
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
            // Baris tabel/kartu punya onKeyDown yang memanggil preventDefault
            // (Enter → buka detail, Spasi → pilih baris). Hentikan propagasi
            // supaya tombol tetap bisa diaktifkan Enter/Spasi, tapi JANGAN
            // batalkan default — browser tetap menghasilkan klik.
            e.stopPropagation();
          }
        }}
        onClick={(e) => {
          if (stopPropagation) e.stopPropagation();
          if (sentuh() && duaKetuk && !terkunci) {
            setTerkunci(true);
            setTampil(true);
            setelah(TAHAN_TERKUNCI, () => setTerkunci(false));
            return;
          }
          setTerkunci(false);
          onClick?.(e);
        }}
      >
        <Icon nama={ikon} size={ukuran === 'toolbar' ? 18 : 17} />
      </button>
      {tampil &&
        createPortal(
          <div
            ref={tipRef}
            className="tooltip-tip"
            role="tooltip"
            data-arah={arah}
            style={{ left: pos.x, top: pos.y, ['--panah' as string]: `${pos.panah}px` } as CSSProperties}
          >
            {teks}
          </div>,
          document.body,
        )}
    </span>
  );
}

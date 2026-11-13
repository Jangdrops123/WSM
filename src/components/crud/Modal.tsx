import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../Icon';

interface Props {
  judul: string;
  lebar?: 'kecil' | 'sedang' | 'lebar' | 'sangat' | 'cetak';
  /** Kelas tambahan pada kotak modal (mis. varian lebar khusus). */
  kelas?: string;
  onTutup: () => void;
  children: ReactNode;
  aksi?: ReactNode;
  sedangKirim?: boolean;
}

const FOKEH = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Dialog modal — X3.1: dirender lewat PORTAL ke <body> sehingga tidak pernah
 * terpotong ancestor dengan overflow/transform (masalah pop up Cetak/Ekspor
 * PDF yang terpotong di kotak laporan). position:fixed + z-index di atas
 * header, sidebar, flyout, dan lightbox; fokus terkunci di dalam modal dan
 * kembali ke tombol pemicu saat ditutup; Esc & klik di luar menutup.
 */
export function Modal({ judul, lebar = 'sedang', kelas, onTutup, children, aksi, sedangKirim }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const pemicu = useRef<HTMLElement | null>(null);
  const tutupRef = useRef(onTutup);
  tutupRef.current = onTutup;

  useEffect(() => {
    // Ingat pemicu & pindahkan fokus ke dalam modal sekali saat dibuka.
    pemicu.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const t = window.setTimeout(() => {
      const awal = ref.current?.querySelector<HTMLElement>('[data-fokus-awal]') ?? null;
      (awal ?? ref.current?.querySelector<HTMLElement>(FOKEH))?.focus();
    }, 0);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        tutupRef.current();
        return;
      }
      if (e.key !== 'Tab' || !ref.current) return;
      // Jebakan fokus: hanya elemen terlihat di dalam modal yang dikunjungi.
      const semua = Array.from(ref.current.querySelectorAll<HTMLElement>(FOKEH)).filter(
        (x) => x.offsetParent !== null || x === document.activeElement,
      );
      if (!semua.length) return;
      const pertama = semua[0];
      const terakhir = semua[semua.length - 1];
      const kini = document.activeElement;
      if (!ref.current.contains(kini)) {
        e.preventDefault();
        (e.shiftKey ? terakhir : pertama).focus();
      } else if (e.shiftKey && kini === pertama) {
        e.preventDefault();
        terakhir.focus();
      } else if (!e.shiftKey && kini === terakhir) {
        e.preventDefault();
        pertama.focus();
      }
    };
    // Fase capture agar Esc modal mengungguli handler Esc komponen di dalamnya.
    document.addEventListener('keydown', onKey, true);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = '';
      window.clearTimeout(t);
      // Kembalikan fokus ke pemicu (bila masih ada di dokumen).
      if (pemicu.current && document.contains(pemicu.current)) pemicu.current.focus();
    };
  }, []);

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onTutup()}>
      <div ref={ref} className={`modal modal--${lebar}${kelas ? ` ${kelas}` : ''}`} role="dialog" aria-modal="true" aria-label={judul}>
        <div className="modal__kepala">
          <h3>{judul}</h3>
          <button type="button" className="icon-tombol" onClick={onTutup} aria-label="Tutup" disabled={sedangKirim}>
            <Icon nama="close" size={18} />
          </button>
        </div>
        <div className="modal__isi">{children}</div>
        {aksi && <div className="modal__kaki">{aksi}</div>}
      </div>
    </div>,
    document.body,
  );
}

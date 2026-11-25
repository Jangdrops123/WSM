import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

// Tip anti-terpotong (AX4): bubble mengukur ruang layar saat tampil dan
// otomatis membalik ke kiri/atas bila mepet tepi kanan/bawah; teks membungkus
// (max-width) sehingga tidak menutupi tombol di bawahnya.
export function Tip({ teks, children, label }: { teks: string; children: ReactNode; label?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [buka, setBuka] = useState(false);
  const [kelas, setKelas] = useState('');

  useLayoutEffect(() => {
    if (!buka || !ref.current) return;
    const b = ref.current.getBoundingClientRect();
    const ruangKanan = window.innerWidth - b.right;
    const ruangBawah = window.innerHeight - b.bottom;
    const kl: string[] = [];
    if (ruangKanan < 260) kl.push('tip--kiri');
    if (ruangBawah < 160) kl.push('tip--atas');
    setKelas(kl.join(' '));
  }, [buka]);

  return (
    <span
      ref={ref}
      className={`tip ${kelas}`}
      data-teks={teks}
      tabIndex={0}
      aria-label={label ?? teks}
      onMouseEnter={() => setBuka(true)}
      onMouseLeave={() => setBuka(false)}
      onFocus={() => setBuka(true)}
      onBlur={() => setBuka(false)}
    >
      {children}
    </span>
  );
}

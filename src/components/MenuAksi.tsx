import { useEffect, useRef, useState } from 'react';
import { IconButton } from './IconButton';

/**
 * MenuAksi — pola toolbar "Opsi A": satu tombol kebab (⋮) yang membuka
 * menu turun berisi aksi sekunder berlabel. Dipakai di kepala kartu daftar
 * berdampingan dengan tombol primer "+ Tambah" sehingga toolbar hanya
 * berisi 1–2 tombol (lihat gambar acuan pengguna).
 */
export interface ItemMenuAksi {
  label: string;
  /** Aksi saat dipilih (menu otomatis tertutup dulu). */
  jalan?: () => void;
  /** Bila diisi, item dirender sebagai tautan (mis. unduhan berkas). */
  href?: string;
  /** Atribut download pada tautan (nama berkas / true = nama dari URL). */
  unduh?: boolean | string;
  /** Item nonaktif (mis. sedang mengimpor). */
  nonaktif?: boolean;
}

export function MenuAksi({ label = 'Aksi', items }: { label?: string; items: ItemMenuAksi[] }) {
  const [buka, setBuka] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!buka) return;
    const tutup = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setBuka(false);
    };
    document.addEventListener('mousedown', tutup);
    return () => document.removeEventListener('mousedown', tutup);
  }, [buka]);

  if (items.length === 0) return null;

  return (
    <span className="menu-aksi" ref={ref}>
      <IconButton label={label} ikon="kebab" ukuran="toolbar" arah="bawah" aktif={buka} onClick={() => setBuka((b) => !b)} />
      {buka && (
        <span className="toolbar-kompak__menu" role="menu" aria-label={label}>
          {items.map((it) =>
            it.href ? (
              <a
                key={it.label}
                href={it.href}
                download={it.unduh === true ? '' : (it.unduh || undefined)}
                onClick={() => {
                  setBuka(false);
                  it.jalan?.();
                }}
              >
                {it.label}
              </a>
            ) : (
              <button key={it.label} type="button" disabled={it.nonaktif} onClick={() => { setBuka(false); it.jalan?.(); }}>
                {it.label}
              </button>
            ),
          )}
        </span>
      )}
    </span>
  );
}

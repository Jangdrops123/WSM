import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * AL3 — Daftar mobile kompak seragam untuk semua modul.
 *
 * Satu baris 64–76px, memakai seluruh lebar (tanpa sisi kosong):
 * kiri thumbnail 48px, tengah judul/sub/chip/status, kanan nilai penting
 * + tombol titik-tiga. Ketuk = buka detail; tekan lama = mode pilih.
 */

export interface AksiBaris {
  label: string;
  ikon?: Parameters<typeof Icon>[0]['nama'];
  bahaya?: boolean;
  jalan: () => void;
}

/** AZ1 — aksi ikon di kaki kartu (tombol 44px, jarak 8px). */
export interface AksiIkonBaris {
  label: string;
  ikon: Parameters<typeof Icon>[0]['nama'];
  warna?: 'bahaya' | 'primer';
  jalan: () => void;
}

export interface BarisMobile {
  id: number;
  /** Baris 1: nama (tebal, maks 2 baris). */
  judul: ReactNode;
  /** Baris 2 muted: "kode - SKU", nomor-tanggal, dsb. */
  sub?: ReactNode;
  /** Baris 3 chip kecil: kategori - merek, status, dsb. */
  chip?: ReactNode;
  /** Nilai kanan: stok + harga, total + status, saldo, dsb. */
  kanan?: ReactNode;
  /** Thumbnail 48px; bila kosong tampil placeholder sesuai tema. */
  thumbnail?: ReactNode;
  aksi?: AksiBaris[];
  aria?: string;
  /** AZ1 (tampilan kartu): badge status di kanan Baris 1. */
  status?: ReactNode;
  /** AZ1: info utama Baris 2 (satu baris, pemisah tengah). */
  info?: ReactNode;
  /** AZ1: keterangan Baris 3. */
  ket?: ReactNode;
  /** AZ1/AZ3: daftar ringkas barang (“Ab Biru x1”). */
  pratinjau?: string[];
  /** Jumlah sisa item di luar `pratinjau` (“+N lainnya”). */
  pratinjauLebih?: number;
  /** AZ1: nilai penting kiri kaki kartu. */
  kaki?: ReactNode;
  /** AZ1: tombol ikon kanan kaki kartu. */
  aksiIkon?: AksiIkonBaris[];
}

/** AZ3.2 — kartu pengisi ruang kosong (“Tidak ada dokumen lainnya”). */
export interface PengisiRuang {
  judul: string;
  aksi: { label: string; primer?: boolean; jalan: () => void }[];
}

export function MobileList({
  data,
  kosong = 'Tidak ada data.',
  sibuk = false,
  /** 'baris' (AL3 kompak) atau 'kartu' (AZ1 lima-baris + pratinjau + kaki). */
  tampilan = 'baris',
  /** Kartu pengisi bila daftar lebih pendek dari layar (AZ3.2). */
  pengisi = null,
  /** Tombol aksi pada keadaan kosong (AZ3.3). */
  tombolKosong,
  onBuka,
  terpilih,
  modePilih,
  onTogglePilih,
  onMasukModePilih,
  onKeluarModePilih,
  labelPilih = 'baris',
}: {
  data: BarisMobile[];
  kosong?: ReactNode;
  sibuk?: boolean;
  tampilan?: 'baris' | 'kartu';
  pengisi?: PengisiRuang | null;
  tombolKosong?: { label: string; primer?: boolean; jalan: () => void };
  onBuka: (id: number) => void;
  /** Himpunan id terpilih (mode pilih). */
  terpilih?: Set<number>;
  modePilih?: boolean;
  onTogglePilih?: (id: number) => void;
  onMasukModePilih?: (id: number) => void;
  onKeluarModePilih?: () => void;
  labelPilih?: string;
}) {
  const [menuBuka, setMenuBuka] = useState<number | null>(null);
  const tekanTimer = useRef<number | null>(null);
  const tekanAktif = useRef(false);

  useEffect(
    () => () => {
      if (tekanTimer.current) window.clearTimeout(tekanTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!menuBuka) return;
    const tutup = () => setMenuBuka(null);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenuBuka(null);
    document.addEventListener('mousedown', tutup);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', tutup);
      document.removeEventListener('keydown', esc);
    };
  }, [menuBuka]);

  function mulaiTekan(id: number): void {
    if (modePilih) return;
    tekanAktif.current = false;
    if (tekanTimer.current) window.clearTimeout(tekanTimer.current);
    tekanTimer.current = window.setTimeout(() => {
      tekanAktif.current = true;
      onMasukModePilih?.(id);
    }, 450);
  }

  function batalTekan(): void {
    if (tekanTimer.current) {
      window.clearTimeout(tekanTimer.current);
      tekanTimer.current = null;
    }
  }

  if (sibuk && data.length === 0) return <p className="teks-redup mobile-list__kosong">Memuat…</p>;
  if (data.length === 0)
    return (
      <div className="mkt-kosong">
        <p className="teks-redup">{kosong}</p>
        {tombolKosong && (
          <button
            type="button"
            className={`tombol${tombolKosong.primer === false ? '' : ' tombol--primer'}`}
            onClick={tombolKosong.jalan}
          >
            {tombolKosong.label}
          </button>
        )}
      </div>
    );

  // AZ1 — kartu dokumen lima-baris dari DATA (bukan CSS tabel): judul+status,
  // info, keterangan, pratinjau barang adaptif, kaki nilai + aksi ikon.
  if (tampilan === 'kartu') {
    return (
      <ul className="mobile-list mkt" role="list">
        {data.map((b) => {
          const dipilih = terpilih?.has(b.id) ?? false;
          return (
            <li
              key={b.id}
              className={`mkt-kartu${dipilih ? ' mkt-kartu--pilih' : ''}`}
              tabIndex={0}
              role="button"
              aria-label={b.aria ?? (typeof b.judul === 'string' ? `Buka ${b.judul}` : `Buka ${b.id}`)}
              onClick={() => {
                if (tekanAktif.current) {
                  tekanAktif.current = false;
                  return;
                }
                if (modePilih) onTogglePilih?.(b.id);
                else onBuka(b.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (modePilih) onTogglePilih?.(b.id);
                  else onBuka(b.id);
                } else if (e.key === ' ' || e.key === 'Spacebar') {
                  e.preventDefault();
                  onTogglePilih?.(b.id);
                  onMasukModePilih?.(b.id);
                } else if (e.key === 'Escape' && modePilih) {
                  onKeluarModePilih?.();
                }
              }}
              onPointerDown={() => mulaiTekan(b.id)}
              onPointerUp={batalTekan}
              onPointerLeave={batalTekan}
              onContextMenu={(e) => {
                e.preventDefault();
                onMasukModePilih?.(b.id);
              }}
            >
              {modePilih && (
                <span className="mkt-centang" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={dipilih}
                    onChange={() => onTogglePilih?.(b.id)}
                    aria-label={`Pilih ${labelPilih} ${b.id}`}
                  />
                </span>
              )}
              <span className="mkt-baris1">
                <strong className="mkt-judul">{b.judul}</strong>
                {b.status !== undefined && <span className="mkt-status">{b.status}</span>}
              </span>
              {b.info !== undefined && b.info !== '' && <span className="mkt-info">{b.info}</span>}
              {b.ket !== undefined && b.ket !== '' && <span className="mkt-ket">{b.ket}</span>}
              {b.pratinjau !== undefined && b.pratinjau.length > 0 && (
                <span className="mkt-pratinjau" aria-label="Ringkasan barang">
                  {b.pratinjau.map((t, i) => (
                    <span key={i} className="mkt-pratinjau__item">
                      {t}
                    </span>
                  ))}
                  {b.pratinjauLebih !== undefined && b.pratinjauLebih > 0 && (
                    <span className="mkt-pratinjau__lebih">+{b.pratinjauLebih} lainnya</span>
                  )}
                </span>
              )}
              {(b.kaki !== undefined || (b.aksiIkon !== undefined && b.aksiIkon.length > 0)) && (
                <span className="mkt-kaki">
                  <span className="mkt-nilai">{b.kaki}</span>
                  {b.aksiIkon !== undefined && b.aksiIkon.length > 0 && (
                    <span className="mkt-aksi" role="group" aria-label="Aksi">
                      {b.aksiIkon.map((a) => (
                        <button
                          key={a.label}
                          type="button"
                          className={`mkt-aksi__tombol${a.warna === 'bahaya' ? ' mkt-aksi__tombol--bahaya' : ''}`}
                          aria-label={a.label}
                          title={a.label}
                          onClick={(e) => {
                            e.stopPropagation();
                            a.jalan();
                          }}
                        >
                          <Icon nama={a.ikon} size={20} />
                        </button>
                      ))}
                    </span>
                  )}
                </span>
              )}
            </li>
          );
        })}
        {pengisi && (
          <li className="mkt-pengisi">
            <p className="mkt-pengisi__judul">{pengisi.judul}</p>
            <span className="mkt-pengisi__aksi">
              {pengisi.aksi.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  className={`tombol${a.primer === false ? '' : ' tombol--primer'}`}
                  onClick={a.jalan}
                >
                  {a.label}
                </button>
              ))}
            </span>
          </li>
        )}
      </ul>
    );
  }

  return (
    <ul className="mobile-list" role="list">
      {data.map((b) => {
        const dipilih = terpilih?.has(b.id) ?? false;
        return (
          <li
            key={b.id}
            className={`mobile-list__baris ${dipilih ? 'mobile-list__baris--pilih' : ''}`}
            tabIndex={0}
            role="button"
            aria-label={b.aria ?? `Buka ${b.id}`}
            onClick={() => {
              if (tekanAktif.current) {
                tekanAktif.current = false;
                return;
              }
              if (modePilih) onTogglePilih?.(b.id);
              else onBuka(b.id);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (modePilih) onTogglePilih?.(b.id);
                else onBuka(b.id);
              } else if (e.key === ' ' || e.key === 'Spacebar') {
                e.preventDefault();
                onTogglePilih?.(b.id);
                onMasukModePilih?.(b.id);
              } else if (e.key === 'Escape' && modePilih) {
                onKeluarModePilih?.();
              }
            }}
            onPointerDown={() => mulaiTekan(b.id)}
            onPointerUp={batalTekan}
            onPointerLeave={batalTekan}
            onContextMenu={(e) => {
              e.preventDefault();
              onMasukModePilih?.(b.id);
            }}
          >
            {modePilih && (
              <span className="mobile-list__centang" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={dipilih}
                  onChange={() => onTogglePilih?.(b.id)}
                  aria-label={`Pilih ${labelPilih} ${b.id}`}
                />
              </span>
            )}
            <span className="mobile-list__thumb" aria-hidden="true">
              {b.thumbnail ?? <span className="mobile-list__thumb--kosong">—</span>}
            </span>
            <span className="mobile-list__tengah">
              <strong className="mobile-list__judul">{b.judul}</strong>
              {b.sub !== undefined && b.sub !== '' && <span className="mobile-list__sub">{b.sub}</span>}
              {b.chip !== undefined && <span className="mobile-list__chip">{b.chip}</span>}
            </span>
            <span className="mobile-list__kanan">
              {b.kanan}
              {b.aksi && b.aksi.length > 0 && (
                <span className="mobile-list__kebab">
                  <button
                    type="button"
                    className="mobile-list__kebab-tombol"
                    aria-label="Aksi baris"
                    aria-haspopup="menu"
                    aria-expanded={menuBuka === b.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuBuka(menuBuka === b.id ? null : b.id);
                    }}
                  >
                    <Icon nama="kebab" size={18} />
                  </button>
                  {menuBuka === b.id && (
                    <span
                      className="mobile-list__menu"
                      role="menu"
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      {b.aksi.map((a) => (
                        <button
                          key={a.label}
                          type="button"
                          role="menuitem"
                          className={a.bahaya ? 'mobile-list__menu--bahaya' : ''}
                          onClick={() => {
                            setMenuBuka(null);
                            a.jalan();
                          }}
                        >
                          {a.label}
                        </button>
                      ))}
                    </span>
                  )}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

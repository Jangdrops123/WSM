// BAGIAN AA — Wadah pratinjau kertas bersama (AA1–AA4, AA7).
//
// Dipakai Template Faktur, Detail Faktur/Daftar Dokumen, Struk, dan dialog
// cetak Laporan. Satu sumber perilaku:
//   • Kertas dirender dengan UKURAN ASLI (1 mm = 3,7795 px pada 96 dpi).
//   • Skala = lebar area pratinjau tersedia ÷ lebar kertas (batas atas 1,0
//     untuk mode fit; mode Zoom boleh lebih) → transform: scale(skala) dengan
//     transform-origin: top left, dibungkus kontainer selebar kertas × skala
//     (tinggi kertas × skala) → tidak ada scroll/potongan horizontal dan
//     kertas selalu terpusat (margin auto).
//   • ResizeObserver menghitung ulang saat lebar jendela berubah, sidebar
//     diciutkan/diperluas, panel pengaturan dibuka/ditutup, kertas/orientasi
//     diganti, atau tema berganti (MutationObserver data-theme).
//   • Kendali tampilan (AA3): Sesuaikan lebar (bawaan), Sesuaikan halaman,
//     100%, Perbesar/Perkecil, Layar penuh + persentase skala; mode & skala
//     tersimpan per pengguna (localStorage). Ctrl/⌘+scroll & pinch-zoom
//     memperbesar; geser (pan) dengan seret bila konten lebih besar.
//   • Penanda "Halaman n/N" bila dokumen lebih dari satu halaman (AA3).
//   • Cetak/PDF TETAP 1:1: skala hanya tampilan layar (aturan @media print
//     melepas skala & menyembunyikan alat — lihat faktur.css/laporan.css).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { IconButton } from './IconButton';
import './pratinjau.css';

/** MM → piksel layar pada 96 dpi (1 mm = 3,7795 px). */
export const MM_KE_PX = 96 / 25.4;

/** Mode tampilan pratinjau — disimpan per pengguna. */
export type ModePratinjau = 'lebar' | 'halaman' | 'persen';

const KUNCI_MODE = 'nusapos.pratinjauMode';
const KUNCI_SKALA = 'nusapos.pratinjauSkala';
const SKALA_MIN = 0.2;
const SKALA_MAKS = 3;

function bacaMode(): ModePratinjau {
  try {
    const v = localStorage.getItem(KUNCI_MODE);
    if (v === 'lebar' || v === 'halaman' || v === 'persen') return v;
  } catch {
    /* penyimpanan nonaktif — pakai bawaan */
  }
  return 'lebar';
}

function bacaSkala(): number {
  try {
    const v = Number(localStorage.getItem(KUNCI_SKALA));
    if (v >= SKALA_MIN && v <= SKALA_MAKS) return v;
  } catch {
    /* penyimpanan nonaktif — pakai 100% */
  }
  return 1;
}

function simpan(kunci: string, nilai: string): void {
  try {
    localStorage.setItem(kunci, nilai);
  } catch {
    /* penyimpanan nonaktif — abaikan */
  }
}

const jepit = (n: number): number => Math.min(SKALA_MAKS, Math.max(SKALA_MIN, n));

interface Props {
  /** Lebar kertas (mm). */
  lebarMm: number;
  /** Tinggi kertas (mm); null = tinggi mengikuti isi (strip termal). */
  tinggiMm: number | null;
  /** Tinggi satu halaman untuk penanda "Halaman n/N"; null = tanpa penanda. */
  halamanMm?: number | null;
  children: ReactNode;
}

export function PratinjauKertas({ lebarMm, tinggiMm, halamanMm = null, children }: Props) {
  const blokRef = useRef<HTMLDivElement>(null);
  const tampilanRef = useRef<HTMLDivElement>(null);
  const isiRef = useRef<HTMLDivElement>(null);
  const skalaRef = useRef(1);
  const rafRef = useRef<number | null>(null);
  const seretRef = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);

  const [mode, setMode] = useState<ModePratinjau>(bacaMode);
  const [skalaManual, setSkalaManual] = useState<number>(bacaSkala);
  const [avail, setAvail] = useState({ w: 0, h: 0 });
  const [tinggiIsi, setTinggiIsi] = useState(0);
  const [penuh, setPenuh] = useState(false);
  const [seret, setSeret] = useState(false);

  const lebarPx = lebarMm * MM_KE_PX;
  const tinggiNominal = tinggiMm == null ? 0 : tinggiMm * MM_KE_PX;
  // Tinggi tampilan: tetap mengikuti kertas, tumbuh bila isi lebih tinggi,
  // atau mengikuti isi bila tinggi otomatis (strip termal).
  const tinggiIsiEfektif = tinggiIsi > 0 ? tinggiIsi : tinggiNominal;
  const tinggiTampilan = tinggiMm == null ? tinggiIsiEfektif : Math.max(tinggiNominal, tinggiIsiEfektif);

  const fitW = avail.w > 0 ? Math.min(1, avail.w / Math.max(1, lebarPx)) : 1;
  const fitH = avail.h > 0 ? Math.min(1, avail.h / Math.max(1, tinggiTampilan)) : 1;
  const skala = mode === 'lebar' ? fitW : mode === 'halaman' ? Math.min(fitW, fitH) : skalaManual;
  skalaRef.current = skala;

  // --- Pengukuran: ukuran area pratinjau (AA2) ----------------------------
  // Dikoalesensikan ke satu requestAnimationFrame: RO tembakan beruntun
  // (mis. saat sidebar bertransisi) menjadi SATU update state per frame —
  // mencegah kaskade setState tak berujung saat ukuran bolak-balik.
  const ukur = useCallback(() => {
    const vp = tampilanRef.current;
    if (!vp) return;
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = tampilanRef.current;
      if (!el) return;
      const cs = getComputedStyle(el);
      const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      // Jangan loop: hanya simpan bila nilainya berubah.
      if (w > 0 && h > 0) setAvail((l) => (l.w === w && l.h === h ? l : { w, h }));
    });
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        // KOSONGKAN id-nya: jika tidak, sisa id lama membuat ukur() diam di
        // jalur "sudah terjadwal" selamanya → skala mentok 100% (remount/
        // StrictMode) dan pratinjau tidak pernah fit.
        rafRef.current = null;
      }
    };
  }, []);

  useLayoutEffect(() => {
    const vp = tampilanRef.current;
    if (!vp) return;
    ukur();
    // Lebar jendela / sidebar / panel pengaturan berubah → ukur ulang.
    const ro = new ResizeObserver(ukur);
    ro.observe(vp);
    // Tema berganti → ukur ulang (token bisa mengubah padding/gaya).
    const mo = new MutationObserver(ukur);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [ukur]);

  // Ukur ulang setelah skala berubah: muncul/hilangnya scrollbar mengubah
  // TETAPAN border-box (ResizeObserver tidak menyala) tapi mengubah
  // clientWidth — tanpa ini skala bisa sisa dari pengukuran lama.
  useLayoutEffect(() => {
    ukur();
  }, [skala, tinggiTampilan, ukur]);

  // Tinggi isi alami (di luar transform) → pertumbuhan kertas & penanda halaman.
  useLayoutEffect(() => {
    const el = isiRef.current;
    if (!el) return;
    const ukur = () => setTinggiIsi(el.offsetHeight);
    ukur();
    const ro = new ResizeObserver(ukur);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // --- Mode & skala (tersimpan per pengguna — AA3) ------------------------
  const pilihMode = (m: ModePratinjau) => {
    if (m === 'persen') {
      // Pertahankan skala tampil saat ini sebagai titik awal zoom.
      setSkalaManual(jepit(skalaRef.current));
      simpan(KUNCI_SKALA, String(jepit(skalaRef.current)));
    }
    setMode(m);
    simpan(KUNCI_MODE, m);
  };

  const ubahSkala = (next: number) => {
    const v = jepit(next);
    setMode('persen');
    setSkalaManual(v);
    simpan(KUNCI_MODE, 'persen');
    simpan(KUNCI_SKALA, String(v));
  };

  // Ctrl/⌘ + scroll (termasuk pinch-pad) → zoom (AA3).
  useEffect(() => {
    const vp = tampilanRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      ubahSkala(skalaRef.current * Math.exp(-e.deltaY * 0.0022));
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
    // ubahSkala selalu referensi baru yang tidak bergantung state luar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Layar penuh (AA3) --------------------------------------------------
  useEffect(() => {
    const on = () => setPenuh(document.fullscreenElement === blokRef.current);
    document.addEventListener('fullscreenchange', on);
    on();
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  const togglePenuh = () => {
    const el = blokRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => undefined);
  };

  // --- Geser (pan) bila konten lebih besar dari jendela (AA3) -------------
  const mulaiSeret = (e: React.PointerEvent<HTMLDivElement>) => {
    const vp = tampilanRef.current;
    if (!vp) return;
    const t = e.target;
    if (!(t instanceof Element) || t === vp) return; // scrollbar/latar → biarkan
    if (vp.scrollWidth <= vp.clientWidth + 1 && vp.scrollHeight <= vp.clientHeight + 1) return;
    seretRef.current = { x: e.clientX, y: e.clientY, sl: vp.scrollLeft, st: vp.scrollTop };
    setSeret(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const geserSeret = (e: React.PointerEvent<HTMLDivElement>) => {
    const vp = tampilanRef.current;
    const s = seretRef.current;
    if (!vp || !s) return;
    vp.scrollLeft = s.sl - (e.clientX - s.x);
    vp.scrollTop = s.st - (e.clientY - s.y);
  };
  const akhiriSeret = () => {
    seretRef.current = null;
    setSeret(false);
  };

  // --- Penanda halaman (AA3) ---------------------------------------------
  const halamanPx = halamanMm ? halamanMm * MM_KE_PX : 0;
  const jumlahHal =
    halamanPx > 0 && tinggiIsi > halamanPx + 4 ? Math.max(2, Math.ceil(tinggiIsi / halamanPx)) : 1;

  return (
    <div className={`pratinjau-blok ${penuh ? 'pratinjau-blok--penuh' : ''}`} ref={blokRef}>
      <div className="pratinjau-alat" role="toolbar" aria-label="Kendali pratinjau">
        <IconButton
          label="Sesuaikan lebar (tampil penuh selebar area)"
          ikon="fit-width"
          ukuran="baris"
          aktif={mode === 'lebar'}
          onClick={() => pilihMode('lebar')}
        />
        <IconButton
          label="Sesuaikan halaman (seluruh halaman terlihat)"
          ikon="fit-page"
          ukuran="baris"
          aktif={mode === 'halaman'}
          onClick={() => pilihMode('halaman')}
        />
        <button
          type="button"
          className={`pratinjau-alat__pct ${mode === 'persen' && skalaManual === 1 ? 'aktif' : ''}`}
          title="Tampilkan 100% (ukuran asli)"
          aria-label="Tampilkan 100 persen"
          onClick={() => ubahSkala(1)}
        >
          100%
        </button>
        <IconButton label="Perkecil" ikon="zoom-out" ukuran="baris" onClick={() => ubahSkala(skalaRef.current / 1.2)} />
        <IconButton label="Perbesar" ikon="zoom-in" ukuran="baris" onClick={() => ubahSkala(skalaRef.current * 1.2)} />
        <span className="pratinjau-alat__persen" aria-live="polite">
          {Math.round(skala * 100)}%
        </span>
        <span className="pratinjau-alat__sisi">
          <IconButton
            label={penuh ? 'Keluar dari layar penuh' : 'Layar penuh'}
            ikon={penuh ? 'contract' : 'expand'}
            ukuran="baris"
            onClick={togglePenuh}
          />
        </span>
      </div>

      <div
        className={`pratinjau-tampilan ${seret ? 'pratinjau-tampilan--seret' : ''}`}
        ref={tampilanRef}
        onPointerDown={mulaiSeret}
        onPointerMove={geserSeret}
        onPointerUp={akhiriSeret}
        onPointerCancel={akhiriSeret}
      >
        <div
          className="pratinjau-bingkai"
          style={{ width: Math.round(lebarPx * skala), height: Math.round(tinggiTampilan * skala) }}
        >
          <div
            className="pratinjau-skala"
            ref={isiRef}
            style={{ width: lebarPx, transform: `scale(${skala})`, transformOrigin: 'top left' }}
          >
            {children}
          </div>

          {jumlahHal > 1 && (
            <div className="pratinjau-halaman" aria-hidden="true">
              <span className="pratinjau-halaman__penanda pratinjau-halaman__penanda--awal">
                Halaman 1/{jumlahHal}
              </span>
              {Array.from({ length: jumlahHal - 1 }, (_, i) => (
                <div
                  className="pratinjau-halaman__batas"
                  key={i}
                  style={{ top: Math.round((i + 1) * halamanPx * skala) }}
                >
                  <span className="pratinjau-halaman__penanda">Halaman {i + 2}/{jumlahHal}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

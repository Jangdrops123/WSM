// BAGIAN AJ — "Baris per halaman: Otomatis". Menghitung jumlah baris yang
// benar-benar muat di badan tabel (tanpa scroll internal) lalu menghitung ulang
// saat ukuran area berubah: sidebar ciut, jendela, tema/kepadatan, skala font,
// zoom, atau keyboard ponsel. Pilihan disimpan per pengguna & per halaman.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { peranAktif } from './pengguna';

export type ModeBaris = 'auto' | number;

export const PILIHAN_BARIS = [20, 50, 100] as const;

/** Identitas penyimpan: pengguna yang sedang masuk (fallback: peran). */
function identitas(): string {
  try {
    return localStorage.getItem('nusapos.pengguna') || peranAktif();
  } catch {
    return peranAktif();
  }
}

function kunciSimpan(kunci: string): string {
  return `nusapos.baris.${kunci}.${identitas()}`;
}

function baca(kunci: string): ModeBaris {
  try {
    const v = localStorage.getItem(kunciSimpan(kunci));
    if (v === 'auto') return 'auto';
    const n = Number(v);
    return (PILIHAN_BARIS as readonly number[]).includes(n) ? n : 'auto';
  } catch {
    return 'auto';
  }
}

function simpan(kunci: string, mode: ModeBaris): void {
  try {
    localStorage.setItem(kunciSimpan(kunci), String(mode));
  } catch {
    /* penyimpanan nonaktif — abaikan */
  }
}

/** Tinggi baris cadangan dari token CSS (saat tabel belum punya baris). */
function tinggiBarisCadangan(): number {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;height:var(--tinggi-baris)';
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return h || 44;
}

/**
 * @param kunci   id halaman untuk penyimpanan preferensi (mis. "produk").
 * @param areaRef wadah scroll tabel (`.tabel-bungkus`).
 * @param total   jumlah data sesuai filter (untuk membatasi halaman).
 * @param hal     halaman aktif saat ini.
 */
export function useBarisOtomatis({
  kunci,
  areaRef,
  total,
  hal,
  setHal,
}: {
  kunci: string;
  areaRef: RefObject<HTMLElement | null>;
  total: number;
  hal: number;
  setHal: (n: number) => void;
}) {
  const [mode, setModeState] = useState<ModeBaris>(() => baca(kunci));
  const [per, setPer] = useState<number>(() => {
    const m = baca(kunci);
    return m === 'auto' ? 20 : m;
  });

  const modeRef = useRef(mode);
  const perRef = useRef(per);
  const halRef = useRef(hal);
  const totalRef = useRef(total);
  const setHalRef = useRef(setHal);
  modeRef.current = mode;
  perRef.current = per;
  halRef.current = hal;
  totalRef.current = total;
  setHalRef.current = setHal;

  const terapkan = useCallback((baru: number) => {
    const lama = perRef.current;
    if (baru === lama) return;
    // Pertahankan item pertama yang sedang terlihat, bukan lompat ke hal 1.
    const indeksAwal = Math.max(0, (halRef.current - 1) * lama);
    const totalHalBaru = Math.max(1, Math.ceil(totalRef.current / baru));
    const halBaru = Math.min(totalHalBaru, Math.floor(indeksAwal / baru) + 1);
    perRef.current = baru;
    setPer(baru);
    if (halBaru !== halRef.current) setHalRef.current(halBaru);
  }, []);

  useEffect(() => {
    let target: HTMLElement | null = null;
    let targetTabel: Element | null = null;
    let timer = 0;

    // Pengukuran ditunda satu tick (bukan requestAnimationFrame): rAF tidak
    // berjalan saat tab tidak dilukis/tersembunyi, sehingga jumlah baris akan
    // basi. setTimeout tetap berjalan (ditrottle) di latar belakang.
    const ukur = () => {
      if (timer) return; // sudah dijadwalkan — jangan tunda terus
      timer = window.setTimeout(() => {
        timer = 0;
        const el = areaRef.current;
        // Amati wadah DAN tabelnya: jumlah/tinggi baris bisa berubah (data
        // datang, filter berubah, sel dua baris) tanpa wadah berubah ukuran.
        // Hanya pasang ulang saat elemennya berganti, supaya tidak memicu
        // ResizeObserver berulang (loop animasi).
        const tabel = el?.querySelector('table') ?? null;
        if (el && (el !== target || tabel !== targetTabel)) {
          ro.disconnect();
          moBaris.disconnect();
          target = el;
          targetTabel = tabel;
          ro.observe(el);
          if (tabel) ro.observe(tabel);
          // Baris/halaman baru dirender (React) tanpa mengubah ukuran wadah →
          // hitung ulang juga saat isi tabel berubah.
          moBaris.observe(el, { childList: true, subtree: true });
        }

        const m = modeRef.current;
        if (m !== 'auto') {
          terapkan(m);
          return;
        }

        // Ponsel: daftar kartu menggulir di dalam; jangan ubah jumlah baris
        // berdasarkan tinggi kartu (kolom kartu berbeda per lebar layar).
        if (!el || window.matchMedia('(max-width: 767.98px)').matches) {
          terapkan(20);
          return;
        }

        const thead = el.querySelector('thead');
        const contoh = el.querySelector('tbody tr:not(:has(td.tabel-kosong))') as HTMLElement | null;
        // Ada data tapi barisnya belum dirender → tunggu; jangan ukur dengan
        // tinggi baris cadangan (hasilnya bisa kelebihan satu baris).
        if (!contoh && totalRef.current > 0) return;
        const tinggiBaris = contoh?.getBoundingClientRect().height || tinggiBarisCadangan();
        const tinggiKepala = thead?.getBoundingClientRect().height ?? 0;
        const muat = el.clientHeight - tinggiKepala;
        if (muat < tinggiBaris) return;
        const baru = Math.max(5, Math.min(200, Math.floor(muat / tinggiBaris)));
        terapkan(baru);
      }, 16);
    };

    const ro = new ResizeObserver(ukur);
    const mo = new MutationObserver(ukur);
    const moBaris = new MutationObserver(ukur);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-kepadatan', 'data-tema', 'style', 'class'],
    });
    window.addEventListener('resize', ukur);
    window.visualViewport?.addEventListener('resize', ukur);
    ukur();

    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
      mo.disconnect();
      moBaris.disconnect();
      window.removeEventListener('resize', ukur);
      window.visualViewport?.removeEventListener('resize', ukur);
    };
  }, [areaRef, kunci, mode, terapkan]);

  const setMode = useCallback(
    (m: ModeBaris) => {
      simpan(kunci, m);
      setModeState(m);
      if (m === 'auto') return; // pengukur yang menetapkan jumlah baris
      // Ganti ke 20/50/100: pertahankan item pertama yang sedang terlihat.
      const lama = perRef.current;
      const indeksAwal = Math.max(0, (halRef.current - 1) * lama);
      const totalHalBaru = Math.max(1, Math.ceil(totalRef.current / m));
      const halBaru = Math.min(totalHalBaru, Math.floor(indeksAwal / m) + 1);
      perRef.current = m;
      setPer(m);
      if (halBaru !== halRef.current) setHalRef.current(halBaru);
    },
    [kunci],
  );

  return { per, mode, setMode };
}

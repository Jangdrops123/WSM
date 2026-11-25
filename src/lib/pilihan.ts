import { useEffect, useRef, useState } from 'react';

/**
 * State pilihan massal untuk tabel.
 *
 * - Bertahan saat pindah halaman / ganti urutan.
 * - Direset saat pencarian / filter berubah (resetKunci).
 * - Mendukung shift+klik (rentang) dan "pilih semua N sesuai filter".
 */
export function usePilihan(resetKunci: unknown[]) {
  const [terpilih, setTerpilih] = useState<Set<number>>(() => new Set());
  const [semuaFilter, setSemuaFilter] = useState(false);
  const [jangkar, setJangkar] = useState<number | null>(null);
  const kunciTerakhir = useRef(JSON.stringify(resetKunci));

  useEffect(() => {
    const k = JSON.stringify(resetKunci);
    if (k !== kunciTerakhir.current) {
      kunciTerakhir.current = k;
      setTerpilih(new Set());
      setSemuaFilter(false);
      setJangkar(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, resetKunci);

  /** Centang satu baris; shift = pilih rentang dari baris jangkar. */
  const toggle = (id: number, shift: boolean, idsHalaman: number[]) => {
    setSemuaFilter(false);
    setTerpilih((prev) => {
      const baru = new Set(prev);
      if (shift && jangkar !== null && jangkar !== id) {
        const a = idsHalaman.indexOf(jangkar);
        const b = idsHalaman.indexOf(id);
        if (a !== -1 && b !== -1) {
          const [dari, ke] = a < b ? [a, b] : [b, a];
          for (let i = dari; i <= ke; i++) baru.add(idsHalaman[i]);
          return baru;
        }
      }
      if (baru.has(id)) baru.delete(id);
      else baru.add(id);
      return baru;
    });
    setJangkar(id);
  };

  /** Pilih/kosongkan seluruh baris halaman ini. */
  const setSemuaHalaman = (idsHalaman: number[], ya: boolean) => {
    setSemuaFilter(false);
    setTerpilih((prev) => {
      const baru = new Set(prev);
      for (const id of idsHalaman) {
        if (ya) baru.add(id);
        else baru.delete(id);
      }
      return baru;
    });
    setJangkar(null);
  };

  /** Pilih seluruh hasil filter (semua halaman) — daftar id diambil klien. */
  const pilihFilter = (semuaId: number[]) => {
    setTerpilih(new Set(semuaId));
    setSemuaFilter(true);
    setJangkar(null);
  };

  const bersihkan = () => {
    setTerpilih(new Set());
    setSemuaFilter(false);
    setJangkar(null);
  };

  return { terpilih, semuaFilter, jumlah: terpilih.size, toggle, setSemuaHalaman, pilihFilter, bersihkan };
}

/** Status checkbox header: penuh / sebagian (indeterminate) / kosong. */
export function statusCentang(data: readonly unknown[], terpilih: Set<number>): { penuh: boolean; sebagian: boolean } {
  const pilih = data.filter((b) => terpilih.has(Number((b as { id?: unknown }).id))).length;
  return { penuh: data.length > 0 && pilih === data.length, sebagian: pilih > 0 && pilih < data.length };
}

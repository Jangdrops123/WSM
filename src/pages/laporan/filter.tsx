import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { KUNCI_FILTER, KUNCI_TAMBAHAN, PARAMETER_AWAL, type ParameterSemua } from './tipe';

/**
 * N2 — Filter & periode global laporan:
 *  - state bertahan saat berpindah antar laporan (konteks induk /laporan),
 *  - selalu disinkronkan ke query string sehingga tautan bisa dibagikan,
 *  - URL berisi parameter (mis. tombol Back/tautan dibagi) → dihidrasi kembali.
 */

interface NilaiFilter {
  params: ParameterSemua;
  ubah: (kunci: string, nilai: string) => void;
  ubahBanyak: (patch: Record<string, string>) => void;
  reset: () => void;
  ser: string;
}

const Ctx = createContext<NilaiFilter | null>(null);

function dariSearch(search: string): ParameterSemua {
  const sp = new URLSearchParams(search);
  const p: ParameterSemua = { ...PARAMETER_AWAL } as ParameterSemua;
  for (const k of [...KUNCI_FILTER, ...KUNCI_TAMBAHAN]) {
    const v = sp.get(k);
    if (v) p[k] = v;
  }
  return p;
}

function serialisasi(p: ParameterSemua): string {
  const sp = new URLSearchParams();
  for (const k of [...KUNCI_FILTER, ...KUNCI_TAMBAHAN]) {
    const v = p[k];        if (v && !(k in PARAMETER_AWAL && v === (PARAMETER_AWAL as unknown as Record<string, string>)[k])) sp.set(k, v);
  }
  // Parameter periode default tidak perlu ditulis agar URL bersih.
  if (p.periode === PARAMETER_AWAL.periode) sp.delete('periode');
  return sp.toString();
}

export function FilterProvider({ children }: { children: ReactNode }) {
  const lokasi = useLocation();
  const [, setCari] = useSearchParams();
  const [params, setParams] = useState<ParameterSemua>(() => dariSearch(lokasi.search));

  const ser = useMemo(() => serialisasi(params), [params]);

  // URL → state, diselaraskan SAAT RENDER (bukan lewat efek) supaya drill-down
  // / tautan dibagi / tombol Back langsung menghidrasi state filter tanpa
  // bolak-balik dengan efek state → URL yang bisa menghapus query baru.
  const [kiniDariUrl, setKiniDariUrl] = useState(lokasi.search);
  if (lokasi.search !== kiniDariUrl) {
    setKiniDariUrl(lokasi.search);
    const kini = lokasi.search.startsWith('?') ? lokasi.search.slice(1) : lokasi.search;
    if (kini !== ser) setParams(dariSearch(kini));
  }

  // state → URL (replace agar riwayat navigasi tidak dipenuhi perubahan filter).
  useEffect(() => {
    const kini = lokasi.search.startsWith('?') ? lokasi.search.slice(1) : lokasi.search;
    if (kini !== ser) setCari(new URLSearchParams(ser), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ser, lokasi.search]);

  const ubah = useCallback((kunci: string, nilai: string) => {
    setParams((p) => ({ ...p, [kunci]: nilai }));
  }, []);

  const ubahBanyak = useCallback((patch: Record<string, string>) => {
    setParams((p) => ({ ...p, ...patch }));
  }, []);

  const reset = useCallback(() => {
    setParams({ ...PARAMETER_AWAL } as ParameterSemua);
  }, []);

  return <Ctx.Provider value={{ params, ubah, ubahBanyak, reset, ser }}>{children}</Ctx.Provider>;
}

/** Akses filter global. Wajib dipakai di dalam FilterProvider (/laporan). */
export function useFilterLaporan(): NilaiFilter {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFilterLaporan harus di dalam FilterProvider');
  return v;
}

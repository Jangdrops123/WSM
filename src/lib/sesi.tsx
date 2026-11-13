// Konteks sesi Log In (Tahap 1) — sumber kebenaran "siapa yang masuk".
//
// * Saat aplikasi dimuat: GET /api/auth/sesi → masuk/keluar.
// * Setiap balasan 401 (mis. sesi idle habis) dialihkan otomatis ke Log In.
// * Setelah masuk, peran lokal (localStorage) disinkronkan dengan peran sesi
//   sehingga seluruh kode lama yang memakai `peranAktif()` ikut konsisten.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { apiGet, apiPost, saatSesiBerakhir } from './api';
import { setPeranAktif, simpanPreferensiServer, type Peran } from './pengguna';
import { muatPreferensiScan } from './umpanBalikScan';

interface PreferensiServer {
  halaman: Record<string, string>;
  mode_pos: string;
}

export interface HakKhususSesi {
  lihat_hpp: boolean;
  ubah_harga_kasir: boolean;
  diskon_maks: number;
  hapus_transaksi: boolean;
  proses_tahunan: boolean;
}

export interface PenggunaSesi {
  id: number;
  nama: string;
  username: string;
  peran: Peran;
  peranNama: string;
  admin: boolean;
  adminUtama: boolean;
  wajibGanti: boolean;
  email: string | null;
  wa: string | null;
}

export interface InfoSesi {
  masuk: true;
  pengguna: PenggunaSesi;
  /** Matriks modul → daftar aksi (langsung berlaku tanpa login ulang). */
  hak: Record<string, string[]>;
  khusus: HakKhususSesi;
  cakupanToko: string[] | null;
  /** WI2 — gudang default, akses, dan kunci pilihan gudang untuk transaksi. */
  gudang?: { ids: number[] | null; defaultId: number | null; locked: boolean };
  sesiMenit: number;
  /** AY — menu awal peran dari server (null = peran tanpa halaman). */
  menuAwal: { kode: string; rute: string } | null;
  /** Id sesi ini (panel Keamanan menandai "Sesi ini"). */
  sesiId?: number;
}

export type StatusSesi = 'memuat' | 'masuk' | 'keluar';

interface ApiSesi {
  status: StatusSesi;
  info: InfoSesi | null;
  /** Pesan alasan keluar (mis. "sesi berakhir karena tidak aktif"). */
  pesan: string | null;
  muat: () => Promise<void>;
  /** Mengembalikan identitas sesi baru — dipakai untuk tujuan halaman awal. */
  masuk: (username: string, sandi: string, ingat: boolean) => Promise<InfoSesi>;
  keluar: () => Promise<void>;
  bersihkanPesan: () => void;
}

const KonteksSesi = createContext<ApiSesi | null>(null);

export function useSesi(): ApiSesi {
  const v = useContext(KonteksSesi);
  if (!v) throw new Error('useSesi harus dipakai di dalam <PenyediaSesi>.');
  return v;
}

export function PenyediaSesi({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<StatusSesi>('memuat');
  const [info, setInfo] = useState<InfoSesi | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);
  const statusRef = useRef<StatusSesi>('memuat');
  statusRef.current = status;

  const terima = useCallback((i: InfoSesi, pref?: PreferensiServer) => {
    // Preferensi global (halaman awal & mode POS) ditulis SEBELUM status
    // "masuk" supaya rute "/" langsung memakai nilai yang benar.
    if (pref) simpanPreferensiServer(pref.halaman, pref.mode_pos);
    setInfo(i);
    setStatus('masuk');
    // Suara scan global (termasuk audio kustom dari Admin) dimuat ulang setiap
    // sesi masuk agar terminal kasir/staf memakai file terbaru.
    void muatPreferensiScan().catch(() => undefined);
    // Peran sesi menjadi peran aktif lokal (kompatibilitas kode lama).
    try {
      setPeranAktif(i.pengguna.peran);
      // BAGIAN AJ — preferensi "Baris per halaman" disimpan per pengguna.
      localStorage.setItem('nusapos.pengguna', i.pengguna.username);
    } catch {
      /* localStorage tidak tersedia — abaikan */
    }
  }, []);

  const muat = useCallback(async () => {
    try {
      const i = await apiGet<InfoSesi>('/api/auth/sesi');
      let pref: PreferensiServer | undefined;
      try {
        pref = await apiGet<PreferensiServer>('/api/pengguna/halaman-awal');
      } catch {
        /* preferensi opsional — jangan gagalkan sesi */
      }
      terima(i, pref);
    } catch {
      setInfo(null);
      setStatus('keluar');
    }
  }, [terima]);

  // 401 dari endpoint mana pun → kembali ke Log In (dengan pesan server).
  useEffect(
    () =>
      saatSesiBerakhir((p) => {
        if (statusRef.current === 'masuk') setPesan(p);
        setInfo(null);
        setStatus('keluar');
        try {
          localStorage.removeItem('nusapos.pengguna');
        } catch {
          /* abaikan */
        }
      }),
    [],
  );

  // Cek sesi saat aplikasi dibuka (mencakup pemuatan URL langsung).
  useEffect(() => {
    void muat();
  }, [muat]);

  const masuk = useCallback(
    async (username: string, sandi: string, ingat: boolean) => {
      const r = await apiPost<{ pesan: string; wajibGanti: boolean; sesi: InfoSesi }>('/api/auth/masuk', {
        username,
        sandi,
        ingat,
      });
      setPesan(null);
      let pref: PreferensiServer | undefined;
      try {
        pref = await apiGet<PreferensiServer>('/api/pengguna/halaman-awal');
      } catch {
        /* preferensi opsional */
      }
      terima(r.sesi, pref);
      return r.sesi;
    },
    [terima],
  );

  const keluar = useCallback(async () => {
    try {
      await apiPost('/api/auth/keluar', {});
    } catch {
      /* sesi mungkin sudah habis — tetap bersihkan status lokal */
    }
    setInfo(null);
    setPesan(null);
    setStatus('keluar');
    try {
      localStorage.removeItem('nusapos.pengguna');
    } catch {
      /* abaikan */
    }
  }, []);

  const bersihkanPesan = useCallback(() => setPesan(null), []);

  const nilai = useMemo<ApiSesi>(
    () => ({ status, info, pesan, muat, masuk, keluar, bersihkanPesan }),
    [status, info, pesan, muat, masuk, keluar, bersihkanPesan],
  );

  return <KonteksSesi.Provider value={nilai}>{children}</KonteksSesi.Provider>;
}

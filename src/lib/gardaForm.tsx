import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../components/crud/Modal';

export interface GardaFormOpsi {
  /** true = formulir terisi (kotor) → navigasi ditahan + Critical. */
  aktif: boolean;
  /** Dipanggil tombol hijau: simpan draft/tahan/komit. Galat ditangani pemanggil (toast). */
  simpan: () => Promise<unknown>;
  /** Dibaca ulang usai simpan/buang (wajib lewat ref agar tak basi oleh closure). */
  masihKotor: () => boolean;
  /** Dipanggil tombol merah: kosongkan formulir tanpa menyimpan. */
  buang: () => void;
  /** Label tombol hijau (bawaan: Simpan Draft & Pindah). */
  labelSimpan?: string;
  /** Kembalikan true untuk rute tujuan yang TIDAK perlu ditahan
   *  (mis. pindah mode POS yang membawa keranjang via pindahMode). */
  lewati?: (tujuan: string) => boolean;
  /**
   * 'simpan' (bawaan)  = dialog tiga tombol (simpan draft / hapus / batal).
   * 'tinggalkan'       = dialog dua tombol untuk form tanpa konsep draft
   *                      (Buat/Edit PO, Barang Datang): hanya tinggalkan
   *                      (buang perubahan) atau tetap di halaman.
   */
  mode?: 'simpan' | 'tinggalkan';
  /** Judul dialog (bawaan mengikuti mode). */
  judul?: string;
  /** Pesan peringatan di dalam dialog. */
  pesan?: string;
  /** Label tombol merah/keluar mode 'tinggalkan'. */
  labelTinggalkan?: string;
  /** Label tombol netral mode 'tinggalkan'. */
  labelTetap?: string;
}

/** Tujuan tertunda: path, aksi lokal, atau niat tombol Back browser. */
type Tujuan = string | (() => void) | typeof KEMBALI;
const KEMBALI = { kembali: true } as const;

/**
 * Garda navigasi formulir kotor (unsaved-changes guard) untuk BrowserRouter.
 *
 * `useBlocker` hanya hidup di data router (createBrowserRouter) — di
 * BrowserRouter ia melempar "useBlocker must be used within a data router".
 * Garda ini tidak memakainya; sebagai gantinya:
 *
 * - Klik tautan internal (<a href="/…"> sidebar, topbar, jejak) dicegat di
 *   fase capture saat `aktif`: preventDefault + modal konfirmasi.
 * - Tombol Back browser ditahan via entri dummy history + `popstate`.
 * - Reload/tutup tab: dialog bawaan via `beforeunload`.
 * - Navigasi programatik di dalam form (tombol Kembali dsb.) lewat `minta()`.
 *
 * Usai simpan/buang, guard membaca ulang `masihKotor()`: hanya lanjut bila
 * formulir benar-benar bersih (validasi gagal → tetap di tempat).
 */
export function useGardaForm({
  aktif,
  simpan,
  masihKotor,
  buang,
  labelSimpan,
  lewati,
  mode = 'simpan',
  judul,
  pesan,
  labelTinggalkan,
  labelTetap,
}: GardaFormOpsi): {
  garda: ReactNode;
  minta: (tujuan: string | (() => void)) => void;
} {
  const navigate = useNavigate();
  const [sibuk, setSibuk] = useState(false);
  const [terbuka, setTerbuka] = useState(false);
  const tujuanRef = useRef<Tujuan | null>(null);
  const kotorRef = useRef(aktif);
  kotorRef.current = aktif;
  const kotorUlangRef = useRef(masihKotor);
  kotorUlangRef.current = masihKotor;
  const simpanRef = useRef(simpan);
  simpanRef.current = simpan;
  const buangRef = useRef(buang);
  buangRef.current = buang;
  const lewatiRef = useRef(lewati);
  lewatiRef.current = lewati;
  const dibatalkanRef = useRef(false);

  /** Minta pindah (jalur programatik): langsung bila bersih, modal bila kotor. */
  const minta = (tujuan: string | (() => void)): void => {
    if (!kotorRef.current) {
      if (typeof tujuan === 'string') navigate(tujuan);
      else tujuan();
      return;
    }
    dibatalkanRef.current = false;
    tujuanRef.current = tujuan;
    setTerbuka(true);
  };
  const mintaRef = useRef(minta);
  mintaRef.current = minta;

  // Reload/tutup tab: dialog bawaan browser (teks milik browser).
  useEffect(() => {
    if (!aktif) return;
    const saatTutup = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', saatTutup);
    return () => window.removeEventListener('beforeunload', saatTutup);
  }, [aktif]);

  // Cegat klik tautan internal saat kotor (sidebar, topbar, jejak, dsb.).
  useEffect(() => {
    if (!aktif) return;
    const saatKlik = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const jangkar = (e.target as HTMLElement | null)?.closest?.('a[href]');
      if (!jangkar) return;
      const a = jangkar as HTMLAnchorElement;
      if (a.target && a.target !== '_self') return;
      if (a.hasAttribute('download')) return;
      const href = a.getAttribute('href') ?? '';
      if (!href.startsWith('/')) return;
      const url = new URL(href, window.location.origin);
      const kini = window.location;
      if (url.pathname === kini.pathname && url.search === kini.search && url.hash === kini.hash) return;
      if (lewatiRef.current?.(url.pathname)) return;
      e.preventDefault();
      e.stopPropagation();
      mintaRef.current(url.pathname + url.search + url.hash);
    };
    document.addEventListener('click', saatKlik, true);
    return () => document.removeEventListener('click', saatKlik, true);
  }, [aktif]);

  // Tahan tombol Back browser via entri dummy + popstate.
  useEffect(() => {
    if (!aktif) return;
    let dummy = false;
    try {
      window.history.pushState({ garda: true }, '');
      dummy = true;
    } catch {
      /* abaikan */
    }
    const saatPop = (): void => {
      try {
        window.history.pushState({ garda: true }, '');
      } catch {
        /* abaikan */
      }
      dibatalkanRef.current = false;
      tujuanRef.current = KEMBALI;
      setTerbuka(true);
    };
    window.addEventListener('popstate', saatPop);
    return () => {
      window.removeEventListener('popstate', saatPop);
      if (dummy && !tujuanRef.current) {
        // Form menjadi bersih saat masih di halaman: buang dummy agar Back normal.
        try {
          if ((window.history.state as { garda?: boolean } | null)?.garda) window.history.back();
        } catch {
          /* abaikan */
        }
      }
    };
  }, [aktif]);

  const tutupBatal = (): void => {
    dibatalkanRef.current = true;
    tujuanRef.current = null;
    setTerbuka(false);
  };

  const jalankanTujuan = (): void => {
    const t = tujuanRef.current;
    tujuanRef.current = null;
    setTerbuka(false);
    if (typeof t === 'function') {
      t();
    } else if (typeof t === 'string') {
      navigate(t);
    } else if (t === KEMBALI) {
      // Dari entri dummy: lewati entri form, mendarat di halaman sebelumnya.
      if (window.history.length > 2) window.history.go(-2);
      else navigate('/');
    }
  };

  const aksiSimpan = async (): Promise<void> => {
    setSibuk(true);
    try {
      await simpanRef.current();
    } catch {
      /* Galat sudah diberitahukan fungsi simpan lewat toast. */
    } finally {
      setSibuk(false);
    }
    // Batal saat simpan berjalan → tetap di form meski simpan sukses.
    if (kotorUlangRef.current() || dibatalkanRef.current) return;
    jalankanTujuan();
  };

  const aksiBuang = (): void => {
    buangRef.current();
    jalankanTujuan();
  };

  if (!terbuka) return { garda: null, minta };

  return {
    garda: (
      <>
        {/* Tata letak kaki modal garda: 3 tombol sejajar sama lebar;
            lingkup kelas ini saja (tanpa menyentuh .tombol-baris global). */}
        <style>{`
          .garda-form__aksi{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;width:100%}
          .garda-form__aksi .tombol{min-width:0;width:100%;margin:0;padding-left:.5rem;padding-right:.5rem;
            font-size:12px;line-height:1.35;text-align:center;text-wrap:balance;align-self:stretch}
          @media (max-width:480px){.garda-form__aksi{grid-template-columns:minmax(0,1fr)}}
        `}</style>
      <Modal
        judul={judul ?? (mode === 'tinggalkan' ? 'Perubahan Belum Disimpan' : 'Batalkan Penginputan Transaksi?')}
        lebar="kecil"
        onTutup={tutupBatal}
        sedangKirim={sibuk}
        aksi={
          mode === 'tinggalkan' ? (
            <div className="tombol-baris garda-form__aksi" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
              <button type="button" className="tombol tombol--netral" onClick={tutupBatal} disabled={sibuk} data-fokus-awal>
                {labelTetap ?? 'Tetap di Halaman Ini'}
              </button>
              <button type="button" className="tombol tombol--bahaya" onClick={aksiBuang} disabled={sibuk}>
                {labelTinggalkan ?? 'Ya, Tinggalkan & Hapus'}
              </button>
            </div>
          ) : (
            <div className="tombol-baris garda-form__aksi">
              <button type="button" className="tombol tombol--primer" onClick={() => void aksiSimpan()} disabled={sibuk} data-fokus-awal>
                {sibuk ? 'Menyimpan…' : (labelSimpan ?? 'Simpan Draft & Pindah')}
              </button>
              <button type="button" className="tombol tombol--bahaya" onClick={aksiBuang} disabled={sibuk}>
                Hapus & Pindah
              </button>
              <button type="button" className="tombol tombol--netral" onClick={tutupBatal} disabled={sibuk}>
                Batal (Lanjutkan Edit)
              </button>
            </div>
          )
        }
      >
        <p className="teks-redup teks-kecil">
          {pesan ??
            'Masih ada data item di formulir ini yang belum disimpan. Simpan dulu sebagai draft sebelum pindah modul, atau hapus dan buang perubahan.'}
        </p>
      </Modal>
      </>
    ),
    minta,
  };
}

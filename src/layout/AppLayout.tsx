import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { grupPemilik, jalurAkarModul, menuAktif, menuUntukPeran, ruteDiizinkan } from '../config/menu';
import { Icon } from '../components/Icon';
import { IconButton } from '../components/IconButton';
import { PopupTutorial, TombolTutorial } from '../components/PopupTutorial';
import { apiGet } from '../lib/api';
import {
  bacaPreferensi,
  gantiTema,
  labelTema,
  pasangPantauSistem,
  sinkronTemaDariServer,
  terapkanPreferensi,
  type Tema,
} from '../lib/tema';
import { useJamTransaksi } from '../pages/pos/JamTransaksi';
import { logoUntukTema, terapkanWarnaKartu } from '../lib/identitas';
import { useIdentitasAplikasi } from '../lib/PenyediaIdentitas';
import { useKesehatanServer } from '../lib/useKesehatanServer';
import { sinkronTampilanBaru } from '../lib/tampilanBaru';
import { pasangLabelTabelOtomatis } from '../lib/labelTabel';
import { pasangGulirQtyOtomatis } from '../lib/barisTransaksi';
import { EVENT_SCROLL_HALAMAN, izinkanScrollLuar, terapkanScrollLuar } from '../lib/scrollHalaman';
import { mintaSegarkanModul } from '../lib/segarkan';
import { useSesi } from '../lib/sesi';
import { DialogGantiSandi } from '../pages/auth/DialogGantiSandi';
import { TolakAkses } from '../pages/TolakAkses';
import {
  keadaanSidebar,
  modeFokus,
  modePosTerakhir,
  namaPeran,
  peranAktif,
  rutePos,
  setKeadaanSidebar,
  setModeFokus,
  type KeadaanSidebar,
} from '../lib/pengguna';

/**
 * Kerangka aplikasi: sidebar navigasi + topbar + konten halaman.
 *
 * R1 — urutan menu & sub-menu mengikuti spesifikasi; menu tanpa sub adalah
 *      tautan langsung, menu dengan sub memakai panah.
 * R2 — akordeon: hanya SATU grup terbuka, grup halaman aktif terbuka otomatis,
 *      animasi 180 ms + dukungan keyboard (panah, Esc) & reduced-motion.
 * R3 — keadaan sidebar expanded (240px) / collapsed (64px, flyout) / hidden
 *      (panel melayang lewat hamburger), tersimpan per pengguna.
 * R4 — bawaan ikut lebar layar: ≥1440 expanded, <1440 collapsed, <768 laci.
 * U1 — Mode Fokus (Ctrl+Shift+F): sembunyikan sidebar, rapikan header.
 * M1/M4 — grup bisa dibuka-tutup; tombol keranjang + F9 membuka POS.
 */
export function AppLayout() {
  // X1.2 — identitas aplikasi (nama, tagline, logo) dari satu sumber data.
  const identitas = useIdentitasAplikasi();
  const logo = logoUntukTema(identitas);
  const lokasi = useLocation();
  const navigate = useNavigate();
  /* Tombol kembali topbar: navigasi TERISOLASI per modul (module-scoped).
     Tujuan selalu halaman utama modul yang sedang aktif — bukan history
     browser — sehingga pengguna tidak pernah terlempar ke modul lain yang
     dikunjungi sebelumnya. Di halaman utama modul, tombol disembunyikan. */
  const akarModul = jalurAkarModul(lokasi.pathname);
  const diAkarModul = akarModul === null || lokasi.pathname === akarModul;
  const bisaKembali = akarModul !== null && !diAkarModul;
  // TAHAP 1/2 — sesi login adalah sumber kebenaran: identitas pengguna +
  // matriks hak akses (modul → aksi) yang menggerakkan penyaringan sidebar.
  const sesi = useSesi();
  const info = sesi.info;
  const hak = info?.hak;
  // Peran sesi (bukan sisa localStorage) agar pergantian peran langsung
  // mengikuti hak akses akun yang sedang masuk.
  const peran = info?.pengguna.peran ?? peranAktif();
  const menu = menuUntukPeran(peran, hak);
  const aktif = menuAktif(lokasi.pathname);
  // AY2 — logo/ikon aplikasi membuka menu awal peran pengguna ini.
  const ruteMenuAwal = info?.menuAwal?.rute ?? '/';
  // Z6/TAHAP 2 — rute yang tidak boleh dibuka peran ini: sidebar sudah
  // menyembunyikan menunya, URL langsung dijawab halaman "Tidak punya akses".
  const diizinkan = ruteDiizinkan(peran, lokasi.pathname, hak);
  // BAGIAN AJ — hanya Master Data yang memakai kerangka pas layar: konten tidak
  // menggulir di luar, tabel & footer mengisi sisa tinggi persis satu layar.
  const modeFit = /^\/master(\/|$)/.test(lokasi.pathname);
  const sehat = useKesehatanServer();
  // Jam realtime header (1 detik) mengikuti zona & format regional.
  const jamTopbar = useJamTransaksi();

  /* AL5 — papan ketik menutup footer: teruskan tinggi keyboard visualViewport
     ke CSS (--kb) agar footer/paginasi terangkat di atasnya. */
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const atur = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--kb', `${Math.round(kb)}px`);
    };
    atur();
    vv.addEventListener('resize', atur);
    vv.addEventListener('scroll', atur);
    return () => {
      vv.removeEventListener('resize', atur);
      vv.removeEventListener('scroll', atur);
      document.documentElement.style.setProperty('--kb', '0px');
    };
  }, []);

  /* ------------- TAHAP 1 — menu pengguna di header (klik nama) ------------ */
  const [menuPenggunaBuka, setMenuPenggunaBuka] = useState(false);
  const penggunaRef = useRef<HTMLDivElement>(null);
  const [dialogSandi, setDialogSandi] = useState(false);

  useEffect(() => {
    if (!menuPenggunaBuka) return;
    const onDown = (e: MouseEvent) => {
      if (!penggunaRef.current?.contains(e.target as Node)) setMenuPenggunaBuka(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuPenggunaBuka(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuPenggunaBuka]);


  /* --------------------------- R4: lebar layar --------------------------- */
  // matchMedia (bukan event resize) — perubahan lebar, orientasi, dan viewport
  // devtools langsung terbaca tanpa menunggu render ulang manual.
  const mqPonsel = useMemo(
    () => (typeof window === 'undefined' ? null : window.matchMedia('(max-width: 767.98px)')),
    [],
  );
  // U1 — bawaan collapsed di bawah 1440px (semula 1280px) agar konten lebih luas.
  const mqKecil = useMemo(
    () => (typeof window === 'undefined' ? null : window.matchMedia('(max-width: 1439.98px)')),
    [],
  );
  const [hp, setHp] = useState(() => mqPonsel?.matches ?? false);
  const [kecil, setKecil] = useState(() => mqKecil?.matches ?? false);

  useEffect(() => {
    if (!mqPonsel || !mqKecil) return;
    // Sinkronkan dari `matches` (bukan dari nilai acara) supaya state tidak
    // pernah menyimpang — mis. saat peramban melewatkan event change.
    const sinkron = () => {
      setHp(mqPonsel.matches);
      setKecil(mqKecil.matches);
    };
    mqPonsel.addEventListener('change', sinkron);
    mqKecil.addEventListener('change', sinkron);
    // Cadangan: sebagian lingkungan (WebView tertentu) hanya mengirim resize.
    window.addEventListener('resize', sinkron);
    return () => {
      mqPonsel.removeEventListener('change', sinkron);
      mqKecil.removeEventListener('change', sinkron);
      window.removeEventListener('resize', sinkron);
    };
  }, [mqPonsel, mqKecil]);

  /* --------------------------- R3: keadaan sidebar ----------------------- */
  // Dibaca sekali dari localStorage (tanpa kedip); null = ikuti lebar layar.
  const [pilihan, setPilihan] = useState<KeadaanSidebar | null>(keadaanSidebar);
  // true = tampil sebagai panel melayang (laci di ponsel / tombol hamburger).
  const [overlay, setOverlay] = useState(false);
  // U1 — Mode Fokus: sidebar tersembunyi permanen sampai dimatikan lagi.
  const [fokus, setFokus] = useState(() => modeFokus());

  const dasar: KeadaanSidebar = hp ? 'hidden' : fokus ? 'hidden' : (pilihan ?? (kecil ? 'collapsed' : 'expanded'));
  const keadaan: KeadaanSidebar = overlay
    ? fokus
      ? 'expanded'
      : pilihan === 'collapsed'
        ? 'collapsed'
        : 'expanded'
    : dasar;
  const tertutup = keadaan === 'hidden';

  function toggleFokus(): void {
    const baru = !fokus;
    setFokus(baru);
    setModeFokus(baru);
    setOverlay(false);
    setFlyout(null);
  }

  // U1 — pintasan Ctrl+Shift+F.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey || e.key.toLowerCase() !== 'f') return;
      e.preventDefault();
      toggleFokus();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fokus]);

  function simpanKeadaan(k: KeadaanSidebar): void {
    setPilihan(k);
    setKeadaanSidebar(k);
  }

  /** Tombol ikon di kepala sidebar: expanded ↔ collapsed (R3). */
  function toggleHeader(): void {
    simpanKeadaan(keadaan === 'expanded' ? 'collapsed' : 'expanded');
    setOverlay(false);
  }

  /** Ctrl+B: sembunyikan, atau tampilkan kembali sebagai panel melayang. */
  function toggleCtrlB(): void {
    if (keadaan === 'hidden') setOverlay(true);
    else {
      setOverlay(false);
      simpanKeadaan('hidden');
      setFlyout(null);
    }
  }

  const labelToggle =
    keadaan === 'expanded' ? 'Ciutkan menu' : 'Tampilkan menu';

  /* --------------------------- R2: akordeon ------------------------------ */
  // Satu grup terbuka pada satu waktu; nilainya mengikuti halaman aktif.
  const [grupBuka, setGrupBuka] = useState<string | null>(null);

  useEffect(() => {
    const induk = grupPemilik(lokasi.pathname);
    const punyaSub = induk?.anak?.length && menu.some((m) => m.kode === induk.kode);
    setGrupBuka(punyaSub ? induk.kode : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lokasi.pathname]);

  function alihGrup(kode: string): void {
    setGrupBuka((prev) => (prev === kode ? null : kode));
  }

  /* ------------------------ S: flyout sub-menu mode ciut ------------------ */
  const [flyout, setFlyout] = useState<{ kode: string; pin: boolean } | null>(null);
  const [tip, setTip] = useState<{ teks: string; x: number; y: number } | null>(null);
  const asideRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  /** Ikon grup yang membuka flyout — target pengembalian fokus saat Esc. */
  const flyoutPemicuRef = useRef<HTMLElement | null>(null);
  /** Elemen flyout (portal di body) — klik di dalamnya bukan "klik di luar". */
  const flyoutRef = useRef<HTMLDivElement | null>(null);
  const timerBukaFlyout = useRef<number | null>(null); // jeda hover 150 ms
  const timerTutupFlyout = useRef<number | null>(null); // toleransi pindah kursor 200 ms

  const modeCiut = keadaan === 'collapsed';

  // Layar sentuh: hanya klik/ketuk yang membuka flyout (hover tidak berlaku).
  const hoverBoleh = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches,
    [],
  );

  function bersihkanTimerFlyout(): void {
    if (timerBukaFlyout.current) {
      window.clearTimeout(timerBukaFlyout.current);
      timerBukaFlyout.current = null;
    }
    if (timerTutupFlyout.current) {
      window.clearTimeout(timerTutupFlyout.current);
      timerTutupFlyout.current = null;
    }
  }

  function bukaFlyout(el: HTMLElement, kode: string, pin: boolean, fokusItemPertama = false): void {
    if (!modeCiut) return;
    flyoutPemicuRef.current = el;
    setFlyout((prev) => (prev && prev.kode === kode && prev.pin && !pin ? prev : { kode, pin }));
    if (fokusItemPertama) {
      // Keyboard (Enter/Spasi): fokus pindah ke sub-menu pertama.
      window.requestAnimationFrame(() => {
        flyoutRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
      });
    }
  }

  /** Tutup flyout; opsional kembalikan fokus ke ikon grup (Esc / Tab). */
  function tutupFlyout(kembalikanFokus = false): void {
    bersihkanTimerFlyout();
    setFlyout(null);
    if (kembalikanFokus) flyoutPemicuRef.current?.focus();
  }

  /** Hover ikon grup (desktop): buka flyout setelah jeda 150 ms. */
  function hoverBukaFlyout(el: HTMLElement, kode: string): void {
    if (!hoverBoleh || !modeCiut) return;
    if (timerTutupFlyout.current) {
      window.clearTimeout(timerTutupFlyout.current);
      timerTutupFlyout.current = null;
    }
    if (timerBukaFlyout.current) return;
    timerBukaFlyout.current = window.setTimeout(() => {
      timerBukaFlyout.current = null;
      bukaFlyout(el, kode, false);
    }, 150);
  }

  /** Kursor keluar ikon/flyout: tutup setelah toleransi 200 ms (untuk berpindah kursor). */
  function hoverTutupFlyout(): void {
    if (timerBukaFlyout.current) {
      window.clearTimeout(timerBukaFlyout.current);
      timerBukaFlyout.current = null;
    }
    if (!flyout || flyout.pin) return; // flyout klik hanya tutup via klik-luar/Esc/pilih item
    if (timerTutupFlyout.current) window.clearTimeout(timerTutupFlyout.current);
    timerTutupFlyout.current = window.setTimeout(() => {
      timerTutupFlyout.current = null;
      setFlyout(null);
    }, 200);
  }

  // Klik di luar sidebar / panel melayang / isi flyout (portal di body) → tutup.
  useEffect(() => {
    if (!flyout && !overlay) return;
    const on = (e: MouseEvent) => {
      const t = e.target as Node;
      if (flyoutRef.current?.contains(t)) return; // klik di dalam flyout
      if (asideRef.current?.contains(t)) return;
      if (hamburgerRef.current?.contains(t)) return;
      setFlyout(null);
      setOverlay(false);
    };
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, [flyout, overlay]);

  // Esc: tutup flyout dulu (kembalikan fokus ke ikon grup), lalu grup akordeon, lalu panel melayang.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (flyout) tutupFlyout(true);
      else if (grupBuka) setGrupBuka(null);
      else if (overlay) setOverlay(false);
      setTip(null);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [flyout, grupBuka, overlay]);

  // Keluar mode ciut → tutup flyout; unmount → bersihkan timer hover.
  useEffect(() => {
    if (!modeCiut && flyout) setFlyout(null);
  }, [modeCiut, flyout]);

  useEffect(() => () => bersihkanTimerFlyout(), []);

  // Tabel transaksi (PO, Pembelian, POS, Item Masuk/Keluar, Retur): setiap input
  // Qty yang menerima fokus menggulir barisnya ke area pandang — tanpa perlu
  // handler per halaman.
  useEffect(() => pasangGulirQtyOtomatis(), []);

  /* Roda mouse/trackpad di area yang tidak bisa menggulir sendiri (sidebar,
     bilah atas, atau area kosong di luar konten) diteruskan ke area gulir utama
     (.app-utama) — halaman bisa digulir dari posisi kursor mana pun. Elemen
     yang memang bisa menggulir sendiri (menu sidebar, tabel) tetap didahulukan. */
  useEffect(() => {
    const bisaGulirSendiri = (awal: HTMLElement | null, delta: number): boolean => {
      let el: HTMLElement | null = awal;
      while (el && el !== document.body) {
        const gaya = getComputedStyle(el);
        if (/(auto|scroll)/.test(gaya.overflowY) && el.scrollHeight - el.clientHeight > 1) {
          const sisa = delta > 0 ? el.scrollHeight - el.clientHeight - el.scrollTop : el.scrollTop;
          if (sisa > 1) return true;
        }
        el = el.parentElement;
      }
      return false;
    };
    const saatRoda = (e: WheelEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('.app-utama')) return; // sudah di area konten — biarkan bawaan
      const utama = document.querySelector<HTMLElement>('.app-utama');
      if (!utama || utama.scrollHeight - utama.clientHeight <= 1) return;
      if (bisaGulirSendiri(target, e.deltaY)) return; // mis. daftar menu sidebar
      e.preventDefault();
      utama.scrollBy({ top: e.deltaY });
    };
    window.addEventListener('wheel', saatRoda, { passive: false });
    return () => window.removeEventListener('wheel', saatRoda);
  }, []);

  // Kontrol scroll area luar per halaman (Pengaturan ▸ Tampilan): halaman yang
  // tidak diizinkan dikunci setinggi layar — gulir hanya di area konten/tabel.
  useEffect(() => {
    const terapkan = () => {
      const izin = izinkanScrollLuar(lokasi.pathname);
      terapkanScrollLuar(izin);
      // Mode terkunci memakai .konten sebagai area gulir — mulai dari atas.
      if (!izin) document.querySelector<HTMLElement>('.konten')?.scrollTo({ top: 0 });
    };
    terapkan();
    window.addEventListener(EVENT_SCROLL_HALAMAN, terapkan);
    return () => window.removeEventListener(EVENT_SCROLL_HALAMAN, terapkan);
  }, [lokasi.pathname]);

  // Posisi portal fixed: tepi atas sejajar ikon yang diklik, jarak 8px dari
  // sidebar, clamp ke viewport; dihitung ulang saat scroll (capture) & resize.
  useLayoutEffect(() => {
    const el = flyoutRef.current;
    if (!modeCiut || !flyout || !el) return;
    const hitung = () => {
      const ikon = flyoutPemicuRef.current;
      if (!ikon) return;
      const r = ikon.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // flyout: fixed/portal; tepi kirinya 8px di LUAR tepi kanan sidebar.
      // Pakai offsetWidth sidebar (nilai layout stabil) + scrollX, agar jarak
      // konsisten 8px dan tidak menimpa sidebar walau gutter host berbeda.
      const sb = asideRef.current;
      const lebarSidebar = sb ? sb.offsetWidth : Math.round(r.right - r.left);
      let kiri = sb ? sb.offsetLeft + lebarSidebar + 8 : r.right + 8;
      kiri += window.scrollX;
      if (kiri + w > vw - 12) kiri = Math.max(12, vw - w - 12);
      // Posisi awal: tepi atas sejajar ikon (r.top). Hanya geser ke atas bila
      // TIDAK muat di bawah (agar menu terbawah tetap sejajar ikon).
      let atas = r.top;
      if (atas + h > vh - 6) atas = vh - h - 6; // geser ke atas agar muat
      atas = Math.max(6, atas);
      el.style.left = `${Math.round(kiri)}px`;
      el.style.top = `${Math.round(atas)}px`;
      // Panah penunjuk sebaris dengan ikon (disembunyikan bila mendekati sudut).
      const panah = Math.round(r.top + r.height / 2 - atas);
      el.style.setProperty('--panah-y', `${panah}px`);
      el.dataset.panah = panah >= 14 && panah <= h - 14 ? '1' : '0';
    };
    hitung();
    window.addEventListener('scroll', hitung, true);
    window.addEventListener('resize', hitung);
    return () => {
      window.removeEventListener('scroll', hitung, true);
      window.removeEventListener('resize', hitung);
    };
  }, [flyout, modeCiut]);

  // Pintasan R3 — Ctrl+B.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        toggleCtrlB();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keadaan, overlay]);

  /** Panah atas/bawah berpindah antar item menu yang terlihat (R2). */
  function pindahFokus(e: React.KeyboardEvent): void {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const nav = navRef.current;
    if (!nav) return;
    const semua = Array.from(
      nav.querySelectorAll<HTMLElement>('button.nav-grup__judul, a.nav-item'),
    ).filter((el) => !el.closest('[data-tertutup="true"]'));
    if (!semua.length) return;
    e.preventDefault();
    const arah = e.key === 'ArrowDown' ? 1 : -1;
    const i = semua.indexOf(document.activeElement as HTMLElement);
    const tujuan = i === -1 ? (arah > 0 ? 0 : semua.length - 1) : (i + arah + semua.length) % semua.length;
    semua[tujuan].focus();
  }

  /** Tooltip nama menu pada mode ciut (hover & fokus) — hanya menu langsung
   *  (tanpa sub); grup membuka flyout sehingga tidak menampilkan tooltip ganda. */
  function tipkan(e: { currentTarget: HTMLElement }): void {
    if (!modeCiut) return;
    if (e.currentTarget.classList.contains('nav-grup__judul')) return;
    const r = e.currentTarget.getBoundingClientRect();
    setTip({
      teks: e.currentTarget.dataset.label ?? '',
      x: r.right + 10,
      y: r.top + r.height / 2,
    });
  }
  const hilangTip = () => setTip(null);

  /* Warna latar kartu mengikuti Identitas Aplikasi; terapkan ulang setiap
     tema atau pilihan kartu berubah (tanpa muat ulang). */
  const warnaKartu = identitas.kartu;
  useEffect(() => {
    terapkanWarnaKartu(warnaKartu);
    const pantau = new MutationObserver(() => terapkanWarnaKartu(warnaKartu));
    pantau.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => pantau.disconnect();
  }, [warnaKartu]);

  /* --------------------------- tema, lencana, POS ------------------------- */
  const [tema, setTema] = useState<Tema>(() => bacaPreferensi().tema);
  useEffect(() => {
    terapkanPreferensi();
    pasangLabelTabelOtomatis();
    void sinkronTemaDariServer().then(() => setTema(bacaPreferensi().tema));
    // U2 — kepadatan/ukuran font tersimpan per pengguna: tarik dari server
    // bila perangkat ini belum punya pilihan lokal.
    void sinkronTampilanBaru();
    return pasangPantauSistem();
  }, []);

  const [terlambat, setTerlambat] = useState(0);
  useEffect(() => {
    let batal = false;
    const muatBadge = () => {
      apiGet<{ terlambat: number }>('/api/dashboard/badge')
        .then((r) => {
          if (!batal) setTerlambat(Number(r.terlambat) || 0);
        })
        .catch(() => {
          /* API belum siap — lencana tetap 0 */
        });
    };
    muatBadge();
    window.addEventListener('pengingat-berubah', muatBadge);
    return () => {
      batal = true;
      window.removeEventListener('pengingat-berubah', muatBadge);
    };
  }, [lokasi.pathname]);

  // M4 — pintasan global F9: buka POS dengan mode terakhir dipakai.
  // (Ctrl+Shift+F untuk Mode Fokus ditangani di atas, dekat state `fokus`.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F9') {
        e.preventDefault();
        navigate(rutePos(modePosTerakhir()));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const bukaPos = () => navigate(rutePos(modePosTerakhir()));

  /** Pindah halaman: tutup laci (ponsel) & flyout. */
  const tutup = () => {
    bersihkanTimerFlyout();
    setOverlay(false);
    setFlyout(null);
  };

  const indukBuka = grupPemilik(lokasi.pathname)?.kode ?? null;

  return (
    <div
      className="app-shell"
      data-sb={keadaan}
      data-overlay={overlay ? '1' : '0'}
      data-hp={hp ? '1' : '0'}
      data-fokus={fokus ? '1' : '0'}
    >
      {overlay && <div className="sidebar-overlay" onClick={tutup} aria-hidden="true" />}

      <aside
        ref={asideRef}
        className="sidebar"
        aria-hidden={tertutup ? true : undefined}
        aria-label="Sidebar"
      >
        <div className="sidebar__brand">
          {/* X1.2 — logo & nama dari satu sumber data (identitas aplikasi).
              AY2 — logo membuka menu awal peran pengguna ini. */}
          <button
            type="button"
            className="sidebar__logo-tombol"
            onClick={() => navigate(ruteMenuAwal)}
            title="Buka menu awal peran Anda"
            aria-label="Buka menu awal peran Anda"
          >
            {logo ? (
              <span
                className="sidebar__logo sidebar__logo--gambar"
                data-tip={identitas.nama}
                style={identitas.latar ? { background: `var(--${identitas.latar})` } : undefined}
              >
                <img src={logo} alt="" />
              </span>
            ) : (
              <span className="sidebar__logo" data-tip={identitas.nama}>
                <Icon nama="database" size={22} />
              </span>
            )}
          </button>
          {/* Nama & tagline statis (read-only): pengeditan hanya lewat
              Pengaturan ▸ Identitas Aplikasi. Tanpa tooltip/hover edit. */}
          <span className="sidebar__brand-teks" aria-label={`${identitas.nama}${identitas.tagline ? ` — ${identitas.tagline}` : ''}`}>
            <strong>{identitas.nama}</strong>
            {identitas.tagline !== '' && <small>{identitas.tagline}</small>}
          </span>
          <button
            type="button"
            className="sidebar__ciut"
            onClick={toggleHeader}
            aria-label={labelToggle}
            data-tip={labelToggle}
          >
            <Icon nama={keadaan === 'expanded' ? 'chevron-left' : 'chevron-right'} size={18} />
          </button>
          <button
            type="button"
            className="sidebar__tutup"
            onClick={tutup}
            aria-label="Tutup menu"
          >
            <Icon nama="close" size={20} />
          </button>
        </div>

        <nav
          ref={navRef}
          className="sidebar__nav"
          aria-label="Menu utama"
          onKeyDown={pindahFokus}
        >
          <p className="sidebar__menu-label" aria-hidden="true">MENU</p>
          {menu.map((m) => {
            /* --- Menu tanpa sub: tautan langsung (R1) --- */
            if (!m.anak?.length) {
              return (
                <NavLink
                  key={m.kode}
                  to={m.path}
                  end={m.path === '/'}
                  data-label={m.label}
                  className={({ isActive }) => `nav-item ${isActive ? 'nav-item--aktif' : ''}`}
                  onClick={() => {
                    setGrupBuka(null); // R2 — klik menu langsung menutup grup terbuka
                    tutup();
                  }}
                  onMouseEnter={tipkan}
                  onMouseLeave={hilangTip}
                  onFocus={tipkan}
                  onBlur={hilangTip}
                >
                  <Icon nama={m.icon} size={19} />
                  <span>{m.label}</span>
                  {m.kode === 'penjualan' && terlambat > 0 && (
                    <span className="nav-badge" title={`${terlambat} faktur terlambat belum dibayar`}>
                      {terlambat > 99 ? '99+' : terlambat}
                    </span>
                  )}
                </NavLink>
              );
            }

            /* --- Induk tautan langsung + anak (mis. Penjualan): klik label
                = buka modul, tombol panah = akordeon Retur/Piutang --- */
            if (m.tautanInduk) {
              const terbukaH = grupBuka === m.kode && !modeCiut;
              const indukAktifH = indukBuka === m.kode;
              const idAnakH = `grup-${m.kode}`;
              return (
                <div key={m.kode} className="nav-grup">
                  <div className="nav-grup__baris">
                    <NavLink
                      to={m.path}
                      end
                      data-label={m.label}
                      className={({ isActive }) =>
                        `nav-item nav-grup__tautan ${isActive || indukAktifH ? 'nav-item--aktif' : ''}`
                      }
                      onClick={tutup}
                      onMouseEnter={(e) => {
                        tipkan(e);
                        if (modeCiut) hoverBukaFlyout(e.currentTarget, m.kode);
                      }}
                      onMouseLeave={() => {
                        hilangTip();
                        if (modeCiut) hoverTutupFlyout();
                      }}
                      onFocus={tipkan}
                      onBlur={hilangTip}
                    >
                      <Icon nama={m.icon} size={19} />
                      <span>{m.label}</span>
                      {m.kode === 'penjualan' && terlambat > 0 && (
                        <span className="nav-badge" title={`${terlambat} faktur terlambat belum dibayar`}>
                          {terlambat > 99 ? '99+' : terlambat}
                        </span>
                      )}
                    </NavLink>
                    <button
                      type="button"
                      className="nav-grup__aliha"
                      aria-expanded={modeCiut ? Boolean(flyout?.kode === m.kode) : terbukaH}
                      aria-controls={idAnakH}
                      aria-label={terbukaH ? `Ciutkan sub-menu ${m.label}` : `Bentangkan sub-menu ${m.label}`}
                      data-label={`Sub-menu ${m.label}`}
                      onClick={(e) => {
                        if (modeCiut) {
                          bersihkanTimerFlyout(); // klik membatalkan jeda hover
                          if (flyout?.kode === m.kode) tutupFlyout();
                          else bukaFlyout(e.currentTarget, m.kode, true, e.detail === 0);
                        } else alihGrup(m.kode);
                      }}
                      onMouseEnter={(e) => hoverBukaFlyout(e.currentTarget, m.kode)}
                      onMouseLeave={hoverTutupFlyout}
                    >
                      <Icon nama="chevron-right" size={15} className="nav-grup__panah" />
                    </button>
                  </div>

                  <div
                    className={`nav-grup__anak ${terbukaH ? 'nav-grup__anak--buka' : ''}`}
                    id={idAnakH}
                    data-tertutup={terbukaH ? 'false' : 'true'}
                    aria-hidden={!terbukaH}
                  >
                    <div className="nav-grup__isi">
                      {m.anak.map((a) => (
                        <NavLink
                          key={a.kode}
                          to={a.path}
                          end={!a.lebar}
                          data-label={a.label}
                          className={({ isActive }) =>
                            `nav-item nav-item--anak ${isActive ? 'nav-item--aktif' : ''}`
                          }
                          onClick={tutup}
                          onMouseEnter={tipkan}
                          onMouseLeave={hilangTip}
                          onFocus={tipkan}
                          onBlur={hilangTip}
                        >
                          <span>{a.label}</span>
                        </NavLink>
                      ))}
                    </div>
                  </div>
                </div>
              );
            }

            /* --- Menu induk dengan sub-menu: tombol akordeon (R1/R2) --- */
            const terbuka = grupBuka === m.kode && !modeCiut;
            const indukAktif = indukBuka === m.kode;
            const idAnak = `grup-${m.kode}`;

            return (
              <div key={m.kode} className="nav-grup">
                <button
                  type="button"
                  className={`nav-grup__judul ${indukAktif ? 'nav-grup__judul--aktif' : ''} ${
                    modeCiut && flyout?.kode === m.kode ? 'nav-grup__judul--buka' : ''
                  }`}
                  aria-expanded={modeCiut ? Boolean(flyout?.kode === m.kode) : terbuka}
                  aria-haspopup={modeCiut && m.anak?.length ? 'menu' : undefined}
                  aria-controls={idAnak}
                  data-label={m.label}
                  onClick={(e) => {
                    if (modeCiut && m.anak?.length) {
                      bersihkanTimerFlyout(); // klik membatalkan jeda hover
                      if (flyout?.kode === m.kode) tutupFlyout();
                      else bukaFlyout(e.currentTarget, m.kode, true, e.detail === 0); // Enter/Spasi → fokus item pertama
                    } else alihGrup(m.kode);
                  }}
                  onMouseEnter={(e) => hoverBukaFlyout(e.currentTarget, m.kode)}
                  onMouseLeave={hoverTutupFlyout}
                  onFocus={tipkan}
                  onBlur={hilangTip}
                >
                  <Icon nama={m.icon} size={19} />
                  <span>{m.label}</span>
                  <Icon nama="chevron-right" size={15} className="nav-grup__panah" />
                </button>

                {/* R2 — animasi tinggi bertahap 180 ms; tertutup = visibility hidden
                    supaya tautan di dalamnya tidak bisa difokus keyboard. */}
                <div
                  className={`nav-grup__anak ${terbuka ? 'nav-grup__anak--buka' : ''}`}
                  id={idAnak}
                  data-tertutup={terbuka ? 'false' : 'true'}
                  aria-hidden={!terbuka}
                >
                  <div className="nav-grup__isi">
                    {m.anak.map((a) => (
                      <NavLink
                        key={a.kode}
                        to={a.path}
                        end={!a.lebar}
                        data-label={a.label}
                        className={({ isActive }) =>
                          `nav-item nav-item--anak ${isActive ? 'nav-item--aktif' : ''}`
                        }
                        onClick={tutup}
                        onMouseEnter={tipkan}
                        onMouseLeave={hilangTip}
                        onFocus={tipkan}
                        onBlur={hilangTip}
                      >
                        <span>{a.label}</span>
                      </NavLink>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </nav>

        <div className="sidebar__footer">
          <div className={`status-db status-db--${sehat.berhasil ? 'ok' : 'loading'}`}>
            <span className="status-db__titik" />
            {sehat.berhasil ? 'Database terhubung' : sehat.pesan}
          </div>
        </div>
      </aside>

      {/* S — mode ciut: flyout sub-menu diportaling ke <body> (fixed), agar
          tidak terpotong overflow sidebar dan selalu di atas konten/header. */}
      {modeCiut &&
        flyout &&
        createPortal(
          <div
            key={flyout.kode}
            ref={flyoutRef}
            id={`flyout-${flyout.kode}`}
            className="flyout"
            role="menu"
            aria-label={menu.find((m) => m.kode === flyout.kode)?.label ?? 'Sub-menu'}
            onMouseEnter={() => {
              // Kursor sampai ke flyout: batalkan penutupan otomatis.
              if (timerTutupFlyout.current) {
                window.clearTimeout(timerTutupFlyout.current);
                timerTutupFlyout.current = null;
              }
            }}
            onMouseLeave={hoverTutupFlyout}
            onKeyDown={(e) => {
              if (e.key === 'Tab') {
                e.preventDefault(); // Tab keluar dari pop up → tutup, fokus ke ikon
                tutupFlyout(true);
                return;
              }
              if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
              const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
              if (!items.length) return;
              e.preventDefault();
              const kini = items.indexOf(document.activeElement as HTMLElement);
              const langkah = e.key === 'ArrowDown' ? 1 : -1;
              const berikut =
                kini === -1 ? (langkah > 0 ? 0 : items.length - 1) : (kini + langkah + items.length) % items.length;
              items[berikut]?.focus();
            }}
            onBlur={(e) => {
              // Fokus pindah ke luar flyout (bukan kembali ke ikon pemicu) → tutup.
              const berikut = e.relatedTarget as Node | null;
              if (berikut && (e.currentTarget.contains(berikut) || berikut === flyoutPemicuRef.current)) return;
              tutupFlyout();
            }}
          >
            {(() => {
              const g = menu.find((m) => m.kode === flyout.kode);
              if (!g?.anak?.length) return null;
              return (
                <>
                  <p className="flyout__judul">{g.label}</p>
                  {g.tautanInduk && (
                    <NavLink
                      to={g.path}
                      end
                      role="menuitem"
                      tabIndex={0}
                      className={({ isActive }) => `nav-item nav-item--anak ${isActive ? 'nav-item--aktif' : ''}`}
                      onClick={tutup}
                    >
                      <span>Buka {g.label}</span>
                    </NavLink>
                  )}
                  {g.anak.map((a) => (
                    <NavLink
                      key={a.kode}
                      to={a.path}
                      end={!a.lebar}
                      role="menuitem"
                      tabIndex={0}
                      className={({ isActive }) => `nav-item nav-item--anak ${isActive ? 'nav-item--aktif' : ''}`}
                      onClick={tutup}
                    >
                      <span>{a.label}</span>
                    </NavLink>
                  ))}
                </>
              );
            })()}
          </div>,
          document.body,
        )}

      {tip && (
        <div className="sidebar-tip" style={{ left: `${tip.x}px`, top: `${tip.y}px` }} role="tooltip">
          {tip.teks}
        </div>
      )}

      <div className={`app-utama ${modeFit ? 'app-utama--fit' : ''}`.trim()}>
        <header className="topbar">
          <button
            ref={hamburgerRef}
            type="button"
            className="topbar__hamburger"
            onClick={() => setOverlay(true)}
            aria-label="Buka menu"
            aria-expanded={overlay}
          >
            <Icon nama="menu" size={22} />
          </button>
          {bisaKembali && akarModul && (
            <button
              type="button"
              className="topbar__kembali"
              onClick={() => navigate(akarModul)}
              title={`Kembali ke halaman utama modul`}
              aria-label={`Kembali ke halaman utama modul (${aktif?.label ?? akarModul})`}
            >
              <Icon nama="chevron-left" size={20} />
            </button>
          )}
          <div className="topbar__judul">
            <h1>
              {aktif?.label ?? 'Halaman'}
            </h1>
            <p className="topbar__sub">{aktif?.deskripsi}</p>
          </div>
          <div className="topbar__kanan">
            {/* Segarkan modul: fetch ulang data halaman aktif tanpa reload (SPA). */}
            <IconButton
              ikon="rotate-ccw"
              label="Segarkan data halaman ini"
              arah="bawah"
              ukuran="toolbar"
              className="topbar__segarkan"
              classNameWadah="topbar__opsi"
              onClick={(e) => {
                const btn = e.currentTarget;
                btn.classList.remove('berputar');
                // Paksa ulang animasi putar tiap klik (reflow). 
                void btn.offsetWidth;
                btn.classList.add('berputar');
                window.setTimeout(() => btn.classList.remove('berputar'), 700);
                mintaSegarkanModul();
              }}
            />
            {/* Panduan tutorial per modul — hanya tampil bila rute punya tutorial. */}
            <TombolTutorial />
            {/* U1 — Mode Fokus (Ctrl+Shift+F): sembunyikan sidebar, header ramping. */}
            <IconButton
              ikon={fokus ? 'contract' : 'expand'}
              label={fokus ? 'Mode Fokus (aktif)' : 'Mode Fokus (Ctrl+Shift+F)'}
              arah="bawah"
              ukuran="toolbar"
              classNameWadah="topbar__opsi"
              onClick={toggleFokus}
            />
            {/* P3 — pengalih tema: Terang → Gelap → Ikuti Sistem. */}
            <IconButton
              ikon={tema === 'terang' ? 'sun' : tema === 'gelap' ? 'moon' : 'monitor'}
              label={labelTema(tema)}
              arah="bawah"
              ukuran="toolbar"
              classNameWadah="topbar__opsi topbar__tema"
              onClick={() => setTema(gantiTema().tema)}
            />
            {/* M4 — buka POS dari mana saja; pintasan keyboard F9 juga aktif. */}
            <IconButton
              ikon="pos"
              label="POS (F9)"
              arah="bawah"
              ukuran="toolbar"
              classNameWadah="topbar__opsi"
              onClick={bukaPos}
            />
            <span className="topbar__tanggal" role="timer" aria-label="Tanggal dan jam hari ini">{jamTopbar}</span>
            {/* TAHAP 1 — identitas login: klik nama → Ubah Password / Keluar. */}
            <div className="topbar__pengguna-wrap" ref={penggunaRef}>
              <button
                type="button"
                className="topbar__pengguna"
                aria-haspopup="menu"
                aria-expanded={menuPenggunaBuka}
                aria-label="Menu pengguna"
                onClick={() => setMenuPenggunaBuka((b) => !b)}
              >
                <span className="topbar__avatar">{(info?.pengguna.nama ?? namaPeran(peran)).charAt(0).toUpperCase()}</span>
                <span className="topbar__nama">{info?.pengguna.nama ?? namaPeran(peran)}</span>
                <Icon nama={menuPenggunaBuka ? 'chevron-up' : 'chevron-down'} size={13} />
              </button>
              {menuPenggunaBuka && (
                <div className="topbar__pengguna-menu" role="menu" aria-label="Menu pengguna">
                  <div className="topbar__pengguna-info">
                    <strong>{info?.pengguna.username ?? '-'}</strong>
                    <small>{info?.pengguna.peranNama ?? namaPeran(peran)}</small>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuPenggunaBuka(false);
                      setDialogSandi(true);
                    }}
                  >
                    Ubah Password
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="topbar__keluar"
                    onClick={() => {
                      setMenuPenggunaBuka(false);
                      void sesi.keluar();
                    }}
                  >
                    Keluar
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className={`konten ${modeFit ? 'konten--fit' : ''}`.trim()}>
          {diizinkan ? (
            <Outlet />
          ) : (
            /* TAHAP 2 — URL langsung ke modul yang tidak diizinkan peran ini. */
            <TolakAkses />
          )}
        </main>
      </div>
      {dialogSandi && <DialogGantiSandi onTutup={() => setDialogSandi(false)} />}
      {/* Tutorial per modul — popup otomatis 1x per modul saat pertama dibuka. */}
      <PopupTutorial />
    </div>
  );
}

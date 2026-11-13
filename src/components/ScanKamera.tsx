import { useCallback, useEffect, useRef, useState } from 'react';
import { putarUmpanBalikScan } from '../lib/umpanBalikScan';
import { Modal } from './crud/Modal';
import { IconButton } from './IconButton';
import './ScanKamera.css';

/**
 * AN — Satu komponen pemindai barcode/QR untuk SEMUA modul (Stok, Item
 * Masuk/Keluar, Opname, Pembelian Scan Barcode, POS, Cetak Barcode).
 *
 * Kamera belakang OTOMATIS tanpa pengaturan: modal dibuka → kamera belakang
 * langsung menyala (facingMode environment), tanpa pemilih kamera, senter,
 * zoom, maupun tab jalur. Begitu kode terbaca: bunyi+getar, modal menutup
 * sendiri (mode sekali), hasil diteruskan ke pemanggil (masuk ke input barang).
 *
 * Jalur cadangan (TANPA tab, hanya muncul bila kamera tak bisa dipakai):
 *  (1) kamera  — pratinjau langsung (butuh konteks aman: HTTPS/localhost).
 *      BarcodeDetector bila ada, ZXing (@zxing/browser, dibundel lokal)
 *      sebagai cadangan. Format: EAN-13/8, UPC-A/E, Code 128, Code 39,
 *      ITF, QR. Mode berkelanjutan: bunyi+getar, jeda 1 dtk anti-baca ganda.
 *  (2) foto    — <input type=file capture=environment> membuka aplikasi kamera
 *      bawaan HP (berfungsi di HTTP biasa) + pilih dari galeri; diterjemahkan
 *      lokal di kanvas (tanpa API eksternal).
 *  (3) manual  — ketik kode/SKU + alat pemindai USB/Bluetooth gaya keyboard
 *      (ketikan super-cepat diakhiri Enter dianggap hasil pindai).
 *
 * Pencocokan ke Master Data tetap tugas pemanggil (onHasil): semua pemanggil
 * sudah menanganinya (cocok persis → tambah; tak dikenal → "Kode tidak
 * dikenal" + pilihan Cari manual / Buat produk baru).
 */

export type ModePindai = 'sekali' | 'berkelanjutan';
type Jalur = 'kamera' | 'foto' | 'manual';
type KameraSub = 'memuat' | 'memindai' | 'izin' | 'tanpaKamera';

const FORMAT_BD = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];

/* BarcodeDetector belum ada di lib.dom TS yang dipakai proyek — deklarasi mini. */
type HasilDeteksi = { rawValue: string };
type DetektorPindai = { detect: (sumber: ImageBitmapSource) => Promise<HasilDeteksi[]> };
declare global {
  interface Window {
    BarcodeDetector?: new (opsi?: { formats?: string[] }) => DetektorPindai;
  }
}

/* Dukungan kamera langsung: konteks aman + API media. Tanpa ini, jalur kamera
   disembunyikan (bukan error merah) — pengguna memakai foto/manual. */
export function kameraLangsungTersedia(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia);
}

function buatDetektor(): DetektorPindai | null {
  try {
    const BD = window.BarcodeDetector;
    if (!BD) return null;
    try {
      return new BD({ formats: FORMAT_BD });
    } catch {
      return new BD();
    }
  } catch {
    return null;
  }
}

/* Umpan balik tiap kode terbaca — memakai preferensi Suara & Getar Scan
   (Pengaturan ▸ Suara & Getar Scan). Non-blocking: tidak menahan hasil scan. */
function bunyiBerhasil() {
  putarUmpanBalikScan('ok');
}

type KameraInfo = {
  id: string;
  label: string;
};

async function daftarKamera(): Promise<KameraInfo[]> {
  try {
    const semua = await navigator.mediaDevices.enumerateDevices();
    return semua
      .filter((d) => d.kind === 'videoinput')
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Kamera ${i + 1}` }));
  } catch {
    return [];
  }
}

export function ScanKamera({
  judul = 'Pindai barcode / QR',
  mode = 'sekali',
  onHasil,
  onTutup,
}: {
  judul?: string;
  /**
   * 'sekali' — pop up menutup otomatis setelah kode terbaca (Cari produk).
   * 'berkelanjutan' — pop up tetap terbuka (Opname, Pembelian, Item
   * Masuk/Keluar): tiap kode berbunyi+bergetar, masuk daftar, jeda 1 detik
   * anti-baca ganda; onHasil dipanggil untuk SETIAP kode.
   */
  mode?: ModePindai;
  /** Dipanggil sekali per kode yang terbaca (dari jalur mana pun). */
  onHasil: (teks: string) => void;
  onTutup: () => void;
}) {
  const aman = kameraLangsungTersedia();
  const [jalur, setJalur] = useState<Jalur>(aman ? 'kamera' : 'foto');
  const [sub, setSub] = useState<KameraSub>('memuat');
  const [ulang, setUlang] = useState(0);
  const [daftar, setDaftar] = useState<{ teks: string; waktu: string }[]>([]);
  const [manual, setManual] = useState('');
  const [bantuan, setBantuan] = useState(false);
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const [fotoTeks, setFotoTeks] = useState<string | null>(null);
  const [fotoGalat, setFotoGalat] = useState<string | null>(null);
  const [fotoSibuk, setFotoSibuk] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const inputAmbilRef = useRef<HTMLInputElement>(null);
  const inputGaleriRef = useRef<HTMLInputElement>(null);
  const hentiRef = useRef<(() => void) | null>(null);
  const terakhirRef = useRef(0);
  const selesaiRef = useRef(false);
  const ketukManualRef = useRef<number[]>([]);
  const hasilRef = useRef(onHasil);
  hasilRef.current = onHasil;

  const hentikanKamera = useCallback(() => {
    hentiRef.current?.();
    hentiRef.current = null;
    const video = videoRef.current;
    const stream = video?.srcObject as MediaStream | null;
    stream?.getTracks?.().forEach((t) => {
      try {
        t.stop();
      } catch {
        /* abaikan */
      }
    });
    if (video) video.srcObject = null;
  }, []);

  /* Satu pintu hasil: bunyi+getar, anti-baca ganda 1 dtk, sekali vs kontinu. */
  const tanganiHasil = useCallback(
    (mentah: string) => {
      const teks = mentah.trim();
      if (!teks || selesaiRef.current) return;
      const kini = Date.now();
      if (kini - terakhirRef.current < 1000) return;
      terakhirRef.current = kini;
      bunyiBerhasil();
      if (mode === 'sekali') {
        selesaiRef.current = true;
        hentikanKamera();
        hasilRef.current(teks);
        onTutup();
        return;
      }
      setDaftar((d) => [{ teks, waktu: new Date().toLocaleTimeString('id-ID') }, ...d].slice(0, 50));
      hasilRef.current(teks);
    },
    [hentikanKamera, mode, onTutup],
  );
  const tanganiHasilRef = useRef(tanganiHasil);
  tanganiHasilRef.current = tanganiHasil;

  /* ---- Jalur 1: kamera langsung (BarcodeDetector dulu, ZXing cadangan) ---- */
  useEffect(() => {
    if (jalur !== 'kamera' || !aman) return;
    let batal = false;
    selesaiRef.current = false;
    setSub('memuat');

    /* Minta stream dengan batas waktu: jangan gantung "Menyalakan kamera…"
       bila browser tidak pernah menjawab (prompt diam, kebijakan perangkat). */
    const mintaStream = async (batasan: MediaStreamConstraints, ms = 12000): Promise<MediaStream> => {
      const janji = navigator.mediaDevices.getUserMedia(batasan);
      let id = 0;
      const batas = new Promise<never>((_, tolak) => {
        id = window.setTimeout(
          () => tolak(new DOMException('Permintaan kamera lewat batas waktu', 'TimeoutError')),
          ms,
        );
      });
      try {
        const s = await Promise.race([janji, batas]);
        // Aliran telat (kalah dari batas) langsung dimatikan bila sempat menyala.
        void janji
          .then((telat) => {
            if (telat !== s) telat.getTracks().forEach((t) => { try { t.stop(); } catch { /* abaikan */ } });
          })
          .catch(() => {});
        return s;
      } finally {
        window.clearTimeout(id);
      }
    };

    /* Buka stream kamera BELAKANG (bukan depan) — label sering kosong di HP
       sehingga tebakan indeks tak bisa dipercaya:
       1) syarat tegas facingMode environment (paling andal di Chrome HP);
       2) bila gagal, coba tiap perangkat dan intip settings().facingMode. */
    const bukaBelakang = async (daftar: KameraInfo[]): Promise<MediaStream> => {
      try {
        return await mintaStream({
          video: { facingMode: { exact: 'environment' } },
          audio: false,
        });
      } catch {
        /* lanjut ke iterasi perangkat */
      }
      const skor = (k: KameraInfo) =>
        /back|rear|belakang|environment|utama|main/i.test(k.label) ? 0 : 1;
      const urutan = [...daftar].sort((a, b) => skor(a) - skor(b));
      const terbuka: MediaStream[] = [];
      const matikan = (s: MediaStream) => {
        s.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {
            /* abaikan */
          }
        });
      };
      for (const k of urutan) {
        let s: MediaStream;
        try {
          s = await mintaStream({
            video: { deviceId: { ideal: k.id } },
            audio: false,
          });
        } catch {
          continue;
        }
        const mode = s.getVideoTracks()[0]?.getSettings?.().facingMode;
        if (mode === 'environment') {
          terbuka.forEach(matikan);
          return s;
        }
        terbuka.push(s);
      }
      if (terbuka.length > 0) {
        const [pakai, ...sisa] = terbuka;
        sisa.forEach(matikan);
        return pakai;
      }
      return await mintaStream({ video: true, audio: false });
    };

    const mulai = async () => {
      const video = videoRef.current;
      if (!video) return;
      /* Android/Chrome: enumerateDevices() KOSONG sampai izin kamera diberikan
         — jadi minta izin dulu (memicu dialog izin), baru enumerasi. Tanpa
         langkah ini HP selalu lapor "tidak ada kamera". */
      try {
        const pra = await mintaStream({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        pra.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {
            /* abaikan */
          }
        });
      } catch (e) {
        const nama = (e as Error)?.name ?? '';
        if (batal) return;
        if (nama === 'NotAllowedError' || nama === 'SecurityError') {
          setSub('izin');
          return;
        }
        /* NotFoundError/dll: lanjut — enumerasi di bawah yang memastikan. */
      }
      if (batal) return;
      const daftar = await daftarKamera();
      if (batal) return;
      if (daftar.length === 0) {
        setSub('tanpaKamera');
        return;
      }
      /* Selalu kamera belakang otomatis — tanpa pilihan manual. */
      let stream: MediaStream;
      try {
        stream = await bukaBelakang(daftar);
      } catch (e) {
        if (batal) return;
        const nama = (e as Error)?.name ?? '';
        if (nama === 'NotAllowedError' || nama === 'SecurityError') setSub('izin');
        else setSub('tanpaKamera');
        return;
      }
      if (batal) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => {});
      try {
        /* Coba BarcodeDetector (bawaan browser, ringan) pada stream belakang. */
        const detektor = buatDetektor();
        if (detektor) {
          const timer = window.setInterval(async () => {
            if (batal || selesaiRef.current) return;
            try {
              const hasil = await detektor.detect(video);
              const teks = hasil?.[0]?.rawValue?.trim();
              if (teks) tanganiHasilRef.current(teks);
            } catch {
              /* bingkai rusak — lewati */
            }
          }, 350);
          hentiRef.current = () => window.clearInterval(timer);
          if (!batal) setSub('memindai');
          return;
        }
        /* Cadangan: ZXing membaca stream yang SAMA (tetap kamera belakang). */
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        if (batal) return;
        const pembaca = new BrowserMultiFormatReader();
        const cb = (hasil: { getText: () => string } | undefined) => {
          const teks = hasil?.getText().trim();
          if (teks) tanganiHasilRef.current(teks);
        };
        const kendali = await pembaca.decodeFromStream(stream, video, cb);
        if (batal) {
          try {
            kendali.stop();
          } catch {
            /* abaikan */
          }
          return;
        }
        hentiRef.current = () => {
          try {
            kendali.stop();
          } catch {
            /* abaikan */
          }
        };
        setSub('memindai');
      } catch (e) {
        if (batal) return;
        const nama = (e as Error)?.name ?? '';
        if (nama === 'NotAllowedError' || nama === 'SecurityError') setSub('izin');
        else if (nama === 'NotFoundError' || nama === 'OverconstrainedError') setSub('tanpaKamera');
        else setSub('tanpaKamera');
      }
    };

    void mulai();
    return () => {
      batal = true;
      hentiRef.current?.();
      hentiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jalur, ulang]);

  /* Ganti tab / tutup: pastikan kamera mati. */
  useEffect(() => {
    if (jalur !== 'kamera') {
      hentiRef.current?.();
      hentiRef.current = null;
    }
    return () => {
      hentiRef.current?.();
      hentiRef.current = null;
    };
  }, [jalur]);

  useEffect(
    () => () => {
      hentikanKamera();
      if (fotoUrl) URL.revokeObjectURL(fotoUrl);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const cobaLagi = () => {
    selesaiRef.current = false;
    setSub('memuat');
    setUlang((u) => u + 1); /* picu efek mulai ulang */
  };

  /* ---- Jalur 2: foto (berfungsi di HTTP biasa) ---- */
  const terjemahFoto = useCallback(
    async (file: File) => {
      if (fotoUrl) URL.revokeObjectURL(fotoUrl);
      const url = URL.createObjectURL(file);
      setFotoUrl(url);
      setFotoTeks(null);
      setFotoGalat(null);
      setFotoSibuk(true);
      try {
        /* 1) BarcodeDetector dari bitmap penuh. */
        const detektor = buatDetektor();
        if (detektor) {
          try {
            const bitmap = await createImageBitmap(file);
            const hasil = await detektor.detect(bitmap);
            bitmap.close?.();
            const teks = hasil?.[0]?.rawValue?.trim();
            if (teks) {
              setFotoTeks(teks);
              setFotoSibuk(false);
              return;
            }
          } catch {
            /* jatuh ke ZXing */
          }
        }
        /* 2) ZXing dari elemen gambar (diperkecil biar cepat). */
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error('gagal'));
          el.src = url;
        });
        const pembaca = new BrowserMultiFormatReader();
        const hasil = await pembaca.decodeFromImageElement(img);
        const teks = hasil?.getText().trim();
        if (!teks) throw new Error('kosong');
        setFotoTeks(teks);
      } catch {
        setFotoGalat('Kode tidak terbaca. Coba dekatkan, pastikan cahaya cukup dan barcode tidak buram, lalu foto ulang.');
      } finally {
        setFotoSibuk(false);
      }
    },
    [fotoUrl],
  );

  const pakaiHasilFoto = () => {
    if (fotoTeks) tanganiHasil(fotoTeks);
  };

  /* ---- Jalur 3: manual + alat pemindai keyboard-wedge ---- */
  const pakaiManual = useCallback(
    (paksa?: string) => {
      const teks = (paksa ?? manual).trim();
      if (!teks || selesaiRef.current) return;
      if (mode === 'sekali') selesaiRef.current = true;
      hentikanKamera();
      bunyiBerhasil();
      hasilRef.current(teks);
      if (mode === 'sekali') onTutup();
      else {
        setDaftar((d) => [{ teks, waktu: new Date().toLocaleTimeString('id-ID') }, ...d].slice(0, 50));
        setManual('');
      }
    },
    [manual, mode, hentikanKamera, onTutup],
  );

  /* Ketikan super-cepat diakhiri Enter (alat wedge) = hasil pindai. */
  const ketukTombol = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const kini = performance.now();
    ketukManualRef.current = [...ketukManualRef.current.slice(-24), kini];
    if (e.key === 'Enter') {
      e.preventDefault();
      const riwayat = ketukManualRef.current;
      const teks = manual.trim();
      if (riwayat.length >= 4 && teks.length >= 3) {
        const jeda: number[] = [];
        for (let i = 1; i < riwayat.length; i++) jeda.push(riwayat[i] - riwayat[i - 1]);
        const rata = jeda.reduce((a, b) => a + b, 0) / jeda.length;
        if (rata < 60) bunyiBerhasil(); /* wedge terdeteksi */
      }
      ketukManualRef.current = [];
      pakaiManual();
    }
  };

  const pindahJalur = (j: Jalur) => {
    setJalur(j);
    setBantuan(false);
  };

  return (
    <Modal judul={judul} lebar="sedang" onTutup={onTutup}>
      <div className="pindai">
        {/* Tanpa tab: kamera belakang langsung aktif; foto/ketik hanya
            muncul sebagai cadangan bila kamera tak bisa dipakai. */}
        {/* AN5 — konteks tidak aman: kartu info KUNING (bukan error merah). */}
        {!aman && (
          <div className="pindai__info" role="note">
            <strong>Kamera langsung butuh HTTPS.</strong> Anda tetap bisa memindai lewat{' '}
            <button type="button" className="pindai__taut" onClick={() => pindahJalur('foto')}>
              foto
            </button>{' '}
            atau{' '}
            <button type="button" className="pindai__taut" onClick={() => pindahJalur('manual')}>
              mengetik kode
            </button>
            .
            <button
              type="button"
              className="pindai__taut"
              aria-expanded={bantuan}
              onClick={() => setBantuan((b) => !b)}
            >
              {bantuan ? 'Sembunyikan cara mengaktifkan kamera' : 'Cara mengaktifkan kamera'}
            </button>
            {bantuan && (
              <ol className="pindai__bantuan">
                <li>
                  Di komputer sendiri: buka lewat <code>http://localhost:5173</code> (dianggap aman oleh browser).
                </li>
                <li>
                  Di HP via Wi-Fi: jalankan <code>npm run dev:https</code> di komputer, lalu buka alamat{' '}
                  <code>https://192.168.x.x:5173</code> yang tampil di terminal dan terima peringatan sertifikat.
                </li>
                <li>
                  Alternatif: <code>adb reverse tcp:5173 tcp:5173</code> lalu buka{' '}
                  <code>http://localhost:5173</code> di HP.
                </li>
                <li>Produksi: sajikan aplikasi lewat HTTPS (domain + sertifikat otomatis).</li>
              </ol>
            )}
          </div>
        )}

        {/* ---------- Jalur 1: kamera ---------- */}
        {jalur === 'kamera' && aman && sub !== 'tanpaKamera' && (
          <div className="pindai__video-wadah">
            <video ref={videoRef} className="pindai__video" muted playsInline autoPlay />
            <div className="pindai__bingkai" aria-hidden>
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="pindai__garis" aria-hidden />
            {sub === 'memuat' && <p className="pindai__status">Menyalakan kamera…</p>}
            {sub === 'izin' && (
              <div className="pindai__izin">
                <p>
                  <strong>Izin kamera ditolak.</strong> Izinkan kamera di pengaturan situs browser, lalu coba lagi —
                  atau pakai foto / ketik manual.
                </p>
                <div className="pindai__izin-aksi">
                  <button type="button" className="tombol tombol--kecil" onClick={cobaLagi}>
                    Coba lagi
                  </button>
                  <button type="button" className="tombol tombol--kecil tombol--netral" onClick={() => pindahJalur('foto')}>
                    Pakai foto
                  </button>
                  <button type="button" className="tombol tombol--kecil tombol--netral" onClick={() => pindahJalur('manual')}>
                    Ketik manual
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {jalur === 'kamera' && aman && sub === 'tanpaKamera' && (
          <div className="pindai__info" role="note">
            <strong>Kamera belum tersedia.</strong> Pastikan izin kamera diizinkan untuk situs ini lalu{' '}
            <button type="button" className="pindai__taut" onClick={cobaLagi}>
              coba lagi
            </button>{' '}
            — atau pakai{' '}
            <button type="button" className="pindai__taut" onClick={() => pindahJalur('foto')}>
              foto
            </button>{' '}
            atau{' '}
            <button type="button" className="pindai__taut" onClick={() => pindahJalur('manual')}>
              ketik manual
            </button>
            .
          </div>
        )}

        {jalur === 'kamera' && aman && sub === 'memindai' && (
          <p className="teks-redup teks-kecil pindai__petunjuk">Arahkan garis ke barcode / QR</p>
        )}

        {/* ---------- Jalur 2: foto ---------- */}
        {jalur === 'foto' && (
          <div className="pindai__foto">
            <input
              ref={inputAmbilRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              aria-hidden={false}
              aria-label="Ambil foto barcode"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void terjemahFoto(f);
              }}
            />
            <input
              ref={inputGaleriRef}
              type="file"
              accept="image/*"
              hidden
              aria-label="Pilih dari galeri"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void terjemahFoto(f);
              }}
            />
            <div className="pindai__foto-aksi">
              <button type="button" className="tombol tombol--primer" onClick={() => inputAmbilRef.current?.click()}>
                Ambil foto barcode
              </button>
              <button type="button" className="tombol tombol--netral" onClick={() => inputGaleriRef.current?.click()}>
                Pilih dari galeri
              </button>
            </div>
            {fotoSibuk && <p className="teks-redup teks-kecil">Membaca foto…</p>}
            {fotoUrl && (
              <div className="pindai__foto-hasil">
                <img src={fotoUrl} alt="Pratinjau foto barcode" className="pindai__foto-pratinjau" />
                {fotoTeks && (
                  <p className="pindai__foto-teks">
                    Terbaca: <strong>{fotoTeks}</strong>
                  </p>
                )}
                {fotoGalat && (
                  <p className="pindai__foto-galat" role="alert">
                    {fotoGalat}
                  </p>
                )}
                <div className="pindai__foto-aksi">
                  {fotoTeks && (
                    <button type="button" className="tombol tombol--kecil tombol--primer" onClick={pakaiHasilFoto}>
                      Pakai hasil ini
                    </button>
                  )}
                  <button
                    type="button"
                    className="tombol tombol--kecil tombol--netral"
                    onClick={() => inputAmbilRef.current?.click()}
                  >
                    Foto ulang
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ---------- Hasil terakhir + daftar (mode berkelanjutan) ---------- */}
        {mode === 'berkelanjutan' && daftar.length > 0 && (
          <div className="pindai__daftar">
            <p className="teks-redup teks-kecil">
              Terbaca {daftar.length} kode{daftar.length > 1 ? '' : ''} (tetap di sini untuk pindai beruntun)
            </p>
            <ul>
              {daftar.slice(0, 8).map((d, i) => (
                <li key={`${d.teks}-${i}`}>
                  <strong>{d.teks}</strong> <span className="teks-redup">{d.waktu}</span>
                </li>
              ))}
            </ul>
            {daftar.length > 8 && <p className="teks-redup teks-kecil">…dan {daftar.length - 8} lainnya</p>}
          </div>
        )}

        {/* ---------- Jalur 3: manual (selalu tersedia, menempel di bawah) ---------- */}
        {(jalur === 'manual' || mode === 'berkelanjutan' || !aman) && (
          <div className="pindai__manual">
            <label className="teks-redup teks-kecil" htmlFor="pindai-manual">
              {jalur === 'manual' ? 'Ketik kode / SKU (alat pemindai langsung bisa dipakai di sini)' : '…atau ketik manual'}
            </label>
            <div className="pindai__manual-baris">
              <input
                id="pindai-manual"
                data-fokus-awal={jalur === 'manual' ? true : undefined}
                className="input-cari"
                type="text"
                inputMode="search"
                autoComplete="off"
                autoFocus={jalur === 'manual'}
                placeholder="Ketik kode / SKU…"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                onKeyDown={ketukTombol}
              />
              <button type="button" className="tombol" disabled={!manual.trim()} onClick={() => pakaiManual()}>
                Pakai
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * Tombol kamera untuk semua kolom pencarian (barcode khusus maupun umum).
 * Membuka ScanKamera; hasil pindaian diteruskan ke `onHasil` (isi kolom).
 * `mode="berkelanjutan"` untuk Opname/Pembelian/Item Masuk-Keluar (pop up
 * tetap terbuka untuk pindai beruntun).
 */
export function TombolScan({
  onHasil,
  label = 'Pindai dengan kamera',
  judul,
  mode = 'sekali',
}: {
  onHasil: (teks: string) => void;
  label?: string;
  judul?: string;
  mode?: ModePindai;
}) {
  const [buka, setBuka] = useState(false);
  return (
    <>
      <IconButton ikon="scan" label={label} ukuran="toolbar" onClick={() => setBuka(true)} />
      {buka && <ScanKamera judul={judul} mode={mode} onHasil={onHasil} onTutup={() => setBuka(false)} />}
    </>
  );
}

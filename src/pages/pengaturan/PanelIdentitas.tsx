// BAGIAN Y2 — Pengaturan ▸ Identitas Aplikasi (menu berdiri sendiri, grup
// "Pengaturan Dasar", urutan paling atas; hanya Admin/Owner).
//
// Isi halaman (Y2.1):
//   • Logo: Ganti (PNG/SVG/JPG/WebP maks 2 MB), Edit (potong persegi/bulat/
//     sudut membulat + zoom + geser), Hapus (kembali ke bawaan) untuk varian
//     tema Siang, tema Malam, dan Ikon kecil (sidebar ciut + favicon).
//   • Nama, tagline, judul tab browser, favicon, warna aksen & latar ikon —
//     semuanya dengan penghitung karakter.
//   • Pratinjau langsung di sisi kanan (sidebar terbuka, sidebar ciut, halaman
//     Log In, tab browser, kop faktur) untuk tema Siang dan Malam.
//   • Tombol "Simpan identitas" dan "Kembalikan bawaan" berupa ikon ber-tooltip.
//
// Y2.2 — hubungan dengan Profil Usaha & Data Toko & Gudang dijelaskan di sini,
// lengkap dengan opsi "Pakai logo dan nama ini juga untuk faktur dan struk"
// serta pilihan cakupan bila fitur multi toko aktif.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { Modal } from '../../components/crud/Modal';
import { beritahu } from '../../components/crud/Toast';
import { apiGet, apiPost, apiPut } from '../../lib/api';
import { useSegarkanModul } from '../../lib/segarkan';
import { PALET_AKSEN, URUTAN_AKSEN, LABEL_AKSEN, gradasiAksen } from '../../lib/aksen';
import { useSesi } from '../../lib/sesi';
import {
  UKURAN_LOGO_MUAT_BAWAAN,
  UKURAN_LOGO_MUAT_MIN,
  bacaUkuranLogoMuat,
  gayaLayarMuat,
  normalUkuranLogoMuat,
  putarLayarMuat,
  simpanUkuranLogoMuat,
} from '../../lib/layarMuat';
import {
  bacaIdentitas,
  faviconEfektif,
  judulTab,
  logoUntukTemaTertentu,
  setIdentitas,
  terapkanWarnaKartu,
  type Identitas,
} from '../../lib/identitas';
import { hapusSalinan } from '../../lib/salinanIdentitas';
import { segarkanUsaha } from '../../lib/usaha';

type Varian = 'siang' | 'malam' | 'ikon';

const VARIAN_LABEL: Record<Varian, string> = {
  siang: 'Logo tema Siang',
  malam: 'Logo tema Malam',
  ikon: 'Ikon kecil (sidebar ciut, favicon, splash)',
};

const MAKS = { nama: 60, tagline: 80, judul: 80 } as const;
const MAKS_BYTES = 2 * 1024 * 1024;

interface Meta {
  multiToko: boolean;
  toko: { nilai: string; label: string }[];
  cakupan: string;
  pakaiFaktur: boolean;
  namaUsaha: string;
  logoUsaha: string;
}

/** Tema yang sedang tampil — dipakai tombol "Putar layar muat". */
function temaSekarang(): 'siang' | 'malam' {
  return document.documentElement.dataset.theme === 'dark' ? 'malam' : 'siang';
}

/** Preset warna latar kartu ('' = Solid White bawaan). */
const PRESET_KARTU: { nilai: string; label: string }[] = [
  { nilai: '', label: 'Solid White (Bawaan)' },
  { nilai: '#f8fafc', label: 'Off-White / Warm Soft' },
  { nilai: '#f0fdf4', label: 'Soft Emerald / Mint Light' },
];

/** Warna latar ikon logo (token pilihan "Warna latar ikon"). */
const LATAR: Record<string, { siang: string; malam: string }> = {
  '': { siang: '#eef2ff', malam: '#1e293b' },
  surface: { siang: '#f8fafc', malam: '#0f172a' },
  'surface-2': { siang: '#f1f5f9', malam: '#1e293b' },
  'primer-lembut': { siang: '#e0e7ff', malam: '#312e81' },
  panel: { siang: '#ffffff', malam: '#111827' },
};

/** Baca File → data URL (tanpa kompresi — logo harus tajam & transparan). */
function keDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Gagal membaca berkas.'));
    r.readAsDataURL(file);
  });
}

export function PanelIdentitas({ toko = '' }: { toko?: string }) {
  // AX — satu penanda Top (sesi), bukan nama peran di kode.
  const admin = useSesi().info?.pengguna.admin === true;
  const [id, setId] = useState<Identitas>(() => bacaIdentitas());
  const [tersimpan, setTersimpan] = useState<Identitas | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [crop, setCrop] = useState<{ varian: Varian; dataUrl: string } | null>(null);
  // Ukuran logo layar muat (px) — disimpan langsung ke localStorage agar
  // berlaku pada pembukaan aplikasi berikutnya, tanpa perlu Simpan identitas.
  const [ukuranLogo, setUkuranLogo] = useState<number>(() => bacaUkuranLogoMuat());
  const [ukuranTeks, setUkuranTeks] = useState(() => String(bacaUkuranLogoMuat()));
  const ubahUkuranLogo = (v: unknown) => setUkuranLogo(simpanUkuranLogoMuat(v));
  const fileRef = useRef<HTMLInputElement>(null);
  const varianRef = useRef<Varian>('siang');

  const perToko = id.cakupan === 'per-toko';

  // Meta (multi toko, nama & logo usaha yang sedang berlaku) dimuat ulang
  // setelah simpan supaya teks bantuan & pratinjau kop faktur selalu segar.
  const muatMeta = useCallback(async () => {
    if (!admin) return;
    try {
      setMeta(await apiGet<Meta>('/api/tampilan/identitas/meta'));
    } catch {
      setMeta(null);
    }
  }, [admin]);

  const muat = useCallback(async () => {
    const q = toko ? `?toko=${encodeURIComponent(toko)}` : '';
    try {
      const i = await apiGet<Identitas>(`/api/tampilan/identitas${q}`);
      setId(i);
      setTersimpan(i);
      setIdentitas(i);
    } catch {
      setTersimpan(bacaIdentitas());
    }
    await muatMeta();
  }, [toko, muatMeta]);

  useEffect(() => {
    void muat();
  }, [muat]);
  // Tombol Refresh global di topbar: muat ulang identitas (tanpa menyentuh form).
  useSegarkanModul(muat);

  const kotor = tersimpan !== null && JSON.stringify(id) !== JSON.stringify(tersimpan);
  const tanpaToko = perToko && !toko;

  const simpanTeks = async () => {
    if (tanpaToko) {
      beritahu('Pilih toko aktif dulu (Data Toko & Gudang) untuk cakupan per toko.', 'galat');
      return;
    }
    setSibuk(true);
    try {
      const r = await apiPut<Identitas>('/api/tampilan/identitas', {
        nama: id.nama,
        tagline: id.tagline,
        judulTab: id.judulTab,
        favicon: id.favicon,
        aksen: id.aksen,
        latar: id.latar,
        kartu: id.kartu,
        pakaiFaktur: id.pakaiFaktur,
        cakupan: id.cakupan,
        toko: perToko ? toko : null,
      });
      setId(r);
      setTersimpan(r);
      setIdentitas(r);
      // Opsi faktur aktif → nama/logo usaha ikut berganti: sebarkan ke kasir,
      // struk, faktur & laporan tanpa muat ulang.
      void segarkanUsaha().catch(() => undefined);
      await muatMeta(); // nama & logo usaha ikut berganti saat opsi faktur aktif
      beritahu('Identitas aplikasi tersimpan.', 'sukses');
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    } finally {
      setSibuk(false);
    }
  };

  const keBawaan = async () => {
    if (
      !window.confirm(
        'Kembalikan seluruh identitas aplikasi (nama, tagline, judul tab, favicon, warna, logo) ke bawaan?\n\nLogo yang sudah diunggah ikut dihapus.',
      )
    ) {
      return;
    }
    setSibuk(true);
    try {
      const r = await apiPost<{ identitas: Identitas }>('/api/tampilan/identitas/bawaan', {
        toko: perToko ? toko : null,
      });
      setId(r.identitas);
      setTersimpan(r.identitas);
      // AI1(4) — salinan layar muat dihapus; muat berikutnya netral lalu
      // terisi lagi dari identitas (kini bawaan) saat aplikasi memuatnya.
      setIdentitas(r.identitas, { simpan: false });
      void segarkanUsaha().catch(() => undefined);
      hapusSalinan();
      await muatMeta();
      beritahu('Identitas aplikasi dikembalikan ke bawaan.', 'info');
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    } finally {
      setSibuk(false);
    }
  };

  /** Terapkan satu varian logo hasil unggah/hapus tanpa menyentuh teks lain. */
  const terapkanLogo = (varian: Varian, url: string, versi: string) => {
    const patch =
      varian === 'siang' ? { logoSiang: url } : varian === 'malam' ? { logoMalam: url } : { ikon: url };
    setId((p) => ({ ...p, ...patch, versi }));
    setTersimpan((p) => (p ? { ...p, ...patch, versi } : p));
    setIdentitas({ ...bacaIdentitas(), ...patch, versi });
    // Logo usaha mengikuti identitas saat opsi faktur aktif.
    void segarkanUsaha().catch(() => undefined);
  };

  const unggah = async (varian: Varian, dataUrl: string) => {
    const r = await apiPost<{ url: string; versi: string }>('/api/tampilan/identitas/logo', {
      varian,
      data_base64: dataUrl,
      toko: perToko ? toko : null,
    });
    terapkanLogo(varian, r.url, r.versi);
    beritahu(`Logo ${VARIAN_LABEL[varian].toLowerCase()} diperbarui.`, 'sukses');
  };

  const pilihBerkas = async (varian: Varian, file: File | undefined) => {
    if (!file) return;
    if (file.size > MAKS_BYTES) {
      beritahu('Ukuran logo melebihi batas 2 MB.', 'galat');
      return;
    }
    try {
      const dataUrl = await keDataUrl(file);
      await unggah(varian, dataUrl);
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    }
  };

  const hapusLogo = async (varian: Varian) => {
    try {
      const r = await apiPost<{ versi: string }>('/api/tampilan/identitas/logo/hapus', {
        varian,
        toko: perToko ? toko : null,
      });
      terapkanLogo(varian, '', r.versi);
      beritahu('Kembali ke logo bawaan.', 'info');
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    }
  };

  if (!admin) {
    return (
      <section className="kartu">
        <div className="kartu__kepala kartu__kepala--kompak">
          <h3>Identitas Aplikasi</h3>
        </div>
        <p className="teks-redup">
          Halaman ini hanya tersedia untuk Admin/Owner. Peran ini hanya dapat melihat nama dan logo
          aplikasi di sidebar.
        </p>
      </section>
    );
  }

  const logoKop = id.pakaiFaktur ? '' : meta?.logoUsaha || '';
  const namaKop = id.pakaiFaktur ? id.nama : meta?.namaUsaha || 'Nama Usaha';

  return (
    <section className="kartu identitas-halaman">
      <div className="kartu__kepala kartu__kepala--kompak">
        <div>
          <h3>Identitas Aplikasi</h3>
          <p className="teks-redup teks-kecil">
            Satu sumber data untuk sidebar, Log In, Pilih Toko, judul tab, favicon, layar muat, serta
            kop faktur & struk — perubahan langsung tampil tanpa muat ulang dan di-cache dengan
            nomor versi supaya logo lama tidak muncul.
          </p>
        </div>
        <span className="aksi-baris">
          <IconButton
            ikon="rotate-ccw"
            label="Kembalikan bawaan"
            ukuran="toolbar"
            arah="bawah"
            disabled={sibuk}
            onClick={() => void keBawaan()}
          />
          <IconButton
            ikon="save"
            label="Simpan identitas"
            ukuran="toolbar"
            warna="primer"
            arah="bawah"
            disabled={sibuk || !kotor || !id.nama.trim()}
            onClick={() => void simpanTeks()}
          />
        </span>
      </div>

      {/* Y2.2 — hubungan dengan pengaturan lain (teks bantuan). */}
      <div className="identitas-bantuan">
        <b>Perbedaan dengan pengaturan lain</b>
        <ul>
          <li>
            <strong>Identitas Aplikasi</strong> (halaman ini) = tampilan aplikasi: sidebar, halaman
            Log In, layar Pilih Toko, judul tab, favicon, dan layar muat.
          </li>
          <li>
            <strong>Profil Usaha</strong> = data usaha untuk dokumen: nama usaha, alamat, telepon,
            NPWP, dan logo faktur.
          </li>
          <li>
            <strong>Data Toko & Gudang</strong> = data per toko dan gudang (alamat, telepon,
            gudang bawaan, pengaturan bertanda “Per toko”).
          </li>
        </ul>

        <label className="bidang bidang--centang identitas-opsi">
          <input
            type="checkbox"
            checked={id.pakaiFaktur}
            onChange={(e) => setId({ ...id, pakaiFaktur: e.target.checked })}
          />
          <span>
            Pakai logo dan nama ini juga untuk faktur dan struk
            <em className="teks-redup">
              {id.pakaiFaktur
                ? 'Aktif — nama_usaha & logo_usaha di Profil Usaha mengikuti identitas ini.'
                : `Profil Usaha tetap terpisah (kini: ${namaKop || 'belum diisi'}).`}
            </em>
          </span>
        </label>

        {meta?.multiToko && (
          <fieldset className="identitas-cakupan">
            <legend>Cakupan identitas</legend>
            <label className="identitas-pilihan">
              <input
                type="radio"
                name="cakupan-identitas"
                checked={id.cakupan === 'semua'}
                onChange={() => setId({ ...id, cakupan: 'semua' })}
              />
              <span>Berlaku untuk semua toko</span>
            </label>
            <label className="identitas-pilihan">
              <input
                type="radio"
                name="cakupan-identitas"
                checked={id.cakupan === 'per-toko'}
                onChange={() => setId({ ...id, cakupan: 'per-toko' })}
              />
              <span>
                Berbeda per toko
                {toko ? ` (sedang mengatur ${toko})` : ' — pilih toko aktif dulu'}
              </span>
            </label>
          </fieldset>
        )}
      </div>

      <div className="identitas-grid">
        <div className="identitas-form">
          <BidangTeks
            label="Nama aplikasi"
            nilai={id.nama}
            maks={MAKS.nama}
            wajib
            onChange={(v) => setId({ ...id, nama: v })}
          />
          <BidangTeks
            label="Tagline (satu baris — boleh dikosongkan)"
            nilai={id.tagline}
            maks={MAKS.tagline}
            onChange={(v) => setId({ ...id, tagline: v })}
          />
          <BidangTeks
            label="Judul tab browser"
            nilai={id.judulTab}
            maks={MAKS.judul}
            placeholder={id.nama || 'Ikuti nama aplikasi'}
            ket="Kosongkan untuk memakai nama aplikasi."
            onChange={(v) => setId({ ...id, judulTab: v })}
          />

          <label className="bidang">
            <span>Favicon</span>
            <select value={id.favicon} onChange={(e) => setId({ ...id, favicon: e.target.value })}>
              <option value="">Ikon kecil (bawaan)</option>
              <option value="/favicon.svg">Ikon bawaan aplikasi</option>
            </select>
            <span className="bidang-ket">
              Ikon kecil dipakai juga untuk sidebar ciut dan layar muat.
            </span>
          </label>

          <div className="bidang">
            <span>Warna Latar Belakang Kartu (Card Background)</span>
            <div className="identitas-aksen" role="radiogroup" aria-label="Warna latar belakang kartu">
              {PRESET_KARTU.map((p) => (
                <button
                  key={p.nilai || 'bawaan'}
                  type="button"
                  role="radio"
                  aria-checked={id.kartu === p.nilai}
                  aria-label={p.label}
                  title={p.nilai ? `${p.label} (${p.nilai})` : `${p.label} (#ffffff)`}
                  className={`identitas-aksen__kotak ${id.kartu === p.nilai ? 'aktif' : ''}`}
                  style={{ background: p.nilai || '#ffffff' }}
                  onClick={() => {
                    setId({ ...id, kartu: p.nilai });
                    terapkanWarnaKartu(p.nilai);
                  }}
                />
              ))}
              <label className="identitas-kartu-kustom" title="Warna kustom (hex)">
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(id.kartu) ? id.kartu : '#ffffff'}
                  aria-label="Pilih warna kartu kustom"
                  onChange={(e) => {
                    setId({ ...id, kartu: e.target.value });
                    terapkanWarnaKartu(e.target.value);
                  }}
                />
                <span>{id.kartu || '#ffffff'}</span>
              </label>
            </div>
            <span className="bidang-ket">
              Berlaku untuk seluruh kartu (dashboard, daftar, stok, penjualan, pembelian,
              pengaturan) — tersimpan ke database & langsung tampil tanpa muat ulang.
            </span>
          </div>

          <div className="bidang">
            <span>Warna aksen aplikasi</span>
            <div className="identitas-aksen" role="radiogroup" aria-label="Warna aksen aplikasi">
              {URUTAN_AKSEN.map((k) => (
                <button
                  key={k || 'bawaan'}
                  type="button"
                  role="radio"
                  aria-checked={id.aksen === k}
                  aria-label={`${LABEL_AKSEN[k]}${k === 'teal' ? ' (Baru)' : ''}`}
                  title={`${LABEL_AKSEN[k]}${k === 'teal' ? ' (Baru) #147a75' : ''}`}
                  data-baru={k === 'teal' ? 'true' : undefined}
                  className={`identitas-aksen__kotak ${id.aksen === k ? 'aktif' : ''}`}
                  style={{
                    background:
                      PALET_AKSEN[k]?.utama ?? PALET_AKSEN[''].utama,
                  }}
                  onClick={() => setId({ ...id, aksen: k })}
                />
              ))}
            </div>
            <span className="bidang-ket">Berlaku untuk tombol, tautan, dan sorotan di seluruh aplikasi.</span>
          </div>

          <label className="bidang">
            <span>Warna latar ikon (untuk logo transparan)</span>
            <select value={id.latar} onChange={(e) => setId({ ...id, latar: e.target.value })}>
              <option value="">Otomatis (ikuti tema)</option>
              <option value="surface">Permukaan</option>
              <option value="surface-2">Permukaan redup</option>
              <option value="primer-lembut">Aksen lembut</option>
              <option value="panel">Panel</option>
            </select>
          </label>

          {kotor && (
            <p className="peringatan-kotor" role="status">
              Ada perubahan yang belum disimpan
            </p>
          )}
        </div>

        <PratinjauIdentitas id={id} namaKop={namaKop} logoKop={logoKop} ukuranLogo={ukuranLogo} />
      </div>

      <div className="identitas-logo-baris">
        {(['siang', 'malam', 'ikon'] as Varian[]).map((v) => {
          const nilai = v === 'siang' ? id.logoSiang : v === 'malam' ? id.logoMalam : id.ikon;
          return (
            <div className="identitas-logo" key={v}>
              <b>{VARIAN_LABEL[v]}</b>
              <div className={`identitas-logo__kotak ${v === 'ikon' ? 'identitas-logo__kotak--ikon' : ''}`}>
                {nilai ? <img src={nilai} alt="" /> : <span className="teks-redup teks-kecil">Bawaan</span>}
              </div>
              <div className="tombol-baris">
                <IconButton
                  ikon="image-up"
                  label="Ganti logo"
                  ukuran="baris"
                  onClick={() => {
                    varianRef.current = v;
                    fileRef.current?.click();
                  }}
                />
                <IconButton
                  ikon="pencil"
                  label="Edit (potong)"
                  ukuran="baris"
                  disabled={!nilai}
                  onClick={() => nilai && setCrop({ varian: v, dataUrl: nilai.split('?')[0] })}
                />
                <IconButton
                  ikon="trash"
                  label="Hapus (logo bawaan)"
                  ukuran="baris"
                  warna="bahaya"
                  disabled={!nilai}
                  onClick={() => void hapusLogo(v)}
                />
              </div>
            </div>
          );
        })}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          hidden
          onChange={(e) => {
            void pilihBerkas(varianRef.current, e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      <p className="teks-redup teks-kecil">
        Unggah menerima PNG, JPG, WebP, atau SVG maksimal 2 MB per berkas. Logo bertema Siang dan
        Malam bersifat opsional — bila kosong, aplikasi memakai varian lain yang tersedia.
      </p>

      <UkuranLogoMuat
        nilai={ukuranLogo}
        teks={ukuranTeks}
        id={id}
        onUbah={(v) => {
          setUkuranTeks(String(v));
          ubahUkuranLogo(v);
        }}
        onTeks={setUkuranTeks}
      />

      {crop && (
        <EditorLogo
          dataUrl={crop.dataUrl}
          onTutup={() => setCrop(null)}
          onSimpan={async (dataUrl) => {
            await unggah(crop.varian, dataUrl);
            setCrop(null);
          }}
        />
      )}
    </section>
  );
}

/* ------------------------------ BIDANG TEKS ----------------------------- */

function BidangTeks({
  label,
  nilai,
  maks,
  onChange,
  ket,
  placeholder,
  wajib,
}: {
  label: string;
  nilai: string;
  maks: number;
  onChange: (v: string) => void;
  ket?: string;
  placeholder?: string;
  wajib?: boolean;
}) {
  const penuh = nilai.length >= maks;
  return (
    <label className="bidang">
      <span className="identitas-label-baris">
        <span>
          {label}
          {wajib && <i className="wajib"> *</i>}
        </span>
        {/* Y2.1 — penghitung karakter */}
        <i className={`identitas-hitung ${penuh ? 'identitas-hitung--penuh' : ''}`}>
          {nilai.length}/{maks}
        </i>
      </span>
      <input
        type="text"
        value={nilai}
        maxLength={maks}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {ket && <span className="bidang-ket">{ket}</span>}
    </label>
  );
}

/* ---------------------- UKURAN LOGO LAYAR MUAT --------------------------- */

/**
 * Kontrol ukuran logo Loading Screen (px): slider + input angka, minimum 40,
 * TANPA batas atas. Nilai disimpan ke localStorage (`loading_logo_size`) dan
 * berlaku di layar muat asli pada pembukaan aplikasi berikutnya.
 */
function UkuranLogoMuat({
  nilai,
  teks,
  id,
  onUbah,
  onTeks,
}: {
  nilai: number;
  teks: string;
  id: Identitas;
  onUbah: (v: number) => void;
  onTeks: (v: string) => void;
}) {
  // Slider selalu punya jangkauan yang cukup lebar tetapi tetap bisa digeser
  // hingga nilai besar yang diketik (tanpa membatasi angka di input).
  const maksSlider = Math.max(400, Math.ceil(nilai / 100) * 100 + 100);
  const nilaiSlider = Math.min(nilai, maksSlider);
  const gaya = gayaLayarMuat(nilai);
  const logo = logoUntukTemaTertentu(id, 'siang');
  const inisial = id.nama.trim().charAt(0).toUpperCase() || 'N';

  const ketik = (mentah: string) => {
    onTeks(mentah);
    const n = Math.round(Number(mentah));
    if (Number.isFinite(n) && n >= UKURAN_LOGO_MUAT_MIN) onUbah(n);
  };

  return (
    <div className="layar-muat-ukuran">
      <div className="layar-muat-ukuran__kendali">
        <label className="bidang" htmlFor="lm-ukuran-slider">
          <span>Ukuran Logo Loading (px)</span>
          <input
            id="lm-ukuran-slider"
            type="range"
            min={UKURAN_LOGO_MUAT_MIN}
            max={maksSlider}
            step={1}
            value={nilaiSlider}
            onChange={(e) => onUbah(Number(e.target.value))}
            aria-label="Geser ukuran logo loading"
          />
        </label>
        <label className="bidang layar-muat-ukuran__angka" htmlFor="lm-ukuran-angka">
          <span>Nilai</span>
          <input
            id="lm-ukuran-angka"
            type="number"
            inputMode="numeric"
            min={UKURAN_LOGO_MUAT_MIN}
            value={teks}
            onChange={(e) => ketik(e.target.value)}
            onBlur={() => {
              const n = normalUkuranLogoMuat(teks);
              onTeks(String(n));
              onUbah(n);
            }}
          />
        </label>
      </div>
      <p className="teks-redup teks-kecil">
        Minimum {UKURAN_LOGO_MUAT_MIN} px · bawaan {UKURAN_LOGO_MUAT_BAWAAN} px · tanpa batas atas.
        Nama aplikasi, progress bar, dan sudut logo menyesuaikan otomatis. Disimpan di perangkat ini
        dan berlaku saat aplikasi dibuka berikutnya.
      </p>
      <div className="layar-muat-ukuran__pratinjau" aria-hidden="true">
        <div
          className="layar-muat-ukuran__logo"
          style={{ ...gaya.logo, fontSize: `${Math.max(14, nilai * 0.47)}px` }}
        >
          {logo ? <img src={logo} alt="" /> : inisial}
        </div>
        <div className="layar-muat-ukuran__nama" style={gaya.judul}>
          {id.nama || 'Nama Aplikasi'}
        </div>
        <div className="layar-muat-ukuran__bilah" style={gaya.bilah} />
      </div>
    </div>
  );
}

/* ------------------------------ PRATINJAU -------------------------------- */

function PratinjauIdentitas({
  id,
  namaKop,
  logoKop,
  ukuranLogo,
}: {
  id: Identitas;
  namaKop: string;
  logoKop: string;
  ukuranLogo: number;
}) {
  return (
    <div className="identitas-pratinjau">
      <div className="identitas-pratinjau__kepala">
        <b>Pratinjau langsung</b>
        {/* AI5 — lihat layar muat dengan data yang sedang diisi. */}
        <IconButton
          ikon="play"
          label="Putar layar muat"
          ukuran="baris"
          arah="bawah"
          onClick={() => {
            const tema = temaSekarang();
            putarLayarMuat({
              nama: id.nama,
              tagline: id.tagline,
              logo: logoUntukTemaTertentu(id, tema),
              aksen: id.aksen,
              tema,
              logoSize: ukuranLogo,
            });
          }}
        />
      </div>
      <p className="teks-redup teks-kecil">
        Sidebar terbuka & ciut, halaman Log In, tab browser, kop faktur, dan layar muat — tema
        Siang & Malam.
      </p>
      <p className="teks-redup teks-kecil">
        Layar muat memakai nama dan logo ini — tidak terpengaruh opsi faktur & struk.
        Perubahan berlaku pada pembukaan aplikasi berikutnya dan langsung pada perangkat ini.
      </p>
      <div className="identitas-tema">
        <PratinjauTema id={id} tema="siang" namaKop={namaKop} logoKop={logoKop} />
        <PratinjauTema id={id} tema="malam" namaKop={namaKop} logoKop={logoKop} />
      </div>
    </div>
  );
}

function PratinjauTema({
  id,
  tema,
  namaKop,
  logoKop,
}: {
  id: Identitas;
  tema: 'siang' | 'malam';
  namaKop: string;
  logoKop: string;
}) {
  const logo = logoUntukTemaTertentu(id, tema);
  // faviconEfektif — jangan pakai /favicon.ico (tidak ada → 404 di konsol).
  const favicon = faviconEfektif(id);
  const gaya = {
    '--ip-aksen': gradasiAksen(id.aksen, tema)[0],
    '--ip-latar-logo': LATAR[id.latar]?.[tema] ?? LATAR[''][tema],
  } as CSSProperties;
  const inisial = id.nama.trim().charAt(0).toUpperCase() || 'N';

  // Isi kotak logo: gambar bila ada, inisial nama bila belum ada logo.
  const isiLogo = (sumber: string) =>
    sumber ? <img src={sumber} alt="" /> : <span className="ip-logo__teks">{inisial}</span>;

  return (
    <div className="ip" data-tema={tema} style={gaya}>
      <span className="ip-tema">{tema === 'siang' ? 'Tema Siang' : 'Tema Malam'}</span>

      <div className="ip-blok">
        <b>Sidebar terbuka</b>
        <div className="ip-sb">
          <div className="ip-sb__brand">
            <span className="ip-logo">{isiLogo(logo)}</span>
            <span className="ip-sb__teks">
              <strong>{id.nama}</strong>
              {id.tagline !== '' && <small title={id.tagline}>{id.tagline}</small>}
            </span>
            <span className="ip-sb__aksi" title="Ubah identitas aplikasi">
              <Icon nama="pencil" size={11} />
            </span>
            <span className="ip-sb__aksi">
              <Icon nama="chevron-left" size={11} />
            </span>
          </div>
          <ul className="ip-sb__nav">
            <li className="aktif">Dashboard</li>
            <li>Master Data</li>
            <li>Penjualan</li>
          </ul>
        </div>
      </div>

      <div className="ip-blok">
        <b>Sidebar ciut</b>
        <div className="ip-sb-ciut">
          <span className="ip-logo">{isiLogo(logo)}</span>
          <span className="ip-sb-ciut__titik" />
          <span className="ip-sb-ciut__titik" />
        </div>
      </div>

      <div className="ip-blok">
        <b>Halaman Log In</b>
        <div className="ip-login">
          <span className="ip-logo">{isiLogo(logo)}</span>
          <strong>{id.nama}</strong>
          {id.tagline !== '' && <small>{id.tagline}</small>}
          <span className="ip-kolom-palsu" />
          <span className="ip-kolom-palsu" />
          <span className="ip-tombol">Masuk</span>
        </div>
      </div>

      {/* AI3/AI5 — kartu layar muat pada pratinjau langsung. */}
      <div className="ip-blok">
        <b>Layar muat</b>
        <div className="ip-muat">
          <span className={`ip-logo ip-logo--muat ${logo ? '' : 'ip-logo--muat-inisial'}`}>
            {isiLogo(logo)}
          </span>
          <strong title={id.nama}>{id.nama.trim() || 'Aplikasi'}</strong>
          {id.tagline.trim() !== '' && <small title={id.tagline}>{id.tagline}</small>}
          <span className="ip-muat__bilah" aria-hidden="true" />
        </div>
      </div>

      <div className="ip-blok">
        <b>Tab browser</b>
        <div className="ip-tab">
          <span className="ip-tab__fav">
            <img src={favicon} alt="" />
          </span>
          <span className="ip-tab__judul">{judulTab(id)}</span>
          <span className="ip-tab__tutup">×</span>
        </div>
      </div>

      <div className="ip-blok">
        <b>Kop faktur</b>
        <div className="ip-kop">
          {logoKop ? <img className="ip-kop__logo" src={logoKop} alt="" /> : <span className="ip-kop__kosong" />}
          <div className="ip-kop__teks">
            <strong>{namaKop}</strong>
            <small>
              {id.pakaiFaktur
                ? id.tagline || 'Jl. Contoh No. 1 · 021-555-0000'
                : 'Alamat · telepon · NPWP dari Profil Usaha'}
            </small>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- EDITOR LOGO ------------------------------ */

/**
 * Editor potong logo (Y2.1): bentuk persegi / bulat / sudut membulat, dengan
 * zoom dan geser. Hasil disimpan sebagai PNG 512×512 (transparansi di luar
 * bentuk dipertahankan).
 */
function EditorLogo({
  dataUrl,
  onTutup,
  onSimpan,
}: {
  dataUrl: string;
  onTutup: () => void;
  onSimpan: (dataUrl: string) => void;
}) {
  const [skala, setSkala] = useState(1);
  const [geser, setGeser] = useState({ x: 0, y: 0 });
  const [bentuk, setBentuk] = useState<'persegi' | 'bulat' | 'sudut'>('persegi');
  const [sibuk, setSibuk] = useState(false);
  const gambar = useRef<HTMLImageElement>(null);
  const seret = useRef<{ x: number; y: number; gx: number; gy: number } | null>(null);

  useEffect(() => {
    const img = new Image();
    img.src = dataUrl;
  }, [dataUrl]);

  const mulaiSeret = (e: React.PointerEvent) => {
    seret.current = { x: e.clientX, y: e.clientY, gx: geser.x, gy: geser.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const seretGeser = (e: React.PointerEvent) => {
    const s = seret.current;
    if (!s) return;
    setGeser({ x: s.gx + (e.clientX - s.x), y: s.gy + (e.clientY - s.y) });
  };
  const akhiriSeret = () => {
    seret.current = null;
  };

  const potong = () => {
    const img = gambar.current;
    if (!img) return;
    setSibuk(true);
    try {
      const BOX = 240; // kotak pratinjau (px CSS)
      const S = 512 / BOX; // skala kotak → kanvas
      const natW = img.naturalWidth || 512;
      const natH = img.naturalHeight || 512;
      const dasar = Math.min(1, BOX / natW, BOX / natH);
      const lebar = natW * dasar * skala * S;
      const tinggi = natH * dasar * skala * S;
      const cx = (BOX / 2 + geser.x) * S;
      const cy = (BOX / 2 + geser.y) * S;

      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas tidak tersedia.');

      ctx.save();
      ctx.beginPath();
      if (bentuk === 'bulat') {
        ctx.arc(256, 256, 256, 0, Math.PI * 2);
      } else if (bentuk === 'sudut') {
        sudutBulat(ctx, 0, 0, 512, 512, 128);
      } else {
        ctx.rect(0, 0, 512, 512);
      }
      ctx.clip();
      ctx.drawImage(img, cx - lebar / 2, cy - tinggi / 2, lebar, tinggi);
      ctx.restore();

      onSimpan(canvas.toDataURL('image/png'));
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    } finally {
      setSibuk(false);
    }
  };

  return (
    <Modal
      judul="Edit logo — potong, zoom, geser"
      lebar="kecil"
      onTutup={onTutup}
      aksi={
        <>
          <button type="button" className="tombol tombol--netral" onClick={onTutup}>
            Batal
          </button>
          <button type="button" className="tombol tombol--primer" disabled={sibuk} onClick={potong}>
            Potong & simpan
          </button>
        </>
      }
    >
      <div
        className={`identitas-crop identitas-crop--${bentuk}`}
        onPointerDown={mulaiSeret}
        onPointerMove={seretGeser}
        onPointerUp={akhiriSeret}
        onPointerCancel={akhiriSeret}
      >
        <img
          ref={gambar}
          src={dataUrl}
          alt="Logo"
          draggable={false}
          style={{ transform: `translate(${geser.x}px, ${geser.y}px) scale(${skala})` }}
        />
      </div>
      <label className="bidang">
        <span>Bentuk potongan</span>
        <select value={bentuk} onChange={(e) => setBentuk(e.target.value as typeof bentuk)}>
          <option value="persegi">Persegi</option>
          <option value="bulat">Bulat</option>
          <option value="sudut">Sudut membulat</option>
        </select>
      </label>
      <label className="bidang">
        <span>Zoom</span>
        <input
          type="range"
          min={0.4}
          max={3}
          step={0.05}
          value={skala}
          onChange={(e) => setSkala(Number(e.target.value))}
        />
      </label>
      <p className="teks-redup teks-kecil">
        Seret gambar untuk menggeser; hasil potong selalu 512 × 512 px.
      </p>
    </Modal>
  );
}

/** Persegi berujung bulat — path manual agar kompatibel semua browser. */
function sudutBulat(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

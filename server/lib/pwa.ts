// PWA dinamis — nama, logo, manifest, dan ikon mengikuti data toko aktif.
//
// Sumber utama:
//   1. `stores.nama` & `stores.logo` (Pengaturan ▸ Data Toko & Gudang),
//   2. identitas aplikasi (`app_nama`, `app_logo_*`) sebagai cadangan,
//   3. inisial huruf pertama nama toko bila belum ada logo.
//
// Ikon dibuat dengan sharp: logo di-resize contain + padding (±12% tiap sisi)
// agar tidak terpotong bingkai bulat/kotak Android maupun iOS.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { get, run, ROOT_DIR } from '../db.pg.ts';

const PWA_DIR = path.join(ROOT_DIR, 'data', 'uploads', 'identitas', 'pwa');
const UKURAN: Record<string, number> = {
  'icon-192.png': 192,
  'icon-512.png': 512,
  'apple-touch-icon.png': 180,
};

/** Warna aksen bawaan → heks (sama dengan palet index.html). */
const AKSEN: Record<string, string> = {
  '': '#267454',
  teal: '#147a75',
  biru: '#3f6f9e',
  indigo: '#5b5aa6',
  hijau: '#3f8a4e',
  oranye: '#b76a23',
};

type Baris = { nilai: string | null } | undefined;

async function bacaNilai(kunci: string): Promise<string> {
  const r = (await get<Baris>('SELECT nilai FROM settings WHERE kunci = ?', kunci)) as Baris;
  return String(r?.nilai ?? '').trim();
}

/** Nilai identitas dengan cakupan per toko (baris `@toko` menang). */
async function bacaNilaiToko(kunci: string, toko: string | null): Promise<string> {
  if (toko) {
    const r = (await get<Baris>('SELECT nilai FROM settings WHERE kunci = ?', `${kunci}@${toko}`)) as Baris;
    if (r && r.nilai !== null) return String(r.nilai).trim();
  }
  return bacaNilai(kunci);
}

/** Kode toko efektif: query → toko bawaan → toko aktif pertama. */
async function kodeToko(toko: string | null): Promise<string | null> {
  if (toko) return toko;
  const bawaan = await bacaNilai('toko_bawaan');
  if (bawaan) return bawaan;
  const r = (await get<{ kode: string }>(
    'SELECT kode FROM stores WHERE aktif = TRUE ORDER BY nama LIMIT 1',
  )) as { kode: string } | undefined;
  return r?.kode?.trim() || null;
}

async function bacaToko(toko: string | null): Promise<{ nama: string; logo: string } | null> {
  const kode = await kodeToko(toko);
  if (!kode) return null;
  const r = (await get<{ nama: string; logo: string | null }>(
    'SELECT nama, logo FROM stores WHERE kode = ? AND aktif = TRUE LIMIT 1',
    kode,
  )) as { nama: string; logo: string | null } | undefined;
  if (!r) return null;
  return { nama: String(r.nama ?? '').trim(), logo: String(r.logo ?? '').trim() };
}

/**
 * Nama untuk manifest/judul tab. Prioritas: nama toko aktif, lalu identitas
 * aplikasi, lalu nama usaha, lalu toko aktif pertama, terakhir "Toko".
 */
export async function namaPwa(toko: string | null = null): Promise<string> {
  const t = await bacaToko(toko);
  if (t?.nama) return t.nama;
  const kandidat = [
    await bacaNilaiToko('app_nama', toko),
    await bacaNilai('store_name'),
    await bacaNilai('nama_usaha'),
  ];
  for (const k of kandidat) if (k) return k;
  return 'Toko';
}

/** Nama cadangan untuk identitas aplikasi (tanpa memakai `app_nama`). */
export async function namaCadangan(): Promise<string> {
  const t = await bacaToko(null);
  if (t?.nama) return t.nama;
  const kandidat = [await bacaNilai('store_name'), await bacaNilai('nama_usaha')];
  for (const k of kandidat) if (k) return k;
  return 'Toko';
}

/** Logo toko aktif; bila kosong, pakai logo identitas aplikasi. */
export async function logoPwa(toko: string | null = null): Promise<string> {
  const t = await bacaToko(toko);
  if (t?.logo) return t.logo;
  const kandidat = [
    await bacaNilaiToko('app_logo_ikon', toko),
    await bacaNilaiToko('app_logo_siang', toko),
    await bacaNilaiToko('app_logo_malam', toko),
    await bacaNilai('store_logo_url'),
    await bacaNilai('logo_usaha'),
  ];
  for (const k of kandidat) if (k) return k;
  return '';
}

/** Versi identitas untuk cache-busting URL ikon/manifest. */
export async function versiPwa(): Promise<string> {
  return (await bacaNilai('app_identitas_versi')) || '1';
}

/** Naikkan versi agar browser memuat ikon baru setelah nama/logo toko berubah. */
export async function naikkanVersiPwa(): Promise<string> {
  const v = Number((await bacaNilai('app_identitas_versi')) || '0') + 1;
  await run(
    `INSERT INTO settings (kunci, nilai, diubah_pada) VALUES (?, ?, now())
     ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai, diubah_pada = excluded.diubah_pada`,
    'app_identitas_versi',
    String(v),
  );
  return String(v);
}

async function warnaAksen(toko: string | null): Promise<string> {
  const a = (await bacaNilaiToko('app_aksen', toko)) || (await bacaNilai('app_aksen'));
  return AKSEN[a] || AKSEN[''];
}

function bacaLokal(url: string): Buffer | null {
  const bersih = url.split('?')[0].split('#')[0];
  if (!bersih.startsWith('/uploads/')) return null;
  const akar = path.join(ROOT_DIR, 'data', 'uploads');
  const tujuan = path.resolve(akar, bersih.slice('/uploads/'.length));
  if (tujuan !== akar && !tujuan.startsWith(akar + path.sep)) return null;
  try {
    return fs.readFileSync(tujuan);
  } catch {
    return null;
  }
}

async function bacaGambar(url: string): Promise<Buffer | null> {
  if (!url) return null;
  if (url.startsWith('data:image/')) {
    const m = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/i.exec(url);
    if (!m) return null;
    try {
      return Buffer.from(m[1], 'base64');
    } catch {
      return null;
    }
  }
  const lokal = bacaLokal(url);
  if (lokal) return lokal;
  if (/^https?:\/\//i.test(url)) {
    const kendali = new AbortController();
    const batas = setTimeout(() => kendali.abort(), 4000);
    try {
      const r = await fetch(url, { signal: kendali.signal });
      if (!r.ok) return null;
      return Buffer.from(await r.arrayBuffer());
    } catch {
      return null;
    } finally {
      clearTimeout(batas);
    }
  }
  return null;
}

function escXml(teks: string): string {
  return String(teks).replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

/** Ikon inisial: huruf pertama nama toko di atas latar aksen. */
function svgInisial(nama: string, warna: string): Buffer {
  const huruf = Array.from(nama.trim())[0]?.toUpperCase() || 'T';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${warna}"/>
  <text x="256" y="334" text-anchor="middle" font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" font-size="238" font-weight="700" fill="#ffffff">${escXml(huruf)}</text>
</svg>`;
  return Buffer.from(svg);
}

async function buatIkon(namaFile: string, toko: string | null): Promise<Buffer> {
  const ukuran = UKURAN[namaFile];
  if (!ukuran) throw new Error(`Ikon PWA tidak dikenal: ${namaFile}`);

  const [nama, logo, warna] = await Promise.all([namaPwa(toko), logoPwa(toko), warnaAksen(toko)]);
  const gambar = logo ? await bacaGambar(logo) : null;

  if (!gambar) {
    return sharp(svgInisial(nama, warna)).resize(ukuran, ukuran).png().toBuffer();
  }

  const pad = Math.max(1, Math.round(ukuran * 0.12));
  const isi = Math.max(1, ukuran - pad * 2);
  try {
    const konten = await sharp(gambar)
      .resize(isi, isi, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toBuffer();

    return await sharp({
      create: {
        width: ukuran,
        height: ukuran,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .composite([{ input: konten, left: pad, top: pad }])
      .png()
      .toBuffer();
  } catch {
    // Logo rusak / format tak didukung — tetap tampilkan inisial nama toko.
    return sharp(svgInisial(nama, warna)).resize(ukuran, ukuran).png().toBuffer();
  }
}

const cache = new Map<string, Buffer>();

/** Ambil PNG ikon PWA (dibuat ulang bila logo/nama/versi berubah). */
export async function ikonPng(namaFile: string, toko: string | null = null): Promise<Buffer> {
  if (!(namaFile in UKURAN)) throw new Error('Ikon tidak ditemukan.');
  const [versi, logo, nama] = await Promise.all([versiPwa(), logoPwa(toko), namaPwa(toko)]);
  const kunci = `${namaFile}|${toko ?? ''}|${versi}|${logo}|${nama}`;
  const tersimpan = cache.get(kunci);
  if (tersimpan) return tersimpan;

  const buf = await buatIkon(namaFile, toko);
  if (cache.size > 24) cache.clear();
  cache.set(kunci, buf);
  return buf;
}

/**
 * Simpan variasi ikon ke disk saat logo/nama disimpan. Hanya untuk cakupan
 * global; versi per toko dibuat saat endpoint diminta.
 */
export async function segarkanIkonPwa(toko: string | null = null): Promise<void> {
  if (toko) return;
  try {
    fs.mkdirSync(PWA_DIR, { recursive: true });
    for (const namaFile of Object.keys(UKURAN)) {
      const buf = await ikonPng(namaFile, null);
      fs.writeFileSync(path.join(PWA_DIR, namaFile), buf);
    }
  } catch (e) {
    // Jangan gagalkan simpan logo/toko hanya karena ikon PWA gagal dibuat;
    // endpoint ikon tetap membuatnya saat diminta.
    console.warn('[pwa] gagal menyegarkan ikon:', e instanceof Error ? e.message : e);
  }
}

/** Objek Web App Manifest dinamis. */
export async function manifestPwa(toko: string | null = null) {
  const [nama, versi] = await Promise.all([namaPwa(toko), versiPwa()]);
  const q = new URLSearchParams();
  if (toko) q.set('toko', toko);
  q.set('v', versi);
  const qs = `?${q.toString()}`;

  return {
    name: nama,
    short_name: nama,
    description: `Aplikasi ${nama}`,
    lang: 'id',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'any',
    background_color: '#0f172a',
    theme_color: '#0d9488',
    categories: ['business', 'productivity', 'finance'],
    icons: [
      {
        src: `/api/store-logo/icon-192.png${qs}`,
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any maskable',
      },
      {
        src: `/api/store-logo/icon-512.png${qs}`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable',
      },
      {
        src: `/api/store-logo/apple-touch-icon.png${qs}`,
        sizes: '180x180',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}

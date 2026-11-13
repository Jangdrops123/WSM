// Gambar dokumen untuk kirim WhatsApp — model struk/faktur → PNG (canvas 2D)
// → bagikan lewat Web Share API (gambar terpasang di WhatsApp) atau diunduh
// agar dilampirkan manual. wa.me hanya bisa teks, sehingga gambar adalah
// satu-satunya cara "mengirim struk/faktur" asli.
// Sengaja memakai canvas 2D manual (tanpa pustaka) agar andal di semua browser.

import { apiGet } from './api';
import {
  blokStruk,
  PROFIL_STRUK_BAWAAN,
  ukuranStruk,
  type ProfilStruk,
  type StrukData,
} from '../pages/pos/struk';
import type { FakturDTO, IsiFaktur } from '../pages/faktur/tipe';

/* ------------------------------- Model ---------------------------------- */

export type BarisDok =
  | { kind: 'teks'; teks: string; rata?: 'kiri' | 'tengah' | 'kanan'; tebal?: boolean; ukuran?: number }
  | { kind: 'pasangan'; kiri: string; kanan: string; tebal?: boolean; ukuran?: number }
  | { kind: 'garis' };

export interface ModelDok {
  baris: BarisDok[];
}

/** Dokumen siap raster: model + lebar CSS + nama berkas. */
export interface GambarDok {
  model: ModelDok;
  /** Lebar render CSS (px). Struk ≈ 300px (80mm), kartu faktur 520px. */
  lebarPx: number;
  namaBerkas: string;
}

const rupiah = (n: unknown): string => `Rp ${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;

const tanggalPanjang = (iso: unknown): string => {
  const t = new Date(String(iso ?? ''));
  return Number.isNaN(t.getTime())
    ? String(iso ?? '')
    : t.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
};

/* --------------------------- Model: struk POS ---------------------------- */

const namaAman = (s: unknown, awalan: string): string =>
  `${awalan}-${String(s ?? 'dok').replace(/[^0-9A-Za-z-]+/g, '_')}.png`;

/** Model gambar struk — mengikuti blok profil yang sama dengan cetak. */
export function modelStruk(d: StrukData, p: ProfilStruk | null): ModelDok {
  const baris: BarisDok[] = [];
  if (blokStruk(p, 'nama_toko', true)) baris.push({ kind: 'teks', teks: d.namaUsaha, rata: 'tengah', tebal: true, ukuran: 19 });
  if (blokStruk(p, 'alamat', true) && d.alamatUsaha) baris.push({ kind: 'teks', teks: d.alamatUsaha, rata: 'tengah', ukuran: 13 });
  if (blokStruk(p, 'telepon', true) && d.teleponUsaha) baris.push({ kind: 'teks', teks: `Telp: ${d.teleponUsaha}`, rata: 'tengah', ukuran: 13 });
  baris.push({ kind: 'teks', teks: d.noDokumen, rata: 'tengah', tebal: true });
  baris.push({ kind: 'teks', teks: d.tanggal, rata: 'tengah', ukuran: 13 });
  baris.push({ kind: 'garis' });
  if (blokStruk(p, 'kasir', true)) baris.push({ kind: 'pasangan', kiri: 'Kasir', kanan: d.kasir });
  if (blokStruk(p, 'pelanggan', true) && d.pelanggan) baris.push({ kind: 'pasangan', kiri: 'Pelanggan', kanan: d.pelanggan });
  baris.push({ kind: 'garis' });
  for (const it of d.items) {
    const kode = blokStruk(p, 'kode_item', true) && it.kode ? `${it.kode} ` : '';
    baris.push({ kind: 'teks', teks: `${kode}${it.nama}` });
    baris.push({
      kind: 'pasangan',
      kiri: `${it.qty} × ${rupiah(it.harga)}`,
      kanan: rupiah(it.jumlah),
      ukuran: 13,
    });
  }
  baris.push({ kind: 'garis' });
  baris.push({ kind: 'pasangan', kiri: 'Subtotal', kanan: rupiah(d.subtotal) });
  if (blokStruk(p, 'diskon', true) && d.diskon) baris.push({ kind: 'pasangan', kiri: 'Diskon', kanan: `−${rupiah(d.diskon)}` });
  if (blokStruk(p, 'pajak', true) && d.pajak) baris.push({ kind: 'pasangan', kiri: 'Pajak', kanan: rupiah(d.pajak) });
  baris.push({ kind: 'pasangan', kiri: 'TOTAL', kanan: rupiah(d.total), tebal: true, ukuran: 18 });
  if (blokStruk(p, 'metode_bayar', true)) {
    for (const b of d.bayar) baris.push({ kind: 'pasangan', kiri: String(b.metode).toUpperCase(), kanan: rupiah(b.jumlah) });
  }
  if (blokStruk(p, 'kembalian', true)) baris.push({ kind: 'pasangan', kiri: 'Kembalian', kanan: rupiah(d.kembalian) });
  if (d.noFaktur) baris.push({ kind: 'teks', teks: `Faktur: ${d.noFaktur}`, rata: 'tengah', ukuran: 13 });
  if (d.catatan) baris.push({ kind: 'teks', teks: d.catatan, rata: 'tengah', ukuran: 13 });
  baris.push({ kind: 'garis' });
  if (blokStruk(p, 'catatan_kaki', true)) {
    baris.push({
      kind: 'teks',
      teks: p?.teks?.['catatan_kaki'] ?? 'Terima kasih atas kunjungan Anda',
      rata: 'tengah',
      ukuran: 13,
    });
  }
  baris.push({ kind: 'teks', teks: d.noDokumen, rata: 'tengah', ukuran: 12 });
  return { baris };
}

/** Model gambar kartu faktur (penjualan/pembelian). */
export function modelFaktur(faktur: FakturDTO, isi: IsiFaktur): ModelDok {
  const jual = faktur.jenis === 'penjualan';
  const baris: BarisDok[] = [
    { kind: 'teks', teks: isi.toko.nama, rata: 'tengah', tebal: true, ukuran: 20 },
  ];
  if (isi.toko.alamat) baris.push({ kind: 'teks', teks: isi.toko.alamat, rata: 'tengah', ukuran: 13 });
  if (isi.toko.telepon) baris.push({ kind: 'teks', teks: `Telp: ${isi.toko.telepon}`, rata: 'tengah', ukuran: 13 });
  baris.push({ kind: 'teks', teks: jual ? 'FAKTUR PENJUALAN' : 'FAKTUR PEMBELIAN', rata: 'tengah', tebal: true, ukuran: 17 });
  baris.push({ kind: 'garis' });
  baris.push({ kind: 'pasangan', kiri: 'No. Faktur', kanan: faktur.no_faktur, tebal: true });
  baris.push({ kind: 'pasangan', kiri: 'Tanggal', kanan: tanggalPanjang(faktur.tanggal) });
  baris.push({ kind: 'pasangan', kiri: jual ? 'Pelanggan' : 'Pemasok', kanan: faktur.pihak.nama || 'Umum' });
  if (faktur.no_sumber) baris.push({ kind: 'pasangan', kiri: 'Ref', kanan: faktur.no_sumber });
  baris.push({ kind: 'garis' });
  isi.items.forEach((it, i) => {
    baris.push({ kind: 'teks', teks: `${i + 1}. ${it.nama}`, tebal: true });
    baris.push({
      kind: 'pasangan',
      kiri: `${Number(it.qty).toLocaleString('id-ID')} × ${rupiah(it.harga)}`,
      kanan: rupiah(it.subtotal),
      ukuran: 13,
    });
  });
  baris.push({ kind: 'garis' });
  baris.push({ kind: 'pasangan', kiri: 'Subtotal', kanan: rupiah(faktur.subtotal) });
  if (Number(faktur.diskon)) baris.push({ kind: 'pasangan', kiri: 'Diskon', kanan: `−${rupiah(faktur.diskon)}` });
  if (Number(faktur.pajak)) baris.push({ kind: 'pasangan', kiri: 'Pajak', kanan: rupiah(faktur.pajak) });
  baris.push({ kind: 'pasangan', kiri: 'TOTAL', kanan: rupiah(faktur.total), tebal: true, ukuran: 18 });
  if (faktur.catatan) baris.push({ kind: 'teks', teks: faktur.catatan, ukuran: 13 });
  baris.push({ kind: 'garis' });
  baris.push({ kind: 'teks', teks: 'Terima kasih.', rata: 'tengah', ukuran: 13 });
  return { baris };
}

/** Ambil dokumen faktur dari server lalu jadikan GambarDok siap raster. */
export async function gambarFaktur(id: number): Promise<GambarDok> {
  const r = await apiGet<{ faktur: FakturDTO; isi: IsiFaktur }>(`/api/faktur/${id}`);
  return { model: modelFaktur(r.faktur, r.isi), lebarPx: 520, namaBerkas: namaAman(r.faktur.no_faktur ?? id, 'FAKTUR') };
}

/** Paket dokumen gambar struk untuk dialog kirim-WA. */
export function gambarStrukDok(d: StrukData, p: ProfilStruk | null): GambarDok {
  const profil = p ?? PROFIL_STRUK_BAWAAN;
  const ukur = ukuranStruk(profil);
  const lebarPx = Math.max(
    220,
    Math.round(ukur.lebar * (96 / 25.4) + ((Number(profil.margin_kiri) || 0) + (Number(profil.margin_kanan) || 0)) * (96 / 25.4)),
  );
  return { model: modelStruk(d, p), lebarPx, namaBerkas: namaAman(d.noDokumen, 'STRUK') };
}

/* --------------------------- Model → PNG --------------------------------- */

const FONT = `'Segoe UI', system-ui, -apple-system, sans-serif`;
const PAD = 28;

function bungkusKata(ctx: CanvasRenderingContext2D, teks: string, lebarMax: number): string[] {
  const keluar: string[] = [];
  for (const paragraf of String(teks).split('\n')) {
    let baris = '';
    for (const kata of paragraf.split(' ')) {
      const uji = baris ? `${baris} ${kata}` : kata;
      if (ctx.measureText(uji).width <= lebarMax || !baris) {
        // Kata tunggal yang terlalu panjang → potong per huruf.
        if (ctx.measureText(uji).width > lebarMax && baris === '') {
          let pot = '';
          for (const h of kata) {
            if (ctx.measureText(pot + h).width > lebarMax && pot) {
              keluar.push(pot);
              pot = '';
            }
            pot += h;
          }
          baris = pot;
        } else {
          baris = uji;
        }
      } else {
        keluar.push(baris);
        baris = kata;
      }
    }
    keluar.push(baris);
  }
  return keluar;
}

/** Render model menjadi PNG (skala 2x agar tajam di WhatsApp). */
export function dokKePng(model: ModelDok, lebarPx: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      const ukur = document.createElement('canvas').getContext('2d');
      if (!ukur) throw new Error('Canvas tidak didukung.');
      const dalam = Math.max(160, lebarPx - PAD * 2);
      type Siap =
        | { kind: 'teks'; barisTeks: string[]; ukuran: number; tebal: boolean; rata: 'kiri' | 'tengah' | 'kanan' }
        | { kind: 'pasangan'; kiri: string; kanan: string; ukuran: number; tebal: boolean }
        | { kind: 'garis' };
      const siap: Siap[] = [];
      let tinggi = PAD;
      for (const b of model.baris) {
        if (b.kind === 'garis') {
          siap.push(b);
          tinggi += 16;
          continue;
        }
        const ukuran = b.ukuran ?? 15;
        ukur.font = `${b.tebal ? '700' : '400'} ${ukuran}px ${FONT}`;
        if (b.kind === 'pasangan') {
          siap.push({ kind: 'pasangan', kiri: b.kiri, kanan: b.kanan, ukuran, tebal: Boolean(b.tebal) });
          tinggi += ukuran * 1.5;
        } else {
          const barisTeks = bungkusKata(ukur, b.teks, dalam);
          siap.push({ kind: 'teks', barisTeks, ukuran, tebal: Boolean(b.tebal), rata: b.rata ?? 'kiri' });
          tinggi += barisTeks.length * ukuran * 1.5;
        }
      }
      tinggi += PAD - 8;

      const SKALA = 2;
      const kanvas = document.createElement('canvas');
      kanvas.width = Math.min(1200, Math.round(lebarPx * SKALA));
      const skalaEfektif = kanvas.width / lebarPx;
      kanvas.height = Math.round(tinggi * skalaEfektif);
      const ctx = kanvas.getContext('2d');
      if (!ctx) throw new Error('Canvas tidak didukung.');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, kanvas.width, kanvas.height);
      ctx.scale(skalaEfektif, skalaEfektif);
      ctx.fillStyle = '#111827';
      ctx.textBaseline = 'top';

      let y = PAD;
      for (const s of siap) {
        if (s.kind === 'garis') {
          ctx.strokeStyle = '#9ca3af';
          ctx.lineWidth = 1;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(PAD, y + 8);
          ctx.lineTo(lebarPx - PAD, y + 8);
          ctx.stroke();
          ctx.setLineDash([]);
          y += 16;
          continue;
        }
        ctx.font = `${s.tebal ? '700' : '400'} ${s.ukuran}px ${FONT}`;
        const lh = s.ukuran * 1.5;
        if (s.kind === 'pasangan') {
          ctx.textAlign = 'left';
          ctx.fillText(s.kiri, PAD, y);
          ctx.textAlign = 'right';
          ctx.fillText(s.kanan, lebarPx - PAD, y);
          y += lh;
        } else {
          for (const t of s.barisTeks) {
            if (s.rata === 'tengah') {
              ctx.textAlign = 'center';
              ctx.fillText(t, lebarPx / 2, y);
            } else if (s.rata === 'kanan') {
              ctx.textAlign = 'right';
              ctx.fillText(t, lebarPx - PAD, y);
            } else {
              ctx.textAlign = 'left';
              ctx.fillText(t, PAD, y);
            }
            y += lh;
          }
        }
      }
      kanvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error('Gagal membuat gambar dokumen.'));
        },
        'image/png',
      );
    } catch (e) {
      reject(e instanceof Error ? e : new Error('Gagal membuat gambar dokumen.'));
    }
  });
}

/* ------------------------- Unduh & bagikan -------------------------------- */

export function unduhBlob(blob: Blob, namaBerkas: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = namaBerkas;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function bisaBagikanGambar(): boolean {
  try {
    const nav = navigator as Navigator & {
      canShare?: (d: { files?: File[] }) => boolean;
    };
    if (typeof nav.canShare !== 'function') return false;
    const uji = new File(['uji'], 'uji.png', { type: 'image/png' });
    return nav.canShare({ files: [uji] });
  } catch {
    return false;
  }
}

export async function bagikanGambar(
  blob: Blob,
  namaBerkas: string,
  judul: string,
  teks: string,
): Promise<'dibagikan' | 'batal' | 'takdidukung'> {
  try {
    const berkas = new File([blob], namaBerkas, { type: 'image/png' });
    await navigator.share({ files: [berkas], title: judul, text: teks });
    return 'dibagikan';
  } catch (e) {
    if (e instanceof DOMException && (e.name === 'AbortError' || e.name === 'NotAllowedError')) return 'batal';
    return 'takdidukung';
  }
}

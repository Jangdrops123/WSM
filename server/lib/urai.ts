// BAGIAN AG — parser mode CHATBOT Pembelian/Inbound (satu pipa, tanpa API/LLM).
//
// Teks multi-baris → pecah baris → pemasok → tanggal → barang (cocokkan ke
// Master Data lewat mesin skor di lib/cocok.ts) → tentukan profil size →
// kodi/pcs → Db/Tp → rincian per size → verifikasi "Total" → pratinjau
// terkoreksi → Simpan Draft (PO).
//
// PARSER LAMA (gaya bebas: "beli dari X, produk A 2 lusin, produk B 10 pcs,
// diskon 5%") sudah DIHAPUS pada BAGIAN AG0 — format input kini hanya gaya
// baris (AG2): baris 1 pemasok, baris 2 tanggal, baris barang diawali
// "•/-/*", dan baris "Total = N kd" untuk verifikasi.
//
// Konvensi:
// - "kd"/"kodi" = N pasang menurut Profil Size baris itu (bawaan 20/kodi).
// - "(3kd db 42 tp 39)" = komposisi sebagian kodi; tanpa kurung = seluruh
//   kodi; beberapa kelompok dalam satu baris didukung (AG7).
// - Rincian per size dipetakan ke produk anggota GRUP barang (AG4); size yang
//   dihitung >0 tanpa produk anggota → peringatan + tawaran "Buat produk
//   otomatis" / "Abaikan size ini".
import { all } from '../db.pg.ts';
import {
  WARNA,
  KUNCI_WARNA,
  cocokkanBarang,
  cocokkanPemasok,
  daftarOperator,
  type AnggotaGrup,
} from './cocok.ts';
import {
  resolusiProfilSize,
  aturanDariProfil,
  profilSizeDefault,
  profilSizeDariId,
  profilUntukSize,
  daftarProfilSize,
  labelProfil,
  rentangSize,
  type ProfilSize,
} from './profilSize.ts';

/** Semua profil yang memuat sebuah size (untuk pesan "pilih profil"). */
async function daftarProfilYangPunyaSize(size: string): Promise<ProfilSize[]> {
  const u = String(size).trim().toLowerCase();
  if (!u) return [];
  return (await daftarProfilSize()).filter((p) => p.sizes.some((s) => s.size.trim().toLowerCase() === u));
}

// --- Tipe hasil -------------------------------------------------------------

export interface InfoProduk {
  id: number;
  sku: string;
  produk: string;
  size: string | null;
  warna: string | null;
  harga_beli: number;
  satuan_dasar_id: number | null;
}

export const infoDariAnggota = (a: AnggotaGrup): InfoProduk => ({
  id: a.id,
  sku: a.sku,
  produk: a.nama,
  size: a.size,
  warna: a.warna,
  harga_beli: a.harga_beli,
  satuan_dasar_id: a.satuan_dasar_id,
});

export interface BarisUrai {
  teks: string; // segmen asli (lowercase) tempat baris berasal
  produk_teks: string; // sisa teks produk setelah field ditarik
  warna: string | null;
  size: string | null;
  rentang_size: [number, number] | null;
  qty: number | null; // jumlah persis seperti yang diketik
  satuan_teks: string | null;
  qty_dasar: number; // jumlah setelah konversi ke satuan dasar
  konversi: string | null; // "6 kd → 120 pasang (1 kodi = 20)"
  harga: number;
  harga_dari_master: boolean;
  diskon_persen: number | null;
  diskon: number; // rupiah (rekomendasi, bisa diedit pengguna)
  product_id: number | null;
  baris: InfoProduk | null;
  unit_id: number | null; // satuan dasar produk (bila produk cocok)
  kecocokan: 'yakin' | 'kabur' | 'tidak';
  /** Skor pencocokan 0-100 (AG5) — dicatat di log & ditampilkan di pratinjau. */
  skor: number;
  saran: InfoProduk[];
  alasan: string[]; // penanda kuning di tabel draft
  /** Gaya BARIS: id kelompok satu baris teks (bisa menghasilkan beberapa baris size). */
  grup?: number;
  kelompok?: string;
  /** Gaya BARIS: jumlah size dalam kelompok ini (untuk rowspan pratinjau). */
  jumlah_size?: number;
}

/** Rincian per size dalam satu baris teks gaya BARIS (satu baris per barang). */
export interface RincianSizeUrai {
  size: string;
  pasang: number;
  /** kodi size = pasang / jatah size (profil) — bukan pasang / total kodi. */
  kodi: number;
  product_id: number | null;
}

/** Satu kelompok komposisi Db/Tp pada satu baris ("(2kd db 42 tp 39)"). */
export interface KelompokKomposisi {
  /** Jumlah kodi komposisi; null = sisa seluruh kodi baris itu. */
  kodi: number | null;
  /** Db/Tp boleh sebagian (hanya Tp → peringatan "Tp … menyisakan …"). */
  db: number | null;
  tp: number | null;
}

/** Aksi yang bisa diklik pengguna pada satu peringatan pratinjau (AG8). */
export interface AksiPesanUrai {
  teks: string;
  aksi: 'pakai_profil' | 'pilih_profil' | 'seimbangkan' | 'buat_produk';
  profil_id?: number;
  profil_nama?: string;
  db?: number;
  tp?: number;
  /** Aksi 'buat_produk' (AG4): grup + size yang belum punya produk anggota. */
  grup?: string;
  size?: string;
  kategori_id?: number | null;
  merek_id?: number | null;
}

/** Pratinjau terstruktur satu baris teks → tabel di mode Chatbot. */
export interface PratinjauUrai {
  grup: number;
  teks: string;
  nama: string;
  warna: string | null;
  /** Grup barang hasil pencocokan (AG4) — null bila tidak ditemukan. */
  grup_barang: string | null;
  jumlah_anggota: number;
  size_tersedia: string[];
  /** Profil size yang dipakai baris ini — null bila tidak ada profil. */
  profil: string | null;
  profil_dari?: 'produk' | 'kategori' | 'kata' | 'size' | 'default' | 'manual' | null;
  /** Id & ukuran profil baris ini — untuk badge P/W + dropdown Db/Tp. */
  profil_id: number | null;
  profil_kode: string | null;
  profil_sizes: { size: string; jatah: number }[];
  /** Db/Tp kelompok pertama (null = tidak ditulis). */
  db: number | null;
  tp: number | null;
  /** Semua kelompok komposisi baris (AG7 — boleh lebih dari satu). */
  komposisi: KelompokKomposisi[];
  /** Jumlah kodi & pcs di luar kodi (untuk kolom Pasang/Kodi/Pcs pratinjau). */
  kodi_normal: number;
  kodi_komp: number;
  pcs: number;
  /** Total pasang per kodi setelah komposisi — 20 = hijau, selain itu kuning. */
  sisa_per_kodi: number;
  seimbang: boolean;
  /** Baris belum terklasifikasi (profil jatuh ke default tanpa petunjuk). */
  ragu: boolean;
  /** Saran profil dari petunjuk size (mis. "db 37" → Wanita). */
  saran_profil: { id: number; nama: string } | null;
  /** Peringatan yang bisa ditindaklanjuti + tombol aksinya. */
  pesan: AksiPesanUrai[];
  qty_teks: string;
  total_pasang: number;
  total_kodi: number;
  rincian: RincianSizeUrai[];
  kecocokan: 'yakin' | 'kabur' | 'tidak';
  skor: number;
  saran: InfoProduk[];
  alasan: string[];
}

/** Hasil cek baris "Total = …" terhadap jumlah hasil hitung. */
export interface CekTotalUrai {
  ada: boolean;
  klaim: number | null;
  hitung: number;
  selisih: number;
  ok: boolean;
}

export interface PemasokUrai {
  teks: string | null;
  supplier_id: number | null;
  cocok: boolean;
  skor: number;
  saran: { id: number; nama: string }[];
}

export interface HasilUrai {
  pemasok: PemasokUrai;
  baris: BarisUrai[];
  catatan: string[];
  pesan_bot: string;
  gaya?: 'bebas' | 'baris';
  tanggal?: string | null;
  pratinjau?: PratinjauUrai[];
  cek?: CekTotalUrai;
  aturan?: { per_kodi: number; normal: Record<string, number> };
}

// --- Kamus & utilitas parsing ------------------------------------------------

const KUNCI_SATUAN_BEBAS = new Set(['pcs', 'pc', 'bh', 'buah', 'unit', 'set', 'pasang', 'psg', 'lsn', 'lusin', 'lusinan']);

/** Kata umum yang bukan bagian nama produk. */
const STOPWORDS = new Set([
  'beli', 'dari', 'untuk', 'dengan', 'yang', 'dan', 'atau', 'sebanyak', 'masing',
  'semua', 'barang', 'produk', 'item', 'harga', 'diskon', 'potongan', 'disc',
  'discount', 'rp', 'jumlah', 'qty', 'tolong', 'please', 'request', 'pesan',
  'order', 'utk', 'dgn', 'ya', 'dong', 'deh', 'nih', 'buat', 'supaya', 'biar',
  'ada', 'ini', 'itu', 'the', 'of', 'and', 'or', 'for', 'plus', 'sama', 'per',
  'lagi', 'donk', 'ayo', 'mari', 'sih', 'saja', 'aja', 'kak', 'bro', 'mas',
  'mbak', 'pak', 'bu', 'no', 'nomor', 'kode', 'lengkap', 'beserta', 'termasuk',
  'ready', 'stok', 'promo', 'gratis', 'mohon', 'saya', 'kami', 'mau', 'akan',
  'nya', 'punya', 'dulu', 'baru', 'banyak', 'sedikit',
  'size', 'ukuran', 'warna', 'ok', 'oke', 'okay', 'thanks', 'thank', 'you',
  'makasih', 'terima', 'kasih', 'sip', 'siap', 'halo', 'hai', 'hello', 'test', 'tes',
]);
for (const k of KUNCI_SATUAN_BEBAS) STOPWORDS.add(k);
for (const k of ['kd', 'kodi', 'kodian', 'db', 'tp']) STOPWORDS.add(k);

const RE_WARNA = new RegExp(`\\b(${KUNCI_WARNA.join('|')})\\b`, 'i');
const RE_INTRO_PEMASOK = /^(?:beli\s+)?(?:dari|pemasok|supplier)\s+(.+)$/i;

/** "45.000" / "45,000" / "45.500,75" → number (gaya id-ID). */
function angka(s: string): number {
  const b = s.replace(/\s/g, '');
  if (/^\d{1,3}(\.\d{3})+$/.test(b)) return Number(b.replace(/\./g, ''));
  if (/^\d{1,3}(,\d{3})+$/.test(b)) return Number(b.replace(/,/g, ''));
  return Number(b.replace(',', '.'));
}

function tokenisasi(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Normalisasi kata warna ke bentuk baku (navy → biru, cokelat → coklat, …). */
function warnaBaku(kata: string): string {
  const k = kata.toLowerCase();
  return WARNA[k] ?? k;
}

function normWarna(nilai: string | null | undefined): string | null {
  if (!nilai) return null;
  const kata = tokenisasi(nilai).filter((t) => t.length > 1 || WARNA[t]);
  return kata.length ? warnaBaku(kata[0]) : null;
}

function kutip(s: string): string {
  return s.replace(/[()[\]{}.,;:@/\\]/g, ' ').replace(/\s+/g, ' ').trim();
}

// --- Aturan darurat (bila tidak ada profil sama sekali) ----------------------

/** Aturan per kodi (ukuran & jatah per size) — sumber utama = Profil Size. */
export interface AturanKodi {
  per_kodi: number;
  normal: Record<string, number>;
}

/** Fallback bila Profil Size belum ada sama sekali (mode lama sudah dihapus). */
const ATURAN_DARURAT: AturanKodi = {
  per_kodi: 20,
  normal: { '39': 4, '40': 4, '41': 4, '42': 4, '43': 4 },
};

// --- Baris & tanggal ---------------------------------------------------------

const BULAN_ID: Record<string, number> = {
  jan: 1, januari: 1, feb: 2, peb: 2, februari: 2, pebruari: 2,
  mar: 3, maret: 3, apr: 4, april: 4, mei: 5,
  jun: 6, juni: 6, jul: 7, juli: 7, agu: 8, agt: 8, agustus: 8,
  sep: 9, september: 9, okt: 10, oktober: 10,
  nov: 11, november: 11, des: 12, desember: 12,
};
const RE_HARI = /^(senin|selasa|rabu|kamis|jum['’]?at|sabtu|ahad|minggu)\b[\s,]*/i;
const RE_BULLET = /^\s*[•\-*·]\s+\S/;

/** "Jumat 09 okt" · "09/10/2026" · "9 oktober 2026" · "hari ini" → 'YYYY-MM-DD'. */
function uraiTanggalBaris(t: string): string | null {
  let s = t.trim().toLowerCase().replace(RE_HARI, '').replace(/^[,;]+/, '').trim();
  if (!s) return null;

  // AG2 — "hari ini" / "kemarin" (nama hari sebelumnya hanya validasi, bukan penentu).
  const ringkas = (geser: number): string => {
    const d = new Date();
    d.setDate(d.getDate() + geser);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  if (/^(hari\s+ini|ini)$/.test(s)) return ringkas(0);
  if (/^(kemarin|kmrin)$/.test(s)) return ringkas(-1);

  const susun = (d: number, m: number, y?: number): string | null => {
    const tahun = y && y >= 1000 ? y : y && y < 100 ? 2000 + y : new Date().getFullYear();
    if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
    const uji = new Date(tahun, m - 1, d);
    if (uji.getMonth() !== m - 1) return null;
    return `${tahun}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };

  let m = s.match(/^(\d{1,2})\s*[/-]\s*(\d{1,2})(?:\s*[/-]\s*(\d{2,4}))?\b/);
  if (m) return susun(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined);

  m = s.match(/^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?/);
  if (m && m[2].length >= 3 && BULAN_ID[m[2].slice(0, 3)]) {
    return susun(Number(m[1]), BULAN_ID[m[2].slice(0, 3)], m[3] ? Number(m[3]) : undefined);
  }
  return null;
}

/** Pencocokan baris pertama ke master Pemasok (metode skor AG5). */
async function pemasokBaris(teks: string): Promise<PemasokUrai> {
  const hasil = await cocokkanPemasok(teks);
  return {
    teks: hasil.teks,
    supplier_id: hasil.supplier_id,
    cocok: hasil.cocok,
    skor: hasil.skor,
    saran: hasil.saran.map((s) => ({ id: s.id, nama: s.nama })),
  };
}

// --- Uraian satu baris barang ------------------------------------------------

interface KelompokMentah {
  kodi: number | null;
  /** Db boleh null (hanya Tp disebut) — pengali tetap 1 untuk size lain. */
  db: number | null;
  tp: number | null;
}

interface MentahBaris {
  teks: string;
  nama: string;
  warna: string | null;
  size: string | null;
  kodi: number | null; // jumlah kodi yang disebut ("6 kd")
  bebas: number; // jumlah pasang di luar kodi (pcs, lusin, ",10pcs")
  /** Satuan identik-pasang yang diketik (pcs / box) — tampil sebagai catatan baris. */
  satuanTeks: string | null;
  /** Baris menulis rentang size ("39-43") — daftar size dipakai dari profil. */
  adaRentang: boolean;
  /** Kelompok komposisi Db/Tp (AG7 — boleh lebih dari satu). */
  kelompok: KelompokMentah[];
  /** Petunjuk size Db/Tp pertama — dipakai resolusi profil. */
  db: number | null;
  tp: number | null;
  qtyTeks: string;
  harga: number | null;
  diskonPersen: number | null;
  adaJumlah: boolean;
}

/** Pasangan kata kunci operator → regex "kata <size>". */
async function reOperator(): Promise<{ re: RegExp; db: Set<string>; tp: Set<string>; pengali: Map<string, number> }> {
  const db = new Set<string>();
  const tp = new Set<string>();
  const pengali = new Map<string, number>();
  const kata: string[] = [];
  for (const op of await daftarOperator()) {
    if (!op.aktif) continue;
    for (const k of op.kata_kunci) {
      const kk = k.trim().toLowerCase();
      if (!kk || kata.includes(kk)) continue;
      kata.push(kk);
      pengali.set(kk, op.pengali);
      if (op.pengali === 0) tp.add(kk);
      else db.add(kk);
    }
  }
  const esc = kata.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return { re: new RegExp(`\\b(${esc.length ? esc.join('|') : 'db|tp'})\\s*[.:]?\\s*(\\d{1,3})`, 'gi'), db, tp, pengali };
}

/** Urai satu baris "• chx merah 6 kd (3kd db 42 tp 39)". */
async function uraiBarisItem(barisMentah: string, catatan: string[]): Promise<MentahBaris> {
  let sisa = barisMentah.replace(/^\s*[•\-*·]\s+/, '').trim();
  const asli = sisa;
  const out: MentahBaris = {
    teks: asli,
    nama: '',
    warna: null,
    size: null,
    kodi: null,
    bebas: 0,
    satuanTeks: null,
    adaRentang: false,
    kelompok: [],
    db: null,
    tp: null,
    qtyTeks: '',
    harga: null,
    diskonPersen: null,
    adaJumlah: false,
  };
  const qTeks: string[] = [];
  const buang = (m: RegExpMatchArray) => {
    const i = m.index ?? 0;
    sisa = `${sisa.slice(0, i)} ${sisa.slice(i + m[0].length)}`;
  };

  const op = await reOperator();

  /** Baca pasangan "db 42 tp 39" dari sebuah teks → kelompok komposisi.
      `senyap` = pemindaian teks biasa (luar kurung) tanpa catatan kosong. */
  const bacaKomposisi = (teks: string, kodi: number | null, sumber: string, senyap = false): KelompokMentah | null => {
    const re = new RegExp(op.re.source, 'gi');
    const temuan: { kata: string; size: number; idx: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(teks)) !== null) {
      temuan.push({ kata: m[1].toLowerCase(), size: Number(m[2]), idx: m.index });
      if (temuan.length > 8) break;
    }
    if (temuan.length === 0) {
      if (!senyap && teks.trim()) catatan.push(`Isi kurung "${teks.trim()}" tidak terbaca — komposisi diabaikan.`);
      return null;
    }
    // Pasangkan: kata berpengali (Db) lalu kata nol (Tp) — keduanya boleh
    // hilang sebagian (AG7: "Tp 40 menyisakan 16 pasang per kodi" = Tp saja).
    let db: number | null = null;
    let tp: number | null = null;
    for (let i = 0; i < temuan.length; i++) {
      const t = temuan[i];
      const nol = op.pengali.get(t.kata) === 0;
      if (!nol && db === null) db = t.size;
      else if (nol && tp === null) tp = t.size;
      else {
        catatan.push(`Baris "${sumber}" punya lebih dari pasangan Db/Tp — baca pasangan pertama saja.`);
        break;
      }
    }
    if (db === null && tp === null) {
      if (!senyap) catatan.push(`Komposisi pada "${sumber}" tidak terbaca — diabaikan.`);
      return null;
    }
    return { kodi, db, tp };
  };

  // 1) komposisi dalam kurung — boleh lebih dari satu kelompok (AG7).
  sisa = sisa.replace(/\(([^)]*)\)/g, (_, isi: string) => {
    const teks = String(isi);
    const mKodi = teks.match(/^\s*(\d+(?:[.,]\d+)?)\s*(?:kd|kodi|kodian)?\b/i);
    const n = mKodi ? angka(mKodi[1]) : null;
    const sisanya = mKodi ? teks.slice(mKodi[0].length) : teks;
    const g = bacaKomposisi(sisanya, n, asli);
    if (g) out.kelompok.push(g);
    return ' ';
  });

  // 1b) Db/Tp DI LUAR kurung: "amara hitam 1 kd db 37 tp 40" (semua pasangan).
  if (out.kelompok.length === 0) {
    const g = bacaKomposisi(sisa, null, asli, true);
    if (g) {
      out.kelompok.push(g);
      sisa = sisa.replace(new RegExp(op.re.source, 'gi'), ' ');
    }
  } else if (new RegExp(op.re.source, 'i').test(sisa)) {
    sisa = sisa.replace(new RegExp(op.re.source, 'gi'), ' ');
    catatan.push(`Baris "${asli}": komposisi tambahan di luar kurung diabaikan — baris sudah punya kelompok komposisi.`);
  }

  if (out.kelompok.length) {
    out.db = out.kelompok[0].db;
    out.tp = out.kelompok[0].tp;
  }

  // 2) harga & diskon bila disebut eksplisit
  sisa = sisa.replace(/@(\d[\d.,]*)/, (_, n: string) => {
    if (out.harga === null) out.harga = angka(n);
    return ' ';
  });
  sisa = sisa.replace(/\bharga\s*[:=]?\s*(?:rp\.?\s*)?(\d[\d.,]*)/i, (_, n: string) => {
    if (out.harga === null) out.harga = angka(n);
    return ' ';
  });
  sisa = sisa.replace(/\brp\.?\s*(\d[\d.,]*)/i, (_, n: string) => {
    if (out.harga === null) out.harga = angka(n);
    return ' ';
  });
  sisa = sisa.replace(/\b(?:diskon|disc|potongan)\s*[:=]?\s*(\d[\d.,]*)\s*(%|persen)?/i, (m, n: string, p?: string) => {
    if (p) out.diskonPersen = angka(n);
    else catatan.push(`Diskon rupiah "${m.trim()}" tidak otomatis di mode Chatbot — isi manual per baris.`);
    return ' ';
  });

  // 3) jumlah: kombinasi "2,10pcs" → 2 kodi + 10 pcs; lalu kodi / lusin / pcs
  const gabung = sisa.match(/\b(\d+)\s*,\s*(\d+)\s*(pcs|psg|pasang|bh|pc)\b/i);
  if (gabung) {
    out.kodi = angka(gabung[1]);
    out.bebas += angka(gabung[2]);
    qTeks.push(gabung[0].trim().replace(/\s+/g, ''));
    buang(gabung);
  }
  const kodiM = sisa.match(/\b(\d+(?:[.,]\d+)?)\s*(kd|kodi|kodian)\b/i);
  if (kodiM) {
    out.kodi = (out.kodi ?? 0) + angka(kodiM[1]);
    qTeks.push(kodiM[0].trim());
    buang(kodiM);
  }
  const lusinM = sisa.match(/\b(\d+(?:[.,]\d+)?)\s*(lsn|lusin|lusinan)\b/i);
  if (lusinM) {
    out.bebas += angka(lusinM[1]) * 12;
    qTeks.push(lusinM[0].trim());
    buang(lusinM);
  }
  const pcsM = sisa.match(/\b(\d+(?:[.,]\d+)?)\s*(pcs|psg|pasang|bh|pc|buah|unit|set)\b/i);
  if (pcsM) {
    out.bebas += angka(pcsM[1]);
    out.satuanTeks = pcsM[2].toLowerCase();
    qTeks.push(pcsM[0].trim());
    buang(pcsM);
  }
  // Satuan kemasan (box/dus/…) tanpa konversi ke satuan dasar: jumlah tetap
  // dibaca (dianggap pasang) dan baris ditandai kuning agar diperiksa manual.
  const boxM = sisa.match(/\b(\d+(?:[.,]\d+)?)\s*(box|boxes|dus|kardus|karton|ctn)\b/i);
  if (boxM) {
    out.bebas += angka(boxM[1]);
    out.satuanTeks = boxM[2].toLowerCase();
    qTeks.push(boxM[0].trim().replace(/\s+/g, ' '));
    buang(boxM);
  }
  out.qtyTeks = qTeks.join(' + ');

  // 4) size eksplisit: "size 42" / ukuran M / angka 25-65 tersisa
  const sizeM = sisa.match(/\b(?:size|ukuran|uk)\s*[:.]?\s*([a-z0-9]+(?:\s*[-–]\s*[a-z0-9]+)?)/i);
  if (sizeM) {
    const nilai = sizeM[1].replace(/\s/g, '');
    if (nilai.includes('-')) catatan.push(`Rentang size pada "${asli}" tidak dipakai — sebutkan per baris.`);
    else out.size = nilai.toLowerCase();
    buang(sizeM);
  } else {
    // Rentang telanjang "39-43" (tanpa kata "size"): baris memakai daftar size profil.
    const rentangM = sisa.match(/\b(2[5-9]|[3-6]\d)\s*[-–\/]\s*(2[5-9]|[3-6]\d)\b/);
    if (rentangM) {
      out.adaRentang = true;
      catatan.push(`Rentang size ${rentangM[1]}–${rentangM[2]} pada "${asli}" tidak dipakai — baris memakai daftar size profil.`);
      buang(rentangM);
    } else {
      const angkaM = sisa.match(/\b(2[5-9]|[3-6]\d)\b/);
      if (angkaM) {
        out.size = angkaM[1];
        buang(angkaM);
      } else {
        // Size huruf tersendiri (AG0 — warna/size terbaca dari teks/nama produk):
        // "kemeja flanel merah L 10 pcs" → size 'l'. Urutan terpanjang dulu (xxl sebelum xl).
        const hurufM = sisa.match(/\b(xxxl|xxl|xl|xs|s|m|l)\b/i);
        if (hurufM) {
          out.size = hurufM[1].toLowerCase();
          buang(hurufM);
        }
      }
    }
  }

  // 5) warna (kamus + ejaan salah ±1 huruf), lalu sisa = nama produk
  const warnaM = sisa.match(RE_WARNA);
  let warnaKetemu: string | null = null;
  if (warnaM) warnaKetemu = warnaBaku(warnaM[0]);
  if (warnaKetemu) {
    out.warna = warnaKetemu;
    sisa = sisa.replace(RE_WARNA, ' ');
  } else {
    // Kesalahan ketik ("mrah", "htam") — Levenshtein ≤1 pada kata ≥4 huruf.
    const kata = sisa.split(/\s+/).filter(Boolean);
    for (let i = 0; i < kata.length; i++) {
      const k = kata[i].toLowerCase();
      if (k.length < 4) continue;
      const dekat = Object.keys(WARNA).find((w) => w.length >= 4 && Math.abs(w.length - k.length) <= 1 && jarakHuruf(w, k) <= 1);
      if (dekat) {
        out.warna = WARNA[dekat];
        kata.splice(i, 1);
        sisa = kata.join(' ');
        break;
      }
    }
  }
  out.nama = kutip(sisa);
  out.adaJumlah = out.kodi !== null || out.bebas > 0 || out.kelompok.length > 0;
  if (out.adaJumlah && !out.qtyTeks) {
    const g = out.kelompok[0];
    out.qtyTeks = g && g.kodi !== null ? `${g.kodi} kd` : '';
  }
  return out;
}

/** Levenshtein mini untuk deteksi warna salah ketik. */
function jarakHuruf(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 2;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let cur = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let best = cur[0];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > 1) return 2;
    const t = prev;
    prev = cur;
    cur = t;
  }
  return prev[b.length];
}

/** Harga beli terakhir dari pemasok tersebut (fallback: harga beli produk). */
async function hargaTerakhirSupplier(supplierId: number | null, productIds: number[]): Promise<Map<number, number>> {
  const peta = new Map<number, number>();
  if (!supplierId || productIds.length === 0) return peta;
  const ph = productIds.map(() => '?').join(',');
  const rows = await all<{ product_id: number; harga_beli: number }>(
    `SELECT pi.product_id, pi.harga_beli
       FROM purchase_items pi
       JOIN purchases p ON p.id = pi.purchase_id
      WHERE p.supplier_id = ? AND p.status <> 'batal' AND pi.product_id IN (${ph})
      ORDER BY p.tanggal DESC, p.id DESC, pi.id DESC`,
    supplierId,
    ...productIds,
  );
  for (const r of rows) if (!peta.has(Number(r.product_id))) peta.set(Number(r.product_id), Number(r.harga_beli ?? 0));
  return peta;
}

const BULAN_PANJANG = [
  '', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/** Skor saran per baris: size sama didahulukan, lalu warna sama. */
function skorSaran(v: InfoProduk, size: string | null, warna: string | null): number {
  let n = 0;
  if (size && v.size && String(v.size).toLowerCase() === size.toLowerCase()) n += 4;
  if (warna && normWarna(v.warna) === warna) n += 2;
  return n;
}

/**
 * Koreksi manual dari pratinjau: pengguna mengganti profil / Db / Tp
 * pada satu baris — parser menghitung ulang dengan pilihan itu.
 */
export interface UrahanBaris {
  /** Id profil pilihan pengguna; null = lepas (kembali resolusi otomatis). */
  profil_id?: number | null;
  db?: number | null;
  tp?: number | null;
}

/** Parser gaya baris utama (satu-satunya parser mode Chatbot — AG0). */
export async  function uraiPembelianBaris(teksMentah: string, ubah?: UrahanBaris): Promise<HasilUrai> {
  // Aturan global (baris "Total = …" & fallback): profil default bila ada.
  const aturan = aturanDariProfil(await profilSizeDefault()) ?? ATURAN_DARURAT;
  const catatan: string[] = [];
  const garis = teksMentah.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  // 1) baris "Total = …" — dipakai sebagai verifikasi, bukan sumber jumlah.
  let klaim: number | null = null;
  const badan: string[] = [];
  for (const g of garis) {
    const mt = g.match(/^\s*(?:total|tot)\s*[:=]\s*(\d+(?:[.,]\d+)?)\s*(kd|kodi|kodian|pcs|psg|pasang)?/i);
    if (mt) {
      const nilai = angka(mt[1]);
      const satuan = (mt[2] ?? '').toLowerCase();
      if (satuan.startsWith('p')) {
        klaim = nilai / aturan.per_kodi;
        catatan.push(`Total tertulis ${nilai} pasang → ${klaim} kodi (1 kodi = ${aturan.per_kodi} pasang).`);
      } else if (satuan) {
        klaim = nilai;
      } else {
        klaim = nilai >= aturan.per_kodi ? nilai / aturan.per_kodi : nilai;
        if (nilai >= aturan.per_kodi) catatan.push(`Total "${g}" tanpa satuan — dibaca ${nilai} pasang (${klaim} kodi).`);
      }
      continue;
    }
    badan.push(g);
  }

  // 2) baris awal: pemasok (baris 1) & tanggal (baris 2), sisanya item.
  let tanggal: string | null = null;
  let teksPemasok: string | null = null;
  const itemGar: string[] = [];
  for (const g of badan) {
    if (RE_BULLET.test(g)) {
      itemGar.push(g);
      continue;
    }
    if (tanggal === null) {
      const t = uraiTanggalBaris(g);
      if (t) {
        tanggal = t;
        continue;
      }
    }
    const mIntro = g.match(RE_INTRO_PEMASOK);
    if (teksPemasok === null && mIntro) {
      const sisaIntro = mIntro[1].trim();
      const koma = sisaIntro.search(/[,;]/);
      if (koma >= 0) {
        // "beli dari Supplier A, chx merah 6 kd" → pemasok + baris barang.
        teksPemasok = sisaIntro.slice(0, koma).trim();
        const lanjut = sisaIntro.slice(koma + 1).trim();
        if (lanjut) itemGar.push(lanjut);
        continue;
      }
      if (badan.length > 1) {
        teksPemasok = g;
        continue;
      }
      // Pesan tunggal ber-intro tanpa koma: barisnya sendiri barang bila ada jumlah.
      itemGar.push(g);
      continue;
    }
    if (teksPemasok === null && badan.length > 1) {
      teksPemasok = g;
      continue;
    }
    itemGar.push(g);
  }
  if (tanggal === null && garis.length > 1) {
    catatan.push('Baris tanggal tidak terbaca — tanggal dokumen memakai isian form.');
  }
  const pemasok: PemasokUrai = await pemasokBaris(teksPemasok ?? '');
  if (teksPemasok && !pemasok.cocok) {
    catatan.push(`Pemasok "${teksPemasok}" belum ada di master (skor ${pemasok.skor}) — buat baru atau pilih saran.`);
  }

  // 3) urai tiap baris item → beberapa baris draft (per size).
  const baris: BarisUrai[] = [];
  const pratinjau: PratinjauUrai[] = [];
  let grup = 0;

  for (const g of itemGar) {
    const mentah = await uraiBarisItem(g, catatan);
    // Koreksi Db/Tp dari pratinjau diterapkan SEBELUM resolusi profil.
    if (ubah && (ubah.db !== undefined || ubah.tp !== undefined)) {
      const db = ubah.db ?? null;
      const tp = ubah.tp ?? null;
      const nLama = mentah.kelompok.reduce((n, k) => n + (k.kodi ?? 0), 0);
      const semuaLamaBerpengali = mentah.kelompok.every((k) => k.kodi !== null);
      mentah.kelompok = db !== null && tp !== null ? [{ kodi: semuaLamaBerpengali && nLama > 0 ? nLama : null, db, tp }] : [];
      mentah.db = db;
      mentah.tp = tp;
    }
    const alasan: string[] = [];
    if (!mentah.nama && !mentah.warna && !mentah.size && !mentah.adaJumlah) {
      catatan.push(`Baris "${g}" tidak terbaca — diabaikan.`);
      continue;
    }
    if (!mentah.nama) alasan.push('Nama barang tidak terbaca — ketik nama barangnya.');
    if (!mentah.adaJumlah) alasan.push('Jumlah tidak terbaca — isi jumlah sebelum simpan.');
    if (mentah.satuanTeks && ['box', 'boxes', 'dus', 'kardus', 'karton', 'ctn'].includes(mentah.satuanTeks)) {
      alasan.push(`Satuan "${mentah.satuanTeks}" tanpa konversi ke satuan dasar — jumlah dianggap pasang; periksa sebelum simpan.`);
    }

    const qTokens = tokenisasi(mentah.nama).filter((t) => t.length > 1 && !STOPWORDS.has(t));
    const cocok = await cocokkanBarang({
      tokens: qTokens,
      teks: mentah.nama,
      warna: mentah.warna,
      size: null,
      supplierId: pemasok.supplier_id,
    });
    alasan.push(...cocok.alasan.filter((a) => cocok.kecocokan === 'tidak' || !a.startsWith('Alias')));

    // Profil size baris ini — urutan AG6: produk > kategori/merek > kata penanda
    // > petunjuk size Db/Tp > profil default > bila ragu, tanyakan di pratinjau.
    const anggotaRujuk = cocok.grup
      ? cocok.grup.anggota.find((a) => a.profil_id !== null) ?? cocok.grup.anggota[0] ?? null
      : null;
    const resolusi = await resolusiProfilSize({
      produkId: anggotaRujuk?.profil_id ? anggotaRujuk.id : null,
      kategoriId: cocok.grup?.kategori_id ?? null,
      merekId: cocok.grup?.merek_id ?? null,
      teks: g,
      sizes: [mentah.db, mentah.tp, mentah.size],
    });
    let profil = resolusi.profil;
    let profilDari = resolusi.dari;
    let ragu = resolusi.ragu;
    let saranProfil = resolusi.saran;
    let ukuranRagu = resolusi.ukuranRagu;
    // Pengguna memilih profil pada pratinjau: pilihannya menang.
    if (ubah && ubah.profil_id !== undefined) {
      const p = ubah.profil_id ? await profilSizeDariId(ubah.profil_id) : null;
      profil = p;
      profilDari = p ? 'manual' : null;
      ragu = false;
      saranProfil = null;
      ukuranRagu = [];
    }
    const aturanGrup = (profil ? aturanDariProfil(profil) : null) ?? aturan;
    const ukuranAturan = Object.keys(aturanGrup.normal).sort((a, b) => Number(a) - Number(b));

    // Ukuran yang dipecah: size eksplisit, atau daftar size profil/grup (AG4).
    const numerik = cocok.grup ? [...cocok.grup.sizeSet].filter((s) => /^\d+$/.test(s)) : [];
    const adaSizeHuruf = cocok.grup ? [...cocok.grup.sizeSet].some((s) => !/^\d+$/.test(s)) : false;
    const profilPositif = !!profil && profilDari !== null && profilDari !== 'default';
    const ukuran: (string | null)[] = mentah.size
      ? [mentah.size]
      : cocok.grup && numerik.length === 0 && (adaSizeHuruf || !profilPositif)
        ? [null]
        // Pecah per size profil HANYA bila ada grup barang atau rentang size yang
        // diketik — barang tak dikenal tanpa konteks ukuran tetap SATU baris.
        : (cocok.grup || mentah.adaRentang) && ukuranAturan.length > 0
          ? ukuranAturan
          : [null];
    const pecah = ukuran.length > 1 && ukuran[0] !== null;

    // Sebaran pasang per size (AG7 — rumus: J[size] × pengali(size)).
    let kodiNormal = 0;
    let kodiKomp = 0;
    const kelompok = mentah.kelompok;
    if (kelompok.length > 0) {
      const totalKodi = mentah.kodi;
      const nEksplisit = kelompok.map((k) => k.kodi);
      const jumlahEksplisit = nEksplisit.reduce<number>((n, k) => n + (k ?? 0), 0);
      const kosong = kelompok.filter((k) => k.kodi === null).length;
      let total = totalKodi;
      if (total === null) {
        if (kosong === 1 && kelompok.length === 1) total = kelompok[0].kodi ?? 0;
        else total = jumlahEksplisit;
        if (total <= 0) {
          alasan.push('Jumlah kodi tidak terbaca untuk komposisi Db/Tp.');
          total = 0;
        }
      }
      if (kosong > 1) {
        catatan.push(`Baris "${mentah.teks}": lebih dari satu kelompok komposisi tanpa jumlah kodi — hanya kelompok pertama yang dipakai.`);
      }
      let sisaKodi = total;
      for (const k of kelompok) {
        const n = k.kodi ?? Math.max(0, total - jumlahEksplisit);
        sisaKodi -= n;
      }
      if (sisaKodi < 0) {
        alasan.push(`Jumlah kodi komposisi (${total - sisaKodi}) melebihi total kodi barang (${total}).`);
        sisaKodi = 0;
      }
      kodiNormal = Math.max(0, sisaKodi);
      kodiKomp = total - kodiNormal;
    } else if (mentah.kodi !== null) {
      kodiNormal = mentah.kodi;
    }
    const totalPasang = Math.round(((kodiNormal + kodiKomp) * aturanGrup.per_kodi + mentah.bebas) * 1000) / 1000;

    const sebaran = new Map<string, number>();
    let sisaPerKodi = aturanGrup.per_kodi; // total jatah per kodi SETELAH komposisi
    let seimbangBaris = true;
    const pesanUrai: AksiPesanUrai[] = [];
    if (pecah) {
      for (const s of ukuranAturan) sebaran.set(s, (aturanGrup.normal[s] ?? 0) * kodiNormal);
      let idxKelompok = 0;
      for (const k of kelompok) {
        const n = k.kodi ?? Math.max(0, kodiKomp - kelompok.filter((x) => x.kodi !== null).reduce((n2, x) => n2 + (x.kodi ?? 0), 0));
        if (n <= 0) continue;
        idxKelompok += 1;
        if (k.db !== null && k.db === k.tp) {
          const pesan = `Db dan Tp sama (size ${k.db}) — komposisi tidak valid.`;
          alasan.push(pesan);
          seimbangBaris = false;
          continue;
        }
        const komp = new Map<string, number>();
        // Rumus AG7: pasang[size] = J[size] × pengali(size); pengali 2 (Db) / 0 (Tp) / 1 (lain).
        for (const s of ukuranAturan) {
          let kali = 1;
          if (k.db !== null && s === String(k.db)) kali = 2;
          else if (k.tp !== null && s === String(k.tp)) kali = 0;
          komp.set(s, (aturanGrup.normal[s] ?? 0) * kali);
        }
        const diLuar = [k.db, k.tp].filter((x): x is number => x !== null && !ukuranAturan.includes(String(x)));
        if (diLuar.length > 0) {
          catatan.push(`Size ${diLuar.join(' / ')} di luar aturan (${ukuranAturan.join(', ')}) — periksa hasilnya.`);
        }
        const kelompokSisa = ukuranAturan.reduce((n2, s) => n2 + (komp.get(s) ?? 0), 0);
        if (idxKelompok === 1) sisaPerKodi = kelompokSisa;
        for (const s of ukuranAturan) sebaran.set(s, (sebaran.get(s) ?? 0) + (komp.get(s) ?? 0) * n);
        if (kelompokSisa !== aturanGrup.per_kodi) {
          seimbangBaris = false;
          // Db DI LUAR daftar size profil tidak mempengaruhi pengali → dianggap
          // absen, sehingga pesan menyoroti Tp (sesuai API /hitung — AF5).
          const dbEfektif = k.db !== null && ukuranAturan.includes(String(k.db)) ? k.db : null;
          const teksPesan =
            dbEfektif === null && k.tp !== null
              ? `Tp ${k.tp} menyisakan ${kelompokSisa} pasang per kodi. Tambahkan Db untuk menyeimbangkan atau ubah Tp.`
              : `Komposisi menyisakan ${kelompokSisa} pasang per kodi (seharusnya ${aturanGrup.per_kodi}) — periksa Db/Tp.`;
          pesanUrai.push({
            teks: teksPesan,
            aksi: 'seimbangkan',
            tp: k.tp ?? undefined,
            db: k.db ?? undefined,
          } as AksiPesanUrai);
        }
        const ukuranMasuk = [k.db, k.tp].filter((x): x is number => x !== null && !ukuranAturan.includes(String(x)));
        if (ukuranMasuk.length > 0) {
          const salah = ukuranMasuk[0];
          const lain = await profilUntukSize(String(salah), profil);
          const pesan = `Size ${salah} tidak ada di profil ${profil ? labelProfil(profil) : 'baris ini'} (${ukuranAturan.join(', ')}).`;
          alasan.push(pesan);
          if (lain) pesanUrai.push({ teks: `Barang ini termasuk ${labelProfil(lain)}?`, aksi: 'pakai_profil', profil_id: lain.id, profil_nama: labelProfil(lain) });
        }
      }
      if (mentah.bebas > 0) {
        let sisa = mentah.bebas;
        let i = 0;
        while (sisa > 0 && i < ukuranAturan.length * Math.ceil(sisa + 1)) {
          const s = ukuranAturan[i % ukuranAturan.length];
          sebaran.set(s, (sebaran.get(s) ?? 0) + 1);
          sisa -= 1;
          i += 1;
        }
        catatan.push(`${mentah.bebas} pcs di luar kodi dibagi merata ke ukuran ${ukuranAturan.join(', ')}.`);
      }
    } else if (kelompok.length > 0 && !pecah) {
      // Satu baris tanpa pecahan (size tunggal) — komposisi tetap dihitung.
      sisaPerKodi = aturanGrup.per_kodi;
    }

    grup += 1;
    const idxGrup = grup;
    const rincian: RincianSizeUrai[] = [];
    const alasanProfil: string[] = [];
    const productIds: number[] = [];
    let dibuat = 0;

    for (const size of ukuran) {
      const pasang = !pecah
        ? totalPasang
        : Math.round((sebaran.get(size as string) ?? 0) * 1000) / 1000;
      const per = await cocokkanBarang({
        tokens: qTokens,
        teks: mentah.nama,
        warna: mentah.warna,
        size: size ?? null,
        supplierId: pemasok.supplier_id,
        kandidatSaja: true,
      });
      const saranUrut = [...per.saran].sort((a, b) => skorSaran(b, size, mentah.warna) - skorSaran(a, size, mentah.warna));
      const v = per.anggota;
      if (v) productIds.push(v.id);
      // Size baris: eksplisit dari teks, atau dibaca dari nama produk terpilih
      // (AG0 — satu produk = satu baris katalog; warna/size terbaca dari nama).
      const sizeRow = size ?? (v?.size ? String(v.size).toLowerCase() : null);
      rincian.push({
        size: sizeRow ?? '-',
        pasang,
        kodi: Math.round((pasang / (aturanGrup.normal[String(size)] ?? aturanGrup.per_kodi)) * 1000) / 1000,
        product_id: v?.id ?? null,
      });
      if (pasang <= 0 && pecah && mentah.adaJumlah) continue; // jatah 0 → cukup di pratinjau

      const alasanRow = [...alasan, ...per.alasan.filter((a) => !a.startsWith('Alias'))];
      // AG4 — size terhitung >0 tapi tidak punya produk anggota → tawarkan
      // "Buat produk otomatis" (nama "<grup> <size>") atau "Abaikan size ini".
      if (size !== null && pasang > 0 && cocok.grup && !v) {
        const pesan = `Size ${size} belum punya produk untuk grup "${cocok.grup.nama}" (${[...cocok.grup.sizeSet].sort((a, b) => Number(a) - Number(b)).join(', ') || 'belum ada size'}).`;
        alasanRow.push(pesan);
        alasanProfil.push(pesan);
        pesanUrai.push({
          teks: `Buat produk otomatis "${cocok.grup.nama} ${size}" atau abaikan size ini.`,
          aksi: 'buat_produk',
          grup: cocok.grup.nama,
          size,
          kategori_id: cocok.grup.kategori_id,
          merek_id: cocok.grup.merek_id,
        });
      }
      if (cocok.kecocokan === 'tidak') alasanRow.push(...cocok.alasan);
      if (profil && sizeRow !== null && profil.sizes.every((s) => s.size.toLowerCase() !== sizeRow.toLowerCase())) {
        const lain = await profilUntukSize(sizeRow, profil);
        const pesanProfil = lain
          ? `Size ${sizeRow} tidak ada di profil ${labelProfil(profil)} (${rentangSize(profil.sizes)}). Barang ini termasuk ${labelProfil(lain)}?`
          : `Size ${sizeRow} tidak ada di profil ${labelProfil(profil)} (${rentangSize(profil.sizes)}) — periksa jumlahnya.`;
        alasanRow.push(pesanProfil);
        alasanProfil.push(pesanProfil);
        if (lain) pesanUrai.push({ teks: pesanProfil, aksi: 'pakai_profil', profil_id: lain.id, profil_nama: labelProfil(lain) });
      }
      baris.push({
        teks: mentah.teks,
        produk_teks: mentah.nama,
        warna: mentah.warna,
        size: sizeRow,
        rentang_size: null,
        qty: pasang,
        // Satuan yang identik dengan pasang (pcs/box) ditampilkan apa adanya;
        // kodi/lusin dikonversi → teks ketikan tetap terbaca lewat `konversi`.
        satuan_teks: pecah ? null : (mentah.satuanTeks ?? null),
        qty_dasar: pasang,
        konversi: mentah.qtyTeks ? `${mentah.qtyTeks} → ${totalPasang} pasang (1 kodi = ${aturanGrup.per_kodi})` : null,
        harga: mentah.harga ?? 0, // harga eksplisit dari teks (@150000 / rp 150.000) menang
        harga_dari_master: false,
        diskon_persen: mentah.diskonPersen,
        diskon: 0, // rupiah dihitung UI setelah harga terisi (persen × qty × harga)
        product_id: v?.id ?? null,
        baris: v ? infoDariAnggota(v) : null,
        unit_id: v?.satuan_dasar_id ?? cocok.grup?.unitId ?? null,
        kecocokan: v ? cocok.kecocokan : 'tidak',
        skor: cocok.skor,
        saran: saranUrut,
        alasan: alasanRow,
        grup: idxGrup,
        kelompok: mentah.teks,
        jumlah_size: ukuran.length,
      });
      dibuat += 1;
    }

    // Baris jumlah tidak terbaca tetap dibuat (bernilai 0) supaya bisa diedit.
    if (dibuat === 0) {
      const size = ukuran[0];
      const per = await cocokkanBarang({
        tokens: qTokens,
        teks: mentah.nama,
        warna: mentah.warna,
        size: size ?? null,
        supplierId: pemasok.supplier_id,
        kandidatSaja: true,
      });
      const v = per.anggota;
      if (v) productIds.push(v.id);
      const sizeRow0 = size ?? (v?.size ? String(v.size).toLowerCase() : null);
      baris.push({
        teks: mentah.teks,
        produk_teks: mentah.nama,
        warna: mentah.warna,
        size: sizeRow0,
        rentang_size: null,
        qty: 0,
        satuan_teks: pecah ? null : (mentah.satuanTeks ?? null),
        qty_dasar: 0,
        konversi: null,
        harga: mentah.harga ?? 0,
        harga_dari_master: false,
        diskon_persen: mentah.diskonPersen,
        diskon: 0,
        product_id: v?.id ?? null,
        baris: v ? infoDariAnggota(v) : null,
        unit_id: v?.satuan_dasar_id ?? cocok.grup?.unitId ?? null,
        kecocokan: v ? per.kecocokan : 'tidak',
        skor: per.skor,
        saran: [...per.saran].sort((a, b) => skorSaran(b, size, mentah.warna) - skorSaran(a, size, mentah.warna)),
        alasan: [...alasan, ...per.alasan.filter((a) => !a.startsWith('Alias'))],
        grup: idxGrup,
        kelompok: mentah.teks,
        jumlah_size: ukuran.length,
      });
      rincian.push({ size: size ?? '-', pasang: 0, kodi: 0, product_id: v?.id ?? null });
      dibuat = 1;
    }

    // Klasifikasi: tanyakan saat ragu, tawarkan saran bila size menunjuk satu profil.
    if (ragu && !saranProfil) {
      const pemilik = ukuranRagu.length ? await daftarProfilYangPunyaSize(ukuranRagu[0]) : [];
      const label = [...new Set(pemilik.map(labelProfil))];
      const pesanRagu = label.length
        ? `Kategori barang belum diklasifikasikan. Pilih profil (size ${ukuranRagu.join(', ')} ada di ${label.join(' dan ')}).`
        : 'Kategori barang belum diklasifikasikan. Pilih profil.';
      alasanProfil.push(pesanRagu);
      pesanUrai.push({ teks: pesanRagu, aksi: 'pilih_profil' });
    } else if (saranProfil) {
      const pesanSaran = `Kategori barang belum diklasifikasikan. Saran: Gunakan profil ${labelProfil(saranProfil)} (dari size yang diketik).`;
      alasanProfil.push(pesanSaran);
      pesanUrai.push({ teks: pesanSaran, aksi: 'pakai_profil', profil_id: saranProfil.id, profil_nama: labelProfil(saranProfil) });
    }

    pratinjau.push({
      grup: idxGrup,
      teks: mentah.teks,
      nama: cocok.grup?.nama ?? mentah.nama ?? mentah.teks,
      warna: mentah.warna,
      grup_barang: cocok.grup?.nama ?? null,
      jumlah_anggota: cocok.grup?.anggota.length ?? 0,
      size_tersedia: cocok.grup
        ? [...cocok.grup.sizeSet].sort((a, b) => {
            const na = Number(a);
            const nb = Number(b);
            return Number.isFinite(na) && Number.isFinite(nb) ? na - nb : String(a).localeCompare(String(b));
          })
        : [],
      profil: profil?.nama ?? null,
      profil_dari: profilDari,
      profil_id: profil?.id ?? null,
      profil_kode: profil?.kode ?? null,
      profil_sizes: profil?.sizes ?? [],
      db: mentah.db,
      tp: mentah.tp,
      komposisi: mentah.kelompok,
      kodi_normal: kodiNormal,
      kodi_komp: kodiKomp,
      pcs: mentah.bebas,
      sisa_per_kodi: sisaPerKodi,
      seimbang: seimbangBaris && Math.abs(sisaPerKodi - aturanGrup.per_kodi) < 0.001,
      ragu: ragu && !saranProfil,
      saran_profil: saranProfil ? { id: saranProfil.id, nama: saranProfil.nama } : null,
      pesan: pesanUrai,
      qty_teks: mentah.qtyTeks || (mentah.adaJumlah ? `${totalPasang} pasang` : 'jumlah belum terbaca'),
      total_pasang: totalPasang,
      total_kodi: Math.round((totalPasang / aturanGrup.per_kodi) * 1000) / 1000,
      rincian,
      kecocokan: cocok.kecocokan,
      skor: cocok.skor,
      saran: [...cocok.saran].sort(
        (_a, b) => skorSaran(b, ukuran.length === 1 ? ukuran[0] : null, mentah.warna) - skorSaran(_a, ukuran.length === 1 ? ukuran[0] : null, mentah.warna),
      ),
      alasan: [...alasan, ...(cocok.kecocokan === 'tidak' ? cocok.alasan : []), ...alasanProfil],
    });
  }

  // 4) harga beli: harga beli terakhir pemasok → harga beli produk → kosong.
  const bekas = await hargaTerakhirSupplier(pemasok.supplier_id, [...new Set(productIds(baris))]);
  for (const b of baris) {
    if (!b.product_id) {
      b.alasan = [...b.alasan, 'Baris belum cocok ke master — pilih saran produk atau buat produk baru.'];
      continue;
    }
    if (b.harga > 0) continue; // harga eksplisit dari teks (@/rp/harga …) dipertahankan
    const terakhir = bekas.get(Number(b.product_id));
    if (terakhir !== undefined && terakhir > 0) {
      b.harga = terakhir;
      b.harga_dari_master = false;
    } else if (b.baris && b.baris.harga_beli > 0) {
      b.harga = b.baris.harga_beli;
      b.harga_dari_master = true;
    } else {
      b.harga = 0;
      b.alasan = [...b.alasan, 'Harga beli kosong — wajib diisi sebelum Simpan Draft (PO).'];
    }
  }

  // 5) verifikasi total & pesan bot.
  const hitung = Math.round((pratinjau.reduce((n, p) => n + p.total_pasang, 0) / aturan.per_kodi) * 1000) / 1000;
  const cek: CekTotalUrai = {
    ada: klaim !== null,
    klaim,
    hitung,
    selisih: klaim === null ? 0 : Math.round((hitung - klaim) * 1000) / 1000,
    ok: klaim === null ? true : Math.abs(hitung - klaim) < 0.01,
  };
  if (!cek.ok) {
    catatan.push(`Total ditulis ${klaim} kodi tetapi hasil hitung ${hitung} kodi (selisih ${cek.selisih}).`);
  }

  const pesan_bot = susunPesanBotBaris(pemasok, tanggal, pratinjau, cek, aturan, catatan);
  return { pemasok, baris, catatan, pesan_bot, gaya: 'baris', tanggal, pratinjau, cek, aturan };
}

function productIds(baris: BarisUrai[]): number[] {
  return baris.map((b) => Number(b.product_id)).filter((n) => Number.isFinite(n) && n > 0);
}

function susunPesanBotBaris(
  pemasok: PemasokUrai,
  tanggal: string | null,
  pratinjau: PratinjauUrai[],
  cek: CekTotalUrai,
  aturan: AturanKodi,
  catatan: string[],
): string {
  const garis: string[] = [];
  if (pemasok.cocok && pemasok.teks) garis.push(`Pemasok: ${pemasok.teks}`);
  else if (pemasok.teks) {
    garis.push(
      `Pemasok "${pemasok.teks}" belum ada di master${pemasok.saran.length ? ` — saran: ${pemasok.saran.map((s) => s.nama).join(', ')}` : ''}.`,
    );
  } else garis.push('Pemasok tidak terbaca — pilih di form.');

  if (tanggal) {
    const [y, m, d] = tanggal.split('-').map(Number);
    const hari = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'][new Date(y, m - 1, d).getDay()];
    garis.push(`Tanggal: ${hari}, ${d} ${BULAN_PANJANG[m]} ${y}`);
  }

  const profilDipakai = [...new Set(pratinjau.map((p) => p.profil).filter((x): x is string => !!x))];
  if (profilDipakai.length > 0) garis.push(`Profil size: ${profilDipakai.join(' · ')}`);

  for (const p of pratinjau) {
    const bersih = p.alasan.length === 0 && p.kecocokan === 'yakin';
    const rincian = p.rincian.map((r) => `${r.size}: ${r.pasang} (${r.kodi} kd)`).join(' · ');
    garis.push(
      `${bersih ? '✔' : '⚠'} ${p.nama}${p.warna ? ` ${p.warna}` : ''} — ${p.qty_teks} = ${p.total_pasang} pasang (${p.total_kodi} kodi)${rincian ? ` · ${rincian}` : ''}${p.skor ? ` · skor ${p.skor}` : ''}`,
    );
    for (const a of p.alasan) garis.push(`   • ${a}`);
  }
  garis.push(`Total hitung: ${cek.hitung} kodi (${cek.hitung * aturan.per_kodi} pasang).`);
  if (cek.ada) {
    garis.push(
      cek.ok
        ? `✔ Cocok dengan baris "Total = ${cek.klaim} kd".`
        : `⚠ Baris "Total = ${cek.klaim} kd" tidak cocok (selisih ${cek.selisih} kodi) — periksa sebelum simpan.`,
    );
  }
  for (const c of catatan) garis.push(`• ${c}`);
  if (pratinjau.length > 0 && !pratinjau.some((p) => p.alasan.length || p.kecocokan !== 'yakin')) {
    garis.push('Semua baris terbaca bersih — tinjau pratinjau lalu Simpan Draft (PO).');
  } else if (pratinjau.length > 0) {
    garis.push('Baris bertanda ⚠ perlu ditinjau (pilih saran / buat produk baru / isi harga) sebelum disimpan.');
  }
  return garis.join('\n');
}

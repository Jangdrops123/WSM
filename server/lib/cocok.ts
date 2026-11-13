// BAGIAN AG3/AG4/AG5 — Pencocokan barang lokal mode Chatbot (tanpa API/LLM).
//
// - Indeks GRUP BARANG (AG4): produk dikelompokkan ke nama dasar tanpa token
//   size di akhir (angka 20-50 / huruf ukuran) yang berbagi kategori & merek.
//   Indeks dibangun dari Master Data dan diperbarui otomatis (jejak perubahan
//   dipantau tiap pemakaian — perubahan langsung terbaca).
// - Skoring 0-100 (AG5): token persis, awalan token, kemiripan ejaan
//   (Levenshtein ≤1 untuk kata pendek, ≤2 untuk kata ≥6 huruf, atau trigra
//   ≥0,6), bonus warna cocok, alias terkonfirmasi = 100, penalti token penting
//   yang tidak ada, bonus kecil untuk barang yang pernah dibeli dari pemasok
//   yang sama. Keputusan memakai ambang yang bisa diatur (Pengaturan).
// - Alias Barang (AG3): teks ternormalisasi → produk/grup (opsional per
//   pemasok) — dipelajari dari koreksi manual dan dipakai pesan berikutnya.
// - Operator Db/Tp (AG3): kata kunci + pengali dari tabel operator_komposisi.
// - Log (AG3): setiap pencocokan & koreksi dicatat (teks, hasil, skor, pengguna).
import { all, get, getSettings, run } from '../db.pg.ts';

// --- Kamus warna (dipakai parser & skoring) ---------------------------------

/** Alias warna → bentuk baku (navy → biru, cokelat → coklat, …). */
export const WARNA: Record<string, string> = {
  hitam: 'hitam', black: 'hitam', blk: 'hitam',
  putih: 'putih', white: 'putih', wht: 'putih',
  merah: 'merah', red: 'merah',
  biru: 'biru', blue: 'biru', navy: 'biru',
  hijau: 'hijau', green: 'hijau',
  kuning: 'kuning', yellow: 'kuning',
  coklat: 'coklat', cokelat: 'coklat', brown: 'coklat',
  abu: 'abu', 'abu-abu': 'abu', grey: 'abu', gray: 'abu',
  pink: 'pink',
  cream: 'cream', krem: 'cream',
  mocca: 'mocca', mocha: 'mocca',
  ungu: 'ungu', purple: 'ungu',
  oranye: 'oranye', orange: 'oranye',
  emas: 'emas', gold: 'emas',
  perak: 'perak', silver: 'perak',
  maroon: 'maroon', nude: 'nude', tosca: 'tosca',
};

export const KUNCI_WARNA = Object.keys(WARNA).sort((a, b) => b.length - a.length);

/** Huruf ukuran yang dikenal (dianggap token size di akhir nama). */
export const SIZE_HURUF = ['xxxxl', 'xxxl', 'xxl', '3xl', '2xl', 'xl', 's', 'm', 'l'];

// --- Normalisasi -------------------------------------------------------------

/** Huruf kecil, pisahkan huruf-angka, hapus tanda baca, ratakan spasi. */
export function normalisasi(teks: string): string {
  return String(teks ?? '')
    .toLowerCase()
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Token normalisasi (tanpa stopword — stopword di sisi parser). */
export function tokenNormal(teks: string): string[] {
  return normalisasi(teks).split(' ').filter(Boolean);
}

// --- Kemiripan ejaan ---------------------------------------------------------

/** Levenshtein dengan batas (berhenti lebih awal bila melebihi `batas`). */
export function levBerbatas(a: string, b: string, batas: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > batas) return batas + 1;
  const n = a.length;
  const m = b.length;
  let prev = new Array<number>(m + 1);
  let cur = new Array<number>(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    let best = cur[0];
    for (let j = 1; j <= m; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < best) best = cur[j];
    }
    if (best > batas) return batas + 1;
    const t = prev;
    prev = cur;
    cur = t;
  }
  return prev[m];
}

/** Batas Levenshtein AG5: ≤1 untuk kata pendek, ≤2 untuk kata ≥6 huruf. */
export function batasLev(kata: string): number {
  return kata.length >= 6 ? 2 : 1;
}

/** Trigram sederhana (dengan bantal sisi) untuk kemiripan kata panjang. */
export function trigram(kata: string): Set<string> {
  const s = ` ${kata} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
  return out;
}

/** Skor kemiripan dua kata → 0..1 (0 = tak mirip). */
function kemiripan(a: string, b: string): number {
  if (a === b) return 1;
  const beda = Math.abs(a.length - b.length);
  const batas = batasLev(a);
  if (beda <= batas) {
    const d = levBerbatas(a, b, batas);
    if (d <= batas) return d === 0 ? 1 : d === 1 ? (a.length >= 6 ? 0.85 : 0.75) : 0.7;
  }
  if (a.length >= 4 && b.length >= 4) {
    const ta = trigram(a);
    const tb = trigram(b);
    let sama = 0;
    for (const t of ta) if (tb.has(t)) sama++;
    const gabung = ta.size + tb.size - sama;
    const rasio = gabung ? sama / gabung : 0;
    if (rasio >= 0.6) return 0.6;
  }
  return 0;
}

// --- Ambang kecocokan (Pengaturan ▸ Ambang Kecocokan) -----------------------

export interface AmbangCocok {
  /** ≥ ambang ini + selisih ≥ selisih → diterima otomatis (hijau). */
  yakin: number;
  /** Selisih skor peringkat 1 vs 2 yang diminta untuk keputusan yakin. */
  selisih: number;
  /** Di bawah ini → tidak ditemukan (merah). 60-84 = tampilkan kandidat. */
  kabur: number;
}

export const AMBANG_BAWAAN: AmbangCocok = { yakin: 85, selisih: 10, kabur: 60 };

export async function muatAmbang(): Promise<AmbangCocok> {
  const s = await getSettings();
  const angka = (v: string | undefined, b: number, min: number, max: number): number => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : b;
  };
  return {
    yakin: angka(s['cocok_ambang_yakin'], AMBANG_BAWAAN.yakin, 50, 100),
    selisih: angka(s['cocok_ambang_selisih'], AMBANG_BAWAAN.selisih, 0, 50),
    kabur: angka(s['cocok_ambang_kabur'], AMBANG_BAWAAN.kabur, 10, 99),
  };
}

// --- Operator komposisi Db/Tp (AG3) -----------------------------------------

export interface OperatorKomposisi {
  id: number;
  label: string;
  pengali: number;
  kata_kunci: string[];
  aktif: boolean;
}

export async function daftarOperator(): Promise<OperatorKomposisi[]> {
  return await (await all<{
    id: number;
    label: string;
    pengali: number;
    kata_kunci: string;
    aktif: number;
  }>(`SELECT id, label, pengali, kata_kunci, aktif FROM operator_komposisi ORDER BY id`)).map((r) => {
    let kata: string[] = [];
    try {
      const j = JSON.parse(r.kata_kunci || '[]');
      if (Array.isArray(j)) kata = j.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    } catch {
      /* JSON rusak → tanpa kata kunci */
    }
    return {
      id: Number(r.id),
      label: r.label,
      pengali: Number(r.pengali),
      kata_kunci: kata.map((k) => k.trim().toLowerCase()),
      aktif: r.aktif === 1,
    };
  });
}

/** Pasangan komposisi aktif: operator pengali (Db) + operator nol (Tp). */
export async  function pasanganKomposisi(): Promise<{ db: OperatorKomposisi; tp: OperatorKomposisi | null }[]> {
  const op = (await daftarOperator()).filter((o) => o.aktif && o.kata_kunci.length > 0);
  const nol = op.filter((o) => o.pengali === 0);
  const isi = op.filter((o) => o.pengali !== 0);
  return isi.map((db) => ({ db, tp: nol[0] ?? null }));
}

// --- Indeks grup barang (AG4) ------------------------------------------------

export interface AnggotaGrup {
  id: number;
  sku: string;
  nama: string;
  size: string | null;
  warna: string | null;
  harga_beli: number;
  satuan_dasar_id: number | null;
  profil_id: number | null;
}

export interface GrupBarang {
  kunci: string;
  /** Nama dasar tanpa token size di akhir ("Ab Biru"). */
  nama: string;
  tokens: string[];
  warna: string | null;
  kategori_id: number | null;
  merek_id: number | null;
  sizeSet: Set<string>;
  anggota: AnggotaGrup[];
  unitId: number | null;
  /** Trigram per token (untuk skor trigra). */
  tri: Map<string, Set<string>>;
}

export interface IndeksBarang {
  grup: GrupBarang[];
  jejak: string;
}

/** Token size di AKHIR nama ("Ab Biru 39" → "Ab Biru"). */
export function dasarNama(nama: string): { dasar: string; size: string | null } {
  const kata = normalisasi(nama).split(' ').filter(Boolean);
  let size: string | null = null;
  while (kata.length > 1) {
    const t = kata[kata.length - 1];
    const angka2 = /^\d{2}$/.test(t) && Number(t) >= 20 && Number(t) <= 50;
    const huruf = SIZE_HURUF.includes(t);
    if (!angka2 && !huruf) break;
    size = size ?? t;
    kata.pop();
  }
  return { dasar: kata.join(' '), size };
}

/** Jejak perubahan Master Data — indeks dibangun ulang otomatis saat berubah. */
async function jejakIndeks(): Promise<string> {
  const hit = async (sql: string): Promise<string> => {
    const r = await get<Record<string, unknown>>(sql);
    return r ? Object.values(r).map((v) => String(v ?? '')).join('|') : '';
  };
  return [
    await hit(`SELECT COUNT(*) n, COALESCE(MAX(id),0) mx FROM products WHERE deleted_at IS NULL`),
    await hit(`SELECT COUNT(*) n, COALESCE(MAX(id),0) mx FROM products`),
    await hit(`SELECT COUNT(*) n, COALESCE(MAX(id),0) mx FROM categories`),
    await hit(`SELECT COUNT(*) n, COALESCE(MAX(id),0) mx FROM brands`),
    await hit(`SELECT COUNT(*) n, COALESCE(MAX(id),0) mx FROM alias_barang`),
  ].join('#');
}

let cacheIndeks: IndeksBarang | null = null;
let cacheJejak = '';

/**
 * Buang cache indeks pencocokan & riwayat pembelian. Dipanggil setelah Reset
 * Data (transaksi/master/total) agar permintaan berikutnya membaca ulang data
 * pasca-reset, bukan indeks lama di memori.
 */
export function kosongkanIndeksCocok(): void {
  cacheIndeks = null;
  cacheJejak = '';
  cacheBeli.clear();
  cacheBeliJejak = '';
}

/** Ambil indeks grup (dibangun ulang bila Master Data berubah). */
export async function indeksBarang(): Promise<IndeksBarang> {
  const jejak = await jejakIndeks();
  if (cacheIndeks && cacheJejak === jejak) return cacheIndeks;

  const rows = await all<{
    id: number;
    sku: string;
    nama: string;
    harga_beli: number;
    satuan_dasar_id: number | null;
    category_id: number | null;
    brand_id: number | null;
    size_profile_id: number | null;
    kategori: string | null;
    merek: string | null;
  }>(
    `SELECT p.id, p.sku, p.nama, p.harga_beli, p.satuan_dasar_id,
            p.category_id, p.brand_id, p.size_profile_id,
            c.nama AS kategori, b.nama AS merek
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN brands b ON b.id = p.brand_id
      WHERE p.deleted_at IS NULL AND p.aktif = TRUE
      ORDER BY p.id`,
  );

  const peta = new Map<string, GrupBarang>();
  for (const r of rows) {
    const { dasar, size: sizeNama } = dasarNama(r.nama);
    const kataDasar = dasar.split(' ').filter(Boolean);
    if (kataDasar.length === 0) continue;
    const kunci = `${dasar.toLowerCase()}|${r.category_id ?? ''}|${r.brand_id ?? ''}`;
    // Size & warna dari seluruh token nama (angka 25-65 / huruf ukuran / warna).
    let size = sizeNama;
    let warna: string | null = null;
    for (const t of normalisasi(r.nama).split(' ')) {
      if (!size && /^\d{2}$/.test(t) && Number(t) >= 25 && Number(t) <= 65) size = t;
      if (!size && SIZE_HURUF.includes(t)) size = t;
      if (warna === null && t in WARNA) warna = WARNA[t];
    }
    let g = peta.get(kunci);
    if (!g) {
      const tokens = kataDasar.filter((t) => !(t in WARNA));
      const tokensKategori = r.kategori ? normalisasi(r.kategori).split(' ').filter((t) => !(t in WARNA)) : [];
      const tokensMerek = r.merek ? normalisasi(r.merek).split(' ').filter((t) => !(t in WARNA)) : [];
      const semuaToken = [...new Set([...tokens, ...tokensKategori, ...tokensMerek])];
      g = {
        kunci,
        nama: dasar,
        tokens: semuaToken,
        warna: warna ?? (r.kategori ? null : null),
        kategori_id: r.category_id,
        merek_id: r.brand_id,
        sizeSet: new Set<string>(),
        anggota: [],
        unitId: r.satuan_dasar_id ?? null,
        tri: new Map(semuaToken.map((t) => [t, trigram(t)])),
      };
      peta.set(kunci, g);
    }
    if (warna && !g.warna) g.warna = warna;
    if (size) g.sizeSet.add(size);
    g.anggota.push({
      id: Number(r.id),
      sku: r.sku,
      nama: r.nama,
      size,
      warna,
      harga_beli: Number(r.harga_beli ?? 0),
      satuan_dasar_id: r.satuan_dasar_id ?? null,
      profil_id: r.size_profile_id === null ? null : Number(r.size_profile_id),
    });
  }

  const grup = [...peta.values()];
  for (const g of grup) {
    g.anggota.sort((a, b) => {
      const na = a.size && /^\d+$/.test(a.size) ? Number(a.size) : Number.NaN;
      const nb = b.size && /^\d+$/.test(b.size) ? Number(b.size) : Number.NaN;
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return String(a.size ?? '').localeCompare(String(b.size ?? ''));
    });
  }
  cacheIndeks = { grup, jejak };
  cacheJejak = jejak;
  return cacheIndeks;
}

// --- Alias barang (AG3) ------------------------------------------------------

/** Kunci alias = teks ternormalisasi (huruf kecil, tanpa tanda baca, spasi rapat). */
export function kunciAlias(teks: string): string {
  return normalisasi(teks);
}

export interface BarisAlias {
  id: number;
  teks: string;
  product_id: number | null;
  grup: string | null;
  supplier_id: number | null;
  pakai: number;
  terakhir_pakai: string;
  produk_nama: string | null;
  pemasok_nama: string | null;
}

export async function daftarAlias(cari?: string): Promise<BarisAlias[]> {
  const like = cari ? `%${cari.toLowerCase()}%` : null;
  return await (await all<BarisAlias>(
    `SELECT a.id, a.teks, a.product_id, a.grup, a.supplier_id, a.pakai, a.terakhir_pakai,
            p.nama AS produk_nama, s.nama AS pemasok_nama
       FROM alias_barang a
       LEFT JOIN products p ON p.id = a.product_id
       LEFT JOIN suppliers s ON s.id = a.supplier_id
      ${like ? 'WHERE LOWER(a.teks) ILIKE ? OR LOWER(COALESCE(p.nama,\'\')) ILIKE ?' : ''}
      ORDER BY a.terakhir_pakai DESC, a.id DESC
      LIMIT 500`,
    ...(like ? [like, like] : []),
  )).map((r) => ({ ...r, id: Number(r.id) }));
}

/** Cari alias untuk teks → baris alias aktif (scope pemasok dulu, lalu global). */
export async function cariAlias(teks: string, supplierId: number | null): Promise<BarisAlias | null> {
  const kunci = kunciAlias(teks);
  if (!kunci) return null;
  const rows = await all<BarisAlias>(
    `SELECT a.id, a.teks, a.product_id, a.grup, a.supplier_id, a.pakai, a.terakhir_pakai,
            p.nama AS produk_nama, s.nama AS pemasok_nama
       FROM alias_barang a
       LEFT JOIN products p ON p.id = a.product_id
       LEFT JOIN suppliers s ON s.id = a.supplier_id
      WHERE a.teks = ? AND (a.supplier_id IS NULL OR a.supplier_id = ?) AND a.product_id IS NOT NULL
      ORDER BY CASE WHEN a.supplier_id = ? THEN 0 ELSE 1 END, a.pakai DESC, a.id DESC
      LIMIT 1`,
    kunci,
    supplierId ?? -1,
    supplierId ?? -1,
  );
  const r = rows[0];
  return r ? { ...r, id: Number(r.id) } : null;
}

/** Simpan/memperbarui alias dari koreksi manual (belajar dari koreksi). */
export async function simpanAlias(ops: {
  teks: string;
  product_id?: number | null;
  grup?: string | null;
  supplier_id?: number | null;
}): Promise<BarisAlias | null> {
  const kunci = kunciAlias(ops.teks);
  if (!kunci) return null;
  if (!ops.product_id && !ops.grup) return null;
  const ada = await get<{ id: number }>(
    `SELECT id FROM alias_barang WHERE teks = ? AND ${ops.supplier_id ? 'COALESCE(supplier_id,-1) = ?' : 'supplier_id IS NULL'}`,
    ...(ops.supplier_id ? [kunci, ops.supplier_id] : [kunci]),
  );
  if (ada) {
    await run(
      `UPDATE alias_barang SET product_id = ?, grup = ?, pakai = pakai + 1,
              terakhir_pakai = now() WHERE id = ?`,
      ops.product_id ?? null,
      ops.grup ?? null,
      Number(ada.id),
    );
  } else {
    await run(
      `INSERT INTO alias_barang (teks, product_id, grup, supplier_id) VALUES (?, ?, ?, ?)`,
      kunci,
      ops.product_id ?? null,
      ops.grup ?? null,
      ops.supplier_id ?? null,
    );
  }
  const r = (await daftarAlias()).find((a) => a.teks === kunci && (a.supplier_id ?? null) === (ops.supplier_id ?? null));
  return r ?? null;
}

export async function hapusAlias(id: number): Promise<boolean> {
  return await ((await run(`DELETE FROM alias_barang WHERE id = ?`, id))).changes > 0;
}

// --- Log pencocokan (AG3) ----------------------------------------------------

export async function catatCocok(ops: {
  tipe?: 'produk' | 'pemasok';
  teks: string;
  hasil: string;
  skor: number;
  product_id?: number | null;
  supplier_id?: number | null;
  pengguna_id?: number | null;
  detail?: unknown;
}): Promise<void> {
  await run(
    `INSERT INTO chat_match_logs (tipe, teks, hasil, skor, product_id, supplier_id, pengguna_id, detail_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ops.tipe ?? 'produk',
    String(ops.teks).slice(0, 500),
    ops.hasil,
    Math.round(ops.skor),
    ops.product_id ?? null,
    ops.supplier_id ?? null,
    ops.pengguna_id ?? null,
    ops.detail === undefined ? null : JSON.stringify(ops.detail).slice(0, 4000),
  );
}

// --- Bonus riwayat pembelian per pemasok ------------------------------------

const cacheBeli = new Map<string, Set<number>>();
let cacheBeliJejak = '';

async function pernahBeli(supplierId: number | null): Promise<Set<number>> {
  if (!supplierId) return new Set();
  const jejak = await jejakIndeks();
  if (cacheBeliJejak !== jejak) {
    cacheBeli.clear();
    cacheBeliJejak = jejak;
  }
  const kunci = String(supplierId);
  const ada = cacheBeli.get(kunci);
  if (ada) return ada;
  const rows = await all<{ product_id: number }>(
    `SELECT DISTINCT pi.product_id
       FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
      WHERE p.supplier_id = ? AND p.status <> 'batal'`,
    supplierId,
  );
  const set = new Set(rows.map((r) => Number(r.product_id)));
  cacheBeli.set(kunci, set);
  return set;
}

// --- Skor satu kandidat ------------------------------------------------------

/** Skor 0-100 sebuah grup terhadap token query + warna. */
async function skorGrup(g: GrupBarang, q: string[], warna: string | null, supplierId: number | null): Promise<number> {
  if (q.length === 0 && !warna) return 0;
  let total = 0;
  for (const qt of q) {
    let best = 0;
    const triQt = qt.length >= 4 ? trigram(qt) : null;
    for (const t of g.tokens) {
      if (t === qt) {
        best = 1;
        break;
      }
      if (t.length >= 3 && qt.length >= 3 && (t.startsWith(qt) || qt.startsWith(t))) {
        if (best < 0.85) best = 0.85;
        continue;
      }
      const k = kemiripan(qt, t);
      if (k > best) best = k;
      if (best < 0.6 && triQt && g.tri.has(t)) {
        const tb = g.tri.get(t)!;
        let sama = 0;
        for (const x of triQt) if (tb.has(x)) sama++;
        const gabung = triQt.size + tb.size - sama;
        const rasio = gabung ? sama / gabung : 0;
        if (rasio >= 0.6 && best < 0.6) best = 0.6;
      }
    }
    total += best;
  }
  let nilai = q.length ? (100 * total) / q.length : 0;
  // Bonus/penalti warna cocok.
  if (warna) {
    if (g.warna === warna) nilai += 5;
    else if (g.warna) nilai -= 10;
  }
  // Bonus kecil: barang ini pernah dibeli dari pemasok yang sama.
  if (supplierId && (await pernahBeli(supplierId)).size) {
    for (const a of g.anggota) {
      if ((await pernahBeli(supplierId)).has(a.id)) { nilai += 3; break; }
    }
  }
  return Math.max(0, Math.min(100, Math.round(nilai * 10) / 10));
}

// --- Pencocokan utama --------------------------------------------------------

export interface KandidatCocok {
  grup: GrupBarang;
  skor: number;
}

/** Saran kandidat berbentuk produk (dipakai tombol pilih di pratinjau). */
export interface InfoBarang {
  id: number;
  sku: string;
  produk: string;
  size: string | null;
  warna: string | null;
  harga_beli: number;
  satuan_dasar_id: number | null;
}

export interface HasilCocokBarang {
  kecocokan: 'yakin' | 'kabur' | 'tidak';
  skor: number;
  skor2: number;
  grup: GrupBarang | null;
  /** Anggota grup untuk size yang diminta (null bila size tidak punya produk). */
  anggota: AnggotaGrup | null;
  kandidat: KandidatCocok[];
  /** Saran produk dari kandidat (maksimal 6, anggota kandidat teratas dulu). */
  saran: InfoBarang[];
  /** Alias terkonfirmasi (skor 100) yang dipakai. */
  alias: BarisAlias | null;
  alasan: string[];
}

function infoBarang(a: AnggotaGrup): InfoBarang {
  return {
    id: a.id,
    sku: a.sku,
    produk: a.nama,
    size: a.size,
    warna: a.warna,
    harga_beli: a.harga_beli,
    satuan_dasar_id: a.satuan_dasar_id,
  };
}

/** Kumpulkan saran produk dari daftar kandidat (maksimal 6). */
function saranDari(kandidat: KandidatCocok[]): InfoBarang[] {
  const out: InfoBarang[] = [];
  const lihat = new Set<number>();
  for (const k of kandidat) {
    for (const a of k.grup.anggota) {
      if (lihat.has(a.id)) continue;
      lihat.add(a.id);
      out.push(infoBarang(a));
      if (out.length >= 6) return out;
    }
  }
  return out;
}

/**
 * Cocokkan teks barang ke Master Data (AG5).
 * Keputusan: ≥85 & selisih ≥10 → yakin; 60-84 / selisih kecil → kabur (3
 * kandidat); <60 → tidak. Deterministik — tidak menebak bila ragu.
 */
export async  function cocokkanBarang(ops: {
  teks: string;
  warna?: string | null;
  size?: string | null;
  supplierId?: number | null;
  /** Token query sudah dinormalisasi parser (opsional). */
  tokens?: string[];
  /** Pencocokan tahap akhir: hanya tampilkan kandidat (tanpa keputusan ulang). */
  kandidatSaja?: boolean;
}): Promise<HasilCocokBarang> {
  const ambang = await muatAmbang();
  const { grup } = await indeksBarang();
  const q = (ops.tokens ?? tokenNormal(ops.teks)).filter((t) => t.length > 0);
  const warna = ops.warna ?? null;
  const size = ops.size ? String(ops.size).toLowerCase() : null;
  const alasan: string[] = [];

  // Alias terkonfirmasi → skor 100 (pemasok yang sama didahulukan).
  // Kunci alias = nama barang + warna (normalisasi), sama seperti saat belajar.
  const aliasTeks = kunciAlias([...q, ...(warna ? [warna] : [])].join(' '));
  const alias = await cariAlias(aliasTeks, ops.supplierId ?? null);
  if (alias && alias.product_id) {
    const g = grup.find((x) => x.anggota.some((a) => a.id === Number(alias.product_id))) ?? null;
    if (g) {
      const anggota = g.anggota.find((a) => a.id === Number(alias.product_id)) ?? null;
      const warnaCocok = !warna || !anggota?.warna || anggota.warna === warna;
      if (warnaCocok && (!size || (anggota && anggota.size === size) || g.sizeSet.has(size))) {
        alasan.push(`Alias terkonfirmasi: "${alias.teks}" → ${alias.produk_nama ?? anggota?.nama ?? ''}.`);
        const kand = [{ grup: g, skor: 100 }];
        return {
          kecocokan: 'yakin',
          skor: 100,
          skor2: 0,
          grup: g,
          anggota: size ? (g.anggota.find((a) => a.size === size) ?? null) : anggota,
          kandidat: kand,
          saran: saranDari(kand),
          alias,
          alasan,
        };
      }
    }
  }

  // Skor semua grup → urut deterministik (skor desc, lalu nama).
  const dinilai: KandidatCocok[] = [];
  for (const g of grup) {
    const s = await skorGrup(g, q, warna, ops.supplierId ?? null);
    if (s > 0) dinilai.push({ grup: g, skor: s });
  }
  dinilai.sort((a, b) => b.skor - a.skor || a.grup.nama.localeCompare(b.grup.nama) || a.grup.kunci.localeCompare(b.grup.kunci));
  // Seri skor penuh → menangkan katalog yang NAMANYA persis sama dengan teks
  // ketikan ("rulfine mocca" vs katalog "Rulfine Mocca 37…"): pilihan
  // deterministik, tidak tergantung urutan id kategori pada kunci grup (AF7).
  // Nama teks dirakit dari sisa nama + warna yang dipisah parser (warna ikut
  // dibandingkan karena mengubah nama menjadi hanya "rulfine").
  if (dinilai.length > 1 && dinilai[0].skor === dinilai[1].skor) {
    const qNorm = normalisasi([ops.teks, warna ?? ''].join(' ').trim());
    const idx = dinilai.findIndex((d) => d.grup.anggota.some((a) => normalisasi(a.nama) === qNorm));
    if (idx > 0) dinilai.unshift(...dinilai.splice(idx, 1));
  }

  const pertama = dinilai[0] ?? null;
  const kedua = dinilai[1] ?? null;
  const skor = pertama?.skor ?? 0;
  const skor2 = kedua?.skor ?? 0;
  const kandidat = dinilai.slice(0, 3);

  // Anggota untuk size yang diminta.
  const anggota =
    pertama && size
      ? pertama.grup.anggota.find((a) => (a.size ?? '').toLowerCase() === size) ?? null
      : pertama
        ? pertama.grup.anggota.length === 1
          ? pertama.grup.anggota[0]
          : null
        : null;

  if (q.length === 0 && !warna) {
    return { kecocokan: 'tidak', skor: 0, skor2: 0, grup: null, anggota: null, kandidat: [], saran: [], alias: null, alasan: ['Produk tidak disebut dalam teks — pilih produk manual.'] };
  }

  let kecocokan: 'yakin' | 'kabur' | 'tidak';
  if (skor >= ambang.yakin && skor - skor2 >= ambang.selisih) {
    kecocokan = 'yakin';
  } else if (skor >= ambang.kabur) {
    kecocokan = 'kabur';
    if (skor >= ambang.yakin && skor - skor2 < ambang.selisih) {
      alasan.push(`Skor ${skor} tetapi selisih dengan peringkat 2 hanya ${Math.round((skor - skor2) * 10) / 10} — pilih salah satu kandidat.`);
    } else {
      alasan.push(`Cocok sebagian (skor ${skor}) — pilih salah satu kandidat.`);
    }
  } else {
    kecocokan = 'tidak';
    alasan.push(
      pertama
        ? `Produk "${q.join(' ')}" tidak ditemukan (skor terbaik ${skor} < ${ambang.kabur}) — cari manual atau buat produk baru.`
        : `Produk "${q.join(' ')}" tidak ditemukan di Master Data — cari manual atau buat produk baru.`,
    );
  }

  // Size diminta tapi tidak ada anggota → penanda khusus (AG4).
  if (size && pertama && kecocokan !== 'tidak' && !anggota) {
    if (!pertama.grup.sizeSet.has(size)) {
      alasan.push(`Size ${size} tidak ada di grup "${pertama.grup.nama}" (size tersedia: ${[...pertama.grup.sizeSet].sort((a, b) => Number(a) - Number(b)).join(', ') || '—'}).`);
    } else {
      alasan.push(`Produk size ${size} belum terdaftar untuk grup "${pertama.grup.nama}".`);
    }
  }

  return {
    kecocokan,
    skor,
    skor2,
    grup: pertama?.grup ?? null,
    anggota,
    kandidat,
    saran: saranDari(kandidat),
    alias,
    alasan,
  };
}

// --- Pencocokan pemasok (AG5) ------------------------------------------------

export interface HasilCocokPemasok {
  teks: string | null;
  supplier_id: number | null;
  cocok: boolean;
  skor: number;
  saran: { id: number; nama: string; skor: number }[];
}

/** Pemasok dicocokkan dengan metode skor yang sama; di bawah ambang → saran. */
export async function cocokkanPemasok(teks: string | null | undefined): Promise<HasilCocokPemasok> {
  const t = String(teks ?? '').trim();
  if (!t) return { teks: null, supplier_id: null, cocok: false, skor: 0, saran: [] };
  const ambang = await muatAmbang();
  const q = tokenNormal(t).filter((x) => x.length >= 2);
  const suppliers = await all<{ id: number; nama: string }>(`SELECT id, nama FROM suppliers ORDER BY nama`);
  const dinilai = suppliers
    .map((s) => {
      const target = tokenNormal(s.nama);
      let total = 0;
      for (const qt of q) {
        let best = 0;
        for (const tt of target) {
          if (tt === qt) {
            best = 1;
            break;
          }
          if (tt.startsWith(qt) || qt.startsWith(tt)) {
            if (best < 0.85) best = 0.85;
            continue;
          }
          const k = kemiripan(qt, tt);
          if (k > best) best = k;
        }
        total += best;
      }
      let nilai = q.length ? (100 * total) / q.length : 0;
      // Pemasok mengandung seluruh kata query (atau sebaliknya) → hampir pasti.
      const teksLower = t.toLowerCase();
      if (s.nama.toLowerCase() === teksLower) nilai = 100;
      else if (s.nama.toLowerCase().includes(teksLower) || teksLower.includes(s.nama.toLowerCase())) nilai = Math.max(nilai, 90);
      return { id: Number(s.id), nama: s.nama, skor: Math.max(0, Math.min(100, Math.round(nilai * 10) / 10)) };
    })
    .sort((a, b) => b.skor - a.skor || a.nama.localeCompare(b.nama));

  const p = dinilai[0] ?? null;
  const p2 = dinilai[1] ?? null;
  const cocok = !!p && p.skor >= ambang.yakin && p.skor - (p2?.skor ?? 0) >= ambang.selisih;
  return {
    teks: t,
    supplier_id: cocok ? p!.id : null,
    cocok,
    skor: p?.skor ?? 0,
    // Saran pemasok: kandidat yang mendekati — bukan hanya ambang "kabur" (60),
    // tapi juga yang berbagi kata persis dengan yang diketik (skor ≥50),
    // supaya pemasok mirip (mis. "Supplier A" untuk "Supplier Zzz") tetap
    // ditawarkan untuk dipilih manual.
    saran: cocok ? [] : dinilai.filter((x) => x.skor >= Math.min(ambang.kabur, 50)).slice(0, 6),
  };
}

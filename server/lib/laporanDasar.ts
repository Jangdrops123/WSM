import { get } from '../db.pg.ts';

// BAGIAN N — dasar modul laporan:
// parsing filter global (N2), periode dalam zona waktu toko (WIB, UTC+7),
// batas waktu dinormalisasi agar aman dibandingkan dengan kolom bertimestamp
// campuran format (…Z maupun "… …"), dan cache hasil agregat (N6).

/** Batas waktu mengikuti pengaturan toko (offset zona aktif; bawaan WIB = UTC+7). */
export const WIB_MS = 7 * 3600 * 1000;

export type KodePeriode =
  | 'hari-ini'
  | 'kemarin'
  | '7-hari'
  | 'bulan-ini'
  | 'bulan-lalu'
  | 'tahun-ini'
  | 'kustom';

export interface FilterLaporan {
  /** YYYY-MM-DD (WIB) — hari pertama rentang. */
  dari: string;
  /** YYYY-MM-DD (WIB) — hari terakhir rentang. */
  sampai: string;
  /** Batas UTC siap pakai di SQL: kolom BETWEEN ?::timestamptz AND ?::timestamptz. */
  batasAwal: string;
  batasAkhir: string;
  /** Periode pembanding (rentang sama panjang, tepat sebelum `dari`). */
  bandingDari: string;
  bandingSampai: string;
  bandingAwal: string;
  bandingAkhir: string;
  bandingkan: boolean;
  gudang: number;
  /** Zona IANA aktif (diisi handler dari regional; bawaan Asia/Jakarta). */
  zona?: string;
  /**
   * ISOLASI GUDANG — id gudang yang boleh dilihat sesi (diisi handler dari
   * req.konteks): null/undefined = semua (Admin); [] = tanpa akses.
   * Dipakai bila filter gudang eksplisit kosong ("Semua gudang").
   */
  lingkup?: number[] | null;
  kasir: number;
  pelanggan: number;
  pemasok: number;
  kategori: number;
  merek: number;
  produk: number;
  metode: string;
  status: string;
}

/** Tanggal hari ini menurut kalender zona toko (offset dinamis, bawaan WIB). */
export function hariIniWIB(offsetHari = 0, now = Date.now(), offsetMs = WIB_MS): string {
  return new Date(now + offsetMs + offsetHari * 86_400_000).toISOString().slice(0, 10);
}

function awalBulan(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function akhirBulan(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  const berikut = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1));
  return new Date(berikut.getTime() - 86_400_000).toISOString().slice(0, 10);
}

function tambahHari(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Rentang [dari, sampai] sebuah periode preset (kalender zona toko). */
export function rentangPeriode(kode: KodePeriode, customDari?: string, customSampai?: string, offsetMs = WIB_MS): { dari: string; sampai: string } {
  const hari = hariIniWIB(0, Date.now(), offsetMs);
  switch (kode) {
    case 'kemarin': {
      const k = hariIniWIB(-1, Date.now(), offsetMs);
      return { dari: k, sampai: k };
    }
    case '7-hari':
      return { dari: tambahHari(hari, -6), sampai: hari };
    case 'bulan-ini':
      return { dari: awalBulan(hari), sampai: hari };
    case 'bulan-lalu': {
      const bulanLalu = new Date(Date.parse(`${awalBulan(hari)}T00:00:00Z`) - 86_400_000)
        .toISOString()
        .slice(0, 7);
      return { dari: `${bulanLalu}-01`, sampai: akhirBulan(`${bulanLalu}-01`) };
    }
    case 'tahun-ini':
      return { dari: `${hari.slice(0, 4)}-01-01`, sampai: hari };
    case 'kustom':
      return {
        dari: /^\d{4}-\d{2}-\d{2}$/.test(customDari ?? '') ? (customDari as string) : tambahHari(hari, -6),
        sampai: /^\d{4}-\d{2}-\d{2}$/.test(customSampai ?? '') ? (customSampai as string) : hari,
      };
    case 'hari-ini':
    default:
      return { dari: hari, sampai: hari };
  }
}

/**
 * Batas UTC dari tanggal zona toko (awal hari 00:00:00 / akhir 23:59:59).
 * Offset dinamis dari regional aktif — transaksi malam hari tidak tergeser
 * ke hari berikutnya saat zona = WITA/WIT (atau sebaliknya).
 */
function batasUTC(tanggalZona: string, ujung: 'awal' | 'akhir', offsetMs = WIB_MS): string {
  const jam = offsetMs / 3600_000;
  const bulat = Math.round(jam * 100) / 100;
  const tanda = bulat >= 0 ? '+' : '-';
  const abs = Math.abs(bulat);
  const hh = String(Math.floor(abs)).padStart(2, '0');
  const mm = String(Math.round((abs - Math.floor(abs)) * 60)).padStart(2, '0');
  const ekor = ujung === 'awal' ? `T00:00:00${tanda}${hh}:${mm}` : `T23:59:59${tanda}${hh}:${mm}`;
  return new Date(`${tanggalZona}${ekor}`).toISOString();
}

const angka = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

const teks = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 40) : '');

/**
 * Baca filter global (N2) dari query string URL.
 * Rentang selalu konkret (YYYY-MM-DD WIB) supaya tautan bisa dibagikan.
 */
export function bacaFilter(query: Record<string, unknown>, offsetMs = WIB_MS): FilterLaporan {
  const kode = teks(query.periode) || '7-hari';
  const rentang = rentangPeriode(
    kode as KodePeriode,
    teks(query.dari) || undefined,
    teks(query.sampai) || undefined,
    offsetMs,
  );

  // Pembanding: rentang sama panjang tepat sebelum `dari`.
  const panjangHari =
    Math.round((Date.parse(`${rentang.sampai}T00:00:00Z`) - Date.parse(`${rentang.dari}T00:00:00Z`)) / 86_400_000) + 1;
  const bandingSampai = tambahHari(rentang.dari, -1);
  const bandingDari = tambahHari(bandingSampai, -(panjangHari - 1));

  return {
    dari: rentang.dari,
    sampai: rentang.sampai,
    batasAwal: batasUTC(rentang.dari, 'awal', offsetMs),
    batasAkhir: batasUTC(rentang.sampai, 'akhir', offsetMs),
    bandingDari,
    bandingSampai,
    bandingAwal: batasUTC(bandingDari, 'awal', offsetMs),
    bandingAkhir: batasUTC(bandingSampai, 'akhir', offsetMs),
    bandingkan: query.bandingkan === '1' || query.bandingkan === 'true',
    gudang: angka(query.gudang),
    kasir: angka(query.kasir),
    pelanggan: angka(query.pelanggan),
    pemasok: angka(query.pemasok),
    kategori: angka(query.kategori),
    merek: angka(query.merek),
    produk: angka(query.produk),
    metode: teks(query.metode),
    status: teks(query.status),
  };
}

/**
 * Klausa WHERE bersama laporan penjualan/pembelian.
 * N6: status Draft & Batal tidak dihitung kecuali diminta lewat filter status.
 */
export function klausaStatus(kolom: string, f: FilterLaporan): { sql: string; arg: unknown[] } {
  if (f.status === 'semua') return { sql: '', arg: [] };
  if (f.status === 'draft' || f.status === 'disahkan' || f.status === 'batal' || f.status === 'diterima') {
    return { sql: ` AND ${kolom} = ?`, arg: [f.status] };
  }
  return { sql: ` AND ${kolom} = 'disahkan'`, arg: [] };
}

/** Nama entitas dari id — untuk tampilan & lembar ekspor Excel. */
async function namaDari(tabel: 'warehouses' | 'users' | 'customers' | 'suppliers' | 'categories' | 'brands' | 'products', id: number): Promise<string> {
  try {
    const kolom = tabel === 'products' ? 'nama' : 'nama';
    const row = await get<{ nama: string }>(`SELECT ${kolom} AS nama FROM ${tabel} WHERE id = ?`, id);
    return row?.nama ?? String(id);
  } catch {
    return String(id);
  }
}

/** Ringkasan filter aktif untuk ditampilkan di header laporan & ekspor Excel. */
export async  function ringkasFilter(f: FilterLaporan): Promise<[string, string][]> {
  const daftar: [string, string][] = [
    ['Periode', `${f.dari} s.d. ${f.sampai}`],
  ];
  if (f.gudang) daftar.push(['Gudang', await namaDari('warehouses', f.gudang)]);
  if (f.kasir) daftar.push(['Kasir', await namaDari('users', f.kasir)]);
  if (f.pelanggan) daftar.push(['Pelanggan', await namaDari('customers', f.pelanggan)]);
  if (f.pemasok) daftar.push(['Pemasok', await namaDari('suppliers', f.pemasok)]);
  if (f.kategori) daftar.push(['Kategori', await namaDari('categories', f.kategori)]);
  if (f.merek) daftar.push(['Merek', await namaDari('brands', f.merek)]);
  if (f.produk) daftar.push(['Produk', await namaDari('products', f.produk)]);
  if (f.metode) daftar.push(['Metode bayar', f.metode]);
  if (f.status) daftar.push(['Status', f.status]);
  if (f.bandingkan) daftar.push(['Bandingkan', `${f.bandingDari} s.d. ${f.bandingSampai}`]);
  return daftar;
}

/* ----------------------------- cache agregat (N6) ------------------------ */

interface EntriCache { isi: unknown; waktu: number }
const cache = new Map<string, EntriCache>();
const TTL_MS = 60_000;

/** Buang seluruh cache agregat laporan (dipakai setelah restore database). */
export function kosongkanCacheLaporan(): void {
  cache.clear();
}

/**
 * ISOLASI GUDANG laporan — batas warehouse untuk sesi tanpa filter gudang
 * eksplisit. Mengembalikan fragmen siap `push` ke array syarat (gaya
 * `s.push(...)`) beserta argumen placeholder-nya.
 */
export function klausulLingkup(f: FilterLaporan, alias: string): { sql: string; arg: unknown[] } {
  if (f.gudang) return { sql: '', arg: [] };
  const l = f.lingkup;
  if (l === undefined || l === null) return { sql: '', arg: [] };
  if (l.length === 0) return { sql: '1 = 0', arg: [] };
  return { sql: `${alias}.warehouse_id IN (${l.map(() => '?').join(',')})`, arg: [...l] };
}

/** Ambil hasil laporan dari cache (TTL 60 dtk) atau jalankan & simpan. */
export function denganCache<T>(kunci: string, buat: () => T, segar = false): T {
  if (!segar) {
    const e = cache.get(kunci);
    if (e && Date.now() - e.waktu < TTL_MS) return e.isi as T;
  }
  const isi = buat();
  cache.set(kunci, { isi, waktu: Date.now() });
  if (isi instanceof Promise) {
    // Janji yang gagal tidak boleh menetap di cache — kalau tidak, satu
    // galat SQL menempel 60 detik dan tiap refresh tetap 500.
    isi.catch(() => {
      cache.delete(kunci);
    });
  }
  return isi;
}

export function bersihCacheLaporan(): void {
  cache.clear();
}

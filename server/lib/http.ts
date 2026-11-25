import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Kesalahan HTTP dengan kode status yang bisa dikirim ke klien. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /**
     * true = pesan 5xx ini AMAN & PERLU ditampilkan apa adanya ke pengguna
     * (mis. "Gagal mengosongkan master data: constraint violation"). Pesan 5xx
     * lain tetap diganti teks generik di penangan error pusat agar detail SQL
     * tidak bocor.
     */
    public readonly amanTampil = false,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const tolak = (status: number, pesan: string, amanTampil = false): HttpError =>
  new HttpError(status, pesan, amanTampil);

/** Bungkus handler async agar kesalahan diteruskan ke penangan error pusat. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown): RequestHandler =>
  async (req, res, next) => {
    await Promise.resolve(fn(req, res, next) as Promise<unknown>).catch(next);
  };

export interface Paginasi {
  hal: number;
  per: number;
  offset: number;
  urut: string;
  arah: 'ASC' | 'DESC';
  cari: string;
}

/** Baca parameter daftar: halaman, ukuran, urutan, kata kunci (aman dari injeksi). */
export function bacaPaginasi(
  req: Request,
  opsi: { urutBawaan: string; arahBawaan?: 'ASC' | 'DESC'; perBawaan?: number; urutDiizinkan: string[] },
): Paginasi {
  const q = req.query;
  const hal = Math.max(1, Number.parseInt(String(q.hal ?? '1'), 10) || 1);
  const per = Math.min(200, Math.max(1, Number.parseInt(String(q.per ?? '20'), 10) || opsi.perBawaan || 20));
  const urutMinta = String(q.urut ?? '');
  const urut = opsi.urutDiizinkan.includes(urutMinta) ? urutMinta : opsi.urutBawaan;
  const arahMinta = String(q.arah ?? '').toUpperCase();
  const arah: 'ASC' | 'DESC' = arahMinta === 'DESC' ? 'DESC' : arahMinta === 'ASC' ? 'ASC' : (opsi.arahBawaan ?? 'ASC');
  const cari = String(q.cari ?? '').trim();
  return { hal, per, offset: (hal - 1) * per, urut, arah, cari };
}

/** Pola pencarian LIKE yang aman (karakter khusus di-escape). */
export function polaCari(cari: string): string {
  return `%${cari.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

/**
 * Peta galat PostgreSQL (SQLSTATE) ke pesan yang bisa dibaca pengguna.
 *
 * Penting: SQLSTATE 25P02 = transaksi sudah "aborted" karena satu statement
 * gagal. Pesan mentahnya tidak boleh diteruskan mentah-mentah ke UI, dan
 * penting agar tidak salah ditangkap pola SQLite (lihat ABORT di bawah).
 */
function pesanPg(err: unknown): { status: number; pesan: string; aman?: boolean } | null {
  const e = err as { code?: unknown; detail?: unknown; kolom?: unknown } | null;
  const kode = typeof e?.code === 'string' ? e.code : '';
  if (!kode) return null;
  const detail = typeof e?.detail === 'string' ? e.detail : '';
  switch (kode) {
    case '23505': {
      // duplicate key value violates unique constraint
      const kunci = /Key \(([^)]+)\)/.exec(detail)?.[1] ?? '';
      return {
        status: 409,
        pesan: kunci
          ? `Nilai sudah dipakai data lain (${kunci.replace(/"/g, '')}). Gunakan nilai yang berbeda.`
          : 'Nilai duplikat: data dengan nilai yang sama sudah ada.',
      };
    }
    case '23503':
      return { status: 409, pesan: 'Data terkait masih dipakai atau referensinya belum ada. Periksa pilihan Anda.' };
    case '23502': {
      const kolom = typeof e?.kolom === 'string' ? e.kolom : '';
      return {
        status: 400,
        pesan: kolom
          ? `Kolom wajib "${kolom}" belum diisi. Lengkapi data lalu simpan lagi.`
          : 'Ada kolom wajib yang belum diisi. Lengkapi data lalu simpan lagi.',
      };
    }
    // Struktur database ketinggalan migrasi. Ditandai `aman` agar pengguna
    // melihat penyebab sebenarnya, bukan "Terjadi kesalahan pada server".
    case '42703':
      return {
        status: 500,
        pesan:
          'Struktur tabel database belum lengkap (ada kolom yang belum dibuat). ' +
          'Jalankan ulang server agar auto-migration menerapkan kolom terbaru, lalu coba lagi.',
        aman: true,
      };
    case '42P01':
      return {
        status: 500,
        pesan:
          'Tabel database belum tersedia (migrasi belum diterapkan). ' +
          'Jalankan ulang server agar skema disinkronkan, lalu coba lagi.',
        aman: true,
      };
    case '23514':
      return { status: 400, pesan: 'Nilai tidak sesuai aturan basis data. Periksa kembali isian Anda.' };
    case '22001':
      return { status: 400, pesan: 'Teks yang dikirim terlalu panjang untuk kolom tersebut.' };
    case '22P02':
      return { status: 400, pesan: 'Format nilai tidak valid (mis. angka/huruf tertukar). Periksa kembali isian Anda.' };
    case '40001':
    case '40P01':
      return { status: 409, pesan: 'Proses bertabrakan dengan transaksi lain. Muat ulang data lalu coba lagi.' };
    case '55P03':
    case '57014':
      return { status: 409, pesan: 'Data sedang diproses pengguna lain. Tunggu sebentar lalu coba lagi.' };
    case '25P02':
      return {
        status: 500,
        pesan: 'Transaksi database dihentikan karena satu langkah gagal. Tidak ada data yang tersimpan — muat ulang lalu coba lagi.',
      };
    default:
      return null;
  }
}

/** Terjemahkan kesalahan basis data menjadi pesan yang ramah pengguna. */
export function pesanKesalahan(err: unknown): { status: number; pesan: string; aman?: boolean } {
  const pesan = err instanceof Error ? err.message : String(err);

  if (err instanceof HttpError) return { status: err.status, pesan: err.message, aman: err.amanTampil };

  // Galat validasi Master Data & impor (GalatImpor) adalah kesalahan isian
  // pengguna — bukan kegagalan server. Tanpa cabang ini, pesan seperti
  // "Nama Pemasok wajib diisi." keluar sebagai HTTP 500 generik.
  if (err instanceof Error && err.name === 'GalatImpor') {
    return { status: 400, pesan: err.message };
  }

  const pg = pesanPg(err);
  if (pg) return pg;

  const unik = /UNIQUE constraint failed:\s*([\w.]+)/i.exec(pesan);
  if (unik) {
    const kolom = unik[1].split('.').pop() ?? 'nilai';
    return { status: 409, pesan: `Nilai duplikat: kolom "${kolom}" sudah dipakai data lain.` };
  }
  if (/FOREIGN KEY constraint failed/i.test(pesan)) {
    return { status: 409, pesan: 'Data terkait masih dipakai atau referensinya belum ada. Periksa pilihan Anda.' };
  }
  if (/CHECK constraint failed/i.test(pesan)) {
    return { status: 400, pesan: `Nilai tidak sesuai aturan basis data: ${pesan.replace(/^.*CHECK constraint failed:\s*/i, '')}` };
  }
  // Sisa dialek SQLite: trigger RAISE(ABORT, '...') — langsung tampil.
  // Hanya pola SQLite yang diteruskan; teks PG seperti "current transaction is
  // aborted" TIDAK boleh lolos ke UI sebagai pesan 409.
  if (/SqliteError|RAISE\(ABORT/i.test(pesan) && !/constraint failed/i.test(pesan)) {
    return { status: 409, pesan: pesan.replace(/^SqliteError:\s*/i, '') };
  }
  if (/current transaction is aborted/i.test(pesan)) {
    return {
      status: 500,
      pesan: 'Transaksi database dihentikan karena satu langkah gagal. Tidak ada data yang tersimpan — muat ulang lalu coba lagi.',
    };
  }
  return { status: 500, pesan };
}

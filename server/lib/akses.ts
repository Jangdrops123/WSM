import type { Request, RequestHandler } from 'express';
import { tolak } from './http.ts';

/**
 * Identitas pemakai untuk pengecekan hak akses.
 *
 * Tahap 1 — modul Log In sudah ada: identitas dibaca dari SESI login
 * (`req.konteks`, diisi middleware `wajibLogin`). Seluruh pemanggil
 * `penggunaSaatIni` / `wajibAdmin` / `catatAudit` di modul lain tidak
 * berubah — mereka kini otomatis mencatat pengguna sungguhan.
 */
export interface Pengguna {
  id: number | null;
  nama: string;
  peran: string;
}

export const PERAN_ADMIN = new Set(['owner', 'administrator']);

export function penggunaSaatIni(req: Request): Pengguna {
  const k = req.konteks;
  if (k) return { id: k.userId, nama: k.nama, peran: k.roleNama };
  // Tanpa sesi (endpoint publik) — dipakai hanya untuk pesan, bukan otorisasi.
  return { id: null, nama: '-', peran: 'administrator' };
}

export function adalahAdmin(req: Request): boolean {
  return PERAN_ADMIN.has(penggunaSaatIni(req).peran.toLowerCase());
}

/** Tolak permintaan bila bukan Owner/Admin (dipakai untuk ubah harga & hapus). */
export const wajibAdmin: RequestHandler = (req, _res, next) => {
  if (!adalahAdmin(req)) {
    next(tolak(403, 'Hanya Owner/Admin yang boleh mengubah harga atau menghapus data.'));
    return;
  }
  next();
};

const DAFTAR_PERAN = ['admin', 'owner', 'administrator', 'manajer', 'akuntan', 'kasir', 'gudang', 'lainnya'] as const;

export function peranDariHeader(req: Request): string {
  if (req.konteks) return req.konteks.peranKunci;
  const h = String(req.headers['x-peran'] ?? '').toLowerCase().trim();
  return (DAFTAR_PERAN as readonly string[]).includes(h) ? h : 'administrator';
}

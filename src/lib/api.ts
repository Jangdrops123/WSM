// Helper fetch API: semua endpoint mengembalikan { pesan } bila gagal.
import { peranAktif } from './pengguna';

export interface ResponsDaftar<T> {
  data: T[];
  total: number;
  hal: number;
  per: number;
}

/* ----------------------- pemberitau sesi berakhir ----------------------- */
// Modul Log In: setiap balasan 401 memberi tahu konteks sesi agar pengguna
// langsung dialihkan ke halaman Log In (termasuk saat sesi idle habis).
type PemberitauSesi = (pesan: string) => void;
const pemberitauSesi = new Set<PemberitauSesi>();

export function saatSesiBerakhir(fn: PemberitauSesi): () => void {
  pemberitauSesi.add(fn);
  return () => {
    pemberitauSesi.delete(fn);
  };
}

function beritauSesiBerakhir(pesan: string): void {
  for (const fn of pemberitauSesi) fn(pesan);
}

/** Galat API terstruktur — membawa status HTTP + kode mesin ('akses' untuk
 * penolakan hak akses matriks) agar klien dapat merespons spesifik
 * (placeholder widget, de-dup toast) tanpa menebak dari teks pesan. */
export class GalatApi extends Error {
  readonly status: number;
  readonly kode?: string;
  constructor(pesan: string, status: number, kode?: string) {
    super(pesan);
    this.name = 'GalatApi';
    this.status = status;
    this.kode = kode;
  }
}

/** true = penolakan hak akses matriks (HTTP 403 + kode 'akses'). */
export function adalahGalatAkses(e: unknown): e is GalatApi {
  return e instanceof GalatApi && e.status === 403 && e.kode === 'akses';
}

/* ----------------------- mode maintenance (restore) ----------------------- */
// Saat server me-restore database, seluruh /api non-backup menjawab 503 +
// kode 'maintenance'. Beritahu seluruh aplikasi agar menampilkan layar
// maintenance, bukan toast galat.
type PendengarMaintenance = () => void;
const pendengarMaintenance = new Set<PendengarMaintenance>();

export function saatMaintenance(fn: PendengarMaintenance): () => void {
  pendengarMaintenance.add(fn);
  return () => {
    pendengarMaintenance.delete(fn);
  };
}

function beritahuMaintenance(): void {
  for (const fn of pendengarMaintenance) fn();
}

async function minta<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    // `x-peran` tetap dikirim untuk kompatibilitas; sesi login menjadi sumber
    // kebenaran peran di server (header hanya dihormati dari sesi Admin).
    headers: { 'content-type': 'application/json', 'x-peran': peranAktif(), ...(init?.headers ?? {}) },
    ...init,
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* balasan bukan JSON */
  }
  if (!res.ok) {
    const badan = (data ?? {}) as { pesan?: string; kode?: string };
    let pesan = badan.pesan ?? `Terjadi kesalahan (HTTP ${res.status}).`;
    // Penolakan Hak Akses pada AKSI TULIS harus terlihat sebagai toast.
    // Filter "akses ditolak" di Toast hanya untuk penjaga halaman (GET) yang
    // sudah dialihkan diam-diam — menelannya di sini membuat tombol tampak
    // freeze (diklik, tak terjadi apa-apa). Tulis ulang dengan kalimat yang
    // tidak cocok pola filter namun tetap jelas & actionable.
    const metode = (init?.method ?? 'GET').toUpperCase();
    if (badan.kode === 'akses' && metode !== 'GET' && res.status === 403) {
      pesan =
        'Aksi ditolak oleh Hak Akses. Minta Admin memberikan izin yang sesuai (Pengaturan › Pengguna & Hak Akses).';
    }
    if (res.status === 401) beritauSesiBerakhir(pesan);
    if (res.status === 503 && badan.kode === 'maintenance') beritahuMaintenance();
    throw new GalatApi(pesan, res.status, badan.kode);
  }
  return data as T;
}

export const apiGet = <T>(url: string) => minta<T>(url);
export const apiPost = <T>(url: string, body: unknown) =>
  minta<T>(url, { method: 'POST', body: JSON.stringify(body ?? {}) });

/**
 * POST untuk proses server yang LAMA (mis. VACUUM FULL / REINDEX): fetch
 * dibatalkan setelah `batasMs`, dan pengguna mendapat pesan yang jelas alih-alih
 * menunggu tanpa batas.
 */
export async function apiPostBatasWaktu<T>(url: string, body: unknown, batasMs: number): Promise<T> {
  const kontrol = new AbortController();
  const timer = setTimeout(() => kontrol.abort(), batasMs);
  try {
    return await minta<T>(url, { method: 'POST', body: JSON.stringify(body ?? {}), signal: kontrol.signal });
  } catch (e) {
    const nama = (e as { name?: string } | null)?.name;
    if (nama === 'AbortError') {
      throw new Error(
        `Proses melebihi batas waktu ${Math.round(batasMs / 1000)} detik. Periksa kembali ukuran database sebelum mencoba lagi.`,
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
export const apiPut = <T>(url: string, body: unknown) =>
  minta<T>(url, { method: 'PUT', body: JSON.stringify(body ?? {}) });
export const apiDelete = <T>(url: string) => minta<T>(url, { method: 'DELETE' });

/** Unduh berkas Excel dari endpoint (tetap membawa kredensial sesi). */
export async function unduhExcel(url: string, namaBerkas: string): Promise<void> {
  const res = await fetch(url, { headers: { 'x-peran': peranAktif() } });
  if (!res.ok) {
    if (res.status === 401) beritauSesiBerakhir('Sesi berakhir. Silakan masuk kembali.');
    throw new Error(`Gagal mengunduh (HTTP ${res.status}).`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = namaBerkas;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
}

async function keBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const biner = String.fromCharCode(...new Uint8Array(buffer));
  return btoa(biner);
}

/** Tahap 2 impor: konfirmasi & terapkan (setelah pra-tinjau). */
export interface OpsiImpor {
  /** Perbarui data bila Kode sudah ada (UPSERT). Mati = baris itu dilewati. */
  perbarui: boolean;
  /** Lewati baris yang error. Mati = satu error membatalkan seluruh impor. */
  lewati_error: boolean;
}

export const OPSI_IMPOR_BAWAAN: OpsiImpor = { perbarui: true, lewati_error: true };

export async function imporExcel(
  entitas: string,
  file: File,
  pemetaan?: Record<string, string>,
  opsi?: OpsiImpor,
): Promise<ImportResult> {
  const base64 = await keBase64(file);
  return apiPost<ImportResult>(`/api/master/${entitas}/impor`, {
    nama_file: file.name,
    data_base64: base64,
    pemetaan,
    opsi,
  });
}

export interface KolomImpor {
  nama_file: string;
  kolom: string[];
  contoh: Record<string, unknown>;
  total_baris: number;
}

/** Tahap 0 impor: baca judul kolom + baris contoh untuk pemetaan otomatis. */
export async function kolomImpor(entitas: string, file: File): Promise<KolomImpor> {
  const base64 = await keBase64(file);
  return apiPost<KolomImpor>(`/api/master/${entitas}/impor/kolom`, {
    nama_file: file.name,
    data_base64: base64,
  });
}

export interface PraImporBaris {
  nomor: number;
  aksi: 'baru' | 'perbarui';
  /** Pratinjau ringkas baris (modul umum mengirim satu field `teks`). */
  teks?: string;
  kode_item?: string;
  nama_produk?: string;
  sku?: string;
}

export interface PraImpor {
  nama_file: string;
  total_baris: number;
  baris_valid: number;
  /** Baris valid yang dilewati karena opsi "perbarui bila Kode sudah ada" mati. */
  baris_dilewati: number;
  baris_error: number;
  /** true = server akan menolak impor (opsi "lewati baris error" mati). */
  blokir: boolean;
  /** Ringkasan alasan error terurut banyaknya (AB1). */
  ringkasan?: KelompokAlasanImpor[];
  /** Peringatan non-memutus (referensi dibuat otomatis, baris dilewati, …). */
  peringatan?: PeringatanImpor[];
  jumlah_baru?: number;
  jumlah_perbarui?: number;
  errors: HasilImporError[];
  baris: PraImporBaris[];
}

/** Tahap 1 impor: pratinjau tanpa menulis apa pun (validasi + aksi per baris). */
export async function praTinjauImpor(
  entitas: string,
  file: File,
  pemetaan?: Record<string, string>,
  opsi?: OpsiImpor,
): Promise<PraImpor> {
  const base64 = await keBase64(file);
  return apiPost<PraImpor>(`/api/master/${entitas}/impor/pra-tinjau`, {
    nama_file: file.name,
    data_base64: base64,
    pemetaan,
    opsi,
  });
}

export interface HasilImporError {
  nomor_baris: number;
  kolom: string | null;
  /** Teks sel sesungguhnya untuk kolom terkait (null bila tidak tersedia). */
  nilai: string | null;
  pesan: string;
}

/** Kelompok alasan error terurut banyaknya (dari mesin bersama). */
export interface KelompokAlasanImpor {
  alasan: string;
  jumlah: number;
}

/** Peringatan non-memutus (mis. referensi akan dibuat otomatis). */
export interface PeringatanImpor {
  nomor_baris: number;
  kolom: string | null;
  pesan: string;
}

export interface ImportResult {
  batch_id: number;
  total_baris: number;
  baris_valid: number;
  /** Baris valid yang dilewati (opsi perbarui mati). */
  baris_dilewati: number;
  baris_error: number;
  /** Jumlah baris benar-benar baru & yang diperbarui (AB3). */
  jumlah_baru?: number;
  jumlah_perbarui?: number;
  /** true = batch punya jejak "Urungkan". */
  urungkan_tersedia?: boolean;
  ringkasan?: KelompokAlasanImpor[];
  peringatan?: PeringatanImpor[];
  errors: HasilImporError[];
}

/** AB3 — Urungkan impor yang baru saja diterapkan (batch_id dari hasil impor). */
export async function urungkanImpor(entitas: string, batchId: number): Promise<{ pesan: string; dikembalikan: number }> {
  return apiPost(`/api/master/${entitas}/impor/urungkan`, { batch_id: batchId });
}

/**
 * AB1 — Unduh laporan error Excel (POST: daftar error dari panel pengecekan,
 * sebelum konfirmasi sehingga error belum tersimpan di batch).
 */
export async function unduhLaporanError(
  entitas: string,
  namaFile: string,
  errors: HasilImporError[],
  namaBerkas: string,
): Promise<void> {
  const res = await fetch(`/api/master/${entitas}/impor/laporan-error`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-peran': peranAktif() },
    body: JSON.stringify({ nama_file: namaFile, errors }),
  });
  if (!res.ok) {
    if (res.status === 401) beritauSesiBerakhir('Sesi berakhir. Silakan masuk kembali.');
    let pesan = `Gagal mengunduh laporan (HTTP ${res.status}).`;
    try {
      pesan = ((await res.json()) as { pesan?: string }).pesan ?? pesan;
    } catch {
      /* balasan bukan JSON */
    }
    throw new Error(pesan);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = namaBerkas;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
}

// --- Ekspor Excel / PDF -----------------------------------------------------

export interface KolomEkspor {
  key: string;
  label: string;
}

export interface PraEkspor {
  kolom: KolomEkspor[];
  total: number;
  baris: Record<string, unknown>[];
}

/**
 * Ambil data ekspor sebagai JSON — dipakai pratinjau lembar Excel dan
 * pratinjau kertas A4 pada dialog Ekspor PDF.
 */
export function pratinjauEkspor(entitas: string, query: URLSearchParams): Promise<PraEkspor> {
  query.set('format', 'json');
  if (!query.has('batas')) query.set('batas', '300');
  return apiGet<PraEkspor>(`/api/master/${entitas}/ekspor?${query.toString()}`);
}

/** Unduh hasil ekspor (.xlsx / .csv) dari endpoint ekspor. */
export function unduhEkspor(entitas: string, query: URLSearchParams, namaBerkas: string): Promise<void> {
  return unduhExcel(`/api/master/${entitas}/ekspor?${query.toString()}`, namaBerkas);
}

/** Opsi dropdown untuk select (id + label). */
export const ambilOpsi = async (entitas: string): Promise<{ id: number; label: string }[]> => {
  const r = await apiGet<{ data: { id: number; label: string }[] }>(`/api/master/${entitas}/opsi?per=500`);
  return r.data;
};

import { run } from '../db.pg.ts';

export type Aksi =
  | 'tambah'
  | 'ubah'
  | 'ubah_harga'
  | 'hapus'
  | 'kirim'
  | 'terima'
  | 'sahkan'
  | 'batal'
  | 'tolak_izin'
  | 'impor'
  // Modul laporan (BAGIAN N): ekspor Excel/PDF & cetak tercatat di log aktivitas.
  | 'ekspor'
  | 'cetak'
  | 'login'
  | 'logout'
  // Aksi massal (pilih banyak baris)
  | 'aktifkan'
  | 'nonaktifkan'
  | 'ubah_massal'
  | 'hapus_massal'
  | 'pulihkan'
  | 'hapus_permanen'
  | 'urungkan'
  // Stok awal dari impor produk (Master › Produk, kolom gudang + stok_awal)
  | 'stok_awal'
  // Proses Tahunan (hapus riwayat transaksi + konversi saldo awal)
  | 'proses_tahunan'
  // Reset Data (Pengaturan ▸ Database & Backup — transaksi/master/total)
  | 'reset';

export interface InputAudit {
  userId?: number | null;
  aksi: Aksi;
  tabel: string;
  recordId: number | string | null;
  sebelum?: object | null;
  sesudah?: object | null;
  alasan?: string | null;
}

/** Hanya kolom yang berubah disimpan (hemat ruang, lebih mudah dibaca). */
export function diffKolom(
  sebelum: object | null | undefined,
  sesudah: object | null | undefined,
): { sebelum: Record<string, unknown>; sesudah: Record<string, unknown> } {
  const bedaSebelum: Record<string, unknown> = {};
  const bedaSesudah: Record<string, unknown> = {};
  if (!sebelum || !sesudah) return { sebelum: bedaSebelum, sesudah: bedaSesudah };
  const lama = sebelum as Record<string, unknown>;
  const baru = sesudah as Record<string, unknown>;
  for (const kunci of Object.keys(baru)) {
    const nilaiLama = lama[kunci];
    const nilaiBaru = baru[kunci];
    if (JSON.stringify(nilaiLama ?? null) !== JSON.stringify(nilaiBaru ?? null)) {
      bedaSebelum[kunci] = nilaiLama ?? null;
      bedaSesudah[kunci] = nilaiBaru ?? null;
    }
  }
  return { sebelum: bedaSebelum, sesudah: bedaSesudah };
}

/** Tulis satu baris audit log (dipanggil di dalam transaksi yang sama dengan perubahan). */
export async function catatAudit(input: InputAudit): Promise<void> {
  const { sebelum, sesudah } = input.sebelum && input.sesudah
    ? diffKolom(input.sebelum, input.sesudah)
    : { sebelum: (input.sebelum ?? null) as Record<string, unknown> | null, sesudah: (input.sesudah ?? null) as Record<string, unknown> | null };
  const sebelumB = sebelum ?? {};
  const sesudahB = sesudah ?? {};

  // Jangan simpan bila tidak ada perubahan nyata (kecuali aksi hapus/impor).
  const kosong = input.aksi === 'ubah' || input.aksi === 'ubah_harga';
  if (kosong && Object.keys(sebelumB).length === 0) return;

  await run(
    `INSERT INTO audit_logs (user_id, aksi, tabel, record_id, data_sebelum, data_sesudah, alasan)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    input.userId ?? null,
    input.aksi,
    input.tabel,
    input.recordId === null ? null : String(input.recordId),
    Object.keys(sebelumB).length ? JSON.stringify(sebelumB) : null,
    Object.keys(sesudahB).length ? JSON.stringify(sesudahB) : null,
    input.alasan ?? null,
  );
}

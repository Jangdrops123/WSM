// ============================================================================
// AKUNTANSI DASAR — Kas & Bank (sumber kebenaran).
// Tanpa debit/kredit, tanpa jurnal. Saldo = saldo awal + mutasi masuk − keluar.
// Semua penulisan kas (manual maupun otomatis dari POS/Pembelian/Pelunasan)
// melewati fungsi di sini agar saldo selalu konsisten dan bernomor otomatis.
// ============================================================================
import { all, get, run } from '../db.pg.ts';
import { tolak } from './http.ts';

export interface KasAkun {
  id: number;
  kode: string;
  nama: string;
  jenis: 'kas' | 'bank' | 'e-wallet';
  saldo_awal: number;
  aktif: number;
}

/**
 * Nomor otomatis kas (KM-/KK-/TR-<YYYYMMDD>-<urut>). `tanggal` = tanggal
 * transaksi, dipakai untuk PREFIX dan penghitungan urut sehingga transaksi
 * berbeda tanggal tidak pernah berbenturan. Bila urut sudah terpakai (mis.
 * pembatalan membalik tanggal yang sama), naik sampai nomor kosong.
 */
export async function nomorKas(tipe: 'masuk' | 'keluar' | 'transfer', tanggal?: string): Promise<string> {
  const prefix = tipe === 'masuk' ? 'KM' : tipe === 'keluar' ? 'KK' : 'TR';
  const hari = (tanggal ?? new Date().toISOString().slice(0, 10)).slice(0, 10).replace(/-/g, '');
  const dasar = Number(
    await ((await get<{ n: number }>(
      `SELECT COUNT(*) + 1 AS n FROM cash_transactions
       WHERE tipe = ? AND TO_CHAR(tanggal, 'YYYYMMDD') = ?`,
      tipe,
      hari,
    )))?.n ?? 1,
  );
  // Naik sampai nomor benar-benar kosong (tabel punya UNIQUE pada `nomor`).
  let urut = dasar;
  for (let i = 0; i < 10000; i++) {
    const kandidat = `${prefix}-${hari}-${String(urut).padStart(4, '0')}`;
    if (!await get(`SELECT id FROM cash_transactions WHERE nomor = ?`, kandidat)) return kandidat;
    urut++;
  }
  return `${prefix}-${hari}-${String(urut).padStart(4, '0')}`;
}

/** Semua rekening kas/bank (termasuk nonaktif untuk keperluan historis). */
export async function daftarAkunKas(hanyaAktif = true): Promise<KasAkun[]> {
  return await all<KasAkun>(
    `SELECT id, kode, nama, jenis, saldo_awal, aktif
     FROM cash_accounts ${hanyaAktif ? 'WHERE aktif = TRUE' : ''} ORDER BY jenis, kode`,
  );
}

export async function akunKas(id: number): Promise<KasAkun | undefined> {
  return await get<KasAkun>(
    `SELECT id, kode, nama, jenis, saldo_awal, aktif FROM cash_accounts WHERE id = ?`,
    id,
  );
}

/* ================== PEMETAAN METODE BAYAR → REKENING KAS ================= */

/** Metode bayar yang dikenal aplikasi (POS, pemetaan, pelunasan). */
export const METODE_BAYAR = ['tunai', 'transfer', 'qris'] as const;

/** Kunci `settings` untuk rekening default pembayaran hutang/piutang. */
const KUNCI_REKENING_DEFAULT = 'kas_rekening_default';

/** Rekening kas default pilihan pengguna (Pengaturan ▸ Kas & Bank). */
export async function rekeningDefaultId(): Promise<number | null> {
  const baris = await get<{ nilai: string }>(`SELECT nilai FROM settings WHERE kunci = ?`, KUNCI_REKENING_DEFAULT);
  const id = Number(baris?.nilai ?? 0);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Tetapkan / lepas rekening kas default (null = tidak ada default). */
export async function setRekeningDefault(id: number | null): Promise<void> {
  if (!id) {
    await run(`DELETE FROM settings WHERE kunci = ?`, KUNCI_REKENING_DEFAULT);
    return;
  }
  await run(
    `INSERT INTO settings (kunci, nilai, diubah_pada) VALUES (?, ?, now())
     ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai, diubah_pada = now()`,
    KUNCI_REKENING_DEFAULT,
    String(id),
  );
}

/** Tautkan satu metode bayar ke sebuah rekening (satu metode = satu rekening). */
export async function tautkanMetode(metode: string, akunId: number): Promise<void> {
  if (!(METODE_BAYAR as readonly string[]).includes(metode)) {
    throw tolak(400, 'Metode bayar tidak dikenal (tunai/transfer/qris).');
  }
  await run(
    `INSERT INTO payment_method_accounts (metode, cash_account_id) VALUES (?, ?)
     ON CONFLICT(metode) DO UPDATE SET cash_account_id = excluded.cash_account_id`,
    metode,
    akunId,
  );
}

/** Rekening bawaan per metode — dipakai saat instalasi/reset belum punya pemetaan. */
const BAWAAN_METODE: Record<string, { jenis: 'kas' | 'bank' | 'e-wallet'; kode: string; nama: string }> = {
  tunai: { jenis: 'kas', kode: 'KAS-001', nama: 'Kas Utama' },
  transfer: { jenis: 'bank', kode: 'BANK-001', nama: 'Bank Utama' },
  qris: { jenis: 'e-wallet', kode: 'EWAL-001', nama: 'Dompet Digital' },
};

/** Ambil (atau buat) rekening bawaan untuk sebuah jenis rekening. */
async function akunBawaan(jenis: 'kas' | 'bank' | 'e-wallet'): Promise<KasAkun> {
  const meta = Object.values(BAWAAN_METODE).find((b) => b.jenis === jenis) ?? BAWAAN_METODE.tunai;
  const ada = await get<KasAkun>(
    `SELECT id, kode, nama, jenis, saldo_awal, aktif FROM cash_accounts WHERE kode = ?`,
    meta.kode,
  );
  if (ada) {
    if (!Number(ada.aktif)) await run(`UPDATE cash_accounts SET aktif = TRUE WHERE id = ?`, ada.id);
    return { ...ada, aktif: 1 };
  }
  await run(
    `INSERT INTO cash_accounts (kode, nama, jenis, saldo_awal, aktif) VALUES (?, ?, ?, 0, TRUE)`,
    meta.kode,
    meta.nama,
    meta.jenis,
  );
  const baru = await get<KasAkun>(
    `SELECT id, kode, nama, jenis, saldo_awal, aktif FROM cash_accounts WHERE kode = ?`,
    meta.kode,
  );
  if (!baru) throw tolak(500, 'Gagal membuat rekening kas bawaan.');
  return baru;
}

/** Rekening pengganti: default pengguna → rekening aktif sejenis → rekening aktif apa pun → buat baru. */
async function akunCadangan(jenis: 'kas' | 'bank' | 'e-wallet'): Promise<KasAkun> {
  const defId = await rekeningDefaultId();
  if (defId) {
    const def = await akunKas(defId);
    if (def && Number(def.aktif)) return def;
  }
  const aktif = await get<KasAkun>(
    `SELECT id, kode, nama, jenis, saldo_awal, aktif FROM cash_accounts
      WHERE aktif = TRUE ORDER BY (jenis = ?) DESC, id ASC LIMIT 1`,
    jenis,
  );
  if (aktif) return aktif;
  return await akunBawaan(jenis);
}

/**
 * Rekening kas untuk sebuah metode bayar — TIDAK PERNAH gagal karena pemetaan
 * kosong. Bila metode belum ditautkan (instalasi baru / setelah reset), server
 * memilih rekening default, rekening aktif sejenis, atau membuat rekening
 * bawaan (Kas Utama / Bank Utama / Dompet Digital) lalu menautkannya otomatis.
 * Dengan begitu pembayaran hutang/piutang tidak lagi terblokir, sementara
 * pemetaan tetap bisa diatur ulang di Pengaturan ▸ Kas & Bank.
 */
export async function akunKasMetode(metode: string): Promise<KasAkun | undefined> {
  const kunci = metode === 'kredit' ? 'tunai' : metode;
  const meta = BAWAAN_METODE[kunci];
  const terpetakan = await get<KasAkun>(
    `SELECT c.id, c.kode, c.nama, c.jenis, c.saldo_awal, c.aktif
     FROM payment_method_accounts m JOIN cash_accounts c ON c.id = m.cash_account_id
     WHERE m.metode = ?`,
    kunci,
  );
  if (terpetakan && Number(terpetakan.aktif)) return terpetakan;

  const akun = await akunCadangan(meta?.jenis ?? 'kas');
  // Pemetaan lama (bila ada) diarahkan ke rekening pengganti agar transaksi
  // berikutnya langsung memakai rekening yang benar-benar aktif.
  if (meta) await tautkanMetode(kunci, akun.id);
  return akun;
}

/** Saldo berjalan sebuah akun kas pada tanggal tertentu (inklusif). */
export async function saldoKas(id: number, sampai?: string): Promise<number> {
  const akun = await akunKas(id);
  if (!akun) throw tolak(404, 'Rekening kas/bank tidak ditemukan.');
  const batas = sampai ?? '9999-12-31';
  // Satu baris transfer punya dua arti: keluar dari cash_account_id dan masuk
  // ke cash_account_tujuan_id. Kedua arah dihitung terpisah agar net benar.
  const keluar = await get<{ v: number }>(
    `SELECT COALESCE(SUM(jumlah), 0) AS v FROM cash_transactions
     WHERE cash_account_id = ? AND tipe IN ('keluar', 'transfer') AND tanggal <= ?`,
    id,
    batas,
  );
  const masuk = await get<{ v: number }>(
    `SELECT COALESCE(SUM(jumlah), 0) AS v FROM cash_transactions
     WHERE tanggal <= ?
       AND ((tipe = 'masuk' AND cash_account_id = ?)
            OR (tipe = 'transfer' AND cash_account_tujuan_id = ?))`,
    batas,
    id,
    id,
  );
  return Number(akun.saldo_awal) + Number(masuk?.v ?? 0) - Number(keluar?.v ?? 0);
}

export interface InputMutasiKas {
  tipe: 'masuk' | 'keluar' | 'transfer';
  tanggal?: string;
  akunId: number;
  akunTujuanId?: number | null;
  kategoriId?: number | null;
  jumlah: number;
  keterangan?: string | null;
  sumberTipe?: string | null;
  sumberId?: number | null;
  dibuatOleh?: number | null;
}

/**
 * Catat satu mutasi kas. Untuk 'transfer', akun asal = akunId, tujuan =
 * akunTujuanId; jumlah dikeluarkan dari asal dan dimasukkan ke tujuan (dua
 * arah dalam SATU baris). Panggil HANYA di dalam transaksi bila bersama
 * modul lain agar atomik.
 */
export async function catatMutasiKas(input: InputMutasiKas): Promise<number> {
  const jumlah = Math.round(Number(input.jumlah) || 0);
  if (jumlah <= 0) throw tolak(400, 'Jumlah kas tidak valid (harus > 0).');

  const asal = await akunKas(input.akunId);
  if (!asal) throw tolak(404, 'Rekening kas/bank asal tidak ditemukan.');
  if (!Number(asal.aktif)) throw tolak(409, `Rekening "${asal.nama}" sedang nonaktif.`);

  if (input.tipe === 'transfer') {
    const tujuan = input.akunTujuanId ? await akunKas(input.akunTujuanId) : undefined;
    if (!tujuan) throw tolak(404, 'Rekening kas/bank tujuan transfer tidak ditemukan.');
    if (input.akunId === input.akunTujuanId) {
      throw tolak(400, 'Rekening asal dan tujuan transfer tidak boleh sama.');
    }
    if (!Number(tujuan.aktif)) throw tolak(409, `Rekening "${tujuan.nama}" tujuan sedang nonaktif.`);
  }

  const tanggal = (input.tanggal ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
  const nomor = await nomorKas(input.tipe, tanggal);

  const id = Number(
    await ((await run(
      `INSERT INTO cash_transactions
         (tipe, tanggal, nomor, cash_account_id, cash_account_tujuan_id, category_id,
          jumlah, keterangan, sumber_tipe, sumber_id, dibuat_oleh)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.tipe,
      tanggal,
      nomor,
      input.akunId,
      input.tipe === 'transfer' ? (input.akunTujuanId ?? null) : null,
      input.kategoriId ?? null,
      jumlah,
      input.keterangan ?? null,
      input.sumberTipe ?? null,
      input.sumberId ?? null,
      input.dibuatOleh ?? null,
    ))).lastInsertRowid,
  );
  return id;
}

/** Batalkan mutasi kas berdasar jejak dokumen sumber (dipakai void/retur/batal). */
export async function batalkanMutasiKasSumber(sumberTipe: string, sumberId: number, alasan: string): Promise<number> {
  const baris = await all<{ id: number; tipe: string; tanggal: string; cash_account_id: number; cash_account_tujuan_id: number | null; kategori_id: number | null; jumlah: number; dibuat_oleh: number | null }>(
    `SELECT id, tipe, tanggal, cash_account_id, cash_account_tujuan_id, category_id AS kategori_id, jumlah, dibuat_oleh
     FROM cash_transactions WHERE sumber_tipe = ? AND sumber_id = ?`,
    sumberTipe,
    sumberId,
  );
  let n = 0;
  for (const b of baris) {
    // Balik arah: masuk -> keluar, keluar -> masuk, transfer -> transfer terbalik.
    await catatMutasiKas({
      tipe: b.tipe === 'masuk' ? 'keluar' : b.tipe === 'keluar' ? 'masuk' : 'transfer',
      tanggal: b.tipe === 'transfer' ? undefined : b.tanggal,
      akunId: b.tipe === 'transfer' ? Number(b.cash_account_tujuan_id) : Number(b.cash_account_id),
      akunTujuanId: b.tipe === 'transfer' ? Number(b.cash_account_id) : null,
      kategoriId: b.kategori_id ? Number(b.kategori_id) : null,
      jumlah: Number(b.jumlah),
      keterangan: alasan,
      sumberTipe: b.tipe === 'transfer' ? null : sumberTipe,
      sumberId: b.tipe === 'transfer' ? null : sumberId,
      dibuatOleh: b.dibuat_oleh ? Number(b.dibuat_oleh) : null,
    });
    n++;
  }
  return n;
}

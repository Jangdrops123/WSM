import { all, get, run, withTransaction } from '../db.pg.ts';
import { catatAudit } from './audit.ts';

export interface GudangInfo {
  id: number;
  kode: string;
  nama: string;
  aktif: number;
}

export interface GrupGudang {
  /** Kode toko; null = gudang tanpa toko. */
  toko_kode: string | null;
  toko_nama: string;
  toko_aktif: number;
  gudang: GudangInfo[];
}

/**
 * AS1 — satu sumber kebenaran: daftar gudang dari Master Data (warehouses),
 * dikelompokkan per toko (stores). Gudang tanpa toko masuk grup "Tanpa toko".
 * Tidak ada paginasi, tidak disaring hak akses — penyaringan terjadi saat
 * menyimpan (delegasi) dan saat memakai (opsi tersaring per sesi).
 */
export async function daftarGudangGrup(): Promise<GrupGudang[]> {
  let adaAktif = true;
  try {
    adaAktif = (await ((await get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM pragma_table_info('warehouses') WHERE name = 'aktif'`,
    )))?.n ?? 0) > 0;
  } catch {
    adaAktif = false;
  }
  const pilihAktif = adaAktif ? 'w.aktif' : '1';
  const baris = await all<{
    id: number; kode: string; nama: string; aktif: number;
    toko_kode: string | null; toko_nama: string | null; toko_aktif: number | null;
  }>(
    `SELECT w.id, w.kode, w.nama, ${pilihAktif} AS aktif,
            s.kode AS toko_kode, s.nama AS toko_nama, s.aktif AS toko_aktif
       FROM warehouses w
       LEFT JOIN stores s ON s.warehouse_id = w.id
      ORDER BY CASE WHEN s.kode IS NULL THEN 1 ELSE 0 END, s.nama, w.kode`,
  );

  const grup = new Map<string, GrupGudang>();
  const kunci = (toko: string | null): string => toko ?? '';
  for (const b of baris) {
    const k = kunci(b.toko_kode);
    let g = grup.get(k);
    if (!g) {
      g = {
        toko_kode: b.toko_kode,
        toko_nama: b.toko_nama ?? 'Tanpa toko',
        toko_aktif: b.toko_aktif ?? 1,
        gudang: [],
      };
      grup.set(k, g);
    }
    g.gudang.push({ id: b.id, kode: b.kode, nama: b.nama, aktif: Number(b.aktif ?? 1) });
  }
  return [...grup.values()];
}

/** Kode semua gudang aktif (dipakai validasi cakupan). */
export async function kodeGudangAktif(): Promise<Set<string>> {
  try {
    return new Set(
      await (await all<{ kode: string }>(`SELECT kode FROM warehouses WHERE aktif = TRUE`)).map((r) => r.kode),
    );
  } catch {
    return new Set(await (await all<{ kode: string }>(`SELECT kode FROM warehouses`)).map((r) => r.kode));
  }
}

/**
 * Petakan satu entri cakupan ke KODE gudang kanonis.
 * Menerima kode gudang (tak peduli huruf besar/kecil), nama gudang, maupun
 * kode/nama toko (dipetakan ke gudang toko itu). Entri yang tidak cocok ke
 * gudang mana pun menghasilkan null (data lama yang yatim).
 */
export async function kodeGudangKanonis(entri: string): Promise<string | null> {
  const teks = String(entri ?? '').trim();
  if (!teks) return null;
  const baris = await get<{ kode: string }>(
    `SELECT w.kode AS kode
       FROM warehouses w
      WHERE lower(w.kode) = lower(?)
     UNION ALL
     SELECT w.kode AS kode
       FROM warehouses w
      WHERE lower(w.nama) = lower(?)
     UNION ALL
     SELECT w.kode AS kode
       FROM stores s JOIN warehouses w ON w.id = s.warehouse_id
      WHERE lower(s.kode) = lower(?) OR lower(s.nama) = lower(?)
      LIMIT 1`,
    teks,
    teks,
    teks,
    teks,
  );
  return baris?.kode ?? null;
}

/**
 * Normalisasi daftar cakupan ke kode gudang unik (untuk keputusan akses).
 * null = tanpa pembatasan (d teruskan apa adanya); entri yatim dibuang
 * agar tidak mengotori irisan cakupan pengguna × peran.
 */
export async  function normalisasiCakupan(daftar: string[] | null): Promise<string[] | null> {
  if (daftar === null || daftar === undefined) return null;
  const keluar: string[] = [];
  for (const e of daftar) {
    const kode = await kodeGudangKanonis(e);
    if (kode && !keluar.includes(kode)) keluar.push(kode);
  }
  return keluar;
}

/**
 * Petakan input cakupan dari formulir ke kode gudang (untuk penyimpanan).
 * Menerima kode maupun nama (kasus data lama). Mengembalikan kode unik +
 * daftar entri asing yang harus ditolak dengan galat 400.
 */
export async  function petakanCakupanSimpan(daftar: string[]): Promise<{ kode: string[]; asing: string[] }> {
  const kode: string[] = [];
  const asing: string[] = [];
  for (const e of daftar) {
    const aslinya = String(e ?? '').trim();
    if (!aslinya) continue;
    const kanonis = await kodeGudangKanonis(aslinya);
    if (!kanonis) {
      asing.push(aslinya);
      continue;
    }
    if (!kode.includes(kanonis)) kode.push(kanonis);
  }
  return { kode, asing };
}

/** Id gudang yang boleh dilihat sesi dengan cakupan kode gudang (null = semua). */
export async function idGudangDiizinkan(cakupan: string[] | null): Promise<Set<number> | null> {
  if (cakupan === null) return null;
  if (cakupan.length === 0) return new Set();
  const pas = cakupan.map(() => '?').join(',');
  return new Set(
    await (await all<{ id: number }>(`SELECT id FROM warehouses WHERE kode IN (${pas})`, ...cakupan)).map((r) => r.id),
  );
}

/**
 * AS3 — lepas akses ke gudang yang dihapus/dinonaktifkan: buang kode dari
 * cakupan users + roles, kosongkan toko_bawaan yang menunjuk ke sana,
 * tandai pengguna tanpa gudang tersisa "Perlu ditinjau".
 * Mengembalikan jumlah pengguna yang kehilangan akses (untuk pemberitahuan Owner).
 */
export async function lepasAksesGudang(kode: string, aktorId: number | null, alasan: string): Promise<number> {
  let hilang = 0;
  await withTransaction(async () => {
    const pengguna = await all<{ id: number; cakupan_toko: string | null; toko_bawaan: string | null }>(
      `SELECT id, cakupan_toko, toko_bawaan FROM users`,
    );
    for (const u of pengguna) {
      if (!u.cakupan_toko) continue;
      let daftar: string[];
      try {
        const v = JSON.parse(u.cakupan_toko) as unknown;
        if (!Array.isArray(v)) continue;
        daftar = v.map((x) => String(x));
      } catch {
        continue;
      }
      if (!daftar.includes(kode)) continue;
      const sisa = daftar.filter((c) => c !== kode);
      await run(
        `UPDATE users SET cakupan_toko = ?, toko_bawaan = CASE WHEN toko_bawaan = ? THEN NULL ELSE toko_bawaan END,
                          perlu_ditinjau = CASE WHEN ? = '[]' THEN 1 ELSE perlu_ditinjau END WHERE id = ?`,
        sisa.length ? JSON.stringify(sisa) : '[]',
        kode,
        sisa.length ? 'x' : '[]',
        u.id,
      );
      hilang += 1;
    }
    const peran = await all<{ id: number; cakupan_toko: string | null }>(
      `SELECT id, cakupan_toko FROM roles WHERE cakupan_toko IS NOT NULL`,
    );
    for (const r of peran) {
      let daftar: string[];
      try {
        const v = JSON.parse(r.cakupan_toko as string) as unknown;
        if (!Array.isArray(v)) continue;
        daftar = v.map((x) => String(x));
      } catch {
        continue;
      }
      if (!daftar.includes(kode)) continue;
      const sisa = daftar.filter((c) => c !== kode);
      await run(`UPDATE roles SET cakupan_toko = ? WHERE id = ?`, sisa.length ? JSON.stringify(sisa) : null, r.id);
    }
  });
  await catatAudit({
    userId: aktorId,
    aksi: 'ubah',
    tabel: 'users',
    recordId: kode,
    sebelum: { gudang: kode },
    sesudah: { akses_dilepas: hilang },
    alasan,
  });
  return hilang;
}

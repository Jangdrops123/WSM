// ============================================================================
// Mesin impor Excel BERSAMA (BAGIAN AB) — satu sumber kode untuk seluruh
// modul yang memakai impor (Produk, Kategori, Merek, Satuan, Pelanggan,
// Pemasok, Gudang, Lokasi, Konversi, Paket, Persediaan, Opname).
//
// Setiap modul menyediakan definisi kolom & aturan uniknya sendiri, tetapi
// normalisasi sel, penerapan pemetaan, cek unik/duplikat, pelaporan error
// (berkelompok + nilai), dan penyimpanan batch dilakukan DI SINI sehingga
// perbaikan berlaku untuk semua modul sekaligus.
//
// Prinsip validasi (AB2):
//   a) Pemetaan kolom file → kunci kolom modul diterapkan SEBELUM validasi;
//      semua aturan membandingkan satu objek baris yang sama ({ key: nilai }).
//   b) Sel kode (kode_item, sku, barcode) dinormalisasi sebagai teks terpotong:
//      angka murni Excel (12132111) → "12132111"; nol di depan dipertahankan;
//      spasi tak terlihat / NBSP / BOM dibuang. Angka (harga, stok) diparse
//      toleran: "Rp 1.250.000", "1,250,000.50", "12.500,75" semuanya sah.
//   c) Duplikat DALAM file membandingkan antar baris berbeda (Set diisi SETELAH
//      pemeriksaan tiap baris, tanpa peka huruf besar-kecil). Duplikat terhadap
//      database pada mode Perbarui = "akan diperbarui", bukan error.
//   d) Kolom wajib hanya dianggap kosong bila hasil normalisasi benar-benar
//      kosong (0 dan "0" tetap terisi).
//   e) Referensi (kategori, merek, satuan, gudang) yang belum ada → Peringatan
//      "akan dibuat" bila opsi buat_otomatis aktif; Error bila tidak.
//   f) Status: Aktif/Nonaktif/1/0/true/false/ya/tidak (tanpa peka huruf);
//      kosong = nilai bawaan. Tanggal: dd/mm/yyyy, yyyy-mm-dd, serial Excel.
//   g) Baris dengan kolom opsional kosong / kolom ekstra tak terpetakan TIDAK
//      pernah ditolak.
//   h) Nomor baris dihitung dari seluruh baris data (baris 1 = judul); baris
//      yang seluruh kosong dibuang saat pembacaan (bukan dihitung error).
//   i) Validasi tidak pernah memutasi data bersama — tiap baris memakai objek
//      salinan sendiri.
// ============================================================================
import { all, get, run } from '../db.pg.ts';
import { pesanKesalahan } from './http.ts';

// --- Tipe -------------------------------------------------------------------

/** Opsi wizard impor — dipakai semua modul. */
export interface OpsiImporBersama {
  /** Perbarui data bila kode sudah ada (UPSERT). Mati = baris itu dilewati. */
  perbarui: boolean;
  /** Lewati baris yang error; mati = satu error membatalkan seluruh impor. */
  lewati_error: boolean;
  /** Buat referensi (kategori/merek/satuan/gudang) yang belum ada — peringatan, bukan error. */
  buat_otomatis: boolean;
}

export const OPSI_IMPOR_SERVER: Readonly<OpsiImporBersama> = Object.freeze({
  perbarui: true,
  lewati_error: true,
  buat_otomatis: true,
});

export function bacaOpsiImpor(body: Record<string, unknown> | undefined): OpsiImporBersama {
  const o = body ?? {};
  const bool = (v: unknown, bawaan: boolean) =>
    v === undefined || v === null || v === '' ? bawaan : v === true || v === 'true' || v === 1 || v === '1';
  return {
    perbarui: bool(o.perbarui, OPSI_IMPOR_SERVER.perbarui),
    lewati_error: bool(o.lewati_error, OPSI_IMPOR_SERVER.lewati_error),
    buat_otomatis: bool(o.buat_otomatis, OPSI_IMPOR_SERVER.buat_otomatis),
  };
}

/** Satu baris kesalahan impor — Nilai = teks sel sesungguhnya untuk kolom terkait. */
export interface KesalahanImpor {
  nomor_baris: number;
  kolom: string | null;
  nilai: string | null;
  pesan: string;
}

/**
 * Galat validasi yang membawa konteks kolom + nilai mentah — dipakai modul
 * saat melempar dari dalam aturannya agar tabel detail (Kolom | Nilai | Alasan)
 * menunjuk sel yang benar.
 */
export class GalatImpor extends Error {
  constructor(
    readonly kolom: string | null,
    readonly pesan: string,
    readonly nilai?: unknown,
  ) {
    super(pesan);
    this.name = 'GalatImpor';
  }
}

/** Lempar galat validasi berkonteks kolom. */
export function galatImpor(kolom: string | null, pesan: string, nilai?: unknown): never {
  throw new GalatImpor(kolom, pesan, nilai);
}

/** Peringatan non-memorable (mis. "Kategori X akan dibuat otomatis"). */
export interface PeringatanImpor {
  nomor_baris: number;
  kolom: string | null;
  pesan: string;
}

/** Kelompok alasan error — dipetakan ke panel "Hasil pengecekan". */
export interface KelompokAlasan {
  alasan: string;
  jumlah: number;
}

// --- Normalisasi sel (AB2b, AB2d, AB2f) -------------------------------------

/** Buang BOM, NBSP, spasi tak terlihat; trim; String() aman untuk null/undefined. */
export function teksBersih(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/^﻿/, '') // BOM
    .replace(/[\s ​‌‍﻿]+/g, ' ') // spasi tak terlihat & NBSP → ruang biasa
    .trim();
}

/**
 * Normalisasi kolom KODE (kode_item, sku, barcode, kode box, …) menjadi teks:
 * angka murni Excel 12132111 → "12132111" (bukan 1.2132111E+7), nol di depan
 * dari sel teks dipertahankan ("00123" tetap "00123"), desimal .0 dari Excel
 * dibuang ("12132111.0" → "12132111").
 */
export function teksKode(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' && Number.isFinite(v)) {
    return Number.isInteger(v) ? String(v) : String(parseFloat(v.toFixed(10)));
  }
  const s = teksBersih(v);
  // Sel teks berisi "12132111.0" (dibuat dari angka) → buang ".0" tunggal di ekor.
  if (/^-?\d+\.0$/.test(s)) return s.slice(0, -2);
  return s;
}

/** Nilai angka Excel asli (untuk sel harga/stok yang tersimpan sebagai angka). */
export function angkaDariSel(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v instanceof Date) return null;
  return null;
}

/**
 * Parse angka TOLERAN (AB2b): "Rp 1.250.000", "1.250.000", "1,250,000.50",
 * "12.500,75", "12500", angka Excel asli. Mengembalikan null bila kosong,
 * melempar HttpError 400 bila bukan angka yang masuk akal.
 */
export function angkaToleran(v: unknown, label: string): number | null {
  const asli = angkaDariSel(v);
  if (asli !== null) return asli;
  const s = teksBersih(v).replace(/rp\s*/gi, '').replace(/\s+/g, '');
  if (!s) return null;
  if (!/^[-+]?[\d.,]+$/.test(s)) {
    throw new GalatImpor(label, `${label} tidak valid (harus angka): "${teksBersih(v)}".`, v);
  }
  const negatif = s.startsWith('-');
  const polos = s.replace(/^[-+]/, '');
  const adaTitik = polos.includes('.');
  const adaKoma = polos.includes(',');
  let angka: string;
  if (adaTitik && adaKoma) {
    // Pemisah terakhir = desimal.
    angka = polos.lastIndexOf('.') > polos.lastIndexOf(',')
      ? polos.replace(/,/g, '').replace('.', '.')
      : polos.replace(/\./g, '').replace(',', '.');
  } else if (adaKoma) {
    // Koma tunggal dengan ≤2 digit setelah → desimal; selain itu pemisah ribuan.
    angka = /^[\d]{1,3}(,\d{1,2})$/.test(polos) ? polos.replace(',', '.') : polos.replace(/,/g, '');
  } else if (adaTitik) {
    angka = /^[\d]{1,3}(\.\d{3})+$/.test(polos) ? polos.replace(/\./g, '') : polos;
  } else {
    angka = polos;
  }
  const n = Number(angka);
  if (!Number.isFinite(n)) throw new GalatImpor(label, `${label} tidak valid (harus angka): "${teksBersih(v)}".`, v);
  return negatif ? -n : n;
}

/** Status serbaguna (AB2f): Aktif/Nonaktif, 1/0, true/false, ya/tidak — tanpa peka huruf. */
export function statusToleran(v: unknown, kolom = 'status'): 1 | 0 | undefined {
  const s = teksBersih(v).toLowerCase();
  if (!s) return undefined; // kosong = bawaan (Aktif untuk produk baru)
  if (['aktif', 'active', 'ya', 'y', '1', 'true', 'iya'].includes(s)) return 1;
  if (['nonaktif', 'inactive', 'tidak', 't', 'n', '0', 'false'].includes(s)) return 0;
  throw new GalatImpor(
    kolom,
    `${kolom} tidak dikenali: "${teksBersih(v)}" (pakai Aktif/Nonaktif, 1/0, ya/tidak).`,
    v,
  );
}

/**
 * Tanggal fleksibel (AB2f): dd/mm/yyyy, yyyy-mm-dd, dan nomor serial Excel
 * (45000 → 2023-03-15). Kosong = null. Bila Date asli dari exceljs → dipakai.
 */
export function tanggalToleran(v: unknown, kolom = 'tanggal'): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 2958466) {
    // Serial Excel: hari sejak 1899-12-30.
    const ms = Math.round((v - 25569) * 86400_000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  const s = teksBersih(v);
  if (!s) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  throw new GalatImpor(
    kolom,
    `Tanggal "${s}" tidak dikenali (pakai dd/mm/yyyy, yyyy-mm-dd, atau tanggal Excel).`,
    v,
  );
}

/** Kolom wajib dianggap kosong hanya bila hasil normalisasi benar-benar kosong (AB2d). */
export function wajibKosong(v: unknown): boolean {
  return teksKode(v) === '';
}

// --- Pemetaan & pembacaan baris (AB2a, AB2h, AB2i) --------------------------

/**
 * Terapkan pemetaan file → kunci kolom modul pada SELURUH baris, lalu buang
 * baris yang seluruh nilainya kosong. Mengembalikan salinan per baris sehingga
 * validasi tidak pernah memutasi data bersama (AB2i).
 *
 * Tanpa pemetaan (undefined/kosong) baris dipakai apa adanya — modul yang
 * memakai judul kolom file tetap didukung.
 */
export function terapkanPemetaan(
  kolomFile: string[],
  baris: Record<string, unknown>[],
  pemetaan?: Record<string, string>,
): Record<string, unknown>[] {
  const pakaiPemetaan = pemetaan && Object.keys(pemetaan).length > 0;
  if (!pakaiPemetaan) {
    return baris.map((r) => ({ ...r }));
  }
  const ada = new Set(kolomFile);
  const hasil: Record<string, unknown>[] = [];
  for (const r of baris) {
    const salinan: Record<string, unknown> = {};
    for (const [kunciModul, kolomAsal] of Object.entries(pemetaan!)) {
      if (!kolomAsal || !ada.has(kolomAsal)) continue;
      salinan[kunciModul] = r[kolomAsal];
    }
    if (Object.values(salinan).every((v) => teksBersih(v) === '')) continue; // baris kosong dibuang (AB2h)
    hasil.push(salinan);
  }
  return hasil;
}

/**
 * Normalisasi judul kolom: huruf kecil, alfanumerik saja.
 * ("Nama Produk" → "namaproduk", "Kode_Item" → "kodeitem").
 */
export function normalkanJudul(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Sinonim judul kolom impor (kunci kolom modul → variasi yang dikenali).
 * Dipakai pencocokan otomatis tahap 2 — satu sumber untuk SELURUH modul
 * (generik, konversi, paket) sehingga judul apa pun yang merujuk kolom
 * master yang sama langsung terbaca tanpa pemetaan manual.
 */
const SINONIM_JUDUL: Record<string, string[]> = {
  kode_item: ['kode', 'kodeitem', 'kodeproduk', 'kodabarang', 'itemcode', 'idproduk', 'idbarang', 'id'],
  nama_produk: ['nama', 'namaproduk', 'namabarang', 'produk', 'namaitem', 'description', 'deskripsi'],
  nama: ['nama', 'namabarang', 'namaproduk', 'namakategori', 'namamerek', 'namasatuan', 'namapelanggan', 'namapemasok', 'namagudang', 'namapaket', 'namalokasi', 'namasupplier', 'namacustomer', 'kategori', 'merek', 'gudang', 'pelanggan', 'pemasok', 'supplier', 'paket', 'barang'],
  sku: ['sku', 'kodesku', 'kodebarang', 'codesku', 'articlesku', 'nomorsku'],
  kode: ['kode', 'kodegudang', 'kodesatuan', 'kodelokasi', 'kodebox', 'kodekategori', 'box', 'id'],
  kode_box: ['kodebox', 'kode', 'box', 'kodepaket'],
  barcode: ['barcode', 'barcodes', 'ean', 'upc', 'kodebatang', 'kodeserat'],
  barcode_box: ['barcodebox', 'barcode', 'ean', 'kodebatang'],
  kategori: ['kategori', 'category', 'jenis', 'golongan', 'tipe', 'kelompok'],
  merek: ['merek', 'merk', 'brand', 'pabrikan'],
  satuan: ['satuan', 'satuandasar', 'unit', 'uom', 'kodesatuan', 'namasatuan'],
  jumlah: ['jumlah', 'jumlahpersatuandasar', 'qty', 'kuantitas', 'jml', 'isi', 'volume'],
  isi: ['isi', 'isiskuxqty', 'skuxqty', 'komposisi', 'rincian', 'daftarisi', 'item', 'komponen'],
  profil_size: ['profil', 'profilsize', 'sizeprofile', 'aturankodi', 'profilsizekategori'],
  harga_beli: ['hargabeli', 'beli', 'hpp', 'modal', 'hargamodal', 'cost', 'purchaseprice', 'hargapokok'],
  harga_jual: ['hargajual', 'jual', 'harga', 'retail', 'hargaretel', 'sellingprice', 'price', 'hargabarang'],
  stok_min: ['stokmin', 'stokminimum', 'minimum', 'minim stok', 'minstok', 'batasstok', 'minstock', 'stokminimal', 'minimalstok'],
  status: ['status', 'aktif', 'state', 'enable', 'keaktifan'],
  aktif: ['aktif', 'status', 'state', 'aktifasi'],
  telepon: ['telepon', 'telp', 'teleponhp', 'nohp', 'nohandphone', 'hp', 'handphone', 'phone', 'telpon', 'notelp', 'nowa', 'whatsapp', 'wa'],
  alamat: ['alamat', 'address', 'lokasi', 'domisili'],
  limit_piutang: ['limitpiutang', 'limit', 'plafon', 'piutang', 'limitkredit', 'kreditlimit'],
  termin_hari: ['terminhari', 'termin', 'tempo', 'jtuh_tempo', 'jatuhtempo', 'terminpembayaran'],
  zona: ['zona', 'zone', 'wilayah', 'area'],
  rak: ['rak', 'rack'],
  bin: ['bin'],
  kode_lokasi: ['kodelokasi', 'kode', 'lokasi', 'binlocation'],
  warehouse_id: ['gudang', 'warehouse', 'namagudang', 'kodegudang'],
  gudang: ['gudang', 'warehouse', 'kodegudang', 'namagudang', 'gudangpenempatan', 'lokasigudang'],
  stok_awal: ['stokawal', 'qtyawal', 'jumlahawal', 'saldoawal', 'openingstock', 'stokgudang'],
  size_profile_id: ['profilsize', 'profil', 'sizeprofile', 'klasifikasi'],
  termin: ['termin', 'terminhari', 'tempo'],
};

/**
 * Pencocokan OTOMATIS judul kolom file → kunci kolom master.
 * Satu fungsi untuk semua modul (template, pratinjau, dan impor langsung
 * memakai daftar kolom modul yang SAMA) sehingga kolom baru yang ditambah
 * ke master otomatis ikut terbaca tanpa daftar khusus.
 *
 * Urutan: (1) persis ternormalisasi atas key/label, (2) sinonim umum,
 * (3) mengandung (sub-string, min. 4 huruf). Tiap kunci & tiap judul
 * file dipakai maksimal sekali.
 */
export function pemetaanOtomatis(
  kolomModul: { key: string; label: string }[],
  judulFile: string[],
): Record<string, string> {
  const dipakai = new Set<string>();
  const hasil: Record<string, string> = {};
  const normFile = judulFile.map((h) => ({ asli: h, norm: normalkanJudul(h) }));
  const klaim = (key: string, asli: string): void => {
    if (!hasil[key] && !dipakai.has(asli)) {
      hasil[key] = asli;
      dipakai.add(asli);
    }
  };
  // 1. persis
  for (const k of kolomModul) {
    const nk = normalkanJudul(k.key);
    const nl = normalkanJudul(k.label);
    for (const f of normFile) {
      if (f.norm && (f.norm === nk || f.norm === nl)) {
        klaim(k.key, f.asli);
        break;
      }
    }
  }
  // 2. sinonim
  for (const k of kolomModul) {
    if (hasil[k.key]) continue;
    for (const s of SINONIM_JUDUL[k.key] ?? []) {
      const f = normFile.find((x) => x.norm === s);
      if (f) {
        klaim(k.key, f.asli);
        break;
      }
    }
  }
  // 3. mengandung (kunci/label min. 4 huruf agar 'id' tak serakah)
  const sisa = kolomModul.filter((k) => !hasil[k.key]);
  for (const k of sisa) {
    const calon = [normalkanJudul(k.key), normalkanJudul(k.label)].filter((s) => s.length >= 4);
    if (!calon.length) continue;
    const f = normFile.find(
      (x) => x.norm.length >= 4 && calon.some((c) => x.norm.includes(c) || c.includes(x.norm)),
    );
    if (f) klaim(k.key, f.asli);
  }
  return hasil;
}

/** Baris nomor (baris 1 = judul; data mulai 2). */
export function nomorBaris(idxData: number): number {
  return idxData + 2;
}

// --- Pengumpul kesalahan (AB1) -----------------------------------------------

/**
 * Pengumpul kesalahan + peringatan dengan pengelompokan alasan.
 * Kelompok disusun dari pola pesan tanpa nilai dinamis, mis.
 * `Satuan "BOX" belum ada …` → kelompok `Satuan belum ada`.
 */
export class PengumpulImpor {
  readonly kesalahan: KesalahanImpor[] = [];
  readonly peringatan: PeringatanImpor[] = [];

  tolak(nomor: number, kolom: string | null, pesan: string, nilai?: unknown): void {
    this.kesalahan.push({
      nomor_baris: nomor,
      kolom,
      nilai: nilai === undefined || nilai === null || teksBersih(nilai) === '' ? null : teksBersih(nilai),
      pesan,
    });
  }

  /** Catat error dari `catch` — hormati konteks kolom/nilai pada GalatImpor. */
  tolakDari(err: unknown, nomor: number, baris: Record<string, unknown>): void {
    const { pesan } = pesanKesalahan(err);
    if (err instanceof GalatImpor) {
      const nilai = err.nilai ?? (err.kolom ? baris[err.kolom] : undefined);
      this.tolak(nomor, err.kolom, pesan, nilai);
      return;
    }
    // Fallback: kolom mana pun yang terisi (teks error generik).
    const kolomRaw = Object.keys(baris).find((k) => teksBersih(baris[k]) !== '');
    this.tolak(nomor, kolomRaw ?? null, pesan, kolomRaw ? baris[kolomRaw] : undefined);
  }

  ingatkan(nomor: number, kolom: string | null, pesan: string): void {
    this.peringatan.push({ nomor_baris: nomor, kolom, pesan });
  }

  get jumlahError(): number {
    return this.kesalahan.length;
  }

  /** Kelompok alasan terurut banyaknya (panel "Hasil pengecekan"). */
  ringkas(): KelompokAlasan[] {
    return ringkasKesalahan(this.kesalahan);
  }

  /** Alasan terbanyak — dipakai banner langkah pemetaan. */
  alasanTerbanyak(): KelompokAlasan | null {
    return this.ringkas()[0] ?? null;
  }
}

/** Kelompokkan daftar kesalahan menjadi ringkasan alasan (untuk respons server). */
export function ringkasKesalahan(kesalahan: KesalahanImpor[]): KelompokAlasan[] {
  const peta = new Map<string, number>();
  for (const k of kesalahan) {
    const kunci = kelompokkanAlasan(k.pesan);
    peta.set(kunci, (peta.get(kunci) ?? 0) + 1);
  }
  return [...peta.entries()]
    .map(([alasan, jumlah]) => ({ alasan, jumlah }))
    .sort((a, b) => b.jumlah - a.jumlah || a.alasan.localeCompare(b.alasan));
}

/** Pola pesan → kunci kelompok (buang nilai dinamis seperti nama/angka/kutip). */
export function kelompokkanAlasan(pesan: string): string {
  return pesan
    .replace(/"[^"]*"/g, '…') // nilai di dalam kutip
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '…') // tanggal
    .replace(/\b\d+([.,]\d+)?\b/g, '…') // angka (baris, jumlah)
    .replace(/\(baris \S+\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// --- Cek unik (AB2c) ----------------------------------------------------------

/**
 * Pemantau duplikat DALAM file: membandingkan antar baris berbeda saja
 * (baris sendiri tidak ikut diperiksa) dan mengisi Set SETELAH pemeriksaan.
 * Tanpa peka huruf besar-kecil.
 */
export class PemantauUnik {
  private readonly terlihat = new Map<string, number>();

  constructor(private readonly label: string) {}

  /**
   * Lempar 409 bila kunci sudah dipakai baris lain; kunci selalu diingat.
   * `kolom` mengisi konteks kolom pada GalatImpor (tabel detail: Kolom | Nilai | Alasan).
   */
  cek(kunciMentah: string, nomor: number, kolom?: string | null): void {
    const kunci = teksKode(kunciMentah).toLowerCase();
    if (!kunci) return;
    const sebelum = this.terlihat.get(kunci);
    if (sebelum !== undefined && sebelum !== nomor) {
      throw new GalatImpor(
        kolom ?? null,
        `${this.label} "${teksKode(kunciMentah)}" kembar dalam file (baris ${sebelum}).`,
        kunciMentah,
      );
    }
    this.terlihat.set(kunci, nomor);
  }
}

/** Cek duplikat terhadap database dengan pembanding tanpa peka huruf. */
export async function adaDiDb(tabel: 'products' | 'categories' | 'brands' | 'units' | 'packs' | 'warehouses', kolom: string, nilai: string): Promise<{ id: number } | undefined> {
  return await get<{ id: number }>(
    `SELECT id FROM ${tabel} WHERE ${kolom} ILIKE ?${tabel === 'products' ? ' AND deleted_at IS NULL' : ''}`,
    nilai,
  );
}

/**
 * Cek referensi (kategori, merek, satuan, gudang) yang belum ada.
 * Dengan `buat_otomatis` aktif → mengembalikan null (modul membuatnya saat
 * konfirmasi & mencatat peringatan); tanpa opsi itu → melempar error.
 */
export async function resolusiReferensi(params: {
  nomor: number;
  tabel: 'categories' | 'brands' | 'units' | 'warehouses';
  kolomTabel: string;
  nilai: string;
  label: string;
  buatOtomatis: boolean;
  kumpul: PengumpulImpor;
}): Promise<number | null> {
  const { tabel, kolomTabel, nilai, label, buatOtomatis, kumpul, nomor } = params;
  const baris = await get<{ id: number }>(
    `SELECT id FROM ${tabel} WHERE ${kolomTabel} ILIKE ?`,
    nilai,
  );
  if (baris) return Number(baris.id);
  if (!buatOtomatis) {
    throw new GalatImpor(label.toLowerCase(), `${label} "${nilai}" tidak ditemukan.`, nilai);
  }
  kumpul.ingatkan(nomor, label.toLowerCase(), `${label} "${nilai}" belum ada — akan dibuat otomatis.`);
  return null;
}

// --- Batch & penyimpanan error ------------------------------------------------

export async function simpanErrorBatch(batchId: number, kesalahan: KesalahanImpor[]): Promise<void> {
  for (const e of kesalahan) {
    await run(
      `INSERT INTO import_errors (batch_id, nomor_baris, kolom, pesan, nilai) VALUES (?, ?, ?, ?, ?)`,
      batchId,
      e.nomor_baris,
      e.kolom,
      e.pesan,
      e.nilai,
    );
  }
}

/** Jejak "Urungkan impor" per baris. */
export interface JejakUrung {
  aksi: 'tambah' | 'perbarui';
  tabel: string;
  id: number;
  /** Baris SEBELUM perubahan (untuk 'perbarui') — dipulihkan saat diurungkan. */
  sebelum?: Record<string, unknown> | null;
  /** Tabel turunan yang ikut dipulihkan (mis. pack_items). */
  turunan?: { tabel: string; baris: Record<string, unknown>[]; kunciInduk: string }[];
}

/** Potong jejak agar penyimpanan tetap wajar untuk file besar. */
export function jejakUrungAman(jejak: JejakUrung[]): string {
  const teks = JSON.stringify(jejak);
  if (teks.length <= 2_000_000) return teks; // ~2 MB cukup untuk ribuan baris
  return JSON.stringify([]);
}

/**
 * Balikkan jejak impor: baris 'tambah' dihapus, baris 'perbarui' dipulihkan ke
 * isi sebelumnya, dan tabel turunan (mis. pack_items) ikut dipulihkan.
 * Mengembalikan jumlah baris yang dikembalikan. Aman dipanggil dalam transaksi.
 */
export async function urungkanJejak(jejak: JejakUrung[]): Promise<number> {
  let kembali = 0;
  for (const j of [...jejak].reverse()) {
    // Turunan: pulihkan daftar lama (kunci induk = id baris ini).
    for (const t of j.turunan ?? []) {
      await run(`DELETE FROM ${t.tabel} WHERE ${t.kunciInduk} = ?`, j.id);
      for (const baris of t.baris) {
        const kolom = Object.keys(baris);
        if (!kolom.length) continue;
        await run(
          `INSERT INTO ${t.tabel} (${kolom.join(', ')}) VALUES (${kolom.map(() => '?').join(', ')})`,
          ...kolom.map((k) => baris[k]),
        );
      }
    }
    if (j.aksi === 'tambah') {
      if (await get<{ id: number }>(`SELECT id FROM ${j.tabel} WHERE id = ?`, j.id)) {
        // Turunan ikut terhapus lebih dulu (hormati FK bila tanpa ON DELETE CASCADE).
        for (const t of j.turunan ?? []) await run(`DELETE FROM ${t.tabel} WHERE ${t.kunciInduk} = ?`, j.id);
        await run(`DELETE FROM ${j.tabel} WHERE id = ?`, j.id);
        kembali++;
      }
    } else if (j.sebelum) {
      const kolom = Object.keys(j.sebelum).filter((k) => k !== 'id');
      if (kolom.length) {
        await run(
          `UPDATE ${j.tabel} SET ${kolom.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
          ...kolom.map((k) => j.sebelum![k]),
          j.id,
        );
        kembali++;
      }
    }
  }
  return kembali;
}

// --- Debug mode pengembang (AB1) ---------------------------------------------

/**
 * Cetak 5 baris pertama beserta hasil validasi tiap aturan, nilai mentah dan
 * ternormalisasi, serta tipe datanya — hanya bila env UJI_IMPOR_DEBUG=1
 * (dipasang otomatis pada mode dev oleh skrip uji).
 */
export function cetakDebugImpor(
  konteks: string,
  baris: Record<string, unknown>[],
  perBaris?: (baris: Record<string, unknown>, nomor: number) => void,
): void {
  if (process.env.UJI_IMPOR_DEBUG !== '1') return;
  // eslint-disable-next-line no-console
  console.log(`\n[impor:debug] ${konteks} — ${Math.min(5, baris.length)} baris pertama:`);
  baris.slice(0, 5).forEach((b, i) => {
    const nomor = nomorBaris(i);
    // eslint-disable-next-line no-console
    console.log(`  #${nomor}`, JSON.stringify(b));
    for (const [k, v] of Object.entries(b)) {
      // eslint-disable-next-line no-console
      console.log(
        `      ${k}: mentah=${JSON.stringify(v)} ternormalisasi=${JSON.stringify(teksKode(v))} tipe=${v === null ? 'null' : typeof v}`,
      );
    }
    try {
      perBaris?.(b, nomor);
      // eslint-disable-next-line no-console
      console.log('      → validasi: LULUS');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log('      → validasi:', (err as Error).message);
    }
  });
}

/** Ringkasan modul untuk riwayat impor (Pengaturan ▸ Impor/Ekspor). */
export async function daftarModulImporTersedia(): Promise<{ kode: string; label: string }[]> {
  return await all<{ kode: string; label: string }>(
    `SELECT DISTINCT modul AS kode, modul AS label FROM import_batches ORDER BY modul`,
  );
}

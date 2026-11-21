// ============================================================================
// AKUNTANSI DASAR (pengganti modul akuntansi lama: COA, jurnal, buku besar,
// neraca, penutupan periode).
//   a. Kas & Bank       — CRUD rekening, mutasi kas masuk/keluar/transfer
//   b. Pengeluaran/Biaya — catat biaya operasional per kategori & rekening kas
//   c. Pemasukan Lain    — catat pendapatan di luar penjualan per kategori
//   d. Piutang           — daftar dari penjualan tempo, bayar sebagian/lunas
//   e. Hutang            — daftar dari pembelian tempo, bayar sebagian/lunas
//   f. Laporan Dasar     — Kas & Bank, Laba Rugi Sederhana, Rekap Piutang/Hutang
// Tanpa debit/kredit, tanpa Bagan Akun, tanpa jurnal. Saldo kas dihitung dari
// saldo awal + mutasi (lib/dasarKas). Piutang/hutang memakai tabel
// receivables/payables yang sudah ada (tidak diubah).
// ============================================================================
import { Router } from 'express';
import { all, get, run, withTransaction } from '../db.pg.ts';
import { asyncHandler, bacaPaginasi, polaCari, tolak } from '../lib/http.ts';
import { penggunaSaatIni } from '../lib/akses.ts';
import {
  akunKas,
  akunKasMetode,
  batalkanMutasiKasSumber,
  catatMutasiKas,
  daftarAkunKas,
  METODE_BAYAR,
  rekeningDefaultId,
  saldoKas,
  setRekeningDefault,
  tautkanMetode,
} from '../lib/dasarKas.ts';
import { catatAudit } from '../lib/audit.ts';
import { tulisExcel, tulisExcelMulti } from '../lib/excel.ts';

type Baris = Record<string, unknown>;
const bulat = (n: unknown): number => Math.round(Number(n) || 0);

export function routerAkuntansi(): Router {
  const r = Router();
  // AX — hak akses murni dari matriks (modul akuntansi); middleware global
  // wajibModul memetakan tiap rute ke selnya (lihat/tambah/ubah/hapus/sahkan).

  // ==========================================================================
  // a. KAS & BANK — daftar rekening + saldo
  // ==========================================================================

  // Metode bayar yang dikirim klien: hanya tunai/transfer/qris yang disimpan
  // (ejaan EDC/Debit dari UI diterjemahkan ke 'qris').
  const ALIAS_METODE: Record<string, string> = { edc: 'qris', debit: 'qris', 'e-wallet': 'qris' };
  function bacaMetode(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    const hasil: string[] = [];
    for (const x of v) {
      const m = String(x).trim().toLowerCase();
      const kunci = ALIAS_METODE[m] ?? m;
      if ((METODE_BAYAR as readonly string[]).includes(kunci) && !hasil.includes(kunci)) hasil.push(kunci);
    }
    return hasil;
  }

  /** Kode rekening otomatis bila pengguna tidak mengisinya (KAS-001, BANK-002, …). */
  async function kodeAkunOtomatis(jenis: string): Promise<string> {
    const awalan = jenis === 'bank' ? 'BANK' : jenis === 'e-wallet' ? 'EWAL' : 'KAS';
    for (let i = 1; i <= 999; i++) {
      const kandidat = `${awalan}-${String(i).padStart(3, '0')}`;
      if (!await get(`SELECT id FROM cash_accounts WHERE kode = ?`, kandidat)) return kandidat;
    }
    return `${awalan}-${Date.now()}`;
  }

  // Samakan pemetaan metode + rekening default sesudah simpan rekening.
  async function simpanPemetaan(id: number, b: Record<string, unknown>): Promise<string[]> {
    const metode = bacaMetode(b.metode);
    if (Array.isArray(b.metode)) {
      await run(`DELETE FROM payment_method_accounts WHERE cash_account_id = ?`, id);
      for (const m of metode) await tautkanMetode(m, id);
    }
    if (b.default_pembayaran === true) await setRekeningDefault(id);
    else if (b.default_pembayaran === false && (await rekeningDefaultId()) === id) await setRekeningDefault(null);
    return metode;
  }

  // Daftar rekening kas/bank dengan saldo sekarang, metode bayar yang diwakili,
  // dan penanda rekening default pembayaran hutang/piutang.
  r.get(
    '/kas/akun',
    asyncHandler(async (_req, res) => {
      const defaultId = await rekeningDefaultId();
      const daftar = await Promise.all((await daftarAkunKas(false)).map(async (a) => ({
        ...a,
        saldo: await saldoKas(a.id),
        metode: (await all<{ metode: string }>(
          `SELECT metode FROM payment_method_accounts WHERE cash_account_id = ? ORDER BY metode`,
          a.id,
        )).map((m) => m.metode),
        default: a.id === defaultId,
      })));
      res.json({ data: daftar });
    }),
  );

  // Tambah rekening kas/bank.
  r.post(
    '/kas/akun',
    asyncHandler(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const nama = String(b.nama ?? '').trim();
      const jenis = String(b.jenis ?? 'kas');
      const saldoAwal = bulat(b.saldo_awal);
      if (!nama) throw tolak(400, 'Nama rekening wajib diisi.');
      if (!['kas', 'bank', 'e-wallet'].includes(jenis)) throw tolak(400, 'Jenis rekening harus kas, bank, atau e-wallet.');
      const kode = String(b.kode ?? '').trim() || await kodeAkunOtomatis(jenis);
      if (await get(`SELECT id FROM cash_accounts WHERE kode = ?`, kode)) throw tolak(409, `Kode rekening "${kode}" sudah dipakai.`);
      const pengguna = penggunaSaatIni(req);
      const id = Number(
        await ((await run(
          `INSERT INTO cash_accounts (kode, nama, jenis, saldo_awal, aktif, dibuat_oleh) VALUES (?, ?, ?, ?, TRUE, ?)`,
          kode,
          nama,
          jenis,
          saldoAwal,
          pengguna.id,
        ))).lastInsertRowid,
      );
      const metode = await simpanPemetaan(id, b);
      await catatAudit({ userId: pengguna.id, aksi: 'tambah', tabel: 'cash_accounts', recordId: id, sesudah: { kode, nama, jenis, saldo_awal: saldoAwal, metode } });
      res.status(201).json({ ok: true, id, kode, metode });
    }),
  );

  // Ubah rekening (nama/jenis/saldo awal/nonaktif).
  r.put(
    '/kas/akun/:id',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const lama = await get<Baris>(`SELECT * FROM cash_accounts WHERE id = ?`, id);
      if (!lama) throw tolak(404, 'Rekening tidak ditemukan.');
      const b = (req.body ?? {}) as Record<string, unknown>;
      const kode = String(b.kode ?? lama.kode).trim();
      const nama = String(b.nama ?? lama.nama).trim();
      const jenis = String(b.jenis ?? lama.jenis);
      const saldoAwal = b.saldo_awal !== undefined ? bulat(b.saldo_awal) : Number(lama.saldo_awal);
      const aktif = b.aktif !== undefined ? (Number(b.aktif) ? 1 : 0) : Number(lama.aktif);
      if (!kode || !nama) throw tolak(400, 'Kode dan nama rekening wajib diisi.');
      if (!['kas', 'bank', 'e-wallet'].includes(jenis)) throw tolak(400, 'Jenis rekening harus kas, bank, atau e-wallet.');
      if (await get(`SELECT id FROM cash_accounts WHERE kode = ? AND id <> ?`, kode, id)) throw tolak(409, `Kode rekening "${kode}" sudah dipakai.`);
      const pengguna = penggunaSaatIni(req);
      await run(
        `UPDATE cash_accounts SET kode = ?, nama = ?, jenis = ?, saldo_awal = ?, aktif = ? WHERE id = ?`,
        kode,
        nama,
        jenis,
        saldoAwal,
        aktif,
        id,
      );
      const metode = await simpanPemetaan(id, b);
      await catatAudit({ userId: pengguna.id, aksi: 'ubah', tabel: 'cash_accounts', recordId: id, sebelum: lama, sesudah: { kode, nama, jenis, saldo_awal: saldoAwal, aktif, metode } });
      res.json({ ok: true, metode });
    }),
  );

  // Nonaktifkan (soft) rekening kas.
  r.delete(
    '/kas/akun/:id',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const lama = await get<Baris>(`SELECT * FROM cash_accounts WHERE id = ?`, id);
      if (!lama) throw tolak(404, 'Rekening tidak ditemukan.');
      const dipakai = Number(await ((await get<{ n: number }>(`SELECT COUNT(*) AS n FROM cash_transactions WHERE cash_account_id = ? OR cash_account_tujuan_id = ?`, id, id)))?.n ?? 0);
      const pengguna = penggunaSaatIni(req);
      // Rekening bergerak tidak bisa dihapus permanen — hanya dinonaktifkan.
      await run(`UPDATE cash_accounts SET aktif = FALSE WHERE id = ?`, id);
      await catatAudit({ userId: pengguna.id, aksi: 'nonaktifkan', tabel: 'cash_accounts', recordId: id, sebelum: lama, sesudah: { aktif: 0 }, alasan: dipakai > 0 ? `Rekening dipakai ${dipakai} mutasi — dinonaktifkan, bukan dihapus.` : undefined });
      res.json({ ok: true, dinonaktifkan: true, jumlah_mutasi: dipakai });
    }),
  );

  // Daftar mutasi kas (rinci, semua rekening) dengan filter tanggal & rekening.
  r.get(
    '/kas/mutasi',
    asyncHandler(async (req, res) => {
      const p = bacaPaginasi(req, { urutBawaan: 'tanggal', arahBawaan: 'DESC', urutDiizinkan: ['tanggal', 'nomor', 'jumlah'] });
      const s: string[] = [];
      const a: unknown[] = [];
      const dari = String(req.query.dari ?? '').trim();
      const sampai = String(req.query.sampai ?? '').trim();
      if (dari) { s.push('t.tanggal >= ?'); a.push(dari); }
      if (sampai) { s.push('t.tanggal <= ?'); a.push(sampai); }
      const akunId = Number(req.query.akun_id ?? 0);
      if (akunId) { s.push('(t.cash_account_id = ? OR t.cash_account_tujuan_id = ?)'); a.push(akunId, akunId); }
      const tipe = String(req.query.tipe ?? '').trim();
      if (tipe && ['masuk', 'keluar', 'transfer'].includes(tipe)) { s.push('t.tipe = ?'); a.push(tipe); }
      if (p.cari) { s.push('(t.nomor ILIKE ? OR t.keterangan ILIKE ?)'); a.push(polaCari(p.cari), polaCari(p.cari)); }
      const where = s.length ? `WHERE ${s.join(' AND ')}` : '';

      const rows = await all<Baris>(
        `SELECT t.id, t.tipe, t.tanggal, t.nomor, t.jumlah, t.keterangan, t.sumber_tipe, t.sumber_id,
                ca.kode AS akun_kode, ca.nama AS akun_nama,
                ct.kode AS tujuan_kode, ct.nama AS tujuan_nama,
                ec.nama AS kategori, u.nama AS pembuat
         FROM cash_transactions t
         JOIN cash_accounts ca ON ca.id = t.cash_account_id
         LEFT JOIN cash_accounts ct ON ct.id = t.cash_account_tujuan_id
         LEFT JOIN expense_categories ec ON ec.id = t.category_id
         LEFT JOIN users u ON u.id = t.dibuat_oleh
         ${where}
         ORDER BY t.tanggal ${p.arah}, t.id ${p.arah}
         LIMIT ? OFFSET ?`,
        ...a,
        p.per,
        p.offset,
      );
      const total = Number(await ((await get<{ n: number }>(`SELECT COUNT(*) AS n FROM cash_transactions t ${where}`, ...a)))?.n ?? 0);
      res.json({ data: rows, total, hal: p.hal, per: p.per });
    }),
  );

  // Catat kas masuk (manual).
  r.post(
    '/kas/masuk',
    asyncHandler(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const pengguna = penggunaSaatIni(req);
      const id = await withTransaction(async () => {
        const idKas = await catatMutasiKas({
          tipe: 'masuk',
          tanggal: b.tanggal ? String(b.tanggal) : undefined,
          akunId: Number(b.akun_id),
          kategoriId: b.kategori_id ? Number(b.kategori_id) : null,
          jumlah: bulat(b.jumlah),
          keterangan: b.keterangan ? String(b.keterangan) : null,
          dibuatOleh: pengguna.id,
        });
        await catatAudit({ userId: pengguna.id, aksi: 'tambah', tabel: 'cash_transactions', recordId: idKas, sesudah: { tipe: 'masuk', jumlah: bulat(b.jumlah), akun_id: Number(b.akun_id) } });
        return idKas;
      });
      res.status(201).json({ ok: true, id });
    }),
  );

  // Catat kas keluar (manual).
  r.post(
    '/kas/keluar',
    asyncHandler(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const pengguna = penggunaSaatIni(req);
      const id = await withTransaction(async () => {
        const idKas = await catatMutasiKas({
          tipe: 'keluar',
          tanggal: b.tanggal ? String(b.tanggal) : undefined,
          akunId: Number(b.akun_id),
          kategoriId: b.kategori_id ? Number(b.kategori_id) : null,
          jumlah: bulat(b.jumlah),
          keterangan: b.keterangan ? String(b.keterangan) : null,
          dibuatOleh: pengguna.id,
        });
        await catatAudit({ userId: pengguna.id, aksi: 'tambah', tabel: 'cash_transactions', recordId: idKas, sesudah: { tipe: 'keluar', jumlah: bulat(b.jumlah), akun_id: Number(b.akun_id) } });
        return idKas;
      });
      res.status(201).json({ ok: true, id });
    }),
  );

  // Transfer antar rekening kas/bank.
  r.post(
    '/kas/transfer',
    asyncHandler(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const pengguna = penggunaSaatIni(req);
      const id = await withTransaction(async () => {
        const idKas = await catatMutasiKas({
          tipe: 'transfer',
          tanggal: b.tanggal ? String(b.tanggal) : undefined,
          akunId: Number(b.akun_id),
          akunTujuanId: Number(b.akun_tujuan_id),
          jumlah: bulat(b.jumlah),
          keterangan: b.keterangan ? String(b.keterangan) : 'Transfer antar kas/bank',
          dibuatOleh: pengguna.id,
        });
        await catatAudit({ userId: pengguna.id, aksi: 'tambah', tabel: 'cash_transactions', recordId: idKas, sesudah: { tipe: 'transfer', jumlah: bulat(b.jumlah), dari: Number(b.akun_id), ke: Number(b.akun_tujuan_id) } });
        return idKas;
      });
      res.status(201).json({ ok: true, id });
    }),
  );

  // ==========================================================================
  // b & c. PENGELORUAN/BIAYA dan PEMASUKAN LAIN (kategori + mutasi kas)
  // ==========================================================================

  // Kategori pengeluaran & pemasukan (tambah/ubah/nonaktif).
  r.get(
    '/kategori',
    asyncHandler(async (req, res) => {
      const tipe = String(req.query.tipe ?? '').trim();
      const rows = await all<Baris>(
        `SELECT id, nama, tipe, aktif FROM expense_categories
         ${tipe && ['pengeluaran', 'pemasukan'].includes(tipe) ? 'WHERE tipe = ?' : ''}
         ORDER BY tipe, nama`,
        ...(tipe && ['pengeluaran', 'pemasukan'].includes(tipe) ? [tipe] : []),
      );
      res.json({ data: rows });
    }),
  );

  r.post(
    '/kategori',
    asyncHandler(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const nama = String(b.nama ?? '').trim();
      const tipe = String(b.tipe ?? '');
      if (!nama) throw tolak(400, 'Nama kategori wajib diisi.');
      if (!['pengeluaran', 'pemasukan'].includes(tipe)) throw tolak(400, 'Tipe kategori harus pengeluaran atau pemasukan.');
      if (await get(`SELECT id FROM expense_categories WHERE nama = ? AND tipe = ?`, nama, tipe)) {
        throw tolak(409, `Kategori "${nama}" sudah ada.`);
      }
      const id = Number(await ((await run(`INSERT INTO expense_categories (nama, tipe) VALUES (?, ?)`, nama, tipe))).lastInsertRowid);
      const pengguna = penggunaSaatIni(req);
      await catatAudit({ userId: pengguna.id, aksi: 'tambah', tabel: 'expense_categories', recordId: id, sesudah: { nama, tipe } });
      res.status(201).json({ ok: true, id });
    }),
  );

  r.delete(
    '/kategori/:id',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const lama = await get<Baris>(`SELECT * FROM expense_categories WHERE id = ?`, id);
      if (!lama) throw tolak(404, 'Kategori tidak ditemukan.');
      const dipakai = Number(await ((await get<{ n: number }>(`SELECT COUNT(*) AS n FROM cash_transactions WHERE category_id = ?`, id)))?.n ?? 0);
      const pengguna = penggunaSaatIni(req);
      if (dipakai > 0) {
        await run(`UPDATE expense_categories SET aktif = FALSE WHERE id = ?`, id);
        await catatAudit({ userId: pengguna.id, aksi: 'nonaktifkan', tabel: 'expense_categories', recordId: id, sebelum: lama, sesudah: { aktif: 0 }, alasan: `Dipakai ${dipakai} transaksi — dinonaktifkan.` });
        res.json({ ok: true, dinonaktifkan: true, jumlah_transaksi: dipakai });
        return;
      }
      await run(`DELETE FROM expense_categories WHERE id = ?`, id);
      await catatAudit({ userId: pengguna.id, aksi: 'hapus', tabel: 'expense_categories', recordId: id, sebelum: lama });
      res.json({ ok: true });
    }),
  );

  // Catat pengeluaran/biaya (kas keluar + kategori pengeluaran).
  r.post(
    '/pengeluaran',
    asyncHandler(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const kategori = b.kategori_id ? Number(b.kategori_id) : null;
      if (!kategori) throw tolak(400, 'Pilih kategori pengeluaran.');
      const kategoriRow = await get<{ tipe: string }>(`SELECT tipe FROM expense_categories WHERE id = ?`, kategori);
      if (!kategoriRow) throw tolak(404, 'Kategori pengeluaran tidak ditemukan.');
      if (kategoriRow.tipe !== 'pengeluaran') throw tolak(400, 'Kategori bukan bertipe pengeluaran.');
      const pengguna = penggunaSaatIni(req);
      const id = await withTransaction(async () => {
        const idKas = await catatMutasiKas({
          tipe: 'keluar',
          tanggal: b.tanggal ? String(b.tanggal) : undefined,
          akunId: Number(b.akun_id),
          kategoriId: kategori,
          jumlah: bulat(b.jumlah),
          keterangan: b.keterangan ? String(b.keterangan) : null,
          dibuatOleh: pengguna.id,
        });
        await catatAudit({ userId: pengguna.id, aksi: 'tambah', tabel: 'cash_transactions', recordId: idKas, sesudah: { tipe: 'keluar', kategori_id: kategori, jumlah: bulat(b.jumlah) } });
        return idKas;
      });
      res.status(201).json({ ok: true, id });
    }),
  );

  // Catat pemasukan lain (kas masuk + kategori pemasukan).
  r.post(
    '/pemasukan',
    asyncHandler(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const kategori = b.kategori_id ? Number(b.kategori_id) : null;
      if (!kategori) throw tolak(400, 'Pilih kategori pemasukan.');
      const kategoriRow = await get<{ tipe: string }>(`SELECT tipe FROM expense_categories WHERE id = ?`, kategori);
      if (!kategoriRow) throw tolak(404, 'Kategori pemasukan tidak ditemukan.');
      if (kategoriRow.tipe !== 'pemasukan') throw tolak(400, 'Kategori bukan bertipe pemasukan.');
      const pengguna = penggunaSaatIni(req);
      const id = await withTransaction(async () => {
        const idKas = await catatMutasiKas({
          tipe: 'masuk',
          tanggal: b.tanggal ? String(b.tanggal) : undefined,
          akunId: Number(b.akun_id),
          kategoriId: kategori,
          jumlah: bulat(b.jumlah),
          keterangan: b.keterangan ? String(b.keterangan) : null,
          dibuatOleh: pengguna.id,
        });
        await catatAudit({ userId: pengguna.id, aksi: 'tambah', tabel: 'cash_transactions', recordId: idKas, sesudah: { tipe: 'masuk', kategori_id: kategori, jumlah: bulat(b.jumlah) } });
        return idKas;
      });
      res.status(201).json({ ok: true, id });
    }),
  );

  // ==========================================================================
  // d & e. PIUTANG & HUTANG (daftar + pembayaran parsial/lunas)
  // ==========================================================================

  async function daftarTagihan(tipe: 'piutang' | 'hutang'): Promise<Baris> {
    const tabel = tipe === 'piutang' ? 'receivables' : 'payables';
    const join =
      tipe === 'piutang'
        ? 'JOIN sales s ON s.id = rc.sale_id LEFT JOIN customers c ON c.id = rc.customer_id'
        : 'JOIN purchases p ON p.id = py.purchase_id LEFT JOIN suppliers c ON c.id = py.supplier_id';
    const alias = tipe === 'piutang' ? 'rc' : 'py';
    const rows = await all<Baris>(
      `SELECT ${alias}.id, ${alias}.jatuh_tempo, ${alias}.total, ${alias}.terbayar, ${alias}.status,
              ${tipe === 'piutang' ? 's' : 'p'}.no_dokumen,
              ${tipe === 'piutang' ? 's.tanggal AS tanggal_dok, s.id AS dokumen_id' : 'p.tanggal AS tanggal_dok, p.id AS dokumen_id'},
              c.nama AS entitas, c.telepon AS entitas_telepon,
              (${alias}.total - ${alias}.terbayar) AS sisa
       FROM ${tabel} ${alias}
       ${join}
       WHERE ${alias}.status IN ('belum', 'sebagian')
       ORDER BY ${alias}.jatuh_tempo IS NULL, ${alias}.jatuh_tempo ASC, ${alias}.id ASC`,
    );
    const hari = (t: string): number => Math.floor((Date.now() - new Date(`${t.slice(0, 10)}T00:00:00`).getTime()) / 86400000);
    const ember = { '0-30': 0, '31-60': 0, '61-90': 0, '>90': 0 } as Record<string, number>;
    let totalSisa = 0;
    const baris = rows.map((x) => {
      const umur = hari(String(x.tanggal_dok));
      const bucket = umur <= 30 ? '0-30' : umur <= 60 ? '31-60' : umur <= 90 ? '61-90' : '>90';
      ember[bucket] += Number(x.sisa);
      totalSisa += Number(x.sisa);
      const tempo = x.jatuh_tempo ? String(x.jatuh_tempo).slice(0, 10) : null;
      const telat = tempo ? Math.max(0, hari(tempo)) : 0;
      return { ...x, umur_hari: umur, umur_ember: bucket, telat_hari: telat };
    });
    return { baris, aging: ember, total_sisa: totalSisa, total_tagihan: rows.length };
  }

  r.get('/piutang', asyncHandler(async (_req, res) => res.json(await daftarTagihan('piutang'))));
  r.get('/hutang', asyncHandler(async (_req, res) => res.json(await daftarTagihan('hutang'))));

  // Riwayat pembayaran satu tagihan (tanpa akun COA — pakai rekening kas).
  r.get(
    '/pembayaran/:tipe/:id',
    asyncHandler(async (req, res) => {
      const tipe = req.params.tipe === 'piutang' ? 'piutang' : req.params.tipe === 'hutang' ? 'hutang' : null;
      if (!tipe) throw tolak(400, 'Tipe tagihan tidak dikenal (piutang|hutang).');
      const id = Number(req.params.id);
      const rows = await all<Baris>(
        `SELECT py.id, py.tanggal, py.jumlah, ca.kode AS akun_kode, ca.nama AS akun_nama, u.nama AS pembuat
         FROM payments py LEFT JOIN cash_accounts ca ON ca.id = py.akun_kas_id LEFT JOIN users u ON u.id = py.dibuat_oleh
         WHERE py.tipe = ? AND py.referensi_id = ? ORDER BY py.id DESC`,
        tipe,
        id,
      );
      res.json({ data: rows });
    }),
  );

  // Bayar piutang/hutang (parsial/lunas): perbarui terbayar + payments + kas.
  const bayarTagihan = (tipe: 'piutang' | 'hutang') =>
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const b = (req.body ?? {}) as Record<string, unknown>;
      const jumlah = bulat(b.jumlah);
      if (jumlah <= 0) throw tolak(400, 'Jumlah pembayaran tidak valid.');
      const metode = String(b.metode ?? 'tunai');
      const akun = await akunKasMetode(metode === 'kredit' ? 'tunai' : metode);
      if (!akun) throw tolak(409, `Metode bayar "${metode}" belum ditautkan ke rekening kas. Tambahkan rekening Kas & Bank, lalu tautkan metodenya di Pengaturan ▸ Kas & Bank.`);
      const tabel = tipe === 'piutang' ? 'receivables' : 'payables';
      const alias = tipe === 'piutang' ? 'rc' : 'py';
      const join = tipe === 'piutang' ? 'sales s ON s.id = rc.sale_id' : 'purchases p ON p.id = py.purchase_id';
      const pengguna = penggunaSaatIni(req);

      const hasil = await withTransaction(async () => {
        const row = await get<{ id: number; total: number; terbayar: number; status: string; no_dokumen: string }>(
          `SELECT ${alias}.id, ${alias}.total, ${alias}.terbayar, ${alias}.status, ${tipe === 'piutang' ? 's' : 'p'}.no_dokumen
           FROM ${tabel} ${alias} JOIN ${join} WHERE ${alias}.id = ?`,
          id,
        );
        if (!row) throw tolak(404, 'Tagihan tidak ditemukan.');
        if (row.status === 'lunas') throw tolak(409, 'Tagihan sudah lunas.');
        if (row.status === 'batal') throw tolak(409, 'Tagihan dibatalkan.');
        const sisa = Number(row.total) - Number(row.terbayar);
        if (jumlah > sisa + 0.5) throw tolak(400, `Jumlah melebihi sisa tagihan (${Math.round(sisa)}).`);

        const terbayarBaru = Number(row.terbayar) + jumlah;
        const statusBaru = terbayarBaru >= Number(row.total) - 0.5 ? 'lunas' : 'sebagian';
        await run(
          `UPDATE ${tabel} SET terbayar = ?, status = ?, diubah_pada = now() WHERE id = ?`,
          terbayarBaru,
          statusBaru,
          id,
        );
        const bayarId = Number(
          await ((await run(
            `INSERT INTO payments (tipe, referensi_id, tanggal, jumlah, akun_kas_id, dibuat_oleh) VALUES (?, ?, CURRENT_DATE, ?, ?, ?)`,
            tipe,
            id,
            jumlah,
            akun.id,
            pengguna.id,
          ))).lastInsertRowid,
        );
        const keterangan = tipe === 'piutang' ? `Pelunasan piutang ${row.no_dokumen}` : `Pembayaran hutang ${row.no_dokumen}`;
        // Kas bergerak: piutang masuk kas, hutang keluar kas.
        await catatMutasiKas({
          tipe: tipe === 'piutang' ? 'masuk' : 'keluar',
          akunId: akun.id,
          jumlah,
          keterangan,
          sumberTipe: 'pembayaran',
          sumberId: bayarId,
          dibuatOleh: pengguna.id,
        });
        await catatAudit({ userId: pengguna.id, aksi: 'ubah', tabel, recordId: id, sesudah: { terbayar: terbayarBaru, status: statusBaru } });
        return { id: bayarId, status: statusBaru, sisa: Number(row.total) - terbayarBaru };
      });
      res.status(201).json({ ok: true, ...hasil });
    });

  r.post('/piutang/:id/bayar', bayarTagihan('piutang'));
  r.post('/hutang/:id/bayar', bayarTagihan('hutang'));

  // ==========================================================================
  // f. LAPORAN DASAR — Kas & Bank, Laba Rugi Sederhana, Rekap Piutang/Hutang
  // ==========================================================================

  // Laporan Kas & Bank: saldo awal, masuk, keluar, saldo akhir per rekening.
  async function laporanKasBank(dari: string, sampai: string): Promise<Baris> {
    const akun = await Promise.all((await daftarAkunKas(false)).map(async (a) => {
      const saldoAwal = await saldoKas(a.id, dari < '0001-01-01' ? undefined : hariSebelum(dari));
      const saldoAkhir = await saldoKas(a.id, sampai);
      const mut = await get<{ masuk: number; keluar: number }>(
        `SELECT
           COALESCE(SUM(CASE WHEN tipe = 'masuk' OR (tipe = 'transfer' AND cash_account_tujuan_id = ?) THEN jumlah ELSE 0 END), 0) AS masuk,
           COALESCE(SUM(CASE WHEN tipe = 'keluar' OR (tipe = 'transfer' AND cash_account_id = ?) THEN jumlah ELSE 0 END), 0) AS keluar
         FROM cash_transactions
         WHERE (cash_account_id = ? OR cash_account_tujuan_id = ?) AND tanggal BETWEEN ? AND ?`,
        a.id,
        a.id,
        a.id,
        a.id,
        dari,
        sampai,
      );
      return {
        kode: a.kode,
        nama: a.nama,
        jenis: a.jenis,
        saldo_awal: saldoAwal,
        masuk: Number(mut?.masuk ?? 0),
        keluar: Number(mut?.keluar ?? 0),
        saldo_akhir: saldoAkhir,
      };
    }));
    const total = akun.reduce(
      (n, a) => ({
        saldo_awal: n.saldo_awal + Number(a.saldo_awal),
        masuk: n.masuk + Number(a.masuk),
        keluar: n.keluar + Number(a.keluar),
        saldo_akhir: n.saldo_akhir + Number(a.saldo_akhir),
      }),
      { saldo_awal: 0, masuk: 0, keluar: 0, saldo_akhir: 0 },
    );
    return { dari, sampai, akun, total };
  }

  // Laba Rugi Sederhana per periode.
  async function laporanLabaRugi(dari: string, sampai: string): Promise<Baris> {
    const penjualan = Number(
      await ((await get<{ v: number }>(
        `SELECT COALESCE(SUM(s.subtotal - s.diskon), 0) AS v FROM sales s
         WHERE s.status = 'disahkan' AND s.tanggal BETWEEN ? AND ?`,
        dari,
        sampai,
      )))?.v ?? 0,
    );
    const retur = Number(
      await ((await get<{ v: number }>(
        `SELECT COALESCE(SUM(sr.total), 0) AS v FROM sale_returns sr
         WHERE sr.status = 'disahkan' AND sr.tanggal BETWEEN ? AND ?`,
        dari,
        sampai,
      )))?.v ?? 0,
    );
    const penjualanBersih = penjualan - retur;

    // HPP dari selisih harga jual vs harga beli produk terjual (sale_items.hpp).
    const hpp = Number(
      await ((await get<{ v: number }>(
        `SELECT COALESCE(SUM(si.hpp), 0) AS v FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         WHERE s.status = 'disahkan' AND s.tanggal BETWEEN ? AND ?`,
        dari,
        sampai,
      )))?.v ?? 0,
    );
    const labaKotor = penjualanBersih - hpp;

    const pengeluaran = Number(
      await ((await get<{ v: number }>(
        `SELECT COALESCE(SUM(t.jumlah), 0) AS v FROM cash_transactions t
         JOIN expense_categories ec ON ec.id = t.category_id
         WHERE t.tipe = 'keluar' AND ec.tipe = 'pengeluaran' AND t.tanggal BETWEEN ? AND ?`,
        dari,
        sampai,
      )))?.v ?? 0,
    );
    const pemasukanLain = Number(
      await ((await get<{ v: number }>(
        `SELECT COALESCE(SUM(t.jumlah), 0) AS v FROM cash_transactions t
         JOIN expense_categories ec ON ec.id = t.category_id
         WHERE t.tipe = 'masuk' AND ec.tipe = 'pemasukan' AND t.tanggal BETWEEN ? AND ?`,
        dari,
        sampai,
      )))?.v ?? 0,
    );
    const labaBersih = labaKotor - pengeluaran + pemasukanLain;

    const rincianPengeluaran = await all<Baris>(
      `SELECT ec.nama AS kategori, COALESCE(SUM(t.jumlah), 0) AS jumlah
       FROM cash_transactions t JOIN expense_categories ec ON ec.id = t.category_id
       WHERE t.tipe = 'keluar' AND ec.tipe = 'pengeluaran' AND t.tanggal BETWEEN ? AND ?
       GROUP BY ec.nama ORDER BY jumlah DESC`,
      dari,
      sampai,
    );
    const rincianPemasukan = await all<Baris>(
      `SELECT ec.nama AS kategori, COALESCE(SUM(t.jumlah), 0) AS jumlah
       FROM cash_transactions t JOIN expense_categories ec ON ec.id = t.category_id
       WHERE t.tipe = 'masuk' AND ec.tipe = 'pemasukan' AND t.tanggal BETWEEN ? AND ?
       GROUP BY ec.nama ORDER BY jumlah DESC`,
      dari,
      sampai,
    );

    return {
      dari,
      sampai,
      penjualan,
      retur,
      penjualan_bersih: penjualanBersih,
      hpp,
      laba_kotor: labaKotor,
      pengeluaran,
      pemasukan_lain: pemasukanLain,
      laba_bersih: labaBersih,
      rincian_pengeluaran: rincianPengeluaran,
      rincian_pemasukan: rincianPemasukan,
    };
  }

  // Rekap Piutang & Rekap Hutang per entitas.
  async function rekapPiutang(): Promise<Baris> {
    const rows = await all<Baris>(
      `SELECT c.nama AS entitas, COUNT(*) AS jumlah_tagihan,
              COALESCE(SUM(rc.total), 0) AS total,
              COALESCE(SUM(rc.terbayar), 0) AS terbayar,
              COALESCE(SUM(rc.total - rc.terbayar), 0) AS sisa
       FROM receivables rc JOIN sales s ON s.id = rc.sale_id LEFT JOIN customers c ON c.id = rc.customer_id
       WHERE rc.status IN ('belum', 'sebagian')
       GROUP BY c.nama ORDER BY sisa DESC`,
    );
    const total = rows.reduce((n, r) => n + Number(r.sisa), 0);
    return { baris: rows, total_sisa: total };
  }

  async function rekapHutang(): Promise<Baris> {
    const rows = await all<Baris>(
      `SELECT c.nama AS entitas, COUNT(*) AS jumlah_tagihan,
              COALESCE(SUM(py.total), 0) AS total,
              COALESCE(SUM(py.terbayar), 0) AS terbayar,
              COALESCE(SUM(py.total - py.terbayar), 0) AS sisa
       FROM payables py JOIN purchases p ON p.id = py.purchase_id LEFT JOIN suppliers c ON c.id = py.supplier_id
       WHERE py.status IN ('belum', 'sebagian')
       GROUP BY c.nama ORDER BY sisa DESC`,
    );
    const total = rows.reduce((n, r) => n + Number(r.sisa), 0);
    return { baris: rows, total_sisa: total };
  }

  const JENIS_LAPORAN = new Set(['kas-bank', 'laba-rugi', 'rekap-piutang', 'rekap-hutang']);

  r.get(
    '/laporan/:jenis',
    asyncHandler(async (req, res) => {
      const jenis = String(req.params.jenis);
      if (!JENIS_LAPORAN.has(jenis)) throw tolak(404, `Laporan "${jenis}" tidak dikenal (kas-bank|laba-rugi|rekap-piutang|rekap-hutang).`);
      const hariIni = new Date().toISOString().slice(0, 10);
      const dari = String(req.query.dari ?? `${new Date().getFullYear()}-01-01`);
      const sampai = String(req.query.sampai ?? hariIni);
      if (jenis === 'kas-bank') return res.json(await laporanKasBank(dari, sampai));
      if (jenis === 'laba-rugi') return res.json(await laporanLabaRugi(dari, sampai));
      if (jenis === 'rekap-piutang') return res.json(await rekapPiutang());
      return res.json(await rekapHutang());
    }),
  );

  // Ekspor Excel laporan dasar.
  r.get(
    '/laporan/:jenis/xlsx',
    asyncHandler(async (req, res) => {
      const jenis = String(req.params.jenis);
      if (!JENIS_LAPORAN.has(jenis)) throw tolak(404, `Laporan "${jenis}" tidak dikenal.`);
      const hariIni = new Date().toISOString().slice(0, 10);
      const dari = String(req.query.dari ?? `${new Date().getFullYear()}-01-01`);
      const sampai = String(req.query.sampai ?? hariIni);
      let nama = '';
      let kolom: { key: string; label: string }[] = [];
      let baris: Record<string, unknown>[] = [];

      if (jenis === 'kas-bank') {
        const l = await laporanKasBank(dari, sampai) as unknown as { akun: Record<string, unknown>[]; total: Record<string, number> };
        nama = `Kas & Bank ${dari} - ${sampai}`;
        kolom = [
          { key: 'kode', label: 'Kode' },
          { key: 'nama', label: 'Rekening' },
          { key: 'saldo_awal', label: 'Saldo Awal' },
          { key: 'masuk', label: 'Masuk' },
          { key: 'keluar', label: 'Keluar' },
          { key: 'saldo_akhir', label: 'Saldo Akhir' },
        ];
        baris = [...l.akun, { kode: '', nama: '— TOTAL', ...l.total }];
      } else if (jenis === 'laba-rugi') {
        const l = await laporanLabaRugi(dari, sampai) as Record<string, unknown>;
        nama = `Laba Rugi Sederhana ${dari} - ${sampai}`;
        kolom = [
          { key: 'pos', label: 'Pos' },
          { key: 'nilai', label: 'Nilai' },
        ];
        baris = [
          { pos: 'Penjualan', nilai: l.penjualan },
          { pos: 'Retur', nilai: l.retur },
          { pos: 'Penjualan Bersih', nilai: l.penjualan_bersih },
          { pos: 'HPP', nilai: l.hpp },
          { pos: 'Laba Kotor', nilai: l.laba_kotor },
          { pos: 'Total Pengeluaran/Biaya', nilai: l.pengeluaran },
          { pos: 'Pemasukan Lain', nilai: l.pemasukan_lain },
          { pos: 'LABA BERSIH', nilai: l.laba_bersih },
        ];
      } else if (jenis === 'rekap-piutang') {
        const l = await rekapPiutang() as unknown as { baris: Record<string, unknown>[]; total_sisa: number };
        nama = 'Rekap Piutang';
        kolom = [
          { key: 'entitas', label: 'Pelanggan' },
          { key: 'jumlah_tagihan', label: 'Jumlah Tagihan' },
          { key: 'total', label: 'Total' },
          { key: 'terbayar', label: 'Terbayar' },
          { key: 'sisa', label: 'Sisa' },
        ];
        baris = [...l.baris, { entitas: '— TOTAL', sisa: l.total_sisa }];
      } else {
        const l = await rekapHutang() as unknown as { baris: Record<string, unknown>[]; total_sisa: number };
        nama = 'Rekap Hutang';
        kolom = [
          { key: 'entitas', label: 'Pemasok' },
          { key: 'jumlah_tagihan', label: 'Jumlah Tagihan' },
          { key: 'total', label: 'Total' },
          { key: 'terbayar', label: 'Terbayar' },
          { key: 'sisa', label: 'Sisa' },
        ];
        baris = [...l.baris, { entitas: '— TOTAL', sisa: l.total_sisa }];
      }

      const pengguna = penggunaSaatIni(req);
      await catatAudit({ userId: pengguna.id, aksi: 'ekspor', tabel: 'akuntansi_dasar_laporan', recordId: jenis, sesudah: { dari, sampai } });
      const buf = await tulisExcel(nama, kolom, baris);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${nama.replace(/[^\w .-]+/g, '_')}.xlsx"`);
      res.send(buf);
    }),
  );

  // ==========================================================================
  // PEMETAAN METODE BAYAR -> REKENING KAS (dipakai POS/Pelunasan otomatis)
  // ==========================================================================

  r.get(
    '/metode-bayar',
    asyncHandler(async (_req, res) => {
      const rows = await all<Baris>(
        `SELECT m.metode, m.cash_account_id, c.nama AS akun_nama
         FROM payment_method_accounts m JOIN cash_accounts c ON c.id = m.cash_account_id
         ORDER BY m.metode`,
      );
      res.json({
        data: rows,
        akunOpsi: await daftarAkunKas(true),
        default_id: await rekeningDefaultId(),
      });
    }),
  );

  r.put(
    '/metode-bayar',
    asyncHandler(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const metode = String(b.metode ?? '');
      const akunId = Number(b.akun_id);
      if (!['tunai', 'transfer', 'qris'].includes(metode)) throw tolak(400, 'Metode bayar tidak dikenal (tunai/transfer/qris).');
      if (!await akunKas(akunId)) throw tolak(404, 'Rekening kas tidak ditemukan.');
      const pengguna = penggunaSaatIni(req);
      await run(
        `INSERT INTO payment_method_accounts (metode, cash_account_id) VALUES (?, ?)
         ON CONFLICT(metode) DO UPDATE SET cash_account_id = excluded.cash_account_id`,
        metode,
        akunId,
      );
      await catatAudit({ userId: pengguna.id, aksi: 'ubah', tabel: 'payment_method_accounts', recordId: metode, sesudah: { metode, cash_account_id: akunId } });
      res.json({ ok: true });
    }),
  );

  // ==========================================================================
  // DATA JURNAL LAMA — ekspor Excel dulu, lalu hapus (migrasi Akuntansi Dasar).
  // ==========================================================================

  // Jumlah jurnal lama yang masih tersisa (untuk menawarkan ekspor/penghapusan).
  r.get(
    '/jurnal-lama',
    asyncHandler(async (_req, res) => {
      const n = Number(await ((await get<{ n: number }>(`SELECT COUNT(*) AS n FROM journals`)))?.n ?? 0);
      const baris = Number(await ((await get<{ n: number }>(`SELECT COUNT(*) AS n FROM journal_lines`)))?.n ?? 0);
      res.json({ ada_jurnal: n > 0, jumlah_jurnal: n, jumlah_baris: baris });
    }),
  );

  // Ekspor semua jurnal lama (+ barisnya) ke Excel — jalankan SEBELUM menghapus.
  r.get(
    '/jurnal-lama/xlsx',
    asyncHandler(async (req, res) => {
      const jurnal = await all<Baris>(`SELECT * FROM journals ORDER BY id`);
      const baris = await all<Baris>(
        `SELECT jl.* FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id ORDER BY jl.id`,
      );
      const pengguna = penggunaSaatIni(req);
      await catatAudit({ userId: pengguna.id, aksi: 'ekspor', tabel: 'journals', recordId: null, sesudah: { jumlah_jurnal: jurnal.length, jumlah_baris: baris.length } });
      const buf = await tulisExcelMulti([
        { judul: 'Jurnal Lama', kolom: jurnal.length ? Object.keys(jurnal[0]).map((k) => ({ key: k, label: k })) : [{ key: '_x', label: '(kosong)' }], baris: jurnal.length ? jurnal : [] },
        { judul: 'Baris Jurnal', kolom: baris.length ? Object.keys(baris[0]).map((k) => ({ key: k, label: k })) : [{ key: '_x', label: '(kosong)' }], baris: baris.length ? baris : [] },
      ]);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="ekspor-jurnal-lama.xlsx"`);
      res.send(buf);
    }),
  );

  // Hapus seluruh jurnal lama (baris CASCADE). Hanya setelah ekspor disimpan.
  r.delete(
    '/jurnal-lama',
    asyncHandler(async (req, res) => {
      const pengguna = penggunaSaatIni(req);
      const n = Number(await ((await get<{ n: number }>(`SELECT COUNT(*) AS n FROM journals`)))?.n ?? 0);
      if (n === 0) { res.json({ ok: true, dihapus: 0 }); return; }
      const hasil = await withTransaction(async () => {
        await run(`DELETE FROM journal_lines`);
        await run(`DELETE FROM journals`);
        await catatAudit({ userId: pengguna.id, aksi: 'hapus', tabel: 'journals', recordId: null, sesudah: { dihapus: n }, alasan: 'Migrasi Akuntansi Dasar — jurnal lama diekspor lalu dihapus.' });
        return n;
      });
      res.json({ ok: true, dihapus: hasil });
    }),
  );

  return r;
}

/** Tanggal sebelumnya (untuk saldo awal laporan kas: hari sebelum `dari`). */
function hariSebelum(tgl: string): string {
  const d = new Date(`${tgl}T00:00:00`);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Dipakai modul lain (POS/Pembelian) lewat import — tidak dihapus agar
// pemanggil lama yang masih merujuknya tidak rusak (no-op atau rute kas).
export { batalkanMutasiKasSumber };

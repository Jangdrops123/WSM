// Uji rantai Proses Tahunan (API :3001):
//   1. Jalankan proses A (s.d. 2026-10-10) — jurnal uji ikut terhapus & ditutup.
//   2. Jalankan proses B (s.d. 2026-12-31) TANPA memulihkan A — penanda Saldo
//      Awal A harus ikut terhitung ulang & digabung (pembukuan identik).
//   3. Pulihkan berantai: B dulu (kembali ke setelah-A), lalu A (kembali ke
//      awal) — guard harus mengizinkan karena B sudah dipulihkan.
//   4. Proses periode sama aktif → 409; setelah dipulihkan → boleh lagi.
// Bersih sendiri (exit hook + eksplisit). Exit 1 bila ada kegagalan.
import { DatabaseSync } from 'node:sqlite';

const API = 'http://127.0.0.1:3001/api/proses-tahunan';
const db = new DatabaseSync('data/app.db');
const q = <T = Record<string, unknown>>(sql: string, ...p: unknown[]): T[] =>
  db.prepare(sql).all(...(p as never[])) as T[];
const jml = (t: string): number =>
  Number((db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n);

let lulus = 0;
let gagal = 0;
const cek = (nama: string, kondisi: boolean, detail?: unknown): void => {
  if (kondisi) {
    lulus++;
    console.log(`  ✔ ${nama}`);
  } else {
    gagal++;
    console.log(`  ✘ ${nama}`, detail !== undefined ? JSON.stringify(detail) : '');
  }
};

const gjson = async <T>(path: string): Promise<{ status: number; data: T }> => {
  const res = await fetch(`${API}${path}`);
  return { status: res.status, data: (await res.json().catch(() => null)) as T };
};
const pjson = async <T>(path: string, body: unknown): Promise<{ status: number; data: T }> => {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json().catch(() => null)) as T };
};
const unduhBackup = async (sampai: string): Promise<Buffer> =>
  Buffer.from(await (await fetch(`${API}/backup?sampai=${sampai}`)).arrayBuffer());
const pulihkan = async (buf: Buffer, no: string): Promise<number> => {
  const res = await fetch(`${API}/pulihkan`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'x-no-proses': no },
    body: buf,
  });
  return res.status;
};

const nets = (): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const r of q<{ kode: string; net: number }>(
    `SELECT a.kode, COALESCE((SELECT SUM(jl.debit - jl.kredit) FROM journal_lines jl
       JOIN journals j ON j.id = jl.journal_id
       WHERE j.status = 'disahkan' AND jl.account_id = a.id), 0) AS net
     FROM accounts a`,
  )) {
    out[r.kode] = Math.round(Number(r.net));
  }
  return out;
};
const balances = (): string =>
  JSON.stringify(q('SELECT product_id, warehouse_id, qty FROM stock_balances ORDER BY id'));
const balancesAwal = balances();
const noProsesAktif = (): string[] =>
  q<{ no_proses: string }>(`SELECT no_proses FROM annual_processes WHERE dipulihkan_pada IS NULL`).map(
    (r) => r.no_proses,
  );

// --- Pembersihan (idempoten) ---
const noUji: string[] = [];
let sudahBersih = false;
function bersihkan(): void {
  if (sudahBersih) return;
  sudahBersih = true;
  try {
    db.prepare(
      `UPDATE journals SET status='batal' WHERE status='disahkan' AND (no_jurnal = 'JU-CHAIN-01' OR sumber_tipe IN ('jurnal_penutup','saldo_awal'))`,
    ).run();
    db.prepare(`DELETE FROM journals WHERE no_jurnal = 'JU-CHAIN-01' OR sumber_tipe IN ('jurnal_penutup','saldo_awal')`).run();
    if (noUji.length) {
      const tanda = noUji.map(() => '?').join(',');
      db.prepare(`DELETE FROM annual_processes WHERE no_proses IN (${tanda})`).run(...noUji);
      db.prepare(
        `DELETE FROM audit_logs WHERE aksi IN ('proses_tahunan','pulihkan') AND alasan LIKE '%${noUji[0]}%'`,
      ).run();
      db.prepare(
        `DELETE FROM audit_logs WHERE aksi IN ('proses_tahunan','pulihkan') AND (alasan LIKE '%${noUji.map((n) => `%${n}%`).join(`%' OR alasan LIKE '%`)}%')`,
      ).run();
    }
    // Nomor urut TIDAK dihapus: baris annual_processes bisa saja masih ada
    // (mis. demo PT-2026-0001/0002) — menghapus kuncinya membuat nomor ulang
    // tabrakan. Cukup bersihkan baris proses uji milik skrip ini.
    console.log('[cleanup] rantai dibersihkan.');
  } catch (e) {
    console.error('[cleanup] GAGAL:', e instanceof Error ? e.message : e);
  }
}
process.on('exit', bersihkan);
process.on('uncaughtException', (e) => {
  console.error('UNCAUGHT:', e);
  bersihkan();
  process.exit(1);
});

(async () => {
  // --- Fixture: satu jurnal seimbang agar ada laba untuk ditutup ---
  console.log('\n== Fixture jurnal uji ==');
  db.prepare(
    `INSERT INTO journals (no_jurnal, tanggal, period_id, sumber_tipe, sumber_id, keterangan, status, dibuat_oleh)
     VALUES ('JU-CHAIN-01', '2026-09-01', 1, 'uji', 0, 'Jurnal rantai uji', 'draft', 1)`,
  ).run();
  db.prepare(
    `INSERT INTO journal_lines (journal_id, account_id, debit, kredit, keterangan)
     VALUES ((SELECT id FROM journals WHERE no_jurnal='JU-CHAIN-01'), (SELECT id FROM accounts WHERE kode='1001'), 10000, 0, 'uang'),
           ((SELECT id FROM journals WHERE no_jurnal='JU-CHAIN-01'), (SELECT id FROM accounts WHERE kode='4001'), 0, 10000, 'jualan')`,
  ).run();
  db.prepare(`UPDATE journals SET status='disahkan' WHERE no_jurnal='JU-CHAIN-01'`).run();
  const sebelum = nets();
  cek('fixture: 1001=+10000, 4001=-10000, seimbang', sebelum['1001'] === 10000 && sebelum['4001'] === -10000 && Object.values(sebelum).reduce((a, b) => a + b, 0) === 0, sebelum);

  const backupA = await unduhBackup('2026-10-10');
  cek('backup A .xlsx', backupA[0] === 0x50 && backupA[1] === 0x4b, backupA.length);

  // --- Proses A ---
  console.log('\n== Proses A (s.d. 2026-10-10) ==');
  const rA = await pjson<any>(`/jalankan`, { sampai: '2026-10-10', kata: 'HAPUS', sandi: '1234' });
  cek('proses A → 200', rA.status === 200, rA);
  const A = rA.data ?? {};
  noUji.push(String(A.no_proses));
  cek('A: sub 14 + jurnal 1 terhapus', A.dihapus?.persediaan_sub === 14 && A.dihapus?.jurnal === 1, A.dihapus);
  cek('A: jurnal penutup & pembuka dibuat', A.saldo_awal?.id_jurnal_penutup > 0 && A.saldo_awal?.id_jurnal_pembuka > 0, A.saldo_awal);
  const setelahA = nets();
  cek('setelah A: 1001=+10000, 4001 ditutup 0, 3100=-10000 (laba)', setelahA['1001'] === 10000 && setelahA['4001'] === 0 && setelahA['3100'] === -10000, setelahA);
  cek('setelah A: stock_balances identik', balances() === balancesAwal);
  cek('setelah A: sub docs 0', jml('sub_stock_docs') === 0, jml('sub_stock_docs'));

  const backupB = await unduhBackup('2026-12-31');

  // --- Proses B (periode berikutnya, TANPA pulihkan A) → penanda A digabung ---
  console.log('\n== Proses B (s.d. 2026-12-31) ==');
  const rB = await pjson<any>(`/jalankan`, { sampai: '2026-12-31', kata: 'HAPUS', sandi: '1234' });
  cek('proses B → 200', rB.status === 200, rB);
  const B = rB.data ?? {};
  noUji.push(String(B.no_proses));
  cek('B: tidak ada laba baru (penutup kosong)', B.saldo_awal?.id_jurnal_penutup === 0, B.saldo_awal);
  const setelahB = nets();
  cek('setelah B: pembukuan IDENTIK dengan setelah A (digabung)', JSON.stringify(setelahB) === JSON.stringify(setelahA), { setelahA, setelahB });
  cek('setelah B: stok tetap identik', balances() === balancesAwal);
  const marker = q<{ n: number; siapa: number }>(
    `SELECT COUNT(*) n, SUM(CASE WHEN sumber_id = ${Number(B.id)} THEN 1 ELSE 0 END) siapa FROM journals`,
  )[0];
  cek('setelah B: hanya jurnal pembuka B tersisa', Number(marker.n) === 1 && Number(marker.siapa) === 1, marker);
  const salAwalB = q<{ n: number }>(`SELECT COUNT(*) n FROM stock_ledger WHERE tipe_dokumen='saldo_awal'`)[0];
  cek('setelah B: baris Saldo Awal B (tanpa duplikat)', Number(salAwalB.n) === 5, salAwalB);
  const tglB = q<{ t: string }>(`SELECT DISTINCT tanggal t FROM stock_ledger WHERE tipe_dokumen='saldo_awal'`)[0];
  cek('setelah B: tanggal saldo awal = 01/01/2027 (waktu lokal)', new Date(tglB.t).getFullYear() === 2027 && new Date(tglB.t).getMonth() === 0, tglB);

  // --- Pulihkan berantai: B dulu, baru A ---
  console.log('\n== Pulihkan berantai ==');
  cek('sebelum pulih: A aktif (belum dipulihkan)', noProsesAktif().includes(String(A.no_proses)), noProsesAktif());
  const cekA = await pulihkan(backupA, String(A.no_proses));
  cek('pulihkan A saat B masih aktif → 409', cekA === 409, cekA);
  const okB = await pulihkan(backupB, String(B.no_proses));
  cek('pulihkan B → 200', okB === 200, okB);
  cek('kembali persis ke kondisi setelah A', JSON.stringify(nets()) === JSON.stringify(setelahA), nets());
  const okA = await pulihkan(backupA, String(A.no_proses));
  cek('pulihkan A setelah B dipulihkan → 200 (rantai)', okA === 200, okA);
  cek('kembali persis ke kondisi awal', JSON.stringify(nets()) === JSON.stringify(sebelum), { sebelum, kini: nets() });
  cek('awal: sub 14, kartu 21, saldo_awal 0', jml('sub_stock_docs') === 14 && jml('stock_ledger') === 21 && q(`SELECT id FROM stock_ledger WHERE tipe_dokumen='saldo_awal'`).length === 0, { sub: jml('sub_stock_docs'), led: jml('stock_ledger') });
  cek('stock_balances identik', balances() === balancesAwal);

  // --- Periode sama: aktif → 409; setelah dipulihkan → boleh ---
  console.log('\n== Jaring periode sama ==');
  const rC = await pjson<any>(`/jalankan`, { sampai: '2026-10-10', kata: 'HAPUS', sandi: '1234' });
  cek('proses ulang periode sama (setelah dipulihkan) → 200', rC.status === 200, rC);
  noUji.push(String((rC.data ?? {}).no_proses));
  const rD = await pjson<any>(`/jalankan`, { sampai: '2026-10-10', kata: 'HAPUS', sandi: '1234' });
  cek('proses aktif sama periode → 409', rD.status === 409, rD);
  const okC = await pulihkan(backupA, String((rC.data ?? {}).no_proses));
  cek('pulihkan C → 200', okC === 200, okC);
  cek(
    'final: nets = kondisi awal (jurnal uji ikut dipulihkan)',
    JSON.stringify(nets()) === JSON.stringify(sebelum),
    { sebelum, kini: nets() },
  );
  cek('final: sub 14, kartu 21, jurnal 1 (uji)', jml('sub_stock_docs') === 14 && jml('stock_ledger') === 21 && jml('journals') === 1, { sub: jml('sub_stock_docs'), led: jml('stock_ledger'), j: jml('journals') });
  cek('final: stock_balances persis', balances() === balancesAwal);
} )()
  .catch((e) => {
    gagal++;
    console.error('KEGAGALAN TAK TERDUGA:', e instanceof Error ? e.message : e);
  })
  .finally(() => {
    bersihkan();
    cek('final setelah bersih: jurnal 0, nets 0, proses uji hilang', jml('journals') === 0 && Object.values(nets()).every((v) => v === 0) && noUji.every((n) => !q(`SELECT id FROM annual_processes WHERE no_proses='${n}'`).length), { j: jml('journals') });
    console.log(`\n=== HASIL RANTAI: ${lulus} lulus, ${gagal} gagal ===`);
    process.exit(gagal > 0 ? 1 : 0);
  });

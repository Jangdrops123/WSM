/* Uji X5 — Profil Size: API CRUD + validasi, penetapan kategori, impor Excel
   kolom profil_size (pra-tinjau → konfirmasi → ekspor), resolusi & parser
   chatbot per-profil (rincian kodi per size + peringatan size di luar profil).
   Self-cleaning: profil uji, produk uji, kategori uji, batch impor dihapus. */
import ExcelJS from 'exceljs';
import { DatabaseSync } from 'node:sqlite';
import { uraiPembelianBaris } from '../server/lib/urai.ts';

const BASE = 'http://127.0.0.1:3001';
const db = new DatabaseSync('data/app.db');

let lulus = 0;
let gagal = 0;
const cek = (nama: string, ok: boolean, info = '') => {
  if (ok) lulus++;
  else gagal++;
  console.log(`${ok ? '✔' : '✘'} ${nama}${info ? ` — ${info}` : ''}`);
};

async function req(method: string, url: string, body?: unknown) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* bukan json */
  }
  return { status: res.status, data };
}

const q1 = (sql: string, ...p: unknown[]) => db.prepare(sql).get(...(p as never[])) as any;

const KOLOM_XLSX = ['kode_item', 'nama_produk', 'sku', 'kategori', 'merek', 'satuan', 'profil_size', 'barcode', 'harga_beli', 'harga_jual', 'status', 'nama_file_foto'];

const buatXlsx = async (baris: (string | number)[][]): Promise<string> => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(KOLOM_XLSX);
  for (const b of baris) ws.addRow(b);
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer).toString('base64');
};

const bersihkan = () => {
  db.prepare(`DELETE FROM import_errors WHERE batch_id IN (SELECT id FROM import_batches WHERE nama_file LIKE 'uji-x5%')`).run();
  db.prepare(`DELETE FROM import_batches WHERE nama_file LIKE 'uji-x5%'`).run();
  db.prepare(`DELETE FROM stock_ledger WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'X5-%')`).run();
  db.prepare(`DELETE FROM stock_balances WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'X5-%')`).run();
  db.prepare(`DELETE FROM products WHERE sku LIKE 'X5-%'`).run();
  db.prepare(`DELETE FROM categories WHERE nama = 'Kategori Uji X5'`).run();
  db.exec(
    `DELETE FROM size_profile_sizes WHERE profile_id IN (SELECT id FROM size_profiles WHERE nama LIKE 'Profil Uji X5%');
     DELETE FROM size_profiles WHERE nama LIKE 'Profil Uji X5%';`,
  );
  db.prepare(`UPDATE settings SET nilai = 'sepatu-pria' WHERE kunci = 'size_profile_default'`).run();
};

async function main() {
  bersihkan();

  // --- 1) Daftar profil + flag default ---------------------------------------
  let r = await req('GET', '/api/profil-size');
  const daftar = r.data?.data ?? [];
  cek('daftar profil → 200 & >= 6 profil bawaan', r.status === 200 && daftar.length >= 6, `n=${daftar.length}`);
  const def = daftar.find((p: any) => p.default);
  cek('flag default menunjuk sepatu-pria', def?.kode === 'sepatu-pria', String(def?.kode));
  const opsi = await req('GET', '/api/profil-size/opsi');
  cek('opsi ringkas (id+label) untuk dropdown', opsi.status === 200 && (opsi.data?.data ?? []).length >= 6);

  // --- 2) Validasi CRUD: total jatah wajib == pasang per kodi ----------------
  r = await req('POST', '/api/profil-size', {
    nama: 'Profil Uji X5',
    pasang_per_kodi: 10,
    kata_kunci: ['ujix5'],
    sizes: [
      { size: 'S', jatah: 3 },
      { size: 'M', jatah: 3 },
      { size: 'L', jatah: 3 },
    ],
  });
  cek('total jatah (9) ≠ pasang/kodi (10) → 400 + selisih',
    r.status === 400 && /selisih/i.test(String(r.data?.pesan ?? r.data?.error ?? '')),
    JSON.stringify(r.data).slice(0, 160));

  r = await req('POST', '/api/profil-size', {
    nama: 'Profil Uji X5',
    pasang_per_kodi: 10,
    kata_kunci: ['ujix5', 'x5prof'],
    sizes: [
      { size: 'S', jatah: 3 },
      { size: 'M', jatah: 4 },
      { size: 'L', jatah: 3 },
    ],
  });
  cek('profil valid → 201', r.status === 201 && r.data?.id, `id=${r.data?.id}`);
  const profId = Number(r.data?.id ?? 0);
  if (!profId) {
    console.log('\nProfil uji gagal dibuat — berhenti.');
    process.exit(1);
  }

  r = await req('POST', `/api/profil-size/${profId}/duplikat`, {});
  cek('duplikat → 201 + "(salinan)"', r.status === 201 && String(r.data?.nama).includes('(salinan)'), String(r.data?.nama));
  const dupId = Number(r.data?.id ?? 0);
  if (dupId) await req('DELETE', `/api/profil-size/${dupId}`);
  cek('hapus duplikat → 200 & hilang', dupId > 0 && (await req('GET', `/api/profil-size/${dupId}`)).status === 404);

  // Bagi rata: 10 pasang / 3 size → dasar 3, sisa 1 ke size tengah.
  r = await req('POST', `/api/profil-size/${profId}/bagi-rata`, { pasang_per_kodi: 10 });
  const br = r.data?.sizes ?? [];
  const brTotal = br.reduce((n: number, s: any) => n + Number(s.jatah), 0);
  cek('bagi rata 10/3 → total 10 + peringatan sisa',
    r.status === 200 && brTotal === 10 && !!r.data?.peringatan,
    `jatah=${br.map((s: any) => s.jatah).join('/')} pesan=${String(r.data?.peringatan ?? '').slice(0, 70)}`);

  // --- 3) Penetapan kategori (resolusi tingkat 2) ---------------------------
  const kat = await req('POST', '/api/master/kategori', { nama: 'Kategori Uji X5' });
  cek('kategori uji dibuat → 201', kat.status === 201 && kat.data?.id, `status=${kat.status}`);
  const katId = Number(kat.data?.id ?? 0);
  if (katId) {
    r = await req('PUT', `/api/profil-size/${profId}/terapkan`, { kategori_ids: [katId], merek_ids: [] });
    cek('terapkan penetapan kategori → 200', r.status === 200, JSON.stringify(r.data));
    cek('kategori.size_profile_id terpasang', Number(q1(`SELECT size_profile_id v FROM categories WHERE id = ?`, katId)?.v ?? 0) === profId);
    const pen = await req('GET', `/api/profil-size/${profId}/penetapan`);
    cek('GET penetapan mengembalikan kategori', (pen.data?.kategori_ids ?? []).includes(katId), JSON.stringify(pen.data));
    await req('PUT', `/api/profil-size/${profId}/terapkan`, { kategori_ids: [], merek_ids: [] });
    cek('lepas penetapan → kolom kembali NULL', q1(`SELECT size_profile_id v FROM categories WHERE id = ?`, katId)?.v == null);

    // Perubahan profil wajib tercatat di log aktivitas (tambah saat POST +
    // ubah saat terapkan penetapan).
    const auditProfil = Number(
      q1(`SELECT COUNT(*) n FROM audit_logs WHERE tabel = 'size_profiles' AND record_id = ?`, String(profId))?.n ?? 0,
    );
    cek('perubahan profil tercatat di log aktivitas', auditProfil >= 2, `n=${auditProfil}`);

    // Resolusi TINGKAT 2 end-to-end: produk berkategori ini → profil lewat
    // penetapan (tanpa profil produk, tanpa kata kunci di baris).
    await req('PUT', `/api/profil-size/${profId}/terapkan`, { kategori_ids: [katId], merek_ids: [] });
    db.prepare(
      `INSERT INTO products (kode_item, nama, sku, harga_beli, harga_jual, category_id)
       VALUES ('X5-KAT', 'Kaos Kategori Uji X5', 'X5-KAT', 500, 1000, ?)`,
    ).run(katId);
    const viaKategori = uraiPembelianBaris(['Supplier A', 'kaos kategori uji x5 1 kodi'].join('\n'));
    cek(
      'resolusi kategori → profil penetapan (profil Uji X5, S/M/L)',
      viaKategori.pratinjau?.[0]?.profil === 'Profil Uji X5' &&
        viaKategori.pratinjau?.[0]?.profil_dari === 'kategori',
      `profil=${viaKategori.pratinjau?.[0]?.profil} dari=${viaKategori.pratinjau?.[0]?.profil_dari}`,
    );
  }

  // --- 4) Impor Excel: kolom profil_size ------------------------------------
  const dataB = await buatXlsx([['X5B', 'Produk Uji X5', 'X5-X5B', '', '', '', 'Sepatu Pria', '', 1000, 2000, 'Aktif', '']]);
  const pra = await req('POST', '/api/master/produk/impor/pra-tinjau', { nama_file: 'uji-x5-impor.xlsx', data_base64: dataB });
  cek('pra-tinjau impor dgn profil_size valid → 200 & 1 baris valid',
    pra.status === 200 && pra.data?.baris_valid === 1, JSON.stringify(pra.data?.errors ?? []));

  const dataC = await buatXlsx([['X5C', 'Produk Uji X5 C', 'X5-X5C', '', '', '', 'Profil Tidak Ada', '', 1000, 2000, 'Aktif', '']]);
  const praC = await req('POST', '/api/master/produk/impor/pra-tinjau', { nama_file: 'uji-x5-impor.xlsx', data_base64: dataC });
  const errC = (praC.data?.errors ?? []).map((e: any) => e.pesan).join(' ');
  cek('profil_size tak dikenal → error jelas per baris', /tidak ditemukan/.test(errC), errC.slice(0, 150));

  if (pra.status === 200 && pra.data?.baris_valid === 1) {
    const konf = await req('POST', '/api/master/produk/impor', { nama_file: 'uji-x5-impor.xlsx', data_base64: dataB });
    const idB = q1(`SELECT id FROM products WHERE kode_item = 'X5B'`);
    cek('konfirmasi → produk masuk', konf.status === 200 && !!idB, `status=${konf.status} ${JSON.stringify(konf.data?.errors ?? []).slice(0, 120)}`);
    const idSepatuPria = Number(q1(`SELECT id FROM size_profiles WHERE kode = 'sepatu-pria'`)?.id ?? -1);
    cek('produk impor bernilai size_profile_id = Sepatu Pria',
      Number(q1(`SELECT size_profile_id v FROM products WHERE kode_item = 'X5B'`)?.v ?? 0) === idSepatuPria);

    const ek = await req('GET', `/api/master/produk/ekspor?format=json&ids=${Number(idB?.id ?? 0)}&kolom=kode_item,profil_size`);
    const barisEk = ek.data?.baris ?? [];
    cek('ekspor membawa kolom profil_size (nama profil)',
      ek.status === 200 && barisEk.length === 1 && barisEk[0]?.profil_size === 'Sepatu Pria',
      JSON.stringify(barisEk[0] ?? null));

    // Upsert ulang dengan profil kosong → TIDAK diubah (tetap Sepatu Pria).
    const dataKosong = await buatXlsx([['X5B', 'Produk Uji X5', 'X5-X5B', '', '', '', '', '', 1000, 2000, 'Aktif', '']]);
    await req('POST', '/api/master/produk/impor', { nama_file: 'uji-x5-impor.xlsx', data_base64: dataKosong });
    cek('profil_size kosong = tidak diubah (tetap Sepatu Pria)',
      Number(q1(`SELECT size_profile_id v FROM products WHERE kode_item = 'X5B'`)?.v ?? 0) === idSepatuPria);
  }

  // --- 5) Parser chatbot per-profil -----------------------------------------
  // Fixture produk ber-size (nama membawa angka → parser memecah per size profil).
  db.prepare(`INSERT INTO products (kode_item, nama, sku, harga_beli, harga_jual) VALUES ('X5-SNK', 'Sneaker Uji X5 39', 'X5-SNK', 1000, 2000)`).run();
  db.prepare(`INSERT INTO products (kode_item, nama, sku, harga_beli, harga_jual, size_profile_id) VALUES ('X5-PROD', 'Sepatu Anak Uji X5 25', 'X5-PROD', 100, 200, (SELECT id FROM size_profiles WHERE kode = 'anak'))`).run();

  // (a) Default: produk tanpa profil, tanpa kata kunci → profil default.
  const hasil = uraiPembelianBaris(
    ['Supplier A', 'sneaker uji x5 39-43 masing-masing 2 kodi @120000', 'Total = 2 kd'].join('\n'),
  );
  const p0 = hasil.pratinjau?.[0];
  cek('pratinjau memakai profil default (Sepatu Pria)', p0?.profil === 'Sepatu Pria' && p0?.profil_dari === 'default',
    `profil=${p0?.profil} dari=${p0?.profil_dari}`);
  const rincian = p0?.rincian ?? [];
  const totalRincian = rincian.reduce((n, x) => n + x.pasang, 0);
  cek('rincian per size terpecah 5 size profil', rincian.length === 5, rincian.map((x) => `${x.size}:${x.pasang}`).join(' · '));
  cek('total pasang = 2 kodi × 20 (40)', totalRincian === 40, String(totalRincian));
  cek('kodi per size = pasang / jatah size (8/4 = 2 kd)',
    rincian.every((x) => x.kodi === 2), rincian.map((x) => `${x.size}:${x.kodi}kd`).join(' · '));
  cek('pesan bot menyebut profil + rincian kodi per size',
    /Profil size: Sepatu Pria/.test(hasil.pesan_bot) && /39: 8 \(2 kd\)/.test(hasil.pesan_bot),
    hasil.pesan_bot.split('\n').slice(0, 5).join(' | ').slice(0, 320));
  cek('cek total "Total = 2 kd" cocok (ok=true)', hasil.cek?.ok === true, JSON.stringify(hasil.cek));

  // (b) Size di luar daftar profil → peringatan kuning di baris & pesan bot.
  const luar = uraiPembelianBaris(['Supplier A', 'sneaker uji x5 size 44 1 kodi'].join('\n'));
  const alasan = (luar.pratinjau?.[0]?.alasan ?? []).concat(luar.baris.flatMap((b) => b.alasan));
  cek('peringatan size di luar profil (44) + tampil di pesan bot',
    alasan.some((a) => /Size 44 tidak ada di profil Sepatu Pria/.test(a)) &&
      /Size 44 tidak ada di profil Sepatu Pria/.test(luar.pesan_bot),
    alasan.join(' | ').slice(0, 200));

  // (c) Kata kunci di baris chat: "cwe" → profil Sepatu Wanita (37–40).
  const kata = uraiPembelianBaris(['Supplier A', 'sandal cwe 37-40 masing-masing 1 kodi'].join('\n'));
  cek('resolusi kata kunci → profil Wanita (37–40)',
    kata.pratinjau?.[0]?.profil === 'Sepatu Wanita' && kata.pratinjau?.[0]?.profil_dari === 'kata' &&
      (kata.pratinjau?.[0]?.rincian ?? []).map((x) => x.size).join(',') === '37,38,39,40',
    `profil=${kata.pratinjau?.[0]?.profil} dari=${kata.pratinjau?.[0]?.profil_dari} sizes=${(kata.pratinjau?.[0]?.rincian ?? []).map((x) => x.size).join(',')}`);

  // (d) Resolusi produk: produk bernilai size_profile_id 'Anak' → profil Anak.
  const viaProduk = uraiPembelianBaris(['Supplier A', 'sepatu anak uji x5 25 1 kodi'].join('\n'));
  cek('resolusi produk → profil Anak',
    viaProduk.pratinjau?.[0]?.profil === 'Anak' && viaProduk.pratinjau?.[0]?.profil_dari === 'produk',
    `profil=${viaProduk.pratinjau?.[0]?.profil} dari=${viaProduk.pratinjau?.[0]?.profil_dari} sizes=${(viaProduk.pratinjau?.[0]?.rincian ?? []).map((x) => x.size).join(',')}`);

  // (e) Komposisi Db/Tp memakai jatah profil Anak (1–5 × 4, per kodi 20):
  //     6 kd = 3 kd normal + 3 kd komposisi (db 5 tp 1):
  //     size5 = 12 + (4+4)×3 = 36 · size1 = 12 + 0 = 12 · lainnya 12 + 4×3 = 24.
  const komp = uraiPembelianBaris(['Supplier A', 'sepatu anak uji x5 6 kd (3kd db 5 tp 1)'].join('\n'));
  const rk = komp.pratinjau?.[0]?.rincian ?? [];
  const jatah = (s: string) => rk.find((x) => x.size === s)?.pasang ?? -1;
  cek('Db/Tp per size (db5=36, tp1=12, lain 24, total 120)',
    jatah('5') === 36 && jatah('1') === 12 && jatah('2') === 24 && rk.reduce((n, x) => n + x.pasang, 0) === 120,
    rk.map((x) => `${x.size}:${x.pasang}`).join(' · '));
  cek('pesan bot komposisi menyebut profil Anak', /Profil size: Anak/.test(komp.pesan_bot), komp.pesan_bot.split('\n').slice(0, 4).join(' | ').slice(0, 240));

  console.log(`\n${lulus} lulus, ${gagal} gagal`);
  bersihkan();
  db.close();
  if (gagal > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  bersihkan();
  process.exit(1);
});

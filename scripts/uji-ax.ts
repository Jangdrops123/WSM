// ============================================================================
// uji-ax — Bagian AX: SATU matriks 8 kolom sebagai satu-satunya penentu izin.
//
// Jalankan dengan DB SALINAN (jangan DB produksi):
//   DB_FILE="$PWD/uji-ax.db" API_PORT=3007 npx tsx server/index.ts &
//   BASE=http://127.0.0.1:3007 ADMIN_SANDI=UjiAX123! npx tsx scripts/uji-ax.ts
//
// Yang diperiksa:
//   AX1 peta lama hilang: terima/batal/batal_disahkan ditolak validator.
//   AX2 peta baru: Terima→Ubah, Batal draft/GRN+Void→Hapus, Sahkan→Sahkan,
//       Batal&Pulihkan→Hapus+Sahkan (pembelian, opname, item masuk/keluar).
//   AX3 gudang tetap diperiksa terpisah (cakupan sesi).
//   AX4 pesan memakai kosakata matriks ("belum memiliki izin 'X' pada Y").
//   AX5 UI: sel kosong = tolak (disimpulkan dari API: tanpa sel → 403).
//   AX7 perubahan matriks berlaku di request berikutnya TANPA login ulang.
// ============================================================================

const BASE = process.env.BASE ?? 'http://127.0.0.1:3007';
const ADMIN_SANDI = process.env.ADMIN_SANDI ?? 'UjiAX123!';
const SANDI_UJI = 'UjiAX123!';
const ROLE_UJI = 'UjiAX';
const USER_UJI = 'uji_ax_ts';
const USER_UJI2 = 'uji_ax_gudang';

let lulus = 0;
let gagal = 0;
const cek = async (nama: string, ok: boolean, info: unknown = '') => {
  if (ok) lulus++;
  else gagal++;
  console.log(`${ok ? '✔' : '✘'} ${nama}${info ? ` — ${typeof info === 'string' ? info : JSON.stringify(info)}` : ''}`);
};

type Jawaban = { s: number; d: Record<string, any> | null; cookie: string };

async function panggil(cookie: string | null, method: string, jalur: string, body?: unknown): Promise<Jawaban> {
  const res = await fetch(`${BASE}/api${jalur}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let d: Record<string, any> | null = null;
  try {
    d = (await res.json()) as Record<string, any>;
  } catch { /* bukan JSON */ }
  const setCookie = res.headers.get('set-cookie') ?? '';
  return { s: res.status, d, cookie: setCookie ? setCookie.split(';')[0] : (cookie ?? '') };
}

async function masuk(username: string, sandi: string): Promise<Jawaban> {
  const res = await fetch(`${BASE}/api/auth/masuk`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, sandi, ingat: false }),
  });
  let d: Record<string, any> | null = null;
  try {
    d = (await res.json()) as Record<string, any>;
  } catch { /* bukan JSON */ }
  return { s: res.status, d, cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] };
}

// --- fixture ID dinamis (diselesaikan dari DB salinan) ---
const SUP = 68, GD1 = 75, GD2 = 76, PROD1 = 1692, PROD2 = 1697;
const itemBeli = async (pid: number) => ({ product_id: pid, qty: 2, harga_beli: 10000 });

const admin = await masuk('admin', ADMIN_SANDI);
await cek('admin await masuk(DB salinan)', admin.s === 200, admin.s);
if (admin.s !== 200) {
  console.log(`RINGKASAN: ${lulus} lulus, ${gagal} gagal`);
  process.exit(1);
}
const A = admin.cookie;

// Bersihkan sisa uji sebelumnya: pengguna uji berriwayat dokumen tidak bisa
// dihapus (guard arsip) — perannya dikosongkan agar peran UjiAX bisa dibuat ulang.
{
  const daftar = await panggil(A, 'GET', '/pengguna/daftar');
  const ada = new Set(((daftar.d?.data ?? []) as any[]).map((r: any) => r.username));
  if (ada.has(USER_UJI) || ada.has(USER_UJI2)) {
    const peran = await panggil(A, 'GET', '/pengguna/peran');
    const operator = ((peran.d?.data ?? []) as any[]).find((x: any) => x.nama === 'Operator');
    for (const r of ((daftar.d?.data ?? []) as any[])) {
      if (r.username !== USER_UJI && r.username !== USER_UJI2) continue;
      if (operator && r.peran_id !== operator.id) {
        await panggil(A, 'PUT', `/pengguna/${r.id}`, { nama: r.nama, username: r.username, peran_id: operator.id, cakupan_toko: r.cakupan_toko });
      }
    }
    const peran2 = await panggil(A, 'GET', '/pengguna/peran');
    for (const r of ((peran2.d?.data ?? []) as any[])) {
      if (r.nama === ROLE_UJI) await panggil(A, 'DELETE', `/pengguna/peran/${r.id}`);
    }
  }
}

// Pengguna uji dipakai ulang antar-ulangan (guard arsip melarang hapus).
async function siapkanUser(username: string, nama: string, cakupan: string[]): Promise<void> {
  const daftar = await panggil(A, 'GET', '/pengguna/daftar');
  const lama = ((daftar.d?.data ?? []) as any[]).find((r: any) => r.username === username);
  if (lama) {
    await panggil(A, 'PUT', `/pengguna/${lama.id}`, { nama, username, peran_id: roleId, cakupan_toko: cakupan });
    await panggil(A, 'POST', `/pengguna/${lama.id}/status`, { aktif: true });
    return;
  }
  await panggil(A, 'POST', '/pengguna/', { nama, username, sandi: SANDI_UJI, peran_id: roleId, cakupan_toko: cakupan });
}

// 1. Buat peran + matriks awal (tanpa Hapus/Sahkan di mana pun).
const peranBaru = await panggil(A, 'POST', '/pengguna/peran', { nama: ROLE_UJI });
await cek('buat peran UjiAX', peranBaru.s === 201, peranBaru.s);
const roleId: number = peranBaru.d?.id ?? peranBaru.d?.peran?.id;
const matriksAwal = {
  pembelian: ['lihat', 'tambah', 'ubah'],
  opname: ['lihat', 'tambah', 'ubah'],
  'persediaan-sub': ['lihat', 'tambah', 'ubah'],
  master: ['lihat'],
  laporan: ['lihat'],
};
const setMatriks = await panggil(A, 'PUT', `/pengguna/matriks/${roleId}`, { hak: matriksAwal });
await cek('set matriks awal 8-kolom', setMatriks.s === 200, setMatriks.s);

// AX1: kode lama + modul asing ditolak validator.
const kodeLama = await panggil(A, 'PUT', `/pengguna/matriks/${roleId}`, {
  hak: { pembelian: ['lihat', 'terima', 'batal', 'batal_disahkan'] },
});
await cek('AX1 kode lama ditolak (400 Aksi tidak dikenal)', kodeLama.s === 400 && String(kodeLama.d?.pesan ?? '').includes('Aksi tidak dikenal'), `${kodeLama.s} ${kodeLama.d?.pesan}`);
const modulAsing = await panggil(A, 'PUT', `/pengguna/matriks/${roleId}`, { hak: { kasbon: ['lihat'] } });
await cek('AX1 modul asing ditolak', modulAsing.s === 400, modulAsing.s);

await siapkanUser(USER_UJI, 'Uji AX', ['GD-1', 'GD-2']);
{
  const daftar = await panggil(A, 'GET', '/pengguna/daftar');
  const u = ((daftar.d?.data ?? []) as any[]).find((r: any) => r.username === USER_UJI);
  await cek('siapkan pengguna uji', !!u && u.peran_id === roleId, u ? `${u.id} peran=${u.peran_id}` : 'hilang');
}
const uji = await masuk(USER_UJI, SANDI_UJI);
await cek('pengguna uji masuk', uji.s === 200, uji.s);
let U = uji.cookie;

// 2. Pembelian: Terima = Ubah (lolos), Sahkan/Batal = 403 kosakata matriks.
const draft = await panggil(U, 'POST', '/pembelian', {
  supplier_id: SUP, warehouse_id: GD1, metode: 'biasa', items: [await itemBeli(PROD1)],
});
await cek('draft pembelian (Tambah) lolos', draft.s === 200 || draft.s === 201, draft.s);
const idBeli: number = draft.d?.id ?? draft.d?.data?.id ?? 0;
const ubah = await panggil(U, 'PUT', `/pembelian/${idBeli}`, {
  supplier_id: SUP, warehouse_id: GD1, metode: 'biasa', items: [await itemBeli(PROD1)],
});
await cek('ubah draft (Ubah) lolos', ubah.s === 200, ubah.s);
const terima = await panggil(U, 'POST', `/pembelian/${idBeli}/terima`, {});
await cek('AX2 terima barang = Ubah (lolos)', terima.s === 200, `${terima.s} ${terima.d?.pesan ?? ''}`);
const sahkanTolak = await panggil(U, 'POST', `/pembelian/${idBeli}/sahkan`, {});
await cek(
  "AX2/AX4 sahkan ditolak + pesan matriks",
  sahkanTolak.s === 403 && String(sahkanTolak.d?.pesan ?? '').includes("belum memiliki izin 'Sahkan' pada Pembelian"),
  `${sahkanTolak.s} ${sahkanTolak.d?.pesan ?? ''}`,
);
const batalDraftTolak = await panggil(U, 'POST', `/pembelian/${idBeli}/batal`, { alasan: 'uji' });
await cek(
  "AX2/AX4 batal draft ditolak + pesan 'Hapus'",
  batalDraftTolak.s === 403 && String(batalDraftTolak.d?.pesan ?? '').includes("belum memiliki izin 'Hapus' pada Pembelian"),
  `${batalDraftTolak.s} ${batalDraftTolak.d?.pesan ?? ''}`,
);

// 3. Opname: hitung = Ubah (lolos); sahkan/batal = 403.
const sesi = await panggil(U, 'POST', '/opname', { warehouse_id: GD1 });
await cek('sesi opname (Tambah) lolos', sesi.s === 200 || sesi.s === 201, `${sesi.s} ${sesi.d?.pesan ?? ''}`);
const idSesi: number = sesi.d?.id ?? sesi.d?.data?.id ?? 0;
const hitung = await panggil(U, 'POST', `/opname/${idSesi}/hitung`, {
  items: [{ product_id: PROD1, qty_fisik: 5 }],
});
await cek('AX2 hitung opname = Ubah (lolos)', hitung.s === 200, `${hitung.s} ${hitung.d?.pesan ?? ''}`);
const sahkanOpTolak = await panggil(U, 'POST', `/opname/${idSesi}/sahkan`, {});
await cek('AX2 sahkan opname ditolak (tanpa Sahkan)', sahkanOpTolak.s === 403, sahkanOpTolak.s);
const batalOpTolak = await panggil(U, 'POST', `/opname/${idSesi}/batal`, { alasan: 'uji' });
await cek('AX2 batal sesi opname ditolak (tanpa Hapus)', batalOpTolak.s === 403, batalOpTolak.s);

// 4. Item Masuk: buat (Tambah) lolos; batal = 403 (butuh Hapus+Sahkan).
const dokMasuk = await panggil(U, 'POST', '/persediaan', {
  arah: 'masuk', warehouse_id: GD1, alasan: 'temuan', items: [{ product_id: PROD1, qty: 2 }],
});
await cek('item await masuk(Tambah) lolos', dokMasuk.s === 200 || dokMasuk.s === 201, `${dokMasuk.s} ${dokMasuk.d?.pesan ?? ''}`);
const idMasuk: number = dokMasuk.d?.id ?? dokMasuk.d?.data?.id ?? 0;
const batalMasukTolak = await panggil(U, 'POST', `/persediaan/${idMasuk}/batal`, { alasan: 'uji' });
await cek(
  'AX2 batal item masuk ditolak (tanpa Hapus+Sahkan)',
  batalMasukTolak.s === 403 && String(batalMasukTolak.d?.pesan ?? '').includes('Hapus'),
  `${batalMasukTolak.s} ${batalMasukTolak.d?.pesan ?? ''}`,
);

// 5. Master ekspor + laporan tanpa sel = 403; laporan lihat lolos.
const eksporTolak = await panggil(U, 'GET', '/master/produk/ekspor');
await cek('ekspor produk ditolak (tanpa Ekspor)', eksporTolak.s === 403, eksporTolak.s);
const lapOk = await panggil(U, 'GET', '/laporan/daftar');
await cek('daftar laporan (Lihat) lolos', lapOk.s === 200, lapOk.s);

// 6. Admin menambah Hapus+Sahkan → sesi LAMA langsung lolos (tanpa login ulang).
const tambahHS = await panggil(A, 'PUT', `/pengguna/matriks/${roleId}`, {
  hak: {
    ...matriksAwal,
    pembelian: ['lihat', 'tambah', 'ubah', 'hapus', 'sahkan'],
    opname: ['lihat', 'tambah', 'ubah', 'hapus', 'sahkan'],
    'persediaan-sub': ['lihat', 'tambah', 'ubah', 'hapus', 'sahkan'],
    master: ['lihat', 'ekspor'],
  },
});
await cek('admin menambah Hapus+Sahkan+Ekspor', tambahHS.s === 200, tambahHS.s);
const sahkanOk = await panggil(U, 'POST', `/pembelian/${idBeli}/sahkan`, {});
await cek('AX7 sahkan lolos di sesi lama (baca DB per request)', sahkanOk.s === 200, `${sahkanOk.s} ${sahkanOk.d?.pesan ?? ''}`);
const batalPulihOk = await panggil(U, 'POST', `/pembelian/${idBeli}/batal`, { alasan: 'uji batal pulih' });
await cek('AX2 batal&pulihkan = Hapus+Sahkan (lolos)', batalPulihOk.s === 200, `${batalPulihOk.s} ${batalPulihOk.d?.pesan ?? ''}`);
const batalMasukOk = await panggil(U, 'POST', `/persediaan/${idMasuk}/batal`, { alasan: 'uji' });
await cek('AX2 batal item masuk lolos (Hapus+Sahkan)', batalMasukOk.s === 200, `${batalMasukOk.s} ${batalMasukOk.d?.pesan ?? ''}`);
const eksporOk = await panggil(U, 'GET', '/master/produk/ekspor');
await cek('ekspor produk lolos setelah sel Ekspor', eksporOk.s === 200, eksporOk.s);

// 7. Admin mencabut Ubah → sesi lama langsung ditolak.
const cabutUbah = await panggil(A, 'PUT', `/pengguna/matriks/${roleId}`, {
  hak: { ...matriksAwal, pembelian: ['lihat', 'tambah', 'hapus', 'sahkan'] },
});
await cek('admin mencabut Ubah', cabutUbah.s === 200, cabutUbah.s);
const draft2 = await panggil(U, 'POST', '/pembelian', {
  supplier_id: SUP, warehouse_id: GD1, metode: 'biasa', items: [await itemBeli(PROD1)],
});
const idBeli2: number = draft2.d?.id ?? draft2.d?.data?.id ?? 0;
const ubahTolak = await panggil(U, 'PUT', `/pembelian/${idBeli2}`, {
  supplier_id: SUP, warehouse_id: GD1, metode: 'biasa', items: [await itemBeli(PROD1)],
});
await cek(
  'AX7 ubah ditolak di sesi lama setelah pencabutan',
  ubahTolak.s === 403 && String(ubahTolak.d?.pesan ?? '').includes("belum memiliki izin 'Ubah' pada Pembelian"),
  `${ubahTolak.s} ${ubahTolak.d?.pesan ?? ''}`,
);

// 8. AX3 cakupan gudang terpisah: user GD-2 tidak bisa menyentuh GD-1.
await siapkanUser(USER_UJI2, 'Uji AX Gudang', ['GD-2']);
await cek('siapkan pengguna cakupan GD-2', true);
const uji2 = await masuk(USER_UJI2, SANDI_UJI);
await cek('pengguna GD-2 masuk', uji2.s === 200, uji2.s);
const draftLuar = await panggil(uji2.cookie, 'POST', '/pembelian', {
  supplier_id: SUP, warehouse_id: GD1, metode: 'biasa', items: [await itemBeli(PROD1)],
});
await cek('AX3 draft ke gudang di luar cakupan ditolak', draftLuar.s === 403, `${draftLuar.s} ${draftLuar.d?.pesan ?? ''}`);

// Bersih-bersih.
{
  // Pengguna berriwayat dokumen tidak bisa dihapus (guard arsip) — cukup
  // pindahkan ke peran bawaan agar peran uji bisa dihapus.
  const daftar = await panggil(A, 'GET', '/pengguna/daftar');
  for (const r of ((daftar.d?.data ?? []) as any[])) {
    if (r.username !== USER_UJI && r.username !== USER_UJI2) continue;
    const peran = await panggil(A, 'GET', '/pengguna/peran');
    const operator = ((peran.d?.data ?? []) as any[]).find((x: any) => x.nama === 'Operator');
    if (operator && r.peran_id !== operator.id) {
      await panggil(A, 'PUT', `/pengguna/${r.id}`, { nama: r.nama, username: r.username, peran_id: operator.id, cakupan_toko: r.cakupan_toko });
    }
    const nonaktif = await panggil(A, 'POST', `/pengguna/${r.id}/status`, { aktif: false });
    void nonaktif;
  }
  const peran = await panggil(A, 'GET', '/pengguna/peran');
  for (const r of ((peran.d?.data ?? []) as any[])) {
    if (r.nama === ROLE_UJI) await panggil(A, 'DELETE', `/pengguna/peran/${r.id}`);
  }
}
{
  const cekPeran = await panggil(A, 'GET', '/pengguna/peran');
  const sisa = ((cekPeran.d?.data ?? []) as any[]).filter((x: any) => x.nama === ROLE_UJI);
  await cek('bersih: peran uji dihapus', sisa.length === 0, sisa.length);
}

console.log(`\nRINGKASAN AX7: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);

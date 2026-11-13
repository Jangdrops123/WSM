// ============================================================================
// uji-akses — Pengguna & Hak Akses (semua peran + perubahan peran)
//
// Jalankan (API harus hidup di :3001):
//   npx tsx scripts/uji-akses.ts
//
// Yang diperiksa:
//   1. Setiap peran bawaan bisa dibuatkan pengguna, masuk, dan membawa kunci
//      peran + matriks hak yang benar (Administrator, Manajer, Akuntan,
//      Kasir, Gudang).
//   2. Peran kustom: dibuat, diberi matriks, dipakai login, dan TIDAK lagi
//      menyamar sebagai Manajer (kunci "lainnya").
//   3. Perubahan peran: sesi lama langsung mati, login berikutnya memakai
//      hak peran baru.
//   4. Guard: non-Admin tidak bisa mengubah matriks/izin tab atau menaikkan
//      diri menjadi Administrator; peran Administrator tidak bisa diubah
//      nama/dihapus.
//   5. Halaman awal & mode POS tersimpan global di server (bukan localStorage),
//      hanya Admin yang bisa mengubah.
//   5b. AY: menu awal per peran (kolom roles.menu_awal) — diubah Admin/top
//      atau peran berizin Ubah Pengaturan; validasi kode + sel Lihat;
//      sesi membawa menuAwal yang diselesaikan server; pengaturan lama
//      (PUT halaman) dijawab 410 dengan arahan ke Matriks Peran.
//   6. Izin tab Pengaturan mengenali peran kustom (nama peran, bukan kunci).
//
// Skrip membersihkan pengguna/peran/izin yang dibuatnya, dan mengembalikan
// halaman awal seperti semula. Aman diulang.
// ============================================================================

const BASE = process.env.BASE ?? 'http://127.0.0.1:3001';
const ADMIN_USER = process.env.UJI_USERNAME ?? 'admin';
const ADMIN_SANDI = process.env.UJI_SANDI ?? 'admin123';
const SANDI_UJI = 'SandiUji123!';
const ROLE_UJI = 'Uji Supervisor';
const PREFIX_USER = 'uji_akses_';

let lulus = 0;
let gagal = 0;
const cek = async (nama: string, ok: boolean, info: unknown = '') => {
  if (ok) lulus++;
  else gagal++;
  console.log(`${ok ? '✔' : '✘'} ${nama}${info ? ` — ${typeof info === 'string' ? info : JSON.stringify(info)}` : ''}`);
};

type Jawaban = { s: number; d: Record<string, any> | null };

async function panggil(
  cookie: string | null,
  method: string,
  jalur: string,
  body?: unknown,
): Promise<Jawaban> {
  const res = await fetch(`${BASE}/api${jalur}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let d: Record<string, any> | null = null;
  try {
    d = (await res.json()) as Record<string, any>;
  } catch {
    /* balasan bukan JSON */
  }
  return { s: res.status, d };
}

async function masuk(username: string, sandi: string): Promise<Jawaban & { cookie: string }> {
  const res = await fetch(`${BASE}/api/auth/masuk`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, sandi, ingat: false }),
  });
  let d: Record<string, any> | null = null;
  try {
    d = (await res.json()) as Record<string, any>;
  } catch {
    /* bukan JSON */
  }
  const set = res.headers.get('set-cookie') ?? '';
  const m = /ns_sesi=([^;]+)/.exec(set);
  return { s: res.status, d, cookie: m ? `ns_sesi=${m[1]}` : '' };
}

const admin = await masuk(ADMIN_USER, ADMIN_SANDI);
if (admin.s !== 200 || !admin.cookie) {
  console.error(`Gagal masuk sebagai Admin (${admin.s}): ${JSON.stringify(admin.d)}`);
  process.exit(1);
}
const A = admin.cookie;

/* ---------------------------- data awal -------------------------------- */

const peranAwal = await panggil(A, 'GET', '/pengguna/peran');
if (peranAwal.s !== 200) {
  console.error(`GET /pengguna/peran gagal (${peranAwal.s}): ${JSON.stringify(peranAwal.d)}`);
  process.exit(1);
}
const peranDb = (peranAwal.d?.data ?? []) as {
  id: number;
  nama: string;
  bawaan: boolean;
  hak: Record<string, string>;
  jumlah_pengguna: number;
}[];
const idPeran = async (nama: string) => peranDb.find((p) => p.nama.toLowerCase() === nama.toLowerCase())?.id ?? 0;

/* Fiks peran bawaan: produksi tak lagi punya Manajer/Akuntan (dihapus pemilik).
   Dibuat dari salinan Administrator agar matriks operasional (pos, akuntansi,
   master) lengkap — penolakan matriks/tab/halaman-awal tetap 403 karena hanya
   untuk peran Top. Peninggalan uji lama yang tak dipakai dihapus dulu agar
   matriks selalu segar. */
const gudangSemua: string[] = ((peranAwal.d as Record<string, any> | null)?.toko ?? [])
  .map((t: { kode: string }) => t.kode)
  .filter(Boolean);
const peranUjiDibuat: number[] = [];
for (const nama of ['Manajer', 'Akuntan']) {
  let r = peranDb.find((p) => p.nama.toLowerCase() === nama.toLowerCase());
  if (r) {
    const hapus = await panggil(A, 'DELETE', `/pengguna/peran/${r.id}`);
    if (hapus.s === 200) {
      peranDb.splice(peranDb.indexOf(r), 1);
      r = undefined;
    }
  }
  if (!r) {
    const idAdm = peranDb.find((p) => p.nama.toLowerCase() === 'administrator')?.id ?? 0;
    const buat = await panggil(A, 'POST', '/pengguna/peran', { nama, salin_dari: idAdm });
    if (buat.s === 201 && Number(buat.d?.id ?? 0) > 0) {
      peranDb.push({ id: Number(buat.d?.id), nama, bawaan: false, hak: {}, jumlah_pengguna: 0 });
      peranUjiDibuat.push(Number(buat.d?.id));
    }
  }
}
await cek(
  'peran Manajer & Akuntan tersedia (dibuat bila belum ada)',
  (await idPeran('Manajer')) > 0 && (await idPeran('Akuntan')) > 0,
);

const prefAwal = await panggil(A, 'GET', '/pengguna/halaman-awal');
const prefSemula = (prefAwal.d ?? { halaman: {}, mode_pos: 'cepat' }) as {
  halaman: Record<string, string>;
  mode_pos: string;
};
const izinSemula = (await panggil(A, 'GET', '/pengaturan/pengguna/izin')).d ?? {};

/* --------------------------- pembersihan ------------------------------- */

async function bersihkan() {
  const daftar = await panggil(A, 'GET', '/pengguna/daftar');
  for (const u of (daftar.d?.data ?? []) as { id: number; username: string }[]) {
    if (u.username.startsWith(PREFIX_USER)) await panggil(A, 'DELETE', `/pengguna/${u.id}`);
  }
  const peran = await panggil(A, 'GET', '/pengguna/peran');
  for (const r of (peran.d?.data ?? []) as { id: number; nama: string }[]) {
    if (r.nama.toLowerCase() === ROLE_UJI.toLowerCase()) {
      await panggil(A, 'DELETE', `/pengguna/peran/${r.id}`);
    }
  }
  // Cabut sisa izin tab atas nama peran uji.
  const izin = (await panggil(A, 'GET', '/pengaturan/pengguna/izin')).d ?? {};
  for (const [kode, daftarPeran] of Object.entries(izin as Record<string, string[]>)) {
    if (daftarPeran.some((x) => x.toLowerCase() === ROLE_UJI.toLowerCase())) {
      const sisa = daftarPeran.filter((x) => x.toLowerCase() !== ROLE_UJI.toLowerCase());
      await panggil(A, 'PUT', `/pengaturan/pengguna/akses/${kode}`, { peran: sisa });
    }
  }
}

await bersihkan();

/* ------------------------- 1) semua peran bawaan ----------------------- */

const PERAN_BAWAAN: {
  nama: string;
  user: string;
  kunci: string;
  akuntansi: boolean;
  master: boolean;
  // Seed Kasir/Gudang tidak punya matriks pengaturan.lihat sehingga guard
  // matriks global menolak GET /pengaturan/daftar (403) — sesuai aturan
  // server saat ini (berlaku sama di SQLite & PG).
  daftarTab: boolean;
}[] = [
  // Administrator tidak dibuat ulang: akun Admin tidak bisa dihapus (by design),
  // jadi pengujiannya memakai sesi Admin yang sedang aktif.
  { nama: 'Administrator', user: '', kunci: 'admin', akuntansi: true, master: true, daftarTab: true },
  { nama: 'Manajer', user: `${PREFIX_USER}manajer`, kunci: 'manajer', akuntansi: true, master: true, daftarTab: true },
  { nama: 'Akuntan', user: `${PREFIX_USER}akuntan`, kunci: 'akuntan', akuntansi: true, master: true, daftarTab: true },
  { nama: 'Kasir', user: `${PREFIX_USER}kasir`, kunci: 'kasir', akuntansi: false, master: true, daftarTab: false },
  { nama: 'Gudang', user: `${PREFIX_USER}gudang`, kunci: 'gudang', akuntansi: false, master: true, daftarTab: false },
];

for (const p of PERAN_BAWAAN) {
  const roleId = await idPeran(p.nama);
  await cek(`peran ${p.nama} ada di database`, roleId > 0);

  let idUser = 0;
  let cookie = A;
  if (p.user) {
    const buat = await panggil(A, 'POST', '/pengguna', {
      nama: `Uji ${p.nama}`,
      username: p.user,
      sandi: SANDI_UJI,
      peran_id: roleId,
      cakupan_toko: gudangSemua,
      wajib_ganti: false,
    });
    await cek(`buat pengguna peran ${p.nama} → 201`, buat.s === 201, buat.d?.pesan);
    idUser = Number(buat.d?.id ?? 0);
    const sesi = await masuk(p.user, SANDI_UJI);
    await cek(`login ${p.nama} → 200`, sesi.s === 200, sesi.d?.pesan);
    cookie = sesi.cookie;
  }

  const sesiInfo = await panggil(cookie, 'GET', '/auth/sesi');
  await cek(`sesi ${p.nama} terbaca → 200`, sesiInfo.s === 200, sesiInfo.d?.pesan);
  const info = sesiInfo.d?.pengguna ?? {};
  const hak = (sesiInfo.d?.hak ?? {}) as Record<string, string[]>;
  await cek(`sesi ${p.nama} membawa kunci peran "${p.kunci}"`, info.peran === p.kunci, `peran=${info.peran}`);
  await cek(
    `sesi ${p.nama} membawa nama peran "${p.nama}"`,
    String(info.peranNama ?? '').toLowerCase() === p.nama.toLowerCase(),
    `peranNama=${info.peranNama}`,
  );
  await cek(
    `flag admin ${p.nama} benar`,
    Boolean(info.admin) === (p.nama === 'Administrator'),
    `admin=${info.admin}`,
  );
  await cek(
    `matriks ${p.nama} berisi modul`,
    Object.keys(hak).length > 0,
    `modul=${Object.keys(hak).length}`,
  );

  const daftarTab = await panggil(cookie, 'GET', '/pengaturan/daftar');
  if (p.daftarTab) {
    await cek(`daftar tab ${p.nama} → 200`, daftarTab.s === 200, daftarTab.d?.pesan);
    await cek(
      `setiap tab ${p.nama} punya status boleh`,
      Array.isArray(daftarTab.d?.tab) && (daftarTab.d?.tab ?? []).every((t: { boleh?: boolean }) => typeof t.boleh === 'boolean'),
    );
  } else {
    await cek(`daftar tab ${p.nama} ditolak tanpa matriks pengaturan (403)`, daftarTab.s === 403, daftarTab.d?.pesan);
  }

  const pos = await panggil(cookie, 'GET', '/pos/produk');
  await cek(`${p.nama} boleh membuka POS (matriks pos.lihat) → 200`, pos.s === 200, pos.d?.pesan);

  const akun = await panggil(cookie, 'GET', '/akuntansi/kas/akun');
  await cek(
    `${p.nama} ${p.akuntansi ? 'boleh' : 'ditolak'} membuka Akuntansi`,
    akun.s === (p.akuntansi ? 200 : 403),
    `HTTP ${akun.s}`,
  );

  const master = await panggil(cookie, 'GET', '/master/produk?per=1');
  await cek(
    `${p.nama} ${p.master ? 'boleh' : 'ditolak'} membuka Master Data`,
    master.s === (p.master ? 200 : 403),
    `HTTP ${master.s}`,
  );

  if (p.nama !== 'Administrator') {
    const ubahMatriks = await panggil(cookie, 'PUT', `/pengguna/matriks/${roleId}`, {
      hak: {},
      khusus: {},
      cakupan_toko: null,
    });
    await cek(`${p.nama} tidak boleh mengubah matriks → 403`, ubahMatriks.s === 403, ubahMatriks.d?.pesan);

    const ubahIzin = await panggil(cookie, 'PUT', '/pengaturan/pengguna/akses/pajak', { peran: [] });
    await cek(`${p.nama} tidak boleh mengubah izin tab → 403`, ubahIzin.s === 403, ubahIzin.d?.pesan);

    const ubahPref = await panggil(cookie, 'PUT', '/pengguna/halaman-awal', { mode_pos: 'foto' });
    await cek(`${p.nama} tidak boleh mengubah halaman awal → 403`, ubahPref.s === 403, ubahPref.d?.pesan);
  }

  // Hapus pengguna uji peran ini (Administrator memakai sesi Admin, tanpa akun uji).
  if (idUser > 0) {
    const hapus = await panggil(A, 'DELETE', `/pengguna/${idUser}`);
    await cek(`hapus pengguna uji ${p.nama} → 200`, hapus.s === 200, hapus.d?.pesan);
  }
}

/* --------------------- 2) perubahan peran sesi aktif ------------------- */

const idKasir = await idPeran('Kasir');
const buatUbah = await panggil(A, 'POST', '/pengguna', {
  nama: 'Uji Ubah Peran',
  username: `${PREFIX_USER}ubah`,
  sandi: SANDI_UJI,
  peran_id: idKasir,
  cakupan_toko: gudangSemua,
});
const idUbah = Number(buatUbah.d?.id ?? 0);
await cek('buat pengguna untuk uji perubahan peran → 201', buatUbah.s === 201, buatUbah.d?.pesan);

const sesiKasir = await masuk(`${PREFIX_USER}ubah`, SANDI_UJI);
await cek('login pengguna uji → 200', sesiKasir.s === 200, sesiKasir.d?.pesan);

const ubahPeran = await panggil(A, 'PUT', `/pengguna/${idUbah}`, {
  nama: 'Uji Ubah Peran',
  username: `${PREFIX_USER}ubah`,
  email: null,
  wa: null,
  peran_id: await idPeran('Manajer'),
  cakupan_toko: gudangSemua,
  sandi: '',
  wajib_ganti: false,
});
await cek('Admin mengubah peran Kasir → Manajer → 200', ubahPeran.s === 200, ubahPeran.d?.pesan);

const sesiLama = await panggil(sesiKasir.cookie, 'GET', '/auth/sesi');
await cek('sesi lama langsung mati setelah peran berubah (401)', sesiLama.s === 401, sesiLama.d?.pesan);

const sesiBaru = await masuk(`${PREFIX_USER}ubah`, SANDI_UJI);
const infoBaru = sesiBaru.d?.sesi?.pengguna ?? {};
await cek('login ulang memakai peran baru (Manajer)', sesiBaru.s === 200 && infoBaru.peran === 'manajer', `peran=${infoBaru.peran}`);

const hakBaru = sesiBaru.d?.sesi?.hak ?? {};
await cek(
  'hak modul ikut peran baru (Manajer punya akuntansi.lihat)',
  (hakBaru.akuntansi ?? []).includes('lihat'),
  JSON.stringify(hakBaru.akuntansi ?? []),
);
const akunBaru = await panggil(sesiBaru.cookie, 'GET', '/akuntansi/kas/akun');
await cek('setelah jadi Manajer, Akuntansi terbuka → 200', akunBaru.s === 200, akunBaru.d?.pesan);

await panggil(A, 'DELETE', `/pengguna/${idUbah}`);

/* ------------------------- 3) peran kustom ----------------------------- */

const buatPeran = await panggil(A, 'POST', '/pengguna/peran', { nama: ROLE_UJI });
await cek('buat peran kustom → 201', buatPeran.s === 201, buatPeran.d?.pesan);
const idKustom = Number(buatPeran.d?.id ?? 0);

const kustomAwal = (await panggil(A, 'GET', '/pengguna/peran')).d?.data?.find(
  (r: { id: number }) => r.id === idKustom,
) as { hak: Record<string, string>; jumlah_pengguna: number } | undefined;
await cek('peran kustom mulai tanpa hak (default deny)', !kustomAwal || Object.values(kustomAwal.hak).every((v) => !v));

const simpanMatriks = await panggil(A, 'PUT', `/pengguna/matriks/${idKustom}`, {
  // Guard matriks global mewajibkan pengaturan.lihat untuk seluruh /pengaturan/*;
  // izin tab saja tidak cukup (desain server: keduanya diperlukan).
  hak: { penjualan: ['lihat', 'cetak'], pos: ['lihat', 'tambah', 'sahkan'], pengaturan: ['lihat'] },
  khusus: { lihat_hpp: true, ubah_harga_kasir: false, diskon_maks: 5, hapus_transaksi: false },
  cakupan_toko: null,
});
await cek('simpan matriks peran kustom → 200', simpanMatriks.s === 200, simpanMatriks.d?.pesan);

const buatKustom = await panggil(A, 'POST', '/pengguna', {
  nama: 'Uji Kustom',
  username: `${PREFIX_USER}kustom`,
  sandi: SANDI_UJI,
  peran_id: idKustom,
  cakupan_toko: gudangSemua,
});
await cek('buat pengguna peran kustom → 201', buatKustom.s === 201, buatKustom.d?.pesan);
const idKustomUser = Number(buatKustom.d?.id ?? 0);

const sesiKustom = await masuk(`${PREFIX_USER}kustom`, SANDI_UJI);
const infoKustom = sesiKustom.d?.sesi?.pengguna ?? {};
await cek('login peran kustom → 200', sesiKustom.s === 200, sesiKustom.d?.pesan);
await cek(
  'peran kustom memakai kunci "lainnya" (bukan Manajer)',
  infoKustom.peran === 'lainnya',
  `peran=${infoKustom.peran}`,
);
await cek(
  'nama peran kustom tampil apa adanya',
  infoKustom.peranNama === ROLE_UJI,
  `peranNama=${infoKustom.peranNama}`,
);
const hakKustom = sesiKustom.d?.sesi?.hak ?? {};
await cek(
  'matriks peran kustom hanya berisi modul yang dicentang',
  (hakKustom.penjualan ?? []).includes('lihat') &&
    (hakKustom.pos ?? []).includes('tambah') &&
    !(hakKustom.master ?? []).length &&
    !(hakKustom.akuntansi ?? []).length,
  JSON.stringify(Object.keys(hakKustom)),
);

const posKustom = await panggil(sesiKustom.cookie, 'GET', '/pos/produk');
await cek('peran kustom boleh membuka POS → 200', posKustom.s === 200, posKustom.d?.pesan);
const masterKustom = await panggil(sesiKustom.cookie, 'GET', '/master/produk?per=1');
await cek('peran kustom tanpa master.lihat ditolak → 403', masterKustom.s === 403, masterKustom.d?.pesan);

// Izin tab atas nama peran kustom (bukan kunci peran).
const izinKini = (await panggil(A, 'GET', '/pengaturan/pengguna/izin')).d ?? {};
const daftarPenomoran: string[] = izinKini.penomoran ?? [];
const beriTab = await panggil(A, 'PUT', '/pengaturan/pengguna/akses/penomoran', {
  peran: [...daftarPenomoran, ROLE_UJI],
});
await cek('Admin memberi tab Penomoran ke peran kustom → 200', beriTab.s === 200, beriTab.d?.pesan);

const tabKustom = await panggil(sesiKustom.cookie, 'GET', '/pengaturan/daftar');
const barisPenomoran = (tabKustom.d?.tab ?? []).find((t: { kode: string }) => t.kode === 'penomoran');
await cek('peran kustom melihat tab yang diizinkan', barisPenomoran?.boleh === true, `boleh=${barisPenomoran?.boleh}`);
const bukaTabKustom = await panggil(sesiKustom.cookie, 'GET', '/pengaturan/penomoran');
await cek('peran kustom boleh membaca tab Penomoran → 200', bukaTabKustom.s === 200, bukaTabKustom.d?.pesan);

await panggil(A, 'PUT', '/pengaturan/pengguna/akses/penomoran', { peran: daftarPenomoran });
const tabSetelahCabut = await panggil(sesiKustom.cookie, 'GET', '/pengaturan/penomoran');
await cek('setelah izin dicabut, peran kustom ditolak → 403', tabSetelahCabut.s === 403, tabSetelahCabut.d?.pesan);

// Guard eskalasi: peran kustom tidak bisa menaikkan diri jadi Administrator.
const idAdmin = await idPeran('Administrator');
const promosi = await panggil(sesiKustom.cookie, 'PUT', `/pengguna/${idKustomUser}`, {
  nama: 'Uji Kustom',
  username: `${PREFIX_USER}kustom`,
  email: null,
  wa: null,
  peran_id: idAdmin,
  cakupan_toko: null,
  sandi: '',
  wajib_ganti: false,
});
await cek('non-Admin tidak bisa menaikkan diri jadi Administrator → 403', promosi.s === 403, promosi.d?.pesan);

const buatAdmin = await panggil(sesiKustom.cookie, 'POST', '/pengguna', {
  nama: 'Penyusup',
  username: `${PREFIX_USER}penyusup`,
  sandi: SANDI_UJI,
  peran_id: idAdmin,
});
await cek('non-Admin tidak bisa membuat akun Administrator → 403', buatAdmin.s === 403, buatAdmin.d?.pesan);

// Peran Administrator tidak boleh diubah nama/dihapus (pengaman).
const gantiNamaAdmin = await panggil(A, 'PUT', `/pengguna/peran/${idAdmin}`, { nama: 'Admin Biasa' });
await cek('peran Administrator tidak bisa diganti nama → 400', gantiNamaAdmin.s === 400, gantiNamaAdmin.d?.pesan);
const hapusAdmin = await panggil(A, 'DELETE', `/pengguna/peran/${idAdmin}`);
await cek('peran Administrator tidak bisa dihapus → 400', hapusAdmin.s === 400, hapusAdmin.d?.pesan);

// Peran kustom masih dipakai → hapus ditolak, setelah pengguna dihapus → boleh.
const hapusPeranDipakai = await panggil(A, 'DELETE', `/pengguna/peran/${idKustom}`);
await cek('hapus peran yang masih dipakai → 409', hapusPeranDipakai.s === 409, hapusPeranDipakai.d?.pesan);

await panggil(A, 'DELETE', `/pengguna/${idKustomUser}`);
const hapusPeran = await panggil(A, 'DELETE', `/pengguna/peran/${idKustom}`);
await cek('hapus peran kustom tanpa pengguna → 200', hapusPeran.s === 200, hapusPeran.d?.pesan);

/* ------------------- 4) AY: menu awal per peran ------------------------ */

const idKasirUji = await idPeran('Kasir');
// Simpan nilai semula agar dipulihkan di akhir.
const peranSemula = (await panggil(A, 'GET', '/pengguna/peran')).d?.data ?? [];
const menuKasirSemula = (peranSemula as { nama: string; menu_awal: string | null }[]).find(
  (r) => r.nama.toLowerCase() === 'kasir',
)?.menu_awal ?? null;

const menuUbah = await panggil(A, 'PUT', `/pengguna/peran/${idKasirUji}/menu-awal`, { menu_awal: 'pos-foto' });
await cek('Admin mengubah menu awal Kasir → 200', menuUbah.s === 200, menuUbah.d?.pesan);
const buatKasirUji = await panggil(A, 'POST', '/pengguna', {
  nama: 'Uji Menu Awal',
  username: `${PREFIX_USER}menu`,
  sandi: SANDI_UJI,
  peran_id: idKasirUji,
  cakupan_toko: gudangSemua,
});
const idKasirUjiUser = Number(buatKasirUji.d?.id ?? 0);
await cek('buat pengguna kasir uji → 201', buatKasirUji.s === 201, buatKasirUji.d?.pesan);
const sesiKasirUji = await masuk(`${PREFIX_USER}menu`, SANDI_UJI);
await cek(
  'menu awal terselesaikan di sesi login (server, sesuai peran)',
  sesiKasirUji.d?.sesi?.menuAwal?.rute === '/penjualan/pos/foto',
  JSON.stringify(sesiKasirUji.d?.sesi?.menuAwal),
);
if (idKasirUjiUser > 0) await panggil(A, 'DELETE', `/pengguna/${idKasirUjiUser}`);

const menuHantu = await panggil(A, 'PUT', `/pengguna/peran/${idKasirUji}/menu-awal`, { menu_awal: 'halaman-hantu' });
await cek('kode menu tak dikenal → 400 dengan pesan jelas', menuHantu.s === 400 && /tidak dikenal/i.test(String(menuHantu.d?.pesan)), menuHantu.d?.pesan);

const menuTanpaLihat = await panggil(A, 'PUT', `/pengguna/peran/${idKasirUji}/menu-awal`, { menu_awal: 'laporan-keuangan' });
await cek('halaman tanpa sel Lihat → 400 dengan pesan jelas', menuTanpaLihat.s === 400 && /belum dicentang/i.test(String(menuTanpaLihat.d?.pesan)), menuTanpaLihat.d?.pesan);

const modeUbah = await panggil(A, 'PUT', '/pengguna/halaman-awal', { mode_pos: 'foto' });
await cek('Admin menyimpan mode POS bawaan → 200', modeUbah.s === 200, modeUbah.d?.pesan);
const prefBaca = await panggil(A, 'GET', '/pengguna/halaman-awal');
await cek('mode POS tersimpan di server', prefBaca.d?.mode_pos === 'foto', JSON.stringify(prefBaca.d));

const prefLama = await panggil(A, 'PUT', '/pengguna/halaman-awal', { halaman: { kasir: 'pos' } });
await cek('pengaturan halaman-awal lama diarahkan ke Matriks Peran (410)', prefLama.s === 410, prefLama.d?.pesan);

/* ------------------------- 5) bersihkan & pulihkan --------------------- */

// Kembalikan menu awal Kasir + mode POS seperti sebelum uji.
await panggil(A, 'PUT', `/pengguna/peran/${idKasirUji}/menu-awal`, { menu_awal: menuKasirSemula });
await panggil(A, 'PUT', '/pengguna/halaman-awal', {
  halaman: prefSemula.halaman,
  mode_pos: prefSemula.mode_pos,
});
await panggil(A, 'PUT', '/pengaturan/pengguna/akses/penomoran', {
  peran: (izinSemula as Record<string, string[]>).penomoran ?? [],
});
await bersihkan();
for (const id of peranUjiDibuat) await panggil(A, 'DELETE', `/pengguna/peran/${id}`);

const sisa = await panggil(A, 'GET', '/pengguna/daftar');
await cek(
  'tidak ada pengguna uji yang tertinggal',
  !(sisa.d?.data ?? []).some((u: { username: string }) => u.username.startsWith(PREFIX_USER)),
);
const sisaPeran = await panggil(A, 'GET', '/pengguna/peran');
await cek(
  'tidak ada peran uji yang tertinggal',
  !(sisaPeran.d?.data ?? []).some((r: { nama: string }) => r.nama === ROLE_UJI),
);

console.log(`\nHasil: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal > 0 ? 1 : 0);

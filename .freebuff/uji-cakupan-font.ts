// Uji AH2d — cakupan penyimpanan Pengaturan ▸ Tampilan:
// "Semua pengguna (database)" vs "Hanya akun saya" + validasi opsi Ukuran Font.
// Bersih: mengembalikan nilai global, menghapus blob per-akun & akun uji.
import assert from 'node:assert';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3001';

async function login(username: string, sandi: string): Promise<string> {
  const r = await fetch(`${BASE}/api/auth/masuk`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, sandi, ingat: true }),
  });
  assert.ok(r.ok, `login ${username} gagal (${r.status}): ${await r.text()}`);
  const m = /ns_sesi=([^;]+)/.exec(r.headers.get('set-cookie') ?? '');
  assert.ok(m, 'cookie sesi tidak ada');
  return `ns_sesi=${m[1]}`;
}

const j = (c: string, method: string, url: string, body?: unknown) =>
  fetch(`${BASE}${url}`, {
    method,
    headers: { 'content-type': 'application/json', cookie: c },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const baca = async (c: string) => (await j(c, 'GET', '/api/pengaturan/tampilan')).json() as Promise<{ nilai: Record<string, unknown> }>;

let lolos = 0;
const cek = (nama: string, kondisi: boolean, detail?: unknown) => {
  assert.ok(kondisi, `GAGAL: ${nama}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  lolos++;
  console.log(`  ✔ ${nama}`);
};

const A = await login('admin', 'admin123');
const awal = (await baca(A)).nilai;
console.log('nilai global awal:', awal);

// 1. Validasi opsi Ukuran Font baru.
{
  const r = await j(A, 'PUT', '/api/pengaturan/tampilan', { nilai: { ...awal, ukuran_font: '999' } });
  cek('ukuran_font di luar daftar ditolak (400)', r.status === 400, await r.text());
  const r2 = await j(A, 'PUT', '/api/pengaturan/tampilan', { nilai: { ...awal, ukuran_font: 'kustom', ukuran_font_kustom: 60 } });
  cek('persentase kustom 60% ditolak (min 75)', r2.status === 400, await r2.text());
}

// 2. Admin memilih "Hanya akun saya" (125%) — tersimpan per akun.
{
  const r = await j(A, 'PUT', '/api/pengaturan/tampilan', {
    nilai: { ...awal, ukuran_font: '125', ukuran_font_kustom: 130, tampilan_cakupan: 'akun' },
  });
  cek('simpan cakupan "hanya akun saya" (200)', r.status === 200, await r.text());
  const kini = (await baca(A)).nilai;
  cek('admin membaca 125% (milik akunnya)', kini.ukuran_font === '125' && kini.tampilan_cakupan === 'akun', kini);
}

// 3. Akun lain TIDAK terpengaruh — tetap nilai global.
let B: string;
const usernameUji = `uji.tampilan.${Date.now().toString(36)}`;
{
  // Beri izin tab Tampilan ke peran Kasir (lalu dikembalikan setelah uji).
  const izinSebelum = (await (await j(A, 'GET', '/api/pengaturan/pengguna/izin')).json()) as Record<string, string[]>;
  const daftar = [...new Set([...(izinSebelum.tampilan ?? []), 'kasir'])];
  const izin = await j(A, 'PUT', '/api/pengaturan/pengguna/akses/tampilan', { peran: daftar });
  cek('izin tab Tampilan diberikan ke Kasir', izin.status === 200, izin.status === 200 ? undefined : await izin.text());

  // Matriks hak modul Pengaturan (Ubah) agar Kasir boleh menyimpan pengaturan.
  const peranLama = (await (await j(A, 'GET', '/api/pengguna/peran')).json()) as {
    data: { id: number; hak: Record<string, string> }[];
  };
  const kasir = peranLama.data.find((p) => p.id === 2);
  assert.ok(kasir, 'peran Kasir tidak ditemukan');
  const hakSebelum = Object.fromEntries(
    Object.entries(kasir.hak).map(([k, v]) => [k, v ? v.split(',').filter(Boolean) : []]),
  ) as Record<string, string[]>;
  const hakBaru = { ...hakSebelum, pengaturan: [...new Set([...(hakSebelum.pengaturan ?? []), 'lihat', 'ubah', 'tambah'])] };
  const matriks = await j(A, 'PUT', '/api/pengguna/matriks/2', { hak: hakBaru });
  cek('hak modul Pengaturan (Ubah) diberikan ke Kasir', matriks.status === 200, matriks.status === 200 ? undefined : await matriks.text());

  const buat = await j(A, 'POST', '/api/pengguna/', {
    nama: 'Uji Cakupan Tampilan',
    username: usernameUji,
    sandi: 'Uji12345!',
    peran_id: 2, // Kasir — izin tab Tampilan sudah diberikan di atas
  });
  cek('akun uji dibuat', buat.status === 201, buat.status === 201 ? undefined : `${buat.status} ${await buat.text()}`);
  const idUji = ((await buat.json()) as { id: number }).id;
  B = await login(usernameUji, 'Uji12345!');
  const b = (await baca(B)).nilai;
  cek('akun lain tetap memakai nilai global (87%/awal)', b.ukuran_font === awal.ukuran_font && b.tampilan_cakupan === 'semua', b);

  // 4. Akun lain mengatur miliknya sendiri (80%) — tidak menimpa admin.
  const rb = await j(B, 'PUT', '/api/pengaturan/tampilan', {
    nilai: { ...awal, ukuran_font: '80', tampilan_cakupan: 'akun' },
  });
  cek('akun lain menyimpan cakupan akun (200)', rb.status === 200, await rb.text());
  const lagi = (await baca(A)).nilai;
  cek('pengaturan admin tidak berubah (125%)', lagi.ukuran_font === '125', lagi);
  const b2 = (await baca(B)).nilai;
  cek('akun lain membaca 80% miliknya', b2.ukuran_font === '80', b2);

  // 5. Admin kembali ke "Semua pengguna" → global berubah, blob admin terhapus.
  const rg = await j(A, 'PUT', '/api/pengaturan/tampilan', {
    nilai: { ...awal, ukuran_font: '112', tampilan_cakupan: 'semua' },
  });
  cek('simpan cakupan "semua pengguna" (200)', rg.status === 200, await rg.text());
  const g = (await baca(A)).nilai;
  cek('admin kini membaca global 112%', g.ukuran_font === '112' && g.tampilan_cakupan === 'semua', g);
  const b3 = (await baca(B)).nilai;
  cek('akun lain tetap 80% (override miliknya menimpa global)', b3.ukuran_font === '80', b3);

  // 6. Kembalikan ke Bawaan oleh akun ber-override → memakai global lagi.
  const reset = await j(B, 'POST', '/api/pengaturan/tampilan/bawaan', {});
  cek('reset akun ber-override (200)', reset.status === 200, await reset.text());
  const b4 = (await baca(B)).nilai;
  cek('setelah reset, akun kembali ke global (112%)', b4.ukuran_font === '112' && b4.tampilan_cakupan === 'semua', b4);

  // Bersih: hapus akun uji & kembalikan izin tab.
  const hapus = await j(A, 'DELETE', `/api/pengguna/${idUji}`);
  cek('akun uji dihapus', hapus.status === 200 || hapus.status === 204, hapus.status === 200 || hapus.status === 204 ? undefined : `${hapus.status} ${await hapus.text()}`);
  const pulihIzin = await j(A, 'PUT', '/api/pengaturan/pengguna/akses/tampilan', { peran: izinSebelum.tampilan ?? [] });
  cek('izin tab Tampilan dikembalikan', pulihIzin.status === 200, pulihIzin.status === 200 ? undefined : await pulihIzin.text());
  const pulihMatriks = await j(A, 'PUT', '/api/pengguna/matriks/2', { hak: hakSebelum });
  cek('matriks hak Kasir dikembalikan', pulihMatriks.status === 200, pulihMatriks.status === 200 ? undefined : await pulihMatriks.text());
}

// 7. Bersih: kembalikan global ke nilai awal.
{
  const r = await j(A, 'PUT', '/api/pengaturan/tampilan', { nilai: { ...awal, tampilan_cakupan: 'semua' } });
  cek('nilai global dikembalikan', r.status === 200, await r.text());
  const akhir = (await baca(A)).nilai;
  cek('nilai global = awal', JSON.stringify({ ...akhir, tampilan_cakupan: null }) === JSON.stringify({ ...awal, tampilan_cakupan: null }), { akhir, awal });
}

console.log(`\nSEMUA LULUS (${lolos} pemeriksaan).`);

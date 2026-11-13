// ============================================================================
// sesi-uji — koneksi sesi untuk skrip uji lama (uji-*.ts / uji-*.mjs).
//
// Sejak modul Log In aktif, SELURUH /api menolak permintaan tanpa cookie
// sesi (wajibLogin). Skrip uji lama hanya mengirim header content-type /
// x-peran sehingga kini mendapat 401. Helper ini login sekali sebagai Admin
// (default: admin / admin123 — bisa lewat env UJI_USERNAME / UJI_SANDI),
// menyimpan cookie `ns_sesi`, lalu mengembalikan header siap pakai:
//
//   headers: await headerUji()                          // admin bawaan
//   headers: await headerUji({ 'x-peran': 'kasir' })    // override peran uji
//   headers: await headerUji({ 'content-type': 'application/octet-stream' })
//
// Sesi Admin boleh mengirim x-peran (konteksDariToken) sehingga skrip yang
// menguji matriks izin per peran tetap berjalan persis seperti sebelumnya.
// Port mengikuti BASE / API_PORT (untuk server uji terpisah, mis. 3017).
// ============================================================================

const PORT = process.env.API_PORT ?? '3001';
const BASE = process.env.BASE ?? `http://127.0.0.1:${PORT}`;
const USERNAME = process.env.UJI_USERNAME ?? 'admin';
const SANDI = process.env.UJI_SANDI ?? 'admin123';

let janji = null;

function sesi() {
  if (!janji) {
    janji = (async () => {
      const res = await fetch(`${BASE}/api/auth/masuk`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: USERNAME, sandi: SANDI, ingat: true }),
      });
      if (!res.ok) {
        throw new Error(`Login uji gagal (${res.status}): ${await res.text()}`);
      }
      const set = res.headers.get('set-cookie') ?? '';
      const m = /ns_sesi=([^;]+)/.exec(set);
      if (!m) throw new Error('Cookie sesi ns_sesi tidak diterima dari /api/auth/masuk.');
      return { cookie: `ns_sesi=${m[1]}` };
    })();
    janji.catch(() => {
      janji = null; // gagal → percobaan berikutnya mengulang login
    });
  }
  return janji;
}

/** Header lengkap untuk satu permintaan uji (content-type + cookie + x-peran). */
export async function headerUji(extra = {}) {
  const { cookie } = await sesi();
  return { 'content-type': 'application/json', 'x-peran': 'admin', cookie, ...extra };
}

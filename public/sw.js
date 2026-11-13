/*
 * Service worker NusaSuite — sengaja MINIMAL.
 *
 * Tugasnya hanya memenuhi syarat "installable" PWA (mode standalone saat
 * ditambahkan ke layar utama). TIDAK ada cache aplikasi: semua permintaan
 * diteruskan ke jaringan apa adanya agar data POS/akuntansi tidak pernah
 * basi atau tertukar antar versi. Naikkan versi bila perilaku berubah.
 */
const VERSI = 'nusasuite-sw-v1';

self.addEventListener('install', () => {
  // Aktif segera tanpa menunggu tab lama ditutup.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Bersihkan cache lama dari versi sebelumnya (bila pernah ada).
      try {
        const kunci = await caches.keys();
        await Promise.all(kunci.filter((k) => k !== VERSI).map((k) => caches.delete(k)));
      } catch {
        /* Cache API tidak tersedia — abaikan */
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  // Network passthrough: tidak memanggil respondWith() → browser memakai
  // jalur normal. Handler tetap ada agar memenuhi kriteria instalasi.
  if (event.request.method !== 'GET') return;
});

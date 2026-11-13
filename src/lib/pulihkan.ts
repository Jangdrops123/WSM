/**
 * Pemulihan aplikasi macet / gagal start (layar blank).
 *
 * `pulihkanAplikasi()` dipakai PenangkapGalat (Error Boundary) dan jalur
 * boot-gagal di main.tsx: bersihkan penyimpanan lokal (best-effort — mode
 * privat/kuota penuh tidak boleh melempar), lepas service worker bila ada,
 * lalu muat ulang. localStorage korup adalah penyebab umum crash berulang,
 * jadi reset total lebih menolong daripada reload saja.
 */
export function muatUlangAplikasi(): void {
  window.location.reload();
}

export function pulihkanAplikasi(): void {
  try {
    localStorage.clear();
  } catch {
    /* penyimpanan nonaktif — lanjut */
  }
  try {
    sessionStorage.clear();
  } catch {
    /* penyimpanan nonaktif — lanjut */
  }
  try {
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker
        .getRegistrations()
        .then((daftar) => {
          for (const r of daftar) void r.unregister();
        })
        .catch(() => {
          /* abaikan */
        })
        .finally(() => window.location.reload());
      return;
    }
  } catch {
    /* abaikan */
  }
  window.location.reload();
}

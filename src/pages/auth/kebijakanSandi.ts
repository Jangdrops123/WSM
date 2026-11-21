// Kebijakan kekuatan password di sisi klien.
//
// Nilai bawaan diselaraskan dengan Pengaturan ▸ Keamanan pada server
// (sandi_min_panjang = 8, sandi_wajib_huruf_angka = aktif). Nilai dari server
// disimpan sementara oleh `simpanKebijakan` setelah halaman Log In memuat
// /api/auth/info, sehingga indikator selalu mengikuti kebijakan Admin.

let simpanan: { panjang: number; hurufAngka: boolean; simbol: boolean } = {
  panjang: 8,
  hurufAngka: true,
  simbol: false,
};

export function kebijakanRingkas(): { panjang: number; hurufAngka: boolean; simbol: boolean } {
  return simpanan;
}

export function simpanKebijakan(k: { panjang?: number; hurufAngka?: boolean; simbol?: boolean }): void {
  simpanan = {
    panjang: Number.isFinite(k.panjang) && (k.panjang ?? 0) >= 6 ? Number(k.panjang) : simpanan.panjang,
    hurufAngka: typeof k.hurufAngka === 'boolean' ? k.hurufAngka : simpanan.hurufAngka,
    simbol: typeof k.simbol === 'boolean' ? k.simbol : simpanan.simbol,
  };
}

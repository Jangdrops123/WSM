import { kebijakanRingkas } from './kebijakanSandi';

/**
 * Indikator kekuatan password (Tahap 1 & 2): panjang minimum, huruf + angka,
 * dan opsional simbol/skala panjang. Aturan sama dengan server
 * (`validasiSandiBaru`) — indikator hanya memandu, penolakan tetap server.
 */
export function IndikatorSandi({ sandi }: { sandi: string }) {
  const { panjang, hurufAngka, simbol } = kebijakanRingkas();
  const punyaHuruf = /[A-Za-z]/.test(sandi);
  const punyaAngka = /\d/.test(sandi);
  const punyaSimbol = /[^\w\s]/.test(sandi);

  const syarat: { teks: string; ok: boolean }[] = [
    { teks: `Minimal ${panjang} karakter`, ok: sandi.length >= panjang },
  ];
  if (hurufAngka) {
    // Kebijakan mengharuskan huruf DAN angka (bawaan: min. 8, keduanya wajib).
    syarat.push({ teks: 'Huruf', ok: punyaHuruf });
    syarat.push({ teks: 'Angka', ok: punyaAngka });
  } else {
    syarat.push({ teks: 'Huruf/angka', ok: punyaHuruf || punyaAngka });
  }
  if (simbol) syarat.push({ teks: 'Simbol', ok: punyaSimbol });

  const terpenuhi = syarat.filter((s) => s.ok).length;
  const skor = !sandi ? 0 : Math.min(4, terpenuhi === syarat.length && sandi.length >= 12 ? 4 : terpenuhi);
  const label = ['Belum diisi', 'Lemah', 'Cukup', 'Kuat', 'Sangat kuat'][skor];

  return (
    <div className="sandi-indikator" aria-live="polite">
      <div className="sandi-indikator__bar" data-skor={skor}>
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={n <= skor ? 'aktif' : ''} />
        ))}
      </div>
      <div className="sandi-indikator__teks">
        <span>Kekuatan: <strong>{label}</strong></span>
        <span className="sandi-indikator__syarat">
          {syarat.map((s, i) => (
            <span key={s.teks} className={s.ok ? 'ok' : ''}>
              {i > 0 && <i>·</i>}
              {s.ok ? '✓ ' : ''}
              {s.teks}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

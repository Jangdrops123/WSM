import { useEffect, useState } from 'react';
import { labelZona, useRegional, type Regional } from '../../lib/regional';

/**
 * Format tanggal + jam transaksi mengikuti Pengaturan ▸ Umum & Regional:
 * zona waktu (Asia/Jakarta → WIB, dst.), Format Tanggal
 * (DD/MM/YYYY, YYYY-MM-DD, DD-MM-YYYY, MM/DD/YYYY) dan Format Jam
 * (24 jam / 12 jam AM-PM). Mis. "Kamis, 29/10/2026 • 15:25:00 WIB".
 */
export function formatWaktuTransaksi(now: Date, r: Regional): string {
  const dateStr = new Intl.DateTimeFormat('id-ID', {
    timeZone: r.zona,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
    .format(now)
    // "Kamis, 29/10/2026" — susun ulang sesuai Format Tanggal.
    .replace(/^(\w+,\s*)(\d{2})\/(\d{2})\/(\d{4})$/, (_, hari: string, dd: string, mm: string, yyyy: string) => {
      switch (r.formatTanggal) {
        case 'YYYY-MM-DD':
          return `${hari}${yyyy}-${mm}-${dd}`;
        case 'DD-MM-YYYY':
          return `${hari}${dd}-${mm}-${yyyy}`;
        case 'MM/DD/YYYY':
          return `${hari}${mm}/${dd}/${yyyy}`;
        default:
          return `${hari}${dd}/${mm}/${yyyy}`;
      }
    });
  const bagian = new Intl.DateTimeFormat('en-CA', {
    timeZone: r.zona,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const ambil = (t: string): string => bagian.find((p) => p.type === t)?.value ?? '00';
  const h24 = ambil('hour') === '24' ? 0 : Number(ambil('hour'));
  const jam =
    r.formatJam === '12'
      ? `${h24 % 12 || 12}:${ambil('minute')}:${ambil('second')} ${h24 < 12 ? 'AM' : 'PM'}`
      : `${String(h24).padStart(2, '0')}:${ambil('minute')}:${ambil('second')}`;
  return `${dateStr} • ${jam} ${labelZona(r.zona)}`;
}

/**
 * Live clock 1 detik — dipakai widget tanggal & jam transaksi di header POS.
 * Satu `setInterval` + satu state Date (format murah di render) sehingga
 * tidak lag; regional dari hook membuat jam ikut berubah saat pengaturan
 * zona/format disimpan — tanpa reload maupun restart.
 */
export function useJamTransaksi(): string {
  const regional = useRegional();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const segarkan = () => setNow(new Date());
    // Tab tersembunyi membuat browser men-throttle interval — segarkan
    // seketika saat tab kembali terlihat agar jam tidak tampak statis.
    const saatVisibilitas = () => {
      if (!document.hidden) segarkan();
    };
    const t = window.setInterval(segarkan, 1000);
    document.addEventListener('visibilitychange', saatVisibilitas);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', saatVisibilitas);
    };
  }, []);
  return formatWaktuTransaksi(now, regional);
}

/**
 * Widget Tanggal & Jam Transaksi — diletakkan di header POS, di sebelah kiri
 * tombol "Riwayat & Layanan" / bersampingan dengan badge status shift.
 */
export function JamTransaksi() {
  const teks = useJamTransaksi();
  return (
    <div className="pos-datetime" role="timer" aria-label="Tanggal dan jam transaksi">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span id="pos-transaction-datetime">{teks}</span>
    </div>
  );
}

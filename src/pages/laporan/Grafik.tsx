import { useId } from 'react';
import { formatRupiah } from '../../lib/format';

/**
 * Grafik laporan (N4) — SVG murni tanpa pustaka:
 *  garis  → tren penjualan per periode
 *  batang → perbandingan antar kelompok
 *  donat  → komposisi (mis. metode bayar / kategori)
 */

/* Palet per tema (P4): token --chart-N di styles.css — terang & gelap. */
const WARNA = Array.from({ length: 8 }, (_, i) => `var(--chart-${i + 1})`);

const ringkas = (n: number): string => {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 })} M`;
  if (a >= 1e6) return `${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  if (a >= 1e3) return `${(n / 1e3).toLocaleString('id-ID', { maximumFractionDigits: 0 })} rb`;
  return String(Math.round(n));
};

export function GrafikTren({ data, seri = ['omzet'] }: { data: Record<string, unknown>[]; seri?: string[] }) {
  const id = useId();
  if (data.length === 0) return <p className="grafik-kosong">Tidak ada data grafik.</p>;
  const W = 720, H = 240, P = { t: 14, r: 12, b: 30, l: 58 };
  const maks = Math.max(1, ...data.flatMap((r) => seri.map((s) => Number(r[s] ?? 0))));
  const x = (i: number) => P.l + (i * (W - P.l - P.r)) / Math.max(1, data.length - 1);
  const y = (v: number) => H - P.b - (v / maks) * (H - P.t - P.b);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="grafik" role="img" aria-label="Grafik tren">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line x1={P.l} x2={W - P.r} y1={y(maks * f)} y2={y(maks * f)} className="grafik-garis" />
          <text x={P.l - 6} y={y(maks * f) + 4} textAnchor="end" className="grafik-teks">
            {ringkas(maks * f)}
          </text>
        </g>
      ))}
      {seri.map((s, si) => {
        const warna = WARNA[si % WARNA.length];
        const d = data.map((r, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(Number(r[s] ?? 0))}`).join(' ');
        return (
          <g key={s}>
            <path d={d} fill="none" stroke={warna} strokeWidth="2.2" />
            {data.map((r, i) => (
              <circle key={i} cx={x(i)} cy={y(Number(r[s] ?? 0))} r="2.6" fill={warna}>
                <title>{`${String(r.periode ?? i)} — ${s}: ${formatRupiah(Number(r[s] ?? 0))}`}</title>
              </circle>
            ))}
          </g>
        );
      })}
      {data.map((r, i) =>
        data.length <= 16 || i % Math.ceil(data.length / 16) === 0 ? (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="grafik-teks">
            {String(r.periode ?? '').slice(5)}
          </text>
        ) : null,
      )}
      <defs>
        <linearGradient id={`g-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2563eb" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
        </linearGradient>
      </defs>
      {seri.length === 1 && (
        <path
          d={`${data.map((r, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(Number(r[seri[0]] ?? 0))}`).join(' ')} L${x(data.length - 1)},${H - P.b} L${x(0)},${H - P.b} Z`}
          fill={`url(#g-${id})`}
        />
      )}
    </svg>
  );
}

export function GrafikBatang({
  data,
  kunciX,
  kunciNilai,
  maksItem = 14,
  potongLabel = false,
}: {
  data: Record<string, unknown>[];
  kunciX: string;
  kunciNilai: string;
  /** Batas item; 0 = tampilkan semua (deret waktu 30 hari). */
  maksItem?: number;
  /** Label panjang (mis. 2026-10-01) dipotong menjadi 10-01. */
  potongLabel?: boolean;
}) {
  const top = maksItem > 0 ? data.slice(0, maksItem) : data;
  if (top.length === 0) return <p className="grafik-kosong">Tidak ada data grafik.</p>;
  const maks = Math.max(1, ...top.map((r) => Number(r[kunciNilai] ?? 0)));
  // Deret padat: label ditampilkan tiap 2–3 batang agar tetap terbaca.
  const langkahLabel = top.length > 24 ? 3 : top.length > 16 ? 2 : 1;
  return (
    <div
      className={`grafik-batang ${top.length > 16 ? 'grafik-batang--padat' : ''}`}
      role="img"
      aria-label="Grafik batang"
    >
      {top.map((r, i) => {
        const v = Number(r[kunciNilai] ?? 0);
        const label = String(r[kunciX] ?? '');
        return (
          <div key={i} className="grafik-batang__kolom" title={`${label}: ${formatRupiah(v)}`}>
            {/* X2.4 — nilai di atas batang, nama di bawah batang. */}
            <span className="grafik-batang__nilai">{ringkas(v)}</span>
            <div
              className="grafik-batang__batang"
              style={{ height: `${Math.max(2, (v / maks) * 100)}%`, background: WARNA[i % WARNA.length] }}
            />
            <span className="grafik-batang__label">
              {(top.length - 1 - i) % langkahLabel === 0 ? (potongLabel ? label.slice(5) : label) : '\u00a0'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function GrafikDonat({ data, kunciX, kunciNilai }: { data: Record<string, unknown>[]; kunciX: string; kunciNilai: string }) {
  const top = data.slice(0, 8);
  const total = top.reduce((a, r) => a + Number(r[kunciNilai] ?? 0), 0);
  if (total <= 0) return <p className="grafik-kosong">Tidak ada data grafik.</p>;

  let sudut = -90;
  const busur = top.map((r, i) => {
    const v = Number(r[kunciNilai] ?? 0);
    const a = (v / total) * 360;
    const mulai = sudut;
    sudut += a;
    return { r, i, a, mulai, warna: WARNA[i % WARNA.length] };
  });

  const R = 70, T = 26, cx = 80, cy = 80;
  const lingkaran = (a0: number, a1: number, besar: boolean) => {
    const rad = (deg: number) => ((deg - 0) * Math.PI) / 180;
    const r = besar ? R : R - T;
    const x1 = cx + r * Math.cos(rad(a0)), y1 = cy + r * Math.sin(rad(a0));
    const x2 = cx + r * Math.cos(rad(a1)), y2 = cy + r * Math.sin(rad(a1));
    const besarSebagian = a1 - a0 > 180 ? 1 : 0;
    return `M${cx + R * Math.cos(rad(a0))},${cy + R * Math.sin(rad(a0))} A${R},${R} 0 ${besarSebagian} 1 ${cx + R * Math.cos(rad(a1))},${cy + R * Math.sin(rad(a1))} L${x2},${y2} A${r},${r} 0 ${besarSebagian} 0 ${x1},${y1} Z`;
  };

  return (
    <div className="grafik-donat" role="img" aria-label="Grafik donat">
      <svg viewBox="0 0 160 160" width="160" height="160">
        {busur.map((b) => (
          <path key={b.i} d={lingkaran(b.mulai, b.mulai + b.a - 0.5, false)} fill={b.warna}>
            <title>{`${String(b.r[kunciX] ?? '')}: ${formatRupiah(Number(b.r[kunciNilai] ?? 0))}`}</title>
          </path>
        ))}
        <text x="80" y="76" textAnchor="middle" className="grafik-donat__tengah">
          Total
        </text>
        <text x="80" y="94" textAnchor="middle" className="grafik-donat__tengah grafik-donat__tengah--nilai">
          {ringkas(total)}
        </text>
      </svg>
      <ul className="grafik-legenda">
        {busur.map((b) => (
          <li key={b.i}>
            <span className="grafik-legenda__titik" style={{ background: b.warna }} />
            {String(b.r[kunciX] ?? '')}
            <b>{Math.round((Number(b.r[kunciNilai] ?? 0) / total) * 100)}%</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

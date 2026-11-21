// R2 — Bar periode tampil (dipakai Riwayat & Dokumen Pembelian/Penjualan).
// Pilihan: 7 hari / 14 hari / 1 bulan / rentang tanggal (dari … s/d …).
// Satu pilihan berlaku untuk kedua bagian sekaligus; label kanan selalu
// menunjukkan rentang tampil + jumlah baris supaya tidak ambigu.
import { PILIHAN_PERIODE, type KodePeriode } from '../lib/periode';
import './bar-periode.css';

export interface NilaiPeriode {
  periode: KodePeriode;
  dariInput: string;
  sampaiInput: string;
}

export function BarPeriode({
  nilai,
  onUbah,
  ringkasan,
}: {
  nilai: NilaiPeriode;
  onUbah: (n: NilaiPeriode) => void;
  /** Cth: "Menampilkan 15 Okt – 21 Okt 2026 · 2 transaksi · 1 faktur". */
  ringkasan: string;
}) {
  const { periode, dariInput, sampaiInput } = nilai;
  const rentangAktif = periode === 'rentang';

  return (
    <div className="periode-bar" role="group" aria-label="Periode tampil">
      <span className="periode-bar__label">Periode tampil:</span>
      {PILIHAN_PERIODE.map((p) => (
        <button
          key={p.kode}
          type="button"
          className={`periode-bar__pil${periode === p.kode ? ' periode-bar__pil--aktif' : ''}`}
          aria-pressed={periode === p.kode}
          onClick={() => onUbah({ periode: p.kode, dariInput, sampaiInput })}
        >
          {p.label}
        </button>
      ))}
      <span className="periode-bar__tgl">
        <input
          type="date"
          aria-label="Dari tanggal"
          value={dariInput}
          disabled={!rentangAktif}
          max={sampaiInput || undefined}
          onChange={(e) => onUbah({ periode: 'rentang', dariInput: e.target.value, sampaiInput })}
        />
        <span aria-hidden="true">s/d</span>
        <input
          type="date"
          aria-label="Sampai tanggal"
          value={sampaiInput}
          disabled={!rentangAktif}
          min={dariInput || undefined}
          onChange={(e) => onUbah({ periode: 'rentang', dariInput, sampaiInput: e.target.value })}
        />
      </span>
      <span className="periode-bar__rentang">{ringkasan}</span>
    </div>
  );
}

import { useState } from 'react';
import { DaftarUserBaru } from './DaftarUserBaru';
import { MatriksPeranBaru } from './MatriksPeranBaru';
import './akses-baru.css';

type Pil = 'user' | 'matriks';

const PILLS: { kode: Pil; label: string }[] = [
  { kode: 'user', label: 'User & Hak Akses' },
  { kode: 'matriks', label: 'Matriks Peran' },
];

/**
 * Templat baru Pengaturan › User & Hak Akses — judul + subjudul, pill tabs,
 * kartu Daftar user, kartu Matriks Peran, dan Log Aktivitas.
 */
export function PenggunaHakAksesPage() {
  const [pil, setPil] = useState<Pil>('user');

  return (
    <div className="ax-wrap">
      <div className="ax-kepala">
        <h2>Pengaturan</h2>
        <p>Kelola user dan matriks hak akses.</p>
      </div>

      <div className="ax-pills" role="tablist" aria-label="Bagian pengaturan user">
        {PILLS.map((p) => (
          <button
            key={p.kode}
            type="button"
            role="tab"
            aria-selected={pil === p.kode}
            className={`ax-pill-tab${pil === p.kode ? ' aktif' : ''}`}
            onClick={() => setPil(p.kode)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {pil === 'user' && <DaftarUserBaru />}
      {pil === 'matriks' && <MatriksPeranBaru />}
    </div>
  );
}

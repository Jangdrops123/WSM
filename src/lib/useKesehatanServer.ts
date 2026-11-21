import { useEffect, useState } from 'react';

interface Kesehatan {
  berhasil: boolean;
  pesan: string;
  roles?: number;
}

/** Cek koneksi API + database di latar belakang (tampil di sidebar). */
export function useKesehatanServer(): Kesehatan {
  const [state, setState] = useState<Kesehatan>({ berhasil: false, pesan: 'Memeriksa…' });

  useEffect(() => {
    let hidup = true;
    const periksa = async () => {
      try {
        const res = await fetch('/api/health', { headers: { accept: 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { ok: boolean; roles?: number };
        if (hidup) setState({ berhasil: Boolean(data.ok), pesan: 'Terhubung', roles: data.roles });
      } catch {
        if (hidup) setState({ berhasil: false, pesan: 'API terputus' });
      }
    };
    periksa();
    const timer = window.setInterval(periksa, 30_000);
    return () => {
      hidup = false;
      window.clearInterval(timer);
    };
  }, []);

  return state;
}

import { HalamanGenerik } from '../../components/crud/HalamanGenerik';
import { ENTITAS_SEDERHANA } from './konfigurasi';

/** Halaman CRUD entitas sederhana (kategori, merek, satuan, pelanggan, pemasok). */
export function HalamanUmum({ kode }: { kode: keyof typeof ENTITAS_SEDERHANA }) {
  const cfg = ENTITAS_SEDERHANA[kode];
  if (!cfg) return null;
  return (
    <HalamanGenerik
      entitas={cfg.entitas}
      judul={cfg.judul}
      deskripsi={cfg.deskripsi}
      kolom={cfg.kolom}
      form={cfg.form}
      cariContoh={cfg.cariContoh}
      labelBaris={(b) => String(b.nama ?? b.kode ?? b.id)}
      massalUbah={cfg.massalUbah}
    />
  );
}

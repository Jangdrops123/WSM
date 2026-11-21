// X2.2 — muat data satu widget kartu Dashboard (endpoint /api/dashboard/widget).
import { useEffect, useState } from 'react';
import { adalahGalatAkses, apiGet } from '../../lib/api';
import type { WidgetDashboard } from './tipe';

export interface IsiWidget {
  metrik: string;
  label: string;
  format: 'rupiah' | 'angka' | 'produk' | 'rekening';
  rentang?: { dari: string; sampai: string };
  nilai?: number;
  seri?: { periode: string; nilai: number }[];
  baris?: { label: string; nilai: number; sub?: string }[];
  bagian?: { nama: string; jumlah: number }[];
  rekening?: { nama: string; saldo: number }[];
}

/** Ambil isi widget (refresh saat id/opsi berubah atau `segar` dinaikkan). */
export function useWidgetData(w: WidgetDashboard, segar = 0) {
  const [isi, setIsi] = useState<IsiWidget | null>(null);
  const [sibuk, setSibuk] = useState(w.jenis !== 'pintasan');
  const [galat, setGalat] = useState<string | null>(null);
  // true = widget dibatasi matriks peran (403 kode 'akses') → tampilkan
  // placeholder rapi, bukan teks galat merah.
  const [ditolakAkses, setDitolakAkses] = useState(false);

  useEffect(() => {
    if (w.jenis === 'pintasan') return;
    let batal = false;
    setSibuk(true);
    setDitolakAkses(false);
    const p = new URLSearchParams({
      metrik: w.metrik,
      periode: w.periode ?? '30-hari',
      jumlah: String(w.jumlah ?? 5),
    });
    if (w.dari) p.set('dari', w.dari);
    if (w.sampai) p.set('sampai', w.sampai);
    if (w.gudang) p.set('gudang', w.gudang);
    if (w.kasir) p.set('kasir', w.kasir);
    if (w.kategori) p.set('kategori', w.kategori);
    apiGet<IsiWidget>(`/api/dashboard/widget?${p.toString()}`)
      .then((d) => {
        if (!batal) {
          setIsi(d);
          setGalat(null);
        }
      })
      .catch((e) => {
        if (!batal) {
          setDitolakAkses(adalahGalatAkses(e));
          setGalat(e instanceof Error ? e.message : 'Gagal memuat data kartu.');
        }
      })
      .finally(() => {
        if (!batal) setSibuk(false);
      });
    return () => {
      batal = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.id, w.jenis, w.metrik, w.periode, w.dari, w.sampai, w.gudang, w.kasir, w.kategori, w.jumlah, segar]);

  return { isi, sibuk, galat, ditolakAkses };
}

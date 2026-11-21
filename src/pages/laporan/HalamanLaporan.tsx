import { Component, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { beritahu } from '../../components/crud/Toast';
import { bolehLaporan } from '../../config/menu';
import { apiGet } from '../../lib/api';
import { useSegarkanModul } from '../../lib/segarkan';
import { peranAktif } from '../../lib/pengguna';
import { useSesi } from '../../lib/sesi';
import { DialogStruk, strukDariSale } from '../pos/DialogPos';
import type { StrukData } from '../pos/struk';
import { AksiLaporan } from './aksi';
import { FilterBar } from './FilterBar';
import { KartuGrid, TolakAkses } from './kartu';
import { useFilterLaporan } from './filter';
import { useUsaha } from '../../lib/usaha';

import { TabelLaporan } from './TabelLaporan';
import type { ResponsLaporan } from './tipe';

/**
 * Batas galat render laporan: bila tabel/grafik crash (mis. bentuk baris tak
 * terduga dari server), tampilkan panel pulih — bukan layar merah/putih.
 */
class BatasGalatLaporan extends Component<{ kode: string; children: ReactNode }, { galat: string }> {
  constructor(p: { kode: string; children: ReactNode }) {
    super(p);
    this.state = { galat: '' };
  }
  static getDerivedStateFromError(e: unknown): { galat: string } {
    return { galat: e instanceof Error ? e.message : 'Galat tampilan tak dikenal.' };
  }
  componentDidCatch(e: Error): void {
    console.error(`[LAPORAN:${this.props.kode}] galat render:`, e);
  }
  render(): ReactNode {
    if (this.state.galat) {
      return (
        <div className="pita pita--galat">
          Laporan gagal ditampilkan ({this.state.galat}). Coba segarkan halaman;
          bila berlanjut, hubungi administrator.
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * N4 — Halaman generik /laporan/l/:kode:
 * header judul + ikon aksi (ekspor Excel/PDF, cetak, kirim, simpan, segarkan),
 * kartu ringkasan, laporan tabel, dan drill-down:
 *   rekap → daftar transaksi (periode baris) → struk (popup pratinjau).
 */

/** Ubah label periode baris (2026-10-03 / 2026-10 / 2026-W40) jadi rentang tanggal. */
function rentangPeriode(p: string): { dari: string; sampai: string } | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return { dari: p, sampai: p };
  const bulan = /^(\d{4})-(\d{2})$/.exec(p);
  if (bulan) {
    const akhir = new Date(Date.UTC(Number(bulan[1]), Number(bulan[2]), 0));
    return { dari: `${p}-01`, sampai: akhir.toISOString().slice(0, 10) };
  }
  const minggu = /^(\d{4})-W(\d{2})$/.exec(p);
  if (minggu) {
    const y = Number(minggu[1]);
    const w = Math.max(1, Number(minggu[2]));
    const kamis = new Date(Date.UTC(y, 0, 4 + (w - 1) * 7));
    const senin = new Date(kamis);
    senin.setUTCDate(kamis.getUTCDate() - ((kamis.getUTCDay() + 6) % 7));
    const akhir = new Date(senin);
    akhir.setUTCDate(senin.getUTCDate() + 6);
    return { dari: senin.toISOString().slice(0, 10), sampai: akhir.toISOString().slice(0, 10) };
  }
  return null;
}

export function HalamanLaporan() {
  const { kode = '' } = useParams();
  const navigasi = useNavigate();
  const peran = peranAktif();
  const hakLaporan = useSesi().info?.hak;
  const { ser, params } = useFilterLaporan();

  const [data, setData] = useState<ResponsLaporan | null>(null);
  const [galat, setGalat] = useState('');
  const [sibuk, setSibuk] = useState(true);
  const [segar, setSegar] = useState(false);
  // Identitas usaha global — header cetak/kirim selalu memakai data terbaru
  // dari Pengaturan ▸ Profil Usaha tanpa perlu muat ulang halaman.
  const usaha = useUsaha();
  const [struk, setStruk] = useState<StrukData | null>(null);

  useEffect(() => {
    let hidup = true;
    setSibuk(true);
    setGalat('');
    const q = `${ser ? `${ser}&` : ''}${segar ? 'segar=1' : ''}`;
    void apiGet<ResponsLaporan>(`/api/laporan/${encodeURIComponent(kode)}?${q}`)
      .then((r) => {
        if (hidup) setData(r);
      })
      .catch((e: Error) => {
        if (hidup) setGalat(e.message);
      })
      .finally(() => {
        if (hidup) {
          setSibuk(false);
          setSegar(false);
        }
      });
    return () => {
      hidup = false;
    };
  }, [kode, ser, segar]);
  // Tombol Refresh global di topbar: muat ulang laporan (tanpa mengubah filter).
  useSegarkanModul(() => setSegar(true));


  const diblokir = data ? !bolehLaporan(peran, data.kategori, hakLaporan) : false;

  const pesanRingkas = useMemo(() => {
    if (!data) return '';
    const baris = [
      `${data.judul} (${data.periode.dari} s/d ${data.periode.sampai})`,
      ...data.filter.map(([k, v]) => `${k}: ${v}`),
      ...data.kartu.slice(0, 3).map((k) => `${k.label}: ${k.nilai.toLocaleString('id-ID')}`),
    ];
    return baris.join('\n');
  }, [data]);

  /**
   * Drill-down: baris agregat → daftar transaksi pada periode/baris tersebut.
   * Filter baru dibawa lewat query URL (bukan state terpisah) agar tidak ada
   * balapan antara navigasi & sinkronisasi filter konteks.
   */
  const drillKeDetail = useCallback(
    (row: Record<string, unknown>) => {
      const ke = (tujuan: string, tambahan: Record<string, string>) => {
        const sp = new URLSearchParams();
        for (const [k, v] of Object.entries({ ...params, ...tambahan })) if (v) sp.set(k, v);
        navigasi(`/laporan/l/${tujuan}?${sp.toString()}`);
      };
      if (kode === 'penjualan-rekap') {
        const r = rentangPeriode(String(row.periode ?? ''));
        if (!r) return;
        ke('penjualan-detail', { periode: 'kustom', dari: r.dari, sampai: r.sampai });
        return;
      }
      if (kode === 'pembelian-rekap') {
        const r = rentangPeriode(String(row.periode ?? ''));
        if (!r) return;
        ke('pembelian-status', { periode: 'kustom', dari: r.dari, sampai: r.sampai });
        return;
      }
      if (kode === 'penjualan-pelanggan' && row.pelanggan_id != null) {
        ke('penjualan-detail', { pelanggan: String(row.pelanggan_id) });
        return;
      }
      if (kode === 'pembelian-pemasok' && row.pemasok_id != null) {
        ke('pembelian-status', { pemasok: String(row.pemasok_id) });
        return;
      }
      if (kode === 'penjualan-kasir' && row.kasir_id != null) {
        ke('penjualan-detail', { kasir: String(row.kasir_id) });
        return;
      }
      if (kode === 'penjualan-metode' && row.metode != null) {
        ke('penjualan-detail', { metode: String(row.metode) });
        return;
      }
      if (kode === 'penjualan-detail' && row.id != null) {
        void strukDariSale(Number(row.id), usaha.nama)
          .then(setStruk)
          .catch((e: Error) => beritahu(e.message, 'galat'));
        return;
      }
      // O4 — laporan Opname: klik baris membuka sesi di Persediaan > Opname.
      if ((kode === 'opname-riwayat' || kode === 'opname-selisih') && row.session_id != null) {
        navigasi(`/stok/opname/${Number(row.session_id)}`);
      }
    },
    [kode, navigasi, params, usaha.nama],
  );

  const adaDrill = useMemo(() => {
    if (['penjualan-rekap', 'pembelian-rekap', 'penjualan-pelanggan', 'pembelian-pemasok', 'penjualan-kasir', 'penjualan-metode', 'opname-riwayat', 'opname-selisih'].includes(kode)) {
      return (row: Record<string, unknown>) => {
        if (kode === 'penjualan-pelanggan') return row.pelanggan_id != null;
        if (kode === 'pembelian-pemasok') return row.pemasok_id != null;
        if (kode === 'penjualan-metode') return row.metode != null;
        if (kode.startsWith('opname-')) return row.session_id != null;
        return true;
      };
    }
    if (kode === 'penjualan-detail') return (row: Record<string, unknown>) => row.id != null;
    return undefined;
  }, [kode]);

  if (galat.includes('tidak ditemukan')) {
    return <TolakAkses pesan={galat} />;
  }
  if (diblokir) {
    return (
      <TolakAkses pesan={`Peran ${peran} tidak berhak melihat laporan kategori "${data?.kategori}" (N7).`} />
    );
  }

  return (
    <>
      <section className="kartu laporan-kepala">
        <div className="laporan-kepala__judul">
          <h3>{data?.judul ?? (sibuk ? 'Memuat…' : kode)}</h3>
          <p className="teks-redup teks-kecil">{data?.deskripsi}</p>
          {data && (
            <p className="teks-redup teks-kecil laporan-kepala__filter">
              {data.filter.length
                ? data.filter.map(([k, v]) => `${k}: ${v}`).join(' · ')
                : 'Tanpa filter tambahan'}
              {data.terbatas ? ' · menampilkan baris terbatas (perkecil periode untuk data lengkap)' : ''}
            </p>
          )}
        </div>
        {data && (
          <AksiLaporan
            kode={data.kode}
            judul={data.judul}
            kolom={data.kolom}
            rows={data.rows}
            total={data.total}
            filter={data.filter}
            ser={ser}
            namaUsaha={usaha.nama}
            alamatUsaha={usaha.alamat}
            pesanRingkas={pesanRingkas}
            onSegar={() => setSegar(true)}
          />
        )}
      </section>

      {galat && !sibuk && <div className="pita pita--galat">{galat}</div>}

      {data && !sibuk && (
        <BatasGalatLaporan key={kode} kode={kode}>
          <KartuGrid kartu={data.kartu} aksi={<FilterBar />} />

          <TabelLaporan
            kolom={data.kolom}
            rows={data.rows}
            judul={data.judul}
            adaDrill={adaDrill}
            onDrill={adaDrill ? drillKeDetail : undefined}
            terbatas={data.terbatas}
          />

          <p className="teks-redup teks-kecil laporan-kaki">
            Sumber: /api/laporan/{data.kode} · {data.rows.length} baris · {data.durasi_ms} ms
          </p>
        </BatasGalatLaporan>
      )}

      {struk && <DialogStruk struk={struk} onTutup={() => setStruk(null)} />}
    </>
  );
}

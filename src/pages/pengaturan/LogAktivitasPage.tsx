import { useCallback, useEffect, useState } from 'react';
import { beritahu } from '../../components/crud/Toast';
import { IconButton } from '../../components/IconButton';
import { TombolScan } from '../../components/ScanKamera';
import { apiGet } from '../../lib/api';
import { formatTanggalWaktu } from '../../lib/format';
import { useSegarkanModul } from '../../lib/segarkan';
import { peranAktif } from '../../lib/pengguna';
import { TabPengaturan } from './TabPengaturan';
import type { DaftarPengaturan, Tab } from './tipePengaturan';

interface BarisLog {
  id: number;
  waktu: string;
  aksi: string;
  tab: string;
  alasan: string | null;
  oleh: string;
  sebelum: Record<string, unknown> | null;
  sesudah: Record<string, unknown> | null;
}

const AKSI_LABEL: Record<string, string> = {
  ubah: 'Ubah',
  pulihkan: 'Kembalikan ke Bawaan',
  tambah: 'Tambah',
  hapus: 'Hapus',
  sahkan: 'Sahkan',
  batal: 'Batalkan',
  ekspor: 'Ekspor',
  impor: 'Impor',
  cetak: 'Cetak',
  aktifkan: 'Aktifkan',
  nonaktifkan: 'Nonaktifkan',
  reset: 'Reset Data',
};

const MODUL_LABEL: Record<string, string> = {
  pengaturan: 'Pengaturan',
  stores: 'Data Toko',
  products: 'Produk',
  purchases: 'Pembelian',
  invoices: 'Faktur',
  journals: 'Jurnal',
  stock_ledger: 'Kartu Stok',
  settings: 'Pengaturan (sistem)',
  users: 'Pengguna',
  import_batches: 'Impor',
};

const tampil = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Ya' : 'Tidak';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

/** Tampilkan perubahan sebelum → sesudah. */
function IsiPerubahan({
  sebelum,
  sesudah,
}: {
  sebelum: Record<string, unknown> | null;
  sesudah: Record<string, unknown> | null;
}) {
  const kunci = [...new Set([...Object.keys(sebelum ?? {}), ...Object.keys(sesudah ?? {})])];
  if (!kunci.length) return <span className="teks-redup">—</span>;
  return (
    <ul className="log-isian">
      {kunci.map((k) => (
        <li key={k}>
          <span className="log-kunci">{k}</span>
          <span className="log-lama">{tampil(sebelum?.[k])}</span>
          <span aria-hidden="true">→</span>
          <span className="log-baru">{tampil(sesudah?.[k])}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Pengaturan ▸ Log Aktivitas — riwayat aktivitas (siapa, kapan, sebelum/sesudah)
 * dengan filter pengguna, modul, dan rentang tanggal, ekspor CSV, serta
 * pengaturan lama penyimpanan log.
 */
export function LogAktivitasPage({ tab, daftar, toko }: { tab: Tab; daftar: DaftarPengaturan; toko: string }) {
  return (
    <TabPengaturan tab={tab} daftar={daftar} toko={toko} panel={() => <PanelLogAktivitas />} />
  );
}

function PanelLogAktivitas() {
  const [data, setData] = useState<BarisLog[] | null>(null);
  const [modulTersedia, setModulTersedia] = useState<string[]>([]);
  const [saring, setSaring] = useState({ pengguna: '', modul: '', dari: '', sampai: '' });

  const muat = useCallback(async () => {
    const q = new URLSearchParams({ per: '200' });
    if (saring.pengguna) q.set('pengguna', saring.pengguna);
    if (saring.modul) q.set('modul', saring.modul);
    if (saring.dari) q.set('dari', saring.dari);
    if (saring.sampai) q.set('sampai', saring.sampai);
    try {
      const r = await apiGet<{ data: BarisLog[]; modul: string[] }>(`/api/pengaturan/log/aktivitas?${q}`);
      setData(r.data);
      setModulTersedia(r.modul ?? []);
    } catch (e) {
      beritahu(e instanceof Error ? e.message : 'Gagal memuat log aktivitas.', 'galat');
      setData([]);
    }
  }, [saring]);

  useEffect(() => {
    void muat();
  }, [muat]);
  // Tombol Refresh global di topbar: muat ulang log aktivitas.
  useSegarkanModul(muat);

  function ekspor() {
    const q = new URLSearchParams();
    if (saring.pengguna) q.set('pengguna', saring.pengguna);
    if (saring.modul) q.set('modul', saring.modul);
    if (saring.dari) q.set('dari', saring.dari);
    if (saring.sampai) q.set('sampai', saring.sampai);
    void (async () => {
      try {
        const res = await fetch(`/api/pengaturan/log/ekspor?${q}`, { headers: { 'x-peran': peranAktif() } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'log-aktivitas.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        beritahu('Log aktivitas diekspor ke CSV.');
      } catch (e) {
        beritahu(e instanceof Error ? e.message : 'Gagal mengekspor log.', 'galat');
      }
    })();
  }

  if (!data) return <p className="teks-redup">Memuat log aktivitas…</p>;

  return (
    <section className="kartu">
      <div className="kartu__kepala kartu__kepala--kompak">
        <h3>Riwayat Aktivitas</h3>
        <span className="aksi-baris">
          <IconButton label="Muat ulang" ikon="rotate-ccw" onClick={() => void muat()} />
          <IconButton label="Ekspor CSV" ikon="download" onClick={ekspor} />
        </span>
      </div>

      <div className="filter-log">
        <div className="bidang">
          <label htmlFor="log-pengguna">Pengguna</label>
          <div className="cari-scan">
          <input
            id="log-pengguna"
            type="search"
            value={saring.pengguna}
            placeholder="Nama pengguna…"
            onChange={(e) => setSaring({ ...saring, pengguna: e.target.value })}
          />
          <TombolScan onHasil={(t) => setSaring({ ...saring, pengguna: t })} />
          </div>
        </div>
        <div className="bidang">
          <label htmlFor="log-modul">Modul</label>
          <select id="log-modul" value={saring.modul} onChange={(e) => setSaring({ ...saring, modul: e.target.value })}>
            <option value="">Semua modul</option>
            {modulTersedia.map((m) => (
              <option key={m} value={m}>
                {MODUL_LABEL[m] ?? m}
              </option>
            ))}
          </select>
        </div>
        <div className="bidang">
          <label htmlFor="log-dari">Dari tanggal</label>
          <input id="log-dari" type="date" value={saring.dari} onChange={(e) => setSaring({ ...saring, dari: e.target.value })} />
        </div>
        <div className="bidang">
          <label htmlFor="log-sampai">Sampai tanggal</label>
          <input id="log-sampai" type="date" value={saring.sampai} onChange={(e) => setSaring({ ...saring, sampai: e.target.value })} />
        </div>
        <div className="bidang bidang--centang">
          <input
            id="log-reset"
            type="button"
            className="tombol tombol--kecil tombol--netral"
            value="Bersihkan filter"
            onClick={() => setSaring({ pengguna: '', modul: '', dari: '', sampai: '' })}
            readOnly
          />
        </div>
      </div>

      {data.length === 0 ? (
        <p className="teks-redup">Tidak ada aktivitas yang cocok dengan filter.</p>
      ) : (
        <table className="aturan-tabel log-tabel">
          <thead>
            <tr>
              <th>Waktu</th>
              <th>Oleh</th>
              <th>Aksi</th>
              <th>Modul</th>
              <th>Perubahan</th>
            </tr>
          </thead>
          <tbody>
            {data.map((l) => (
              <tr key={l.id}>
                <td className="log-waktu">{fmtWaktu(l.waktu)}</td>
                <td>{l.oleh}</td>
                <td>{AKSI_LABEL[l.aksi] ?? l.aksi}</td>
                <td>{MODUL_LABEL[l.tab] ?? l.tab}</td>
                <td>
                  <IsiPerubahan sebelum={l.sebelum} sesudah={l.sesudah} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Timestamp ISO (UTC) → tampilan zona & format regional. */
function fmtWaktu(iso: string): string {
  const t = formatTanggalWaktu(iso);
  return t === '—' ? iso : t;
}

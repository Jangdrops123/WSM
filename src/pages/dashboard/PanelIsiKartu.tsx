// X2.2 — Panel pengaturan ISI kartu (per widget): judul, sumber data/metrik,
// jenis tampilan, periode, filter (gudang/kasir/kategori), jumlah item daftar.
import { useEffect, useState } from 'react';
import { Modal } from '../../components/crud/Modal';
import { ambilOpsi, apiGet } from '../../lib/api';
import {
  METRIK_WIDGET,
  PERIODE_WIDGET,
  type JenisWidget,
  type PeriodeWidget,
  type WidgetDashboard,
} from './tipe';

type Opsi = { id: number | string; label: string };

export function PanelIsiKartu({
  widget,
  onSimpan,
  onTutup,
}: {
  widget: WidgetDashboard;
  onSimpan: (w: WidgetDashboard) => void;
  onTutup: () => void;
}) {
  const [w, setW] = useState<WidgetDashboard>({ ...widget });
  const [opsi, setOpsi] = useState<Record<string, Opsi[]>>({});

  useEffect(() => {
    let hidup = true;
    void (async () => {
      const [gudang, kategori, kasir] = await Promise.all([
        ambilOpsi('gudang').catch(() => [] as Opsi[]),
        ambilOpsi('kategori').catch(() => [] as Opsi[]),
        apiGet<{ data: { id: number; nama: string }[] }>('/api/opname/opsi-pengguna')
          .then((r) => r.data.map((x) => ({ id: x.id, label: x.nama })))
          .catch(() => [] as Opsi[]),
      ]);
      if (hidup) setOpsi({ gudang, kategori, kasir });
    })();
    return () => {
      hidup = false;
    };
  }, []);

  // Metrik yang didukung jenis widget ini.
  const metrikTersedia = METRIK_WIDGET.filter((m) => m.jenis.includes(w.jenis));
  const metrikTerpilih = METRIK_WIDGET.find((m) => m.kode === w.metrik) ?? metrikTersedia[0];

  const bisaGrafik = metrikTerpilih?.jenis.includes('grafik') ?? false;
  const bisaDaftar = metrikTerpilih?.jenis.includes('daftar') ?? false;
  const bisaDonat = metrikTerpilih?.jenis.includes('donat') ?? false;
  // KPI angka waktu (omzet, pembelian, laba, transaksi) tetap boleh memilih
  // 7/14/30 hari oleh Admin; KPI saldo (stok, piutang, menipis) tidak.
  const metrikBerperiode = ['penjualan', 'pembelian', 'laba', 'transaksi'].includes(w.metrik);
  const bisaPeriode =
    w.jenis === 'grafik' || w.jenis === 'donat' || w.jenis === 'daftar' || (w.jenis === 'kpi' && metrikBerperiode);
  // Filter gudang/kasir/kategori hanya berlaku pada metrik penjualan/pembelian.
  const bisaFilter = ['penjualan', 'pembelian', 'laba', 'transaksi', 'terlaris', 'metode'].includes(w.metrik);

  return (
    <Modal
      judul={`Pengaturan isi — ${widget.judul}`}
      lebar="sedang"
      onTutup={onTutup}
      aksi={
        <>
          <button type="button" className="tombol tombol--netral" onClick={onTutup}>
            Batal
          </button>
          <button type="button" className="tombol tombol--primer" onClick={() => onSimpan(w)}>
            Simpan
          </button>
        </>
      }
    >
      <div className="widget-form">
        <label className="bidang">
          <span>Judul kartu</span>
          <input value={w.judul} maxLength={80} onChange={(e) => setW({ ...w, judul: e.target.value })} />
        </label>

        {w.jenis !== 'pintasan' && (
          <>
            <label className="bidang">
              <span>Sumber data / metrik</span>
              <select
                value={w.metrik}
                onChange={(e) => {
                  const kode = e.target.value;
                  const m = METRIK_WIDGET.find((x) => x.kode === kode);
                  // Sesuaikan turunan: tampilan & jumlah mengikuti dukungan metrik baru.
                  setW({
                    ...w,
                    metrik: kode,
                    tampilan: m?.jenis.includes('grafik') ? (w.tampilan ?? 'batang') : undefined,
                    jumlah: m?.jenis.includes('daftar') ? (w.jumlah ?? 5) : undefined,
                  });
                }}
              >
                {metrikTersedia.map((m) => (
                  <option key={m.kode} value={m.kode}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>

            {w.jenis === 'grafik' && bisaGrafik && (
              <label className="bidang">
                <span>Jenis tampilan</span>
                <select
                  value={w.tampilan ?? 'batang'}
                  onChange={(e) => setW({ ...w, tampilan: e.target.value as 'garis' | 'batang' })}
                >
                  <option value="garis">Garis (tren)</option>
                  <option value="batang">Batang</option>
                </select>
              </label>
            )}

            {bisaDonat && (
              <p className="teks-redup teks-kecil">Metrik ini ditampilkan sebagai grafik donat (komposisi).</p>
            )}

            {bisaPeriode && (
              <label className="bidang">
                <span>Periode</span>
                <select
                  value={w.periode ?? '30-hari'}
                  onChange={(e) => setW({ ...w, periode: e.target.value as PeriodeWidget, dari: undefined, sampai: undefined })}
                >
                  {PERIODE_WIDGET.map((p) => (
                    <option key={p.kode} value={p.kode}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {w.periode === 'kustom' && bisaPeriode && (
              <div className="widget-form__baris">
                <label className="bidang">
                  <span>Dari</span>
                  <input type="date" value={w.dari ?? ''} onChange={(e) => setW({ ...w, dari: e.target.value })} />
                </label>
                <label className="bidang">
                  <span>Sampai</span>
                  <input type="date" value={w.sampai ?? ''} onChange={(e) => setW({ ...w, sampai: e.target.value })} />
                </label>
              </div>
            )}

            {bisaDaftar && (w.jenis === 'daftar' || metrikTerpilih?.jenis.includes('daftar')) && (
              <label className="bidang">
                <span>Jumlah item daftar peringkat</span>
                <select value={w.jumlah ?? 5} onChange={(e) => setW({ ...w, jumlah: Number(e.target.value) })}>
                  <option value={5}>Top 5</option>
                  <option value={10}>Top 10</option>
                </select>
              </label>
            )}

            {/* Filter (hanya berlaku pada data penjualan/berseri). */}
            {bisaFilter && (
              <div className="widget-form__filter">
                <b>Filter (opsional)</b>
                <label className="bidang">
                  <span>Gudang</span>
                  <select value={w.gudang ?? ''} onChange={(e) => setW({ ...w, gudang: e.target.value || undefined })}>
                    <option value="">Semua gudang</option>
                    {(opsi.gudang ?? []).map((g) => (
                      <option key={g.id} value={String(g.id)}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="bidang">
                  <span>Kasir</span>
                  <select value={w.kasir ?? ''} onChange={(e) => setW({ ...w, kasir: e.target.value || undefined })}>
                    <option value="">Semua kasir</option>
                    {(opsi.kasir ?? []).map((k) => (
                      <option key={k.id} value={String(k.id)}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="bidang">
                  <span>Kategori</span>
                  <select value={w.kategori ?? ''} onChange={(e) => setW({ ...w, kategori: e.target.value || undefined })}>
                    <option value="">Semua kategori</option>
                    {(opsi.kategori ?? []).map((k) => (
                      <option key={k.id} value={String(k.id)}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

export type { JenisWidget };

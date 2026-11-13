// BAGIAN X2 — Grid 12 kolom Dashboard: tiap kartu adalah widget dari layout
// (susunan/ukuran/isi bisa diatur Admin). Mode "Atur Tampilan" menampilkan
// pegangan geser, tombol ukuran, pengaturan isi, duplikat, dan hapus; sudut
// kartu bisa ditarik untuk mengubah lebar (snap ke grid). grid-auto-flow:
// dense + kartu terakhir meregang mengisi sisa baris (tanpa ruang kosong).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { formatAngka, formatRupiah } from '../../lib/format';
import { menuUntukPeran } from '../../config/menu';
import { peranAktif, rutePos } from '../../lib/pengguna';
import { useSesi } from '../../lib/sesi';
import { GrafikBatang, GrafikDonat, GrafikTren } from '../laporan/Grafik';
import { useWidgetData, type IsiWidget } from './useWidgetData';
import {
  LABEL_PERIODE,
  PERIODE_TREN,
  TAUTAN_METRIK,
  UKURAN_KARTU,
  type LebarWidget,
  type PeriodeWidget,
  type WidgetDashboard,
} from './tipe';

const TINGGI_PX = { kompak: 132, normal: 250, tinggi: 340 } as const;
const KOLOM: LebarWidget[] = [3, 4, 6, 8, 12];

/** Metrik deret waktu yang boleh diganti cepat 7/14/30 hari dari kartu. */
const METRIK_TREN = ['penjualan', 'pembelian', 'laba', 'transaksi'];

/** Metrik yang benar-benar memakai rentang tanggal (bukan saldo berjalan). */
const METRIK_BERPERIODE = [...METRIK_TREN, 'terlaris', 'metode'];

function fmtNilai(v: number | undefined, format: IsiWidget['format']): string {
  if (v === undefined || v === null) return '—';
  if (format === 'rupiah') return formatRupiah(v);
  if (format === 'produk') return `${formatAngka(v)} produk`;
  return formatAngka(v);
}

/** "20 Okt" atau "07–20 Okt" dari rentang tanggal widget. */
function labelRentang(r?: { dari: string; sampai: string }): string {
  if (!r) return '';
  const f = (s: string) =>
    new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' }).format(
      new Date(`${s}T00:00:00`),
    );
  return r.dari === r.sampai ? f(r.dari) : `${f(r.dari)} – ${f(r.sampai)}`;
}

/** Ringkas deret harian menjadi ≤ n batang untuk sparkline kartu KPI. */
function ringkasSeri(seri: { nilai: number }[] | undefined, n = 14): number[] {
  if (!seri?.length) return [];
  if (seri.length <= n) return seri.map((s) => s.nilai);
  const per = Math.ceil(seri.length / n);
  const out: number[] = [];
  for (let i = 0; i < seri.length; i += per) {
    out.push(seri.slice(i, i + per).reduce((a, s) => a + s.nilai, 0));
  }
  return out;
}

function Sparkline({ seri }: { seri: { nilai: number }[] }) {
  const bars = ringkasSeri(seri);
  if (bars.length < 2 || !bars.some((v) => v > 0)) return null;
  const maks = Math.max(...bars);
  return (
    <div className="widget-kpi__spark" aria-hidden="true">
      {bars.map((v, i) => (
        <i
          key={i}
          className={v === 0 ? 'kosong' : ''}
          style={{ height: `${Math.max(8, Math.round((v / maks) * 100))}%` }}
        />
      ))}
    </div>
  );
}

/** Sub-baris kartu KPI: konteks singkat di bawah angka besar. */
function subKpi(w: WidgetDashboard, isi: IsiWidget): string {
  const nilai = isi.nilai ?? 0;
  if (w.metrik === 'piutang')
    return nilai > 0 ? 'Belum ditagih — lihat daftar faktur' : 'Semua faktur lunas';
  if (w.metrik === 'utang') return nilai > 0 ? 'Belum dibayar ke pemasok' : 'Tidak ada hutang';
  if (w.metrik === 'menipis')
    return nilai > 0 ? 'Produk di bawah stok minimum' : 'Stok semua produk aman';
  if (w.metrik === 'stok') return 'Nilai persediaan saat ini';
  return labelRentang(isi.rentang);
}

/** Isi kartu sesuai jenis & data widget. */
function IsiKartu({
  w,
  isi,
  sibuk,
  galat,
  ditolakAkses,
}: {
  w: WidgetDashboard;
  isi: IsiWidget | null;
  sibuk: boolean;
  galat: string | null;
  ditolakAkses: boolean;
}) {
  // TAHAP 2 — pintasan modul ikut matriks Hak Akses (sidebar & kartu sama).
  const hak = useSesi().info?.hak;
  if (w.jenis === 'pintasan') {
    return (
      <div className="grid-modul">
        <Link to={rutePos()} className="modul-kartu">
          <span className="modul-kartu__ikon">
            <Icon nama="pos" size={22} />
          </span>
          <span className="modul-kartu__teks">
            <strong>Mulai Jualan</strong>
            <small>Buka POS dengan mode terakhir yang dipakai (pintasan F9)</small>
          </span>
        </Link>
        {menuUntukPeran(peranAktif(), hak)
          .filter((m) => m.kode !== 'dashboard')
          .map((m) => (
            <Link key={m.kode} to={m.path} className="modul-kartu">
              <span className="modul-kartu__ikon">
                <Icon nama={m.icon} size={22} />
              </span>
              <span className="modul-kartu__teks">
                <strong>{m.label}</strong>
                <small>{m.deskripsi}</small>
              </span>
            </Link>
          ))}
      </div>
    );
  }
  if (sibuk && !isi) return <p className="widget-kosong">Memuat…</p>;
  // Widget yang dibatasi matriks peran: placeholder netral (tanpa teks
  // galat merah) agar dashboard tetap rapi.
  if (ditolakAkses)
    return (
      <div className="widget-kosong widget-kosong--terbatas" role="note">
        <Icon nama="eye-off" size={18} />
        <p>Akses widget ini dibatasi untuk peran Anda.</p>
      </div>
    );
  if (galat) return <p className="widget-kosong widget-kosong--galat">{galat}</p>;
  if (!isi) return <p className="widget-kosong">Tidak ada data.</p>;

  const format = isi.format;

  if (w.jenis === 'kpi') {
    const bahaya = (w.metrik === 'piutang' || w.metrik === 'menipis') && (isi.nilai ?? 0) > 0;
    return (
      <div className={`widget-kpi ${bahaya ? 'widget-kpi--bahaya' : ''}`}>
        <strong>{fmtNilai(isi.nilai, format)}</strong>
        <small>{subKpi(w, isi)}</small>
        {isi.seri && <Sparkline seri={isi.seri} />}
      </div>
    );
  }

  if (w.jenis === 'grafik') {
    if (isi.seri?.length) {
      return w.tampilan === 'batang' ? (
        <GrafikBatang data={isi.seri} kunciX="periode" kunciNilai="nilai" maksItem={0} potongLabel />
      ) : (
        <GrafikTren data={isi.seri} seri={['nilai']} />
      );
    }
    if (isi.baris?.length) {
      const data = isi.baris.map((b) => ({ nama: b.label, nilai: b.nilai }));
      return <GrafikBatang data={data} kunciX="nama" kunciNilai="nilai" />;
    }
    return <p className="widget-kosong">Tidak ada data grafik pada periode ini.</p>;
  }

  if (w.jenis === 'donat') {
    if (!isi.bagian?.length) return <p className="widget-kosong">Tidak ada data pada periode ini.</p>;
    return <GrafikDonat data={isi.bagian} kunciX="nama" kunciNilai="jumlah" />;
  }

  if (w.jenis === 'kas') {
    if (!isi.rekening?.length) return <p className="widget-kosong">Belum ada rekening kas/bank.</p>;
    const total = isi.rekening.reduce((a, r) => a + r.saldo, 0);
    return (
      <div className="dash-tabel-wrap">
        <table className="dash-tabel">
          <tbody>
            {isi.rekening.map((r) => (
              <tr key={r.nama}>
                <td>{r.nama}</td>
                <td className="kanan">{formatRupiah(r.saldo)}</td>
              </tr>
            ))}
            <tr>
              <th>Total</th>
              <th className="kanan">{formatRupiah(total)}</th>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  // daftar peringkat
  if (!isi.baris?.length) return <p className="widget-kosong">Tidak ada data pada periode ini.</p>;
  const maks = Math.max(...isi.baris.map((b) => Math.abs(b.nilai)), 1);
  return (
    <ol className="widget-daftar">
      {isi.baris.map((b, i) => (
        <li key={`${b.label}-${i}`} style={{ ['--isi' as string]: `${Math.round((Math.abs(b.nilai) / maks) * 100)}%` }}>
          <span className="widget-daftar__peringkat">{i + 1}</span>
          <span className="widget-daftar__label" title={b.label}>
            {b.label}
            {b.sub && <small>{b.sub}</small>}
          </span>
          <b>{format === 'angka' ? formatAngka(b.nilai) : formatRupiah(b.nilai)}</b>
          <span className="widget-daftar__bar" aria-hidden="true" />
        </li>
      ))}
    </ol>
  );
}

export interface PropsGrid {
  widgets: WidgetDashboard[];
  modeEdit: boolean;
  /** Dinaikkan setelah simpan agar semua kartu ikut disegarkan. */
  segar?: number;
  onUbah: (id: string, patch: Partial<WidgetDashboard>) => void;
  onHapus: (id: string) => void;
  onDuplikat: (id: string) => void;
  onGeser: (dariId: string, keId: string) => void;
  onBukaIsi: (w: WidgetDashboard) => void;
}

export function GridDashboard({ widgets, modeEdit, segar = 0, onUbah, onHapus, onDuplikat, onGeser, onBukaIsi }: PropsGrid) {
  const [seret, setSeret] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);

  // Kartu terakhir meregang mengisi sisa baris (mode lihat saja).
  const total = widgets.reduce((a, w) => a + w.lebar, 0);
  const terakhir = widgets[widgets.length - 1];
  const sisaDepan = terakhir ? (total - terakhir.lebar) % 12 : 0;
  const lebarEfektif = (w: WidgetDashboard, i: number): LebarWidget => {
    if (modeEdit || i !== widgets.length - 1) return w.lebar;
    const penuh = ((12 - sisaDepan) % 12 || 12) as LebarWidget;
    return penuh > w.lebar ? penuh : w.lebar;
  };

  const mulaiResize = (e: React.PointerEvent, w: WidgetDashboard) => {
    e.preventDefault();
    e.stopPropagation();
    const grid = (e.currentTarget.closest('.dash-grid') as HTMLElement) ?? null;
    if (!grid) return;
    const col = grid.getBoundingClientRect().width / 12;
    const x0 = e.clientX;
    const awal = w.lebar;
    const onMove = (ev: PointerEvent) => {
      const kandidat = awal + Math.round((ev.clientX - x0) / col);
      const dekat = KOLOM.reduce((a, b) => (Math.abs(b - kandidat) < Math.abs(a - kandidat) ? b : a), KOLOM[0]);
      if (dekat !== w.lebar) onUbah(w.id, { lebar: dekat });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div className="dash-grid" data-edit={modeEdit ? '1' : '0'}>
      {widgets.map((w, i) => (
        <KartuWidget
          key={w.id}
          w={w}
          lebar={lebarEfektif(w, i)}
          modeEdit={modeEdit}
          segar={segar}
          seret={seret}
          menuId={menuId}
          setSeret={setSeret}
          setMenuId={setMenuId}
          onUbah={onUbah}
          onHapus={onHapus}
          onDuplikat={onDuplikat}
          onGeser={onGeser}
          onBukaIsi={onBukaIsi}
          mulaiResize={mulaiResize}
        />
      ))}
    </div>
  );
}

function KartuWidget({
  w,
  lebar,
  modeEdit,
  segar,
  seret,
  menuId,
  setSeret,
  setMenuId,
  onUbah,
  onHapus,
  onDuplikat,
  onGeser,
  onBukaIsi,
  mulaiResize,
}: {
  w: WidgetDashboard;
  lebar: LebarWidget;
  modeEdit: boolean;
  segar: number;
  seret: string | null;
  menuId: string | null;
  setSeret: (v: string | null) => void;
  setMenuId: (v: string | null) => void;
} & Omit<PropsGrid, 'widgets' | 'modeEdit' | 'segar'> & { mulaiResize: (e: React.PointerEvent, w: WidgetDashboard) => void }) {
  // Chip 7/14/30 pada kartu tren: pilihan cepat tanpa masuk mode edit.
  // Nilai awal mengikuti pengaturan kartu (pilihan Admin di "Atur tampilan").
  const [periodeCepat, setPeriodeCepat] = useState<PeriodeWidget | undefined>(w.periode);
  useEffect(() => setPeriodeCepat(w.periode), [w.periode]);

  const wData = periodeCepat && periodeCepat !== w.periode ? { ...w, periode: periodeCepat } : w;
  const { isi, sibuk, galat, ditolakAkses } = useWidgetData(wData, segar);
  const menuBuka = menuId === w.id;

  const bisaCepat = !modeEdit && w.jenis === 'grafik' && METRIK_TREN.includes(w.metrik) && Boolean(w.periode) && w.periode !== 'kustom';
  const periodeAktif = (periodeCepat ?? w.periode ?? '30-hari') as PeriodeWidget;
  // Metrik saldo (piutang, stok menipis, kas) tidak memakai rentang tanggal —
  // jangan tampilkan lencana periode yang menyesatkan.
  const metrikBerperiode = METRIK_BERPERIODE.includes(w.metrik);
  const tautan = TAUTAN_METRIK[w.metrik];

  return (
    <section
      className="dash-kartu"
      data-seret={seret === w.id ? '1' : '0'}
      data-lewat={seret && seret !== w.id ? '1' : '0'}
      style={{ ['--span' as string]: String(lebar), ['--tinggi' as string]: `${TINGGI_PX[w.tinggi]}px` }}
      draggable={modeEdit}
      onDragStart={(e) => {
        // Hanya boleh diseret lewat pegangan.
        if (!(e.target as HTMLElement).closest('.dash-kartu__pegangan')) {
          e.preventDefault();
          return;
        }
        setSeret(w.id);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', w.id);
      }}
      onDragOver={(e) => {
        if (seret && seret !== w.id) e.preventDefault();
      }}
      onDrop={() => {
        if (seret && seret !== w.id) onGeser(seret, w.id);
        setSeret(null);
      }}
      onDragEnd={() => setSeret(null)}
    >
      <div className="dash-kartu__kepala">
        <h4 title={w.judul}>{w.judul}</h4>

        {bisaCepat && (
          <div className="dash-periode" role="group" aria-label="Periode tren">
            {PERIODE_TREN.map((p) => (
              <button
                key={p}
                type="button"
                className={periodeAktif === p ? 'aktif' : ''}
                aria-pressed={periodeAktif === p}
                onClick={() => setPeriodeCepat(p)}
              >
                {LABEL_PERIODE[p].replace(' hari', '')}
              </button>
            ))}
          </div>
        )}

        {!modeEdit && !bisaCepat && w.periode && metrikBerperiode && (
          <span className="dash-kartu__periode">{LABEL_PERIODE[w.periode]}</span>
        )}

        {!modeEdit && tautan && (
          <Link className="dash-kartu__tautan" to={tautan} title={`Buka ${w.judul}`}>
            Detail
            <Icon nama="chevron-right" size={13} />
          </Link>
        )}

        {modeEdit && (
          <div className="dash-kartu__alat">
            <span className="dash-kartu__pegangan" data-tip="Seret untuk menyusun ulang" aria-hidden="true">
              <Icon nama="grip" size={16} />
            </span>
            <div className="dash-kartu__menu-wrap">
              <button
                type="button"
                className="ikon-btn ikon-btn--baris"
                data-tip="Ukuran kartu"
                aria-label="Ukuran kartu"
                onClick={() => setMenuId(menuBuka ? null : w.id)}
              >
                <Icon nama="sliders" size={15} />
              </button>
              {menuBuka && (
                <div className="dash-kartu__menu">
                  <b>Ukuran</b>
                  {UKURAN_KARTU.map((u) => (
                    <button
                      key={u.label}
                      type="button"
                      className={w.lebar === u.lebar && w.tinggi === u.tinggi ? 'aktif' : ''}
                      onClick={() => {
                        onUbah(w.id, { lebar: u.lebar, tinggi: u.tinggi });
                        setMenuId(null);
                      }}
                    >
                      {u.label} ({u.lebar} kolom)
                    </button>
                  ))}
                  <b>Tinggi</b>
                  {(['kompak', 'normal', 'tinggi'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={w.tinggi === t ? 'aktif' : ''}
                      onClick={() => {
                        onUbah(w.id, { tinggi: t });
                        setMenuId(null);
                      }}
                    >
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className="ikon-btn ikon-btn--baris"
              data-tip="Pengaturan isi"
              aria-label="Pengaturan isi"
              onClick={() => onBukaIsi(w)}
            >
              <Icon nama="pencil" size={15} />
            </button>
            <button
              type="button"
              className="ikon-btn ikon-btn--baris"
              data-tip="Duplikat kartu"
              aria-label="Duplikat kartu"
              onClick={() => onDuplikat(w.id)}
            >
              <Icon nama="copy" size={15} />
            </button>
            <button
              type="button"
              className="ikon-btn ikon-btn--baris ikon-btn--bahaya"
              data-tip="Hapus kartu"
              aria-label="Hapus kartu"
              onClick={() => onHapus(w.id)}
            >
              <Icon nama="trash" size={15} />
            </button>
          </div>
        )}
      </div>
      <div className="dash-kartu__isi">
        <IsiKartu w={wData} isi={isi} sibuk={sibuk} galat={galat} ditolakAkses={ditolakAkses} />
      </div>
      {modeEdit && (
        <span
          className="dash-kartu__sudut"
          data-tip="Tarik untuk mengubah lebar"
          onPointerDown={(e) => mulaiResize(e, w)}
        />
      )}
    </section>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { beritahu } from '../components/crud/Toast';
import { Icon } from '../components/Icon';
import { apiGet, apiPut } from '../lib/api';
import { formatTanggalPanjang } from '../lib/format';
import { labelZona, useRegional } from '../lib/regional';
import { peranAktif, type Peran } from '../lib/pengguna';
import { useSesi } from '../lib/sesi';
import { useIdentitas } from '../lib/identitas';
import { useKesehatanServer } from '../lib/useKesehatanServer';
import { useSegarkanModul } from '../lib/segarkan';
import { GridDashboard } from './dashboard/GridDashboard';
import { KatalogWidget } from './dashboard/KatalogWidget';
import { PanelIsiKartu } from './dashboard/PanelIsiKartu';
import { PengingatFaktur } from './dashboard/PengingatFaktur';
import { DialogBayar } from './dashboard/DialogBayar';
import {
  PRESET_DASHBOARD,
  type BarisPengingat,
  type DataPengingat,
  type LayoutDashboard,
  type WidgetDashboard,
} from './dashboard/tipe';
import '../pages/laporan/laporan.css';
import './dashboard/dashboard.css';

const clone = (widgets: WidgetDashboard[]): WidgetDashboard[] => widgets.map((w) => ({ ...w }));

/**
 * Dashboard (BAGIAN X2): kartu = widget dari tata letak yang bisa diatur
 * lewat mode "Atur tampilan" (seret, ubah ukuran/isi, duplikat, hapus,
 * tambah dari katalog, preset, default per peran). Tata letak tersimpan per
 * pengguna di database (resolusi: pengguna > bawaan peran > preset).
 */
export function Dashboard() {
  const sehat = useKesehatanServer();
  // Y2.4 — sapaan memakai nama dari Identitas Aplikasi, bukan teks tetap.
  const identitas = useIdentitas();
  // Sapaan mengikuti zona & format jam regional (bukan zona perangkat).
  const regional = useRegional();
  const jam = new Intl.DateTimeFormat('id-ID', {
    timeZone: regional.zona,
    hour: '2-digit',
    minute: '2-digit',
    hour12: regional.formatJam === '12',
  }).format(new Date());

  const [widgets, setWidgets] = useState<WidgetDashboard[]>(() => clone(PRESET_DASHBOARD[0].widgets));
  const [tersimpan, setTersimpan] = useState<WidgetDashboard[]>(() => clone(PRESET_DASHBOARD[0].widgets));
  const [sumber, setSumber] = useState('bawaan');
  const [modeEdit, setModeEdit] = useState(false);
  const [segar, setSegar] = useState(0);
  const [presetTerpilih, setPresetTerpilih] = useState('pemilik');
  const [peranBawaan, setPeranBawaan] = useState<Peran>('admin');
  const [katalog, setKatalog] = useState(false);
  const [isiWidget, setIsiWidget] = useState<WidgetDashboard | null>(null);
  const [pengingat, setPengingat] = useState<DataPengingat | null>(null);
  const [bayar, setBayar] = useState<{ baris: BarisPengingat; tipe: 'piutang' | 'hutang' } | null>(null);

  const muat = useCallback(async () => {
    try {
      const [l, p] = await Promise.all([
        apiGet<{ sumber: string; layout: LayoutDashboard | null }>(
          `/api/dashboard/layout?peran=${peranAktif()}`,
        ),
        apiGet<DataPengingat>('/api/dashboard/pengingat'),
      ]);
      setSumber(l.sumber);
      const daftar = l.layout?.widgets?.length ? l.layout.widgets : clone(PRESET_DASHBOARD[0].widgets);
      setWidgets(daftar);
      setTersimpan(clone(daftar));
      setPengingat(p);
    } catch (e) {
      beritahu(e instanceof Error ? e.message : 'Gagal memuat Dashboard.', 'galat');
    }
  }, []);

  useEffect(() => {
    void muat();
  }, [muat]);
  // Tombol Refresh global di topbar: layout + pengingat + semua kartu widget.
  useSegarkanModul(() => {
    void muat();
    setSegar((n) => n + 1);
  });

  /* ------------------------- Mode "Atur tampilan" ------------------------- */

  const ubahWidget = (id: string, patch: Partial<WidgetDashboard>) =>
    setWidgets((ws) => ws.map((w) => (w.id === id ? { ...w, ...patch } : w)));

  const hapusWidget = (id: string) => setWidgets((ws) => ws.filter((w) => w.id !== id));

  const duplikatWidget = (id: string) =>
    setWidgets((ws) => {
      const i = ws.findIndex((w) => w.id === id);
      if (i < 0) return ws;
      const asal = ws[i];
      const baru: WidgetDashboard = {
        ...asal,
        id: `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        judul: `${asal.judul} (salinan)`,
      };
      const next = [...ws];
      next.splice(i + 1, 0, baru);
      return next;
    });

  /** Geser kartu (seret & lepas) — pindahkan ke posisi kartu tujuan. */
  const geserWidget = (dariId: string, keId: string) =>
    setWidgets((ws) => {
      const dari = ws.findIndex((w) => w.id === dariId);
      const ke = ws.findIndex((w) => w.id === keId);
      if (dari < 0 || ke < 0 || dari === ke) return ws;
      const next = [...ws];
      const [angkat] = next.splice(dari, 1);
      next.splice(ke, 0, angkat);
      return next;
    });

  const simpanLayout = async (daftar: WidgetDashboard[]) => {
    try {
      await apiPut('/api/dashboard/layout', { layout: daftar });
      setWidgets(daftar);
      setTersimpan(clone(daftar));
      setModeEdit(false);
      setSegar((s) => s + 1);
      beritahu('Tampilan Dashboard tersimpan.', 'sukses');
    } catch (e) {
      beritahu(e instanceof Error ? e.message : 'Gagal menyimpan tampilan.', 'galat');
    }
  };

  const jadikanBawaanPeran = async () => {
    try {
      await apiPut('/api/dashboard/layout/bawaan', { peran: peranBawaan, layout: widgets });
      beritahu(`Tampilan disimpan sebagai bawaan peran ${peranBawaan}.`);
    } catch (e) {
      beritahu(e instanceof Error ? e.message : 'Gagal menyimpan bawaan peran.', 'galat');
    }
  };

  const tutupEdit = () => {
    setWidgets(clone(tersimpan));
    setModeEdit(false);
  };

  return (
    <div className="halaman">
      <section className="kartu-sapaan">
        <div>
          <h2>Selamat datang di {identitas.nama}</h2>
          <p>              {formatTanggalPanjang(new Date())} · pukul {jam} {labelZona(regional.zona)}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div className={`kartu-sapaan__status status-db status-db--${sehat.berhasil ? 'ok' : 'loading'}`}>
            <span className="status-db__titik" />
            {sehat.berhasil ? 'Database SQLite terhubung' : sehat.pesan}
          </div>
          {!modeEdit && (
            <button
              type="button"
              className="sapaan-atur"
              onClick={() => setModeEdit(true)}
              data-tip="Atur tampilan: susun, ubah ukuran & isi kartu"
            >
              <Icon nama="sliders" size={16} />
              Atur tampilan
            </button>
          )}
        </div>
      </section>

      {/* --- Bilah mode "Atur tampilan" (X2.1) --- */}
      {modeEdit && (
        <div className="dash-edit-bar" role="toolbar" aria-label="Atur tampilan Dashboard">
          <button type="button" className="tombol tombol--kecil" onClick={() => setKatalog(true)}>
            <Icon nama="plus" size={15} /> Tambah kartu
          </button>
          <span className="dash-edit-bar__preset">
            <select
              className="input-pilih"
              value={presetTerpilih}
              onChange={(e) => setPresetTerpilih(e.target.value)}
              aria-label="Preset tampilan"
            >
              {PRESET_DASHBOARD.map((p) => (
                <option key={p.kode} value={p.kode}>
                  Preset: {p.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="tombol tombol--kecil"
              onClick={() => {
                const p = PRESET_DASHBOARD.find((x) => x.kode === presetTerpilih);
                if (p) setWidgets(clone(p.widgets));
              }}
            >
              Terapkan preset
            </button>
          </span>
          <button
            type="button"
            className="tombol tombol--kecil"
            onClick={() => setWidgets(clone(PRESET_DASHBOARD[0].widgets))}
          >
            <Icon nama="rotate-ccw" size={15} /> Reset ke bawaan
          </button>
          {useSesi().info?.pengguna.admin === true && (
            <span className="dash-edit-bar__preset">
              <select
                className="input-pilih"
                value={peranBawaan}
                onChange={(e) => setPeranBawaan(e.target.value as Peran)}
                aria-label="Peran bawaan"
              >
                <option value="admin">Admin</option>
                <option value="manajer">Manajer</option>
                <option value="kasir">Kasir</option>
              </select>
              <button type="button" className="tombol tombol--kecil" onClick={() => void jadikanBawaanPeran()}>
                Jadikan default peran
              </button>
            </span>
          )}
          <span className="dash-edit-bar__aksi">
            <button type="button" className="tombol tombol--netral" onClick={tutupEdit}>
              Batal
            </button>
            <button type="button" className="tombol tombol--primer" onClick={() => void simpanLayout(widgets)}>
              Selesai
            </button>
          </span>
        </div>
      )}

      {/* --- Kartu dashboard (widget dari tata letak) --- */}
      <GridDashboard
        widgets={widgets}
        modeEdit={modeEdit}
        segar={segar}
        onUbah={ubahWidget}
        onHapus={hapusWidget}
        onDuplikat={duplikatWidget}
        onGeser={geserWidget}
        onBukaIsi={setIsiWidget}
      />

      {sumber !== 'pengguna' && !modeEdit && (
        <p className="teks-redup teks-kecil" style={{ textAlign: 'center', margin: 0 }}>
          Tata letak: {sumber === 'peran' ? 'bawaan per peran' : 'preset bawaan'} — klik “Atur tampilan” untuk
          menyimpan versi Anda sendiri.
        </p>
      )}

      {/* --- Pengingat faktur belum lunas --- */}
      {pengingat && (
        <PengingatFaktur
          data={pengingat}
          onBayar={(baris, tipe) => setBayar({ baris, tipe })}
          onMuatUlang={() => void muat()}
        />
      )}

      {katalog && (
        <KatalogWidget
          onTutup={() => setKatalog(false)}
          onPilih={(w) => {
            setWidgets((ws) => [...ws, w]);
            setKatalog(false);
          }}
        />
      )}

      {isiWidget && (
        <PanelIsiKartu
          widget={isiWidget}
          onTutup={() => setIsiWidget(null)}
          onSimpan={(w) => {
            ubahWidget(w.id, w);
            setIsiWidget(null);
          }}
        />
      )}

      {bayar && (
        <DialogBayar
          baris={bayar.baris}
          tipe={bayar.tipe}
          onTutup={() => setBayar(null)}
          onSelesai={() => {
            void muat();
            window.dispatchEvent(new CustomEvent('pengingat-berubah'));
          }}
        />
      )}
    </div>
  );
}

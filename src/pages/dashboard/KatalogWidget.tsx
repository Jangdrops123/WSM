// X2.2 — Katalog widget ("+ Tambah kartu"): memilih jenis widget + metrik.
import { Modal } from '../../components/crud/Modal';
import { Icon } from '../../components/Icon';
import { METRIK_WIDGET, widgetBaru, type JenisWidget, type WidgetDashboard } from './tipe';

interface Entri {
  jenis: JenisWidget;
  metrik: string;
  label: string;
  deskripsi: string;
  ikon: Parameters<typeof Icon>[0]['nama'];
}

const PINTASAN: Entri = {
  jenis: 'pintasan',
  metrik: 'pintasan',
  label: 'Pintasan cepat',
  deskripsi: 'Akses cepat ke semua modul aplikasi.',
  ikon: 'folder-input',
};

export function KatalogWidget({ onPilih, onTutup }: { onPilih: (w: WidgetDashboard) => void; onTutup: () => void }) {
  const entri: Entri[] = [
    ...METRIK_WIDGET.flatMap<Entri>((m) =>
      m.jenis
        .filter((j) => j !== 'pintasan')
        .map((j) => ({
          jenis: j,
          metrik: m.kode,
          label: m.label,
          deskripsi:
            j === 'kpi'
              ? 'Angka besar (KPI) tunggal.'
              : j === 'grafik'
                ? 'Grafik garis/batang deret waktu atau peringkat.'
                : j === 'donat'
                  ? 'Komposisi donat per kategori/metode.'
                  : j === 'daftar'
                    ? 'Daftar peringkat (Top 5/10).'
                    : 'Tabel kecil ringkasan kas & bank.',
          ikon: j === 'kpi' ? 'tag' : j === 'grafik' ? 'sliders' : j === 'donat' ? 'archive' : j === 'daftar' ? 'eye' : 'faktur',
        })),
    ),
    PINTASAN,
  ];

  return (
    <Modal judul="Tambah kartu" lebar="sedang" onTutup={onTutup}>
      <p className="teks-redup teks-kecil" style={{ marginBottom: 12 }}>
        Pilih widget dari katalog — judul, periode, dan tampilannya bisa diatur lagi lewat tombol
        Pengaturan isi pada kartu.
      </p>
      <div className="katalog-widget">
        {entri.map((e) => (
          <button
            key={`${e.jenis}-${e.metrik}`}
            type="button"
            className="katalog-widget__kartu"
            onClick={() => onPilih(widgetBaru(e.jenis, e.metrik, e.label))}
          >
            <span className="katalog-widget__ikon">
              <Icon nama={e.ikon} size={20} />
            </span>
            <span>
              <strong>
                {e.label} <small className="katalog-widget__tipe">({e.jenis})</small>
              </strong>
              <small>{e.deskripsi}</small>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

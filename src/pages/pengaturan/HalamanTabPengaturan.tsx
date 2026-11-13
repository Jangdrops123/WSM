import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { beritahu } from '../../components/crud/Toast';
import { apiGet } from '../../lib/api';
import { useSegarkanModul } from '../../lib/segarkan';
import { muatIdentitas } from '../../lib/identitas';
import { TabPengaturan } from './TabPengaturan';
import { TokoPanel } from './TokoPanel';
import { LogAktivitasPage } from './LogAktivitasPage';
import { PanelKartuDashboard, PanelPratinjauLabel } from './PanelKhusus';
import { PanelScrollHalaman, PanelTampilan } from './PanelTampilan';
import { PanelIdentitas } from './PanelIdentitas';
import { PanelSuaraScan } from './PanelSuaraScan';
import {
  PanelDatabase,
  PanelImpor,
  PanelKasBank,
  PanelKeamanan,
  PanelNotifikasi,
  PanelTentang,
} from './PanelSistem';
import { PenggunaHakAksesPage } from './PenggunaHakAksesPage';
import { useDaftarPengaturan } from './useDaftarPengaturan';
import type { Opsi } from './tipePengaturan';

/** Toko yang sedang diatur untuk tab bertanda per toko. */
const TOKO = 'nusapos.tokoAktif';

/** Bidang jadwal backup — dirender & disimpan oleh kartu "Backup Otomatis
 *  Terjadwal" di PanelDatabase, jadi tidak diulang di form bawah tab. */
const BIDANG_JADWAL_BACKUP = [
  'backup_otomatis',
  'backup_jam',
  'interval_nilai',
  'interval_satuan',
  'jumlah_backup',
  'retensi_hari',
];

function bacaTokoAktif(): string {
  try {
    return localStorage.getItem(TOKO) ?? '';
  } catch {
    return '';
  }
}

function simpanTokoAktif(kode: string): void {
  let lama = '';
  try {
    lama = localStorage.getItem(TOKO) ?? '';
    localStorage.setItem(TOKO, kode);
  } catch {
    /* penyimpanan nonaktif — abaikan */
  }
  // AI1(3) — pindah toko/database: salinan layar muat ikut identitas toko ini.
  if (lama !== kode) void muatIdentitas().catch(() => {});
}

/**
 * Halaman tab Pengaturan (Grup Umum, Transaksi, Keuangan, Keamanan & Sistem).
 * Tab-tab lama (Template Faktur, Aturan Kodi, Struk, Halaman Awal,
 * Pemetaan Akun, Proses Tahunan) tetap memakai halamannya sendiri.
 */
export function HalamanTabPengaturan() {
  const { kode } = useParams<{ kode: string }>();
  const { daftar, galat } = useDaftarPengaturan();
  const [toko, setToko] = useState(bacaTokoAktif);
  const [daftarToko, setDaftarToko] = useState<Opsi[]>([]);

  const muatToko = useCallback(async () => {
    try {
      const r = await apiGet<{ data: Opsi[] }>('/api/pengaturan/toko/opsi');
      setDaftarToko(r.data);
      setToko((k) => {
        const pilihan = k || r.data[0]?.label?.match(/\(([^)]+)\)$/)?.[1] || '';
        simpanTokoAktif(pilihan);
        return pilihan;
      });
    } catch {
      /* belum ada toko — tab per toko hanya menampilkan pesan */
    }
  }, []);

  useEffect(() => {
    void muatToko();
  }, [muatToko]);
  // Tombol Refresh global di topbar: muat ulang opsi toko.
  useSegarkanModul(() => void muatToko());

  if (galat) return <p className="teks-redup">{galat}</p>;
  if (!daftar) return <p className="teks-redup">Memuat daftar pengaturan…</p>;

  const tab = daftar.tab.find((t) => t.kode === kode);
  if (!tab) return <p className="teks-redup">Tab pengaturan tidak ditemukan.</p>;

  // Tautan langsung ke tab tanpa izin peran aktif (matriks Hak Akses).
  if (tab.boleh === false) {
    return (
      <section className="kartu">
        <div className="kartu__kepala kartu__kepala--kompak">
          <h3>{tab.label}</h3>
        </div>
        <p className="teks-redup">
          Peran ini tidak punya izin membuka tab ini. Admin dapat memberi izin pada
          Pengaturan ▸ Pengguna &amp; Hak Akses.
        </p>
      </section>
    );
  }

  if (tab.kustom === 'log') return <LogAktivitasPage tab={tab} daftar={daftar} toko={toko} />;
  if (tab.kustom === 'toko') return <TokoPanel />;
  if (tab.kustom === 'tentang') return <PanelTentang />;
  if (tab.kustom === 'kas') return <TabPengaturan tab={tab} daftar={daftar} toko={toko} panel={(nilai) => <PanelKasBank nilai={nilai} />} />;
  if (tab.kustom === 'keamanan') return <TabPengaturan tab={tab} daftar={daftar} toko={toko} panel={() => <PanelKeamanan />} />;
  // Templat klasik: Data User + Kelompok Akses User.
  if (tab.kustom === 'pengguna') return <PenggunaHakAksesPage />;
  if (tab.kustom === 'database')
    return (
      <TabPengaturan
        tab={tab}
        daftar={daftar}
        toko={toko}
        kecuali={BIDANG_JADWAL_BACKUP}
        simpanKecuali={BIDANG_JADWAL_BACKUP}
        panel={(nilai) => <PanelDatabase nilai={nilai} />}
      />
    );
  if (tab.kustom === 'impor') return <TabPengaturan tab={tab} daftar={daftar} toko={toko} panel={() => <PanelImpor />} />;
  if (tab.kustom === 'tampilan')
    return (
      <TabPengaturan
        tab={tab}
        daftar={daftar}
        toko={toko}
        kecuali={['ukuran_font_kustom']}
        panel={(nilai, ubah) => (
          <>
            <PanelTampilan nilai={nilai} ubah={ubah} />
            <PanelScrollHalaman />
          </>
        )}
      />
    );
  // Y2.1 — halaman sendiri (tidak digabung dengan Profil Usaha / Data Toko).
  if (tab.kustom === 'identitas') return <PanelIdentitas toko={toko} />;
  if (tab.kustom === 'notifikasi') return <TabPengaturan tab={tab} daftar={daftar} toko={toko} panel={(nilai) => <PanelNotifikasi nilai={nilai} />} />;
  // WI3 — suara & getar scan: tes bunyi + unggah file audio kustom.
  if (tab.kustom === 'suara-scan')
    return (
      <TabPengaturan
        tab={tab}
        daftar={daftar}
        toko={toko}
        // File audio kustom diurus kartu Tes (unggah/hapus) — nilai tetap ikut
        // tersimpan karena hanya dirender ulang oleh panel, bukan dibuang.
        kecuali={['scan_audio_berhasil', 'scan_audio_gagal', 'scan_audio_berhasil_nama', 'scan_audio_gagal_nama']}
        panel={(nilai, ubah) => <PanelSuaraScan nilai={nilai} ubah={ubah} />}
      />
    );

  const pemilih =
    tab.cakupan === 'toko' ? (
      <section className="kartu pemilih-toko">
        <div className="kartu__kepala kartu__kepala--kompak">
          <h3>Mengatur toko</h3>
          <span className="teks-redup">Pengaturan bertanda “Per toko” disimpan terpisah untuk tiap toko.</span>
        </div>
        {daftarToko.length === 0 ? (
          <p className="teks-redup">
            Belum ada toko — tambahkan di Pengaturan ▸ Data Toko &amp; Gudang terlebih dahulu.
          </p>
        ) : (
          <div className="bidang bidang--pilih-toko">
            <label htmlFor="pilih-toko">Toko</label>
            <select
              id="pilih-toko"
              value={toko}
              onChange={(e) => {
                setToko(e.target.value);
                simpanTokoAktif(e.target.value);
                beritahu(`Mengatur toko ${e.target.value}.`, 'info', 2500);
              }}
            >
              {daftarToko.map((t) => {
                const k = t.label.match(/\(([^)]+)\)$/)?.[1] ?? t.label;
                return (
                  <option key={t.id} value={k}>
                    {t.label}
                  </option>
                );
              })}
            </select>
          </div>
        )}
      </section>
    ) : null;

  if (tab.kustom === 'kartu') {
    return (
      <TabPengaturan
        tab={tab}
        daftar={daftar}
        toko={toko}
        kustomAtas={pemilih}
        kecuali={['kartu']}
        panel={(nilai, ubah) => <PanelKartuDashboard daftar={daftar} nilai={nilai} ubah={ubah} />}
      />
    );
  }

  if (tab.kustom === 'label') {
    return (
      <TabPengaturan
        tab={tab}
        daftar={daftar}
        toko={toko}
        kustomAtas={pemilih}
        panel={(nilai) => <PanelPratinjauLabel nilai={nilai} />}
      />
    );
  }

  return <TabPengaturan tab={tab} daftar={daftar} toko={toko} kustomAtas={pemilih} />;
}

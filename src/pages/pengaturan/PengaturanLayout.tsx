import { useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Icon } from '../../components/Icon';
// Gaya halaman tab (Pengaturan ▸ Tampilan & sebagainya) — dimuat bersama
// layout agar seluruh tab memakainya tanpa mengandungi impor tiap halaman.
import './pengaturan.css';
import { useSesi } from '../../lib/sesi';
import { TombolScan } from '../../components/ScanKamera';
import { useDaftarPengaturan } from './useDaftarPengaturan';

/**
 * Tab lama — ISINYA TIDAK DIUBAH. Hanya dipindahkan ke daftar kiri
 * agar halaman Pengaturan bisa memuat banyak tab tanpa memenuhi baris atas.
 * Tab lama tidak punya baris di matriks Hak Akses, jadi hanya tampil untuk Admin.
 *
 * "Halaman Awal & Peran" sudah DIGABUNG ke tab Pengguna & Hak Akses
 * (registry server); alamat lamanya dialihkan ke sana.
 */
const TAB_LAMA = [
  { path: '/pengaturan/template-faktur', label: 'Template Faktur', ket: 'Ukuran & tata letak faktur' },
  { path: '/pengaturan/aturan-kodi', label: 'Aturan Kodi', ket: 'Aturan satuan & varian' },
  { path: '/pengaturan/struk', label: 'Struk (POS)', ket: 'Profil struk thermal' },
  { path: '/pengaturan/proses-tahunan', label: 'Proses Tahunan', ket: 'Hapus riwayat & saldo awal' },
];

/** Y2.1 — tab yang selalu tampil paling atas di grup "Pengaturan Dasar". */
const TAB_PALING_ATAS = 'identitas-aplikasi';

interface Item {
  path: string;
  label: string;
  ket: string | null;
}

interface GrupItem {
  kode: string;
  label: string;
  item: Item[];
}

/**
 * Kerangka modul Pengaturan: navigasi kiri berkelompok dengan kolom pencarian
 * di atasnya, dan daftar yang men-scroll sendiri bila tidak muat. Di layar
 * sempit daftar berubah menjadi baris chip yang bisa digeser.
 *
 * Kelompok diambil dari registry server (`GRUP`) — Umum, Transaksi, Keuangan,
 * Keamanan & Sistem, Lainnya — sehingga tab baru otomatis punya tempat.
 * Tab tanpa izin untuk peran aktif tidak ditampilkan (matriks Hak Akses);
 * bila tidak ada satu pun, halaman menjelaskan bahwa Pengaturan untuk Admin.
 */
const IKON_GRUP: Record<string, 'pengaturan' | 'master' | 'penjualan' | 'akuntansi' | 'sliders' | 'folder-input'> = {
  dasar: 'pengaturan',
  umum: 'master',
  transaksi: 'penjualan',
  keuangan: 'akuntansi',
  sistem: 'sliders',
  lain: 'folder-input',
};

export function PengaturanLayout() {
  const { daftar } = useDaftarPengaturan();
  const [cari, setCari] = useState('');
  // Navigasi grup: ubin per grup sebagai ganti daftar ~25 kartu.
  const [grupPilih, setGrupPilih] = useState<string | null>(null);
  const lokasi = useLocation();
  // AX — satu penanda Top (sesi), bukan nama peran di kode.
  const admin = useSesi().info?.pengguna.admin === true;

  const tabDiizinkan = useMemo(
    () => (daftar?.tab ?? []).filter((t) => t.boleh !== false),
    [daftar],
  );
  // Peran tanpa izin tab sama sekali: Pengaturan tidak bisa dibuka.
  const tanpaIzin = Boolean(daftar) && !admin && tabDiizinkan.length === 0;
  // Tab lama tidak punya baris di matriks — hanya Admin yang boleh membukanya.
  const diTabLama = TAB_LAMA.some((t) => t.path === lokasi.pathname);
  const tampilkanPesan = Boolean(daftar) && (tanpaIzin || (!admin && diTabLama));

  const grup: GrupItem[] = useMemo(() => {
    const perGrup = new Map<string, Item[]>();
    for (const t of tabDiizinkan) {
      // Y2.1 — Identitas Aplikasi ditampilkan paling atas pada grup
      // "Pengaturan Dasar", bukan di kelompok registry-nya sendiri.
      if (t.kode === TAB_PALING_ATAS) continue;
      const isi = perGrup.get(t.grup) ?? [];
      isi.push({ path: `/pengaturan/t/${t.kode}`, label: t.label, ket: t.ket });
      perGrup.set(t.grup, isi);
    }
    const identitas = tabDiizinkan.find((t) => t.kode === TAB_PALING_ATAS);
    const dasar = admin ? TAB_LAMA : [];
    return [
      {
        kode: 'dasar',
        label: 'Pengaturan Dasar',
        item: [
          ...(identitas
            ? [{ path: `/pengaturan/t/${identitas.kode}`, label: identitas.label, ket: identitas.ket }]
            : []),
          ...dasar,
        ],
      },
      ...(daftar?.grup ?? []).map((g) => ({
        kode: g.kode,
        label: g.label,
        item: perGrup.get(g.kode) ?? [],
      })),
    ].filter((g) => g.item.length > 0);
  }, [daftar, tabDiizinkan, admin]);

  const kunci = cari.trim().toLowerCase();
  const terlihat = useMemo(() => {
    if (!kunci) return grup;
    return grup
      .map((g) => ({
        ...g,
        item: g.item.filter(
          (i) => i.label.toLowerCase().includes(kunci) || (i.ket ?? '').toLowerCase().includes(kunci),
        ),
      }))
      .filter((g) => g.item.length > 0);
  }, [grup, kunci]);

  const jumlah = terlihat.reduce((n, g) => n + g.item.length, 0);

  return (
    <div className="pengaturan-wrap">
      <nav className="pengaturan-sisi" aria-label="Bagian pengaturan">
        <div className="pengaturan-cari cari-scan">
          <input
            type="search"
            value={cari}
            placeholder="Cari pengaturan…"
            aria-label="Cari pengaturan"
            onChange={(e) => setCari(e.target.value)}
          />
          <TombolScan onHasil={setCari} />
        </div>

        <div className="pengaturan-daftar">
          {jumlah === 0 && (
            <p className="teks-redup pengaturan-kosong">Tidak ada pengaturan yang cocok.</p>
          )}
          {grupPilih === null ? (
            <ul className="pengaturan-grupnav">
              {terlihat.map((g) => (
                <li key={g.kode}>
                  <button
                    type="button"
                    className="pengaturan-grupnav__tile"
                    onClick={() => setGrupPilih(g.kode)}
                  >
                    <span className="pengaturan-grupnav__ikon">
                      <Icon nama={IKON_GRUP[g.kode] ?? 'folder-input'} size={20} />
                    </span>
                    <span className="pengaturan-grupnav__teks">
                      <strong>{g.label}</strong>
                      <small>{g.item.length} pengaturan</small>
                    </span>
                    <span className="pengaturan-grupnav__panah" aria-hidden="true">›</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="pengaturan-grup">
              <button
                type="button"
                className="pengaturan-grupnav__kembali"
                onClick={() => setGrupPilih(null)}
              >
                ‹ Semua grup
              </button>
              <h4>{terlihat.find((g) => g.kode === grupPilih)?.label ?? ''}</h4>
              <ul>
                {(terlihat.find((g) => g.kode === grupPilih)?.item ?? []).map((i) => (
                  <li key={i.path}>
                    <NavLink to={i.path} onClick={() => setCari('')}>
                      <span>{i.label}</span>
                      {i.ket && <small>{i.ket}</small>}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {tanpaIzin && (
            <p className="teks-redup pengaturan-kosong">
              Peran ini belum diizinkan Admin membuka tab mana pun.
            </p>
          )}
        </div>
      </nav>

      <div className="pengaturan-isi">
        {tampilkanPesan ? (
          <section className="kartu">
            <div className="kartu__kepala kartu__kepala--kompak">
              <h3>
                {tanpaIzin ? 'Pengaturan hanya untuk Admin' : 'Halaman ini hanya untuk Admin'}
              </h3>
            </div>
            <p className="teks-redup">
              {tanpaIzin
                ? 'Peran ini tidak memiliki izin tab Pengaturan. Admin dapat memberi izin per tab (misalnya Penomoran atau Pajak) lewat Pengaturan ▸ Pengguna & Hak Akses ▸ Peran & Hak Akses.'
                : 'Peran ini tidak memiliki izin halaman tersebut. Buka tab yang tersedia di daftar kiri, atau minta Admin memberi izin pada Pengguna & Hak Akses.'}
            </p>
            <p className="teks-redup">
              Ingin kembali ke akun Admin? Keluar lewat menu pengguna di kanan atas, lalu masuk kembali.
            </p>
          </section>
        ) : (
          <Outlet />
        )}
      </div>
    </div>
  );
}

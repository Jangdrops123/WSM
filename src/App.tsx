import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AppLayout } from './layout/AppLayout';
import { ToastRak } from './components/crud/Toast';
import { MENU } from './config/menu';
import { TanpaAkses } from './pages/TolakAkses';
import type { CSSProperties } from 'react';
import { useSesi } from './lib/sesi';
import { aksenEfektif, identitasDikenal, logoUntukTema } from './lib/identitas';
import { useIdentitasAplikasi } from './lib/PenyediaIdentitas';
import { gradasiAksen } from './lib/aksen';
import { apiGet, saatMaintenance } from './lib/api';
import { bacaSalinan } from './lib/salinanIdentitas';

const HalamanAwal = lazy(() => import('./pages/HalamanAwal').then((module) => ({ default: module.HalamanAwal })));
const ModulKerangka = lazy(() => import('./pages/ModulKerangka').then((module) => ({ default: module.ModulKerangka })));
const TidakDitemukan = lazy(() => import('./pages/TidakDitemukan').then((module) => ({ default: module.TidakDitemukan })));
const ProdukPage = lazy(() => import('./pages/master/ProdukPage').then((module) => ({ default: module.ProdukPage })));
const KonversiPage = lazy(() => import('./pages/master/KonversiPage').then((module) => ({ default: module.KonversiPage })));
const PaketPage = lazy(() => import('./pages/master/PaketPage').then((module) => ({ default: module.PaketPage })));
const GudangPage = lazy(() => import('./pages/master/GudangPage').then((module) => ({ default: module.GudangPage })));
const HalamanUmum = lazy(() => import('./pages/master/HalamanUmum').then((module) => ({ default: module.HalamanUmum })));
const AlihTabLama = lazy(() => import('./pages/AlihTabLama').then((module) => ({ default: module.AlihTabLama })));
const HalamanSaldo = lazy(() => import('./pages/stok/HalamanSaldo').then((module) => ({ default: module.HalamanSaldo })));
const HalamanKartu = lazy(() => import('./pages/stok/HalamanKartu').then((module) => ({ default: module.HalamanKartu })));
const HalamanTransfer = lazy(() => import('./pages/stok/HalamanTransfer').then((module) => ({ default: module.HalamanTransfer })));
const HalamanOpname = lazy(() => import('./pages/opname/HalamanOpname').then((module) => ({ default: module.HalamanOpname })));
const SesiOpname = lazy(() => import('./pages/opname/SesiOpname').then((module) => ({ default: module.SesiOpname })));
const HalamanPersediaan = lazy(() => import('./pages/persediaan/HalamanPersediaan').then((module) => ({ default: module.HalamanPersediaan })));
const PosFoto = lazy(() => import('./pages/pos/PosFoto').then((module) => ({ default: module.PosFoto })));
const PenjualanPage = lazy(() => import('./pages/penjualan/PenjualanPage').then((module) => ({ default: module.PenjualanPage })));
const PembelianPage = lazy(() => import('./pages/pembelian/PembelianPage').then((module) => ({ default: module.PembelianPage })));
const PoDaftar = lazy(() => import('./pages/po/PoDaftar').then((module) => ({ default: module.PoDaftar })));
const PoBuat = lazy(() => import('./pages/po/PoBuat').then((module) => ({ default: module.PoBuat })));
const PoDetail = lazy(() => import('./pages/po/PoDetail').then((module) => ({ default: module.PoDetail })));
const PoTerima = lazy(() => import('./pages/po/PoTerima').then((module) => ({ default: module.PoTerima })));
const PoLaporan = lazy(() => import('./pages/po/PoLaporan').then((module) => ({ default: module.PoLaporan })));
const DetailFaktur = lazy(() => import('./pages/faktur/DetailFaktur').then((module) => ({ default: module.DetailFaktur })));
const PengaturanLayout = lazy(() => import('./pages/pengaturan/PengaturanLayout').then((module) => ({ default: module.PengaturanLayout })));
const TemplateFakturPage = lazy(() => import('./pages/pengaturan/TemplateFakturPage').then((module) => ({ default: module.TemplateFakturPage })));
const AturanKodiPage = lazy(() => import('./pages/pengaturan/AturanKodiPage').then((module) => ({ default: module.AturanKodiPage })));
const StrukPage = lazy(() => import('./pages/pengaturan/StrukPage').then((module) => ({ default: module.StrukPage })));
const ProsesTahunanPage = lazy(() => import('./pages/pengaturan/ProsesTahunanPage').then((module) => ({ default: module.ProsesTahunanPage })));
const LaporanLayout = lazy(() => import('./pages/laporan/LaporanLayout').then((module) => ({ default: module.LaporanLayout })));
const RingkasanLaporan = lazy(() => import('./pages/laporan/Ringkasan').then((module) => ({ default: module.RingkasanLaporan })));
const DaftarKategoriLaporan = lazy(() => import('./pages/laporan/DaftarKategori').then((module) => ({ default: module.DaftarKategoriLaporan })));
const HalamanLaporan = lazy(() => import('./pages/laporan/HalamanLaporan').then((module) => ({ default: module.HalamanLaporan })));
const TersimpanLaporan = lazy(() => import('./pages/laporan/Tersimpan').then((module) => ({ default: module.TersimpanLaporan })));
const KasBankPage = lazy(() => import('./pages/akuntansi/KasBankPage').then((module) => ({ default: module.KasBankPage })));
const BiayaPage = lazy(() => import('./pages/akuntansi/BiayaPage').then((module) => ({ default: module.BiayaPage })));
const PemasukanPage = lazy(() => import('./pages/akuntansi/PemasukanPage').then((module) => ({ default: module.PemasukanPage })));
const TagihanPage = lazy(() => import('./pages/akuntansi/TagihanPage').then((module) => ({ default: module.TagihanPage })));
const LaporanDasarPage = lazy(() => import('./pages/akuntansi/LaporanDasarPage').then((module) => ({ default: module.LaporanDasarPage })));
const HalamanTabPengaturan = lazy(() => import('./pages/pengaturan/HalamanTabPengaturan').then((module) => ({ default: module.HalamanTabPengaturan })));
const HalamanLogin = lazy(() => import('./pages/auth/HalamanLogin').then((module) => ({ default: module.HalamanLogin })));
const HalamanLupaSandi = lazy(() => import('./pages/auth/HalamanLupaSandi').then((module) => ({ default: module.HalamanLupaSandi })));
const HalamanResetSandi = lazy(() => import('./pages/auth/HalamanResetSandi').then((module) => ({ default: module.HalamanResetSandi })));
const HalamanWajibGantiSandi = lazy(() => import('./pages/auth/HalamanWajibGantiSandi').then((module) => ({ default: module.HalamanWajibGantiSandi })));

/** O2/R1 — Alias /opname/:id → /stok/opname/:id (tautan lama di dalam aplikasi). */
function AlihOpnameId() {
  const { id } = useParams();
  return <Navigate to={`/stok/opname/${id}`} replace />;
}

/** Rute aplikasi mengikuti menu sidebar (Dashboard + 9 modul). */
function RuteMasuk() {
  return (
    <>
      <Suspense fallback={<LayarMuat />}>
      <Routes>
        <Route element={<AppLayout />}>
          {/* M6 — halaman awal setelah login (per peran; sekali per sesi). */}
          <Route index element={<HalamanAwal />} />

          {/* Z1/Z2 — Master Data: TANPA ribon tab; tiap sub-menu = rute mandiri.
              Layout ber-ribbon (MasterLayout) dihapus; halaman langsung di bawah
              AppLayout sehingga kartu naik ke bawah header (Z4).
              AlihTabLama: alamat lama ?tab=kategori / #kategori → rute baru. */}
          <Route
            path="master"
            element={
              <AlihTabLama
                peta={{
                  produk: '/master/produk',
                  konversi: '/master/konversi',
                  'konversi-satuan': '/master/konversi',
                  paket: '/master/paket',
                  'paket-box': '/master/paket',
                  kategori: '/master/kategori',
                  merek: '/master/merek',
                  satuan: '/master/satuan',
                  pelanggan: '/master/pelanggan',
                  pemasok: '/master/pemasok',
                  gudang: '/master/gudang',
                  'gudang-lokasi': '/master/gudang',
                }}
                selain={<Navigate to="produk" replace />}
              />
            }
          />
          <Route path="master/produk" element={<ProdukPage />} />
          <Route path="master/konversi" element={<KonversiPage />} />
          <Route path="master/paket" element={<PaketPage />} />
          <Route path="master/kategori" element={<HalamanUmum kode="kategori" />} />
          <Route path="master/merek" element={<HalamanUmum kode="merek" />} />
          <Route path="master/satuan" element={<HalamanUmum kode="satuan" />} />
          <Route path="master/pelanggan" element={<HalamanUmum kode="pelanggan" />} />
          <Route path="master/pemasok" element={<HalamanUmum kode="pemasok" />} />
          <Route path="master/gudang" element={<GudangPage />} />
          {/* Z2 — alamat lama tab → rute baru (supaya tautan/bookmark lama tidak rusak). */}
          <Route path="master/konversi-satuan" element={<Navigate to="/master/konversi" replace />} />
          <Route path="master/paket-box" element={<Navigate to="/master/paket" replace />} />
          <Route path="master/gudang-lokasi" element={<Navigate to="/master/gudang" replace />} />

          {/* Z1/Z2 — Stok: tanpa ribon; Stok Saat Ini (indeks), Kartu, Transfer,
              Masuk, Keluar, dan Opname semuanya rute mandiri. */}
          <Route
            path="stok"
            element={
              <AlihTabLama
                peta={{
                  saldo: '/stok',
                  kartu: '/stok/kartu',
                  transfer: '/stok/transfer',
                  masuk: '/stok/masuk',
                  keluar: '/stok/keluar',
                  opname: '/stok/opname',
                }}
                selain={<HalamanSaldo />}
              />
            }
          />
          <Route path="stok/kartu" element={<HalamanKartu />} />
          <Route path="stok/transfer" element={<HalamanTransfer />} />

          {/* R1 — item bekas grup "Persediaan Sub" pindah ke grup Stok.
              Isi halaman TIDAK berubah; hanya alamatnya yang bertambah. */}
          <Route path="stok/masuk" element={<HalamanPersediaan arah="masuk" />} />
          <Route path="stok/keluar" element={<HalamanPersediaan arah="keluar" />} />
          <Route path="stok/opname">
            <Route index element={<HalamanOpname />} />
            <Route path=":id" element={<SesiOpname />} />
          </Route>

          {/* Pembelian: Input (form saja) & Riwayat & Dokumen (daftar saja) — halaman terpisah. */}
          <Route path="pembelian" element={<PembelianPage tampilan="input" />} />
          <Route path="pembelian/riwayat" element={<PembelianPage tampilan="riwayat" />} />

          {/* Purchase Order (grup Purchase): Daftar / Buat / Detail / Terima / Laporan. */}
          <Route path="po">
            <Route index element={<PoDaftar />} />
            <Route path="buat" element={<PoBuat />} />
            {/* Mode edit PO: /po/edit/:id memuat header + item PO ke form yang sama. */}
            <Route path="edit/:id" element={<PoBuat />} />
            <Route path="terima" element={<PoTerima />} />
            <Route path="laporan" element={<PoLaporan />} />
            <Route path=":id" element={<PoDetail />} />
          </Route>

          {/* R1 — Pengalihan sisi klien untuk alamat lama (bookmark & tautan lama).
              Redirect HTTP 301 untuk pemuatan halaman langsung ada di server & Vite
              (lihat server/alihPos.ts). */}
          <Route path="persediaan-sub" element={<Navigate to="/stok/masuk" replace />} />
          <Route path="persediaan-sub/masuk" element={<Navigate to="/stok/masuk" replace />} />
          <Route path="persediaan-sub/keluar" element={<Navigate to="/stok/keluar" replace />} />
          <Route path="persediaan/opname" element={<Navigate to="/stok/opname" replace />} />
          <Route path="persediaan/opname/:id" element={<AlihOpnameId />} />

          <Route path="opname" element={<Navigate to="/stok/opname" replace />} />
          <Route path="opname/:id" element={<AlihOpnameId />} />

          {/* M2/Z1 — Modul Penjualan: riwayat (indeks) + retur + piutang.
              Ribon tab sudah dihapus; ketiganya halaman mandiri. */}
          <Route path="penjualan">
            <Route
              index
              element={
                <AlihTabLama
                  peta={{
                    riwayat: '/penjualan',
                    retur: '/penjualan/retur',
                    piutang: '/penjualan/piutang',
                    'pos-foto': '/penjualan/pos/foto',
                    'pos-tanpa-foto': '/penjualan/pos/tanpa-foto',
                  }}
                  selain={<PenjualanPage tab="riwayat" />}
                />
              }
            />
            <Route path="retur" element={<PenjualanPage tab="retur" />} />
            <Route path="piutang" element={<PenjualanPage tab="piutang" />} />
          </Route>

          {/* R2 — Modul "Daftar Dokumen" dihapus; faktur dibuka dari Riwayat &
              Dokumen Pembelian/Penjualan. Alamat lama /dokumen/:id tetap hidup
              (kompatibilitas tautan & pesan WA lama), /dokumen → /penjualan. */}
          <Route path="dokumen">
            <Route index element={<Navigate to="/penjualan" replace />} />
            <Route path=":id" element={<DetailFaktur />} />
          </Route>
          <Route path="pembelian/dokumen/:id" element={<DetailFaktur />} />
          <Route path="penjualan/dokumen/:id" element={<DetailFaktur />} />

          {/* Pengaturan: template faktur (ukuran kertas) & aturan kodi */}
          <Route path="pengaturan" element={<PengaturanLayout />}>
            <Route index element={<Navigate to="template-faktur" replace />} />
            <Route path="template-faktur" element={<TemplateFakturPage />} />
            <Route path="aturan-kodi" element={<AturanKodiPage />} />
            <Route path="struk" element={<StrukPage />} />
            {/* Halaman Awal & Peran sudah DIGABUNG ke Pengguna & Hak Akses.
                Alamat lama tetap dialihkan agar bookmark tidak rusak. */}
            <Route path="halaman-awal" element={<Navigate to="/pengaturan/t/pengguna" replace />} />
            <Route path="proses-tahunan" element={<ProsesTahunanPage />} />
            {/* AKUNTANSI DASAR — pemetaan akun COA & jurnal dihapus; metode bayar
                → rekening kas diatur di tab Kas & Bank. */}
            <Route path="pemetaan-akun" element={<Navigate to="/pengaturan/t/kas-bank" replace />} />
            {/* Tab baru per grup (Grup Umum & Grup Transaksi) — form dari registry */}
            <Route path="t/:kode" element={<HalamanTabPengaturan />} />
          </Route>

          {/* BAGIAN N — Laporan: filter global + ringkasan + kategori + generik + tersimpan */}
          <Route path="laporan" element={<LaporanLayout />}>
            <Route index element={<RingkasanLaporan />} />
            <Route path="tersimpan" element={<TersimpanLaporan />} />
            <Route path="l/:kode" element={<HalamanLaporan />} />
            <Route path=":kategori" element={<DaftarKategoriLaporan />} />
          </Route>

          {/* Z1/Z2 — Akuntansi: tanpa ribon "pengaturan-nav"; tiap halaman rute mandiri. */}
          <Route
            path="akuntansi"
            element={
              <AlihTabLama
                peta={{
                  kas: '/akuntansi/kas',
                  pengeluaran: '/akuntansi/pengeluaran',
                  pemasukan: '/akuntansi/pemasukan',
                  piutang: '/akuntansi/piutang',
                  hutang: '/akuntansi/hutang',
                  laporan: '/akuntansi/laporan',
                }}
                selain={<Navigate to="/akuntansi/kas" replace />}
              />
            }
          />
          <Route path="akuntansi/kas" element={<KasBankPage />} />
          <Route path="akuntansi/pengeluaran" element={<BiayaPage />} />
          <Route path="akuntansi/pemasukan" element={<PemasukanPage />} />
          <Route path="akuntansi/piutang" element={<TagihanPage tipe="piutang" />} />
          <Route path="akuntansi/hutang" element={<TagihanPage tipe="hutang" />} />
          <Route path="akuntansi/laporan" element={<LaporanDasarPage />} />
          {/* Alamat lama modul akuntansi → dialihkan ke halaman dasar terkait. */}
          <Route path="akuntansi/coa" element={<Navigate to="/akuntansi/kas" replace />} />
          <Route path="akuntansi/jurnal" element={<Navigate to="/akuntansi/kas" replace />} />
          <Route path="akuntansi/buku-besar" element={<Navigate to="/akuntansi/laporan" replace />} />
          <Route path="akuntansi/neraca-saldo" element={<Navigate to="/akuntansi/laporan" replace />} />
          <Route path="akuntansi/periode" element={<Navigate to="/akuntansi/kas" replace />} />

          {/* Modul lain: masih kerangka */}
          {MENU.filter((m) =>
            !['/', '/master', '/stok', '/pembelian', '/po', '/pengaturan', '/penjualan', '/laporan', '/akuntansi'].includes(
              m.path,
            ),
          ).map((m) => (
            <Route key={m.kode} path={m.path.replace(/^\//, '')} element={<ModulKerangka kode={m.kode} />} />
          ))}

          <Route path="*" element={<TidakDitemukan />} />
        </Route>

        {/* Halaman eksplisit untuk sesi aktif yang belum memiliki izin Lihat. */}
        <Route path="/tanpa-akses" element={<TanpaAkses />} />

        {/* M2 — POS di dalam modul Penjualan: layar penuh kasir — di luar shell sidebar. */}
        {/* POS satu halaman dual-mode: Foto & Teks satu komponen, ganti instan
            tanpa navigasi. Dua URL dipertahankan untuk kompatibilitas. */}
        <Route path="penjualan/pos/foto" element={<PosFoto modeAwal="foto" />} />
        <Route path="penjualan/pos/tanpa-foto" element={<PosFoto modeAwal="teks" />} />

        {/* M2 — Rute lama dialihkan ke rute baru (bookmark & tautan lama tetap hidup).
            Pengalihan HTTP 301 terjadi di server Express & middleware Vite dev;
            berikut pengalihan sisi-klien untuk navigasi dalam aplikasi. */}
        <Route path="pos" element={<Navigate to="/penjualan" replace />} />
        <Route path="pos/foto" element={<Navigate to="/penjualan/pos/foto" replace />} />
        <Route path="pos/cepat" element={<Navigate to="/penjualan/pos/tanpa-foto" replace />} />
        <Route path="pos/tanpa-foto" element={<Navigate to="/penjualan/pos/tanpa-foto" replace />} />
      </Routes>
      </Suspense>
    </>
  );
}

/**
 * TAHAP 1 — Penjaga sesi (guard rute):
 *
 *  * sesi masih diperiksa  → layar muat (gaya .layar-muat dari index.html),
 *  * belum masuk / habis   → halaman Log In (penuh layar) + Lupa/Reset sandi,
 *  * wajib ganti password  → layar paksa ganti password (tombol Keluar),
 *  * masuk                 → aplikasi normal (rute per modul + gerbang izin).
 */
/**
 * Layar maintenance global: tampil saat server me-restore database (seluruh
 * /api non-backup menjawab 503 + kode maintenance). Polling status tiap
 * 5 detik; hilang otomatis + muat ulang saat restore selesai.
 */
function LayarMaintenance() {
  const [muncul, setMuncul] = useState(false);
  useEffect(() => saatMaintenance(() => setMuncul(true)), []);
  useEffect(() => {
    if (!muncul) return;
    const t = window.setInterval(async () => {
      try {
        const st = await apiGet<{ maintenance: boolean }>('/api/backup/status');
        if (!st.maintenance) window.location.reload();
      } catch {
        /* server mungkin restart — coba lagi */
      }
    }, 5000);
    return () => window.clearInterval(t);
  }, [muncul]);
  if (!muncul) return null;
  return (
    <div className="layar-maintenance" role="alert" aria-busy="true" aria-label="Mode maintenance">
      <div className="layar-maintenance__kartu">
        <div className="layar-maintenance__spinner" aria-hidden="true" />
        <h2>Mode Maintenance</h2>
        <p>Restore database sedang berjalan. Akses dikunci sementara agar tidak ada transaksi gantung.</p>
        <p className="teks-redup">Halaman akan dimuat ulang otomatis setelah selesai…</p>
      </div>
    </div>
  );
}

export function App() {
  const sesi = useSesi();
  const tamu = sesi.status !== 'masuk' || !sesi.info;

  return (
    <>
      <ToastRak />
      <LayarMaintenance />
      {sesi.status === 'memuat' ? (
        <LayarMuat />
      ) : tamu ? (
        <Routes>
          <Route path="/login" element={<HalamanLogin />} />
          <Route path="/lupa-sandi" element={<HalamanLupaSandi />} />
          <Route path="/reset-sandi" element={<HalamanResetSandi />} />
          {/* Alamat lain saat keluar → kembali ke Log In (URL asal jadi tujuan). */}
          <Route path="*" element={<HalamanLogin />} />
        </Routes>
      ) : sesi.info?.pengguna.wajibGanti ? (
        <HalamanWajibGantiSandi />
      ) : (
        <RuteMasuk />
      )}
    </>
  );
}

/**
 * Layar muat sesi — memakai gaya `.layar-muat` dari index.html (tanpa kedip).
 * AI2/AI4: nama, tagline, dan logo dari identitas/cache perangkat; perangkat
 * baru tetap netral (tanpa huruf/merek bawaan) sampai identitas diketahui.
 */
function LayarMuat() {
  const identitas = useIdentitasAplikasi();
  const salinan = bacaSalinan();
  const dikenal = identitasDikenal() || Boolean(salinan);
  const nama = (dikenal ? identitas.nama.trim() : '') || salinan?.nama || '';
  const tagline = dikenal ? identitas.tagline : (salinan?.tagline ?? '');
  const logo = (dikenal ? logoUntukTema(identitas) : '') || salinan?.ikonData || salinan?.ikon || '';
  const tema = document.documentElement.dataset.theme === 'dark' ? 'malam' : 'siang';
  const [awal, akhir] = gradasiAksen(aksenEfektif(), tema);
  const gaya = { '--lm-aksen': awal, '--lm-aksen-2': akhir } as CSSProperties;

  return (
    <div
      className="layar-muat layar-muat--sesi"
      role="status"
      aria-busy="true"
      aria-label="Memuat sesi"
      style={gaya}
    >
      {nama !== '' && (
        <div className={`layar-muat__logo ${logo ? 'layar-muat__logo--gambar' : ''}`}>
          {logo ? <img src={logo} alt="" /> : nama.charAt(0).toUpperCase()}
        </div>
      )}
      {nama !== '' && (
        <div className="layar-muat__isi">
          <div className="layar-muat__nama">{nama}</div>
          {tagline !== '' && <div className="layar-muat__tagline">{tagline}</div>}
        </div>
      )}
      <div className="layar-muat__bilah" aria-hidden="true" />
    </div>
  );
}

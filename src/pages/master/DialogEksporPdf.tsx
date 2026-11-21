import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/crud/Modal';
import { beritahu } from '../../components/crud/Toast';
import { pratinjauEkspor, type PraEkspor } from '../../lib/api';
import { useUsaha } from '../../lib/usaha';
import { cetakHtml } from '../../lib/code39';
import { KOLOM_PRODUK, type KolomProduk } from './kolomProduk';
import {
  KERTAS,
  PX_PER_MM,
  bangunDokumen,
  gayaDokumen,
  type OpsiDokumen,
  type Orientasi,
  type Template,
  type Toko,
} from './pdfDokumen';
import './impor-ekspor.css';

/** Baris maksimum yang dirender pada pratinjau layar (cetak memakai semua). */
const PRATINJAU_MAKS = 40;
const KATALOG_MAKS_PRATINJAU = 24;

type Cakupan = 'semua' | 'filter' | 'terpilih';

interface Props {
  entitas: string;
  judul: string;
  kolom?: KolomProduk[];
  opsiKategori: { id: number; label: string }[];
  terpilih?: number[];
  onTutup: () => void;
}

/**
 * Dialog Ekspor PDF — panel kiri berisi pengaturan (template, ukuran,
 * orientasi, kop & logo toko, kartu ringkasan, pengelompokan per kategori,
 * tanda tangan, nomor halaman); panel kanan menampilkan pratinjau kertas
 * yang diskalakan. Tombol Unduh memakai mesin cetak peramban
 * (Print → Save as PDF) dengan tata letak yang SAMA PERSIS dengan pratinjau —
 * keduanya lahir dari `pdfDokumen.ts`.
 */
export function DialogEksporPdf({
  entitas,
  judul,
  kolom = KOLOM_PRODUK,
  opsiKategori,
  terpilih = [],
  onTutup,
}: Props) {
  const semuaKey = useMemo(() => kolom.filter((k) => !k.turunan).map((k) => k.key), [kolom]);
  /** String stabil — `[...Set]` membuat array baru tiap render induk. */
  const terpilihKey = terpilih.join(',');
  const [template, setTemplate] = useState<Template>('laporan');
  const [ukuran, setUkuran] = useState('A4');
  const [orientasi, setOrientasi] = useState<Orientasi>('potret');
  const [kop, setKop] = useState(true);
  const [kartuRingkasan, setKartuRingkasan] = useState(true);
  const [kelompok, setKelompok] = useState(true);
  const [tandaTangan, setTandaTangan] = useState(true);
  const [nomorHalaman, setNomorHalaman] = useState(true);
  const [kolomKey, setKolomKey] = useState<string[]>([
    'kode_item',
    'nama_produk',
    'kategori',
    'stok',
    'harga_jual',
    'harga_beli',
  ]);
  const [cakupan, setCakupan] = useState<Cakupan>(terpilih.length ? 'terpilih' : 'semua');
  const [kategori, setKategori] = useState('');
  const [stok, setStok] = useState('');
  const [toko, setToko] = useState<Toko>({ nama: 'Toko Retail', alamat: '', telepon: '', logo: '' });
  const [pra, setPra] = useState<PraEkspor | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [skala, setSkala] = useState(0.6);
  const wadah = useRef<HTMLDivElement>(null);
  /** Tinggi isi dokumen (px, tanpa skala) — untuk menghitung jumlah halaman. */
  const isiRef = useRef<HTMLDivElement>(null);
  const [tinggiIsi, setTinggiIsi] = useState(0);

  // Identitas toko (kop & logo) dari store global — selalu data terbaru
  // Pengaturan ▸ Profil Usaha, berubah seketika setelah Simpan.
  const usaha = useUsaha();
  useEffect(() => {
    setToko({ nama: usaha.nama, alamat: usaha.alamat, telepon: usaha.telepon, logo: usaha.logo });
  }, [usaha]);

  const buatQuery = () => {
    const q = new URLSearchParams();
    if (kolomKey.length !== semuaKey.length) q.set('kolom', kolomKey.join(','));
    if (cakupan === 'terpilih') {
      q.set('cakupan', 'terpilih');
      q.set('ids', terpilihKey);
    } else if (cakupan === 'filter') {
      q.set('cakupan', 'filter');
      if (kategori) q.set('kategori', kategori);
      if (stok) q.set('stok', stok);
    }
    q.set('batas', '2000');
    return q;
  };

  useEffect(() => {
    if (cakupan === 'terpilih' && terpilihKey === '') {
      setPra(null);
      return;
    }
    const q = buatQuery();
    let hidup = true;
    const t = window.setTimeout(() => {
      setSibuk(true);
      pratinjauEkspor(entitas, q)
        .then((r) => {
          if (hidup) setPra(r);
        })
        .catch((err: Error) => {
          if (hidup) {
            setPra(null);
            beritahu(err.message, 'galat');
          }
        })
        .finally(() => {
          if (hidup) setSibuk(false);
        });
    }, 350);
    return () => {
      hidup = false;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entitas, cakupan, kategori, stok, kolomKey, terpilihKey]);

  const kertas = KERTAS[ukuran] ?? KERTAS.A4;
  const lanskap = orientasi === 'lanskap';
  const lebarMm = lanskap ? kertas.tinggi : kertas.lebar;
  const tinggiMm = lanskap ? kertas.lebar : kertas.tinggi;
  const margin = ukuran === 'A5' ? 10 : 14;

  const tinggiHalamanPx = tinggiMm * PX_PER_MM;
  const jumlahHalaman = Math.max(1, Math.ceil((tinggiIsi - 1) / tinggiHalamanPx));
  const tinggiKertasPx = jumlahHalaman * tinggiHalamanPx;

  // Skala kertas agar muat di panel pratinjau.
  useEffect(() => {
    const el = wadah.current;
    if (!el) return;
    const ukur = () => {
      const lebar = el.clientWidth - 30;
      setSkala(Math.max(0.2, Math.min(1, lebar / (lebarMm * PX_PER_MM))));
    };
    ukur();
    const ro = new ResizeObserver(ukur);
    ro.observe(el);
    return () => ro.disconnect();
  }, [lebarMm]);

  const kolomDipilih = kolom.filter((k) => kolomKey.includes(k.key));
  const opsiDokumen: OpsiDokumen = {
    template,
    ukuran,
    orientasi,
    kop,
    kartuRingkasan,
    kelompok,
    tandaTangan,
    nomorHalaman,
    margin,
    kolomKey,
    judul,
    toko,
    totalBaris: pra?.total ?? 0,
  };

  const gaya = useMemo(() => gayaDokumen({ ukuran, orientasi, margin }), [ukuran, orientasi, margin]);
  const isiPratinjau = useMemo(
    () =>
      pra
        ? bangunDokumen(
            pra.baris,
            opsiDokumen,
            kolomDipilih,
            template === 'katalog' ? KATALOG_MAKS_PRATINJAU : PRATINJAU_MAKS,
          )
        : '',
    // opsiDokumen dibangun ulang tiap render — cukup bergantung pada nilainya.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pra, template, kop, kartuRingkasan, kelompok, tandaTangan, nomorHalaman, kolomKey, judul, toko, ukuran, orientasi, margin],
  );

  // Ukur tinggi isi (dokumen tumbuh mengikuti jumlah halaman, bukan dipotong).
  useEffect(() => {
    const el = isiRef.current;
    if (!el) return;
    const ukur = () => setTinggiIsi(el.scrollHeight);
    ukur();
    const ro = new ResizeObserver(ukur);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isiPratinjau, skala, lebarMm, tinggiMm]);

  const unduh = () => {
    if (!pra || pra.total === 0) return;
    const semua = bangunDokumen(pra.baris, opsiDokumen, kolomDipilih, Math.max(pra.baris.length, pra.total));
    cetakHtml(`${judul} (Ekspor PDF)`, semua, gaya);
    beritahu('Jendela cetak terbuka — pilih “Save as PDF” untuk menyimpan berkas PDF.', 'info');
  };

  const boleh = kolomKey.length > 0 && !(cakupan === 'terpilih' && terpilihKey === '');

  return (
    <Modal
      judul={`Ekspor ${judul} ke PDF`}
      lebar="sangat"
      onTutup={onTutup}
      aksi={
        <>
          <span className="teks-redup teks-kecil">
            {pra
              ? `${pra.total} baris · ${KERTAS[ukuran]?.label ?? ukuran} ${orientasi} · ${jumlahHalaman} halaman`
              : 'Menyiapkan…'}
          </span>
          <button type="button" className="tombol tombol--netral" onClick={onTutup}>
            Batal
          </button>
          <button type="button" className="tombol tombol--primer" disabled={!boleh || !pra} onClick={unduh}>
            <Icon nama="file-down" size={15} /> Unduh PDF
          </button>
        </>
      }
    >
      <div className="pdf-badan">
        {/* --- Panel kiri: pengaturan ------------------------------------ */}
        <aside className="pdf-kiri">
          <div>
            <h5>Template</h5>
            <div className="pdf-segmen" role="group" aria-label="Template PDF">
              <button type="button" className={template === 'laporan' ? 'aktif' : ''} onClick={() => setTemplate('laporan')}>
                Laporan
              </button>
              <button type="button" className={template === 'ringkas' ? 'aktif' : ''} onClick={() => setTemplate('ringkas')}>
                Ringkas
              </button>
              <button type="button" className={template === 'katalog' ? 'aktif' : ''} onClick={() => setTemplate('katalog')}>
                Katalog foto
              </button>
            </div>
          </div>

          <div>
            <h5>Kertas</h5>
            <div className="pdf-baris">
              <span>Ukuran</span>
              <select value={ukuran} onChange={(e) => setUkuran(e.target.value)}>
                {Object.entries(KERTAS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="pdf-baris" style={{ marginTop: 10 }}>
              <span>Orientasi</span>
              <div className="pdf-segmen" role="group" aria-label="Orientasi kertas">
                <button
                  type="button"
                  className={orientasi === 'potret' ? 'aktif' : ''}
                  onClick={() => setOrientasi('potret')}
                >
                  Potret
                </button>
                <button
                  type="button"
                  className={orientasi === 'lanskap' ? 'aktif' : ''}
                  onClick={() => setOrientasi('lanskap')}
                >
                  Lanskap
                </button>
              </div>
            </div>
          </div>

          <div>
            <h5>Isi dokumen</h5>
            <div className="pdf-centang">
              <label>
                <input type="checkbox" checked={kop} onChange={(e) => setKop(e.target.checked)} />
                <span>Kop &amp; logo toko</span>
              </label>
              {template === 'laporan' && (
                <label>
                  <input
                    type="checkbox"
                    checked={kartuRingkasan}
                    onChange={(e) => setKartuRingkasan(e.target.checked)}
                  />
                  <span>Kartu ringkasan</span>
                </label>
              )}
              {template !== 'katalog' && (
                <label>
                  <input type="checkbox" checked={kelompok} onChange={(e) => setKelompok(e.target.checked)} />
                  <span>Pengelompokan per kategori</span>
                </label>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={tandaTangan}
                  onChange={(e) => setTandaTangan(e.target.checked)}
                />
                <span>Kolom tanda tangan</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={nomorHalaman}
                  onChange={(e) => setNomorHalaman(e.target.checked)}
                />
                <span>Nomor halaman</span>
              </label>
            </div>
          </div>

          {template !== 'katalog' && (
            <div>
              <h5>Kolom tabel</h5>
              <div className="ekspor-kolom">
                {kolom
                  .filter((k) => !k.turunan || kolomKey.includes(k.key))
                  .map((k) => (
                    <label className="ekspor-kolom__baris" key={k.key}>
                      <input
                        type="checkbox"
                        checked={kolomKey.includes(k.key)}
                        onChange={() =>
                          setKolomKey((p) => (p.includes(k.key) ? p.filter((x) => x !== k.key) : [...p, k.key]))
                        }
                      />
                      <span>{k.label}</span>
                    </label>
                  ))}
              </div>
            </div>
          )}

          <div>
            <h5>Data</h5>
            <div className="ekspor-pilih">
              <label>
                Cakupan baris
                <select value={cakupan} onChange={(e) => setCakupan(e.target.value as Cakupan)}>
                  <option value="semua">Semua data</option>
                  <option value="filter">Hasil filter di bawah</option>
                  <option value="terpilih" disabled={!terpilih.length}>
                    Baris terpilih{terpilih.length ? ` (${terpilih.length})` : ' — belum ada'}
                  </option>
                </select>
              </label>
              <label>
                Kategori
                <select value={kategori} disabled={cakupan !== 'filter'} onChange={(e) => setKategori(e.target.value)}>
                  <option value="">Semua kategori</option>
                  {opsiKategori.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Status stok
                <select value={stok} disabled={cakupan !== 'filter'} onChange={(e) => setStok(e.target.value)}>
                  <option value="">Semua status stok</option>
                  <option value="ada">Stok tersedia (&gt; 0)</option>
                  <option value="habis">Stok habis (0)</option>
                  <option value="menipis">Stok menipis (≤ minimum)</option>
                </select>
              </label>
            </div>
          </div>
        </aside>

        {/* --- Panel kanan: pratinjau kertas ----------------------------- */}
        <div className="pdf-wadah" ref={wadah}>
          {!boleh ? (
            <p className="teks-redup" style={{ padding: 24, margin: 0 }}>
              {cakupan === 'terpilih'
                ? 'Belum ada baris yang dipilih — ubah cakupan baris atau centang baris pada tabel.'
                : 'Pilih minimal satu kolom tabel.'}
            </p>
          ) : !pra && sibuk ? (
            <p className="teks-redup" style={{ padding: 24, margin: 0 }}>
              Memuat pratinjau…
            </p>
          ) : pra ? (
            <div
              className="pdf-kertas-wadah"
              style={{ width: lebarMm * PX_PER_MM * skala, height: tinggiKertasPx * skala }}
            >
              <div
                className="pdf-kertas"
                ref={isiRef}
                style={{ width: lebarMm * PX_PER_MM, transform: `scale(${skala})` }}
                dangerouslySetInnerHTML={{ __html: `<style>${gaya}</style>${isiPratinjau}` }}
              />
              {Array.from({ length: jumlahHalaman - 1 }, (_, i) => (
                <div
                  key={i}
                  className="pdf-halaman-garis"
                  data-hal={`hal. ${i + 2}`}
                  style={{ top: (i + 1) * tinggiHalamanPx * skala }}
                />
              ))}
            </div>
          ) : (
            <p className="teks-redup" style={{ padding: 24, margin: 0 }}>
              Pratinjau tidak tersedia.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

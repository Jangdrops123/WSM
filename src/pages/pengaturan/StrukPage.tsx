import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconButton } from '../../components/IconButton';
import { PratinjauKertas } from '../../components/PratinjauKertas';
import { beritahu } from '../../components/crud/Toast';
import { apiDelete, apiGet, apiPost, apiPut } from '../../lib/api';
import { useSegarkanModul } from '../../lib/segarkan';
import { formatRupiah } from '../../lib/format';
import { pratinjauStruk, ukuranStruk, type ProfilStruk, type StrukData } from '../pos/struk';
import './pengaturan.css';

/** Blok struk: [kunci, label]. */
const BLOK_LABEL: [string, string][] = [
  ['logo', 'Logo toko'],
  ['nama_toko', 'Nama toko'],
  ['alamat', 'Alamat'],
  ['telepon', 'Telepon'],
  ['kasir', 'Nama kasir'],
  ['pelanggan', 'Pelanggan'],
  ['kode_item', 'Kode item (SKU)'],
  ['diskon', 'Baris diskon'],
  ['pajak', 'Baris pajak'],
  ['metode_bayar', 'Metode bayar'],
  ['kembalian', 'Kembalian'],
  ['catatan_kaki', 'Catatan kaki'],
  ['qr', 'Barcode / QR nomor struk'],
];

const KERTAS_OPSI: [string, string][] = [
  ['58mm', 'Thermal 58 mm'],
  ['80mm', 'Thermal 80 mm'],
  ['A4', 'A4 (210 × 297 mm)'],
  ['A5', 'A5 (148 × 210 mm)'],
  ['A6', 'A6 (105 × 148 mm)'],
  ['custom', 'Kustom (lebar × tinggi)'],
];

/** Contoh isi untuk pratinjau langsung. */
function contohStruk(): StrukData {
  return {
    namaUsaha: 'Toko Retail (contoh)',
    alamatUsaha: 'Jl. Merdeka No. 1, Jakarta',
    teleponUsaha: '021-555-0100',
    logoUrl: null,
    noDokumen: 'STR-2026-10-0042',
    tanggal: '09/10/2026 14:30',
    kasir: 'Admin',
    pelanggan: 'Pelanggan Umum',
    items: [
      { nama: 'Kaos Polos Hitam (L) — nama barang panjang harus membungkus baris dengan rapi', kode: 'BRG-0001', qty: 2, harga: 45000, jumlah: 90000 },
      { nama: 'Sepatu Sport Putih (42)', kode: 'BRG-0002', qty: 1, harga: 120000, jumlah: 120000 },
    ],
    subtotal: 210000,
    diskon: 10000,
    pajak: 20000,
    total: 220000,
    bayar: [{ metode: 'tunai', jumlah: 250000 }],
    kembalian: 30000,
    catatan: null,
  };
}

function profilKosong(): ProfilStruk {
  return {
    kertas: '80mm',
    lebar_mm: null,
    tinggi_mm: null,
    margin_atas: 3,
    margin_kanan: 2,
    margin_bawah: 3,
    margin_kiri: 2,
    ukuran_font: 11,
    blok: {},
    teks: { catatan_kaki: 'Terima kasih atas kunjungan Anda' },
  };
}

/**
 * PENGATURAN > STRUK (BAGIAN J4) — hanya Admin yang mengubah.
 * Ukuran kertas (thermal 58/80, A4/A5/A6, kustom + tinggi otomatis), margin,
 * font, blok tampil/sembunyi, teks catatan kaki, pratinjau langsung, beberapa
 * profil dengan satu bawaan, dan opsi "cetak otomatis setelah bayar" (J3).
 */
export function StrukPage() {
  const [daftar, setDaftar] = useState<ProfilStruk[]>([]);
  const [p, setP] = useState<ProfilStruk | null>(null);
  const [tersimpan, setTersimpan] = useState(true);
  const [sibuk, setSibuk] = useState(false);
  const [cetakOtomatis, setCetakOtomatis] = useState(false);
  // AA5 — lembar bawah pratinjau (hanya ponsel <768px).
  const [pratinjauBuka, setPratinjauBuka] = useState(false);
  // Tinggi pratinjau "otomatis" → diukur dari isi iframe (AA4: strip tinggi).
  const [tinggiAuto, setTinggiAuto] = useState(420);
  const frameRef = useRef<HTMLIFrameElement>(null);

  const muat = useCallback(async () => {
    try {
      const r = await apiGet<{ data: ProfilStruk[]; pengaturan: { cetak_otomatis: boolean } }>('/api/struk/profil');
      setDaftar(r.data);
      setCetakOtomatis(Boolean(r.pengaturan?.cetak_otomatis));
      setP((lama) => {
        if (lama?.id && r.data.some((x) => x.id === lama.id)) return r.data.find((x) => x.id === lama.id) ?? lama;
        return lama ?? (r.data.find((x) => x.bawaan) ?? r.data[0] ?? null);
      });
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    }
  }, []);

  useEffect(() => {
    void muat();
  }, [muat]);
  // Tombol Refresh global di topbar: muat ulang daftar profil struk.
  useSegarkanModul(muat);

  const ubah = (patch: Partial<ProfilStruk>) => {
    setP((t) => (t ? { ...t, ...patch } : t));
    setTersimpan(false);
  };

  const simpan = async () => {
    if (!p) return;
    if (!p.nama?.trim()) {
      beritahu('Nama profil wajib diisi.', 'galat');
      return;
    }
    setSibuk(true);
    try {
      if (p.id) {
        const baru = await apiPut<{ data: ProfilStruk }>(`/api/struk/profil/${p.id}`, p);
        setP(baru.data);
        beritahu(`Profil "${baru.data.nama}" diperbarui.`);
      } else {
        const r = await apiPost<{ id: number; data: ProfilStruk }>('/api/struk/profil', p);
        setP(r.data);
        beritahu(`Profil "${r.data.nama}" dibuat.`);
      }
      setTersimpan(true);
      await muat();
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    } finally {
      setSibuk(false);
    }
  };

  // AA6 — Ctrl/Cmd + S menyimpan bila ada perubahan.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        if (p && !tersimpan && !sibuk) {
          e.preventDefault();
          void simpan();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, tersimpan, sibuk]);

  const jadikanBawaan = async () => {
    if (!p?.id) return;
    try {
      await apiPost(`/api/struk/profil/${p.id}/bawaan`, {});
      beritahu(`"${p.nama}" menjadi profil struk bawaan.`);
      await muat();
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    }
  };

  const hapus = async () => {
    if (!p?.id) return;
    try {
      await apiDelete(`/api/struk/profil/${p.id}`);
      setP(null);
      setTersimpan(true);
      await muat();
      beritahu('Profil struk dihapus.');
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    }
  };

  const ubahCetakOtomatis = async (nilai: boolean) => {
    setCetakOtomatis(nilai);
    try {
      await apiPut('/api/struk/pengaturan', { cetak_otomatis: nilai });
      beritahu(nilai ? 'Cetak otomatis setelah bayar aktif.' : 'Cetak otomatis setelah bayar nonaktif.');
    } catch (e) {
      setCetakOtomatis(!nilai);
      beritahu((e as Error).message, 'galat');
    }
  };

  const contoh = useMemo(() => contohStruk(), []);
  const ukur = ukuranStruk(p);
  const lebarPx = Math.round(ukur.lebar * (96 / 25.4));
  const otomatis = ukur.tinggi === 'otomatis';
  const tinggiPx = otomatis ? tinggiAuto : Math.round(Number(ukur.tinggi) * (96 / 25.4));

  /** Tinggi otomatis (AA4): ikuti panjang isi struk — ukur dari iframe. */
  const ukurIsi = () => {
    const d = frameRef.current?.contentDocument;
    const h = d?.body?.scrollHeight ?? 0;
    if (h > 0) setTinggiAuto(Math.min(1600, Math.max(120, Math.round(h))));
  };

  return (
    <div className="halaman">
      <section className="kartu">
        <div className="kartu__kepala kartu__kepala--kompak">
          <div>
            <h3>Ukuran &amp; Tampilan Struk</h3>
            <p className="teks-redup teks-kecil">
              Profil struk untuk kedua mode POS — thermal 58/80 mm, A4/A5/A6, atau kustom; margin, font, blok,
              dan catatan kaki. Hanya Admin yang mengubah.
            </p>
          </div>
          <div className="tombol-baris">
            <button
              type="button"
              className="tombol tombol--netral"
              onClick={() => {
                setP({ ...profilKosong(), nama: 'Profil baru' });
                setTersimpan(false);
              }}
            >
              Profil baru
            </button>
          </div>
        </div>

        {/* AA6 — bilah aksi sticky tepat di bawah header. */}
        <div className="alat-tabel alat-tabel--sticky">
          <select
            className="input-pilih"
            aria-label="Pilih profil struk"
            value={p?.id ?? 0}
            onChange={(e) => {
              const id = Number(e.target.value);
              if (id === 0) {
                setP({ ...profilKosong(), nama: 'Profil baru' });
                setTersimpan(false);
                return;
              }
              setP(daftar.find((x) => x.id === id) ?? null);
              setTersimpan(true);
            }}
          >
            <option value={0}>— Profil baru —</option>
            {daftar.map((x) => (
              <option key={x.id} value={x.id}>
                {x.nama} ({x.kertas}){x.bawaan ? ' ★ bawaan' : ''}
              </option>
            ))}
          </select>
          <button type="button" className="tombol tombol--kecil" onClick={() => void jadikanBawaan()} disabled={!p?.id}>
            Jadikan bawaan
          </button>
          <button
            type="button"
            className="tombol tombol--kecil tombol--bahaya"
            onClick={() => void hapus()}
            disabled={!p?.id || Boolean(p?.bawaan)}
            title={p?.bawaan ? 'Profil bawaan tidak bisa dihapus' : 'Hapus profil'}
          >
            Hapus
          </button>
          {/* AA5 — tombol Pratinjau (ikon mata): hanya ponsel, buka lembar bawah. */}
          <IconButton
            label="Pratinjau"
            ikon="eye"
            ukuran="toolbar"
            classNameWadah="pratinjau-buka-hp"
            onClick={() => setPratinjauBuka(true)}
          />
          <span className="alat-tabel__kanan">
            {!tersimpan && (
              <span className="teks-redup teks-kecil alat-tabel__status">belum disimpan</span>
            )}
            <button
              type="button"
              className="tombol tombol--primer"
              onClick={() => void simpan()}
              disabled={sibuk || tersimpan}
              title="Simpan perubahan (Ctrl+S)"
            >
              {sibuk ? 'Menyimpan…' : 'Simpan perubahan'}
            </button>
          </span>
        </div>

        {p && (
          <div className="editor-grid">
            {/* --- Panel pengaturan --- */}
            <div className="editor-panel">
              <label className="bidang">
                <span>Nama profil</span>
                <input type="text" value={p.nama ?? ''} onChange={(e) => ubah({ nama: e.target.value })} />
              </label>
              <div className="editor-baris">
                <span>Ukuran kertas</span>
                <select value={p.kertas} onChange={(e) => ubah({ kertas: e.target.value })}>
                  {KERTAS_OPSI.map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              {p.kertas === 'custom' && (
                <>
                  <div className="editor-baris">
                    <span>Lebar × tinggi (mm)</span>
                    <input
                      type="number"
                      min={20}
                      max={300}
                      value={p.lebar_mm ?? 80}
                      onChange={(e) => ubah({ lebar_mm: Number(e.target.value) })}
                      aria-label="Lebar"
                    />
                    <span>×</span>
                    <input
                      type="number"
                      min={20}
                      max={2000}
                      disabled={p.tinggi_mm === null}
                      value={p.tinggi_mm ?? ''}
                      placeholder="otomatis"
                      onChange={(e) => ubah({ tinggi_mm: Number(e.target.value) || null })}
                      aria-label="Tinggi"
                    />
                  </div>
                  <div className="editor-baris">
                    <span>Tinggi otomatis</span>
                    <label className="cek-saja">
                      <input
                        type="checkbox"
                        checked={p.tinggi_mm === null}
                        onChange={(e) => ubah({ tinggi_mm: e.target.checked ? null : (p.tinggi_mm ?? 200) })}
                      />
                      Ikuti panjang isi struk
                    </label>
                  </div>
                </>
              )}
              <div className="editor-baris">
                <span>Margin (mm)</span>
                <input type="number" min={0} max={60} value={p.margin_atas} onChange={(e) => ubah({ margin_atas: Number(e.target.value) })} aria-label="Margin atas" title="Atas" />
                <input type="number" min={0} max={60} value={p.margin_kanan} onChange={(e) => ubah({ margin_kanan: Number(e.target.value) })} aria-label="Margin kanan" title="Kanan" />
                <input type="number" min={0} max={60} value={p.margin_bawah} onChange={(e) => ubah({ margin_bawah: Number(e.target.value) })} aria-label="Margin bawah" title="Bawah" />
                <input type="number" min={0} max={60} value={p.margin_kiri} onChange={(e) => ubah({ margin_kiri: Number(e.target.value) })} aria-label="Margin kiri" title="Kiri" />
              </div>
              <div className="editor-baris">
                <span>Ukuran font (px)</span>
                <input
                  type="number"
                  min={6}
                  max={24}
                  value={p.ukuran_font}
                  onChange={(e) => ubah({ ukuran_font: Number(e.target.value) })}
                />
              </div>

              <h4>Tampilan blok</h4>
              <div className="editor-blok">
                {BLOK_LABEL.map(([k, label]) => (
                  <label key={k}>
                    <input
                      type="checkbox"
                      checked={p.blok?.[k] === undefined ? true : Boolean(p.blok[k])}
                      onChange={(e) => ubah({ blok: { ...p.blok, [k]: e.target.checked } })}
                    />
                    {label}
                  </label>
                ))}
              </div>

              <h4>Teks catatan kaki</h4>
              <label className="bidang">
                <span>Catatan kaki</span>
                <input
                  type="text"
                  value={p.teks?.['catatan_kaki'] ?? ''}
                  onChange={(e) => ubah({ teks: { ...p.teks, catatan_kaki: e.target.value } })}
                />
              </label>

              <h4>Perlakuan cetak</h4>
              <div className="editor-blok">
                <label>
                  <input type="checkbox" checked={cetakOtomatis} onChange={(e) => void ubahCetakOtomatis(e.target.checked)} />
                  Cetak otomatis setelah bayar (POS)
                </label>
              </div>
              <p className="teks-redup teks-kecil">
                Berlaku untuk kedua mode POS. Kasir non-admin hanya memakai profil ini tanpa bisa mengubah isinya.
              </p>
            </div>

            {/* --- Pratinjau langsung (AA1/AA2: fit-to-container, terpusat) --- */}
            <div className={`kolom-pratinjau ${pratinjauBuka ? 'kolom-pratinjau--buka' : ''}`}>
              <div className="kolom-pratinjau__kepala">
                <p className="teks-redup teks-kecil" style={{ margin: 0 }}>
                  Pratinjau {ukur.lebar} mm{otomatis ? ' (tinggi otomatis)' : ` × ${ukur.tinggi} mm`} ·
                  margin {p.margin_atas}/{p.margin_kanan}/{p.margin_bawah}/{p.margin_kiri} mm · font {p.ukuran_font}px
                  {p.id ? '' : ' (contoh data)'}
                </p>
                <span className="tutup-pratinjau">
                  <IconButton
                    label="Tutup pratinjau"
                    ikon="close"
                    ukuran="baris"
                    onClick={() => setPratinjauBuka(false)}
                  />
                </span>
              </div>
              <PratinjauKertas
                lebarMm={ukur.lebar}
                tinggiMm={otomatis ? null : Number(ukur.tinggi)}
              >
                <iframe
                  ref={frameRef}
                  title="Pratinjau struk"
                  srcDoc={pratinjauStruk(contoh, p)}
                  onLoad={ukurIsi}
                  style={{
                    width: lebarPx,
                    height: tinggiPx,
                    border: 0,
                    display: 'block',
                    background: '#fff',
                  }}
                />
              </PratinjauKertas>
              <p className="teks-redup teks-kecil">
                Pratinjau memakai data contoh ({formatRupiah(contoh.total)}). Ukuran baris nama barang membungkus
                otomatis; kolom qty × harga dan subtotal tetap sejajar.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* Profil tersimpan — ringkas cepat */}
      <section className="kartu">
        <div className="kartu__kepala kartu__kepala--kompak">
          <div>
            <h3>Daftar Profil</h3>
            <p className="teks-redup teks-kecil">
              Satu profil bawaan (★) dipakai otomatis; kasir boleh memilih profil lain saat mencetak tanpa
              mengubah isinya.
            </p>
          </div>
          <IconButton label="Muat ulang daftar profil" ikon="rotate-ccw" ukuran="toolbar" onClick={() => void muat()} />
        </div>
        <table className="tabel">
          <thead>
            <tr>
              <th>Nama</th>
              <th>Ukuran</th>
              <th>Margin (mm)</th>
              <th>Font</th>
              <th>Blok aktif</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {daftar.length === 0 && (
              <tr>
                <td colSpan={6} className="teks-redup">
                  Belum ada profil — profil bawaan dibuat otomatis saat server pertama kali dijalankan.
                </td>
              </tr>
            )}
            {daftar.map((x) => {
              const u = ukuranStruk(x);
              const aktif = Object.entries(x.blok ?? {}).filter(([, v]) => v).length;
              return (
                <tr key={x.id}>
                  <td>
                    <button type="button" className="tautan-kecil" onClick={() => { setP(x); setTersimpan(true); }}>
                      {x.nama}
                    </button>
                  </td>
                  <td>
                    {u.lebar} mm{u.tinggi === 'otomatis' ? ' × auto' : ` × ${u.tinggi} mm`}
                  </td>
                  <td>
                    {x.margin_atas}/{x.margin_kanan}/{x.margin_bawah}/{x.margin_kiri}
                  </td>
                  <td>{x.ukuran_font}px</td>
                  <td>{aktif} / {BLOK_LABEL.length}</td>
                  <td>{x.bawaan ? <span className="lencana lencana--aktif">★ Bawaan</span> : <span className="teks-redup">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

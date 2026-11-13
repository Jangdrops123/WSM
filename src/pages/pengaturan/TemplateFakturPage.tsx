import { useCallback, useEffect, useState } from 'react';
import { IconButton } from '../../components/IconButton';
import { beritahu } from '../../components/crud/Toast';
import { apiDelete, apiGet, apiPost, apiPut } from '../../lib/api';
import { segarkanUsaha } from '../../lib/usaha';
import { useSegarkanModul } from '../../lib/segarkan';
import { PratinjauFaktur } from '../faktur/FakturDokumen';
import {
  KERTAS,
  LABEL_KOLOM,
  SEMUA_KOLOM,
  kolomAktifTabel,
  lebarKolomPersen,
  rupiah,
  tanggalPanjang,
  ukuranKertas,
  type AturKolom,
  type FakturDTO,
  type IsiFaktur,
  type JenisTemplate,
  type TemplateFaktur,
} from '../faktur/tipe';
import './pengaturan.css';

/** Contoh isi untuk pratinjau langsung di editor — mengikuti jenis dokumen (K5). */
function contohIsi(
  namaToko: string,
  alamat: string | null,
  jenis: JenisTemplate,
): { faktur: FakturDTO; isi: IsiFaktur } {
  const hari = new Date().toISOString();
  // Pembelian: data contoh memakai pemasok + harga beli. Penjualan: pelanggan
  // + harga jual. Surat Jalan: tanpa kolom harga (filter ada di renderer).
  const pembelian = jenis === 'pembelian';
  const suratJalan = jenis === 'surat_jalan';
  const items: IsiFaktur['items'] = pembelian
    ? [
        { kode: 'BRG-0001', nama: 'Kaos Polos Hitam (L)', qty: 12, satuan: 'Psg', harga: 28000, diskon: 0, subtotal: 336000 },
        { kode: 'BRG-0002', nama: 'Sepatu Sport Putih (42)', qty: 4, satuan: 'Psg', harga: 85000, diskon: 5000, subtotal: 335000 },
        { kode: 'BRG-0003', nama: 'Kemeja Flanel Merah (M)', qty: 10, satuan: 'Pcs', harga: 52000, diskon: 0, subtotal: 520000 },
      ]
    : [
        { kode: 'BRG-0001', nama: 'Kaos Polos Hitam (L)', qty: 12, satuan: 'Psg', harga: 45000, diskon: 0, subtotal: 540000 },
        { kode: 'BRG-0002', nama: 'Sepatu Sport Putih (42)', qty: 4, satuan: 'Psg', harga: 120000, diskon: 5000, subtotal: 475000 },
        { kode: 'BRG-0003', nama: 'Kemeja Flanel Merah (M)', qty: 10, satuan: 'Pcs', harga: 78000, diskon: 0, subtotal: 780000 },
      ];
  const subtotal = items.reduce((n, i) => n + i.subtotal, 0);
  const total = subtotal;
  const pihak = pembelian
    ? { nama: 'PT Contoh Pemasok', telepon: '021-5550100', alamat: 'Jl. Industri No. 8, Tangerang' }
    : { nama: 'Pelanggan Contoh', telepon: '08123456789', alamat: 'Jl. Merdeka No. 1, Jakarta' };
  const noDokumen = suratJalan
    ? 'SJ-2026-10-0001'
    : pembelian
      ? 'PB-2026-0001'
      : 'INV-2026-0001';
  return {
    faktur: {
      id: 1,
      no_faktur: noDokumen,
      // Surat Jalan memakai jenis penjualan untuk label "Penerima".
      jenis: pembelian ? 'pembelian' : 'penjualan',
      tanggal: hari,
      status: 'terbit',
      pihak,
      subtotal,
      diskon: 0,
      pajak_persen: 0,
      pajak: 0,
      total,
      terbilang: suratJalan
        ? null
        : pembelian
          ? 'satu juta seribu lima ratus lima puluh ribu rupiah'
          : 'dua juta tiga ratus sembilan puluh lima ribu rupiah',
      catatan: null,
      sumber_tipe: pembelian ? 'pembelian' : 'penjualan',
      sumber_id: 1,
      no_sumber: suratJalan ? 'SJ-2026-10-0001' : pembelian ? 'PB-2026-10-0001' : 'SJ-2026-10-0001',
    },
    isi: {
      toko: { nama: namaToko || 'Toko Retail', alamat, telepon: '021-555-0100', logo: null },
      pihak,
      sumber: { gudang: 'Gudang Pusat', kasir: 'Admin' },
      items,
      no_dokumen: noDokumen,
    },
  };
}

const BLOK_LABEL: [string, string][] = [
  ['logo', 'Logo'],
  ['alamat', 'Alamat toko'],
  ['telepon', 'Telepon toko'],
  ['nomor', 'Nomor & tanggal'],
  ['pihak', 'Pelanggan / pemasok'],
  ['gudang', 'Gudang / kasir'],
  ['kolom_kode', 'Kolom kode'],
  ['kolom_satuan', 'Kolom satuan'],
  ['kolom_diskon', 'Kolom diskon'],
  ['total_qty', 'Ringkasan Total Qty'],
  ['terbilang', 'Terbilang'],
  ['tanda_tangan', 'Tanda tangan'],
  ['catatan', 'Catatan'],
  ['rekening', 'Rekening bank'],
];

/**
 * BAGIAN AA7 — tundaan 100 ms: pratinjau diperbarui real-time saat
 * pengaturan berubah tanpa me-render tiap ketikan (posisi scroll & skala
 * tetap because instance pratinjau tidak berganti).
 */
function useTunda<T>(nilai: T, ms = 100): T {
  const [tunda, setTunda] = useState(nilai);
  useEffect(() => {
    const id = window.setTimeout(() => setTunda(nilai), ms);
    return () => window.clearTimeout(id);
  }, [nilai, ms]);
  return tunda;
}

function templateKosong(): TemplateFaktur {
  return {
    id: 0,
    nama: 'Template baru',
    jenis: 'penjualan',
    bawaan: false,
    kertas: 'A4',
    orientasi: 'portrait',
    lebar_mm: null,
    tinggi_mm: null,
    margin_atas: 12,
    margin_kanan: 12,
    margin_bawah: 12,
    margin_kiri: 12,
    skala: 100,
    ukuran_font: 10,
    aksen: '#2563eb',
    blok: {},
    urutan_kolom: ['kode', 'nama', 'qty', 'satuan', 'harga', 'diskon', 'subtotal'],
    teks: { judul: 'FAKTUR', catatan_kaki: 'Terima kasih atas kunjungan Anda.', catatan: '', rekening: '' },
    pengaturan_kolom: {},
    singkat_kolom: 'auto',
  };
}

/**
 * PENGATURAN > TEMPLATE FAKTUR (BAGIAN I2 + I3).
 *
 * Editor visual dengan pratinjau langsung: tampil/sembunyi blok, urutan
 * kolom, ukuran font, warna aksen, teks tetap, serta ukuran kertas bebas
 * (A4–A6, Letter, Legal, struk 58/80 mm, setengah A4, kustom + orientasi),
 * margin, dan skala isi. Beberapa template bisa disimpan, satu menjadi
 * bawaan per jenis dokumen.
 */
export function TemplateFakturPage() {
  const [daftar, setDaftar] = useState<TemplateFaktur[]>([]);
  const [tpl, setTpl] = useState<TemplateFaktur | null>(null);
  const [satuanCustom, setSatuanCustom] = useState<'mm' | 'cm'>('mm');
  const [pengaturan, setPengaturan] = useState<Record<string, string>>({});
  const [sibuk, setSibuk] = useState(false);
  const [tersimpan, setTersimpan] = useState(true);
  // AA5 — lembar bawah pratinjau (hanya ponsel <768px).
  const [pratinjauBuka, setPratinjauBuka] = useState(false);

  const muat = useCallback(async () => {
    try {
      const [r, p] = await Promise.all([
        apiGet<{ data: TemplateFaktur[] }>('/api/faktur/template'),
        apiGet<{ pengaturan: Record<string, string> }>('/api/faktur/pengaturan'),
      ]);
      setDaftar(r.data);
      setPengaturan(p.pengaturan);
      setTpl((lama) => {
        if (lama && r.data.some((t) => t.id === lama.id)) {
          return r.data.find((t) => t.id === lama.id) ?? lama;
        }
        return lama ?? (r.data.find((t) => t.bawaan) ?? r.data[0] ?? null);
      });
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    }
  }, []);

  useEffect(() => {
    void muat();
  }, [muat]);
  // Tombol Refresh global di topbar: muat ulang template & pengaturan faktur.
  useSegarkanModul(muat);

  const ubah = (patch: Partial<TemplateFaktur>) => {
    setTpl((t) => (t ? { ...t, ...patch } : t));
    setTersimpan(false);
  };

  const simpan = async () => {
    if (!tpl) return;
    if (!tpl.nama.trim()) {
      beritahu('Nama template wajib diisi.', 'galat');
      return;
    }
    setSibuk(true);
    try {
      if (tpl.id) {
        const baru = await apiPut<TemplateFaktur>(`/api/faktur/template/${tpl.id}`, tpl);
        setTpl(baru);
        beritahu(`Template "${baru.nama}" diperbarui.`);
      } else {
        const r = await apiPost<{ id: number }>('/api/faktur/template', tpl);
        setTpl({ ...tpl, id: r.id });
        beritahu(`Template "${tpl.nama}" dibuat.`);
      }
      setTersimpan(true);
      await muat();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibuk(false);
    }
  };

  // AA6 — Ctrl/Cmd + S menyimpan bila ada perubahan (tombol Simpan juga
  // hanya aktif bila belum disimpan).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        if (tpl && !tersimpan && !sibuk) {
          e.preventDefault();
          void simpan();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // simpan dibaca lewat cangkang render yang sama dengan dependensi di
    // bawah (tpl/tersimpan/sibuk) — listener cukup dibuang saat itu berubah.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tpl, tersimpan, sibuk]);

  const jadikanBawaan = async () => {
    if (!tpl?.id) return;
    try {
      await apiPost(`/api/faktur/template/${tpl.id}/bawaan`, {});
      beritahu(`"${tpl.nama}" menjadi template bawaan untuk ${tpl.jenis}.`);
      await muat();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    }
  };

  const hapus = async () => {
    if (!tpl?.id) return;
    try {
      await apiDelete(`/api/faktur/template/${tpl.id}`);
      setTpl(null);
      setTersimpan(true);
      await muat();
      beritahu('Template dihapus.');
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    }
  };

  const simpanPengaturan = async () => {
    try {
      await apiPut('/api/faktur/pengaturan', pengaturan);
      // Nama/alamat/telepon toko langsung berlaku di kasir, struk & laporan.
      void segarkanUsaha().catch(() => undefined);
      beritahu('Pengaturan toko & nomor faktur disimpan.');
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    }
  };

  const geserKolom = (idx: number, arah: -1 | 1) => {
    if (!tpl) return;
    const urut = [...tpl.urutan_kolom];
    const tujuan = idx + arah;
    if (tujuan < 0 || tujuan >= urut.length) return;
    [urut[idx], urut[tujuan]] = [urut[tujuan], urut[idx]];
    ubah({ urutan_kolom: urut });
  };

  /** Perbarui pengaturan satu kolom (nama ganti / lebar / rata) — K4. */
  const ubahKolom = (kunci: string, patch: Partial<AturKolom>) => {
    if (!tpl) return;
    const lama = tpl.pengaturan_kolom?.[kunci] ?? {};
    const gabung: AturKolom = { ...lama, ...patch };
    // Buang bagian kosong agar JSON bersih.
    if (!gabung.nama?.trim()) delete gabung.nama;
    if (gabung.lebar == null || !(gabung.lebar > 0)) {
      delete gabung.lebar;
      delete gabung.satuan_lebar;
    }
    if (!gabung.rata) delete gabung.rata;
    ubah({
      pengaturan_kolom: {
        ...(tpl.pengaturan_kolom ?? {}),
        [kunci]: gabung,
      },
    });
  };

  /** Kembalikan semua kolom ke hitungan otomatis K2. */
  const aturLebarOtomatis = () => ubah({ pengaturan_kolom: {} });

  // AA7 — nilai template tertunda 100 ms untuk pratinjau (real-time tanpa
  // render tiap ketikan; instance pratinjau tetap → scroll & skala bertahan).
  const tplTunda = useTunda(tpl);

  const contoh = contohIsi(
    pengaturan['nama_usaha'] ?? '',
    pengaturan['alamat_usaha'] || null,
    tplTunda?.jenis ?? tpl?.jenis ?? 'penjualan',
  );
  // Peringatan lebar melebihi kertas (K4) — dihitung dari kolom efektif.
  const kolomContoh = kolomAktifTabel(tpl);
  const ukuranTpl = ukuranKertas(tpl);
  const lebarKontenMm = Math.max(
    20,
    ukuranTpl.lebar - (tpl?.margin_kiri ?? 12) - (tpl?.margin_kanan ?? 12),
  );
  const { totalTetap, melebihi } = lebarKolomPersen(
    tpl,
    kolomContoh,
    lebarKontenMm / Math.max(0.5, Math.min(2, (tpl?.skala ?? 100) / 100)),
    contoh.isi.items.length,
  );
  const nilaiCustom = (mm: number | null, arah: 'dari' | 'ke'): number => {
    const v = Number(mm ?? 0);
    if (satuanCustom === 'mm') return Math.round(v * 10) / 10;
    return arah === 'ke' ? Math.round(v * 10) / 10 : Math.round(v * 10 * 10) / 10;
  };

  return (
    <div className="halaman">
      <section className="kartu">
        <div className="kartu__kepala kartu__kepala--kompak">
          <div>
            <h3>Template Faktur</h3>
            <p className="teks-redup teks-kecil">
              Editor visual dengan pratinjau langsung — blok, urutan kolom, font, warna aksen, teks tetap,
              ukuran kertas, margin, dan skala isi. Satu template bawaan per jenis dokumen.
            </p>
          </div>
          <div className="tombol-baris">
            <button
              type="button"
              className="tombol tombol--netral"
              onClick={() => {
                setTpl(templateKosong());
                setTersimpan(false);
              }}
            >
              Template baru
            </button>
          </div>
        </div>

        {/* AA6 — bilah aksi sticky tepat di bawah header: pilih template,
            Jadikan bawaan, Hapus, status "belum disimpan", Simpan perubahan
            selalu terlihat penuh (tidak tertutup header saat menggulir). */}
        <div className="alat-tabel alat-tabel--sticky">
          <select
            className="input-pilih"
            aria-label="Pilih template"
            value={tpl?.id ?? 0}
            onChange={(e) => {
              const id = Number(e.target.value);
              if (id === 0) {
                setTpl(templateKosong());
                setTersimpan(false);
                return;
              }
              setTpl(daftar.find((t) => t.id === id) ?? null);
              setTersimpan(true);
            }}
          >
            <option value={0}>— Template baru —</option>
            {daftar.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nama} ({t.jenis}){t.bawaan ? ' ★ bawaan' : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="tombol tombol--kecil"
            onClick={() => void jadikanBawaan()}
            disabled={!tpl?.id}
          >
            Jadikan bawaan
          </button>
          <button
            type="button"
            className="tombol tombol--kecil tombol--bahaya"
            onClick={() => void hapus()}
            disabled={!tpl?.id || Boolean(tpl?.bawaan)}
            title={tpl?.bawaan ? 'Template bawaan tidak bisa dihapus' : 'Hapus template'}
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

        {tpl && (
          <div className="editor-grid">
            {/* --- Panel pengaturan --- */}
            <div className="editor-panel">
              <label className="bidang">
                <span>Nama template</span>
                <input type="text" value={tpl.nama} onChange={(e) => ubah({ nama: e.target.value })} />
              </label>
              <div className="editor-baris">
                <span>Jenis dokumen</span>
                <select value={tpl.jenis} onChange={(e) => ubah({ jenis: e.target.value as TemplateFaktur['jenis'] })}>
                  <option value="penjualan">Penjualan</option>
                  <option value="pembelian">Pembelian</option>
                  <option value="surat_jalan">Surat Jalan</option>
                </select>
              </div>

              <h4>Ukuran kertas &amp; tata letak</h4>
              <div className="editor-baris">
                <span>Ukuran kertas</span>
                <select value={tpl.kertas} onChange={(e) => ubah({ kertas: e.target.value })}>
                  {Object.entries(KERTAS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="editor-baris">
                <span>Orientasi</span>
                <select
                  value={tpl.orientasi}
                  onChange={(e) => ubah({ orientasi: e.target.value as 'portrait' | 'landscape' })}
                >
                  <option value="portrait">Potret (berdiri)</option>
                  <option value="landscape">Lanskap (tidur)</option>
                </select>
              </div>
              {tpl.kertas === 'custom' && (
                <>
                  <div className="editor-baris">
                    <span>Satuan</span>
                    <select value={satuanCustom} onChange={(e) => setSatuanCustom(e.target.value as 'mm' | 'cm')}>
                      <option value="mm">Milimeter (mm)</option>
                      <option value="cm">Sentimeter (cm)</option>
                    </select>
                  </div>
                  <div className="editor-baris">
                    <span>Lebar × tinggi</span>
                    <input
                      type="number"
                      min={satuanCustom === 'mm' ? 20 : 2}
                      step="any"
                      value={nilaiCustom(tpl.lebar_mm ?? 210, 'dari')}
                      onChange={(e) =>
                        ubah({ lebar_mm: satuanCustom === 'mm' ? Number(e.target.value) : Number(e.target.value) * 10 })
                      }
                      aria-label="Lebar"
                    />
                    <span>×</span>
                    <input
                      type="number"
                      min={satuanCustom === 'mm' ? 20 : 2}
                      step="any"
                      value={nilaiCustom(tpl.tinggi_mm ?? 297, 'dari')}
                      onChange={(e) =>
                        ubah({ tinggi_mm: satuanCustom === 'mm' ? Number(e.target.value) : Number(e.target.value) * 10 })
                      }
                      aria-label="Tinggi"
                    />
                  </div>
                </>
              )}
              <div className="editor-baris">
                <span>Margin (mm)</span>
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={tpl.margin_atas}
                  onChange={(e) => ubah({ margin_atas: Number(e.target.value) })}
                  aria-label="Margin atas"
                  title="Atas"
                />
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={tpl.margin_kanan}
                  onChange={(e) => ubah({ margin_kanan: Number(e.target.value) })}
                  aria-label="Margin kanan"
                  title="Kanan"
                />
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={tpl.margin_bawah}
                  onChange={(e) => ubah({ margin_bawah: Number(e.target.value) })}
                  aria-label="Margin bawah"
                  title="Bawah"
                />
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={tpl.margin_kiri}
                  onChange={(e) => ubah({ margin_kiri: Number(e.target.value) })}
                  aria-label="Margin kiri"
                  title="Kiri"
                />
              </div>
              <div className="editor-baris">
                <span>Skala isi (%)</span>
                <input
                  type="number"
                  min={50}
                  max={200}
                  value={tpl.skala}
                  onChange={(e) => ubah({ skala: Number(e.target.value) })}
                />
              </div>
              <div className="editor-baris">
                <span>Ukuran font (pt)</span>
                <input
                  type="number"
                  min={6}
                  max={20}
                  value={tpl.ukuran_font}
                  onChange={(e) => ubah({ ukuran_font: Number(e.target.value) })}
                />
              </div>
              <div className="editor-baris">
                <span>Warna aksen</span>
                <input
                  type="color"
                  value={tpl.aksen}
                  onChange={(e) => ubah({ aksen: e.target.value })}
                  aria-label="Warna aksen"
                />
                <input
                  type="text"
                  value={tpl.aksen}
                  onChange={(e) => ubah({ aksen: e.target.value })}
                  aria-label="Kode warna aksen"
                />
              </div>

              <h4>Tampilan blok</h4>
              <div className="editor-blok">
                {BLOK_LABEL.map(([k, label]) => (
                  <label key={k}>
                    <input
                      type="checkbox"
                      checked={tpl.blok[k] === undefined ? !['rekening'].includes(k) : Boolean(tpl.blok[k])}
                      onChange={(e) => ubah({ blok: { ...tpl.blok, [k]: e.target.checked } })}
                    />
                    {label}
                  </label>
                ))}
              </div>

              <h4>Urutan kolom tabel</h4>
              <p className="teks-redup teks-kecil" style={{ margin: 0 }}>
                Nama kolom bisa diganti; lebar Otomatis mengikuti hitungan K2 (kolom Nama Barang
                menyerap sisa). Peringatan muncul bila total lebar melebihi kertas.
              </p>
              <label className="editor-baris">
                <span>Nama kolom singkat</span>
                <select
                  value={tpl.singkat_kolom ?? 'auto'}
                  onChange={(e) => ubah({ singkat_kolom: e.target.value as TemplateFaktur['singkat_kolom'] })}
                  title="Kertas sempit (A6/termal) memakai singkatan agar nama kolom tidak terpecah"
                >
                  <option value="auto">Otomatis (kertas sempit → singkat)</option>
                  <option value="ya">Selalu singkat</option>
                  <option value="tidak">Selalu penuh</option>
                </select>
              </label>
              <div className="kolom-urut">
                <div className="kolom-urut__baris kolom-urut__baris--kepala">
                  <span>Kolom aktif</span>
                  <IconButton
                    label="Atur lebar otomatis (kembalikan ke hitungan K2)"
                    ikon="rotate-ccw"
                    onClick={aturLebarOtomatis}
                  />
                </div>
                {tpl.urutan_kolom.map((k, i) => {
                  const atur = tpl.pengaturan_kolom?.[k] ?? {};
                  return (
                    <div className="kolom-urut__baris kolom-urut__baris--atur" key={k}>
                      <div className="kolom-urut__nama">
                        <span title={LABEL_KOLOM[k]}>{LABEL_KOLOM[k]}</span>
                        <IconButton label={`Naikkan ${LABEL_KOLOM[k]}`} ikon="chevron-up" onClick={() => geserKolom(i, -1)} />
                        <IconButton
                          label={`Turunkan ${LABEL_KOLOM[k]}`}
                          ikon="chevron-down"
                          onClick={() => geserKolom(i, 1)}
                        />
                      </div>
                      <label className="kolom-urut__field">
                        <span>Nama</span>
                        <input
                          type="text"
                          placeholder={LABEL_KOLOM[k]}
                          value={atur.nama ?? ''}
                          onChange={(e) => ubahKolom(k, { nama: e.target.value })}
                        />
                      </label>
                      <label className="kolom-urut__field">
                        <span>Lebar</span>
                        <select
                          value={atur.lebar != null ? (atur.satuan_lebar ?? '%') : 'auto'}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === 'auto') ubahKolom(k, { lebar: null });
                            else ubahKolom(k, { satuan_lebar: v as '%' | 'mm', lebar: atur.lebar ?? 20 });
                          }}
                        >
                          <option value="auto">Otomatis</option>
                          <option value="%">%</option>
                          <option value="mm">mm</option>
                        </select>
                        {atur.lebar != null && (
                          <input
                            type="number"
                            min={1}
                            max={atur.satuan_lebar === 'mm' ? 200 : 100}
                            value={atur.lebar}
                            aria-label={`Lebar ${LABEL_KOLOM[k]}`}
                            onChange={(e) => ubahKolom(k, { lebar: Number(e.target.value) })}
                          />
                        )}
                      </label>
                      <label className="kolom-urut__field">
                        <span>Rata</span>
                        <select
                          value={atur.rata ?? ''}
                          onChange={(e) => ubahKolom(k, { rata: (e.target.value || undefined) as AturKolom['rata'] })}
                        >
                          <option value="">Otomatis</option>
                          <option value="kiri">Kiri</option>
                          <option value="tengah">Tengah</option>
                          <option value="kanan">Kanan</option>
                        </select>
                      </label>
                    </div>
                  );
                })}
                {SEMUA_KOLOM.filter((k) => !tpl.urutan_kolom.includes(k)).map((k) => (
                  <div className="kolom-urut__baris kolom-urut__baris--redup" key={k}>
                    <span>{LABEL_KOLOM[k]}</span>
                    <IconButton
                      label={`Tambahkan ${LABEL_KOLOM[k]}`}
                      ikon="plus"
                      onClick={() => ubah({ urutan_kolom: [...tpl.urutan_kolom, k] })}
                    />
                  </div>
                ))}
                {melebihi && (
                  <p className="kolom-urut__peringatan" role="status">
                    Total lebar kolom {totalTetap.toFixed(0)}% melebihi lebar kertas —
                    kurangi lebar kolom atau pilih Otomatis.
                  </p>
                )}
              </div>

              <h4>Teks tetap</h4>
              <label className="bidang">
                <span>Judul dokumen</span>
                <input
                  type="text"
                  value={tpl.teks['judul'] ?? ''}
                  onChange={(e) => ubah({ teks: { ...tpl.teks, judul: e.target.value } })}
                />
              </label>
              <label className="bidang">
                <span>Catatan kaki</span>
                <input
                  type="text"
                  value={tpl.teks['catatan_kaki'] ?? ''}
                  onChange={(e) => ubah({ teks: { ...tpl.teks, catatan_kaki: e.target.value } })}
                />
              </label>
              <label className="bidang">
                <span>Rekening bank</span>
                <input
                  type="text"
                  value={tpl.teks['rekening'] ?? ''}
                  placeholder="mis. BCA 1234567890 a.n. …"
                  onChange={(e) => ubah({ teks: { ...tpl.teks, rekening: e.target.value } })}
                />
              </label>
              <label className="bidang">
                <span>Catatan</span>
                <input
                  type="text"
                  value={tpl.teks['catatan'] ?? ''}
                  onChange={(e) => ubah({ teks: { ...tpl.teks, catatan: e.target.value } })}
                />
              </label>
            </div>

            {/* --- Pratinjau langsung (AA1/AA2/AA5: kolom kanan, sticky,
                 lembar bawah pada ponsel) --- */}
            <div
              className={`kolom-pratinjau ${pratinjauBuka ? 'kolom-pratinjau--buka' : ''}`}
            >
              <div className="kolom-pratinjau__kepala">
                <p className="teks-redup teks-kecil" style={{ margin: 0 }}>
                  Pratinjau {KERTAS[tplTunda?.kertas ?? tpl.kertas]?.label ?? tplTunda?.kertas ?? tpl.kertas} ·{' '}
                  {(tplTunda ?? tpl).orientasi === 'portrait' ? 'potret' : 'lanskap'} · margin{' '}
                  {(tplTunda ?? tpl).margin_atas}/{(tplTunda ?? tpl).margin_kanan}/
                  {(tplTunda ?? tpl).margin_bawah}/{(tplTunda ?? tpl).margin_kiri} mm · skala{' '}
                  {(tplTunda ?? tpl).skala}% · font {(tplTunda ?? tpl).ukuran_font}pt
                  {tpl.id ? '' : ' (contoh data)'}
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
              <PratinjauFaktur
                faktur={contoh.faktur}
                isi={contoh.isi}
                template={{ ...(tplTunda ?? tpl), nama: tpl.nama || 'Tanpa nama' }}
              />
              <p className="teks-redup teks-kecil">
                Pratinjau memakai data contoh ({rupiah(contoh.faktur.total)},{' '}
                {tanggalPanjang(contoh.faktur.tanggal)}).
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="kartu">
        <div className="kartu__kepala kartu__kepala--kompak">
          <div>
            <h3>Identitas toko &amp; nomor faktur</h3>
            <p className="teks-redup teks-kecil">
              Dipakai pada kop faktur dan penomoran otomatis (mis. INV-2026-0001 &amp; PB-2026-0001).
            </p>
          </div>
          <button type="button" className="tombol tombol--primer" onClick={() => void simpanPengaturan()}>
            Simpan
          </button>
        </div>
        <div className="form-grid">
          <label className="bidang">
            <span>Nama usaha</span>
            <input
              type="text"
              value={pengaturan['nama_usaha'] ?? ''}
              onChange={(e) => setPengaturan({ ...pengaturan, nama_usaha: e.target.value })}
            />
          </label>
          <label className="bidang">
            <span>Telepon</span>
            <input
              type="text"
              value={pengaturan['telepon_usaha'] ?? ''}
              onChange={(e) => setPengaturan({ ...pengaturan, telepon_usaha: e.target.value })}
            />
          </label>
          <label className="bidang">
            <span>Prefix faktur penjualan</span>
            <input
              type="text"
              maxLength={12}
              value={pengaturan['faktur_prefix_penjualan'] ?? 'INV'}
              onChange={(e) => setPengaturan({ ...pengaturan, faktur_prefix_penjualan: e.target.value })}
            />
          </label>
          <label className="bidang">
            <span>Prefix faktur pembelian</span>
            <input
              type="text"
              maxLength={12}
              value={pengaturan['faktur_prefix_pembelian'] ?? 'PB'}
              onChange={(e) => setPengaturan({ ...pengaturan, faktur_prefix_pembelian: e.target.value })}
            />
          </label>
          <label className="bidang bidang--dua">
            <span>Alamat usaha</span>
            <input
              type="text"
              value={pengaturan['alamat_usaha'] ?? ''}
              onChange={(e) => setPengaturan({ ...pengaturan, alamat_usaha: e.target.value })}
            />
          </label>
          <label className="bidang bidang--dua">
            <span>URL logo (opsional)</span>
            <input
              type="text"
              value={pengaturan['logo_usaha'] ?? ''}
              placeholder="/uploads/logo.png"
              onChange={(e) => setPengaturan({ ...pengaturan, logo_usaha: e.target.value })}
            />
          </label>
        </div>
      </section>
    </div>
  );
}

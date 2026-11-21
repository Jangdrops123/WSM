import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { MenuAksi } from '../../components/MenuAksi';
import { beritahu } from '../../components/crud/Toast';
import { apiGet, apiPost } from '../../lib/api';
import { useSegarkanModul } from '../../lib/segarkan';
import { kompresGambar } from '../../lib/foto';
import { formatAngka, formatRupiah } from '../../lib/format';

// --- Tipe respons ----------------------------------------------------------

export type DetailData = {
  id: number;
  kode_item: string | null;
  nama: string;
  sku: string;
  barcode: string | null;
  deskripsi: string | null;
  foto_url: string | null;
  aktif: number;
  harga_beli: number;
  harga_jual: number;
  stok_min: number;
  dibuat_pada: string;
  diubah_pada: string | null;
  kategori_nama: string | null;
  merek_nama: string | null;
  satuan_dasar_nama: string | null;
  dibuat_oleh_nama: string | null;
  galeri: { sumber: 'produk'; ref_id: number; url: string; label: string }[];
  konversi: {
    product_id: number;
    unit_id: number;
    jumlah_per_satuan_dasar: number;
    unit_kode: string;
    unit_nama: string;
  }[];
  paket: { id: number; kode_box: string; barcode_box: string | null; nama: string; jumlah_produk: number; qty_dalam_paket: number }[];
  ringkasan: { total_stok: number; nilai_stok: number; terjual_30_hari: number; jumlah_gudang: number };
};

type StokData = {
  ringkasan: { total: number; tersedia: number; dipesan: number; minimum: number; jumlah_kurang: number };
  lokasi: { gudang_kode: string; gudang_nama: string; qty: number; total: number; minimum: number }[];
  gudang: { gudang_kode: string; gudang_nama: string; qty: number; total: number; minimum: number }[];
};

type RiwayatBaris = {
  id: number;
  tanggal: string;
  tipe_dokumen: string;
  no_dokumen: string | null;
  qty_masuk: number;
  qty_keluar: number;
  saldo: number;
  sku: string;
  gudang_nama: string;
  kode_lokasi: string;
  pengguna: string | null;
};

// --- Cache (membuka produk sama tidak mengulang permintaan) ----------------

const CACHE = new Map<number, DetailData>();
const CACHE_KODE = new Map<string, number>();
const CACHE_STOK = new Map<number, StokData>();
const CACHE_RIWAYAT = new Map<number, RiwayatBaris[]>();
/** Kunci yang sedang berjalan — mencegah permintaan dobel (StrictMode mount ganda). */
const IN_FLIGHT = new Set<string>();

/** Buang cache satu produk (atau semua) setelah perubahan data. */
export function resetCacheDetail(id?: number): void {
  if (id === undefined) {
    CACHE.clear();
    CACHE_KODE.clear();
    CACHE_STOK.clear();
    CACHE_RIWAYAT.clear();
    return;
  }
  CACHE.delete(id);
  CACHE_STOK.delete(id);
  CACHE_RIWAYAT.delete(id);
  for (const [kode, nilai] of CACHE_KODE) if (nilai === id) CACHE_KODE.delete(kode);
}

const TAB = ['info', 'stok', 'harga', 'riwayat'] as const;
type Tab = (typeof TAB)[number];

const tanggalPendek = (s: unknown) => (s ? String(s).replace('T', ' ').slice(0, 16) : '—');

function Rangka() {
  return (
    <div className="rangka-bungkus" aria-hidden="true">
      <div className="rangka rangka--baris" />
      <div className="rangka rangka--baris" />
      <div className="rangka rangka--baris" />
      <div className="rangka rangka--baris pendek" />
    </div>
  );
}

export function DetailProduk({
  kode,
  daftar,
  sinyal,
  onTutup,
  onGanti,
  onUbah,
  onNonaktif,
  onHapus,
  onCetak,
  onBerubah,
}: {
  /** Kode item produk yang sedang dibuka (dari URL ?produk= atau klik baris). */
  kode: string;
  /** Urutan daftar di tabel untuk navigasi Sebelumnya/Berikutnya. */
  daftar: { id: number; kode_item?: string | null; nama?: string }[];
  /** Naik setiap data berubah di halaman induk → pop up muat ulang. */
  sinyal: number;
  onTutup: () => void;
  onGanti: (kode: string) => void;
  onUbah: (baris: Record<string, unknown>) => void;
  onNonaktif: (baris: Record<string, unknown>) => void;
  onHapus: (baris: Record<string, unknown>) => void;
  onCetak: (id: number) => void;
  onBerubah: () => void;
}) {
  const navigate = useNavigate();
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [memuat, setMemuat] = useState(true);
  const [tab, setTab] = useState<Tab>('info');
  const [stok, setStok] = useState<StokData | null>(null);
  const [memuatStok, setMemuatStok] = useState(false);
  const [riwayat, setRiwayat] = useState<RiwayatBaris[] | null>(null);
  const [memuatRiwayat, setMemuatRiwayat] = useState(false);
  const [fotoSibuk, setFotoSibuk] = useState(false);
  const [fotoAktif, setFotoAktif] = useState(0);
  const [lightbox, setLightbox] = useState(false);

  const dialog = useRef<HTMLDivElement>(null);
  const fokusAwal = useRef<HTMLElement | null>(null);
  const fileFoto = useRef<HTMLInputElement>(null);
  const sinyalRef = useRef(sinyal);

  // --- Muat detail (dengan cache) ------------------------------------------
  const muatDetail = (paksa = false) => {
    const idKode = CACHE_KODE.get(kode);
    const cache = idKode !== undefined ? CACHE.get(idKode) : undefined;
    if (cache && !paksa) {
      setDetail(cache);
      setMemuat(false);
      return;
    }
    if (IN_FLIGHT.has(`d:${kode}`)) return; // sudah berjalan
    IN_FLIGHT.add(`d:${kode}`);
    setMemuat(true);
    apiGet<{ data: DetailData }>(`/api/master/produk/${encodeURIComponent(kode)}/detail`)
      .then((r) => {
        CACHE.set(r.data.id, r.data);
        if (r.data.kode_item) CACHE_KODE.set(String(r.data.kode_item), r.data.id);
        CACHE_KODE.set(kode, r.data.id);
        setDetail(r.data);
        setFotoAktif(0);
      })
      .catch((e: Error) => beritahu(e.message, 'galat'))
      .finally(() => {
        IN_FLIGHT.delete(`d:${kode}`);
        setMemuat(false);
      });
  };

  useEffect(() => {
    setStok(null);
    setRiwayat(null);
    muatDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kode]);
  // Tombol Refresh global di topbar: paksa muat ulang detail (bypass cache).
  useSegarkanModul(() => muatDetail(true));

  // Perubahan data dari induk (simpan/ubah/foto/massal) → muat ulang.
  useEffect(() => {
    if (sinyal === sinyalRef.current) return;
    sinyalRef.current = sinyal;
    if (detail) {
      resetCacheDetail(detail.id);
      muatDetail(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sinyal]);

  // --- Tab lazy: Stok & Riwayat -------------------------------------------
  useEffect(() => {
    if (!detail) return;
    if (tab === 'stok' && !stok) {
      const cache = CACHE_STOK.get(detail.id);
      if (cache) {
        setStok(cache);
        return;
      }
      if (IN_FLIGHT.has(`s:${detail.id}`)) return;
      IN_FLIGHT.add(`s:${detail.id}`);
      setMemuatStok(true);
      apiGet<StokData>(`/api/master/produk/${detail.id}/stok`)
        .then((r) => {
          CACHE_STOK.set(detail.id, r);
          setStok(r);
        })
        .catch((e: Error) => beritahu(e.message, 'galat'))
        .finally(() => {
          IN_FLIGHT.delete(`s:${detail.id}`);
          setMemuatStok(false);
        });
    }
    if (tab === 'riwayat' && !riwayat) {
      const cache = CACHE_RIWAYAT.get(detail.id);
      if (cache) {
        setRiwayat(cache);
        return;
      }
      if (IN_FLIGHT.has(`r:${detail.id}`)) return;
      IN_FLIGHT.add(`r:${detail.id}`);
      setMemuatRiwayat(true);
      apiGet<{ data: RiwayatBaris[] }>(`/api/master/produk/${detail.id}/riwayat`)
        .then((r) => {
          CACHE_RIWAYAT.set(detail.id, r.data);
          setRiwayat(r.data);
        })
        .catch((e: Error) => beritahu(e.message, 'galat'))
        .finally(() => {
          IN_FLIGHT.delete(`r:${detail.id}`);
          setMemuatRiwayat(false);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, detail]);

  // --- Prev / next ---------------------------------------------------------
  const idx = daftar.findIndex((b) => String(b.kode_item ?? b.id) === kode);
  const sebelum = idx > 0 ? daftar[idx - 1] : null;
  const sesudah = idx >= 0 && idx < daftar.length - 1 ? daftar[idx + 1] : null;
  const ganti = (arah: -1 | 1) => {
    const target = arah === -1 ? sebelum : sesudah;
    if (target) onGanti(String(target.kode_item ?? target.id));
  };

  // --- Kunci: Esc (lightbox dulu), ← →, focus trap --------------------------
  useEffect(() => {
    fokusAwal.current = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => {
      fokusAwal.current?.focus?.();
    };
  }, []);

  // Kunci scroll halaman di belakang pop up — pasang ulang tiap render agar
  // tetap terkunci walau modal lain (mis. dialog Ubah/Cetak) melepasnya.
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lightbox) setLightbox(false);
        else onTutup();
        return;
      }
      const t = e.target as HTMLElement | null;
      const mengetik = t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
      if (mengetik) return;
      if (e.key === 'ArrowLeft') ganti(-1);
      if (e.key === 'ArrowRight') ganti(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sebelum, sesudah, lightbox]);

  const jebakFokus = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab' || !dialog.current) return;
    const fokusable = Array.from(
      dialog.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null);
    if (fokusable.length === 0) return;
    const pertama = fokusable[0];
    const terakhir = fokusable[fokusable.length - 1];
    if (e.shiftKey && document.activeElement === pertama) {
      e.preventDefault();
      terakhir.focus();
    } else if (!e.shiftKey && document.activeElement === terakhir) {
      e.preventDefault();
      pertama.focus();
    } else if (!dialog.current.contains(document.activeElement)) {
      e.preventDefault();
      pertama.focus();
    }
  };

  // --- Ganti/tambah foto dari pop up ---------------------------------------
  const gantiFoto = async (file: File | undefined) => {
    if (!file || !detail) return;
    setFotoSibuk(true);
    try {
      const dataUrl = await kompresGambar(file);
      const r = await apiPost<{ url: string }>('/api/master/produk/foto', {
        target: 'produk',
        id: detail.id,
        data_base64: dataUrl,
        nama_file: file.name,
      });
      const galeri = [
        { sumber: 'produk' as const, ref_id: detail.id, url: r.url, label: detail.nama },
        ...detail.galeri.filter((g) => g.sumber !== 'produk'),
      ];
      const segar: DetailData = { ...detail, foto_url: r.url, galeri };
      CACHE.set(detail.id, segar);
      setDetail(segar);
      setFotoAktif(0);
      beritahu('Foto produk diperbarui.');
      onBerubah();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setFotoSibuk(false);
    }
  };

  // --- Tab Info Umum --------------------------------------------------------
  const infoBaris: { label: string; isi: ReactNode }[] = detail
    ? [
        { label: 'Kode Item', isi: <code>{detail.kode_item ?? '—'}</code> },
        { label: 'Nama Produk', isi: detail.nama },
        { label: 'SKU', isi: <code>{detail.sku}</code> },
        { label: 'Barcode', isi: detail.barcode ? <code>{detail.barcode}</code> : '—' },
        { label: 'Kategori', isi: detail.kategori_nama ?? '—' },
        { label: 'Merek', isi: detail.merek_nama ?? '—' },
        { label: 'Satuan Dasar', isi: detail.satuan_dasar_nama ?? '—' },
        { label: 'Harga Beli', isi: formatRupiah(Number(detail.harga_beli)) },
        { label: 'Harga Jual', isi: formatRupiah(Number(detail.harga_jual)) },
        { label: 'Stok Minimum', isi: formatAngka(Number(detail.stok_min)) },
        { label: 'Deskripsi', isi: detail.deskripsi || '—' },
        { label: 'Dibuat', isi: tanggalPendek(detail.dibuat_pada) },
        { label: 'Diubah', isi: tanggalPendek(detail.diubah_pada) },
        { label: 'Dibuat Oleh', isi: detail.dibuat_oleh_nama ?? '—' },
      ]
    : [];

  if (!detail && !memuat) {
    // Gagal dimuat (mis. kode tidak dikenal) — tetap tampilkan kerangka tutup.
    return (
      <div className="detail-overlay" onMouseDown={(e) => e.target === e.currentTarget && onTutup()}>
        <div className="detail-modal" role="dialog" aria-modal="true" aria-label="Detail produk" ref={dialog} tabIndex={-1} onKeyDown={jebakFokus}>
          <div className="detail-modal__kepala">
            <strong>Produk tidak ditemukan.</strong>
            <button type="button" className="icon-tombol" onClick={onTutup} aria-label="Tutup">
              <Icon nama="close" size={18} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  const galeri = detail?.galeri ?? [];
  const fotoUtama = galeri[fotoAktif]?.url ?? detail?.foto_url ?? null;
  const r = detail?.ringkasan;

  return (
    <div className="detail-overlay" onMouseDown={(e) => e.target === e.currentTarget && onTutup()}>
      <div
        className="detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Detail ${detail?.nama ?? 'produk'}`}
        ref={dialog}
        tabIndex={-1}
        onKeyDown={jebakFokus}
      >
        {/* Header tetap terlihat saat isi di-scroll */}
        <div className="detail-modal__kepala">            <div className="detail-navigasi">
              <IconButton
                label="Produk sebelumnya"
                ikon="chevron-left"
                arah="bawah"
                disabled={!sebelum}
                alasan={!sebelum ? 'Sudah produk pertama' : undefined}
                onClick={() => ganti(-1)}
              />
              <IconButton
                label="Produk berikutnya"
                ikon="chevron-right"
                arah="bawah"
                disabled={!sesudah}
                alasan={!sesudah ? 'Sudah produk terakhir' : undefined}
                onClick={() => ganti(1)}
              />
            </div>

          <span className="foto-thumb">{detail?.foto_url ? <img src={detail.foto_url} alt="" /> : 'Foto'}</span>
          <div className="detail-kepala-teks">
            <strong>{detail?.nama ?? 'Memuat…'}</strong>
            <div className="detail-kepala-meta">
              <code>{detail?.kode_item ?? ''}</code>
              {detail && (
                <span className={`lencana ${Number(detail.aktif) === 1 ? 'lencana--aktif' : 'lencana--mati'}`}>
                  {Number(detail.aktif) === 1 ? 'Aktif' : 'Nonaktif'}
                </span>
              )}
            </div>
          </div>

          {detail && (
            <div className="detail-aksi">
              <IconButton label="Ubah" ikon="pencil" arah="bawah" onClick={() => onUbah(detail)} />
              <MenuAksi
                label="Aksi produk"
                items={[
                  { label: Number(detail.aktif) === 1 ? 'Nonaktifkan' : 'Aktifkan', jalan: () => onNonaktif(detail) },
                  { label: 'Hapus', jalan: () => onHapus(detail) },
                  { label: 'Cetak Label', jalan: () => onCetak(detail.id) },
                ]}
              />
            </div>
          )}

          <button type="button" className="icon-tombol" onClick={onTutup} aria-label="Tutup">
            <Icon nama="close" size={18} />
          </button>
        </div>

        <div className="detail-modal__isi">
          {memuat || !detail ? (
            <Rangka />
          ) : (
            <>
              {/* Ringkasan angka */}
              <div className="detail-ringkasan">
                <div className="ringkas-kartu">
                  <span className="teks-redup teks-kecil">Total Stok</span>
                  <strong>{formatAngka(Number(r?.total_stok ?? 0))}</strong>
                </div>
                <div className="ringkas-kartu">
                  <span className="teks-redup teks-kecil">Nilai Stok</span>
                  <strong>{formatRupiah(Number(r?.nilai_stok ?? 0))}</strong>
                </div>
                <div className="ringkas-kartu">
                  <span className="teks-redup teks-kecil">Terjual 30 Hari</span>
                  <strong>{formatAngka(Number(r?.terjual_30_hari ?? 0))}</strong>
                </div>
                <div className="ringkas-kartu">
                  <span className="teks-redup teks-kecil">Gudang</span>
                  <strong>{formatAngka(Number(r?.jumlah_gudang ?? 0))}</strong>
                </div>
              </div>

              <div className="detail-kolom">
                {/* Kolom kiri: galeri foto */}
                <div className="detail-galeri">
                  <button type="button" className="galeri-utama" onClick={() => setLightbox(true)} aria-label="Perbesar foto">
                    {fotoUtama ? <img src={fotoUtama} alt={detail.nama} /> : <span className="teks-redup">Tanpa foto</span>}
                  </button>
                  {galeri.length > 1 && (
                    <div className="galeri-thumbnail">
                      {galeri.map((g, i) => (
                        <button
                          type="button"
                          key={`${g.sumber}-${g.ref_id}`}
                          className={`galeri-thumbnail__item ${i === fotoAktif ? 'galeri-thumbnail__item--aktif' : ''}`}
                          onClick={() => setFotoAktif(i)}
                          title={g.label}
                        >
                          <img src={g.url} alt={g.label} loading="lazy" />
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    ref={fileFoto}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void gantiFoto(f);
                      e.target.value = '';
                    }}
                  />
                  <button type="button" className="tombol tombol--kecil" disabled={fotoSibuk} onClick={() => fileFoto.current?.click()}>
                    {fotoSibuk ? 'Mengunggah…' : detail.foto_url ? 'Ganti Foto' : 'Tambah Foto'}
                  </button>
                </div>

                {/* Kolom kanan: tab */}
                <div className="detail-kanan">
                  <div className="detail-tab" role="tablist" aria-label="Bagian detail produk">
                    {(
                      [
                        ['info', 'Info Umum'],
                        ['stok', 'Stok'],
                        ['harga', 'Harga & Konversi'],
                        ['riwayat', 'Riwayat'],
                      ] as [Tab, string][]
                    ).map(([k, label]) => (
                      <button
                        type="button"
                        key={k}
                        role="tab"
                        aria-selected={tab === k}
                        className={`detail-tab__tombol ${tab === k ? 'detail-tab__tombol--aktif' : ''}`}
                        onClick={() => setTab(k)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="detail-panel" role="tabpanel">
                    {tab === 'info' && (
                      <dl className="info-daftar">
                        {infoBaris.map((b) => (
                          <div className="info-daftar__baris" key={b.label}>
                            <dt>{b.label}</dt>
                            <dd className={b.label === 'Deskripsi' ? 'info-deskripsi' : undefined}>{b.isi}</dd>
                          </div>
                        ))}
                      </dl>
                    )}

                    {tab === 'stok' && (
                      <>
                        {memuatStok || !stok ? (
                          <Rangka />
                        ) : (
                          <>
                            <div className="detail-ringkasan detail-ringkasan--kecil">
                              <div className="ringkas-kartu"><span className="teks-redup teks-kecil">Total</span><strong>{formatAngka(stok.ringkasan.total)}</strong></div>
                              <div className="ringkas-kartu"><span className="teks-redup teks-kecil">Tersedia</span><strong>{formatAngka(stok.ringkasan.tersedia)}</strong></div>
                              <div className="ringkas-kartu"><span className="teks-redup teks-kecil">Dipesan</span><strong>{formatAngka(stok.ringkasan.dipesan)}</strong></div>
                              <div className="ringkas-kartu"><span className="teks-redup teks-kecil">Minimum</span><strong>{formatAngka(stok.ringkasan.minimum)}</strong></div>
                            </div>
                            {stok.ringkasan.jumlah_kurang > 0 && (
                              <p className="peringatan-merah" role="status">
                                ⚠ Stok produk ini di bawah minimum.
                              </p>
                            )}
                            <h4 className="detail-subjudul">Per Gudang</h4>
                            <div className="tabel-bungkus">
                              <table className="tabel tabel--kecil">
                                <thead>
                                  <tr>
                                    <th>Gudang</th>
                                    <th>Kode</th>
                                    <th className="rata-kanan">Total</th>
                                    <th className="rata-kanan">Minimum</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {stok.lokasi.length === 0 ? (
                                    <tr><td colSpan={4} className="tabel-kosong">Belum ada stok tersimpan.</td></tr>
                                  ) : (
                                    stok.lokasi.map((l) => (
                                      <tr key={l.gudang_kode}>
                                        <td>{l.gudang_nama}</td>
                                        <td><code>{l.gudang_kode}</code></td>
                                        <td className="rata-kanan">{formatAngka(l.total)}</td>
                                        <td className="rata-kanan">{formatAngka(l.minimum)}</td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </>
                        )}
                      </>
                    )}

                    {tab === 'harga' && (
                      <>
                        <h4 className="detail-subjudul">Harga per Satuan</h4>
                        <div className="tabel-bungkus">
                          <table className="tabel tabel--kecil">
                            <thead>
                              <tr>
                                <th>Satuan</th>
                                <th className="rata-kanan">1 Satuan =</th>
                                <th>SKU Acuan</th>
                                <th className="rata-kanan">Harga Jual</th>
                                <th className="rata-kanan">Harga Beli</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td>{detail.satuan_dasar_nama ?? 'Satuan dasar'}</td>
                                <td className="rata-kanan">1 {detail.satuan_dasar_nama ?? 'unit'}</td>
                                <td><code>{detail.sku}</code></td>
                                <td className="rata-kanan">{formatRupiah(Number(detail.harga_jual))}</td>
                                <td className="rata-kanan">{formatRupiah(Number(detail.harga_beli))}</td>
                              </tr>
                              {detail.konversi.map((k) => (
                                <tr key={k.unit_id}>
                                  <td>{k.unit_nama} ({k.unit_kode})</td>
                                  <td className="rata-kanan">{formatAngka(Number(k.jumlah_per_satuan_dasar))} {detail.satuan_dasar_nama ?? 'unit'}</td>
                                  <td><code>{detail.sku}</code></td>
                                  <td className="rata-kanan">{formatRupiah(Number(detail.harga_jual) * Number(k.jumlah_per_satuan_dasar))}</td>
                                  <td className="rata-kanan">{formatRupiah(Number(detail.harga_beli) * Number(k.jumlah_per_satuan_dasar))}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {detail.konversi.length === 0 && <p className="teks-redup teks-kecil">Belum ada konversi satuan untuk produk ini.</p>}

                        <h4 className="detail-subjudul">Paket / Box</h4>
                        <div className="tabel-bungkus">
                          <table className="tabel tabel--kecil">
                            <thead>
                              <tr>
                                <th>Kode Box</th>
                                <th>Nama</th>
                                <th className="rata-kanan">Produk di Paket</th>
                                <th className="rata-kanan">Qty / Paket</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detail.paket.length === 0 ? (
                                <tr><td colSpan={4} className="tabel-kosong">Produk ini belum masuk paket/box mana pun.</td></tr>
                              ) : (
                                detail.paket.map((p) => (
                                  <tr key={p.id}>
                                    <td><code>{p.kode_box}</code></td>
                                    <td>{p.nama}</td>
                                    <td className="rata-kanan">{formatAngka(Number(p.jumlah_produk))}</td>
                                    <td className="rata-kanan">{formatAngka(Number(p.qty_dalam_paket))}</td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}

                    {tab === 'riwayat' && (
                      <>
                        {memuatRiwayat || !riwayat ? (
                          <Rangka />
                        ) : (
                          <>
                            <div className="detail-panel__kepala">
                              <span className="teks-redup teks-kecil">20 pergerakan stok terakhir</span>
                              <button type="button" className="tombol tombol--kecil" onClick={() => navigate('/stok/kartu')}>
                                Lihat semua
                              </button>
                            </div>
                            <div className="tabel-bungkus">
                              <table className="tabel tabel--kecil">
                                <thead>
                                  <tr>
                                    <th>Tanggal</th>
                                    <th>Tipe</th>
                                    <th>Dokumen</th>
                                    <th>SKU</th>
                                    <th className="rata-kanan">Masuk</th>
                                    <th className="rata-kanan">Keluar</th>
                                    <th className="rata-kanan">Saldo</th>
                                    <th>Lokasi</th>
                                    <th>Petugas</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {riwayat.length === 0 ? (
                                    <tr><td colSpan={9} className="tabel-kosong">Belum ada pergerakan stok.</td></tr>
                                  ) : (
                                    riwayat.map((b) => (
                                      <tr key={b.id}>
                                        <td className="teks-kecil">{tanggalPendek(b.tanggal)}</td>
                                        <td><span className={`lencana lencana--${warnaTipe(b.tipe_dokumen)}`}>{b.tipe_dokumen}</span></td>
                                        <td>{b.no_dokumen ?? '—'}</td>
                                        <td><code>{b.sku}</code></td>
                                        <td className="rata-kanan">{Number(b.qty_masuk) > 0 ? `+${formatAngka(Number(b.qty_masuk))}` : '—'}</td>
                                        <td className="rata-kanan">{Number(b.qty_keluar) > 0 ? `-${formatAngka(Number(b.qty_keluar))}` : '—'}</td>
                                        <td className="rata-kanan">{formatAngka(Number(b.saldo))}</td>
                                        <td className="teks-kecil">{b.gudang_nama}/{b.kode_lokasi}</td>
                                        <td className="teks-kecil">{b.pengguna ?? '—'}</td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Lightbox layar penuh */}
      {lightbox && fotoUtama && (
        <div className="lightbox" onClick={() => setLightbox(false)} role="dialog" aria-modal="true" aria-label="Pratinjau foto">
          <button type="button" className="icon-tombol lightbox__tutup" onClick={() => setLightbox(false)} aria-label="Tutup foto">
            <Icon nama="close" size={22} />
          </button>
          <img src={fotoUtama} alt={detail?.nama ?? ''} onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

function warnaTipe(tipe: string): string {
  switch (tipe) {
    case 'penjualan':
      return 'bahaya';
    case 'pembelian':
      return 'aktif';
    case 'transfer':
      return 'netral';
    default:
      return 'netral';
  }
}

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { beritahu } from '../../components/crud/Toast';
import { ambilOpsi, apiGet } from '../../lib/api';
import { useSegarkanModul } from '../../lib/segarkan';
import { formatAngka, formatRupiah, formatTanggalWaktu } from '../../lib/format';
import { FooterDaftar } from '../../components/crud/FooterDaftar';
import { useBarisOtomatis } from '../../lib/barisOtomatis';
import './stok.css';

type Baris = Record<string, any>;
type Opsi = { id: number; label: string };

const LABEL_TIPE: Record<string, string> = {
  penjualan: 'Penjualan',
  pembelian: 'Pembelian',
  transfer: 'Transfer',
  transfer_batal: 'Pembatalan transfer',
  retur: 'Retur',
  opname: 'Penyesuaian Opname',
  produksi: 'Produksi',
  penyesuaian: 'Penyesuaian',
  saldo_awal: 'Saldo Awal',
};

/** Isi Kartu Stok (tanpa pembungkus halaman) — dipakai rute /stok/kartu
 *  maupun sebagai token di dalam modul Stok Persediaan. */
export function IsiKartuStok({ tanpaBungkus, aksiKanan }: { tanpaBungkus?: boolean; aksiKanan?: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const productId = params.get('product_id') ?? '';
  const gudangId = params.get('gudang') ?? '';

  const [data, setData] = useState<Baris[]>([]);
  const [total, setTotal] = useState(0);
  const [hal, setHal] = useState(1);
  const areaRef = useRef<HTMLDivElement>(null);
  // AJ — baris per halaman otomatis (Otomatis/20/50/100) + footer terpadu.
  const { per, mode: modeBaris, setMode: setModeBaris } = useBarisOtomatis({
    kunci: 'stok-kartu',
    areaRef,
    total,
    hal,
    setHal,
  });
  const [produkTerpilih, setProdukTerpilih] = useState<Baris | null>(null);
  const [opsiProduk, setOpsiProduk] = useState<Baris[]>([]);
  const [opsiGudang, setOpsiGudang] = useState<Opsi[]>([]);
  const [sibuk, setSibuk] = useState(false);

  useEffect(() => {
    apiGet<{ data: Baris[] }>('/api/stock/produk')
      .then((r) => setOpsiProduk(r.data))
      .catch((e: Error) => beritahu(e.message, 'galat'));
    ambilOpsi('gudang').then(setOpsiGudang).catch((e: Error) => beritahu(e.message, 'galat'));
  }, []);

  const muat = useCallback(async () => {
    if (!productId) {
      setData([]);
      setProdukTerpilih(null);
      setTotal(0);
      return;
    }
    setSibuk(true);
    try {
      const q = new URLSearchParams({ product_id: productId, hal: String(hal), per: String(per) });
      if (gudangId) q.set('gudang', gudangId);
      const r = await apiGet<{ data: Baris[]; total: number; hal: number; per: number; produk: Baris }>(`/api/stock/kartu?${q.toString()}`);
      setData(r.data);
      setTotal(r.total);
      setProdukTerpilih(r.produk);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibuk(false);
    }
  }, [productId, gudangId, hal, per]);

  // Ganti produk/gudang → kembali ke halaman pertama
  useEffect(() => {
    setHal(1);
  }, [productId, gudangId]);

  useEffect(() => {
    void muat();
  }, [muat]);
  // Tombol Refresh global di topbar: muat ulang kartu stok.
  useSegarkanModul(muat);

  const ubahParam = (kunci: string, nilai: string) => {
    const p = new URLSearchParams(params);
    if (nilai) p.set(kunci, nilai);
    else p.delete(kunci);
    setParams(p, { replace: true });
  };

  const selisihKartu = produkTerpilih && Number(produkTerpilih.saldo) !== Number(produkTerpilih.saldo_dari_kartu);

  const isi = (
    <>
        {/* Baris kanan header: jumlah mutasi → badge Saldo → badge Nilai →
            grup tombol/ikon aksi (token modul), sejajar dalam satu garis. */}
        <div className="kartu__kepala kartu__kepala--kompak stok-kartu__kepala">
          <div className="stok-kartu__judul">
            <h3>Kartu Stok</h3>
            <p className="teks-redup teks-kecil">
              Setiap perubahan stok wajib tercatat di sini: tanggal, dokumen sumber, masuk, keluar, saldo, pengguna.
            </p>
          </div>
          <div className="stok-kartu__kanan">
            {total > 0 && <span className="kartu__jumlah">{total} mutasi</span>}
            {produkTerpilih && (
              <div className="tombol-baris stok-kartu__ringkas">
                <span className={`kartu-ringkas ${produkTerpilih.di_bawah_minimum ? 'kartu-ringkas--bahaya' : ''}`}>
                  Saldo: <strong>{formatAngka(Number(produkTerpilih.saldo))} pcs</strong>
                </span>
                <span className="kartu-ringkas">
                  Nilai (rata-rata {formatRupiah(Number(produkTerpilih.rata_bergerak ?? 0))}): <strong>{formatRupiah(Number(produkTerpilih.nilai_persediaan ?? 0))}</strong>
                </span>
                {selisihKartu && (
                  <span className="kartu-ringkas kartu-ringkas--bahaya" title="Saldo kartu stok tidak sama dengan saldo tercatat — perlu penyesuaian/opname">
                    Selisih kartu: {formatAngka(Number(produkTerpilih.saldo_dari_kartu))}
                  </span>
                )}
              </div>
            )}
            {aksiKanan}
          </div>
        </div>

        <div className="alat-tabel toolbar-kompak stok-kartu__alat">
          <span className="filter-inline">
          <select
            className="input-pilih input-pilih--lebar"
            value={productId}
            onChange={(e) => ubahParam('product_id', e.target.value)}
            aria-label="Pilih produk"
          >
            <option value="">— Pilih produk —</option>
            {opsiProduk.map((o) => (
              <option key={o.id} value={o.id}>
                {o.sku} — {o.produk}
              </option>
            ))}
          </select>
          <select
            className="input-pilih"
            value={gudangId}
            onChange={(e) => ubahParam('gudang', e.target.value)}
            aria-label="Filter gudang"
            disabled={!productId}
          >
            <option value="">Semua gudang</option>
            {opsiGudang.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          </span>
          {produkTerpilih && (
            <span className="teks-redup teks-kecil stok-kartu__info">
              {produkTerpilih.produk} · SKU <code>{produkTerpilih.sku}</code>
              {produkTerpilih.di_bawah_minimum ? ' · di bawah minimum' : ''}
            </span>
          )}
        </div>

        <div ref={areaRef} className="tabel-bungkus sembunyi-hp stok-kartu__tabel">
          <table className="tabel">
            <thead>
              <tr>
                <th>Tanggal (WIB)</th>
                <th>Dokumen sumber</th>
                <th>Gudang / Lokasi</th>
                <th className="rata-kanan">Masuk</th>
                <th className="rata-kanan">Keluar</th>
                <th className="rata-kanan">Saldo</th>
                <th className="rata-kanan">Harga satuan</th>
                <th>Pengguna</th>
              </tr>
            </thead>
            <tbody>
              {!productId ? (
                <tr><td colSpan={8} className="tabel-kosong">Pilih produk untuk melihat kartu stok.</td></tr>
              ) : sibuk && data.length === 0 ? (
                <tr><td colSpan={8} className="tabel-kosong">Memuat…</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={8} className="tabel-kosong">Belum ada mutasi untuk produk ini.</td></tr>
              ) : (
                data.map((m) => (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap">{formatTanggalWaktu(m.tanggal)}</td>
                    <td>
                      <strong>{m.no_dokumen ?? LABEL_TIPE[m.tipe_dokumen] ?? m.tipe_dokumen}</strong>
                      {m.no_dokumen && (
                        <div className="teks-redup teks-kecil">{LABEL_TIPE[m.tipe_dokumen] ?? m.tipe_dokumen}</div>
                      )}
                    </td>
                    <td className="teks-kecil">
                      {m.gudang_kode} — {m.gudang_nama}
                      <div className="teks-redup"><code>{m.kode_lokasi}</code></div>
                    </td>
                    <td className="rata-kanan mutasi-masuk">{Number(m.qty_masuk) > 0 ? `+${formatAngka(Number(m.qty_masuk))}` : '—'}</td>
                    <td className="rata-kanan mutasi-keluar">{Number(m.qty_keluar) > 0 ? `-${formatAngka(Number(m.qty_keluar))}` : '—'}</td>
                    <td className="rata-kanan"><strong>{formatAngka(Number(m.saldo))}</strong></td>
                    <td className="rata-kanan">{formatRupiah(Number(m.nilai_unit ?? 0))}</td>
                    <td>{m.pengguna ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* MOBILE OTOMATIS — mutasi sejajar 2 kolom, tidak 1 angka per baris. */}
        <div className="hp-daftar">
          {!productId ? (
            <div className="hp-kartu"><div className="hp-kartu__sub">Pilih produk untuk melihat kartu stok.</div></div>
          ) : sibuk && data.length === 0 ? (
            <div className="hp-kartu"><div className="hp-kartu__sub">Memuat…</div></div>
          ) : data.length === 0 ? (
            <div className="hp-kartu"><div className="hp-kartu__sub">Belum ada mutasi untuk produk ini.</div></div>
          ) : (
            data.map((m) => (
              <article className="hp-kartu" key={`hp-${m.id}`}>
                <div className="hp-kartu__atas">
                  <span className="hp-kartu__kode">{formatTanggalWaktu(m.tanggal)}</span>
                  <span className="hp-kartu__kanan">{LABEL_TIPE[m.tipe_dokumen] ?? m.tipe_dokumen}</span>
                </div>
                <div className="hp-kartu__nama">{m.no_dokumen ?? LABEL_TIPE[m.tipe_dokumen] ?? m.tipe_dokumen}</div>
                <div className="hp-kartu__sub">{m.gudang_kode} — {m.gudang_nama}{m.kode_lokasi ? ` · ${m.kode_lokasi}` : ''} · {m.pengguna ?? '—'}</div>
                <div className="hp-grid">
                  <div className="hp-sel"><div className="hp-label">Masuk</div><div className="hp-nilai" style={{ color: 'var(--sukses, #15803d)' }}>{Number(m.qty_masuk) > 0 ? `+${formatAngka(Number(m.qty_masuk))}` : '—'}</div></div>
                  <div className="hp-sel"><div className="hp-label">Keluar</div><div className="hp-nilai" style={{ color: 'var(--danger, #b91c1c)' }}>{Number(m.qty_keluar) > 0 ? `-${formatAngka(Number(m.qty_keluar))}` : '—'}</div></div>
                  <div className="hp-sel"><div className="hp-label">Saldo</div><div className="hp-nilai">{formatAngka(Number(m.saldo))}</div></div>
                  <div className="hp-sel"><div className="hp-label">Harga</div><div className="hp-nilai">{formatRupiah(Number(m.nilai_unit ?? 0))}</div></div>
                </div>
              </article>
            ))
          )}
        </div>

        <FooterDaftar mode={modeBaris} onMode={setModeBaris} hal={hal} totalHal={Math.max(1, Math.ceil(total / per))} total={total} onHal={setHal} />
    </>
  );
  // tanpaBungkus = ditanam di dalam kartu modul lain (satu kartu terpadu).
  if (tanpaBungkus) return isi;
  return <section className="kartu kartu--daftar">{isi}</section>;
}

/** Rute /stok/kartu (kompatibilitas bookmark) — pembungkus halaman. */
export function HalamanKartu() {
  return (
    <div className="halaman halaman--fit">
      <IsiKartuStok />
    </div>
  );
}

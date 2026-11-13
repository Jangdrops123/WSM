import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { FooterDaftar } from '../../components/crud/FooterDaftar';
import { useBarisOtomatis } from '../../lib/barisOtomatis';
import { IconButton } from '../../components/IconButton';
import { TombolScan } from '../../components/ScanKamera';
import { beritahu } from '../../components/crud/Toast';
import { ambilOpsi, apiGet, apiPut } from '../../lib/api';
import { useSegarkanModul } from '../../lib/segarkan';
import { formatAngka, formatRupiah } from '../../lib/format';
import { IsiKartuStok } from './HalamanKartu';
import './stok.css';

type Baris = Record<string, any>;
type Opsi = { id: number; label: string };
type Ringkasan = { qty_total: number; jumlah_kurang: number; nilai_halaman: number; nilai_persediaan: number };

export function HalamanSaldo() {
  const navigate = useNavigate();
  const [data, setData] = useState<Baris[]>([]);
  const [total, setTotal] = useState(0);
  const [ringkasan, setRingkasan] = useState<Ringkasan | null>(null);
  const [hal, setHal] = useState(1);
  const areaRef = useRef<HTMLDivElement>(null);
  // AJ — baris per halaman otomatis (Otomatis/20/50/100) + footer terpadu.
  const { per, mode: modeBaris, setMode: setModeBaris } = useBarisOtomatis({
    kunci: 'stok-saldo',
    areaRef,
    total,
    hal,
    setHal,
  });
  const [cari, setCari] = useState('');
  const [cariTunda, setCariTunda] = useState('');
  const [gudang, setGudang] = useState('');
  const [kategori, setKategori] = useState('');
  const [kurangSaja, setKurangSaja] = useState(false);
  const [sibuk, setSibuk] = useState(false);

  const [opsiGudang, setOpsiGudang] = useState<Opsi[]>([]);
  const [opsiKategori, setOpsiKategori] = useState<Opsi[]>([]);
  const [pengaturan, setPengaturan] = useState<{ stok_minus_izinkan: boolean; valuasi: string } | null>(null);
  // 2 Token Switcher: Saldo vs Pengaturan. Kartu Stok bukan token — dibuka
  // dari tombol aksi per baris (bukaKartu) dan kembali via token Saldo.
  const [pandangan, setPandangan] = useState<'saldo' | 'kartu' | 'pengaturan'>('saldo');
  const [, setParams] = useSearchParams();

  /** Lompat ke token Kartu Stok dengan produk & gudang terisi (pengganti
   *  tautan ke rute /stok/kartu yang kini terintegrasi di modul ini). */
  const bukaKartu = (productId: number, gudangId: number): void => {
    setParams({ product_id: String(productId), gudang: String(gudangId) }, { replace: true });
    setPandangan('kartu');
  };

  useEffect(() => {
    const t = window.setTimeout(() => {
      setCariTunda(cari);
      setHal(1);
    }, 350);
    return () => window.clearTimeout(t);
  }, [cari]);

  useEffect(() => {
    ambilOpsi('gudang').then(setOpsiGudang).catch((e: Error) => beritahu(e.message, 'galat'));
    ambilOpsi('kategori').then(setOpsiKategori).catch((e: Error) => beritahu(e.message, 'galat'));
    apiGet<{ stok_minus_izinkan: boolean; valuasi: string }>('/api/stock/pengaturan')
      .then(setPengaturan)
      .catch((e: Error) => beritahu(e.message, 'galat'));
  }, []);

  // Saldo disimpan per produk per gudang — tanpa filter lokasi (lokasi hanya
  // tercatat di mutasi/kartu stok).
  const muat = useCallback(async () => {
    setSibuk(true);
    try {
      const q = new URLSearchParams({ hal: String(hal), per: String(per), cari: cariTunda });
      if (gudang) q.set('gudang', gudang);
      if (kategori) q.set('kategori', kategori);
      if (kurangSaja) q.set('kurang', '1');
      const r = await apiGet<{ data: Baris[]; total: number; ringkasan: Ringkasan }>(`/api/stock/saldo?${q.toString()}`);
      setData(r.data);
      setTotal(r.total);
      setRingkasan(r.ringkasan);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibuk(false);
    }
  }, [hal, per, cariTunda, gudang, kategori, kurangSaja]);

  useEffect(() => {
    void muat();
  }, [muat]);
  // Tombol Refresh global di topbar: muat ulang saldo stok.
  useSegarkanModul(muat);

  const totalHal = Math.max(1, Math.ceil(total / per));

  const ubahStokMinus = async (nilai: boolean) => {
    try {
      await apiPut('/api/stock/pengaturan', { stok_minus_izinkan: nilai });
      setPengaturan((p) => (p ? { ...p, stok_minus_izinkan: nilai } : p));
      beritahu(nilai ? 'Stok minus DIIZINKAN.' : 'Stok minus TIDAK diizinkan.');
    } catch (err) {
      beritahu((err as Error).message, 'galat');
      setPengaturan((p) => (p ? { ...p, stok_minus_izinkan: !nilai } : p)); // kembalikan sakelar
    }
  };

  /** Switcher Saldo / Pengaturan — kini duduk di baris ringkasan metrik. */
  const grupToken = (
    <div className="token-grup stok-token" role="tablist" aria-label="Navigasi modul stok">
          <button
            type="button"
            role="tab"
            aria-selected={pandangan === 'saldo'}
            className={`token${pandangan === 'saldo' ? ' token--aktif' : ''}`}
            onClick={() => setPandangan('saldo')}
            title="Stok Persediaan"
            aria-label="Stok Persediaan"
          >
            <Icon nama="stok" size={16} />
            <span>Stok Persediaan</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={pandangan === 'pengaturan'}
            className={`token${pandangan === 'pengaturan' ? ' token--aktif' : ''}`}
            onClick={() => setPandangan('pengaturan')}
            title="Pengaturan Stok"
            aria-label="Pengaturan Stok"
          >
            <Icon nama="sliders" size={16} />
            <span>Pengaturan Stok</span>
          </button>
    </div>
  );

  return (
    <div className="halaman halaman--fit stok-halaman">
      {/* ============ Satu kartu terpadu: isi langsung di bawah topbar ============ */}
      <section className="kartu kartu--daftar">
      {pandangan === 'pengaturan' && <div className="stok-token-atas">{grupToken}</div>}
      {pandangan === 'saldo' && (
      <>
        <div className="kartu__kepala kartu__kepala--kompak stok-kepala">
          <span className="kartu__jumlah">{total} baris · per produk — per gudang, nilai rata-rata bergerak</span>
          <div className="tombol-baris stok-ringkas">
            <span className={`kartu-ringkas ${ringkasan && ringkasan.jumlah_kurang > 0 ? 'kartu-ringkas--bahaya' : ''}`}>
              Di bawah minimum: <strong>{formatAngka(ringkasan?.jumlah_kurang ?? 0)}</strong>
            </span>
            <span className="kartu-ringkas">
              Nilai persediaan: <strong>{formatRupiah(ringkasan?.nilai_persediaan ?? 0)}</strong>
            </span>
            {grupToken}
            {/* O4 — pintasan: buka daftar Opname dengan gudang filter terisi. */}
            <IconButton
              ikon="circle-check"
              label="Mulai Opname"
              ukuran="toolbar"
              onClick={() => navigate(gudang ? `/stok/opname?gudang=${gudang}&baru=1` : '/stok/opname?baru=1')}
            />
          </div>
        </div>

        <div className="alat-tabel toolbar-kompak">
          <div className="cari-scan">
          <input
            className="input-cari"
            type="search"
            placeholder="Cari SKU, barcode, atau nama produk…"
            value={cari}
            onChange={(e) => {
              setCari(e.target.value);
              setHal(1);
            }}
          />
          <TombolScan onHasil={(t) => { setCari(t); setHal(1); }} />
          </div>
          <span className="filter-inline">
          <select
            className="input-pilih"
            value={gudang}
            onChange={(e) => {
              setGudang(e.target.value);
              setHal(1);
            }}
            aria-label="Filter gudang"
          >
            <option value="">Semua gudang</option>
            {opsiGudang.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          <select
            className="input-pilih"
            value={kategori}
            onChange={(e) => {
              setKategori(e.target.value);
              setHal(1);
            }}
            aria-label="Filter kategori"
          >
            <option value="">Semua kategori</option>
            {opsiKategori.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          </span>
          <label className="bidang--centang">
            <input
              type="checkbox"
              checked={kurangSaja}
              onChange={(e) => {
                setKurangSaja(e.target.checked);
                setHal(1);
              }}
            />
            <span>Di bawah minimum saja</span>
          </label>
          <span className="teks-redup teks-kecil">
            Stok halaman ini {formatAngka(ringkasan?.qty_total ?? 0)} pcs · nilai {formatRupiah(ringkasan?.nilai_halaman ?? 0)}
          </span>
        </div>

        <div ref={areaRef} className="tabel-bungkus sembunyi-hp">
          <table className="tabel">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Produk</th>
                <th>Kategori</th>
                <th>Gudang</th>
                <th className="rata-kanan">Stok</th>
                <th className="rata-kanan">Minimum</th>
                <th className="rata-kanan">Nilai (rata-rata)</th>
                <th className="rata-tengah">Status</th>
                <th className="rata-kanan">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {sibuk && data.length === 0 ? (
                <tr><td colSpan={9} className="tabel-kosong">Memuat…</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={9} className="tabel-kosong">Tidak ada saldo stok{cariTunda ? ` untuk "${cariTunda}"` : ''}.</td></tr>
              ) : (
                data.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <code>{b.sku}</code>
                      {b.barcode && <div className="teks-redup teks-kecil">{b.barcode}</div>}
                    </td>
                    <td>
                      <strong>{b.produk}</strong>
                    </td>
                    <td>{b.kategori ?? '—'}</td>
                    <td>{b.gudang_kode} — {b.gudang_nama}</td>
                    <td className="rata-kanan"><strong>{formatAngka(Number(b.qty))}</strong></td>
                    <td className="rata-kanan">{formatAngka(Number(b.stok_min ?? 0))}</td>
                    <td className="rata-kanan">{formatRupiah(Number(b.nilai_total ?? 0))}</td>
                    <td className="rata-tengah">
                      {Number(b.di_bawah_minimum) === 1 ? (
                        <span className="lencana lencana--bahaya">Di bawah minimum</span>
                      ) : (
                        <span className="lencana lencana--aktif">Aman</span>
                      )}
                    </td>
                    <td className="rata-kanan">
                      <button
                        type="button"
                        className="tombol tombol--kecil tombol--netral"
                        onClick={() => bukaKartu(Number(b.product_id), Number(b.warehouse_id))}
                      >
                        Kartu Stok
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* MOBILE OTOMATIS — kartu isi penuh, tidak bertumpuk (<=767px). */}
        <div className="hp-daftar" aria-hidden={false}>
          {sibuk && data.length === 0 ? (
            <div className="hp-kartu"><div className="hp-kartu__sub">Memuat…</div></div>
          ) : data.length === 0 ? (
            <div className="hp-kartu"><div className="hp-kartu__sub">Tidak ada saldo stok{cariTunda ? ` untuk "${cariTunda}"` : ''}.</div></div>
          ) : (
            data.map((b) => (
              <article className="hp-kartu" key={`hp-${b.id}`}>
                <div className="hp-kartu__atas">
                  <span className="hp-kartu__kode">{b.sku}</span>
                  <span className="hp-kartu__kanan">{b.barcode ?? `${b.gudang_kode} — ${b.gudang_nama}`}</span>
                </div>
                <div className="hp-kartu__nama">{b.produk}</div>
                <div className="hp-kartu__sub">{b.kategori ?? '—'} · {b.gudang_kode} — {b.gudang_nama}</div>
                <div className="hp-grid">
                  <div className="hp-sel"><div className="hp-label">Stok</div><div className="hp-nilai">{formatAngka(Number(b.qty))}</div></div>
                  <div className="hp-sel"><div className="hp-label">Minimum</div><div className="hp-nilai">{formatAngka(Number(b.stok_min ?? 0))}</div></div>
                  <div className="hp-sel hp-sel--penuh">
                    <div className="hp-label">Nilai (rata-rata)</div>
                    <div className="hp-nilai">{formatRupiah(Number(b.nilai_total ?? 0))} · {Number(b.di_bawah_minimum) === 1 ? (<span className="lencana lencana--bahaya">Di bawah minimum</span>) : (<span className="lencana lencana--aktif">Aman</span>)}</div>
                  </div>
                </div>
                <div className="hp-aksi">
                  <button
                    type="button"
                    className="tombol tombol--kecil tombol--netral"
                    onClick={() => bukaKartu(Number(b.product_id), Number(b.warehouse_id))}
                  >
                    Kartu Stok
                  </button>
                </div>
              </article>
            ))
          )}
        </div>

        <FooterDaftar mode={modeBaris} onMode={setModeBaris} hal={hal} totalHal={totalHal} total={total} onHal={setHal} />
      </>
      )}

      {pandangan === 'kartu' && <IsiKartuStok tanpaBungkus aksiKanan={grupToken} />}

      {pandangan === 'pengaturan' && (
      <>
        <div className="pengaturan-baris">
          <label className="bidang--centang">
            <input
              type="checkbox"
              checked={Boolean(pengaturan?.stok_minus_izinkan)}
              onChange={(e) => void ubahStokMinus(e.target.checked)}
            />
            <span>
              <strong>Izinkan stok minus</strong>
              <div className="teks-redup teks-kecil">Default tidak — pengeluaran melebihi saldo akan ditolak.</div>
            </span>
          </label>
          <div className="pengaturan-baris__nilai">
            <span className="teks-redup teks-kecil">Metode valuasi</span>
            <strong>Rata-rata bergerak</strong>
          </div>
        </div>
      </>
      )}
      </section>
    </div>
  );
}

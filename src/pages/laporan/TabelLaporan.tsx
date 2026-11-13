import { Fragment, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { TombolScan } from '../../components/ScanKamera';
import { formatRupiah, formatTanggal, formatTanggalWaktu } from '../../lib/format';
import type { KolomLaporan } from './tipe';

/**
 * Tabel laporan generik (N4):
 * urut kolom · pencarian · pengelompokan (group by) · paginasi ·
 * (baris Total tidak lagi ditampilkan di layar — hanya opsional di PDF)
 * kolom bisa disembunyikan · angka nowrap rata kanan format Rp.
 */

const PER_HAL = [25, 50, 100];

function selFormat(v: unknown, tipe: KolomLaporan['tipe']): string {
  if (v === null || v === undefined) return '—';
  switch (tipe) {
    case 'rupiah':
      return formatRupiah(Number(v));
    case 'persen':
      return `${Number(v).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
    case 'angka':
      return Number(v).toLocaleString('id-ID', { maximumFractionDigits: 2 });
    case 'waktu':
      return formatTanggalWaktu(v as Date | string | number | null | undefined);
    case 'tanggal':
      return formatTanggal(v as Date | string | number | null | undefined);
    default:
      return String(v);
  }
}

const nilaiUrut = (v: unknown): number | string =>
  typeof v === 'number' ? v : String(v ?? '').toLowerCase();

/** Ambil teks rincian barang bila baris memilikinya (kolom `rincian_barang`). */
function teksRincian(row: Record<string, unknown>): string {
  const v = row.rincian_barang;
  if (typeof v !== 'string') return '';
  const t = v.trim();
  return t === '' || t === '—' ? '' : t;
}

/** Pecah "A ×2; B ×1 … (+3 lainnya)" jadi daftar chip + catatan sisa. */
function pecahRincian(v: string): { chip: string[]; catatan: string } {
  const m = / … \(\+\d+ lainnya\)$/.exec(v);
  const catatan = m ? m[0].trim() : '';
  const inti = m ? v.slice(0, m.index) : v;
  return { chip: inti.split(';').map((s) => s.trim()).filter(Boolean), catatan };
}

/** Satu baris item pada tabel rincian terbuka ke bawah (template PDF). */
export interface ItemRincian {
  tanggal?: unknown;
  nomor?: unknown;
  barang?: unknown;
  qty?: unknown;
  harga?: unknown;
  subtotal?: unknown;
  laba?: unknown;
  sistem?: unknown;
  fisik?: unknown;
  selisih?: unknown;
  dipesan?: unknown;
  diterima?: unknown;
  sisa?: unknown;
}

/** Ambil daftar item rincian dari kolom tersembunyi `rincian_detail` (JSON). */
function daftarRincian(row: Record<string, unknown>): ItemRincian[] {
  const v = row.rincian_detail;
  try {
    const arr: unknown = typeof v === 'string' ? JSON.parse(v) : v;
    if (!Array.isArray(arr)) return [];
    return (arr as Record<string, unknown>[])
      .filter((x) => x && typeof x === 'object')
      .map((x) => ({
        tanggal: x.tanggal,
        nomor: x.nomor,
        barang: x.barang,
        qty: x.qty,
        harga: x.harga,
        subtotal: x.subtotal,
        laba: x.laba,
        sistem: x.sistem,
        fisik: x.fisik,
        selisih: x.selisih,
        dipesan: x.dipesan,
        diterima: x.diterima,
        sisa: x.sisa,
      }));
  } catch {
    return [];
  }
}

const fmtQty = (v: unknown): string => {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('id-ID', { maximumFractionDigits: 2 });
};

export function TabelLaporan({
  kolom,
  rows,
  judul,
  adaDrill,
  onDrill,
  terbatas,
}: {
  kolom: KolomLaporan[];
  rows: Record<string, unknown>[];
  judul: string;
  adaDrill?: (row: Record<string, unknown>) => boolean;
  onDrill?: (row: Record<string, unknown>) => void;
  terbatas?: boolean;
}) {
  const [urut, setUrut] = useState<{ kunci: string; arah: 1 | -1 } | null>(null);
  const [cari, setCari] = useState('');
  const [kelompok, setKelompok] = useState('');
  const [hal, setHal] = useState(0);
  const [per, setPer] = useState(PER_HAL[0]);
  const [sembunyi, setSembunyi] = useState<Set<string>>(new Set());
  const [luas, setLuas] = useState<Set<string>>(new Set());
  const toggleLuas = (kunci: string) => {
    setLuas((s) => {
      const n = new Set(s);
      if (n.has(kunci)) n.delete(kunci);
      else n.add(kunci);
      return n;
    });
  };
  const [bukaKolom, setBukaKolom] = useState(false);
  const menuKolom = useRef<HTMLDivElement>(null);

  // Template PDF: kolom teks "Rincian Barang" & JSON "rincian_detail" tidak
  // ditampilkan sebagai kolom — rinciannya terbuka ke bawah saat baris diklik.
  const terlihat = useMemo(
    () => kolom.filter((k) => k.kunci !== 'rincian_barang' && k.kunci !== 'rincian_detail' && !sembunyi.has(k.kunci)),
    [kolom, sembunyi],
  );

  const tersaring = useMemo(() => {
    const q = cari.trim().toLowerCase();
    let r = rows;
    if (q) r = r.filter((row) => kolom.some((k) => String(row[k.kunci] ?? '').toLowerCase().includes(q)));
    if (urut) {
      const { kunci, arah } = urut;
      const tipe = kolom.find((k) => k.kunci === kunci)?.tipe ?? 'teks';
      r = [...r].sort((a, b) => {
        const va = nilaiUrut(a[kunci]);
        const vb = nilaiUrut(b[kunci]);
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * arah;
        return String(va).localeCompare(String(vb), 'id') * arah;
      });
      void tipe;
    }
    return r;
  }, [rows, cari, urut, kolom]);

  // Pengelompokan (group by): ringkas kolom numerik per nilai kolom terpilih.
  const { kelompokan, kolomKelompok } = useMemo(() => {
    if (!kelompok) return { kelompokan: null as Record<string, unknown>[] | null, kolomKelompok: '' };
    const indeks = new Map<string, Record<string, unknown>>();
    for (const row of tersaring) {
      const kunci = String(row[kelompok] ?? '(kosong)');
      const ada = indeks.get(kunci);
      if (ada) {
        for (const k of kolom) {
          if (k.tipe === 'rupiah' || k.tipe === 'angka') ada[k.kunci] = Number(ada[k.kunci] ?? 0) + Number(row[k.kunci] ?? 0);
        }
      } else {
        const baru: Record<string, unknown> = { ...row };
        for (const k of kolom) {
          if (k.tipe === 'rupiah' || k.tipe === 'angka') baru[k.kunci] = Number(row[k.kunci] ?? 0);
        }
        indeks.set(kunci, baru);
      }
    }
    return { kelompokan: [...indeks.values()], kolomKelompok: kelompok };
  }, [tersaring, kelompok, kolom]);

  const dasar = kelompokan ?? tersaring;
  const jumlahHal = Math.max(1, Math.ceil(dasar.length / per));
  const halAman = Math.min(hal, jumlahHal - 1);
  const page = dasar.slice(halAman * per, halAman * per + per);

  const klikUrut = (kunci: string) => {
    setUrut((u) => (u?.kunci !== kunci ? { kunci, arah: 1 } : u.arah === 1 ? { kunci, arah: -1 } : null));
    setHal(0);
  };

  return (
    <section className="laporan-tabel">
      <div className="laporan-tabel__alat">
        <div className="cari-scan">
        <input
          className="input-cari"
          type="search"
          placeholder="Cari dalam tabel…"
          aria-label={`Cari dalam ${judul}`}
          value={cari}
          onChange={(e) => {
            setCari(e.target.value);
            setHal(0);
          }}
        />
        <TombolScan onHasil={(t) => { setCari(t); setHal(0); }} />
        </div>
        <label className="laporan-tabel__kelompok">
          <span>Kelompokkan:</span>
          <select
            className="input-pilih"
            value={kelompok}
            onChange={(e) => {
              setKelompok(e.target.value);
              setHal(0);
            }}
          >
            <option value="">Tidak</option>
            {kolom
              .filter((k) => k.tipe === 'teks' || k.tipe === 'tanggal')
              .map((k) => (
                <option key={k.kunci} value={k.kunci}>
                  {k.label}
                </option>
              ))}
          </select>
        </label>
        <div className="laporan-tabel__kolom" ref={menuKolom}>
          <button
            type="button"
            className="tombol tombol--kecil"
            aria-expanded={bukaKolom}
            onClick={() => setBukaKolom((b) => !b)}
          >
            Kolom
          </button>
          {bukaKolom && (
            <div className="laporan-tabel__kolom-menu">
              {kolom.map((k) => (
                <label key={k.kunci}>
                  <input
                    type="checkbox"
                    checked={!sembunyi.has(k.kunci)}
                    onChange={(e) =>
                      setSembunyi((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.delete(k.kunci);
                        else n.add(k.kunci);
                        return n;
                      })
                    }
                  />
                  {k.label}
                </label>
              ))}
            </div>
          )}
        </div>
        <span className="teks-redup teks-kecil">
          {dasar.length.toLocaleString('id-ID')} baris{kelompok ? ` · ${kolomKelompok}` : ''}
          {terbatas ? ' · dibatasi server' : ''}
        </span>
      </div>

      <div className="tabel-bungkus laporan-tabel__bungkus">
        <table className="tabel laporan-tabel__tabel">
          <thead>
            <tr>
              {terlihat.map((k) => (
                <th
                  key={k.kunci}
                  className={k.tipe === 'teks' ? '' : 'rata-kanan nowrap'}
                  aria-sort={urut?.kunci === k.kunci ? (urut.arah === 1 ? 'ascending' : 'descending') : 'none'}
                >
                  <button type="button" className="laporan-tabel__urut" onClick={() => klikUrut(k.kunci)}>
                    {k.label}
                    <Icon
                      nama={urut?.kunci === k.kunci ? (urut.arah === 1 ? 'chevron-up' : 'chevron-down') : 'chevron-down'}
                      size={12}
                      className={urut?.kunci === k.kunci ? '' : 'redup'}
                    />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.length === 0 ? (
              <tr>
                <td className="tabel-kosong" colSpan={terlihat.length || 1}>
                  {cari ? 'Tidak ada baris yang cocok.' : 'Tidak ada data pada filter & periode ini.'}
                </td>
              </tr>
            ) : (
              page.map((row, i) => {
                const kunci = `${halAman * per + i}`;
                const items = daftarRincian(row);
                const teksFallback = items.length ? '' : teksRincian(row);
                const adaRincian = items.length > 0 || teksFallback !== '';
                const buka = luas.has(kunci);
                const bisaDrill = adaDrill?.(row) ?? false;
                const bisaKlik = adaRincian || bisaDrill;
                const klikBaris = adaRincian
                  ? () => toggleLuas(kunci)
                  : bisaDrill
                    ? () => onDrill?.(row)
                    : undefined;
                const { chip, catatan } =
                  !items.length && teksFallback ? pecahRincian(teksFallback) : { chip: [] as string[], catatan: '' };
                const grup = String(row[kolom[0]?.kunci ?? ''] ?? '');
                const modeOpname = items.length > 0 && items.every((x) => x.tanggal == null && (x.selisih != null || x.sistem != null));
                const modePo = row.rincian_tipe === 'po';
                const adaLaba = items.some((x) => x.laba != null && Number(x.laba) !== 0);
                const qtySum = items.reduce((a, x) => a + Number(x.qty ?? x.selisih ?? 0), 0);
                const subSum = items.reduce((a, x) => a + Number(x.subtotal ?? 0), 0);
                const labaSum = items.reduce((a, x) => a + Number(x.laba ?? 0), 0);
                return (
                  <Fragment key={kunci}>
                    <tr
                      className={bisaKlik ? 'baris-drill' : undefined}
                      onClick={klikBaris}
                      tabIndex={bisaKlik ? 0 : undefined}
                      onKeyDown={
                        bisaKlik
                          ? (e) => {
                              if (e.key === 'Enter') klikBaris?.();
                            }
                          : undefined
                      }
                      title={adaRincian ? 'Klik untuk melihat rincian barang' : undefined}
                    >
                      {terlihat.map((k, ci) => (
                        <td key={k.kunci} className={k.tipe === 'teks' ? '' : 'rata-kanan nowrap'}>
                          {ci === 0 && adaRincian ? (
                            <span className="rincian-panah" aria-hidden="true">
                              {buka ? '▾' : '▸'}
                            </span>
                          ) : null}
                          {selFormat(row[k.kunci], k.tipe)}
                        </td>
                      ))}
                    </tr>
                    {adaRincian && buka && (
                      <tr className="baris-rincian">
                        <td colSpan={terlihat.length || 1}>
                          {items.length ? (
                            <div className="rincian-bungkus rincian-bungkus--tabel">
                              <div className="rincian-kepala">
                                <span className="rincian-judul">
                                  {modeOpname
                                    ? `Rincian selisih • ${grup}`
                                    : adaLaba
                                      ? `Rincian barang terjual • ${grup}`
                                      : `Rincian barang dibeli • ${grup}`}
                                </span>
                                <span className="rincian-meta">
                                  {items.length} baris • {fmtQty(qtySum)} pcs
                                </span>
                                {bisaDrill && (
                                  <button type="button" className="tombol tombol--kecil" onClick={() => onDrill?.(row)}>
                                    Buka detail
                                  </button>
                                )}
                              </div>
                              {modePo ? (
                                <div className="rincian-scroll">
                                  <table className="rincian-tabel">
                                    <thead><tr>
                                      <th>Barang</th><th className="rata-kanan">Qty dipesan</th>
                                      <th className="rata-kanan">Qty diterima</th><th className="rata-kanan">Sisa</th>
                                      <th className="rata-kanan">Harga</th><th className="rata-kanan">Subtotal</th>
                                    </tr></thead>
                                    <tbody>
                                      {items.map((x, xi) => (
                                        <tr key={xi}>
                                          <td>{String(x.barang ?? '�')}</td>
                                          <td className="rata-kanan nowrap">{fmtQty(x.dipesan ?? x.qty)}</td>
                                          <td className="rata-kanan nowrap">{fmtQty(x.diterima)}</td>
                                          <td className="rata-kanan nowrap">{fmtQty(x.sisa)}</td>
                                          <td className="rata-kanan nowrap">{formatRupiah(Number(x.harga ?? 0))}</td>
                                          <td className="rata-kanan nowrap">{formatRupiah(Number(x.subtotal ?? 0))}</td>
                                        </tr>
                                      ))}
                                      <tr className="rincian-total">
                                        <td>Total rincian</td>
                                        <td className="rata-kanan nowrap">{fmtQty(qtySum)}</td>
                                        <td className="rata-kanan nowrap">{fmtQty(items.reduce((a, x) => a + Number(x.diterima ?? 0), 0))}</td>
                                        <td className="rata-kanan nowrap">{fmtQty(items.reduce((a, x) => a + Number(x.sisa ?? 0), 0))}</td>
                                        <td className="rata-kanan nowrap">�</td>
                                        <td className="rata-kanan nowrap">{formatRupiah(subSum)}</td>
                                      </tr>
                                    </tbody>
                                  </table>
                                </div>
                              ) : modeOpname ? (
                                <div className="rincian-scroll">
                              <table className="rincian-tabel">
                                  <thead>
                                    <tr>
                                      <th>Barang</th>
                                      <th className="rata-kanan">Sistem</th>
                                      <th className="rata-kanan">Fisik</th>
                                      <th className="rata-kanan">Selisih</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {items.map((x, xi) => (
                                      <tr key={xi}>
                                        <td>{String(x.barang ?? '—')}</td>
                                        <td className="rata-kanan nowrap">{fmtQty(x.sistem)}</td>
                                        <td className="rata-kanan nowrap">{fmtQty(x.fisik)}</td>
                                        <td className="rata-kanan nowrap">{fmtQty(x.selisih ?? x.qty)}</td>
                                      </tr>
                                    ))}
                                    <tr className="rincian-total">
                                      <td>Total rincian</td>
                                      <td className="rata-kanan nowrap" data-label="Sistem">—</td>
                                      <td className="rata-kanan nowrap" data-label="Fisik">—</td>
                                      <td className="rata-kanan nowrap" data-label="Selisih">{fmtQty(qtySum)}</td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                              ) : (
                                <div className="rincian-scroll">
                              <table className="rincian-tabel">
                                  <thead>
                                    <tr>
                                      <th>Tanggal</th>
                                      <th>{adaLaba ? 'No. Struk' : 'Nomor'}</th>
                                      <th>Barang</th>
                                      <th className="rata-kanan">Qty</th>
                                      <th className="rata-kanan">Harga</th>
                                      <th className="rata-kanan">Subtotal</th>
                                      {adaLaba && <th className="rata-kanan">Laba</th>}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {items.map((x, xi) => (
                                      <tr key={xi}>
                                        <td className="nowrap">{String(x.tanggal ?? '—').replace('T', ' ').slice(0, 16)}</td>
                                        <td className="nowrap">{String(x.nomor ?? '—')}</td>
                                        <td>{String(x.barang ?? '—')}</td>
                                        <td className="rata-kanan nowrap">{fmtQty(x.qty)}</td>
                                        <td className="rata-kanan nowrap">{formatRupiah(Number(x.harga ?? 0))}</td>
                                        <td className="rata-kanan nowrap">{formatRupiah(Number(x.subtotal ?? 0))}</td>
                                        {adaLaba && <td className="rata-kanan nowrap">{formatRupiah(Number(x.laba ?? 0))}</td>}
                                      </tr>
                                    ))}
                                    <tr className="rincian-total">
                                      <td colSpan={3}>Total rincian</td>
                                      <td className="rata-kanan nowrap" data-label="Qty">{fmtQty(qtySum)}</td>
                                      <td className="rata-kanan nowrap" data-label="Harga">—</td>
                                      <td className="rata-kanan nowrap" data-label="Subtotal">{formatRupiah(subSum)}</td>
                                      {adaLaba && <td className="rata-kanan nowrap" data-label="Laba">{formatRupiah(labaSum)}</td>}
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                              )}
                            </div>
                          ) : (
                            <div className="rincian-bungkus">
                              <span className="rincian-judul">Rincian barang:</span>
                              <span className="rincian-chips">
                                {chip.map((c, ci) => (
                                  <span key={ci} className="rincian-chip">
                                    {c}
                                  </span>
                                ))}
                                {catatan && <span className="rincian-catatan">{catatan}</span>}
                              </span>
                              {bisaDrill && (
                                <button type="button" className="tombol tombol--kecil" onClick={() => onDrill?.(row)}>
                                  Buka detail
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="laporan-tabel__kaki">
        <label>
          Baris:
          <select
            className="input-pilih"
            value={per}
            onChange={(e) => {
              setPer(Number(e.target.value));
              setHal(0);
            }}
          >
            {PER_HAL.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <span className="teks-redup teks-kecil">
          Halaman {halAman + 1} / {jumlahHal}
        </span>
        <div className="baris">
          <button type="button" className="tombol tombol--kecil" disabled={halAman === 0} onClick={() => setHal(halAman - 1)}>
            Sebelumnya
          </button>
          <button
            type="button"
            className="tombol tombol--kecil"
            disabled={halAman >= jumlahHal - 1}
            onClick={() => setHal(halAman + 1)}
          >
            Berikutnya
          </button>
        </div>
      </div>
    </section>
  );
}

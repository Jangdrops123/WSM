import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/crud/Modal';
import { beritahu } from '../../components/crud/Toast';
import { pratinjauEkspor, unduhEkspor, type PraEkspor } from '../../lib/api';
import { KOLOM_PRODUK, kolomProduk, type KolomProduk } from './kolomProduk';
import './impor-ekspor.css';

type Cakupan = 'semua' | 'filter' | 'terpilih';
type FormatBerkas = 'xlsx' | 'csv';

const FILTER_STOK: [string, string][] = [
  ['', 'Semua status stok'],
  ['ada', 'Stok tersedia (> 0)'],
  ['habis', 'Stok habis (0)'],
  ['menipis', 'Stok menipis (≤ minimum)'],
];

const HURUF = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const hurufKolom = (i: number) => (i < 26 ? HURUF[i] : HURUF[Math.floor(i / 26) - 1] + HURUF[i % 26]);

const PREVIEW_MAKS = 40;

interface Props {
  entitas: string;
  /** Nama modul — mis. "Produk". */
  judul: string;
  /** Daftar kolom yang boleh dicentang (default: seluruh KOLOM_PRODUK). */
  kolom?: KolomProduk[];
  opsiKategori: { id: number; label: string }[];
  /** Id baris yang sedang dicentang di tabel — dipakai cakupan "Baris terpilih". */
  terpilih?: number[];
  onTutup: () => void;
}

/**
 * Dialog Ekspor Excel: kolom berupa daftar centang (sama dengan kolom modul),
 * filter kategori & status stok, pilihan format file, opsi satu-sheet-per-
 * kategori dan baris judul kolom, serta pratinjau hasil yang tampil seperti
 * lembar Excel (huruf kolom A, B, C… + nomor baris).
 */
export function DialogEksporExcel({
  entitas,
  judul,
  kolom = KOLOM_PRODUK,
  opsiKategori,
  terpilih = [],
  onTutup,
}: Props) {
  const semuaKey = useMemo(() => kolom.map((k) => k.key), [kolom]);
  /** String stabil — `[...Set]` membuat array baru tiap render induk. */
  const terpilihKey = terpilih.join(',');
  const [pilih, setPilih] = useState<string[]>(semuaKey);
  const [cakupan, setCakupan] = useState<Cakupan>(terpilih.length ? 'terpilih' : 'semua');
  const [kategori, setKategori] = useState('');
  const [stok, setStok] = useState('');
  const [format, setFormat] = useState<FormatBerkas>('xlsx');
  const [sheetPerKategori, setSheetPerKategori] = useState(false);
  const [barisJudul, setBarisJudul] = useState(true);
  const [pra, setPra] = useState<PraEkspor | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const awal = useRef(true);

  const boleh = pilih.length > 0 && !(cakupan === 'terpilih' && terpilihKey === '');

  const buatQuery = useCallback((): URLSearchParams => {
    const q = new URLSearchParams();
    if (pilih.length !== semuaKey.length) q.set('kolom', pilih.join(','));
    if (cakupan === 'terpilih') {
      q.set('cakupan', 'terpilih');
      q.set('ids', terpilihKey);
    } else if (cakupan === 'filter') {
      q.set('cakupan', 'filter');
      if (kategori) q.set('kategori', kategori);
      if (stok) q.set('stok', stok);
    }
    if (sheetPerKategori) q.set('sheet_per_kategori', '1');
    if (!barisJudul) q.set('header', '0');
    return q;
  }, [pilih, semuaKey, cakupan, terpilihKey, kategori, stok, sheetPerKategori, barisJudul]);

  // Pratinjau lembar Excel — diperbarui setiap pilihan berubah (disediakan).
  useEffect(() => {
    if (!boleh) {
      setPra(null);
      return;
    }
    let hidup = true;
    const t = window.setTimeout(() => {
      setSibuk(true);
      pratinjauEkspor(entitas, buatQuery())
        .then((r) => {
          if (hidup) setPra(r);
        })
        .catch((err: Error) => {
          if (hidup) {
            setPra(null);
            if (awal.current) beritahu(err.message, 'galat');
          }
        })
        .finally(() => {
          if (hidup) setSibuk(false);
          awal.current = false;
        });
    }, 400);
    return () => {
      hidup = false;
      window.clearTimeout(t);
    };
  }, [entitas, buatQuery, boleh]);

  const unduh = async () => {
    if (!boleh) return;
    const ekstensi = format === 'csv' ? 'csv' : 'xlsx';
    try {
      await unduhEkspor(
        entitas,
        buatQuery(),
        `${entitas}-${new Date().toISOString().slice(0, 10)}.${ekstensi}`,
      );
      beritahu(`Berkas ${format === 'csv' ? 'CSV' : 'Excel'} diunduh.`);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    }
  };

  const toggleKolom = (key: string) =>
    setPilih((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));

  return (
    <Modal
      judul={`Ekspor ${judul} ke Excel`}
      lebar="sangat"
      onTutup={onTutup}
      aksi={
        <>
          <span className="teks-redup teks-kecil">
            {pra ? `${pra.total} baris akan diekspor` : boleh ? 'Menyiapkan pratinjau…' : 'Tidak ada kolom dipilih'}
          </span>
          <button type="button" className="tombol tombol--netral" onClick={onTutup}>
            Batal
          </button>
          <button
            type="button"
            className="tombol tombol--primer"
            disabled={!boleh}
            onClick={() => void unduh()}
          >
            <Icon nama="download" size={15} /> Unduh {format === 'csv' ? 'CSV' : 'Excel'}
          </button>
        </>
      }
    >
      <div className="ekspor-badan">
        {/* --- Panel kiri: kolom, filter, opsi ---------------------------- */}
        <aside className="ekspor-kiri">
          <div>
            <h5>Kolom yang diekspor</h5>
            <div className="ekspor-kolom__alat">
              <button
                type="button"
                className="tombol tombol--netral tombol--kecil"
                onClick={() => setPilih(semuaKey)}
              >
                Semua
              </button>
              <button type="button" className="tombol tombol--netral tombol--kecil" onClick={() => setPilih([])}>
                Kosongkan
              </button>
            </div>
            <div className="ekspor-kolom">
              {kolom.map((k) => (
                <label className="ekspor-kolom__baris" key={k.key}>
                  <input
                    type="checkbox"
                    checked={pilih.includes(k.key)}
                    onChange={() => toggleKolom(k.key)}
                  />
                  <span>{k.label}</span>
                  {k.wajib && <small>wajib</small>}
                  {k.turunan && <small>ekspor</small>}
                </label>
              ))}
            </div>
          </div>

          <div>
            <h5>Filter</h5>
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
                <select
                  value={kategori}
                  disabled={cakupan !== 'filter'}
                  onChange={(e) => setKategori(e.target.value)}
                >
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
                  {FILTER_STOK.map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Format file
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as FormatBerkas)}
                >
                  <option value="xlsx">Excel (.xlsx)</option>
                  <option value="csv">CSV (.csv — dipisah koma)</option>
                </select>
              </label>
            </div>
          </div>

          <div>
            <h5>Opsi tambahan</h5>
            <div className="ekspor-centang" style={{ flexDirection: 'column', gap: 9, alignItems: 'stretch' }}>
              <label className="ekspor-centang">
                <input
                  type="checkbox"
                  checked={sheetPerKategori}
                  disabled={format === 'csv'}
                  onChange={(e) => setSheetPerKategori(e.target.checked)}
                />
                <span>Satu sheet per kategori</span>
              </label>
              <label className="ekspor-centang">
                <input
                  type="checkbox"
                  checked={barisJudul}
                  onChange={(e) => setBarisJudul(e.target.checked)}
                />
                <span>Sertakan baris judul kolom</span>
              </label>
            </div>
            {format === 'csv' && sheetPerKategori && (
              <p className="teks-redup teks-kecil" style={{ margin: '8px 0 0' }}>
                CSV hanya satu berkas — opsi sheet per kategori dinonaktifkan.
              </p>
            )}
          </div>
        </aside>

        {/* --- Panel kanan: pratinjau lembar Excel ------------------------ */}
        <div className="excel">
          <div className="excel__kepala">
            <span className="excel__tab">
              <Icon nama="file-down" size={13} />
              {sheetPerKategori && format === 'xlsx' && pra && pra.total > 0
                ? 'Data (per kategori)'
                : 'Data'}
            </span>
            <span>Pratinjau {format.toUpperCase()} — {pilih.length} kolom</span>
          </div>

          {!boleh ? (
            <p className="teks-redup" style={{ padding: 24, margin: 0 }}>
              {cakupan === 'terpilih'
                ? 'Belum ada baris yang dipilih — ubah cakupan baris atau centang baris pada tabel.'
                : 'Pilih minimal satu kolom untuk menampilkan pratinjau.'}
            </p>
          ) : !pra && sibuk ? (
            <p className="teks-redup" style={{ padding: 24, margin: 0 }}>
              Memuat pratinjau…
            </p>
          ) : pra && pra.kolom.length === 0 ? (
            <p className="teks-redup" style={{ padding: 24, margin: 0 }}>
              Tidak ada kolom dipilih.
            </p>
          ) : pra ? (
            <>
              <div className="excel__gulir">
                <table className="excel__tabel">
                  <thead>
                    <tr>
                      <th className="excel__nomor" />
                      {pra.kolom.map((k, i) => (
                        <th key={k.key}>{hurufKolom(i)}</th>
                      ))}
                    </tr>
                    {barisJudul && (
                      <tr>
                        <th className="excel__nomor">1</th>
                        {pra.kolom.map((k) => (
                          <th key={k.key}>{k.label}</th>
                        ))}
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {pra.baris.slice(0, PREVIEW_MAKS).map((r, i) => (
                      <tr key={i}>
                        <td className="excel__nomor">{i + (barisJudul ? 2 : 1)}</td>
                        {pra.kolom.map((k) => (
                          <td
                            key={k.key}
                            className={kolomProduk(k.key).angka ? 'excel--angka' : undefined}
                          >
                            {r[k.key] === null || r[k.key] === undefined || r[k.key] === ''
                              ? ''
                              : String(r[k.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {pra.baris.length === 0 && (
                      <tr>
                        <td className="excel__nomor">—</td>
                        <td colSpan={Math.max(1, pra.kolom.length)} className="teks-redup">
                          Tidak ada baris sesuai filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="excel__kaki">
                {pra.total > PREVIEW_MAKS
                  ? `Menampilkan ${PREVIEW_MAKS} baris pertama dari ${pra.total} baris — berkas unduhan berisi seluruhnya.`
                  : `${pra.total} baris · ${pra.kolom.length} kolom`}
                {!barisJudul && ' · tanpa baris judul kolom'}
                {sheetPerKategori && format === 'xlsx' && ' · satu sheet per kategori'}
              </div>
            </>
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

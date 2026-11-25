import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { ambilOpsi, apiGet } from '../../lib/api';
import { useFilterLaporan } from './filter';
import { KUNCI_FILTER, KUNCI_TAMBAHAN, PARAMETER_AWAL, type ParameterSemua } from './tipe';

/**
 * N2 — Bar filter global: periode preset + rentang kustom + pembanding,
 * serta filter Gudang, Kasir, Pelanggan, Pemasok, Kategori, Merek, Produk
 * (autocomplete), Metode Bayar, dan Status. Satu bar dipakai SEMUA laporan;
 * nilainya hidup di URL sehingga tetap saat berpindah laporan & bisa dibagikan.
 * Panel memakai DRAF: mengubah tanggal/dropdown/input TIDAK memuat ulang
 * laporan dan TIDAK menutup panel. Laporan baru dimuat saat pengguna menekan
 * "Terapkan". Panel hanya tertutup lewat Terapkan, Batal/×, Esc, atau klik di
 * luar panel (popup kalender bawaan peramban bukan bagian halaman, jadi
 * memilih tanggal tidak pernah dianggap klik luar).
 */

const PERIODE: { nilai: string; teks: string }[] = [
  { nilai: 'hari-ini', teks: 'Hari ini' },
  { nilai: 'kemarin', teks: 'Kemarin' },
  { nilai: '7-hari', teks: '7 hari' },
  { nilai: 'bulan-ini', teks: 'Bulan ini' },
  { nilai: 'bulan-lalu', teks: 'Bulan lalu' },
  { nilai: 'tahun-ini', teks: 'Tahun ini' },
  { nilai: 'kustom', teks: 'Rentang kustom' },
];

const METODE = ['tunai', 'transfer', 'qris', 'kredit', 'kartu'];
const STATUS = [
  { nilai: '', teks: 'Status: Disahkan' },
  { nilai: 'semua', teks: 'Semua status' },
  { nilai: 'draft', teks: 'Draft' },
  { nilai: 'disahkan', teks: 'Disahkan' },
  { nilai: 'batal', teks: 'Batal' },
  { nilai: 'diterima', teks: 'Diterima' },
];
const STATUS_PO = [
  { nilai: 'draft', teks: 'Draft' },
  { nilai: 'terkirim', teks: 'Terkirim' },
  { nilai: 'sebagian', teks: 'Sebagian diterima' },
  { nilai: 'lebih', teks: 'Kelebihan diterima' },
  { nilai: 'selesai', teks: 'Selesai' },
  { nilai: 'selesai_kurang', teks: 'Selesai kurang' },
  { nilai: 'kadaluwarsa', teks: 'Kadaluwarsa' },
  { nilai: 'batal', teks: 'Batal' },
];

interface Opsi {
  id: number;
  label: string;
}

export function FilterBar() {
  const { params, ubahBanyak } = useFilterLaporan();
  const [buka, setBuka] = useState(false);
  /** Nilai yang sedang diedit di panel — belum memengaruhi laporan. */
  const [draf, setDraf] = useState<ParameterSemua>(() => ({ ...params }));
  const [opsi, setOpsi] = useState<Record<string, Opsi[]>>({});
  const akarRef = useRef<HTMLDivElement>(null);

  /** Buka panel dengan draf disalin dari filter yang sedang aktif. */
  const bukaPanel = () => {
    setDraf({ ...params });
    setBuka(true);
  };
  const tutupPanel = () => setBuka(false);

  const atur = (kunci: string, nilai: string) => setDraf((d) => ({ ...d, [kunci]: nilai }));

  /** Terapkan draf ke filter global (memicu muat ulang laporan), lalu tutup. */
  const terapkan = () => {
    const patch: Record<string, string> = {};
    for (const k of [...KUNCI_FILTER, ...KUNCI_TAMBAHAN]) patch[k] = draf[k] ?? '';
    ubahBanyak(patch);
    setBuka(false);
  };

  /** Reset draf ke periode default — panel TETAP terbuka sampai Terapkan. */
  const resetDraf = () => setDraf({ ...(PARAMETER_AWAL as unknown as ParameterSemua) });

  // Esc menutup panel; klik di luar panel (dan di luar tombol) juga menutup.
  useEffect(() => {
    if (!buka) return;
    const kunci = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBuka(false);
    };
    const klik = (e: MouseEvent) => {
      if (akarRef.current && !akarRef.current.contains(e.target as Node)) setBuka(false);
    };
    window.addEventListener('keydown', kunci);
    document.addEventListener('mousedown', klik);
    return () => {
      window.removeEventListener('keydown', kunci);
      document.removeEventListener('mousedown', klik);
    };
  }, [buka]);

  useEffect(() => {
    let hidup = true;
    (async () => {
      const muat: [string, Promise<Opsi[]>][] = [
        ['gudang', ambilOpsi('gudang')],
        ['pelanggan', ambilOpsi('pelanggan')],
        ['pemasok', ambilOpsi('pemasok')],
        ['kategori', ambilOpsi('kategori').catch(() => [])],
        ['merek', ambilOpsi('merek').catch(() => [])],
        // Master produk memakai /pemilih (bukan /opsi) — balasan: id, sku, produk_nama.
        [
          'produk',
          apiGet<{ data: { id: number; sku: string; produk_nama: string }[] }>('/api/master/produk/pemilih?per=1000').then((r) =>
            r.data.map((x) => ({ id: x.id, label: `${x.sku} — ${x.produk_nama}` })),
          ),
        ],
        ['kasir', apiGet<{ data: { id: number; nama: string }[] }>('/api/opname/opsi-pengguna').then((r) => r.data.map((x) => ({ id: x.id, label: x.nama })))],
      ];
      const hasil: Record<string, Opsi[]> = {};
      for (const [k, janji] of muat) {
        hasil[k] = await janji.catch(() => [] as Opsi[]);
        if (!hidup) return;
      }
      if (hidup) setOpsi(hasil);
    })();
    return () => {
      hidup = false;
    };
  }, []);

  // Produk: autocomplete memakai <datalist> (input teks → id terpilih).
  const [teksProduk, setTeksProduk] = useState('');
  useEffect(() => {
    if (!buka) return;
    const id = draf.produk;
    if (!id) {
      setTeksProduk('');
      return;
    }
    const cocok = (opsi.produk ?? []).find((o) => String(o.id) === id);
    setTeksProduk(cocok?.label ?? '');
  }, [buka, draf.produk, opsi.produk]);

  const daftarProduk = useMemo(() => opsi.produk ?? [], [opsi.produk]);

  const pilihProduk = (nilai: string) => {
    setTeksProduk(nilai);
    const cocok = daftarProduk.find((o) => o.label.toLowerCase() === nilai.trim().toLowerCase());
    atur('produk', cocok ? String(cocok.id) : '');
  };

  const Sel = ({ kunci, judul, kosong }: { kunci: string; judul: string; kosong: string }) => (
    <label className="filter-bar__kotak">
      <span>{judul}</span>
      <select value={draf[kunci] ?? ''} onChange={(e) => atur(kunci, e.target.value)}>
        <option value="">{kosong}</option>
        {(opsi[kunci] ?? []).map((o) => (
          <option key={o.id} value={String(o.id)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  const aktifSemua = Object.entries(params).filter(
    ([k, v]) => v && k !== 'periode' && !(k === 'lap' || k === 'grup' || k === 'urut' || k === 'cari'),
  ).length;

  return (
    <div className={`filter-bar ${buka ? 'filter-bar--buka' : ''}`} ref={akarRef}>
      <button
        type="button"
        className="tombol tombol--kecil filter-bar__toggle"
        aria-expanded={buka}
        aria-controls="filter-laporan-panel"
        aria-label={aktifSemua ? `Filter laporan (${aktifSemua} filter aktif)` : 'Filter laporan'}
        onClick={() => (buka ? tutupPanel() : bukaPanel())}
      >
        <Icon nama="pengaturan" size={15} />
        Filter
        {aktifSemua > 0 && (
          <span className="filter-bar__jumlah" title={`${aktifSemua} filter aktif`}>
            {aktifSemua}
          </span>
        )}
      </button>

      <div
        id="filter-laporan-panel"
        className="filter-bar__isi"
        role="dialog"
        aria-label="Filter laporan"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="filter-bar__kepala">
          <strong>Filter laporan</strong>
          <button
            type="button"
            className="filter-bar__tutup"
            onClick={tutupPanel}
            aria-label="Tutup panel filter"
            title="Tutup"
          >
            ×
          </button>
        </div>

        <div className="filter-bar__periode" role="group" aria-label="Periode laporan">
          {PERIODE.map((p) => (
            <button
              key={p.nilai}
              type="button"
              className={`filter-bar__periode-tombol ${draf.periode === p.nilai ? 'aktif' : ''}`}
              onClick={() => atur('periode', p.nilai)}
            >
              {p.teks}
            </button>
          ))}
        </div>

        {draf.periode === 'kustom' && (
          <div className="filter-bar__rentang">
            <label>
              <span>Dari</span>
              <input type="date" value={draf.dari} onChange={(e) => atur('dari', e.target.value)} />
            </label>
            <label>
              <span>Sampai</span>
              <input type="date" value={draf.sampai} onChange={(e) => atur('sampai', e.target.value)} />
            </label>
          </div>
        )}

        <label className="filter-bar__banding">
          <input
            type="checkbox"
            checked={draf.bandingkan === '1'}
            onChange={(e) => atur('bandingkan', e.target.checked ? '1' : '')}
          />
          Bandingkan periode sebelumnya
        </label>

        <div className="filter-bar__entitas">
          <Sel kunci="gudang" judul="Gudang" kosong="Semua gudang" />
          <Sel kunci="kasir" judul="Kasir" kosong="Semua kasir" />
          <Sel kunci="pelanggan" judul="Pelanggan" kosong="Semua pelanggan" />
          <Sel kunci="pemasok" judul="Pemasok" kosong="Semua pemasok" />
          {draf.lap === 'pembelian-po' && (
            <label className="filter-bar__kotak">
              <span>Status PO</span>
              <select value={draf.status_po ?? ''} onChange={(e) => atur('status_po', e.target.value)}>
                <option value="">Semua status PO</option>
                {STATUS_PO.map((s) => <option key={s.nilai} value={s.nilai}>{s.teks}</option>)}
              </select>
            </label>
          )}
          <Sel kunci="kategori" judul="Kategori" kosong="Semua kategori" />
          <Sel kunci="merek" judul="Merek" kosong="Semua merek" />

          <label className="filter-bar__kotak">
            <span>Produk (autocomplete)</span>
            <input
              list="filter-produk-datalist"
              value={teksProduk}
              onChange={(e) => pilihProduk(e.target.value)}
              placeholder="Ketik nama / SKU produk…"
            />
            <datalist id="filter-produk-datalist">
              {daftarProduk.map((o) => (
                <option key={o.id} value={o.label} />
              ))}
            </datalist>
          </label>

          <label className="filter-bar__kotak">
            <span>Metode bayar</span>
            <select value={draf.metode} onChange={(e) => atur('metode', e.target.value)}>
              <option value="">Semua metode</option>
              {METODE.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          <label className="filter-bar__kotak">
            <span>Status</span>
            <select value={draf.status} onChange={(e) => atur('status', e.target.value)}>
              {STATUS.map((s) => (
                <option key={s.nilai} value={s.nilai}>
                  {s.teks}
                </option>
              ))}
            </select>
          </label>

        </div>

        <div className="filter-bar__aksi">
          <button type="button" className="tombol tombol--kecil tombol--netral filter-bar__reset" onClick={resetDraf}>
            Reset
          </button>
          <button type="button" className="tombol tombol--kecil tombol--netral filter-bar__batal" onClick={tutupPanel}>
            Batal
          </button>
          <button type="button" className="tombol tombol--kecil tombol--primer filter-bar__terapkan" onClick={terapkan}>
            Terapkan
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { ambilOpsi, apiGet } from '../../lib/api';
import { useFilterLaporan } from './filter';

/**
 * N2 — Bar filter global: periode preset + rentang kustom + pembanding,
 * serta filter Gudang, Kasir, Pelanggan, Pemasok, Kategori, Merek, Produk
 * (autocomplete), Metode Bayar, dan Status. Satu bar dipakai SEMUA laporan;
 * nilainya hidup di URL sehingga tetap saat berpindah laporan & bisa dibagikan.
 * Filter tampil hanya bila diminta: tombol "Filter (n)" membuka panel popup
 * (desktop/tablet) atau bottom sheet (ponsel); Esc / Terapkan menutupnya.
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
  const { params, ubah, reset } = useFilterLaporan();
  const [buka, setBuka] = useState(false);
  const [opsi, setOpsi] = useState<Record<string, Opsi[]>>({});

  // Esc menutup panel popup/bottom sheet.
  useEffect(() => {
    if (!buka) return;
    const kunci = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBuka(false);
    };
    window.addEventListener('keydown', kunci);
    return () => window.removeEventListener('keydown', kunci);
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
    const id = params.produk;
    if (!id) {
      setTeksProduk('');
      return;
    }
    const cocok = (opsi.produk ?? []).find((o) => String(o.id) === id);
    setTeksProduk(cocok?.label ?? '');
  }, [params.produk, opsi.produk]);

  const daftarProduk = useMemo(() => opsi.produk ?? [], [opsi.produk]);

  const pilihProduk = (nilai: string) => {
    setTeksProduk(nilai);
    const cocok = daftarProduk.find((o) => o.label.toLowerCase() === nilai.trim().toLowerCase());
    ubah('produk', cocok ? String(cocok.id) : '');
  };

  const Sel = ({ kunci, judul, kosong }: { kunci: string; judul: string; kosong: string }) => (
    <label className="filter-bar__kotak">
      <span>{judul}</span>
      <select value={params[kunci] ?? ''} onChange={(e) => ubah(kunci, e.target.value)}>
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
    <div className={`filter-bar ${buka ? 'filter-bar--buka' : ''}`}>
      <button
        type="button"
        className="tombol tombol--kecil filter-bar__toggle"
        aria-expanded={buka}
        onClick={() => setBuka((b) => !b)}
      >
        <Icon nama="pengaturan" size={15} />
        Filter{aktifSemua ? ` (${aktifSemua})` : ''}
      </button>

      <div className="filter-bar__isi">
        <div className="filter-bar__periode" role="group" aria-label="Periode laporan">
          {PERIODE.map((p) => (
            <button
              key={p.nilai}
              type="button"
              className={`filter-bar__periode-tombol ${params.periode === p.nilai ? 'aktif' : ''}`}
              onClick={() => ubah('periode', p.nilai)}
            >
              {p.teks}
            </button>
          ))}
        </div>

        {params.periode === 'kustom' && (
          <div className="filter-bar__rentang">
            <label>
              <span>Dari</span>
              <input type="date" value={params.dari} onChange={(e) => ubah('dari', e.target.value)} />
            </label>
            <label>
              <span>Sampai</span>
              <input type="date" value={params.sampai} onChange={(e) => ubah('sampai', e.target.value)} />
            </label>
          </div>
        )}

        <label className="filter-bar__banding">
          <input
            type="checkbox"
            checked={params.bandingkan === '1'}
            onChange={(e) => ubah('bandingkan', e.target.checked ? '1' : '')}
          />
          Bandingkan periode sebelumnya
        </label>

        <div className="filter-bar__entitas">
          <Sel kunci="gudang" judul="Gudang" kosong="Semua gudang" />
          <Sel kunci="kasir" judul="Kasir" kosong="Semua kasir" />
          <Sel kunci="pelanggan" judul="Pelanggan" kosong="Semua pelanggan" />
          <Sel kunci="pemasok" judul="Pemasok" kosong="Semua pemasok" />
          {params.lap === 'pembelian-po' && (
            <label className="filter-bar__kotak">
              <span>Status PO</span>
              <select value={params.status_po ?? ''} onChange={(e) => ubah('status_po', e.target.value)}>
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
            <select value={params.metode} onChange={(e) => ubah('metode', e.target.value)}>
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
            <select value={params.status} onChange={(e) => ubah('status', e.target.value)}>
              {STATUS.map((s) => (
                <option key={s.nilai} value={s.nilai}>
                  {s.teks}
                </option>
              ))}
            </select>
          </label>

          <button type="button" className="tombol tombol--kecil filter-bar__reset" onClick={reset}>
            Reset filter
          </button>
          <button type="button" className="tombol tombol--kecil filter-bar__terapkan" onClick={() => setBuka(false)}>
            Terapkan
          </button>
        </div>
      </div>
    </div>
  );
}

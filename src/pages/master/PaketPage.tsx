import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '../../components/crud/Modal';
import { beritahu } from '../../components/crud/Toast';
import {
  apiDelete,
  apiGet,
  apiPost,
  apiPut,
  imporExcel,
  unduhExcel,
  urungkanImpor,
  type ImportResult,
  type ResponsDaftar,
} from '../../lib/api';
import { formatAngka } from '../../lib/format';
import { IconButton } from '../../components/IconButton';
import { MenuAksi } from '../../components/MenuAksi';
import { TombolScan } from '../../components/ScanKamera';
import { FooterDaftar } from '../../components/crud/FooterDaftar';
import { useBarisOtomatis } from '../../lib/barisOtomatis';
import { useSegarkanModul } from '../../lib/segarkan';

type ProdukOpsi = { id: number; sku: string; produk: string };
type IsiState = { key: number; product_id: number | ''; qty: string };
type FormPaket = { id: number | null; kode_box: string; barcode_box: string; nama: string; items: IsiState[] };
type Baris = Record<string, any>;

let kunciIsi = 1;

export function PaketPage() {
  const [data, setData] = useState<Baris[]>([]);
  const [total, setTotal] = useState(0);
  const [hal, setHal] = useState(1);
  const areaRef = useRef<HTMLDivElement>(null);
  const { per, mode: modeBaris, setMode: setModeBaris } = useBarisOtomatis({
    kunci: 'paket',
    areaRef,
    total,
    hal,
    setHal,
  });
  const seqMuat = useRef(0);
  const [cari, setCari] = useState('');
  const [cariTunda, setCariTunda] = useState('');
  const [barcodeFilter, setBarcodeFilter] = useState('');
  const [sibuk, setSibuk] = useState(false);
  const [produkOpsi, setProdukOpsi] = useState<ProdukOpsi[]>([]);

  const [form, setForm] = useState<FormPaket | null>(null);
  const [kirim, setKirim] = useState(false);
  const [hapusTarget, setHapusTarget] = useState<Baris | null>(null);
  const [hasilImpor, setHasilImpor] = useState<ImportResult | null>(null);
  const fileImpor = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setCariTunda(cari);
      setHal(1);
    }, 350);
    return () => window.clearTimeout(t);
  }, [cari]);

  const muatProduk = useCallback(() => {
    apiGet<ResponsDaftar<Record<string, any>>>('/api/master/produk/pemilih?per=1000&aktif=1')
      .then((r) => setProdukOpsi(r.data.map((v) => ({ id: Number(v.id), sku: String(v.sku), produk: String(v.produk_nama) }))))
      .catch((e: Error) => beritahu(e.message, 'galat'));
  }, []);

  useEffect(() => {
    muatProduk();
  }, [muatProduk]);

  const muat = useCallback(async () => {
    const seq = ++seqMuat.current;
    setSibuk(true);
    try {
      const q = new URLSearchParams({ hal: String(hal), per: String(per), cari: cariTunda });
      if (barcodeFilter) q.set('barcode', barcodeFilter);
      const r = await apiGet<ResponsDaftar<Baris>>(`/api/master/paket?${q.toString()}`);
      if (seq !== seqMuat.current) return; // respons usang (per/hal berubah)
      setData(r.data);
      setTotal(r.total);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      if (seq === seqMuat.current) setSibuk(false);
    }
  }, [hal, per, cariTunda, barcodeFilter]);

  useEffect(() => {
    void muat();
  }, [muat]);
  // Tombol Refresh global di topbar: muat ulang daftar paket.
  useSegarkanModul(muat);

  const totalHal = Math.max(1, Math.ceil(total / per));
  const totalPcsForm = (form?.items ?? []).reduce((a, i) => a + (Number(i.qty) || 0), 0);

  const buatBaru = () => {
    muatProduk();
    setForm({ id: null, kode_box: '', barcode_box: '', nama: '', items: [{ key: kunciIsi++, product_id: '', qty: '1' }] });
  };

  const ubahPaket = async (baris: Baris) => {
    try {
      muatProduk();
      const r = await apiGet<{ data: Baris }>(`/api/master/paket/${baris.id}`);
      const p = r.data;
      setForm({
        id: Number(p.id),
        kode_box: String(p.kode_box ?? ''),
        barcode_box: p.barcode_box ?? '',
        nama: String(p.nama ?? ''),
        items: (p.items ?? []).map((i: Baris) => ({
          key: kunciIsi++,
          product_id: Number(i.product_id),
          qty: String(i.qty),
        })),
      });
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    }
  };

  const ubahIsi = (key: number, patch: Partial<IsiState>) => {
    setForm((f) => (f ? { ...f, items: f.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) } : f));
  };

  const simpan = async () => {
    if (!form) return;
    if (!form.kode_box.trim()) return beritahu('Kode box wajib diisi.', 'galat');
    if (!form.nama.trim()) return beritahu('Nama paket wajib diisi.', 'galat');
    if (form.items.length === 0 || form.items.some((i) => i.product_id === '')) {
      return beritahu('Lengkapi daftar isi paket (produk + qty).', 'galat');
    }
    if (form.items.some((i) => !(Number(i.qty) > 0))) return beritahu('Qty isi harus lebih dari 0.', 'galat');

    setKirim(true);
    try {
      const body = {
        kode_box: form.kode_box.trim(),
        barcode_box: form.barcode_box.trim() || null,
        nama: form.nama.trim(),
        items: form.items.map((i) => ({ product_id: Number(i.product_id), qty: Number(i.qty) })),
      };
      if (form.id) await apiPut(`/api/master/paket/${form.id}`, body);
      else await apiPost('/api/master/paket', body);
      beritahu(form.id ? 'Paket diperbarui.' : 'Paket ditambahkan.');
      setForm(null);
      await muat();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setKirim(false);
    }
  };

  const konfirmasiHapus = async () => {
    if (!hapusTarget) return;
    try {
      await apiDelete(`/api/master/paket/${hapusTarget.id}`);
      beritahu('Paket dihapus.');
      setHapusTarget(null);
      await muat();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
      setHapusTarget(null);
    }
  };

  const ekspor = async () => {
    try {
      await unduhExcel('/api/master/paket/ekspor', `paket-${new Date().toISOString().slice(0, 10)}.xlsx`);
      beritahu('Berkas Excel diunduh.');
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    }
  };

  const prosesImpor = async (file: File) => {
    try {
      const hasil = await imporExcel('paket', file);
      setHasilImpor(hasil);
      beritahu(
        hasil.baris_error === 0
          ? `Impor selesai: ${hasil.baris_valid} baris masuk.`
          : `Impor: ${hasil.baris_valid} masuk, ${hasil.baris_error} gagal.`,
        hasil.baris_valid ? 'info' : 'galat',
      );
      await muat();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      if (fileImpor.current) fileImpor.current.value = '';
    }
  };

  return (
    <div className="halaman halaman--fit">
      <section className="kartu kartu--daftar">
        <div className="kartu__kepala kartu__kepala--kompak">
          <div>
            <h3>Paket / Box</h3>
            <p className="teks-redup teks-kecil">Kumpulan produk dalam satu box — total pcs isi box dihitung otomatis.</p>
          </div>
          <span className="kartu__jumlah">{total} paket</span>
          <div className="tombol-baris">
            <MenuAksi
              label="Aksi paket / box"
              items={[
                { label: 'Ekspor Excel', jalan: () => void ekspor() },
                { label: 'Template Impor', jalan: () => void unduhExcel('/api/master/paket/template', 'template-paket.xlsx') },
                { label: 'Impor Excel', jalan: () => fileImpor.current?.click() },
              ]}
            />
            <IconButton
              label="Tambah Paket"
              ikon="plus"
              ukuran="toolbar"
              warna="primer"
              arah="bawah"
              onClick={buatBaru}
            />
          </div>
        </div>

        <div className="alat-tabel toolbar-kompak">
          <div className="cari-scan">
          <input
            className="input-cari"
            type="search"
            placeholder="Cari kode box, barcode box, nama, atau SKU isi…"
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
            value={barcodeFilter}
            onChange={(e) => {
              setBarcodeFilter(e.target.value);
              setHal(1);
            }}
            aria-label="Filter barcode box"
          >
            <option value="">Semua barcode</option>
            <option value="sudah">Sudah ada barcode</option>
            <option value="belum">Belum ada barcode</option>
          </select>
          </span>
        </div>

        <div ref={areaRef} className="tabel-bungkus">
          <table className="tabel">
            <thead>
              <tr>
                <th>Kode Box</th>
                <th>Barcode Box</th>
                <th>Nama Paket</th>
                <th className="rata-tengah">Produk</th>
                <th className="rata-kanan">Total Pcs</th>
                <th className="rata-kanan kolom-aksi">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {sibuk && data.length === 0 ? (
                <tr><td colSpan={6} className="tabel-kosong">Memuat…</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={6} className="tabel-kosong">Tidak ada paket{cariTunda ? ` untuk "${cariTunda}"` : ''}.</td></tr>
              ) : (
                data.map((b) => (
                  <tr key={b.id}>
                    <td><code>{b.kode_box}</code></td>
                    <td>{b.barcode_box ?? '—'}</td>
                    <td>{b.nama}</td>
                    <td className="rata-tengah">{formatAngka(Number(b.jumlah_produk ?? 0))}</td>
                    <td className="rata-kanan">
                      <strong>{formatAngka(Number(b.total_pcs ?? 0))}</strong> pcs
                    </td>
                    <td className="rata-kanan kolom-aksi">
                      <span className="aksi-baris">
                        <IconButton label="Ubah" ikon="pencil" onClick={() => void ubahPaket(b)} />
                        <IconButton
                          label="Hapus"
                          ikon="trash"
                          warna="bahaya"
                          duaKetuk
                          onClick={() => setHapusTarget(b)}
                        />
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <FooterDaftar
          mode={modeBaris}
          onMode={setModeBaris}
          hal={hal}
          totalHal={totalHal}
          total={total}
          onHal={setHal}
        />
      </section>

      <input
        ref={fileImpor}
        type="file"
        accept=".xlsx,.xls"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void prosesImpor(f);
        }}
      />

      {form && (
        <Modal
          judul={form.id ? 'Ubah Paket' : 'Tambah Paket'}
          lebar="sedang"
          onTutup={() => setForm(null)}
          sedangKirim={kirim}
          aksi={
            <>
              <span className="teks-sukses teks-kecil"><strong>Total {formatAngka(totalPcsForm)} pcs isi box</strong></span>
              <button type="button" className="tombol tombol--netral" onClick={() => setForm(null)} disabled={kirim}>Batal</button>
              <button type="button" className="tombol tombol--primer" onClick={() => void simpan()} disabled={kirim}>
                {kirim ? 'Menyimpan…' : 'Simpan Paket'}
              </button>
            </>
          }
        >
          <div className="form-grid">
            <label className="bidang">
              <span>Kode Box <em className="wajib">*</em></span>
              <input value={form.kode_box} onChange={(e) => setForm({ ...form, kode_box: e.target.value })} placeholder="BOX-001" />
            </label>
            <label className="bidang">
              <span>Barcode Box</span>
              <input value={form.barcode_box} onChange={(e) => setForm({ ...form, barcode_box: e.target.value })} placeholder="899…" />
            </label>
            <label className="bidang bidang--lebar">
              <span>Nama Paket <em className="wajib">*</em></span>
              <input value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} placeholder="Dus Isi 12" />
            </label>
          </div>

          <div className="panel-kepala">
            <h4>Isi Paket</h4>
            <button
              type="button"
              className="tombol tombol--kecil tombol--netral"
              onClick={() => setForm({ ...form, items: [...form.items, { key: kunciIsi++, product_id: '', qty: '1' }] })}
            >
              + Tambah isi
            </button>
          </div>

          <div className="isi-paket">
            {form.items.map((i) => (
              <div className="isi-paket__baris" key={i.key}>
                <select value={String(i.product_id)} onChange={(e) => ubahIsi(i.key, { product_id: e.target.value === '' ? '' : Number(e.target.value) })}>
                  <option value="">— pilih produk —</option>
                  {produkOpsi.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.sku} — {v.produk}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  value={i.qty}
                  placeholder="Qty"
                  onChange={(e) => ubahIsi(i.key, { qty: e.target.value })}
                  aria-label="Qty"
                />
                <span className="teks-redup teks-kecil">pcs</span>
                <button
                  type="button"
                  className="tombol tombol--kecil tombol--bahaya"
                  onClick={() => setForm({ ...form, items: form.items.filter((x) => x.key !== i.key) })}
                >
                  Hapus
                </button>
              </div>
            ))}
            {form.items.length === 0 && <p className="teks-redup">Belum ada isi. Klik “+ Tambah isi”.</p>}
          </div>

          <p className="teks-redup teks-kecil">
            Format impor Excel: kolom “Isi (SKU xQty)” dipisah titik koma, contoh: <code>SKU-A x12; SKU-B x4</code>
          </p>
        </Modal>
      )}

      {hapusTarget && (
        <Modal
          judul="Hapus Paket?"
          lebar="kecil"
          onTutup={() => setHapusTarget(null)}
          aksi={
            <>
              <button type="button" className="tombol tombol--netral" onClick={() => setHapusTarget(null)}>Batal</button>
              <button type="button" className="tombol tombol--bahaya" onClick={() => void konfirmasiHapus()}>Hapus</button>
            </>
          }
        >
          <p>
            Paket <strong>{String(hapusTarget.nama)} ({String(hapusTarget.kode_box)})</strong> akan dihapus.
          </p>
          <p className="teks-redup teks-kecil">Paket yang sudah tercatat di dokumen pembelian tidak bisa dihapus.</p>
        </Modal>
      )}

      {hasilImpor && (
        <Modal
          judul="Hasil Impor Paket"
          lebar={hasilImpor.errors.length ? 'lebar' : 'kecil'}
          onTutup={() => setHasilImpor(null)}
          aksi={
            <>
              {hasilImpor.urungkan_tersedia && hasilImpor.batch_id && (
                <button
                  type="button"
                  className="tombol tombol--netral"
                  onClick={() =>
                    void urungkanImpor('paket', hasilImpor.batch_id)
                      .then((r) => {
                        beritahu(r.pesan);
                        setHasilImpor(null);
                        return muat();
                      })
                      .catch((err) => beritahu((err as Error).message, 'galat'))
                  }
                >
                  Urungkan impor ini
                </button>
              )}
              <button type="button" className="tombol tombol--primer" onClick={() => setHasilImpor(null)}>Tutup</button>
            </>
          }
        >
          <p>
            <strong>{hasilImpor.total_baris}</strong> baris diproses ·{' '}
            <strong className="teks-sukses">{hasilImpor.baris_valid} masuk</strong>
            {typeof hasilImpor.jumlah_baru === 'number'
              ? ` (${hasilImpor.jumlah_baru} baru · ${hasilImpor.jumlah_perbarui ?? 0} diperbarui)`
              : ''}
            {hasilImpor.baris_dilewati > 0 ? ` · ${hasilImpor.baris_dilewati} dilewati` : ''} ·{' '}
            <strong className="teks-galat">{hasilImpor.baris_error} gagal</strong>
          </p>
          {hasilImpor.errors.length > 0 && (
            <ul className="daftar-error">
              {hasilImpor.errors.slice(0, 20).map((e, i) => (
                <li key={i}>Baris {e.nomor_baris}: {e.pesan}</li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </div>
  );
}

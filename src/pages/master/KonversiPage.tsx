import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '../../components/crud/Modal';
import { beritahu } from '../../components/crud/Toast';
import { ambilOpsi, apiDelete, apiGet, apiPost, imporExcel, unduhExcel, urungkanImpor, type ImportResult, type ResponsDaftar } from '../../lib/api';
import { formatAngka } from '../../lib/format';
import { IconButton } from '../../components/IconButton';
import { MenuAksi } from '../../components/MenuAksi';
import { TombolScan } from '../../components/ScanKamera';
import { FooterDaftar } from '../../components/crud/FooterDaftar';
import { useBarisOtomatis } from '../../lib/barisOtomatis';
import { useSegarkanModul } from '../../lib/segarkan';

type Opsi = { id: number; label: string };
type ProdukOpsi = { id: number; sku: string; produk: string };
type BarisKonversi = Record<string, any>;

export function KonversiPage() {
  const [data, setData] = useState<BarisKonversi[]>([]);
  const [total, setTotal] = useState(0);
  const [hal, setHal] = useState(1);
  const areaRef = useRef<HTMLDivElement>(null);
  const { per, mode: modeBaris, setMode: setModeBaris } = useBarisOtomatis({
    kunci: 'konversi',
    areaRef,
    total,
    hal,
    setHal,
  });
  const seqMuat = useRef(0);
  const [cari, setCari] = useState('');
  const [cariTunda, setCariTunda] = useState('');
  const [unitFilter, setUnitFilter] = useState('');
  const [sibuk, setSibuk] = useState(false);
  const [hasilImpor, setHasilImpor] = useState<ImportResult | null>(null);
  const fileImpor = useRef<HTMLInputElement>(null);

  const [opsiSatuan, setOpsiSatuan] = useState<Opsi[]>([]);
  const [produkOpsi, setProdukOpsi] = useState<ProdukOpsi[]>([]);

  const [form, setForm] = useState<{ id: number | null; product_id: number | ''; unit_id: number | ''; jumlah: string } | null>(null);
  const [kirim, setKirim] = useState(false);
  const [hapusTarget, setHapusTarget] = useState<BarisKonversi | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setCariTunda(cari);
      setHal(1);
    }, 350);
    return () => window.clearTimeout(t);
  }, [cari]);

  const muatOpsi = useCallback(() => {
    ambilOpsi('satuan').then(setOpsiSatuan).catch((e: Error) => beritahu(e.message, 'galat'));
    apiGet<ResponsDaftar<Record<string, any>>>('/api/master/produk/pemilih?per=1000&aktif=1')
      .then((r) => setProdukOpsi(r.data.map((v) => ({ id: Number(v.id), sku: String(v.sku), produk: String(v.produk_nama) }))))
      .catch((e: Error) => beritahu(e.message, 'galat'));
  }, []);

  useEffect(() => {
    muatOpsi();
  }, [muatOpsi]);

  const muat = useCallback(async () => {
    const seq = ++seqMuat.current;
    setSibuk(true);
    try {
      const q = new URLSearchParams({ hal: String(hal), per: String(per), cari: cariTunda });
      if (unitFilter) q.set('unit_id', unitFilter);
      const r = await apiGet<ResponsDaftar<BarisKonversi>>(`/api/master/konversi?${q.toString()}`);
      if (seq !== seqMuat.current) return; // respons usang (per/hal berubah)
      setData(r.data);
      setTotal(r.total);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      if (seq === seqMuat.current) setSibuk(false);
    }
  }, [hal, per, cariTunda, unitFilter]);

  useEffect(() => {
    void muat();
  }, [muat]);
  // Tombol Refresh global di topbar: muat ulang daftar konversi.
  useSegarkanModul(muat);

  const totalHal = Math.max(1, Math.ceil(total / per));

  const ekspor = async () => {
    try {
      const q = new URLSearchParams();
      if (cariTunda) q.set('cari', cariTunda);
      if (unitFilter) q.set('unit_id', unitFilter);
      await unduhExcel(`/api/master/konversi/ekspor?${q.toString()}`, `konversi-satuan-${new Date().toISOString().slice(0, 10)}.xlsx`);
      beritahu('Berkas Excel diunduh.');
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    }
  };

  const prosesImpor = async (file: File) => {
    try {
      const hasil = await imporExcel('konversi', file);
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

  const simpan = async () => {
    if (!form) return;
    if (form.product_id === '') return beritahu('Pilih produk terlebih dahulu.', 'galat');
    if (form.unit_id === '') return beritahu('Pilih satuan.', 'galat');
    if (!(Number(form.jumlah) > 0)) return beritahu('Jumlah harus lebih dari 0.', 'galat');
    setKirim(true);
    try {
      const body = {
        product_id: Number(form.product_id),
        unit_id: Number(form.unit_id),
        jumlah_per_satuan_dasar: Number(form.jumlah),
      };
      if (form.id) {
        await apiDelete(`/api/master/konversi/${form.id}`);
      }
      await apiPost('/api/master/konversi', body);
      beritahu(form.id ? 'Konversi diperbarui.' : 'Konversi ditambahkan.');
      setForm(null);
      await muat();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setKirim(false);
    }
  };

  const hapus = async () => {
    if (!hapusTarget) return;
    try {
      await apiDelete(`/api/master/konversi/${hapusTarget.id}`);
      beritahu('Konversi dihapus.');
      setHapusTarget(null);
      await muat();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
      setHapusTarget(null);
    }
  };

  return (
    <div className="halaman halaman--fit">
      <section className="kartu kartu--daftar">
        <div className="kartu__kepala kartu__kepala--kompak">
          <div>
            <h3>Konversi Satuan per Produk</h3>
            <p className="teks-redup teks-kecil">Contoh: 1 lusin = 12 pcs, 1 kodi = 20 pcs. Dipakai POS & pembelian satuan besar.</p>
          </div>
          <span className="kartu__jumlah">{total} konversi</span>
          <div className="tombol-baris">
            <MenuAksi
              label="Aksi konversi satuan"
              items={[
                { label: 'Ekspor Excel', jalan: () => void ekspor() },
                { label: 'Template Impor', jalan: () => void unduhExcel('/api/master/konversi/template', 'template-konversi.xlsx') },
                { label: 'Impor Excel', jalan: () => fileImpor.current?.click() },
              ]}
            />
            <IconButton
              label="Tambah Konversi"
              ikon="plus"
              ukuran="toolbar"
              warna="primer"
              arah="bawah"
              onClick={() => setForm({ id: null, product_id: '', unit_id: '', jumlah: '' })}
            />
          </div>
        </div>

        <div className="alat-tabel toolbar-kompak">
          <div className="cari-scan">
          <input
            className="input-cari"
            type="search"
            placeholder="Cari produk, SKU, atau satuan…"
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
            value={unitFilter}
            onChange={(e) => {
              setUnitFilter(e.target.value);
              setHal(1);
            }}
            aria-label="Filter satuan"
          >
            <option value="">Semua satuan</option>
            {opsiSatuan.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          </span>
        </div>

        <div ref={areaRef} className="tabel-bungkus">
          <table className="tabel">
            <thead>
              <tr>
                <th>Produk</th>
                <th>SKU</th>
                <th>Satuan</th>
                <th className="rata-kanan">Jumlah per Satuan Dasar</th>
                <th className="rata-kanan kolom-aksi">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {sibuk && data.length === 0 ? (
                <tr><td colSpan={5} className="tabel-kosong">Memuat…</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={5} className="tabel-kosong">Belum ada konversi{cariTunda ? ` untuk "${cariTunda}"` : ''}.</td></tr>
              ) : (
                data.map((b) => (
                  <tr key={b.id}>
                    <td>{b.produk_nama}</td>
                    <td><code>{b.sku}</code></td>
                    <td>{b.unit_nama} ({b.unit_kode})</td>
                    <td className="rata-kanan">{formatAngka(Number(b.jumlah_per_satuan_dasar))}</td>
                    <td className="rata-kanan kolom-aksi">
                      <span className="aksi-baris">
                        <IconButton
                          label="Ubah"
                          ikon="pencil"
                          onClick={() =>
                            setForm({
                              id: Number(b.id),
                              product_id: Number(b.product_id),
                              unit_id: Number(b.unit_id),
                              jumlah: String(b.jumlah_per_satuan_dasar),
                            })
                          }
                        />
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

      {hasilImpor && (
        <Modal
          judul="Hasil Impor Konversi"
          lebar={hasilImpor.errors.length ? 'lebar' : 'kecil'}
          onTutup={() => setHasilImpor(null)}
          aksi={
            <>
              {hasilImpor.urungkan_tersedia && hasilImpor.batch_id && (
                <button
                  type="button"
                  className="tombol tombol--netral"
                  onClick={() =>
                    void urungkanImpor('konversi', hasilImpor.batch_id)
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

      {form && (
        <Modal
          judul={form.id ? 'Ubah Konversi Satuan' : 'Tambah Konversi Satuan'}
          lebar="kecil"
          onTutup={() => setForm(null)}
          sedangKirim={kirim}
          aksi={
            <>
              <button type="button" className="tombol tombol--netral" onClick={() => setForm(null)} disabled={kirim}>Batal</button>
              <button type="button" className="tombol tombol--primer" onClick={() => void simpan()} disabled={kirim}>
                {kirim ? 'Menyimpan…' : 'Simpan'}
              </button>
            </>
          }
        >
          <div className="form-grid">
            <label className="bidang bidang--lebar">
              <span>Produk <em className="wajib">*</em></span>
              <select
                value={String(form.product_id)}
                disabled={Boolean(form.id)}
                onChange={(e) => setForm({ ...form, product_id: e.target.value === '' ? '' : Number(e.target.value) })}
              >
                <option value="">— pilih produk —</option>
                {produkOpsi.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.sku} — {v.produk}
                  </option>
                ))}
              </select>
            </label>
            <label className="bidang bidang--lebar">
              <span>Satuan <em className="wajib">*</em></span>
              <select value={String(form.unit_id)} onChange={(e) => setForm({ ...form, unit_id: e.target.value === '' ? '' : Number(e.target.value) })}>
                <option value="">— pilih satuan —</option>
                {opsiSatuan.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="bidang bidang--lebar">
              <span>Jumlah per satuan dasar <em className="wajib">*</em></span>
              <input type="number" min={0} value={form.jumlah} onChange={(e) => setForm({ ...form, jumlah: e.target.value })} placeholder="12" />
            </label>
          </div>
          <p className="teks-redup teks-kecil">Isi dengan jumlah pcs dalam 1 satuan. Bila produk + satuan sudah ada, konversi lama akan diperbarui.</p>
        </Modal>
      )}

      {hapusTarget && (
        <Modal
          judul="Hapus Konversi?"
          lebar="kecil"
          onTutup={() => setHapusTarget(null)}
          aksi={
            <>
              <button type="button" className="tombol tombol--netral" onClick={() => setHapusTarget(null)}>Batal</button>
              <button type="button" className="tombol tombol--bahaya" onClick={() => void hapus()}>Hapus</button>
            </>
          }
        >
          <p>
            Konversi <strong>{String(hapusTarget.sku)} → {String(hapusTarget.unit_nama)}</strong> akan dihapus.
          </p>
        </Modal>
      )}
    </div>
  );
}

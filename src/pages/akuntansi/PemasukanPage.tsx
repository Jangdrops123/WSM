import { useCallback, useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPost } from '../../lib/api';
import { useSegarkanModul } from '../../lib/segarkan';
import { beritahu } from '../../components/crud/Toast';
import { Modal } from '../../components/crud/Modal';
import { Icon } from '../../components/Icon';
import { useSesi } from '../../lib/sesi';
import { can, type AksiMatriks } from '../../lib/hak';
import { rp, type AkunKas, type KategoriKas, type MutasiKas } from './tipe';
import './akuntansi.css';

/**
 * PEMASUKAN LAIN (Akuntansi Dasar) — catat pendapatan di luar penjualan per
 * kategori (bisa ditambah). Setiap catatan = Kas Masuk + kategori pemasukan.
 */
export function PemasukanPage() {
  // AX — gerbang tombol dari matriks modul akuntansi.
  const info = useSesi().info;
  const bisa = (...a: AksiMatriks[]): boolean => can(info, 'akuntansi', ...a);
  const [kategori, setKategori] = useState<KategoriKas[]>([]);
  const [akun, setAkun] = useState<AkunKas[]>([]);
  const [daftar, setDaftar] = useState<MutasiKas[]>([]);
  const [dari, setDari] = useState(`${new Date().getFullYear()}-01-01`);
  const [sampai, setSampai] = useState(new Date().toISOString().slice(0, 10));
  const [mode, setMode] = useState<false | 'kategori'>(false);
  const [pandangan, setPandangan] = useState<'riwayat' | 'input' | 'kategori'>('riwayat');
  const [kirim, setKirim] = useState(false);

  const kosong = { tanggal: new Date().toISOString().slice(0, 10), akun_id: '', kategori_id: '', jumlah: '', keterangan: '' };
  const [form, setForm] = useState(kosong);
  const [namaKategori, setNamaKategori] = useState('');

  const muat = useCallback(async () => {
    const q = new URLSearchParams({ dari, sampai, tipe: 'masuk' });
    const r = await apiGet<{ data: MutasiKas[] }>(`/api/akuntansi/kas/mutasi?${q.toString()}`);
    // Hanya mutasi berkategori pemasukan (bukan penjualan — penjualan tanpa kategori).
    setDaftar(r.data.filter((m) => m.kategori));
  }, [dari, sampai]);

  useEffect(() => {
    void muat().catch((e: Error) => beritahu(e.message, 'galat'));
  }, [muat]);
  // Tombol Refresh global di topbar: muat ulang daftar pemasukan.
  useSegarkanModul(muat);

  useEffect(() => {
    void Promise.all([
      apiGet<{ data: KategoriKas[] }>('/api/akuntansi/kategori?tipe=pemasukan').then((r) => setKategori(r.data)),
      apiGet<{ data: AkunKas[] }>('/api/akuntansi/kas/akun').then((r) => setAkun(r.data.filter((a) => a.aktif))),
    ]).catch(() => undefined);
  }, []);

  const simpan = async () => {
    setKirim(true);
    try {
      await apiPost('/api/akuntansi/pemasukan', {
        tanggal: form.tanggal,
        akun_id: Number(form.akun_id),
        kategori_id: Number(form.kategori_id),
        jumlah: Number(form.jumlah),
        keterangan: form.keterangan,
      });
      beritahu('Pemasukan lain tercatat sebagai Kas Masuk.', 'sukses');
      setPandangan('riwayat');
      setForm(kosong);
      await muat();
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    } finally {
      setKirim(false);
    }
  };

  const tambahKategori = async () => {
    setKirim(true);
    try {
      await apiPost('/api/akuntansi/kategori', { nama: namaKategori, tipe: 'pemasukan' });
      beritahu('Kategori pemasukan ditambahkan.', 'sukses');
      setMode(false);
      setNamaKategori('');
      const r = await apiGet<{ data: KategoriKas[] }>('/api/akuntansi/kategori?tipe=pemasukan');
      setKategori(r.data);
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    } finally {
      setKirim(false);
    }
  };

  const hapusKategori = async (k: KategoriKas) => {
    try {
      await apiDelete(`/api/akuntansi/kategori/${k.id}`);
      beritahu(`Kategori "${k.nama}" dihapus/dinonaktifkan.`, 'sukses');
      const r = await apiGet<{ data: KategoriKas[] }>('/api/akuntansi/kategori?tipe=pemasukan');
      setKategori(r.data);
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    }
  };

  const total = daftar.reduce((n, m) => n + Number(m.jumlah), 0);

  return (
    <div className="halaman akuntansi">
      {/* ============ Satu kartu terpadu: header + token + isi ============ */}
      <section className="kartu">
        <div className="tokenbar kepala-kartu">
          <div>
            <h3>Pemasukan Lain</h3>
            <p className="teks-redup teks-kecil">Catat pendapatan di luar penjualan per kategori & rekening kas.</p>
          </div>
          <div className="token-grup" role="tablist" aria-label="Navigasi modul pemasukan">
            <button
              type="button"
              role="tab"
              aria-selected={pandangan === 'riwayat'}
              className={`token${pandangan === 'riwayat' ? ' token--aktif' : ''}`}
              onClick={() => setPandangan('riwayat')}
              title="Riwayat Pemasukan"
              aria-label="Riwayat Pemasukan"
            >
              <Icon nama="menu" size={16} />
              <span>Riwayat</span>
            </button>
            {bisa('tambah') && (
              <button
                type="button"
                role="tab"
                aria-selected={pandangan === 'input'}
                className={`token${pandangan === 'input' ? ' token--aktif' : ''}`}
                onClick={() => { setForm(kosong); setPandangan('input'); }}
                title="Catat Pemasukan"
                aria-label="Catat Pemasukan"
              >
                <Icon nama="plus" size={16} />
                <span>Catat</span>
              </button>
            )}
            <button
              type="button"
              role="tab"
              aria-selected={pandangan === 'kategori'}
              className={`token${pandangan === 'kategori' ? ' token--aktif' : ''}`}
              onClick={() => setPandangan('kategori')}
              title="Kategori Pemasukan"
              aria-label="Kategori Pemasukan"
            >
              <Icon nama="tag" size={16} />
              <span>Kategori</span>
            </button>
          </div>
        </div>
        {pandangan === 'riwayat' && (
        <>
        <div className="alat-tabel">
          <label className="teks-kecil">Dari
            <input type="date" className="input-cari" value={dari} onChange={(e) => setDari(e.target.value)} />
          </label>
          <label className="teks-kecil">Sampai
            <input type="date" className="input-cari" value={sampai} onChange={(e) => setSampai(e.target.value)} />
          </label>
          <span className="teks-redup teks-kecil">Total pemasukan periode: <strong>{rp(total)}</strong></span>
        </div>
        <div className="tabel-bungkus">
          <table className="tabel">
            <thead>
              <tr>
                <th style={{ width: 100 }}>Tanggal</th>
                <th style={{ width: 150 }}>Nomor</th>
                <th>Kategori</th>
                <th>Rekening Kas</th>
                <th>Keterangan</th>
                <th className="rata-kanan" style={{ width: 130 }}>Jumlah</th>
              </tr>
            </thead>
            <tbody>
              {daftar.length === 0 && <tr><td colSpan={6} className="tabel-kosong">Belum ada pemasukan lain tercatat pada periode ini.</td></tr>}
              {daftar.map((m) => (
                <tr key={m.id}>
                  <td>{String(m.tanggal).slice(0, 10)}</td>
                  <td><code>{m.nomor}</code></td>
                  <td>{m.kategori ?? '—'}</td>
                  <td>{m.akun_kode} {m.akun_nama}</td>
                  <td>{m.keterangan ?? '—'}</td>
                  <td className="rata-kanan">{rp(m.jumlah)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
        )}
        {pandangan === 'kategori' && (
        <>
        <div className="alat-tabel">
          <span className="kartu__jumlah">{kategori.length} kategori</span>
          {bisa('tambah') && (
            <button type="button" className="tombol tombol--kecil" onClick={() => { setNamaKategori(''); setMode('kategori'); }}>+ Tambah Kategori</button>
          )}
        </div>
        <div className="tabel-bungkus">
          <table className="tabel">
            <thead>
              <tr>
                <th>Nama</th>
                <th style={{ width: 90 }}>Status</th>
                <th style={{ width: 120 }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {kategori.map((k) => (
                <tr key={k.id}>
                  <td>{k.nama}</td>
                  <td>{k.aktif ? 'Aktif' : 'Nonaktif'}</td>
                  <td>{bisa('hapus') && <button type="button" className="tombol tombol--kecil" onClick={() => void hapusKategori(k)}>Hapus</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
        )}
        {pandangan === 'input' && bisa('tambah') && (
        <>
        <div className="kartu__kepala kartu__kepala--kompak">
          <div>
            <h3>Catat Pemasukan Lain</h3>
            <p className="teks-redup teks-kecil">Setiap catatan = Kas Masuk + kategori pemasukan.</p>
          </div>
          <button type="button" className="tombol tombol--netral tombol--kecil" onClick={() => setPandangan('riwayat')} title="Kembali ke Riwayat">
            ← Kembali ke Riwayat
          </button>
        </div>
          <div className="form-grid">
            <label>
              Tanggal
              <input type="date" className="input-cari" value={form.tanggal} onChange={(e) => setForm({ ...form, tanggal: e.target.value })} />
            </label>
            <label>
              Jumlah (Rp)
              <input type="number" min={0} className="input-cari" value={form.jumlah} onChange={(e) => setForm({ ...form, jumlah: e.target.value })} />
            </label>
            <label>
              Kategori pemasukan
              <select className="input-pilih" value={form.kategori_id} onChange={(e) => setForm({ ...form, kategori_id: e.target.value })}>
                <option value="">— pilih kategori —</option>
                {kategori.filter((k) => k.aktif).map((k) => (
                  <option key={k.id} value={k.id}>{k.nama}</option>
                ))}
              </select>
            </label>
            <label>
              Rekening kas/bank (masuk)
              <select className="input-pilih" value={form.akun_id} onChange={(e) => setForm({ ...form, akun_id: e.target.value })}>
                <option value="">— pilih rekening —</option>
                {akun.map((a) => (
                  <option key={a.id} value={a.id}>{a.kode} — {a.nama}</option>
                ))}
              </select>
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Keterangan
              <input className="input-cari" value={form.keterangan} onChange={(e) => setForm({ ...form, keterangan: e.target.value })} />
            </label>
          </div>
          <div className="tombol-baris" style={{ marginTop: 12 }}>
            <button type="button" className="tombol tombol--primer" disabled={kirim || !form.kategori_id || !form.akun_id || !(Number(form.jumlah) > 0)} onClick={() => void simpan()}>
              {kirim ? 'Menyimpan…' : 'Catat Pemasukan'}
            </button>
            <button type="button" className="tombol tombol--netral" onClick={() => { setForm(kosong); setPandangan('riwayat'); }}>Batal</button>
          </div>
        </>
        )}
      </section>

      {mode === 'kategori' && (
        <Modal
          judul="Tambah Kategori Pemasukan"
          lebar="kecil"
          onTutup={() => setMode(false)}
          aksi={
            <>
              <button type="button" className="tombol" onClick={() => setMode(false)}>Batal</button>
              <button type="button" className="tombol tombol--primer" disabled={kirim || !namaKategori.trim()} onClick={() => void tambahKategori()}>
                {kirim ? 'Menyimpan…' : 'Tambah'}
              </button>
            </>
          }
        >
          <label>
            Nama kategori
            <input className="input-cari" value={namaKategori} onChange={(e) => setNamaKategori(e.target.value)} autoFocus />
          </label>
        </Modal>
      )}
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPost, apiPut, unduhExcel } from '../../lib/api';
import { useSegarkanModul } from '../../lib/segarkan';
import { beritahu } from '../../components/crud/Toast';
import { Modal } from '../../components/crud/Modal';
import { IconButton } from '../../components/IconButton';
import { Icon } from '../../components/Icon';
import { useSesi } from '../../lib/sesi';
import { can, type AksiMatriks } from '../../lib/hak';
import { JENIS_REKENING, rp, type AkunKas, type KategoriKas, type MutasiKas } from './tipe';
import './akuntansi.css';

type Mode = 'masuk' | 'keluar' | 'transfer' | null;
type ModeAkun = 'tambah' | 'ubah' | null;

const JENIS_LABEL: Record<string, string> = { kas: 'Kas', bank: 'Bank', 'e-wallet': 'E-Wallet' };
/**
 * KAS & BANK (Akuntansi Dasar) — daftar rekening kas/bank (nama, jenis, saldo
 * awal, saldo sekarang) + tambah/ubah/nonaktifkan, serta transaksi Kas Masuk,
 * Kas Keluar, dan Transfer antar rekening. Tanpa debit/kredit, tanpa jurnal.
 */
export function KasBankPage() {
  // AX — gerbang tombol dari matriks modul akuntansi.
  const info = useSesi().info;
  const bisa = (...a: AksiMatriks[]): boolean => can(info, 'akuntansi', ...a);
  const [akun, setAkun] = useState<AkunKas[]>([]);
  const [mutasi, setMutasi] = useState<MutasiKas[]>([]);
  const [kategori, setKategori] = useState<KategoriKas[]>([]);
  const [dari, setDari] = useState(`${new Date().getFullYear()}-01-01`);
  const [sampai, setSampai] = useState(new Date().toISOString().slice(0, 10));
  const [mode, setMode] = useState<Mode>(null);
  const [pandangan, setPandangan] = useState<'mutasi' | 'input' | 'rekening'>('mutasi');
  const [modeAkun, setModeAkun] = useState<ModeAkun>(null);
  const [editAkun, setEditAkun] = useState<AkunKas | null>(null);
  const [kirim, setKirim] = useState(false);
  const [jurnalLama, setJurnalLama] = useState(0);

  const kosong = { tanggal: new Date().toISOString().slice(0, 10), akun_id: '', akun_tujuan_id: '', kategori_id: '', jumlah: '', keterangan: '' };
  const [form, setForm] = useState(kosong);
  const kosongAkun = { kode: '', nama: '', jenis: 'kas', saldo_awal: '0' };
  const [formAkun, setFormAkun] = useState(kosongAkun);

  const muat = useCallback(async () => {
    const q = new URLSearchParams({ dari, sampai });
    const [rAkun, rMutasi] = await Promise.all([
      apiGet<{ data: AkunKas[] }>('/api/akuntansi/kas/akun'),
      apiGet<{ data: MutasiKas[] }>(`/api/akuntansi/kas/mutasi?${q.toString()}`),
    ]);
    setAkun(rAkun.data);
    setMutasi(rMutasi.data);
  }, [dari, sampai]);

  useEffect(() => {
    void muat().catch((e: Error) => beritahu(e.message, 'galat'));
  }, [muat]);
  // Tombol Refresh global di topbar: muat ulang kas & bank.
  useSegarkanModul(muat);

  useEffect(() => {
    void apiGet<{ data: KategoriKas[] }>('/api/akuntansi/kategori')
      .then((r) => setKategori(r.data))
      .catch(() => undefined);
    void apiGet<{ ada_jurnal: boolean; jumlah_jurnal: number }>('/api/akuntansi/jurnal-lama')
      .then((r) => setJurnalLama(r.jumlah_jurnal))
      .catch(() => setJurnalLama(0));
  }, []);

  const hapusJurnalLama = async () => {
    setKirim(true);
    try {
      const r = await apiDelete<{ dihapus: number }>('/api/akuntansi/jurnal-lama');
      beritahu(`${r.dihapus} jurnal lama dihapus.`, 'sukses');
      setJurnalLama(0);
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    } finally {
      setKirim(false);
    }
  };

  // --- Transaksi kas (masuk/keluar/transfer) ---
  const simpan = async () => {
    if (!mode) return;
    setKirim(true);
    try {
      const body: Record<string, unknown> = {
        tanggal: form.tanggal,
        akun_id: Number(form.akun_id),
        jumlah: Number(form.jumlah),
        keterangan: form.keterangan,
      };
      if (mode === 'transfer') body.akun_tujuan_id = Number(form.akun_tujuan_id);
      else if (form.kategori_id) body.kategori_id = Number(form.kategori_id);
      await apiPost(`/api/akuntansi/kas/${mode}`, body);
      beritahu('Transaksi kas dicatat.', 'sukses');
      setMode(null);
      setPandangan('mutasi');
      setForm(kosong);
      await muat();
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    } finally {
      setKirim(false);
    }
  };

  // --- CRUD rekening kas/bank ---
  const simpanAkun = async () => {
    if (!modeAkun) return;
    setKirim(true);
    try {
      const body = { kode: formAkun.kode, nama: formAkun.nama, jenis: formAkun.jenis, saldo_awal: Number(formAkun.saldo_awal) || 0 };
      if (modeAkun === 'ubah' && editAkun) await apiPut(`/api/akuntansi/kas/akun/${editAkun.id}`, body);
      else await apiPost('/api/akuntansi/kas/akun', body);
      beritahu('Rekening kas/bank disimpan.', 'sukses');
      setModeAkun(null);
      setEditAkun(null);
      setFormAkun(kosongAkun);
      await muat();
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    } finally {
      setKirim(false);
    }
  };

  const nonaktifkan = async (a: AkunKas) => {
    try {
      await apiDelete(`/api/akuntansi/kas/akun/${a.id}`);
      beritahu(`Rekening "${a.nama}" dinonaktifkan.`, 'sukses');
      await muat();
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    }
  };

  const bukaUbah = (a: AkunKas) => {
    setEditAkun(a);
    setFormAkun({ kode: a.kode, nama: a.nama, jenis: a.jenis, saldo_awal: String(a.saldo_awal) });
    setModeAkun('ubah');
  };

  const totalSaldo = akun.filter((a) => a.aktif).reduce((n, a) => n + Number(a.saldo ?? 0), 0);

  return (
    <div className="halaman akuntansi">
      {jurnalLama > 0 && (
        <section className="kartu">
          <div className="kartu__kepala kartu__kepala--kompak"><h3>Data Jurnal Lama</h3></div>
          <p className="teks-redup">
            Masih ada {jurnalLama} jurnal dari modul akuntansi lama. Modul Akuntansi Dasar tidak memakai jurnal —
            ekspor dulu ke Excel sebagai arsip, lalu hapus.
          </p>
          <div className="aksi-kartu">
            <button type="button" className="tombol tombol--kecil" onClick={() => void unduhExcel('/api/akuntansi/jurnal-lama/xlsx', 'ekspor-jurnal-lama.xlsx').catch((e: Error) => beritahu(e.message, 'galat'))}>Ekspor Excel</button>
            <button type="button" className="tombol tombol--kecil" disabled={kirim} onClick={() => { if (window.confirm('Hapus semua jurnal lama? Pastikan sudah diekspor.')) void hapusJurnalLama(); }}>Hapus Jurnal Lama</button>
          </div>
        </section>
      )}
      {/* ============ Satu kartu terpadu: header + token + isi ============ */}
      <section className="kartu" data-tur="rekening">
        <div className="tokenbar kepala-kartu">
          <div>
            <h3>Kas &amp; Bank</h3>
            <p className="teks-redup teks-kecil">Rekening kas/bank, mutasi kas, dan transfer antar rekening.</p>
          </div>
          <div className="token-grup" role="tablist" aria-label="Navigasi modul kas">
            <button
              type="button"
              role="tab"
              aria-selected={pandangan === 'mutasi'}
              className={`token${pandangan === 'mutasi' ? ' token--aktif' : ''}`}
              onClick={() => setPandangan('mutasi')}
              title="Mutasi Kas"
              aria-label="Mutasi Kas"
            >
              <Icon nama="menu" size={16} />
              <span>Mutasi Kas</span>
            </button>
            {bisa('tambah') && (
              <button
                type="button"
                role="tab"
                aria-selected={pandangan === 'input'}
                className={`token${pandangan === 'input' ? ' token--aktif' : ''}`}
                onClick={() => { setForm(kosong); setMode('masuk'); setPandangan('input'); }}
                title="Catat Transaksi"
                aria-label="Catat Transaksi"
              >
                <Icon nama="plus" size={16} />
                <span>Catat</span>
              </button>
            )}
            <button
              type="button"
              role="tab"
              aria-selected={pandangan === 'rekening'}
              className={`token${pandangan === 'rekening' ? ' token--aktif' : ''}`}
              onClick={() => setPandangan('rekening')}
              title="Rekening Kas & Bank"
              aria-label="Rekening Kas & Bank"
            >
              <Icon nama="sliders" size={16} />
              <span>Rekening</span>
            </button>
          </div>
        </div>
        {pandangan === 'rekening' && (
        <>
        <div className="alat-tabel akuntansi__alat-rekening">
          <span className="teks-redup teks-kecil">Total saldo (aktif): <strong>{rp(totalSaldo)}</strong></span>
          {bisa('tambah') && (
            <IconButton
              label="Tambah Rekening"
              ikon="plus"
              ukuran="toolbar"
              warna="primer"
              onClick={() => { setFormAkun(kosongAkun); setEditAkun(null); setModeAkun('tambah'); }}
            />
          )}
        </div>
        {/* Daftar rekening: satu kartu per akun — nama/kode di kiri, saldo di
            tengah-kanan, tombol aksi berkelompok dengan jarak 8px. */}
        <div className="akuntansi-rekening">
          {akun.length === 0 && <p className="akuntansi-kosong">Belum ada rekening kas/bank.</p>}
          {akun.map((a) => (
            <article
              key={a.id}
              className={`akuntansi-rekening__item${a.aktif ? '' : ' akuntansi-rekening__item--nonaktif'}`}
            >
              <div className="akuntansi-rekening__identitas">
                <strong className="akuntansi-rekening__nama">{a.nama}</strong>
                <span className="akuntansi-rekening__kode">
                  {JENIS_LABEL[a.jenis] ?? a.jenis} · {a.kode}
                </span>
                <span className="akuntansi-rekening__lencana">Saldo Awal: {rp(a.saldo_awal)}</span>
                {!a.aktif && (
                  <span className="akuntansi-rekening__lencana akuntansi-rekening__lencana--mati">Nonaktif</span>
                )}
              </div>
              <div className="akuntansi-rekening__saldo">
                <span className="akuntansi-rekening__label">Saldo aktif</span>
                <strong>{rp(a.saldo ?? 0)}</strong>
              </div>
              {(bisa('ubah') || bisa('hapus')) && (
                <div className="akuntansi-rekening__aksi">
                  {bisa('ubah') && (
                    <button type="button" className="tombol tombol--kecil" onClick={() => bukaUbah(a)}>Ubah</button>
                  )}
                  {bisa('hapus') && a.aktif === 1 && (
                    <button type="button" className="tombol tombol--kecil" onClick={() => void nonaktifkan(a)}>Nonaktifkan</button>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
        </>
        )}
        {pandangan === 'mutasi' && (
        <div data-tur="mutasi">
        <div className="alat-tabel">
          <label className="teks-kecil">Dari
            <input type="date" className="input-cari" value={dari} onChange={(e) => setDari(e.target.value)} />
          </label>
          <label className="teks-kecil">Sampai
            <input type="date" className="input-cari" value={sampai} onChange={(e) => setSampai(e.target.value)} />
          </label>
          {bisa('ekspor') && (
            <IconButton
              label="Ekspor Excel"
              ikon="download"
              ukuran="toolbar"
              onClick={() => void unduhExcel('/api/akuntansi/laporan/kas-bank/xlsx', 'kas-bank.xlsx').catch((e: Error) => beritahu(e.message, 'galat'))}
            />
          )}
        </div>
        <div className="tabel-bungkus">
          <table className="tabel">
            <thead>
              <tr>
                <th style={{ width: 100 }}>Tanggal</th>
                <th style={{ width: 150 }}>Nomor</th>
                <th style={{ width: 90 }}>Tipe</th>
                <th>Rekening</th>
                <th>Kategori</th>
                <th>Keterangan</th>
                <th className="rata-kanan" style={{ width: 120 }}>Masuk</th>
                <th className="rata-kanan" style={{ width: 120 }}>Keluar</th>
              </tr>
            </thead>
            <tbody>
              {mutasi.length === 0 && <tr><td colSpan={8} className="tabel-kosong">Tidak ada mutasi kas pada periode ini.</td></tr>}
              {mutasi.map((m) => {
                const masuk = m.tipe === 'masuk' || (m.tipe === 'transfer' && m.tujuan_nama);
                return (
                  <tr key={m.id}>
                    <td>{String(m.tanggal).slice(0, 10)}</td>
                    <td><code>{m.nomor}</code></td>
                    <td>{m.tipe === 'masuk' ? 'Masuk' : m.tipe === 'keluar' ? 'Keluar' : 'Transfer'}</td>
                    <td>{m.tipe === 'transfer' && m.tujuan_nama ? `${m.akun_nama} → ${m.tujuan_nama}` : `${m.akun_kode} ${m.akun_nama}`}</td>
                    <td>{m.kategori ?? '—'}</td>
                    <td>{m.keterangan ?? '—'}</td>
                    <td className="rata-kanan">{masuk && m.tipe !== 'transfer' ? rp(m.jumlah) : m.tipe === 'transfer' ? rp(m.jumlah) : ''}</td>
                    <td className="rata-kanan">{m.tipe === 'keluar' ? rp(m.jumlah) : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </div>
        )}
        {pandangan === 'input' && bisa('tambah') && mode && (
        <>
        <div className="kartu__kepala kartu__kepala--kompak">
          <div>
            <h3>{mode === 'masuk' ? 'Kas Masuk' : mode === 'keluar' ? 'Kas Keluar' : 'Transfer antar Kas/Bank'}</h3>
            <p className="teks-redup teks-kecil">Catat transaksi lalu simpan — saldo rekening diperbarui otomatis.</p>
          </div>
          <button type="button" className="tombol tombol--netral tombol--kecil" onClick={() => { setMode(null); setPandangan('mutasi'); }} title="Kembali ke Mutasi">
            ← Kembali ke Mutasi
          </button>
        </div>
        <div className="alat-tabel" role="tablist" aria-label="Jenis transaksi kas">
          {(['masuk', 'keluar', 'transfer'] as const).map((t) => (
            <button key={t} type="button" className={`tombol tombol--kecil${mode === t ? ' tombol--primer' : ''}`} onClick={() => { setForm(kosong); setMode(t); }}>
              {t === 'masuk' ? 'Kas Masuk' : t === 'keluar' ? 'Kas Keluar' : 'Transfer'}
            </button>
          ))}
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
              {mode === 'masuk' ? 'Ke rekening' : 'Dari rekening'}
              <select className="input-pilih" value={form.akun_id} onChange={(e) => setForm({ ...form, akun_id: e.target.value })}>
                <option value="">— pilih rekening —</option>
                {akun.filter((a) => a.aktif).map((a) => (
                  <option key={a.id} value={a.id}>{a.kode} — {a.nama}</option>
                ))}
              </select>
            </label>
            {mode === 'transfer' && (
              <label>
                Ke rekening tujuan
                <select className="input-pilih" value={form.akun_tujuan_id} onChange={(e) => setForm({ ...form, akun_tujuan_id: e.target.value })}>
                  <option value="">— pilih rekening —</option>
                  {akun.filter((a) => a.aktif).map((a) => (
                    <option key={a.id} value={a.id}>{a.kode} — {a.nama}</option>
                  ))}
                </select>
              </label>
            )}
            {mode !== 'transfer' && (
              <label>
                Kategori
                <select className="input-pilih" value={form.kategori_id} onChange={(e) => setForm({ ...form, kategori_id: e.target.value })}>
                  <option value="">— tanpa kategori —</option>
                  {kategori.filter((k) => k.aktif && k.tipe === (mode === 'masuk' ? 'pemasukan' : 'pengeluaran')).map((k) => (
                    <option key={k.id} value={k.id}>{k.nama}</option>
                  ))}
                </select>
              </label>
            )}
            <label style={{ gridColumn: '1 / -1' }}>
              Keterangan
              <input className="input-cari" value={form.keterangan} onChange={(e) => setForm({ ...form, keterangan: e.target.value })} />
            </label>
          </div>
          <div className="tombol-baris" style={{ marginTop: 12 }}>
            <button type="button" className="tombol tombol--primer" disabled={kirim || !(Number(form.jumlah) > 0)} onClick={() => void simpan()}>
              {kirim ? 'Menyimpan…' : 'Catat Transaksi'}
            </button>
            <button type="button" className="tombol tombol--netral" onClick={() => { setMode(null); setPandangan('mutasi'); }}>Batal</button>
          </div>
        </>
        )}
      </section>

      {/* Dialog CRUD rekening */}
      {modeAkun && (
        <Modal
          judul={modeAkun === 'ubah' ? 'Ubah Rekening Kas/Bank' : 'Tambah Rekening Kas/Bank'}
          lebar="kecil"
          onTutup={() => { setModeAkun(null); setEditAkun(null); }}
          aksi={
            <>
              <button type="button" className="tombol" onClick={() => { setModeAkun(null); setEditAkun(null); }}>Batal</button>
              <button type="button" className="tombol tombol--primer" disabled={kirim || !formAkun.kode || !formAkun.nama} onClick={() => void simpanAkun()}>
                {kirim ? 'Menyimpan…' : 'Simpan'}
              </button>
            </>
          }
        >
          <div className="form-grid">
            <label>
              Kode
              <input className="input-cari" value={formAkun.kode} onChange={(e) => setFormAkun({ ...formAkun, kode: e.target.value })} />
            </label>
            <label>
              Nama
              <input className="input-cari" value={formAkun.nama} onChange={(e) => setFormAkun({ ...formAkun, nama: e.target.value })} />
            </label>
            <label>
              Jenis
              <select className="input-pilih" value={formAkun.jenis} onChange={(e) => setFormAkun({ ...formAkun, jenis: e.target.value })}>
                {JENIS_REKENING.map((j) => (
                  <option key={j} value={j}>{JENIS_LABEL[j]}</option>
                ))}
              </select>
            </label>
            <label>
              Saldo awal (Rp)
              <input type="number" className="input-cari" value={formAkun.saldo_awal} onChange={(e) => setFormAkun({ ...formAkun, saldo_awal: e.target.value })} />
            </label>
          </div>
        </Modal>
      )}
    </div>
  );
}

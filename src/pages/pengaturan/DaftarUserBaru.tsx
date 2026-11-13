import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { beritahu } from '../../components/crud/Toast';
import { Icon } from '../../components/Icon';
import { apiDelete, apiGet, apiPost, apiPut } from '../../lib/api';
import { useSegarkanModul } from '../../lib/segarkan';
import { useSesi } from '../../lib/sesi';
import {
  deskripsiPeran,
  formatLogin,
  kelasPeran,
  type GudangGrupBaru,
  type UserBaru,
} from './aksesBaru';
import './akses-baru.css';

interface FormUser {
  id: number | null;
  nama: string;
  username: string;
  sandi: string;
  peran_id: string;
  aktif: boolean;
  gudang: string[];
  /** WI2 — gudang default transaksi (kode) + kunci pilihan gudang. */
  gudangDefault: string;
  gudangTerkunci: boolean;
}

/**
 * Templat baru "Daftar user" — kartu + tabel NAMA/USERNAME, PERAN, GUDANG,
 * STATUS, LOGIN TERAKHIR, AKSI (ubah, reset sandi, nonaktif/aktif, hapus)
 * dan modal Tambah/Ubah user sesuai contoh.
 */
export function DaftarUserBaru() {
  const sesi = useSesi();
  const saya = sesi.info?.pengguna;
  const admin = saya?.admin ?? false;

  const [daftar, setDaftar] = useState<UserBaru[]>([]);
  const [peran, setPeran] = useState<{ id: number; nama: string; top: boolean; menuAwalLabel?: string | null }[]>([]);
  const [grupGudang, setGrupGudang] = useState<GudangGrupBaru[]>([]);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState<string | null>(null);
  const [buka, setBuka] = useState(false);
  const [sibuk, setSibuk] = useState(false);
  const [galatForm, setGalatForm] = useState<string | null>(null);
  const [sandiSekali, setSandiSekali] = useState<{ nama: string; sandi: string; pesan: string } | null>(null);
  const [form, setForm] = useState<FormUser>({ id: null, nama: '', username: '', sandi: '', peran_id: '', aktif: true, gudang: [], gudangDefault: '', gudangTerkunci: false });

  const gudangAktif = useMemo(
    () => grupGudang.flatMap((g) => g.gudang).filter((w) => Number(w.aktif) === 1),
    [grupGudang],
  );
  const namaGudang = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of gudangAktif) m.set(w.kode, w.nama);
    return m;
  }, [gudangAktif]);

  const muat = async () => {
    setMemuat(true);
    try {
      const r = await apiGet<{
        data: UserBaru[];
        peran: { id: number; nama: string; top: boolean; menuAwalLabel?: string | null }[];
      }>('/api/pengguna/daftar');
      setDaftar(r.data);
      setPeran(r.peran);
      setGalat(null);
    } catch (e) {
      setGalat(e instanceof Error ? e.message : 'Gagal memuat daftar user.');
    } finally {
      setMemuat(false);
    }
  };

  const muatGudang = async () => {
    try {
      const r = await apiGet<{ grup: GudangGrupBaru[] }>('/api/pengguna/gudang');
      setGrupGudang(r.grup);
    } catch {
      setGrupGudang([]);
    }
  };

  useEffect(() => {
    void muat();
    void muatGudang();
  }, []);
  // Tombol Refresh global di topbar: muat ulang daftar pengguna & gudang.
  useSegarkanModul(() => {
    void muat();
    void muatGudang();
  });

  function bukaTambah() {
    setGalatForm(null);
    setSandiSekali(null);
    setForm({
      id: null, nama: '', username: '', sandi: '',
      peran_id: peran[0] ? String(peran[0].id) : '',
      aktif: true,
      gudang: gudangAktif.length === 1 ? [gudangAktif[0].kode] : [],
      gudangDefault: gudangAktif.length === 1 ? gudangAktif[0].kode : '',
      gudangTerkunci: false,
    });
    setBuka(true);
  }

  function bukaUbah(u: UserBaru) {
    setGalatForm(null);
    setSandiSekali(null);
    setForm({
      id: u.id, nama: u.nama, username: u.username, sandi: '',
      peran_id: String(u.peran_id),
      aktif: u.status === 'aktif',
      gudang: u.cakupan_toko && u.cakupan_toko.length > 0 ? [...u.cakupan_toko] : [],
      gudangDefault: u.toko_bawaan ?? (u.cakupan_toko && u.cakupan_toko.length > 0 ? u.cakupan_toko[0] : ''),
      gudangTerkunci: u.is_warehouse_locked === true,
    });
    setBuka(true);
  }

  function toggleGudang(kode: string) {
    setForm((f) => {
      const baru = f.gudang.includes(kode) ? f.gudang.filter((g) => g !== kode) : [...f.gudang, kode];
      // Gudang default harus tetap di dalam daftar yang dicentang.
      const gudangDefault = baru.includes(f.gudangDefault) ? f.gudangDefault : (baru[0] ?? '');
      return { ...f, gudang: baru, gudangDefault, gudangTerkunci: gudangDefault ? f.gudangTerkunci : false };
    });
  }

  const peranTerpilih = peran.find((p) => String(p.id) === form.peran_id) ?? null;
  const peranTop = peranTerpilih ? peranTerpilih.nama.toLowerCase().trim() === 'owner' || peranTerpilih.nama.toLowerCase().trim() === 'administrator' : false;

  async function simpan(e: FormEvent) {
    e.preventDefault();
    if (sibuk || !admin) return;
    setGalatForm(null);
    if (!form.nama.trim()) { setGalatForm('Nama wajib diisi.'); return; }
    if (form.id === null) {
      if (!form.username.trim()) { setGalatForm('Username wajib diisi.'); return; }
      if (!form.sandi) { setGalatForm('Password awal wajib diisi.'); return; }
    }
    if (!form.peran_id) { setGalatForm('Peran wajib dipilih.'); return; }
    if (!peranTop && form.gudang.length === 0) { setGalatForm('Pilih minimal satu gudang.'); return; }
    if (form.gudangTerkunci && !form.gudangDefault) { setGalatForm('Pilih gudang default dulu sebelum mengunci pilihan gudang.'); return; }
    setSibuk(true);
    try {
      const dasar = {
        nama: form.nama.trim(),
        username: form.username.trim(),
        email: null,
        peran_id: Number(form.peran_id),
        cakupan_toko: peranTop ? null : form.gudang,
        toko_bawaan: peranTop ? null : (form.gudangDefault || form.gudang[0] || null),
        is_warehouse_locked: peranTop ? false : form.gudangTerkunci,
        mode_toko: 'terbatas',
      };
      if (form.id === null) {
        const r = await apiPost<{ pesan: string }>('/api/pengguna', { ...dasar, sandi: form.sandi });
        beritahu(r.pesan, 'sukses');
      } else {
        const lama = daftar.find((u) => u.id === form.id);
        await apiPut<{ pesan: string }>(`/api/pengguna/${form.id}`, {
          ...dasar,
          username: lama?.username ?? form.username,
          periode_aktif: lama?.periode_aktif ?? false,
          jam_dari: lama?.jam_dari, jam_sampai: lama?.jam_sampai,
          hari_aktif: lama?.hari_aktif ?? [],
          zona: lama?.zona ?? 'Asia/Jakarta',
          login_shift: lama?.login_shift ?? false,
          maks_perangkat: lama?.maks_perangkat ?? 0,
        });
        const inginAktif = form.aktif;
        const kiniAktif = (lama?.status ?? 'aktif') === 'aktif';
        if (inginAktif !== kiniAktif) {
          const s = await apiPost<{ pesan: string }>(`/api/pengguna/${form.id}/status`, { aktif: inginAktif });
          beritahu(s.pesan, 'sukses');
        } else {
          beritahu('Perubahan user disimpan.', 'sukses');
        }
      }
      setBuka(false);
      await muat();
    } catch (err) {
      setGalatForm(err instanceof Error ? err.message : 'Gagal menyimpan.');
    } finally {
      setSibuk(false);
    }
  }

  async function resetSandi(u: UserBaru) {
    if (!admin || sibuk) return;
    if (!window.confirm(`Reset password "${u.nama}" (@${u.username})? Password sementara tampil sekali.`)) return;
    setSibuk(true);
    try {
      const r = await apiPost<{ sandi: string; pesan: string }>(`/api/pengguna/${u.id}/sandi`, {});
      setSandiSekali({ nama: u.nama, sandi: r.sandi, pesan: r.pesan });
    } catch (e) {
      beritahu(e instanceof Error ? e.message : 'Gagal mereset password.', 'galat');
    } finally {
      setSibuk(false);
    }
  }

  async function toggleAktif(u: UserBaru) {
    if (!admin || sibuk) return;
    const aktif = u.status !== 'aktif';
    if (u.status === 'terkunci' && aktif) {
      // Buka kunci akun yang terkunci.
      setSibuk(true);
      try {
        const r = await apiPost<{ pesan: string }>(`/api/pengguna/${u.id}/buka`, {});
        beritahu(r.pesan, 'sukses');
        await muat();
      } catch (e) {
        beritahu(e instanceof Error ? e.message : 'Gagal membuka kunci.', 'galat');
      } finally {
        setSibuk(false);
      }
      return;
    }
    if (!window.confirm(`${aktif ? 'Aktifkan' : 'Nonaktifkan'} "${u.nama}"?`)) return;
    setSibuk(true);
    try {
      const r = await apiPost<{ pesan: string }>(`/api/pengguna/${u.id}/status`, { aktif });
      beritahu(r.pesan, 'sukses');
      await muat();
    } catch (e) {
      beritahu(e instanceof Error ? e.message : 'Gagal mengubah status.', 'galat');
    } finally {
      setSibuk(false);
    }
  }

  async function hapus(u: UserBaru) {
    if (!admin || sibuk) return;
    if (!window.confirm(`Hapus user "${u.nama}" (@${u.username})?`)) return;
    setSibuk(true);
    try {
      const r = await apiDelete<{ pesan: string }>(`/api/pengguna/${u.id}`);
      beritahu(r.pesan, 'sukses');
      await muat();
    } catch (e) {
      beritahu(e instanceof Error ? e.message : 'Gagal menghapus.', 'galat');
    } finally {
      setSibuk(false);
    }
  }

  return (
    <section className="ax-kartu">
      <div className="ax-kartu__kepala">
        <div>
          <h3>Daftar user</h3>
          <p>Nama, username, peran, gudang, status, dan login terakhir.</p>
        </div>
        <button type="button" className="ax-btn" onClick={bukaTambah} disabled={!admin || sibuk}>
          <span aria-hidden="true">＋</span> Tambah User
        </button>
      </div>

      {!admin && (
        <p className="ax-galat" role="note">
          Anda masuk sebagai {saya?.peranNama ?? '—'}. Pengelolaan user penuh untuk Owner/Admin.
        </p>
      )}
      {galat && <p className="ax-galat" role="alert">{galat}</p>}
      {sandiSekali && (
        <div className="ax-sandi-sekali" role="alert">
          <div>{sandiSekali.pesan}</div>
          <div style={{ marginTop: 6 }}>Password sementara <strong>{sandiSekali.nama}</strong>: <code>{sandiSekali.sandi}</code></div>
          <button type="button" className="ax-btn ax-btn--netral" style={{ marginTop: 8 }} onClick={() => setSandiSekali(null)}>
            Sudah dicatat, tutup
          </button>
        </div>
      )}

      <div className="ax-tabel-bungkus">
        <table className="ax-tabel">
          <thead>
            <tr>
              <th>Nama / Username</th>
              <th>Peran</th>
              <th>Gudang</th>
              <th>Status</th>
              <th>Login Terakhir</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {memuat ? (
              <tr><td colSpan={6}>Memuat…</td></tr>
            ) : daftar.length === 0 ? (
              <tr><td colSpan={6}>Belum ada user.</td></tr>
            ) : (
              daftar.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="ax-nama">{u.nama}</div>
                    {saya && u.id === saya.id && <span className="ax-badge-anda">Anda</span>}
                    <div className="ax-username">@{u.username}</div>
                  </td>
                  {/* AY — menu awal peran sebagai keterangan kecil di tooltip badge (baca-saja). */}
                  <td>
                    <span
                      className={kelasPeran(u.peran)}
                      title={`Menu awal: ${peran.find((r) => r.nama === u.peran)?.menuAwalLabel ?? 'Otomatis (halaman pertama yang boleh dilihat)'}`}
                    >
                      {u.peran}
                    </span>
                  </td>
                  <td>
                    {u.top || !u.cakupan_toko ? (
                      <span className="ax-pill ax-pill--gudang-semua">Semua gudang</span>
                    ) : u.cakupan_toko.length === 0 ? (
                      <span className="ax-username">—</span>
                    ) : (
                      u.cakupan_toko.map((k) => (
                        <span key={k} className="ax-pill ax-pill--gudang" title={namaGudang.get(k) ?? k}>
                          {namaGudang.get(k) ?? k}
                        </span>
                      ))
                    )}
                  </td>
                  <td>
                    <span className={`ax-status${u.status === 'nonaktif' ? ' ax-status--nonaktif' : u.status === 'terkunci' ? ' ax-status--terkunci' : ''}`}>
                      <span className="ax-status__titik" aria-hidden="true" />{u.status === 'aktif' ? 'Aktif' : u.status === 'terkunci' ? 'Terkunci' : 'Nonaktif'}
                    </span>
                  </td>
                  <td>{formatLogin(u.login_terakhir)}</td>
                  <td>
                    <div className="ax-aksi">
                      <button type="button" className="ax-ikon-btn" title="Ubah user" aria-label={`Ubah ${u.nama}`} onClick={() => bukaUbah(u)} disabled={!admin}>
                        <Icon nama="pencil" size={16} />
                      </button>
                      <button type="button" className="ax-ikon-btn" title="Reset password" aria-label={`Reset password ${u.nama}`} onClick={() => void resetSandi(u)} disabled={!admin || sibuk}>
                        <Icon nama="rotate-ccw" size={16} />
                      </button>
                      <button
                        type="button"
                        className="ax-ikon-btn"
                        title={u.status === 'aktif' ? 'Nonaktifkan' : u.status === 'terkunci' ? 'Buka kunci' : 'Aktifkan'}
                        aria-label={`${u.status === 'aktif' ? 'Nonaktifkan' : 'Aktifkan'} ${u.nama}`}
                        onClick={() => void toggleAktif(u)}
                        disabled={!admin || sibuk}
                      >
                        <Icon nama="power" size={16} />
                      </button>
                      <button type="button" className="ax-ikon-btn ax-ikon-btn--bahaya" title="Hapus user" aria-label={`Hapus ${u.nama}`} onClick={() => void hapus(u)} disabled={!admin || sibuk}>
                        <Icon nama="trash" size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {buka && (
        <div className="ax-modal-latar" onMouseDown={(e) => { if (e.target === e.currentTarget && !sibuk) setBuka(false); }}>
          <div className="ax-modal" role="dialog" aria-modal="true" aria-label={form.id === null ? 'Tambah user' : 'Ubah user'}>
            <div className="ax-modal__kepala">
              <div>
                <h3>{form.id === null ? 'Tambah user' : 'Ubah user'}</h3>
                {form.id !== null && <p>@{form.username}</p>}
              </div>
              <button type="button" className="ax-modal__tutup" aria-label="Tutup" onClick={() => !sibuk && setBuka(false)}>✕</button>
            </div>
            <form onSubmit={(e) => void simpan(e)}>
              <div className="ax-modal__isi">
                <div className="ax-2kol">
                  <div className="ax-bidang">
                    <label htmlFor="ax-nama">Nama <span className="wajib">*</span></label>
                    <input id="ax-nama" type="text" value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} disabled={sibuk} autoComplete="off" />
                  </div>
                  <div className="ax-bidang">
                    <label htmlFor="ax-username">Username <span className="wajib">*</span></label>
                    <input
                      id="ax-username" type="text" value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                      disabled={sibuk || form.id !== null} autoComplete="off"
                      placeholder={form.id === null ? '' : 'Tidak bisa diubah setelah dibuat'}
                    />
                  </div>
                </div>
                {form.id === null && (
                  <div className="ax-bidang">
                    <label htmlFor="ax-sandi">Password awal <span className="wajib">*</span></label>
                    <input id="ax-sandi" type="password" value={form.sandi} onChange={(e) => setForm({ ...form, sandi: e.target.value })} disabled={sibuk} autoComplete="new-password" />
                  </div>
                )}
                <div className="ax-2kol">
                  <div className="ax-bidang">
                    <label htmlFor="ax-peran">Peran <span className="wajib">*</span></label>
                    <select id="ax-peran" value={form.peran_id} onChange={(e) => setForm({ ...form, peran_id: e.target.value })} disabled={sibuk}>
                      <option value="">Pilih peran…</option>
                      {peran.map((p) => <option key={p.id} value={p.id}>{p.nama}</option>)}
                    </select>
                    <p className="ax-ket">{peranTerpilih ? deskripsiPeran(peranTerpilih.nama) : 'Pilih peran untuk melihat keterangannya.'}</p>
                  </div>
                  <div className="ax-bidang">
                    <label>&nbsp;</label>
                    <label className="ax-cek">
                      <input type="checkbox" checked={form.aktif} onChange={(e) => setForm({ ...form, aktif: e.target.checked })} disabled={sibuk} />
                      <span>
                        <span className="ax-ceklis">User aktif</span>
                        <p className="ax-ket">User nonaktif tidak bisa masuk dan sesinya dicabut.</p>
                      </span>
                    </label>
                  </div>
                </div>
                <div className="ax-bidang">
                  <label>Gudang yang boleh diakses <span className="wajib">*</span></label>
                  {peranTop ? (
                    <p className="ax-ket">Owner/Admin otomatis memiliki akses ke semua gudang.</p>
                  ) : gudangAktif.length === 0 ? (
                    <p className="ax-ket">Belum ada gudang — tambah di Master Data › Gudang &amp; Lokasi.</p>
                  ) : (
                    <div className="ax-gudang-box" role="group" aria-label="Gudang yang boleh diakses">
                      {gudangAktif.map((g) => (
                        <label key={g.kode} className="ax-cek">
                          <input
                            type="checkbox" checked={form.gudang.includes(g.kode)}
                            onChange={() => toggleGudang(g.kode)} disabled={sibuk}
                          />
                          <span>{g.nama} ({g.kode})</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                {!peranTop && gudangAktif.length > 0 && (
                  <>
                    <div className="ax-bidang">
                      <label htmlFor="ax-gudang-default">Gudang Default Transaksi</label>
                      <select
                        id="ax-gudang-default"
                        value={form.gudangDefault}
                        onChange={(e) => setForm({ ...form, gudangDefault: e.target.value })}
                        disabled={sibuk}
                      >
                        <option value="">— Tanpa gudang default —</option>
                        {gudangAktif.filter((g) => form.gudang.includes(g.kode)).map((g) => (
                          <option key={g.kode} value={g.kode}>{g.kode} — {g.nama}</option>
                        ))}
                      </select>
                      <p className="ax-ket">Gudang ini otomatis terpilih saat user membuka POS, Pembelian, atau Stok.</p>
                    </div>
                    <div className="ax-bidang">
                      <label className="ax-cek">
                        <input
                          type="checkbox"
                          checked={form.gudangTerkunci}
                          onChange={(e) => setForm({ ...form, gudangTerkunci: e.target.checked })}
                          disabled={sibuk || !form.gudangDefault}
                        />
                        <span>
                          <span className="ax-ceklis">Kunci Pilihan Gudang (user tidak boleh mengganti gudang)</span>
                          <p className="ax-ket">Dropdown gudang di form transaksi nonaktif dan menampilkan tanda 🔒.</p>
                        </span>
                      </label>
                    </div>
                  </>
                )}
                {galatForm && <p className="ax-galat" role="alert">{galatForm}</p>}
              </div>
              <div className="ax-modal__kaki">
                <button type="button" className="ax-btn ax-btn--netral" onClick={() => setBuka(false)} disabled={sibuk}>
                  Batal
                </button>
                <button type="submit" className="ax-btn" disabled={sibuk || !admin}>
                  {sibuk ? 'Menyimpan…' : form.id === null ? 'Tambah user' : 'Simpan perubahan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

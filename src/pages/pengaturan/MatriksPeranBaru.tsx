import { useEffect, useMemo, useRef, useState } from 'react';
import { beritahu } from '../../components/crud/Toast';
import { Modal } from '../../components/crud/Modal';
import { apiDelete, apiGet, apiPost, apiPut } from '../../lib/api';
import { useSegarkanModul } from '../../lib/segarkan';
import { useSesi } from '../../lib/sesi';
import {
  KETERANGAN_KOLOM,
  KOLOM_MATRIKS,
  LEGENDA_MATRIKS,
  MENU_MATRIKS,
  deskripsiPeran,
  parseAksi,
  type PeranBaru,
} from './aksesBaru';
import { Tip } from '../../components/Tip';
import './akses-baru.css';
import {
  labelMenuAwalKlien,
  opsiUntukLihat,
  type OpsiMenuAwal,
} from '../../config/menuAwal';

/** Matriks peran → {menu: Set(aksi)} dari flat hak server ("lihat,tambah"). */
function matriksAwal(hak: Record<string, string>): Record<string, Set<string>> {
  // AX — hanya delapan sel sah yang dipakai; kode lama (terima/batal/…)
  // terbuang di sini dan tidak ikut tersimpan.
  const sah = new Set<string>(KOLOM_MATRIKS.map((k) => k.kode));
  const d: Record<string, Set<string>> = {};
  for (const m of MENU_MATRIKS) d[m.kode] = new Set(parseAksi(hak[m.kode]).filter((a) => sah.has(a)));
  return d;
}

/**
 * AY — Dropdown menu awal: tombol + panel opsi berkelompok dengan kolom
 * cari. Di layar sempit panel menjadi bottom sheet (akses-baru.css).
 */
function PilihMenuAwal({
  nilai,
  grup,
  disabled,
  onPilih,
}: {
  nilai: string | null;
  grup: { grup: string; opsi: OpsiMenuAwal[] }[];
  disabled: boolean;
  onPilih: (kode: string | null) => void;
}) {
  const [buka, setBuka] = useState(false);
  const [cari, setCari] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const cariRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!buka) return;
    const tutupLuar = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setBuka(false);
    };
    const tutupEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBuka(false);
    };
    document.addEventListener('mousedown', tutupLuar);
    document.addEventListener('keydown', tutupEsc);
    return () => {
      document.removeEventListener('mousedown', tutupLuar);
      document.removeEventListener('keydown', tutupEsc);
    };
  }, [buka]);

  useEffect(() => {
    if (buka) {
      setCari('');
      window.setTimeout(() => cariRef.current?.focus(), 30);
    }
  }, [buka]);

  const kunci = cari.trim().toLowerCase();
  const tampak = grup
    .map((g) => ({
      ...g,
      opsi: g.opsi.filter((o) => !kunci || o.label.toLowerCase().includes(kunci)),
    }))
    .filter((g) => g.opsi.length > 0);
  const pertama = tampak[0]?.opsi[0] ?? null;
  const labelAktif = nilai === null ? 'Otomatis (halaman pertama yang boleh dilihat)' : null;

  const pilih = (kode: string | null) => {
    onPilih(kode);
    setBuka(false);
  };

  return (
    <div className="ax-pilih" ref={ref}>
      <button
        type="button"
        className="ax-pilih__tombol"
        aria-haspopup="listbox"
        aria-expanded={buka}
        disabled={disabled}
        onClick={() => setBuka((v) => !v)}
      >
        <span>{labelAktif ?? grup.flatMap((g) => g.opsi).find((o) => o.kode === nilai)?.label ?? nilai}</span>
        <span className="ax-pilih__panah" aria-hidden="true">▾</span>
      </button>
      {buka && !disabled && (
        <div className="ax-pilih__panel" role="listbox" aria-label="Menu awal setelah login">
          <input
            ref={cariRef}
            type="search"
            className="ax-pilih__cari"
            placeholder="Cari halaman…"
            aria-label="Cari halaman"
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && pertama) {
                e.preventDefault();
                pilih(pertama.kode);
              }
            }}
          />
          <div className="ax-pilih__daftar">
            <button
              type="button"
              role="option"
              aria-selected={nilai === null}
              className={`ax-pilih__opsi${nilai === null ? ' aktif' : ''}`}
              onClick={() => pilih(null)}
            >
              Otomatis (halaman pertama yang boleh dilihat)
            </button>
            {tampak.map((g) => (
              <div key={g.grup} className="ax-pilih__grup">
                <div className="ax-pilih__grup-label">{g.grup}</div>
                {g.opsi.map((o) => (
                  <button
                    key={o.kode}
                    type="button"
                    role="option"
                    aria-selected={nilai === o.kode}
                    className={`ax-pilih__opsi${nilai === o.kode ? ' aktif' : ''}`}
                    onClick={() => pilih(o.kode)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            ))}
            {tampak.length === 0 && (
              <p className="ax-kecil ax-pilih__kosong">Tidak ada halaman yang cocok — peran ini belum boleh melihat halaman tersebut.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Matriks Peran — dua tampilan seperti Item Masuk:
 * 1) Daftar ringkasan peran (bawaan): NAMA, DESKRIPSI, PENGGUNA, STATUS, AKSI.
 * 2) Formulir matriks tunggal: checklist delapan sel
 *    (Lihat, Tambah, Ubah, Hapus, Sahkan, Impor, Ekspor, Cetak)
 *    untuk satu peran + tombol kembali. Simpan → kembali ke daftar.
 * Menyimpan lewat PUT /matriks/:id; hanya delapan sel sah yang dikirim —
 * kode lama (terima/batal/batal_disahkan) tidak dipertahankan.
 */
export function MatriksPeranBaru() {
  const sesiInfo = useSesi().info;
  const admin = (sesiInfo?.pengguna.admin ?? false);
  // AY — non-Admin berizin Ubah pada modul Pengaturan boleh mengubah
  // menu awal peran (tanpa menyentuh matriks).
  const bolehMenuAwal = admin || ((sesiInfo?.hak?.['pengaturan'] ?? []).includes('ubah'));
  const [daftar, setDaftar] = useState<PeranBaru[]>([]);
  const [draf, setDraf] = useState<Record<number, Record<string, Set<string>>>>({});
  const [awal, setAwal] = useState<Record<number, string>>({});
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState<string | null>(null);
  const [sibukId, setSibukId] = useState<number | null>(null);
  // AY — pilihan menu awal per peran (null = otomatis). Diinisialisasi
  // dari server; perubahan ikut kotor & tersimpan bersama matriks.
  const [menuAwal, setMenuAwal] = useState<Record<number, string | null>>({});
  // WI2 — gudang default, akses gudang, dan kunci pilihan gudang per peran.
  const [gudangList, setGudangList] = useState<{ kode: string; nama: string }[]>([]);
  const [gudangDraf, setGudangDraf] = useState<Record<number, { akses: string[]; bawaan: string; terkunci: boolean }>>({});
  // Peran yang sedang diatur hak aksesnya; null = tampilkan daftar ringkasan.
  const [terpilihId, setTerpilihId] = useState<number | null>(null);
  const [dialogNama, setDialogNama] = useState<{ id: number | null; nama: string } | null>(null);
  const [dialogHapus, setDialogHapus] = useState<PeranBaru | null>(null);

  const muat = async () => {
    setMemuat(true);
    try {
      const r = await apiGet<{ data: PeranBaru[] }>('/api/pengguna/peran');
      const urut = [...r.data].sort((a, b) => Number(b.top) - Number(a.top) || a.nama.localeCompare(b.nama));
      setDaftar(urut);
      const d: Record<number, Record<string, Set<string>>> = {};
      const w: Record<number, string> = {};
      const m: Record<number, string | null> = {};
      for (const p of urut) {
        d[p.id] = matriksAwal(p.hak);
        w[p.id] = JSON.stringify(MENU_MATRIKS.map((m) => [...(d[p.id][m.kode] ?? [])].sort()));
        m[p.id] = p.menu_awal ?? null;
      }
      setDraf(d);
      setAwal(w);
      setMenuAwal(m);
      const gd: Record<number, { akses: string[]; bawaan: string; terkunci: boolean }> = {};
      for (const p of urut) {
        gd[p.id] = {
          akses: p.cakupan_toko && p.cakupan_toko.length > 0 ? [...p.cakupan_toko] : [],
          bawaan: p.gudang_default ?? '',
          terkunci: p.gudang_terkunci === true,
        };
      }
      setGudangDraf(gd);
      setGalat(null);
    } catch (e) {
      setGalat(e instanceof Error ? e.message : 'Gagal memuat matriks peran.');
    } finally {
      setMemuat(false);
    }
  };

  useEffect(() => { void muat(); }, []);
  // Daftar gudang aktif untuk isian akses gudang per peran.
  useEffect(() => {
    apiGet<{ grup: { gudang: { kode: string; nama: string; aktif: number }[] }[] }>('/api/pengguna/gudang')
      .then((r) => setGudangList(r.grup.flatMap((g) => g.gudang).filter((w) => Number(w.aktif) === 1)))
      .catch(() => setGudangList([]));
  }, []);
  // Tombol Refresh global di topbar: muat ulang matriks peran.
  useSegarkanModul(() => void muat());

  /** WI2 — simpan gudang default/akses/kunci milik satu peran. */
  function simpanGudang(p: PeranBaru) {
    if (!admin || sibukId !== null) return;
    const d = gudangDraf[p.id];
    if (!d) return;
    setSibukId(p.id);
    void (async () => {
      try {
        const r = await apiPut<{ pesan: string }>(`/api/pengguna/peran/${p.id}/gudang`, {
          gudang_akses: d.akses.length ? d.akses : null,
          gudang_default: d.bawaan || null,
          gudang_terkunci: d.terkunci,
        });
        beritahu(r.pesan, 'sukses');
        await muat();
      } catch (e) {
        beritahu(e instanceof Error ? e.message : 'Gagal menyimpan gudang peran.', 'galat');
      } finally {
        setSibukId(null);
      }
    })();
  }

  function toggleGudangPeran(roleId: number, kode: string) {
    setGudangDraf((d) => {
      const kini = d[roleId];
      if (!kini) return d;
      const akses = kini.akses.includes(kode) ? kini.akses.filter((k) => k !== kode) : [...kini.akses, kode];
      const bawaan = akses.includes(kini.bawaan) ? kini.bawaan : (akses[0] ?? '');
      return { ...d, [roleId]: { akses, bawaan, terkunci: bawaan ? kini.terkunci : false } };
    });
  }

  const kotor = useMemo(() => {
    const o: Record<number, boolean> = {};
    for (const p of daftar) {
      const kini = JSON.stringify(MENU_MATRIKS.map((m) => [...(draf[p.id]?.[m.kode] ?? new Set<string>())].sort()));
      // AY — perubahan menu awal ikut membuat Simpan aktif.
      o[p.id] = kini !== awal[p.id] || (menuAwal[p.id] ?? null) !== (p.menu_awal ?? null);
    }
    return o;
  }, [daftar, draf, awal, menuAwal]);

  function toggle(roleId: number, menu: string, aksi: string, terkunci: boolean) {
    if (terkunci || sibukId !== null) return;
    setDraf((d) => {
      const next = { ...d };
      const baris = { ...(next[roleId] ?? {}) };
      const s = new Set(baris[menu] ?? []);
      if (s.has(aksi)) s.delete(aksi);
      else s.add(aksi);
      baris[menu] = s;
      next[roleId] = baris;
      return next;
    });
  }

  async function simpan(p: PeranBaru) {
    if (!admin || sibukId !== null) return;
    setSibukId(p.id);
    try {
      // AX — hanya delapan sel sah yang dikirim (dari draf yang sudah
      // disaring); baris rincian modul lain ikut apa adanya.
      const hak: Record<string, string[]> = {};
      const edit = draf[p.id] ?? {};
      for (const [menu, mentah] of Object.entries(p.hak)) {
        const ada = parseAksi(mentah);
        if (MENU_MATRIKS.some((m) => m.kode === menu)) {
          hak[menu] = [...(edit[menu] ?? new Set<string>())];
        } else {
          hak[menu] = ada;
        }
      }
      for (const m of MENU_MATRIKS) {
        if (!(m.kode in hak)) hak[m.kode] = [...(edit[m.kode] ?? new Set<string>())];
      }
      // Matriks peran HANYA menyimpan izin menu — tanpa validasi/pilihan
      // gudang (gudang wajib diisi di level PENGGUNA, bukan peran).
      // AY — menu awal ikut tersimpan (server memvalidasi terhadap sel Lihat baru).
      const r = await apiPut<{ pesan: string }>(`/api/pengguna/matriks/${p.id}`, { hak, menu_awal: menuAwal[p.id] ?? null });
      beritahu(r.pesan, 'sukses');
      setTerpilihId(null);
      await muat();
    } catch (e) {
      beritahu(e instanceof Error ? e.message : 'Gagal menyimpan matriks.', 'galat');
    } finally {
      setSibukId(null);
    }
  }

  function tambahPeran() {
    if (!admin || sibukId !== null) return;
    setDialogNama({ id: null, nama: '' });
  }

  function ubahNama(p: PeranBaru) {
    if (!admin || p.top || sibukId !== null) return;
    setDialogNama({ id: p.id, nama: p.nama });
  }

  async function simpanNamaPeran() {
    if (!dialogNama || sibukId !== null) return;
    const nama = dialogNama.nama.trim();
    if (!nama) { beritahu('Nama peran wajib diisi.', 'galat'); return; }
    const id = dialogNama.id;
    if (id !== null && nama === daftar.find((p) => p.id === id)?.nama) { setDialogNama(null); return; }
    setSibukId(id ?? -1);
    try {
      if (id === null) {
        const r = await apiPost<{ id: number; pesan: string }>('/api/pengguna/peran', { nama });
        beritahu(r.pesan, 'sukses'); setDialogNama(null); await muat(); setTerpilihId(r.id);
      } else {
        const r = await apiPut<{ pesan: string }>(`/api/pengguna/peran/${id}`, { nama });
        beritahu(r.pesan, 'sukses'); setDialogNama(null); await muat();
      }
    } catch (e) { beritahu(e instanceof Error ? e.message : 'Gagal menyimpan peran.', 'galat'); }
    finally { setSibukId(null); }
  }

  function hapusPeran(p: PeranBaru) {
    if (!admin || p.top || sibukId !== null) return;
    setDialogHapus(p);
  }

  async function konfirmasiHapusPeran() {
    if (!dialogHapus || sibukId !== null) return;
    const p = dialogHapus; setSibukId(p.id);
    try {
      const r = await apiDelete<{ pesan: string }>(`/api/pengguna/peran/${p.id}`);
      beritahu(r.pesan, 'sukses'); setDialogHapus(null); setTerpilihId(null); await muat();
    } catch (e) { beritahu(e instanceof Error ? e.message : 'Gagal menghapus peran.', 'galat'); }
    finally { setSibukId(null); }
  }
  if (memuat) return <section className="ax-kartu"><p className="ax-kecil">Memuat matriks peran…</p></section>;
  if (galat) return <section className="ax-kartu"><p className="ax-galat" role="alert">{galat}</p></section>;

  const dialogPeran = dialogNama && (
    <Modal
      judul={dialogNama.id === null ? 'Buat Peran Baru' : 'Ubah Nama Peran'}
      lebar="kecil"
      onTutup={() => { if (sibukId === null) setDialogNama(null); }}
      sedangKirim={sibukId !== null}
      aksi={<>
        <button type="button" className="tombol" onClick={() => setDialogNama(null)} disabled={sibukId !== null}>Batal</button>
        <button type="button" className="tombol tombol--primer" onClick={() => void simpanNamaPeran()} disabled={sibukId !== null || !dialogNama.nama.trim()}>{sibukId !== null ? 'Menyimpan…' : 'Simpan'}</button>
      </>}
    >
      <label className="bidang" htmlFor="nama-peran-baru">
        <span>Nama peran</span>
        <input id="nama-peran-baru" data-fokus-awal className="input-cari" maxLength={60} value={dialogNama.nama} onChange={(e) => setDialogNama({ ...dialogNama, nama: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void simpanNamaPeran(); } }} disabled={sibukId !== null} placeholder="Contoh: Operator Gudang" />
      </label>
    </Modal>
  );
  const dialogKonfirmasiHapus = dialogHapus && (
    <Modal
      judul="Hapus Peran"
      lebar="kecil"
      onTutup={() => { if (sibukId === null) setDialogHapus(null); }}
      sedangKirim={sibukId !== null}
      aksi={<>
        <button type="button" className="tombol" onClick={() => setDialogHapus(null)} disabled={sibukId !== null}>Batal</button>
        <button type="button" className="tombol tombol--primer" onClick={() => void konfirmasiHapusPeran()} disabled={sibukId !== null}>{sibukId !== null ? 'Menghapus…' : 'Hapus Peran'}</button>
      </>}
    >
      <p>Hapus peran <strong>{dialogHapus.nama}</strong>?</p>
      <p className="teks-redup">Peran ini digunakan oleh {dialogHapus.jumlah_pengguna} pengguna. Peran yang masih digunakan tidak dapat dihapus.</p>
    </Modal>
  );

  const terpilih = daftar.find((p) => p.id === terpilihId) ?? null;

  // ================= VIEW 2: formulir matriks satu peran =================
  if (terpilih) {
    const terkunci = !admin || terpilih.top;
    const edit = draf[terpilih.id] ?? {};
    // AY — sel Lihat draf (langsung) menentukan pilihan menu awal.
    const lihatModul = (modul: string | null): boolean => {
      if (modul === null) return true;
      if (terpilih.top) return true;
      return edit[modul]?.has('lihat') ?? false;
    };
    const grupOpsi = opsiUntukLihat(lihatModul);
    const nilaiMenu = menuAwal[terpilih.id] ?? null;
    const kodeTerlihat = new Set(grupOpsi.flatMap((g) => g.opsi.map((o) => o.kode)));
    const menuSah = nilaiMenu === null || kodeTerlihat.has(nilaiMenu);
    const menuBerubah = nilaiMenu !== (terpilih.menu_awal ?? null);
    const kunciMenu = !bolehMenuAwal || terpilih.top && !admin || sibukId !== null;

    const simpanMenuSaja = async () => {
      if (!bolehMenuAwal || sibukId !== null || !menuSah) return;
      setSibukId(terpilih.id);
      try {
        const r = await apiPut<{ pesan: string }>(`/api/pengguna/peran/${terpilih.id}/menu-awal`, { menu_awal: nilaiMenu });
        beritahu(r.pesan, 'sukses');
        await muat();
      } catch (e) {
        beritahu(e instanceof Error ? e.message : 'Gagal menyimpan menu awal.', 'galat');
      } finally {
        setSibukId(null);
      }
    };

    return (
      <>
      {dialogPeran}
      {dialogKonfirmasiHapus}
      <div className="ax-wrap">
        {/* AY — Pengaturan peran: nama + menu awal setelah login. */}
        <section className="ax-kartu" aria-label="Pengaturan peran">
          <div className="ax-kartu__kepala">
            <div>
              <h3>Pengaturan peran: {terpilih.nama}</h3>
              <p>Menu awal adalah atribut peran (bukan izin) — pengguna berperan ini langsung mendarat di sini setelah login.</p>
            </div>
          </div>
          <div className="ax-bidang">
            <label htmlFor="menu-awal-peran">Menu awal setelah login</label>
            <PilihMenuAwal
              nilai={nilaiMenu}
              grup={grupOpsi}
              disabled={kunciMenu}
              onPilih={(kode) => setMenuAwal((m) => ({ ...m, [terpilih.id]: kode }))}
            />
            <p className="ax-ket">
              Hanya halaman yang boleh dilihat peran ini (sel Lihat tercentang) yang muncul sebagai pilihan.
            </p>
            {!menuSah && (
              <p className="ax-galat" role="alert">
                Menu awal tidak lagi tersedia untuk peran ini — pilih ulang sebelum Simpan.
              </p>
            )}
          </div>
        </section>
        {!terpilih.top && admin && (
          <section className="ax-kartu" aria-label="Gudang peran">
            <div className="ax-kartu__kepala">
              <div>
                <h3>Gudang peran: {terpilih.nama}</h3>
                <p>Akses efektif pengguna = irisan gudang pengguna × gudang peran. Kosongkan bila peran tidak membatasi gudang.</p>
              </div>
            </div>
            {(() => {
              const d = gudangDraf[terpilih.id] ?? { akses: [], bawaan: '', terkunci: false };
              const berubah =
                JSON.stringify([...d.akses].sort()) !== JSON.stringify([...(terpilih.cakupan_toko ?? [])].sort()) ||
                (d.bawaan || null) !== (terpilih.gudang_default ?? null) ||
                d.terkunci !== (terpilih.gudang_terkunci === true);
              return (
                <>
                  <div className="ax-2kol">
                    <div className="ax-bidang">
                      <label htmlFor="gudang-default-peran">Gudang Default Transaksi</label>
                      <select
                        id="gudang-default-peran"
                        value={d.bawaan}
                        onChange={(e) =>
                          setGudangDraf((g) => ({ ...g, [terpilih.id]: { ...d, bawaan: e.target.value } }))
                        }
                        disabled={sibukId !== null}
                      >
                        <option value="">— Tanpa gudang default —</option>
                        {gudangList
                          .filter((g) => d.akses.includes(g.kode))
                          .map((g) => (
                            <option key={g.kode} value={g.kode}>{g.kode} — {g.nama}</option>
                          ))}
                      </select>
                      <p className="ax-ket">Otomatis terpilih saat pengguna peran ini membuka POS, Pembelian, atau Stok.</p>
                    </div>
                    <div className="ax-bidang">
                      <label>&nbsp;</label>
                      <label className="ax-cek">
                        <input
                          type="checkbox"
                          checked={d.terkunci}
                          onChange={(e) =>
                            setGudangDraf((g) => ({ ...g, [terpilih.id]: { ...d, terkunci: e.target.checked } }))
                          }
                          disabled={sibukId !== null || !d.bawaan}
                        />
                        <span>
                          <span className="ax-ceklis">Kunci Pilihan Gudang</span>
                          <p className="ax-ket">Dropdown gudang di form transaksi nonaktif (tanda 🔒).</p>
                        </span>
                      </label>
                    </div>
                  </div>
                  <div className="ax-bidang">
                    <label>Akses Gudang yang Diizinkan</label>
                    {gudangList.length === 0 ? (
                      <p className="ax-ket">Belum ada gudang — tambah di Master Data › Gudang &amp; Lokasi.</p>
                    ) : (
                      <div className="ax-gudang-box" role="group" aria-label="Akses gudang peran">
                        {gudangList.map((g) => (
                          <label key={g.kode} className="ax-cek">
                            <input
                              type="checkbox"
                              checked={d.akses.includes(g.kode)}
                              onChange={() => toggleGudangPeran(terpilih.id, g.kode)}
                              disabled={sibukId !== null}
                            />
                            <span>{g.nama} ({g.kode})</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="ax-peran__kaki">
                    <button
                      type="button"
                      className="ax-btn"
                      onClick={() => simpanGudang(terpilih)}
                      disabled={sibukId !== null || !berubah}
                    >
                      {sibukId === terpilih.id ? 'Menyimpan…' : 'Simpan Gudang'}
                    </button>
                  </div>
                </>
              );
            })()}
          </section>
        )}
        <section className="ax-kartu">
          <div className="ax-kartu__kepala">
            <div>
              <h3>Pengaturan Hak Akses Peran: {terpilih.nama}</h3>
              <p>Atur rincian checklist izin menu (Lihat, Tambah, Ubah, Hapus, Sahkan, Impor, Ekspor, Cetak) untuk peran ini. Arahkan kursor ke judul kolom untuk keterangannya.</p>
            </div>
            <button type="button" className="ax-btn ax-btn--netral" onClick={() => setTerpilihId(null)}>
              ← Kembali ke Daftar Peran
            </button>
          </div>
          {terpilih.top && (
            <p className="ax-kecil">Peran {terpilih.nama} selalu memiliki seluruh akses dan tidak bisa dibatasi.</p>
          )}
          <div className="ax-tabel-bungkus ax-matriks">
            <table className="ax-tabel">
              <thead>
                <tr>
                  <th>Menu</th>
                  {KOLOM_MATRIKS.map((k) => (
                    <th key={k.kode} className="rata-tengah">
                      <Tip teks={KETERANGAN_KOLOM[k.kode] ?? k.label} label={`${k.label}: ${KETERANGAN_KOLOM[k.kode] ?? ''}`}>
                        <span>{k.label}</span>
                      </Tip>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MENU_MATRIKS.map((m) => (
                  <tr key={m.kode}>
                    <td>{m.label}</td>
                    {KOLOM_MATRIKS.map((k) => (
                      <td key={k.kode} className="rata-tengah">
                        <input
                          type="checkbox"
                          checked={edit[m.kode]?.has(k.kode) ?? false}
                          onChange={() => toggle(terpilih.id, m.kode, k.kode, terkunci)}
                          disabled={terkunci || sibukId !== null}
                          aria-label={`${m.label} — ${k.label}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ax-kecil ax-legenda">{LEGENDA_MATRIKS}</p>
          <div className="ax-peran__kaki">
            {!terpilih.top && admin && (
              <button type="button" className="ax-btn" onClick={() => void simpan(terpilih)} disabled={sibukId !== null || !kotor[terpilih.id] || !menuSah}>
                {sibukId === terpilih.id ? 'Menyimpan…' : 'Simpan'}
              </button>
            )}
            {/* AY — non-Admin berizin Ubah Pengaturan menyimpan menu awal
                saja; Admin pada peran Top juga memakai jalur ini (matriks
                Top terkunci, tetapi atribut menu awal tetap bisa diatur). */}
            {((!admin && bolehMenuAwal) || (admin && terpilih.top)) && (
              <button
                type="button"
                className="ax-btn"
                onClick={() => void simpanMenuSaja()}
                disabled={sibukId !== null || !menuBerubah || !menuSah}
                title={!menuSah ? 'Menu awal tidak lagi tersedia untuk peran ini — pilih ulang sebelum Simpan.' : undefined}
              >
                {sibukId === terpilih.id ? 'Menyimpan…' : 'Simpan menu awal'}
              </button>
            )}
            <span className="ax-kecil">{terpilih.jumlah_pengguna} pengguna</span>
            {!terpilih.top && admin && (
              <>
                <button type="button" className="ax-link" onClick={() => void ubahNama(terpilih)} disabled={sibukId !== null}>Ubah nama</button>
                <button type="button" className="ax-link ax-link--bahaya" onClick={() => void hapusPeran(terpilih)} disabled={sibukId !== null}>Hapus</button>
              </>
            )}
          </div>
        </section>
      </div>
      </>
    );
  }

  // ================= VIEW 1: daftar ringkasan peran (bawaan) =================
  return (
    <>
    {dialogPeran}
    {dialogKonfirmasiHapus}
    <div className="ax-wrap">
      <section className="ax-kartu">
        <div className="ax-kartu__kepala">
          <div>
            <h3>Matriks Hak Akses Peran</h3>
            <p>Kelola tingkat izin menu dan aksi untuk setiap peran pengguna di sistem.</p>
          </div>
          <button type="button" className="ax-btn" onClick={() => void tambahPeran()} disabled={!admin || sibukId !== null}>
            ＋ Buat Peran Baru
          </button>
        </div>
        <div className="ax-tabel-bungkus">
          <table className="ax-tabel">
            <thead>
              <tr>
                <th>Nama Peran</th>
                <th>Deskripsi &amp; Cakupan Hak Akses</th>
                <th className="rata-tengah">Pengguna</th>
                <th className="rata-tengah">Status Hak Akses</th>
                <th className="rata-tengah">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {daftar.map((p) => (
                <tr key={p.id}>
                  <td>
                    {/* AY — menu awal peran sebagai keterangan baca-saja. */}
                    <span
                      className="ax-nama"
                      title={`Menu awal: ${p.menuAwalLabel ?? labelMenuAwalKlien(p.menu_awal)}`}
                    >
                      {p.nama}
                    </span>
                    {p.top && <span className="ax-badge-penuh">selalu penuh</span>}
                  </td>
                  <td>{deskripsiPeran(p.nama)}</td>
                  <td className="rata-tengah">{p.jumlah_pengguna} pengguna</td>
                  <td className="rata-tengah">
                    {p.top
                      ? <span className="ax-pill ax-pill--gudang-semua">Selalu Penuh</span>
                      : <span className="ax-pill ax-pill--netral">Kustom</span>}
                  </td>
                  <td className="rata-tengah">
                    <button
                      type="button"
                      className={p.top ? 'ax-btn ax-btn--netral' : 'ax-btn'}
                      onClick={() => setTerpilihId(p.id)}
                      disabled={sibukId !== null}
                    >
                      {p.top ? 'Lihat Akses' : 'Atur Hak Akses'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
    </>
  );
}

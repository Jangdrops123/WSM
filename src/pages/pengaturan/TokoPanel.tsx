import { useCallback, useEffect, useState } from 'react';
import { beritahu } from '../../components/crud/Toast';
import { apiDelete, apiGet, apiPost, apiPut } from '../../lib/api';
import { useSegarkanModul } from '../../lib/segarkan';

export interface BarisToko {
  id: number;
  kode: string;
  nama: string;
  alamat: string | null;
  telepon: string | null;
  email: string | null;
  logo: string | null;
  warehouse_id: number | null;
  gudang_nama: string | null;
  aktif: number;
}

interface Gudang {
  id: number;
  kode: string;
  nama: string;
}

const KOSONG = {
  kode: '',
  nama: '',
  alamat: '',
  telepon: '',
  email: '',
  logo: '',
  warehouse_id: '',
};

/**
 * Daftar toko + gudang (Pengaturan ▸ Data Toko & Gudang).
 * CRUD toko menyimpan kode, alamat, telepon, logo, dan gudang bawaan per toko.
 */
export function TokoPanel() {
  const [toko, setToko] = useState<BarisToko[]>([]);
  const [gudang, setGudang] = useState<Gudang[]>([]);
  const [form, setForm] = useState({ ...KOSONG });
  const [editId, setEditId] = useState<number | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [gudangBawaanId, setGudangBawaanId] = useState<number | null>(null);

  const muat = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([
        apiGet<{ data: BarisToko[]; gudang: Gudang[] }>('/api/pengaturan/toko'),
        apiGet<{ nilai: Record<string, unknown> }>('/api/pengaturan/toko-gudang').catch(() => null),
      ]);
      setToko(r.data);
      setGudang(r.gudang ?? []);
      setGudangBawaanId(
        r.gudang?.find((g) => String(g.id) === String(s?.nilai?.gudang_bawaan ?? ''))?.id ?? null,
      );
    } catch (e) {
      beritahu(e instanceof Error ? e.message : 'Gagal memuat daftar toko.', 'galat');
    }
  }, []);

  useEffect(() => {
    void muat();
  }, [muat]);
  // Tombol Refresh global di topbar: muat ulang daftar toko & gudang.
  useSegarkanModul(muat);

  function mulaiEdit(t: BarisToko) {
    setEditId(t.id);
    setForm({
      kode: t.kode,
      nama: t.nama,
      alamat: t.alamat ?? '',
      telepon: t.telepon ?? '',
      email: t.email ?? '',
      logo: t.logo ?? '',
      warehouse_id: t.warehouse_id === null ? '' : String(t.warehouse_id),
    });
  }

  function batal() {
    setEditId(null);
    setForm({ ...KOSONG });
  }

  async function simpanToko() {
    setSibuk(true);
    try {
      const body = { ...form, warehouse_id: form.warehouse_id === '' ? null : Number(form.warehouse_id) };
      if (editId) await apiPut(`/api/pengaturan/toko/${editId}`, body);
      else await apiPost('/api/pengaturan/toko', body);
      beritahu(editId ? 'Toko diperbarui.' : 'Toko ditambahkan.');
      batal();
      await muat();
    } catch (e) {
      beritahu(e instanceof Error ? e.message : 'Gagal menyimpan toko.', 'galat');
    } finally {
      setSibuk(false);
    }
  }

  async function hapus(t: BarisToko) {
    if (!window.confirm(`Hapus toko "${t.nama}"? Pengaturan khusus toko ini ikut terhapus.`)) return;
    setSibuk(true);
    try {
      const r = await apiDelete<{ pesan: string }>(`/api/pengaturan/toko/${t.id}`);
      beritahu(r.pesan, 'info');
      if (editId === t.id) batal();
      await muat();
    } catch (e) {
      beritahu(e instanceof Error ? e.message : 'Gagal menghapus toko.', 'galat');
    } finally {
      setSibuk(false);
    }
  }

  return (
    <section className="kartu">
      <div className="kartu__kepala kartu__kepala--kompak">
        <h3>Data Toko &amp; Gudang</h3>
        <span className="teks-redup">Gudang bawaan dipilih pada tab ini; daftar gudang dikelola di Master ▸ Gudang.</span>
      </div>

      <table className="aturan-tabel">
        <thead>
          <tr>
            <th>Kode</th>
            <th>Nama</th>
            <th>Alamat</th>
            <th>Telepon</th>
            <th>Gudang</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {toko.length === 0 && (
            <tr>
              <td colSpan={7} className="teks-redup">
                Belum ada toko. Tambahkan toko pertama pada formulir di bawah.
              </td>
            </tr>
          )}
          {toko.map((t) => (
            <tr key={t.id}>
              <td>
                <strong>{t.kode}</strong>
              </td>
              <td>
                {t.nama}
                {gudangBawaanId !== null && t.warehouse_id === gudangBawaanId && (
                  <span className="lencana-per-toko">Gudang bawaan</span>
                )}
              </td>
              <td>{t.alamat ?? '—'}</td>
              <td>{t.telepon ?? '—'}</td>
              <td>{t.gudang_nama ?? '—'}</td>
              <td>{t.aktif ? 'Aktif' : 'Nonaktif'}</td>
              <td>
                <span className="aksi-baris">
                  <button type="button" className="tombol tombol--kecil" onClick={() => mulaiEdit(t)}>
                    Ubah
                  </button>
                  <button type="button" className="tombol tombol--kecil tombol--bahaya" onClick={() => void hapus(t)}>
                    Hapus
                  </button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="form-grid" style={{ marginTop: 12 }}>
        <div className="bidang">
          <label htmlFor="toko-kode">Kode toko</label>
          <input id="toko-kode" value={form.kode} maxLength={20} onChange={(e) => setForm({ ...form, kode: e.target.value.toUpperCase() })} />
        </div>
        <div className="bidang">
          <label htmlFor="toko-nama">Nama toko</label>
          <input id="toko-nama" value={form.nama} maxLength={120} onChange={(e) => setForm({ ...form, nama: e.target.value })} />
        </div>
        <div className="bidang bidang--dua">
          <label htmlFor="toko-alamat">Alamat</label>
          <input id="toko-alamat" value={form.alamat} maxLength={400} onChange={(e) => setForm({ ...form, alamat: e.target.value })} />
        </div>
        <div className="bidang">
          <label htmlFor="toko-telepon">Telepon</label>
          <input id="toko-telepon" value={form.telepon} maxLength={40} onChange={(e) => setForm({ ...form, telepon: e.target.value })} />
        </div>
        <div className="bidang">
          <label htmlFor="toko-logo">Logo toko</label>
          <input id="toko-logo" type="url" placeholder="https://…" value={form.logo} onChange={(e) => setForm({ ...form, logo: e.target.value })} />
        </div>
        <div className="bidang">
          <label htmlFor="toko-gudang">Gudang</label>
          <select id="toko-gudang" value={form.warehouse_id} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}>
            <option value="">— pilih gudang —</option>
            {gudang.map((g) => (
              <option key={g.id} value={g.id}>
                {g.nama} ({g.kode})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="tombol-baris tombol-baris--kanan">
        <span className="teks-redup">{editId ? `Mengubah toko #${editId}` : ''}</span>
        {editId !== null && (
          <button type="button" className="tombol tombol--netral" onClick={batal}>
            Batal
          </button>
        )}
        <button type="button" className="tombol" onClick={() => void simpanToko()} disabled={sibuk || !form.kode || !form.nama}>
          {editId ? 'Simpan Toko' : 'Tambah Toko'}
        </button>
      </div>
    </section>
  );
}

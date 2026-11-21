import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { beritahu } from '../../components/crud/Toast';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { Modal } from '../../components/crud/Modal';
import { apiDelete, apiGet, apiPost, apiPostBatasWaktu, apiPut } from '../../lib/api';
import { useSegarkanModul } from '../../lib/segarkan';
import { formatAngka, formatTanggalPanjang } from '../../lib/format';
import { useIdentitas } from '../../lib/identitas';
import { useSesi } from '../../lib/sesi';
import { PanelResetData } from './PanelResetData';

const fmtUkuran = (b: number): string =>
  b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : b >= 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`;

/* =================== Grup Keuangan ▸ Kas & Bank ======================= */

interface RekKas {
  id: number;
  kode: string;
  nama: string;
  jenis: 'kas' | 'bank' | 'e-wallet';
  aktif: number;
  saldo?: number;
  /** Metode bayar yang ditautkan ke rekening ini (tunai/transfer/qris). */
  metode?: string[];
  /** Rekening default pembayaran hutang/piutang. */
  default?: boolean;
}

interface FormRek {
  nama: string;
  jenis: 'kas' | 'bank' | 'e-wallet';
  kode: string;
  metode: string[];
  default: boolean;
}

const kosongRek = (): FormRek => ({ nama: '', jenis: 'kas', kode: '', metode: [], default: false });

interface MetodeBayar {
  metode: string;
  cash_account_id: number;
  akun_nama: string;
}

const JENIS_LABEL: Record<string, string> = { kas: 'Kas', bank: 'Bank', 'e-wallet': 'E-Wallet' };
const METODE_LABEL: Record<string, string> = { tunai: 'Tunai', transfer: 'Transfer', qris: 'QRIS / EDC' };
const labelMetode = (m: string): string => METODE_LABEL[m] ?? m;

/** Tipe rekening pada formulir tambah/ubah. */
const JENIS_REK: { nilai: 'kas' | 'bank' | 'e-wallet'; label: string }[] = [
  { nilai: 'kas', label: 'Kas / Tunai' },
  { nilai: 'bank', label: 'Bank / Transfer' },
  { nilai: 'e-wallet', label: 'E-Wallet' },
];

/** Metode bayar yang bisa diwakili sebuah rekening (EDC/Debit ikut QRIS). */
const METODE_OPSI: { nilai: string; label: string }[] = [
  { nilai: 'tunai', label: 'Tunai' },
  { nilai: 'transfer', label: 'Transfer Bank' },
  { nilai: 'qris', label: 'EDC / Debit / QRIS' },
];

/**
 * Kas & Bank (Akuntansi Dasar): rekening bawaan per metode bayar (tunai/
 * transfer/qris → rekening kas) — penjualan tunai & pembayaran piutang/hutang
 * otomatis memakai rekening ini. Kategori biaya & pemasukan juga dikelola di
 * halaman Akuntansi ▸ Pengeluaran / Pemasukan Lain.
 */
export function PanelKasBank({ nilai }: { nilai: Record<string, unknown> }) {
  const [rek, setRek] = useState<RekKas[]>([]);
  const [metode, setMetode] = useState<MetodeBayar[]>([]);
  const [sibuk, setSibuk] = useState(false);
  // Dialog tambah/ubah rekening kas & bank.
  const [buka, setBuka] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormRek>(kosongRek());
  const daftarMetode = Array.isArray(nilai.metode_bayar) ? (nilai.metode_bayar as string[]) : ['tunai', 'transfer', 'qris'];

  const muat = useCallback(async () => {
    const r = await apiGet<{ data: RekKas[] }>('/api/akuntansi/kas/akun').catch(() => ({ data: [] as RekKas[] }));
    setRek(r.data.filter((a) => a.aktif !== 0));
    const m = await apiGet<{ data: MetodeBayar[] }>('/api/akuntansi/metode-bayar').catch(() => ({ data: [] as MetodeBayar[] }));
    setMetode(m.data);
  }, []);

  useEffect(() => {
    void muat();
  }, [muat]);
  // Tombol Refresh global di topbar: muat ulang data panel ini.
  useSegarkanModul(muat);

  const simpanMetode = async (m: string, akunId: number) => {
    setSibuk(true);
    try {
      await apiPut('/api/akuntansi/metode-bayar', { metode: m, akun_id: akunId });
      beritahu(`Metode bayar "${METODE_LABEL[m] ?? m}" ditautkan ke rekening.`);
      await muat();
    } catch (e) {
      beritahu(e instanceof Error ? e.message : 'Gagal menyimpan pemetaan metode bayar.', 'galat');
    } finally {
      setSibuk(false);
    }
  };

  const bukaTambah = () => {
    setEditId(null);
    setForm(kosongRek());
    setBuka(true);
  };

  const bukaUbah = (a: RekKas) => {
    setEditId(a.id);
    setForm({ nama: a.nama, jenis: a.jenis, kode: a.kode, metode: a.metode ?? [], default: Boolean(a.default) });
    setBuka(true);
  };

  /** Simpan rekening baru/ubah + tautkan metode bayar & default pembayaran. */
  const simpanRek = async () => {
    if (!form.nama.trim()) return;
    setSibuk(true);
    try {
      const body = {
        nama: form.nama.trim(),
        jenis: form.jenis,
        kode: form.kode.trim(),
        metode: form.metode,
        default_pembayaran: form.default,
      };
      if (editId) await apiPut(`/api/akuntansi/kas/akun/${editId}`, body);
      else await apiPost('/api/akuntansi/kas/akun', body);
      beritahu(editId ? 'Rekening kas/bank diperbarui.' : 'Rekening kas/bank ditambahkan.', 'sukses');
      setBuka(false);
      setEditId(null);
      await muat();
    } catch (e) {
      beritahu(e instanceof Error ? e.message : 'Gagal menyimpan rekening kas/bank.', 'galat');
    } finally {
      setSibuk(false);
    }
  };

  return (
    <section className="kartu">
      <div className="kartu__kepala kartu__kepala--kompak">
        <div>
          <h3>Rekening Kas &amp; Bank</h3>
          <p className="teks-redup teks-kecil">Rekening penampung kas, bank, dan e-wallet beserta metode bayarnya.</p>
        </div>
        <div className="aksi-baris">
          <Link to="/akuntansi/kas" className="teks-redup teks-kecil">
            Akuntansi ▸ Kas &amp; Bank →
          </Link>
          <button type="button" className="tombol tombol--primer tombol--kecil" disabled={sibuk} onClick={bukaTambah}>
            <Icon nama="plus" size={14} /> Tambah Rekening Kas &amp; Bank
          </button>
        </div>
      </div>
      <p className="teks-redup">
        Penjualan tunai &amp; pembayaran piutang menambah Kas Masuk; pembelian &amp; pembayaran hutang menjadi Kas Keluar —
        memakai rekening di bawah ini sesuai metode bayar.
      </p>
      <div className="form-grid">
        {daftarMetode.map((m) => {
          const aktif = metode.find((x) => x.metode === m)?.cash_account_id ?? '';
          return (
            <div className="bidang" key={m}>
              <label htmlFor={`mb-${m}`}>{METODE_LABEL[m] ?? m}</label>
              <select
                id={`mb-${m}`}
                value={aktif}
                disabled={sibuk}
                onChange={(e) => void simpanMetode(m, Number(e.target.value))}
              >
                <option value="">— pilih rekening —</option>
                {rek.map((a) => (
                  <option key={a.id} value={a.id}>{a.kode} · {a.nama}</option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
      <h4 className="teks-redup" style={{ marginTop: 14 }}>Rekening kas/bank aktif</h4>
      <table className="aturan-tabel">
        <thead>
          <tr>
            <th>Kode</th>
            <th>Nama</th>
            <th>Jenis</th>
            <th>Metode Bayar</th>
            <th>Default</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rek.length === 0 && (
            <tr>
              <td colSpan={6} className="teks-redup">
                Belum ada rekening kas/bank. Klik “Tambah Rekening Kas &amp; Bank” di atas.
              </td>
            </tr>
          )}
          {rek.map((a) => (
            <tr key={a.id}>
              <td><strong>{a.kode}</strong></td>
              <td>{a.nama}</td>
              <td>{JENIS_LABEL[a.jenis] ?? a.jenis}</td>
              <td className="teks-redup">
                {(a.metode ?? []).length ? (a.metode ?? []).map(labelMetode).join(', ') : '—'}
              </td>
              <td>{a.default ? <span className="lencana lencana--aktif">Default</span> : '—'}</td>
              <td>
                <button type="button" className="tombol tombol--kecil" disabled={sibuk} onClick={() => bukaUbah(a)}>
                  Ubah
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {buka && (
        <Modal
          judul={editId ? 'Ubah Rekening Kas & Bank' : 'Tambah Rekening Kas & Bank'}
          lebar="sedang"
          onTutup={() => setBuka(false)}
          sedangKirim={sibuk}
          aksi={
            <>
              <button type="button" className="tombol tombol--netral" disabled={sibuk} onClick={() => setBuka(false)}>
                Batal
              </button>
              <button
                type="button"
                className="tombol tombol--primer"
                disabled={sibuk || !form.nama.trim()}
                onClick={() => void simpanRek()}
              >
                {sibuk ? 'Menyimpan…' : 'Simpan'}
              </button>
            </>
          }
        >
          <div className="form-grid">
            <label>
              Nama Rekening
              <input
                className="input-cari"
                value={form.nama}
                placeholder="Kas Kasir, Bank BCA, …"
                onChange={(e) => setForm({ ...form, nama: e.target.value })}
              />
            </label>
            <label>
              Tipe Rekening
              <select
                className="input-pilih"
                value={form.jenis}
                onChange={(e) => setForm({ ...form, jenis: e.target.value as FormRek['jenis'] })}
              >
                {JENIS_REK.map((j) => (
                  <option key={j.nilai} value={j.nilai}>{j.label}</option>
                ))}
              </select>
            </label>
            <label>
              Kode / Nomor Rekening (COA)
              <input
                className="input-cari"
                value={form.kode}
                placeholder="Otomatis bila kosong (KAS-001, BANK-001, …)"
                onChange={(e) => setForm({ ...form, kode: e.target.value })}
              />
            </label>
          </div>

          <div className="bidang" style={{ marginTop: 12 }}>
            <span className="teks-redup teks-kecil">Metode bayar yang diwakili</span>
            <div className="aksi-baris" style={{ flexWrap: 'wrap', gap: 14, marginTop: 6 }}>
              {METODE_OPSI.map((m) => (
                <label key={m.nilai} className="backup-toggle">
                  <input
                    type="checkbox"
                    checked={form.metode.includes(m.nilai)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        metode: e.target.checked
                          ? [...form.metode, m.nilai]
                          : form.metode.filter((x) => x !== m.nilai),
                      })
                    }
                  />
                  <span>{m.label}</span>
                </label>
              ))}
            </div>
          </div>

          <label className="backup-toggle" style={{ marginTop: 14 }}>
            <input
              type="checkbox"
              checked={form.default}
              onChange={(e) => setForm({ ...form, default: e.target.checked })}
            />
            <span>Set sebagai default pembayaran hutang / piutang</span>
          </label>
        </Modal>
      )}
    </section>
  );
}

/* ================= Grup Keamanan & Sistem ▸ 16. Keamanan ================ */

interface BarisSesi {
  id: number;
  perangkat: string | null;
  terakhir: string;
  ip: string | null;
  nama: string;
  username: string;
}

interface StatusKode {
  ada: boolean;
  dibuat: number;
  sisa: number;
  waktu: string | null;
}

/**
 * TAHAP 1 & 2 — Keamanan:
 *  • daftar sesi/perangkat aktif + Keluar Paksa per sesi (ada penanda
 *    "Sesi ini" supaya Admin tidak salah mengeluarkan dirinya sendiri),
 *  • Kode Pemulihan Admin utama: 10 kode sekali pakai — tampil SEKALI saat
 *    dibuat, dengan salin/unduh.
 */
export function PanelKeamanan() {
  const { info } = useSesi();
  const sesiSaya = info?.sesiId ?? null;
  const admin = info?.pengguna.admin ?? false;

  const [baris, setBaris] = useState<BarisSesi[] | null>(null);
  const [status, setStatus] = useState<StatusKode | null>(null);
  const [kodeBaru, setKodeBaru] = useState<string[] | null>(null);
  const [keluarTarget, setKeluarTarget] = useState<BarisSesi | null>(null);
  const [sibuk, setSibuk] = useState(false);

  const muat = useCallback(async () => {
    try {
      const r = await apiGet<{ data: BarisSesi[] }>('/api/pengaturan/keamanan/sesi');
      setBaris(r.data);
    } catch {
      setBaris([]);
    }
    try {
      setStatus(await apiGet<StatusKode>('/api/pengaturan/keamanan/kode-pemulihan'));
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void muat();
  }, [muat]);
  // Tombol Refresh global di topbar: muat ulang data panel ini.
  useSegarkanModul(muat);

  async function keluarkan(b: BarisSesi) {
    setSibuk(true);
    try {
      const r = await apiDelete<{ pesan: string }>(`/api/pengaturan/keamanan/sesi/${b.id}`);
      beritahu(r.pesan);
      setKeluarTarget(null);
      await muat();
    } catch (e) {
      beritahu(e instanceof Error ? e.message : 'Gagal mengeluarkan sesi.', 'galat');
    } finally {
      setSibuk(false);
    }
  }

  async function buatKode() {
    setSibuk(true);
    try {
      const r = await apiPost<{ kode: string[]; pesan: string }>('/api/pengaturan/keamanan/kode-pemulihan', {});
      setKodeBaru(r.kode);
      beritahu(r.pesan);
      await muat();
    } catch (e) {
      beritahu(e instanceof Error ? e.message : 'Gagal membuat Kode Pemulihan.', 'galat');
    } finally {
      setSibuk(false);
    }
  }

  async function salinKode() {
    try {
      await navigator.clipboard.writeText((kodeBaru ?? []).join('\n'));
      beritahu('Kesepuluh kode disalin ke papan klip.');
    } catch {
      beritahu('Peramban menolak papan klip — gunakan tombol Unduh.', 'galat');
    }
  }

  function unduhKode() {
    const isi =
      `Kode Pemulihan — ${formatTanggalPanjang(new Date().toISOString())}\n\n` +
      `${(kodeBaru ?? []).join('\n')}\n\n` +
      'Simpan di tempat aman. Tiap kode hanya bisa dipakai sekali untuk menyetel ulang password Admin utama.\n';
    const url = URL.createObjectURL(new Blob([isi], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kode-pemulihan.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  if (baris === null) return <p className="teks-redup">Memuat sesi…</p>;

  return (
    <>
      <section className="kartu">
        <div className="kartu__kepala kartu__kepala--kompak">
          <h3>Perangkat &amp; Sesi Aktif</h3>
          <span className="teks-redup">Keluarkan paksa perangkat yang tidak dikenali.</span>
        </div>
        {baris.length === 0 ? (
          <p className="teks-redup">Belum ada sesi aktif — tidak ada perangkat yang sedang masuk saat ini.</p>
        ) : (
          <table className="aturan-tabel">
            <thead>
              <tr>
                <th>Pengguna</th>
                <th>Perangkat</th>
                <th>Alamat IP</th>
                <th>Terakhir aktif</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {baris.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.nama}</strong>
                    <div className="teks-redup teks-kecil">{s.username}</div>
                  </td>
                  <td>
                    {s.perangkat ?? '—'}
                    {s.id === sesiSaya && (
                      <span className="lencana lencana--aktif" style={{ marginLeft: 6 }}>
                        Sesi ini
                      </span>
                    )}
                  </td>
                  <td>{s.ip ?? '—'}</td>
                  <td>{formatTanggalPanjang(s.terakhir)}</td>
                  <td>
                    <IconButton
                      label={s.id === sesiSaya ? 'Keluar dari sesi ini' : 'Keluarkan paksa'}
                      ikon="power"
                      onClick={() => setKeluarTarget(s)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="kartu">
        <div className="kartu__kepala kartu__kepala--kompak">
          <h3>Kode Pemulihan Admin</h3>
          {admin ? (
            <button type="button" className="tombol tombol--kecil" disabled={sibuk} onClick={() => void buatKode()}>
              {sibuk ? 'Membuat…' : 'Buat 10 kode baru'}
            </button>
          ) : (
            <span className="teks-redup">Hanya Admin yang bisa membuat kode baru.</span>
          )}
        </div>
        <p className="teks-redup">
          Kode Pemulihan dipakai saat lupa password dan email/WhatsApp belum tersambung: masukkan satu kode di
          halaman Lupa password untuk membuat password baru. Membuat kode baru otomatis membatalkan kode lama.
        </p>
        {status === null ? (
          <p className="teks-redup">Status kode belum tersedia.</p>
        ) : (
          <dl className="info-sistem">
            <div>
              <dt>Pernah dibuat</dt>
              <dd>{status.ada ? `${status.dibuat} kode` : 'Belum pernah'}</dd>
            </div>
            <div>
              <dt>Sisa belum dipakai</dt>
              <dd>{status.sisa}</dd>
            </div>
            <div>
              <dt>Dibuat terakhir</dt>
              <dd>{status.waktu ? formatTanggalPanjang(status.waktu) : '—'}</dd>
            </div>
          </dl>
        )}
      </section>

      {keluarTarget && (
        <Modal
          judul="Keluarkan sesi"
          lebar="kecil"
          onTutup={() => setKeluarTarget(null)}
          sedangKirim={sibuk}
          aksi={
            <>
              <button type="button" className="tombol tombol--netral" onClick={() => setKeluarTarget(null)} disabled={sibuk}>
                Batal
              </button>
              <button type="button" className="tombol tombol--bahaya" onClick={() => void keluarkan(keluarTarget)} disabled={sibuk}>
                {sibuk ? 'Mengeluarkan…' : 'Keluarkan'}
              </button>
            </>
          }
        >
          <p>
            Keluarkan sesi <strong>{keluarTarget.nama}</strong> ({keluarTarget.username}) di perangkat{' '}
            <strong>{keluarTarget.perangkat ?? 'tanpa nama'}</strong>?
            {keluarTarget.id === sesiSaya && ' Ini adalah sesi Anda sendiri — Anda akan keluar dari aplikasi.'}
          </p>
          <p className="teks-redup">Perangkat tersebut harus masuk kembali dengan password setelah dikeluarkan.</p>
        </Modal>
      )}

      {kodeBaru && (
        <Modal
          judul="Kode Pemulihan — tampil sekali"
          lebar="sedang"
          onTutup={() => setKodeBaru(null)}
          aksi={
            <>
              <button type="button" className="tombol tombol--netral" onClick={unduhKode}>
                Unduh .txt
              </button>
              <button type="button" className="tombol" onClick={() => void salinKode()}>
                Salin semua
              </button>
              <button type="button" className="tombol tombol--primer" onClick={() => setKodeBaru(null)}>
                Sudah saya simpan
              </button>
            </>
          }
        >
          <p className="peringatan-dampak">
            Kesepuluh kode ini HANYA tampil sekali ini dan tidak bisa dilihat lagi. Simpan di tempat aman
            (cetak/unduh) sekarang juga — tiap kode hanya bisa dipakai satu kali.
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: 8,
              fontFamily: 'ui-monospace, monospace',
              fontSize: 14,
              letterSpacing: '0.05em',
            }}
          >
            {kodeBaru.map((k) => (
              <span
                key={k}
                style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}
              >
                {k}
              </span>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}

/* =============== Keamanan & Sistem ▸ 18. Database & Backup ============== */

interface InfoSistem {
  versi: string; namaDatabase: string; ukuranDb: number; waktuDatabase: string;
  migrasi: number; ringkasan: { nama: string; jumlah: number }[];
  cadangan: { nama: string; ukuran: number; waktu: string }[];
}

/** Info database, cadangan manual/terjadwal, dan pemulihan (dengan peringatan). */
type ModeRawat = 'standar' | 'penuh' | 'reindex';

/**
 * Tiga tombol pemeliharaan database. Konfirmasi memakai Modal aplikasi
 * (bukan window.confirm) dengan peringatan yang menjelaskan dampak tiap mode.
 */
const TOMBOL_RAWAT: { mode: ModeRawat; label: string; ringkas: string }[] = [
  { mode: 'standar', label: 'Vacuum Standard', ringkas: 'merampingkan database dan memperbarui statistik' },
  { mode: 'penuh', label: 'Vacuum Full', ringkas: 'merampingkan penyimpanan fisik secara menyeluruh (lebih lama, mengunci tulis)' },
  { mode: 'reindex', label: 'Re Index', ringkas: 'menyusun ulang seluruh indeks database' },
];

interface BarisRiwayatBackup {
  nama: string; ukuran: number; waktu: string;
  tipe: 'manual' | 'otomatis' | 'pengaman'; status: 'sukses' | 'gagal'; galat?: string;
}

interface StatusJadwal {
  mode: 'mati' | '4jam' | '6jam' | '12jam' | 'harian' | 'mingguan' | 'bulanan' | 'kustom';
  jam: string;
  jumlah: number; retensi_hari: number;
  interval_nilai: number;
  interval_satuan: 'menit' | 'jam';
  terakhir_otomatis: string | null; berikutnya: string | null;
}

const TIPE_LABEL: Record<BarisRiwayatBackup['tipe'], string> = {
  manual: 'Manual', otomatis: 'Otomatis', pengaman: 'Pengaman',
};

const JAM_OPSI = ['00:00', '01:00', '02:00', '03:00', '22:00', '23:00'];

/** Kata konfirmasi ganda untuk restore (diketik pengguna, huruf besar semua). */
const KATA_RESTORE = 'RESTORE';

export function PanelDatabase({ nilai }: { nilai: Record<string, unknown> }) {
  const [info, setInfo] = useState<InfoSistem | null>(null);
  const [daftar, setDaftar] = useState<BarisRiwayatBackup[]>([]);
  const [jadwal, setJadwal] = useState<StatusJadwal | null>(null);
  const [maintenance, setMaintenance] = useState(false);
  // Backup manual / restore / hapus.
  const [backupSibuk, setBackupSibuk] = useState(false);
  const [restoreNama, setRestoreNama] = useState<string | null>(null);
  const [konfirmasi, setKonfirmasi] = useState('');
  const [restoreSibuk, setRestoreSibuk] = useState(false);
  const [hapusNama, setHapusNama] = useState<string | null>(null);
  const [hapusSibuk, setHapusSibuk] = useState(false);
  // Restore dari unggahan.
  const [unggah, setUnggah] = useState<File | null>(null);
  const [konfirmasiUnggah, setKonfirmasiUnggah] = useState('');
  const [unggahSibuk, setUnggahSibuk] = useState(false);
  const pemilihBerkas = useRef<HTMLInputElement | null>(null);
  // Jadwal otomatis (form).
  const [jadwalAktif, setJadwalAktif] = useState(false);
  const [jadwalMode, setJadwalMode] = useState('harian');
  const [jadwalJam, setJadwalJam] = useState('02:00');
  const [jadwalIntervalNilai, setJadwalIntervalNilai] = useState(4);
  const [jadwalIntervalSatuan, setJadwalIntervalSatuan] = useState<'menit' | 'jam'>('jam');
  const [jadwalJumlah, setJadwalJumlah] = useState(14);
  const [jadwalRetensi, setJadwalRetensi] = useState(30);
  const [jadwalSibuk, setJadwalSibuk] = useState(false);
  const [rawatSibuk, setRawatSibuk] = useState<ModeRawat | null>(null);
  // Modal konfirmasi pemeliharaan (pengganti window.confirm bawaan browser).
  const [rawatKonfirmasi, setRawatKonfirmasi] = useState<{ mode: ModeRawat; label: string; ringkas: string } | null>(
    null,
  );
  // Backup/restore hanya untuk Administrator — UI mengikuti penjagaan server.
  const { info: sesi } = useSesi();
  const admin = sesi?.pengguna.admin === true;

  const muat = useCallback(async () => {
    try {
      const [sys, list, jd] = await Promise.all([
        apiGet<InfoSistem>('/api/pengaturan/sistem/info').catch(() => null),
        apiGet<{ data: BarisRiwayatBackup[]; maintenance: boolean }>('/api/backup/list'),
        apiGet<StatusJadwal & { maintenance: boolean }>('/api/backup/jadwal').catch(() => null),
      ]);
      if (sys) setInfo(sys);
      setDaftar(list.data ?? []);
      setMaintenance(Boolean(list.maintenance));
      if (jd) {
        setJadwal(jd);
        setJadwalAktif(jd.mode !== 'mati');
        setJadwalMode(jd.mode === 'mati' ? 'harian' : jd.mode);
        setJadwalJam(jd.jam);
        setJadwalIntervalNilai(jd.interval_nilai || 4);
        setJadwalIntervalSatuan(jd.interval_satuan === 'menit' ? 'menit' : 'jam');
        setJadwalJumlah(jd.jumlah);
        setJadwalRetensi(jd.retensi_hari);
      }
    } catch (e) {
      beritahu(e instanceof Error ? e.message : 'Gagal memuat data backup.', 'galat');
    }
  }, []);

  useEffect(() => {
    void muat();
  }, [muat]);
  // Tombol Refresh global di topbar: muat ulang data panel ini.
  useSegarkanModul(muat);

  async function cadangkan() {
    if (!admin) {
      beritahu('Buat backup hanya dapat dijalankan Administrator.', 'galat');
      return;
    }
    if (backupSibuk) return;
    setBackupSibuk(true);
    try {
      const r = await apiPost<{ nama: string; pesan: string }>('/api/backup/create', {});
      beritahu(r.pesan, 'sukses');
      await muat();
    } catch (e) {
      beritahu(e instanceof Error ? e.message : 'Gagal membuat cadangan.', 'galat');
    } finally {
      setBackupSibuk(false);
    }
  }

  async function simpanJadwal() {
    if (!admin) {
      beritahu('Perubahan jadwal backup hanya untuk Administrator.', 'galat');
      return;
    }
    if (jadwalSibuk) return;
    if (jadwalAktif && jadwalMode === 'kustom') {
      const maks = jadwalIntervalSatuan === 'jam' ? 168 : 1440;
      if (!Number.isInteger(jadwalIntervalNilai) || jadwalIntervalNilai < 1 || jadwalIntervalNilai > maks) {
        beritahu(`Interval kustom harus 1–${maks} ${jadwalIntervalSatuan}.`, 'galat');
        return;
      }
    }
    setJadwalSibuk(true);
    try {
      const r = await apiPut<{ pesan: string }>('/api/backup/jadwal', {
        backup_otomatis: jadwalAktif ? jadwalMode : 'mati',
        backup_jam: jadwalJam,
        interval_nilai: Number(jadwalIntervalNilai),
        interval_satuan: jadwalIntervalSatuan,
        jumlah_backup: Number(jadwalJumlah),
        retensi_hari: Number(jadwalRetensi),
      });
      beritahu(r.pesan, 'sukses');
      await muat();
    } catch (e) {
      beritahu(e instanceof Error ? e.message : 'Gagal menyimpan jadwal.', 'galat');
    } finally {
      setJadwalSibuk(false);
    }
  }

  /** Jalankan pemeliharaan setelah konfirmasi modal (batas waktu 2 menit). */
  async function jalankanRawat() {
    if (!rawatKonfirmasi || rawatSibuk !== null) return;
    const { mode, label } = rawatKonfirmasi;
    setRawatSibuk(mode);
    try {
      const r = await apiPostBatasWaktu<{ pesan: string }>(
        '/api/settings/database/maintenance',
        { mode },
        120_000,
      );
      setRawatKonfirmasi(null);
      beritahu(`Pemeliharaan Database ${label} berhasil dijalankan. ${r.pesan}`, 'sukses');
      // Ukuran database pada section "Database Aktif" ikut diperbarui.
      await muat();
    } catch (e) {
      beritahu(e instanceof Error ? e.message : `Gagal menjalankan ${label}.`, 'galat');
    } finally {
      setRawatSibuk(null);
    }
  }

  function pilihBerkasRestore(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    e.target.value = ''; // boleh pilih berkas yang sama berulang kali
    if (!f) return;
    if (!/\.(sql|sql\.gz|dump|tar)$/i.test(f.name)) {
      beritahu('Berkas bukan cadangan PostgreSQL yang didukung (.sql, .sql.gz, .dump, .tar). Berkas SQLite (.db) tidak berlaku untuk database ini.', 'galat');
      return;
    }
    if (!admin) {
      beritahu('Upload restore hanya untuk Administrator.', 'galat');
      return;
    }
    if (f.size > 512 * 1024 * 1024) {
      beritahu('Berkas melebihi batas 512 MB.', 'galat');
      return;
    }
    setUnggah(f);
    setKonfirmasiUnggah('');
  }

  async function kirimRestore(nama: string | null, konfirmasiTeks: string, berkas: File | null) {
    if (!admin) {
      beritahu('Restore database hanya untuk Administrator.', 'galat');
      return;
    }
    if (restoreSibuk || unggahSibuk) return;
    if (berkas) setUnggahSibuk(true);
    else setRestoreSibuk(true);
    try {
      let pesan = '';
      if (berkas) {
        const res = await fetch(
          `/api/backup/restore?nama=${encodeURIComponent(berkas.name)}&konfirmasi=${encodeURIComponent(konfirmasiTeks)}`,
          { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: berkas },
        );
        let data: { pesan?: string } | null = null;
        try { data = (await res.json()) as { pesan?: string }; } catch { /* bukan JSON */ }
        if (!res.ok) throw new Error(data?.pesan ?? `Gagal restore (HTTP ${res.status}).`);
        pesan = data?.pesan ?? 'Database berhasil dipulihkan! Halaman akan dimuat ulang.';
      } else {
        const r = await apiPost<{ pesan: string }>('/api/backup/restore', { nama, konfirmasi: konfirmasiTeks });
        pesan = r.pesan;
      }
      beritahu(pesan, 'sukses');
      setRestoreNama(null);
      setKonfirmasi('');
      setUnggah(null);
      setKonfirmasiUnggah('');
      window.setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      beritahu(e instanceof Error ? e.message : 'Gagal restore database.', 'galat');
    } finally {
      setRestoreSibuk(false);
      setUnggahSibuk(false);
    }
  }

  async function hapusCadangan() {
    if (!admin) {
      beritahu('Hapus cadangan hanya untuk Administrator.', 'galat');
      return;
    }
    if (!hapusNama || hapusSibuk) return;
    setHapusSibuk(true);
    try {
      const r = await apiDelete<{ pesan: string }>(`/api/backup/${encodeURIComponent(hapusNama)}`);
      beritahu(r.pesan, 'sukses');
      setHapusNama(null);
      await muat();
    } catch (e) {
      beritahu(e instanceof Error ? e.message : 'Gagal menghapus cadangan.', 'galat');
    } finally {
      setHapusSibuk(false);
    }
  }

  if (!info) return <p className="teks-redup">Memuat info database…</p>;

  // Fallback tampilan sebelum status jadwal termuat: pakai nilai tab database.
  const modeInterval = ['4jam', '6jam', '12jam', 'kustom'].includes(jadwalMode);
  const jadwalLabel = !jadwal
    ? String(nilai.backup_otomatis ?? 'mati')
    : jadwal.mode === 'mati'
      ? 'Mati'
      : ['4jam', '6jam', '12jam'].includes(jadwal.mode)
        ? `Per ${Number.parseInt(jadwal.mode, 10)} jam`
        : jadwal.mode === 'kustom'
          ? `Setiap ${jadwal.interval_nilai} ${jadwal.interval_satuan}`
          : `${jadwal.mode === 'harian' ? 'Harian' : jadwal.mode === 'mingguan' ? 'Mingguan (Senin)' : 'Bulanan (tgl 1)'} pukul ${jadwal.jam}`;

  return (
    <>
      {maintenance && (
        <section className="kartu kartu--bahaya" role="alert">
          <div className="kartu__kepala kartu__kepala--kompak">
            <h3>Mode Maintenance Aktif</h3>
          </div>
          <p className="peringatan-dampak">Restore database sedang berjalan — akses tulis dikunci sementara. Tunggu hingga selesai.</p>
        </section>
      )}
      <section className="kartu">
        <div className="kartu__kepala kartu__kepala--kompak">
          <h3>Database Aktif</h3>
          <span className="aksi-baris">
            <button type="button" className="tombol tombol--kecil" disabled={!admin || backupSibuk || maintenance} onClick={() => void cadangkan()}>
              <Icon nama="plus" size={14} /> {backupSibuk ? 'Membuat…' : 'Buat Backup Baru'}
            </button>
            <button type="button" className="tombol tombol--kecil tombol--netral" disabled={!admin || unggahSibuk || maintenance} onClick={() => pemilihBerkas.current?.click()}>
              <Icon nama="upload" size={14} /> Upload File Restore
            </button>
            <IconButton label="Restore dari berkas…" ikon="upload" disabled={!admin} onClick={() => pemilihBerkas.current?.click()} />
            <IconButton label="Buat cadangan sekarang" ikon="download" disabled={!admin} onClick={() => void cadangkan()} />
          </span>
          <input ref={pemilihBerkas} type="file" accept=".sql,.sql.gz,.dump,.tar" hidden onChange={pilihBerkasRestore} />
        </div>
        {!admin && (
          <p className="peringatan-dampak">
            Buat backup, upload restore, unduh, dan hapus cadangan hanya dapat dijalankan oleh Administrator.
          </p>
        )}
        {(backupSibuk || unggahSibuk || restoreSibuk) && (
          <div className="backup-progress" role="progressbar" aria-label={backupSibuk ? 'Membuat cadangan…' : 'Memulihkan database…'}>
            <span />
          </div>
        )}
        <dl className="info-sistem">
          <div><dt>Berkas</dt><dd>{info.namaDatabase}</dd></div>
          <div><dt>Ukuran</dt><dd>{fmtUkuran(info.ukuranDb)}</dd></div>
          <div><dt>Perubahan terakhir</dt><dd>{info.waktuDatabase ? formatTanggalPanjang(info.waktuDatabase) : '—'}</dd></div>
          <div><dt>Migrasi diterapkan</dt><dd>{info.migrasi}</dd></div>
          <div><dt>Jadwal backup</dt><dd>{jadwalLabel}</dd></div>
          <div><dt>Disimpan</dt><dd>{daftar.filter((d) => d.status === 'sukses').length} berkas{jadwal ? ` / maks ${jadwal.jumlah}, retensi ${jadwal.retensi_hari} hari` : ''}</dd></div>
        </dl>
        {backupSibuk && <p className="teks-redup" aria-live="polite">Membuat cadangan… jangan tutup halaman ini.</p>}
      </section>

      <section className="kartu">
        <div className="kartu__kepala kartu__kepala--kompak">
          <h3>Backup Otomatis Terjadwal</h3>
          <span className="teks-redup">{jadwal?.terakhir_otomatis ? `Terakhir: ${formatTanggalPanjang(jadwal.terakhir_otomatis)}` : 'Belum pernah jalan'}</span>
        </div>
        {/* Baris 1 — saklar aktif di kiri, indikator jurnal di kanan. */}
        <div className="backup-jadwal__atas">
          <label className="backup-toggle">
            <input type="checkbox" checked={jadwalAktif} disabled={!admin || jadwalSibuk} onChange={(e) => setJadwalAktif(e.target.checked)} />
            <span>Aktifkan backup otomatis</span>
          </label>
          <span className={`lencana backup-jadwal__status ${jadwalAktif ? 'lencana--aktif' : 'lencana--mati'}`}>
            <span className="backup-jadwal__titik" aria-hidden="true" />
            Jurnal backup: {jadwalAktif ? 'Aktif' : 'Mati'}
          </span>
        </div>

        {/* Baris 2 — empat kontrol sejajar: frekuensi, waktu, jumlah, retensi. */}
        <div className="backup-jadwal__grid">
          <div className="bidang">
            <label htmlFor="jd-frekuensi">Frekuensi</label>
            <select id="jd-frekuensi" value={jadwalMode} disabled={!admin || !jadwalAktif || jadwalSibuk} onChange={(e) => setJadwalMode(e.target.value)}>
              <option value="4jam">Per 4 Jam</option>
              <option value="6jam">Per 6 Jam</option>
              <option value="12jam">Per 12 Jam</option>
              <option value="harian">Harian</option>
              <option value="mingguan">Mingguan (Senin)</option>
              <option value="bulanan">Bulanan (tanggal 1)</option>
              <option value="kustom">Kustom</option>
            </select>
          </div>
          <div className="bidang">
            <label htmlFor="jd-jam">Waktu Eksekusi</label>
            <select
              id="jd-jam"
              value={jadwalJam}
              disabled={!admin || !jadwalAktif || jadwalSibuk || modeInterval}
              title={modeInterval ? 'Tidak dipakai untuk frekuensi interval — jadwal mengikuti selang waktu.' : 'Jam eksekusi backup harian, mingguan, atau bulanan.'}
              onChange={(e) => setJadwalJam(e.target.value)}
            >
              {JAM_OPSI.map((j) => <option key={j} value={j}>{j}</option>) }
            </select>
          </div>
          <div className="bidang">
            <label htmlFor="jd-jumlah">Maksimal Berkas Disimpan</label>
            <input id="jd-jumlah" type="number" min={1} max={100} value={jadwalJumlah} disabled={!admin || jadwalSibuk} onChange={(e) => setJadwalJumlah(Number(e.target.value))} />
          </div>
          <div className="bidang">
            <label htmlFor="jd-retensi" title="Hapus otomatis backup lokal yang lebih tua dari jumlah hari ini.">Retensi Otomatis (Hari)</label>
            <input id="jd-retensi" type="number" min={1} max={365} value={jadwalRetensi} disabled={!admin || jadwalSibuk} onChange={(e) => setJadwalRetensi(Number(e.target.value))} />
          </div>
          {jadwalMode === 'kustom' && (
            <div className="bidang backup-jadwal__kustom">
              <label htmlFor="jd-interval-nilai">Interval Kustom</label>
              <div className="aksi-baris">
                <input
                  id="jd-interval-nilai"
                  type="number"
                  min={1}
                  max={jadwalIntervalSatuan === 'jam' ? 168 : 1440}
                  value={jadwalIntervalNilai}
                  disabled={!admin || !jadwalAktif || jadwalSibuk}
                  onChange={(e) => setJadwalIntervalNilai(Number(e.target.value))}
                  style={{ width: '6rem' }}
                />
                <select
                  aria-label="Satuan interval"
                  value={jadwalIntervalSatuan}
                  disabled={!admin || !jadwalAktif || jadwalSibuk}
                  onChange={(e) => setJadwalIntervalSatuan(e.target.value === 'menit' ? 'menit' : 'jam')}
                >
                  <option value="menit">Menit</option>
                  <option value="jam">Jam</option>
                </select>
                <span className="teks-redup teks-kecil">Dipakai bila Frekuensi = Kustom.</span>
              </div>
            </div>
          )}
        </div>

        {/* Baris 3 — aksi rata kanan, sejajar margin kontainer. */}
        <div className="backup-jadwal__kaki">
          <button type="button" className="tombol tombol--primer" disabled={!admin || jadwalSibuk} onClick={() => void simpanJadwal()}>
            {jadwalSibuk ? 'Menyimpan…' : 'Simpan Jadwal'}
          </button>
        </div>
      </section>

      <section className="kartu">
        <div className="kartu__kepala kartu__kepala--kompak">
          <h3>Pengaturan Database</h3>
        </div>
        <div className="db-rawat-info" role="note">
          <p className="db-rawat-judul"><span aria-hidden="true">💡</span> INFORMASI :</p>
          <ul>
            <li><strong>Vacuum Standard :</strong> Merampingkan ukuran database, dengan menghapus hasil proses perhitungan database yang tidak berguna, Sehingga akan dapat mempercepat kinerja database.</li>
            <li><strong>Vacuum Full :</strong> Sama seperti vacuum standard, pada vacuum full prosesnya lebih lama.</li>
            <li><strong>Re Index :</strong> Membuat Index ulang yaitu mengatur index data sehingga menunjang algoritma dari database agar lebih cepat dalam pencarian data.</li>
          </ul>
          <p>Lakukan proses ini ketika sudah tidak ada transaksi yang sedang berlangsung atau saat tutup toko.</p>
        </div>
        <div className="db-rawat-tombol">
          {TOMBOL_RAWAT.map((t) => (
            <button
              key={t.mode}
              type="button"
              className="tombol"
              disabled={rawatSibuk !== null}
              onClick={() => setRawatKonfirmasi({ mode: t.mode, label: t.label, ringkas: t.ringkas })}
            >
              <Icon nama="sliders" size={15} />
              {rawatSibuk === t.mode ? 'Memproses…' : t.label}
            </button>
          ))}
        </div>
      </section>

      {/* Konfirmasi pemeliharaan database — modal aplikasi, bukan alert browser. */}
      {rawatKonfirmasi && (
        <Modal
          judul={`Konfirmasi Pemeliharaan Database — ${rawatKonfirmasi.label}`}
          lebar="sedang"
          onTutup={() => {
            if (rawatSibuk === null) setRawatKonfirmasi(null);
          }}
          aksi={
            <>
              <button
                type="button"
                className="tombol tombol--netral"
                disabled={rawatSibuk !== null}
                onClick={() => setRawatKonfirmasi(null)}
              >
                Batal
              </button>
              <button
                type="button"
                className="tombol tombol--primer"
                disabled={rawatSibuk !== null}
                onClick={() => void jalankanRawat()}
              >
                {rawatSibuk !== null ? (
                  <>
                    <span className="db-rawat__putar" aria-hidden="true" />
                    Menjalankan…
                  </>
                ) : (
                  'Ya, Jalankan Proses'
                )}
              </button>
            </>
          }
        >
          <p>
            Proses ini akan {rawatKonfirmasi.ringkas}. Pastikan tidak ada transaksi kasir yang sedang berjalan.
            Lanjutkan?
          </p>
          {rawatSibuk !== null && (
            <p className="teks-redup teks-kecil" role="status">
              Sedang menjalankan {rawatKonfirmasi.label} — jangan tutup halaman ini. Proses dibatalkan otomatis bila melebihi
              2 menit.
            </p>
          )}
        </Modal>
      )}

      <section className="kartu">
        <div className="kartu__kepala kartu__kepala--kompak">
          <h3>Riwayat Backup</h3>
          <span className="teks-redup">Unduh, pulihkan, atau hapus.</span>
        </div>
        {daftar.length === 0 ? (
          <p className="teks-redup">Belum ada cadangan. Klik “Buat Backup Baru” untuk membuat cadangan pertama.</p>
        ) : (
          <table className="aturan-tabel">
            <thead>
              <tr><th>Nama File</th><th>Tanggal &amp; Waktu</th><th>Ukuran File</th><th>Tipe</th><th>Status</th><th>Aksi</th></tr>
            </thead>
            <tbody>
              {daftar.map((c) => (
                <tr key={c.nama}>
                  <td className="backup-nama">{c.nama}</td>
                  <td>{formatTanggalPanjang(c.waktu)}</td>
                  <td>{c.status === 'gagal' ? '—' : fmtUkuran(c.ukuran)}</td>
                  <td><span className={`lencana lencana--${c.tipe === 'otomatis' ? 'aktif' : c.tipe === 'pengaman' ? 'peringatan' : 'netral'}`}>{TIPE_LABEL[c.tipe]}</span></td>
                  <td>
                    {c.status === 'sukses' ? (
                      <span className="lencana lencana--aktif">Sukses</span>
                    ) : (
                      <span className="lencana lencana--bahaya" title={c.galat ?? 'Backup gagal'}>Gagal</span>
                    )}
                  </td>
                  <td>
                    {c.status === 'gagal' ? (
                      <span className="teks-redup" title={c.galat ?? ''}>—</span>
                    ) : !admin ? (
                      <span className="teks-redup" title="Hanya Administrator yang dapat mengunduh, memulihkan, atau menghapus cadangan">—</span>
                    ) : (
                      <span className="aksi-baris">
                        <a className="tombol tombol--kecil" href={`/api/backup/unduh?nama=${encodeURIComponent(c.nama)}`} title={`Unduh ${c.nama}`}>
                          Download
                        </a>
                        <IconButton label={`Restore dari ${c.nama}`} ikon="rotate-ccw" onClick={() => { setRestoreNama(c.nama); setKonfirmasi(''); }} />
                        {c.tipe === 'pengaman' ? (
                          <span className="teks-redup" title="Checkpoint pengaman tidak boleh dihapus">—</span>
                        ) : (
                          <IconButton label={`Hapus ${c.nama} dari server`} ikon="trash" onClick={() => setHapusNama(c.nama)} />
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {unggah && (
        <section className="kartu kartu--bahaya">
          <div className="kartu__kepala kartu__kepala--kompak">
            <h3>Konfirmasi Pemulihan Database (Restore) — “{unggah.name}”</h3>
          </div>
          <p className="peringatan-dampak">
            Proses ini akan menimpa seluruh data transaksi, master data, dan pengaturan aktif saat ini dengan
            data dari berkas restore. Sistem akan membuat checkpoint otomatis sebelum proses berjalan. Lanjutkan?
          </p>
          {unggahSibuk && (
            <>
              <div className="backup-progress" role="progressbar" aria-label="Memuat dan memulihkan data, mohon tunggu…">
                <span />
              </div>
              <p className="teks-redup" role="status">Memuat dan memulihkan data, mohon tunggu…</p>
            </>
          )}
          <div className="bidang">
            <label htmlFor="konf-restore-unggah">Ketik <strong>{KATA_RESTORE}</strong> untuk melanjutkan</label>
            <input id="konf-restore-unggah" value={konfirmasiUnggah} onChange={(e) => setKonfirmasiUnggah(e.target.value.toUpperCase())} autoComplete="off" disabled={unggahSibuk} placeholder={KATA_RESTORE} />
          </div>
          <div className="tombol-baris tombol-baris--kanan">
            <button type="button" className="tombol tombol--netral" disabled={unggahSibuk} onClick={() => { setUnggah(null); setKonfirmasiUnggah(''); }}>
              Batal
            </button>
            <button type="button" className="tombol tombol--bahaya" disabled={konfirmasiUnggah !== KATA_RESTORE || unggahSibuk} onClick={() => void kirimRestore(null, konfirmasiUnggah, unggah)}>
              {unggahSibuk ? 'Memulihkan…' : 'Ya, Restore Database'}
            </button>
          </div>
        </section>
      )}

      <PanelResetData />

      {restoreNama && (
        <Modal
          judul="Konfirmasi Pemulihan Database (Restore)"
          onTutup={() => { if (!restoreSibuk) { setRestoreNama(null); setKonfirmasi(''); } }}
          aksi={(
            <>
              <button type="button" className="tombol tombol--netral" disabled={restoreSibuk} onClick={() => { setRestoreNama(null); setKonfirmasi(''); }}>
                Batal
              </button>
              <button
                type="button"
                className="tombol tombol--bahaya"
                disabled={konfirmasi !== KATA_RESTORE || restoreSibuk}
                onClick={() => void kirimRestore(restoreNama, konfirmasi, null)}
              >
                {restoreSibuk ? 'Memulihkan…' : 'Ya, Restore Sekarang'}
              </button>
            </>
          )}
        >
          <p className="teks-redup teks-kecil">Berkas: <strong>{restoreNama}</strong></p>
          <p className="peringatan-dampak">
            Proses ini akan menimpa seluruh data transaksi, master data, dan pengaturan aktif saat ini dengan
            data dari berkas restore. Sistem akan membuat checkpoint otomatis sebelum proses berjalan. Lanjutkan?
          </p>
          {restoreSibuk && (
            <>
              <div className="backup-progress" role="progressbar" aria-label="Memuat dan memulihkan data, mohon tunggu…">
                <span />
              </div>
              <p className="teks-redup" role="status">Memuat dan memulihkan data, mohon tunggu…</p>
            </>
          )}
          <div className="bidang">
            <label htmlFor="konf-restore">Ketik <strong>{KATA_RESTORE}</strong> untuk melanjutkan (konfirmasi ganda)</label>
            <input id="konf-restore" value={konfirmasi} onChange={(e) => setKonfirmasi(e.target.value.toUpperCase())} autoComplete="off" disabled={restoreSibuk} placeholder={KATA_RESTORE} />
          </div>
        </Modal>
      )}

      {hapusNama && (
        <Modal
          judul={`Hapus “${hapusNama}”?`}
          onTutup={() => { if (!hapusSibuk) setHapusNama(null); }}
          aksi={(
            <>
              <button type="button" className="tombol tombol--netral" disabled={hapusSibuk} onClick={() => setHapusNama(null)}>
                Batal
              </button>
              <button type="button" className="tombol tombol--bahaya" disabled={hapusSibuk} onClick={() => void hapusCadangan()}>
                {hapusSibuk ? 'Menghapus…' : 'Ya, Hapus dari Server'}
              </button>
            </>
          )}
        >
          <p>Berkas cadangan akan dihapus permanen dari server. Pastikan sudah mengunduh salinannya bila masih dibutuhkan.</p>
        </Modal>
      )}

      <section className="kartu">
        <div className="kartu__kepala kartu__kepala--kompak">
          <h3>Tutup Tahun</h3>
        </div>
        <p className="teks-redup">
          Penutupan buku tahunan (menghapus riwayat transaksi &amp; membuat saldo awal) dijalankan dari
          modul Proses Tahunan.
        </p>
        <div className="tombol-baris">
          <Link to="/pengaturan/proses-tahunan" className="tombol tombol--netral">
            Buka Proses Tahunan
          </Link>
        </div>
      </section>
    </>
  );
}

/* =============== Keamanan & Sistem ▸ 19. Impor & Ekspor ================= */

interface ModulImpor {
  kode: string; label: string; kolom: { key: string; label: string }[];
  template: string; tersedia: boolean; ket: string | null;
}
interface BarisRiwayat {
  id: number; modul: string; nama_file: string; total_baris: number;
  baris_valid: number; baris_error: number; status: string; waktu: string; nama: string | null;
}

/** Contoh file impor tiap modul + riwayat impor. */
export function PanelImpor() {
  const [modul, setModul] = useState<ModulImpor[]>([]);
  const [riwayat, setRiwayat] = useState<BarisRiwayat[]>([]);

  const muat = useCallback(async () => {
    try {
      const [m, r] = await Promise.all([
        apiGet<{ data: ModulImpor[] }>('/api/pengaturan/impor/modul').catch(() => ({ data: [] as ModulImpor[] })),
        apiGet<{ data: BarisRiwayat[] }>('/api/pengaturan/impor/riwayat').catch(() => ({ data: [] as BarisRiwayat[] })),
      ]);
      setModul(m.data);
      setRiwayat(r.data);
    } catch {
      setModul([]);
      setRiwayat([]);
    }
  }, []);

  useEffect(() => {
    void muat();
  }, [muat]);
  // Tombol Refresh global di topbar: muat ulang data panel ini.
  useSegarkanModul(muat);

  return (
    <>
      <section className="kartu">
        <div className="kartu__kepala kartu__kepala--kompak">
          <h3>Contoh File Impor</h3>
          <span className="teks-redup">Kolom mengikuti skema terbaru.</span>
        </div>
        <table className="aturan-tabel">
          <thead>
            <tr><th>Modul</th><th>Kolom</th><th>Keterangan</th><th /></tr>
          </thead>
          <tbody>
            {modul.map((m) => (
              <tr key={m.kode}>
                <td>{m.label}</td>
                <td>{m.tersedia ? (m.kolom.length || '—') : '—'}</td>
                <td className="teks-redup">
                  {m.ket ?? (m.kolom.length ? `${m.kolom.slice(0, 4).map((k) => k.label).join(', ')}…` : '—')}
                </td>
                <td>
                  {m.tersedia ? (
                    <a className="tombol tombol--kecil" href={m.template}>Unduh contoh</a>
                  ) : (
                    <span className="teks-redup">Tidak tersedia</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="kartu">
        <div className="kartu__kepala kartu__kepala--kompak">
          <h3>Riwayat Impor</h3>
          <IconButton label="Muat ulang riwayat" ikon="rotate-ccw" onClick={() => void muat()} />
        </div>
        {riwayat.length === 0 ? (
          <p className="teks-redup">Belum ada impor yang dijalankan.</p>
        ) : (
          <table className="aturan-tabel">
            <thead>
              <tr><th>Waktu</th><th>Modul</th><th>Berkas</th><th>Baris</th><th>Sah</th><th>Error</th><th>Status</th><th>Oleh</th></tr>
            </thead>
            <tbody>
              {riwayat.map((b) => (
                <tr key={b.id}>
                  <td>{formatTanggalPanjang(b.waktu)}</td>
                  <td>{b.modul}</td>
                  <td>{b.nama_file}</td>
                  <td>{b.total_baris}</td>
                  <td>{b.baris_valid}</td>
                  <td>{b.baris_error}</td>
                  <td>{b.status}</td>
                  <td>{b.nama ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

/* ============== Keamanan & Sistem ▸ 20. Notifikasi & Pesan ============== */

/**
 * Notifikasi & Pesan: status koneksi WhatsApp/email dan pratinjau template.
 *
 * Kedua layanan luar belum tersambung, jadi tombol tes dinonaktifkan dan
 * petunjuk pengaturannya ditampilkan — bukan pesan galat.
 */
export function PanelNotifikasi({ nilai }: { nilai: Record<string, unknown> }) {
  const [tes, setTes] = useState<string | null>(null);

  const waAktif = nilai.wa_aktif === true && String(nilai.wa_nomor_pengirim ?? '') !== '';
  const smtpAktif =
    nilai.smtp_aktif === true &&
    String(nilai.smtp_host ?? '') !== '' &&
    String(nilai.smtp_pengguna ?? '') !== '';

  async function kirimTes(kanal: 'wa' | 'email') {
    try {
      const r = await apiPost<{ pesan: string }>('/api/pengaturan/notifikasi/tes', { kanal });
      setTes(r.pesan);
      beritahu(r.pesan, 'info');
    } catch (e) {
      const pesan = e instanceof Error ? e.message : 'Gagal mengirim tes.';
      setTes(pesan);
      beritahu(pesan, 'galat');
    }
  }

  const variabel = '{NAMA} {NOMOR} {TOTAL} {JATUH_TEMPO}';

  return (
    <>
      <section className="kartu">
        <div className="kartu__kepala kartu__kepala--kompak">
          <h3>Koneksi Kanal Kirim</h3>
        </div>
        <ul className="daftar-kanal">
          <li>
            <strong>WhatsApp</strong>
            <span className={`status-kanal ${waAktif ? 'status-kanal--nyala' : 'status-kanal--mati'}`}>
              {waAktif ? 'Aktif' : 'Belum tersambung'}
            </span>
            <p className="teks-redup">
              Pengiriman otomatis memerlukan akun WhatsApp Business API (Cloud API). Selama belum
              tersambung, kasir mengirim lewat tautan wa.me yang dibuka di WhatsApp perangkat.
            </p>
            <IconButton
              label="Tes kirim WhatsApp"
              ikon="whatsapp"
              disabled={!waAktif}
              alasan={waAktif ? undefined : 'aktifkan & isi nomor dulu'}
              onClick={() => void kirimTes('wa')}
            />
          </li>
          <li>
            <strong>Email (SMTP)</strong>
            <span className={`status-kanal ${smtpAktif ? 'status-kanal--nyala' : 'status-kanal--mati'}`}>
              {smtpAktif ? 'Aktif' : 'Belum tersambung'}
            </span>
            <p className="teks-redup">
              Isi host, port, pengguna, dan kata sandi aplikasi email Anda lalu aktifkan. Dipakai
              untuk mengirim faktur dan tautan reset password.
            </p>
            <IconButton
              label="Tes kirim email"
              ikon="send"
              disabled={!smtpAktif}
              alasan={smtpAktif ? undefined : 'lengkapi SMTP dulu'}
              onClick={() => void kirimTes('email')}
            />
          </li>
        </ul>
        {tes && <p className="teks-redup">{tes}</p>}
      </section>

      <section className="kartu">
        <div className="kartu__kepala kartu__kepala--kompak">
          <h3>Pratinjau Template</h3>
          <span className="teks-redup">Variabel: {variabel}</span>
        </div>
        <div className="form-grid">
          {[
            { k: 'template_faktur', l: 'Faktur' },
            { k: 'template_pengingat', l: 'Pengingat jatuh tempo' },
            { k: 'template_struk', l: 'Struk' },
          ].map((t) => (
            <div className="bidang" key={t.k}>
              <span>{t.l}</span>
              <div className="pratinjau-pesan">{String(nilai[t.k] ?? '')}</div>
            </div>
          ))}
        </div>
        <p className="teks-redup">
          Jadwal pengingat: piutang {String(nilai.pengingat_piutang_hari ?? 3)} hari dan hutang{' '}
          {String(nilai.pengingat_hutang_hari ?? 3)} hari sebelum jatuh tempo.
        </p>
      </section>
    </>
  );
}

/* ================= Keamanan & Sistem ▸ 22. Tentang ====================== */

/** Versi aplikasi, nama database, ringkasan jumlah data, pemeriksaan pembaruan. */
export function PanelTentang() {
  // Y2.4 — identitas aplikasi dari satu sumber data.
  const identitas = useIdentitas();
  const [info, setInfo] = useState<InfoSistem | null>(null);
  const [pembaruan, setPembaruan] = useState<{ versi: string; tersedia: boolean; pesan: string } | null>(null);
  const [sibuk, setSibuk] = useState(false);

  useEffect(() => {
    void apiGet<InfoSistem>('/api/pengaturan/sistem/info').then(setInfo).catch(() => setInfo(null));
  }, []);

  async function periksa() {
    setSibuk(true);
    try {
      setPembaruan(await apiGet<{ versi: string; tersedia: boolean; pesan: string }>('/api/pengaturan/sistem/pembaruan'));
    } catch (e) {
      beritahu(e instanceof Error ? e.message : 'Gagal memeriksa pembaruan.', 'galat');
    } finally {
      setSibuk(false);
    }
  }

  if (!info) return <p className="teks-redup">Memuat info sistem…</p>;

  return (
    <section className="kartu">
      <div className="kartu__kepala kartu__kepala--kompak">
        <h3>Tentang Sistem</h3>
        <IconButton label="Periksa Pembaruan" ikon="rotate-ccw" disabled={sibuk} alasan={sibuk ? 'memeriksa…' : undefined} onClick={() => void periksa()} />
      </div>
      <dl className="info-sistem">
        <div><dt>Aplikasi</dt><dd>{identitas.nama} — {identitas.tagline || 'POS · WMS · Akuntansi'}</dd></div>
        <div><dt>Versi</dt><dd>{info.versi}</dd></div>
        <div><dt>Nama database</dt><dd>{info.namaDatabase}</dd></div>
        <div><dt>Ukuran database</dt><dd>{fmtUkuran(info.ukuranDb)}</dd></div>
        <div><dt>Jumlah migrasi</dt><dd>{info.migrasi}</dd></div>
      </dl>

      <h4 className="teks-redup">Ringkasan jumlah data</h4>
      <div className="ringkasan-data">
        {info.ringkasan.map((r) => (
          <div key={r.nama}>
            <strong>{formatAngka(r.jumlah)}</strong>
            <span>{r.nama}</span>
          </div>
        ))}
      </div>

      {pembaruan && (
        <p className={`teks-redup ${pembaruan.tersedia ? 'pembaruan-tersedia' : ''}`}>{pembaruan.pesan}</p>
      )}
    </section>
  );
}

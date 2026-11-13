import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { IconButton } from '../../components/IconButton';
import { MenuAksi } from '../../components/MenuAksi';
import { TombolScan } from '../../components/ScanKamera';
import { Modal } from '../../components/crud/Modal';
import { beritahu } from '../../components/crud/Toast';
import { ambilOpsi, apiGet, apiPost, unduhExcel } from '../../lib/api';
import { useSegarkanModul } from '../../lib/segarkan';
import { formatAngka, formatTanggalWaktu } from '../../lib/format';
import { FooterDaftar } from '../../components/crud/FooterDaftar';
import { useBarisOtomatis } from '../../lib/barisOtomatis';
import { DialogImporOpname } from './DialogImporOpname';
import './opname.css';

type Baris = Record<string, any>;
type Opsi = { id: number; label: string };

const TAHAP: Record<string, { label: string; lencana: string }> = {
  hitung: { label: 'Menghitung', lencana: 'lencana--peringatan' },
  tinjau: { label: 'Tinjau Selisih', lencana: 'lencana--netral' },
  selesai: { label: 'Disahkan', lencana: 'lencana--aktif' },
  batal: { label: 'Dibatalkan', lencana: 'lencana--bahaya' },
};

/** Tahap tampilan dari status + kolom tahap. */
function tahapTampil(b: Baris): string {
  if (b.status === 'batal') return 'batal';
  if (b.status === 'disahkan') return 'selesai';
  return b.tahap === 'tinjau' ? 'tinjau' : 'hitung';
}

const METODE: Record<string, string> = { manual: 'Manual', scan: 'Scan', gabungan: 'Gabungan' };

/** O3 — tab status di atas tabel (nilai = parameter `tahap` di server). */
const TAB: { nilai: string; label: string }[] = [
  { nilai: '', label: 'Semua' },
  { nilai: 'draft', label: 'Draft' },
  { nilai: 'hitung', label: 'Sedang Dihitung' },
  { nilai: 'tinjau', label: 'Menunggu Persetujuan' },
  { nilai: 'selesai', label: 'Disahkan' },
];

export function HalamanOpname() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const [data, setData] = useState<Baris[]>([]);
  const [total, setTotal] = useState(0);
  const [tab, setTab] = useState<Record<string, number>>({});
  const [hal, setHal] = useState(1);
  const areaRef = useRef<HTMLDivElement>(null);
  // AJ — baris per halaman otomatis (Otomatis/20/50/100) + footer terpadu.
  const { per, mode: modeBaris, setMode: setModeBaris } = useBarisOtomatis({
    kunci: 'stok-opname',
    areaRef,
    total,
    hal,
    setHal,
  });
  const [cari, setCari] = useState('');
  const [cariTunda, setCariTunda] = useState('');
  const [tahapFilter, setTahapFilter] = useState('');
  const [gudang, setGudang] = useState('');
  const [sibuk, setSibuk] = useState(false);

  const [opsiGudang, setOpsiGudang] = useState<Opsi[]>([]);
  const [opsiLokasi, setOpsiLokasi] = useState<Opsi[]>([]);
  const [opsiPengguna, setOpsiPengguna] = useState<Opsi[]>([]);

  const [modeBuat, setModeBuat] = useState(false);
  const [sibukSimpan, setSibukSimpan] = useState(false);
  const [form, setForm] = useState({ gudang: '', lokasi: '', tanggal: '', penanggung: '', catatan: '' });

  // L1 — wizard Impor Excel (4 langkah) & unduh template Excel.
  const [modeImpor, setModeImpor] = useState(false);

  // O4 — pintasan: /stok/opname?gudang=X&baru=1 (dari halaman Stok).
  useEffect(() => {
    const g = sp.get('gudang');
    if (g) setForm((f) => ({ ...f, gudang: g }));
    if (sp.get('baru') === '1') setModeBuat(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setCariTunda(cari);
      setHal(1);
    }, 350);
    return () => window.clearTimeout(t);
  }, [cari]);

  useEffect(() => {
    ambilOpsi('gudang').then(setOpsiGudang).catch((e: Error) => beritahu(e.message, 'galat'));
    apiGet<{ data: { id: number; nama: string }[] }>('/api/opname/opsi-pengguna')
      .then((r) => setOpsiPengguna(r.data.map((u) => ({ id: u.id, label: u.nama }))))
      .catch(() => setOpsiPengguna([{ id: 1, label: 'Administrator' }]));
  }, []);

  // Opsi lokasi mengikuti gudang terpilih (lokasi bisa kosong = seluruh gudang)
  useEffect(() => {
    setOpsiLokasi([]);
    setForm((f) => ({ ...f, lokasi: '' }));
    if (!form.gudang) return;
    apiGet<{ data: { id: number; kode_lokasi: string }[] }>(`/api/master/lokasi?per=500&warehouse_id=${form.gudang}`)
      .then((r) => setOpsiLokasi(r.data.map((l) => ({ id: Number(l.id), label: l.kode_lokasi }))))
      .catch((e: Error) => beritahu(e.message, 'galat'));
  }, [form.gudang]);

  const muat = useCallback(async () => {
    setSibuk(true);
    try {
      const q = new URLSearchParams({ hal: String(hal), per: String(per), cari: cariTunda });
      if (tahapFilter) q.set('tahap', tahapFilter);
      if (gudang) q.set('gudang', gudang);
      const r = await apiGet<{ data: Baris[]; total: number; tab: Record<string, number> }>(`/api/opname?${q.toString()}`);
      setData(r.data);
      setTotal(r.total);
      setTab(r.tab ?? {});
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibuk(false);
    }
  }, [hal, per, cariTunda, tahapFilter, gudang]);

  useEffect(() => {
    void muat();
  }, [muat]);
  // Tombol Refresh global di topbar: muat ulang daftar opname.
  useSegarkanModul(muat);

  const totalHal = Math.max(1, Math.ceil(total / per));

  const buatSesi = async () => {
    if (!form.gudang) {
      beritahu('Pilih gudang terlebih dahulu.', 'galat');
      return;
    }
    setSibukSimpan(true);
    try {
      const r = await apiPost<{ id: number }>('/api/opname', {
        warehouse_id: Number(form.gudang),
        location_id: form.lokasi ? Number(form.lokasi) : null,
        tanggal: form.tanggal || undefined,
        penanggung_jawab_id: form.penanggung ? Number(form.penanggung) : undefined,
        catatan: form.catatan || undefined,
      });
      beritahu('Sesi opname dibuat — stok sistem dibekukan sebagai snapshot.');
      setModeBuat(false);
      navigate(`/stok/opname/${r.id}`);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibukSimpan(false);
    }
  };

  /** Target konfirmasi hapus draft (modal kustom pengganti window.confirm). */
  const [hapusTarget, setHapusTarget] = useState<Baris | null>(null);
  const [hapusSibuk, setHapusSibuk] = useState(false);

  /** Hapus draft = batalkan sesi (stok tidak berubah — sesi belum disahkan). */
  const jalankanHapusDraft = async () => {
    const b = hapusTarget;
    if (!b || hapusSibuk) return;
    setHapusSibuk(true);
    try {
      await apiPost(`/api/opname/${b.id}/batal`, {});
      beritahu(`Sesi ${b.no_dokumen} dibatalkan.`, 'sukses');
      setHapusTarget(null);
      void muat();
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    } finally {
      setHapusSibuk(false);
    }
  };

  /** L1 — template Excel: berisi stok terkini bila filter gudang aktif, else kosong. */
  const unduhTemplate = () => {
    if (gudang) {
      void unduhExcel(`/api/opname/template?isi=stok&gudang=${gudang}`, 'template-opname-stok-terkini.xlsx').catch(
        (e: Error) => beritahu(e.message, 'galat'),
      );
    } else {
      void unduhExcel('/api/opname/template?isi=kosong', 'template-opname-kosong.xlsx').catch((e: Error) =>
        beritahu(e.message, 'galat'),
      );
    }
  };

  return (
    <div className="halaman halaman--fit">
      <section className="kartu kartu--daftar">
        <div className="kartu__kepala kartu__kepala--kompak">
          <div>
            <h3>Opname</h3>
            <p className="teks-redup teks-kecil">
              Penghitungan stok fisik per gudang/lokasi: snapshot stok sistem dibekukan saat sesi dimulai, lalu disesuaikan lewat kartu stok &amp; jurnal setelah disahkan sesuai izin peran.
            </p>
          </div>
          <span className="kartu__jumlah">{total} sesi</span>
          <div className="tombol-baris">
            <MenuAksi
              label="Aksi opname"
              items={[
                { label: 'Impor Excel', jalan: () => setModeImpor(true) },
                { label: 'Unduh Template', jalan: () => unduhTemplate() },
              ]}
            />
            <button type="button" className="tombol tombol--primer" onClick={() => setModeBuat(true)}>
              + Sesi Opname Baru
            </button>
          </div>
        </div>

        {/* O3 — tab status di atas tabel, lengkap dengan jumlah per tab */}
        <div className="opname-tab" role="tablist" aria-label="Status sesi opname">
          {TAB.map((t) => (
            <button
              key={t.nilai}
              type="button"
              role="tab"
              aria-selected={tahapFilter === t.nilai}
              className={`opname-tab__tombol ${tahapFilter === t.nilai ? 'opname-tab__tombol--aktif' : ''}`}
              onClick={() => {
                setTahapFilter(t.nilai);
                setHal(1);
              }}
            >
              {t.label}
              <span className="opname-tab__jumlah">{tab[t.nilai || 'semua'] ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="alat-tabel toolbar-kompak">
          <div className="cari-scan">
          <input
            className="input-cari"
            type="search"
            placeholder="Cari no. dokumen opname…"
            value={cari}
            onChange={(e) => {
              setCari(e.target.value);
              setHal(1);
            }}
          />
          <TombolScan onHasil={(t) => { setCari(t); setHal(1); }} />
          </div>
          <span className="filter-inline">
          <select className="input-pilih" value={gudang} onChange={(e) => { setGudang(e.target.value); setHal(1); }} aria-label="Filter gudang">
            <option value="">Semua gudang</option>
            {opsiGudang.map((o) => (<option key={o.id} value={o.id}>{o.label}</option>))}
          </select>
          </span>
        </div>

        <div ref={areaRef} className="tabel-bungkus sembunyi-hp">
          <table className="tabel">
            <thead>
              <tr>
                <th>No. dokumen</th>
                <th>Tanggal</th>
                <th>Gudang / Lokasi</th>
                <th>Penanggung jawab</th>
                <th className="rata-tengah">Metode</th>
                <th className="rata-kanan">Dihitung</th>
                <th className="rata-tengah">Status</th>
                <th className="rata-tengah">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {sibuk && data.length === 0 ? (
                <tr><td colSpan={8} className="tabel-kosong">Memuat…</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={8} className="tabel-kosong">Belum ada sesi opname{cariTunda ? ` untuk \"${cariTunda}\"` : ''}.</td></tr>
              ) : (
                data.map((b) => {
                  const tahap = tahapTampil(b);
                  const info = TAHAP[tahap] ?? { label: tahap, lencana: 'lencana--netral' };
                  return (
                    <tr key={b.id}>
                      <td><code>{b.no_dokumen}</code></td>
                      <td className="whitespace-nowrap teks-kecil">{formatTanggalWaktu(b.tanggal)}</td>
                      <td className="whitespace-nowrap">
                        <strong>{b.gudang_kode}</strong>
                        <div className="teks-redup teks-kecil">{b.lokasi_kode ? `Lokasi ${b.lokasi_kode}` : 'Seluruh gudang'}</div>
                      </td>
                      <td>{b.penanggung_jawab ?? '—'}</td>
                      <td className="rata-tengah teks-kecil">{METODE[b.metode] ?? b.metode}</td>
                      <td className="rata-kanan nowrap">
                        {formatAngka(Number(b.jumlah_dihitung))} / {formatAngka(Number(b.jumlah_item))}
                        {Number(b.scan_tak_dikenal) > 0 && (
                          <div className="teks-kecil" style={{ color: 'var(--danger)' }}>{formatAngka(Number(b.scan_tak_dikenal))} barcode tak dikenal</div>
                        )}
                      </td>
                      <td className="rata-tengah">
                        <span className={`lencana ${info.lencana}`}>{info.label}</span>
                        {tahap === 'hitung' && Number(b.jumlah_selisih) > 0 && (
                          <div className="teks-redup teks-kecil">{formatAngka(Number(b.jumlah_selisih))} selisih</div>
                        )}
                      </td>
                      <td className="rata-tengah">
                        <span className="aksi-baris">
                          <IconButton
                            ikon="eye"
                            label={tahap === 'hitung' ? 'Lanjut Hitung' : tahap === 'tinjau' ? 'Tinjau' : 'Lihat'}
                            ukuran="baris"
                            onClick={() => navigate(`/stok/opname/${b.id}`)}
                          />
                          {(tahap === 'hitung' || tahap === 'tinjau') && (
                            <IconButton
                              ikon="chevron-right"
                              label="Lanjutkan"
                              ukuran="baris"
                              onClick={() => navigate(`/stok/opname/${b.id}`)}
                            />
                          )}
                          <IconButton
                            ikon="printer"
                            label="Cetak Berita Acara"
                            ukuran="baris"
                            onClick={() => navigate(`/stok/opname/${b.id}?cetak=acara`)}
                          />
                          {tahap === 'hitung' && (
                            <IconButton
                              ikon="trash"
                              label="Hapus draft"
                              ukuran="baris"
                              onClick={() => setHapusTarget(b)}
                            />
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* MOBILE OTOMATIS — sesi opname jadi kartu (<=767px). */}
        <div className="hp-daftar">
          {sibuk && data.length === 0 ? (
            <div className="hp-kartu"><div className="hp-kartu__sub">Memuat…</div></div>
          ) : data.length === 0 ? (
            <div className="hp-kartu"><div className="hp-kartu__sub">Belum ada sesi opname{cariTunda ? ` untuk "${cariTunda}"` : ''}.</div></div>
          ) : (
            data.map((b) => {
              const tahapHp = tahapTampil(b);
              const infoHp = TAHAP[tahapHp] ?? { label: tahapHp, lencana: 'lencana--netral' };
              return (
                <article className="hp-kartu" key={`hp-opn-${b.id}`}>
                  <div className="hp-kartu__atas">
                    <span className="hp-kartu__kode">{b.no_dokumen}</span>
                    <span className="hp-kartu__kanan">{formatTanggalWaktu(b.tanggal)}</span>
                  </div>
                  <div className="hp-kartu__nama">{formatAngka(Number(b.jumlah_dihitung))} / {formatAngka(Number(b.jumlah_item))} dihitung</div>
                  <div className="hp-kartu__sub">{b.gudang_kode} · {b.lokasi_kode ? `Lokasi ${b.lokasi_kode}` : 'Seluruh gudang'} · {b.penanggung_jawab ?? '—'} · {METODE[b.metode] ?? b.metode} · <span className={`lencana ${infoHp.lencana}`}>{infoHp.label}</span></div>
                  <div className="hp-grid">
                    <div className="hp-sel"><div className="hp-label">Selisih</div><div className="hp-nilai">{tahapHp === 'hitung' && Number(b.jumlah_selisih) > 0 ? `${formatAngka(Number(b.jumlah_selisih))} selisih` : '—'}</div></div>
                    <div className="hp-sel"><div className="hp-label">Scan tak dikenal</div><div className="hp-nilai">{Number(b.scan_tak_dikenal) > 0 ? formatAngka(Number(b.scan_tak_dikenal)) : '—'}</div></div>
                  </div>
                  <div className="hp-aksi">
                    <button type="button" className="tombol tombol--kecil" onClick={() => navigate(`/stok/opname/${b.id}`)}>{tahapHp === 'hitung' ? 'Lanjut Hitung' : tahapHp === 'tinjau' ? 'Tinjau' : 'Lihat'}</button>
                    <button type="button" className="tombol tombol--kecil tombol--netral" onClick={() => navigate(`/stok/opname/${b.id}?cetak=acara`)}>Cetak</button>
                    {tahapHp === 'hitung' && (
                      <button type="button" className="tombol tombol--kecil tombol--bahaya" onClick={() => setHapusTarget(b)}>Hapus</button>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </div>

        <FooterDaftar mode={modeBaris} onMode={setModeBaris} hal={hal} totalHal={totalHal} total={total} onHal={setHal} />
      </section>

      {hapusTarget && (
        <Modal
          lebar="kecil"
          judul="Hapus Draft Opname"
          onTutup={() => { if (!hapusSibuk) setHapusTarget(null); }}
          sedangKirim={hapusSibuk}
          aksi={
            <div className="tombol-baris">
              <button
                type="button"
                className="tombol tombol--netral"
                onClick={() => setHapusTarget(null)}
                disabled={hapusSibuk}
                data-fokus-awal
              >
                Batal
              </button>
              <button
                type="button"
                className="tombol tombol--bahaya"
                onClick={() => void jalankanHapusDraft()}
                disabled={hapusSibuk}
              >
                {hapusSibuk ? 'Menghapus…' : 'Ya, Hapus Draft'}
              </button>
            </div>
          }
        >
          <p className="teks-redup">
            Apakah Anda yakin ingin menghapus (membatalkan) sesi draft{' '}
            <strong>{hapusTarget.no_dokumen}</strong>? Stok tidak akan berubah karena sesi ini belum disahkan.
          </p>
        </Modal>
      )}

      {modeBuat && (
        <Modal
          lebar="sedang"
          judul="Sesi Opname Baru"
          onTutup={() => setModeBuat(false)}
          sedangKirim={sibukSimpan}
          aksi={
            <div className="tombol-baris">
              <button type="button" className="tombol tombol--netral" onClick={() => setModeBuat(false)} disabled={sibukSimpan}>Batal</button>
              <button type="button" className="tombol" onClick={() => void buatSesi()} disabled={sibukSimpan}>
                {sibukSimpan ? 'Membuat…' : 'Buat & Mulai Hitung'}
              </button>
            </div>
          }
        >
          <p className="teks-redup teks-kecil">
            Saat sesi dibuat, seluruh stok sistem pada gudang/lokasi difoto (snapshot) sebagai dasar selisih. Stok tidak bergerak sampai sesi disahkan.
          </p>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <label className="bidang">
              <span>Gudang *</span>
              <select value={form.gudang} onChange={(e) => setForm({ ...form, gudang: e.target.value })}>
                <option value="">— Pilih —</option>
                {opsiGudang.map((o) => (<option key={o.id} value={o.id}>{o.label}</option>))}
              </select>
            </label>
            <label className="bidang">
              <span>Lokasi / rak (opsional — kosong = seluruh gudang)</span>
              <select value={form.lokasi} onChange={(e) => setForm({ ...form, lokasi: e.target.value })} disabled={!form.gudang}>
                <option value="">Seluruh gudang</option>
                {opsiLokasi.map((o) => (<option key={o.id} value={o.id}>{o.label}</option>))}
              </select>
            </label>
            <label className="bidang">
              <span>Tanggal opname</span>
              <input type="date" value={form.tanggal} onChange={(e) => setForm({ ...form, tanggal: e.target.value })} />
            </label>
            <label className="bidang">
              <span>Penanggung jawab</span>
              <select value={form.penanggung} onChange={(e) => setForm({ ...form, penanggung: e.target.value })}>
                <option value="">Administrator (bawaan)</option>
                {opsiPengguna.map((o) => (<option key={o.id} value={o.id}>{o.label}</option>))}
              </select>
            </label>
            <label className="bidang bidang--lebar">
              <span>Catatan (opsional)</span>
              <input type="text" value={form.catatan} onChange={(e) => setForm({ ...form, catatan: e.target.value })} placeholder="mis. Opname akhir bulan gudang pusat" maxLength={1000} />
            </label>
          </div>
        </Modal>
      )}

      {modeImpor && (
        <DialogImporOpname
          tutup={() => {
            setModeImpor(false);
            void muat();
          }}
          selesai={() => void muat()}
        />
      )}
    </div>
  );
}

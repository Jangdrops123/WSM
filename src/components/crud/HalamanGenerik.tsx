import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { apiDelete, apiGet, apiPost, apiPut, imporExcel, unduhExcel, unduhLaporanError, urungkanImpor, type ImportResult, type ResponsDaftar } from '../../lib/api';
import { beritahu } from './Toast';
// Kelas tabel error & alat laporan impor (AB1/AB3) — dipakai modal hasil impor.
import '../../pages/master/impor-ekspor.css';
import { Modal } from './Modal';
import {
  DialogHasilMassal,
  DialogHapusMassal,
  ProgresMassal,
  type AksiMassalItem,
  type HasilMassalState,
} from './AksiMassal';
import { DataTable } from './DataTable';
import { useSegarkanModul } from '../../lib/segarkan';
import { usePilihan } from '../../lib/pilihan';
import { ambilSemuaId, jalankanBertahap, type BarisDilewati } from '../../lib/massal';
import { IconButton } from '../IconButton';
import { MenuAksi } from '../MenuAksi';
import { TombolScan } from '../ScanKamera';
import { PageLayout } from '../PageLayout';
import { FooterDaftar } from './FooterDaftar';
import { useBarisOtomatis } from '../../lib/barisOtomatis';

type RespSetAktifGen = { berhasil: number; sebelum: { baris?: { id: number; aktif: number }[] }; infoAkses?: string };
type RespHapusGen = { berhasil: number; dilewati: BarisDilewati[]; saran?: string; infoAkses?: string };
type RespSimpanGen = { infoAkses?: string };

export type Baris = Record<string, any>;

export interface OpsiSelect {
  id: number;
  label: string;
}

export interface KolomTabel {
  key: string;
  label: string;
  rata?: 'kanan' | 'tengah';
  render?: (baris: Baris) => ReactNode;
}

export interface BidangForm {
  key: string;
  label: string;
  tipe: 'teks' | 'teks_panjang' | 'angka' | 'bool' | 'ref';
  wajib?: boolean;
  min?: number;
  contoh?: string;
  opsi?: OpsiSelect[];
  /** URL opsi dinamis (mengembalikan { data: [{ id, label }] }) — mis. profil size. */
  opsiUrl?: string;
  /** Label opsi kosong (default "— pilih —"). */
  labelKosong?: string;
}

export interface FilterOpsi {
  key: string;
  label: string;
  opsi: OpsiSelect[];
}

interface Props {
  entitas: string;
  judul: string;
  deskripsi?: string;
  kolom: KolomTabel[];
  form: BidangForm[];
  cariContoh?: string;
  urutBawaan?: string;
  filter?: FilterOpsi;
  /** Dipanggil setelah data berhasil disimpan/dihapus (mis. menyegarkan dropdown lain). */
  onBerubah?: () => void;
  /** Label baris untuk dialog konfirmasi hapus. */
  labelBaris?: (b: Baris) => string;
  /** Teks tombol Tambah (default: "Tambah {judul}"). */
  labelTambah?: string;
  /** AG6 — aksi massal khusus: set satu field ref (mis. "Atur profil size" pada Kategori). */
  massalUbah?: { key: string; label: string; opsiUrl: string; labelKosong: string };
}

function nilaiAwal(form: BidangForm[], baris: Baris | null): Baris {
  const out: Baris = {};
  for (const f of form) {
    out[f.key] = baris ? (baris[f.key] ?? '') : f.tipe === 'bool' ? 1 : '';
  }
  return out;
}

/** Halaman CRUD generik untuk entitas sederhana Master Data. */
export function HalamanGenerik({
  entitas,
  judul,
  deskripsi,
  kolom,
  form,
  cariContoh = 'Cari…',
  urutBawaan,
  filter,
  onBerubah,
  labelBaris,
  labelTambah,
  massalUbah,
}: Props) {
  const [data, setData] = useState<Baris[]>([]);
  const [total, setTotal] = useState(0);
  const [hal, setHal] = useState(1);
  const seqMuat = useRef(0);
  const [cari, setCari] = useState('');
  const [cariTunda, setCariTunda] = useState('');
  const [urut, setUrut] = useState(urutBawaan ?? '');
  const [arah, setArah] = useState<'ASC' | 'DESC'>('ASC');
  const [nilaiFilter, setNilaiFilter] = useState('');
  const [sibuk, setSibuk] = useState(false);

  // BAGIAN AJ — jumlah baris Otomatis/20/50/100 (disimpan per pengguna & halaman).
  const areaRef = useRef<HTMLDivElement>(null);
  const { per, mode: modeBaris, setMode: setModeBaris } = useBarisOtomatis({
    kunci: entitas,
    areaRef,
    total,
    hal,
    setHal,
  });

  const [formBuka, setFormBuka] = useState(false);
  const [sedangEdit, setSedangEdit] = useState<Baris | null>(null);
  const [isi, setIsi] = useState<Baris>({});
  const [kirim, setKirim] = useState(false);
  const [hapusTarget, setHapusTarget] = useState<Baris | null>(null);
  const [hasilImpor, setHasilImpor] = useState<ImportResult | null>(null);
  const [diurungkanImpor, setDiurungkanImpor] = useState(false);
  const fileImpor = useRef<HTMLInputElement>(null);

  /** AG6 — dialog "Atur {label}" massal (field ref, mis. Profil size). */
  const [bukaSetMassal, setBukaSetMassal] = useState(false);
  const [opsiSetMassal, setOpsiSetMassal] = useState<OpsiSelect[]>([]);
  const [nilaiSetMassal, setNilaiSetMassal] = useState('');

  // --- Pilih & aksi massal -------------------------------------------------
  // `entitas` ikut menjadi kunci reset: pindah tab (kategori→merek dkk.) tidak
  // boleh mewarisi pilihan tab sebelumnya (satu instance komponen dipakai ulang).
  const pilihan = usePilihan([entitas, cariTunda, nilaiFilter]);
  // Opsi dinamis untuk bidang ref (mis. Profil size pada Kategori — AF2).
  const [opsiDinamis, setOpsiDinamis] = useState<Record<string, OpsiSelect[]>>({});
  const [sedangMassal, setSedangMassal] = useState(false);
  const [progresMassal, setProgresMassal] = useState<number | null>(null);
  const [hasilMassal, setHasilMassal] = useState<HasilMassalState | null>(null);
  const [bukaHapusMassal, setBukaHapusMassal] = useState(false);
  const [namaHapus, setNamaHapus] = useState<string[] | null>(null);
  const [memuatNamaHapus, setMemuatNamaHapus] = useState(false);

  // Debounce pencarian
  useEffect(() => {
    const t = window.setTimeout(() => {
      setCariTunda(cari);
      setHal(1);
    }, 350);
    return () => window.clearTimeout(t);
  }, [cari]);

  const muat = useCallback(async () => {
    const seq = ++seqMuat.current;
    setSibuk(true);
    try {
      const q = new URLSearchParams({ hal: String(hal), per: String(per), cari: cariTunda });
      if (urut) {
        q.set('urut', urut);
        q.set('arah', arah);
      }
      if (filter && nilaiFilter) q.set(filter.key, nilaiFilter);
      const r = await apiGet<ResponsDaftar<Baris>>(`/api/master/${entitas}?${q.toString()}`);
      if (seq !== seqMuat.current) return; // respons usang (per/hal berubah)
      setData(r.data);
      setTotal(r.total);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      if (seq === seqMuat.current) setSibuk(false);
    }
  }, [entitas, hal, per, cariTunda, urut, arah, filter, nilaiFilter]);

  useEffect(() => {
    void muat();
  }, [muat]);
  // Tombol Refresh global di topbar: muat ulang daftar (semua Master generik memakai komponen ini).
  useSegarkanModul(muat);

  const totalHal = Math.max(1, Math.ceil(total / per));

  // Muat opsi dinamis saat form dibuka (sekali per key).
  useEffect(() => {
    if (!formBuka) return;
    for (const f of form) {
      if (!f.opsiUrl || opsiDinamis[f.key]) continue;
      apiGet<{ data: OpsiSelect[] }>(f.opsiUrl)
        .then((r) => setOpsiDinamis((m) => ({ ...m, [f.key]: r.data ?? [] })))
        .catch(() => setOpsiDinamis((m) => ({ ...m, [f.key]: [] })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formBuka, form]);

  // --- Aksi massal ---------------------------------------------------------
  const idsHalaman = data.map((b) => Number(b.id));
  const adaAktif = data.length > 0 && data[0].aktif !== undefined;

  const pilihSemuaFilter = () => {
    muatSemuaId()
      .then((ids) => pilihan.pilihFilter(ids))
      .catch((e: Error) => beritahu(e.message, 'galat'));
  };

  const muatSemuaId = () =>
    ambilSemuaId(
      (hal_, per_) => {
        const q = new URLSearchParams({ hal: String(hal_), per: String(per_), cari: cariTunda });
        if (urut) {
          q.set('urut', urut);
          q.set('arah', arah);
        }
        if (filter && nilaiFilter) q.set(filter.key, nilaiFilter);
        return q;
      },
      (q) => apiGet<ResponsDaftar<Baris>>(`/api/master/${entitas}?${q.toString()}`),
    );

  /** Aktifkan / Nonaktifkan massal (batch 100) dengan urungkan 10 detik. */
  const setAktifMassal = async (nilai: 0 | 1) => {
    const ids = [...pilihan.terpilih];
    if (!ids.length) return;
    setSedangMassal(true);
    setProgresMassal(0);
    try {
      const hasil = await jalankanBertahap(
        ids,
        (potongan) => apiPost<RespSetAktifGen>(`/api/master/${entitas}/massal/set-aktif`, { ids: potongan, aktif: nilai }),
        (s, t) => setProgresMassal(Math.round((s / t) * 100)),
      );
      const sebelum = hasil.flatMap((h) => h.sebelum?.baris ?? []);
      const berhasil = hasil.reduce((a, h) => a + h.berhasil, 0);
      // AS3 — beri tahu Owner bila penonaktifan melepas akses pengguna.
      const infoAksesMassal = hasil.map((h) => h.infoAkses).filter(Boolean).join(' ');
      setHasilMassal({
        judul: nilai === 1 ? `Aktifkan ${judul}` : `Nonaktifkan ${judul}`,
        berhasil,
        dilewati: [],
        onUrungkan: sebelum.length
          ? async () => {
              await apiPost(`/api/master/${entitas}/massal/urungkan`, { baris: sebelum });
              beritahu('Perubahan status diurungkan.');
              setHasilMassal(null);
              await muat();
              onBerubah?.();
            }
          : undefined,
      });
      pilihan.bersihkan();
      await muat();
      onBerubah?.();
      if (infoAksesMassal) beritahu(infoAksesMassal, 'info', 8000);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSedangMassal(false);
      setProgresMassal(null);
    }
  };

  /** Buka dialog "Atur {label}" massal — muat opsi referensinya dulu. */
  const bukaSetMassalDialog = async () => {
    if (!massalUbah) return;
    setNilaiSetMassal('');
    setOpsiSetMassal([]);
    setBukaSetMassal(true);
    try {
      const r = await apiGet<{ data: OpsiSelect[] }>(massalUbah.opsiUrl);
      setOpsiSetMassal(r.data ?? []);
    } catch {
      setOpsiSetMassal([]);
    }
  };

  const konfirmasiSetMassal = async () => {
    if (!massalUbah) return;
    const ids = [...pilihan.terpilih];
    if (!ids.length) return;
    const nilai = nilaiSetMassal === '' ? null : Number(nilaiSetMassal);
    setSedangMassal(true);
    setProgresMassal(0);
    try {
      await jalankanBertahap(
        ids,
        async (potongan) => {
          await Promise.all(
            potongan.map((id) => apiPut(`/api/master/${entitas}/${id}`, { [massalUbah.key]: nilai })),
          );
          return { berhasil: potongan.length };
        },
        (s, t) => setProgresMassal(Math.round((s / t) * 100)),
      );
      setBukaSetMassal(false);
      beritahu(`${massalUbah.label} diatur untuk ${ids.length} baris.`);
      pilihan.bersihkan();
      await muat();
      onBerubah?.();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSedangMassal(false);
      setProgresMassal(null);
    }
  };

  /** Buka dialog hapus massal — ambil 5 nama pertama untuk konfirmasi. */
  const bukaHapus = async () => {
    setBukaHapusMassal(true);
    setMemuatNamaHapus(true);
    setNamaHapus(null);
    try {
      const ids = [...pilihan.terpilih].slice(0, 5);
      const daftar = await Promise.all(
        ids.map((id) =>
          apiGet<{ data: Baris }>(`/api/master/${entitas}/${id}`)
            .then((r) => labelBarisDipakai(r.data))
            .catch(() => '(data tidak ditemukan)'),
        ),
      );
      setNamaHapus(daftar);
    } finally {
      setMemuatNamaHapus(false);
    }
  };

  const konfirmasiHapusMassal = async () => {
    const ids = [...pilihan.terpilih];
    setSedangMassal(true);
    setProgresMassal(0);
    try {
      const hasil = await jalankanBertahap(
        ids,
        (potongan) => apiPost<RespHapusGen>(`/api/master/${entitas}/massal/hapus`, { ids: potongan }),
        (s, t) => setProgresMassal(Math.round((s / t) * 100)),
      );
      const berhasil = hasil.reduce((a, h) => a + h.berhasil, 0);
      const dilewati = hasil.flatMap((h) => h.dilewati ?? []);
      const saran = hasil.find((h) => h.saran)?.saran;
      setBukaHapusMassal(false);
      setNamaHapus(null);
      setHasilMassal({ judul: `Hasil Hapus ${judul}`, berhasil, dilewati, saran });
      pilihan.bersihkan();
      await muat();
      onBerubah?.();
      const infoHapus = hasil.map((h) => h.infoAkses).filter(Boolean).join(' ');
      if (infoHapus) beritahu(infoHapus, 'info', 8000);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSedangMassal(false);
      setProgresMassal(null);
    }
  };

  const eksporTerpilih = async () => {
    try {
      const ids = [...pilihan.terpilih].join(',');
      await unduhExcel(`/api/master/${entitas}/ekspor?ids=${ids}`, `${entitas}-terpilih-${new Date().toISOString().slice(0, 10)}.xlsx`);
      beritahu('Berkas Excel (yang dipilih) diunduh.');
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    }
  };

  const aksiBar: AksiMassalItem[] = [
    ...(adaAktif
      ? [
          { kode: 'nonaktif', label: 'Nonaktifkan', jalan: () => void setAktifMassal(0) },
          { kode: 'aktif', label: 'Aktifkan', jalan: () => void setAktifMassal(1) },
        ]
      : []),
    ...(massalUbah
      ? [{ kode: 'set', label: `Atur ${massalUbah.label}`, jalan: () => void bukaSetMassalDialog() }]
      : []),
    { kode: 'ekspor', label: 'Ekspor Excel', jalan: () => void eksporTerpilih() },
    { kode: 'hapus', label: 'Hapus', bahaya: true, jalan: () => void bukaHapus() },
  ];

  const buatBaru = () => {
    setSedangEdit(null);
    setIsi(nilaiAwal(form, null));
    setFormBuka(true);
  };

  const ubah = (b: Baris) => {
    setSedangEdit(b);
    setIsi(nilaiAwal(form, b));
    setFormBuka(true);
  };

  const simpan = async () => {
    for (const f of form) {
      if (f.wajib && f.tipe !== 'bool' && !String(isi[f.key] ?? '').trim()) {
        beritahu(`${labelBaris?.(isi) ?? 'Form'}: ${f.label} wajib diisi.`, 'galat');
        return;
      }
    }
    setKirim(true);
    try {
      const body: Baris = {};
      for (const f of form) {
        if (f.tipe === 'angka') body[f.key] = isi[f.key] === '' || isi[f.key] === null ? null : Number(isi[f.key]);
        else if (f.tipe === 'ref') body[f.key] = isi[f.key] === '' || isi[f.key] === null ? null : Number(isi[f.key]);
        else if (f.tipe === 'bool') body[f.key] = Number(isi[f.key]);
        else body[f.key] = isi[f.key];
      }
      // AS3 — simpan gudang bisa melepas akses pengguna; tampilkan pemberitahuan Owner.
      const simpanResp = sedangEdit
        ? await apiPut<RespSimpanGen>(`/api/master/${entitas}/${sedangEdit.id}`, body)
        : await apiPost<RespSimpanGen>(`/api/master/${entitas}`, body);
      beritahu(sedangEdit ? `${judul} diperbarui.` : `${judul} ditambahkan.`);
      if (simpanResp?.infoAkses) beritahu(simpanResp.infoAkses, 'info', 8000);
      setFormBuka(false);
      await muat();
      onBerubah?.();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setKirim(false);
    }
  };

  const konfirmasiHapus = async () => {
    if (!hapusTarget) return;
    try {
      const hapusResp = await apiDelete<RespSimpanGen>(`/api/master/${entitas}/${hapusTarget.id}`);
      beritahu(`${judul} dihapus.`);
      if (hapusResp?.infoAkses) beritahu(hapusResp.infoAkses, 'info', 8000);
      setHapusTarget(null);
      await muat();
      onBerubah?.();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
      setHapusTarget(null);
    }
  };

  const ekspor = async () => {
    try {
      const q = cariTunda ? `?cari=${encodeURIComponent(cariTunda)}` : '';
      await unduhExcel(`/api/master/${entitas}/ekspor${q}`, `${entitas}-${new Date().toISOString().slice(0, 10)}.xlsx`);
      beritahu('Berkas Excel diunduh.');
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    }
  };

  const unduhTemplate = async () => {
    try {
      await unduhExcel(`/api/master/${entitas}/template`, `template-${entitas}.xlsx`);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    }
  };

  const prosesImpor = async (file: File) => {
    try {
      const hasil = await imporExcel(entitas, file);
      setHasilImpor(hasil);
      setDiurungkanImpor(false);
      if (hasil.baris_error === 0) beritahu(`Impor selesai: ${hasil.baris_valid} baris masuk.`);
      else beritahu(`Impor: ${hasil.baris_valid} masuk, ${hasil.baris_error} gagal.`, hasil.baris_valid ? 'info' : 'galat');
      await muat();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      if (fileImpor.current) fileImpor.current.value = '';
    }
  };

  // AB3 — Urungkan impor terakhir (bila batch menyimpan jejak).
  const urungkanImporTerakhir = async () => {
    if (!hasilImpor?.batch_id) return;
    try {
      const r = await urungkanImpor(entitas, hasilImpor.batch_id);
      setDiurungkanImpor(true);
      beritahu(r.pesan);
      await muat();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    }
  };

  const labelBarisDipakai = (b: Baris) => (labelBaris ? labelBaris(b) : String(b[kolom[0]?.key] ?? b.id));

  return (
    <>
      {/* U6 — satu komponen PageLayout: kepala + toolbar + isi + paginasi. */}
      <PageLayout
        judul={judul}
        deskripsi={deskripsi}
        jumlah={`${total} data`}
        aksi={
          <>
            {/* Opsi A — sekunder masuk menu Aksi; Tambah di ujung kanan */}
            <MenuAksi
              label={`Aksi ${judul}`}
              items={[
                { label: 'Ekspor Excel', jalan: () => void ekspor() },
                { label: 'Template Impor', jalan: () => void unduhTemplate() },
                { label: 'Impor Excel', jalan: () => fileImpor.current?.click() },
              ]}
            />
            <IconButton
              label={labelTambah ?? `Tambah ${judul}`}
              ikon="plus"
              ukuran="toolbar"
              warna="primer"
              arah="bawah"
              onClick={buatBaru}
            />
          </>
        }
        alat={
          <>
            <div className="cari-scan">
            <input
              className="input-cari"
              type="search"
              placeholder={cariContoh}
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              aria-label="Cari"
            />
            <TombolScan onHasil={setCari} />
            </div>
            {filter && (
              <span className="filter-inline">
              <select
                className="input-pilih"
                value={nilaiFilter}
                onChange={(e) => {
                  setNilaiFilter(e.target.value);
                  setHal(1);
                }}
                aria-label={filter.label}
              >
                <option value="">Semua {filter.label}</option>
                {filter.opsi.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              </span>
            )}
          </>
        }
        isi={
          <>
            <DataTable
          pilihan={pilihan}
          idsHalaman={idsHalaman}
          label="data"
          total={total}
          onPilihSemua={pilihSemuaFilter}
          areaRef={areaRef}
          seleksiDiFooter
          kepala={
            <>
              {kolom.map((k) => (
                <th
                  key={k.key}
                  className={k.rata === 'kanan' ? 'rata-kanan' : k.rata === 'tengah' ? 'rata-tengah' : ''}
                  onClick={() => {
                    if (urut === k.key) setArah(arah === 'ASC' ? 'DESC' : 'ASC');
                    else {
                      setUrut(k.key);
                      setArah('ASC');
                    }
                  }}
                >
                  {k.label}
                  {urut === k.key && <span className="urut-tanda"> {arah === 'ASC' ? '▲' : '▼'}</span>}
                </th>
              ))}
              <th className="rata-kanan kolom-aksi">Aksi</th>
            </>
          }
          baris={data.map((b) => ({
            id: Number(b.id),
            aria: `Pilih ${labelBarisDipakai(b)}`,
            isi: [
              ...kolom.map((k) => (
                <td key={k.key} className={k.rata === 'kanan' ? 'rata-kanan' : k.rata === 'tengah' ? 'rata-tengah' : ''}>
                  {k.render ? k.render(b) : (b[k.key] ?? '—')}
                </td>
              )),
              <td key="__aksi" className="rata-kanan kolom-aksi">
                <span className="aksi-baris">
                  <IconButton label="Ubah" ikon="pencil" onClick={() => ubah(b)} />
                  <IconButton
                    label="Hapus"
                    ikon="trash"
                    warna="bahaya"
                    duaKetuk
                    onClick={() => setHapusTarget(b)}
                  />
                </span>
              </td>,
            ],
          }))}
          colSpan={kolom.length + 2}
          kosong={sibuk && data.length === 0 ? 'Memuat…' : `Tidak ada data${cariTunda ? ` untuk "${cariTunda}"` : ''}.`}
        />
        {sedangMassal && pilihan.jumlah > 0 && progresMassal !== null && !bukaHapusMassal && (
          <ProgresMassal nilai={progresMassal} keterangan={`Memproses batch… ${progresMassal}%`} />
        )}
          </>
        }
        paginasi={
          <FooterDaftar
            mode={modeBaris}
            onMode={setModeBaris}
            hal={hal}
            totalHal={totalHal}
            total={total}
            onHal={setHal}
            seleksi={{
              jumlah: pilihan.jumlah,
              total,
              semuaFilter: pilihan.semuaFilter,
              label: 'data',
              onPilihSemua: pilihSemuaFilter,
              onBatal: pilihan.bersihkan,
              aksi: aksiBar,
            }}
          />
        }
      />

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

      {formBuka && (
        <Modal
          judul={sedangEdit ? `Ubah ${judul}` : `Tambah ${judul}`}
          onTutup={() => setFormBuka(false)}
          sedangKirim={kirim}
          aksi={
            <>
              <button type="button" className="tombol tombol--netral" onClick={() => setFormBuka(false)} disabled={kirim}>
                Batal
              </button>
              <button type="button" className="tombol tombol--primer" onClick={() => void simpan()} disabled={kirim}>
                {kirim ? 'Menyimpan…' : 'Simpan'}
              </button>
            </>
          }
        >
          <div className="form-grid">
            {form.map((f) => {
              if (f.tipe === 'bool') {
                return (
                  <label key={f.key} className="bidang bidang--centang">
                    <input
                      type="checkbox"
                      checked={Number(isi[f.key]) === 1}
                      onChange={(e) => setIsi({ ...isi, [f.key]: e.target.checked ? 1 : 0 })}
                    />
                    <span>{f.label}</span>
                  </label>
                );
              }
              if (f.tipe === 'teks_panjang') {
                return (
                  <label key={f.key} className="bidang bidang--lebar">
                    <span>
                      {f.label} {f.wajib && <em className="wajib">*</em>}
                    </span>
                    <textarea
                      rows={3}
                      value={String(isi[f.key] ?? '')}
                      onChange={(e) => setIsi({ ...isi, [f.key]: e.target.value })}
                    />
                  </label>
                );
              }
              if (f.tipe === 'ref') {
                return (
                  <label key={f.key} className="bidang">
                    <span>
                      {f.label} {f.wajib && <em className="wajib">*</em>}
                    </span>
                    <select value={String(isi[f.key] ?? '')} onChange={(e) => setIsi({ ...isi, [f.key]: e.target.value })}>
                      <option value="">{f.labelKosong ?? '— pilih —'}</option>
                      {(f.opsi ?? opsiDinamis[f.key] ?? []).map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              }
              return (
                <label key={f.key} className="bidang">
                  <span>
                    {f.label} {f.wajib && <em className="wajib">*</em>}
                  </span>
                  <input
                    type={f.tipe === 'angka' ? 'number' : 'text'}
                    min={f.min}
                    value={String(isi[f.key] ?? '')}
                    placeholder={f.contoh}
                    onChange={(e) => setIsi({ ...isi, [f.key]: e.target.value })}
                  />
                </label>
              );
            })}
          </div>
        </Modal>
      )}

      {hapusTarget && (
        <Modal
          judul={`Hapus ${judul}?`}
          lebar="kecil"
          onTutup={() => setHapusTarget(null)}
          aksi={
            <>
              <button type="button" className="tombol tombol--netral" onClick={() => setHapusTarget(null)}>
                Batal
              </button>
              <button type="button" className="tombol tombol--bahaya" onClick={() => void konfirmasiHapus()}>
                Hapus
              </button>
            </>
          }
        >
          <p>
            Data <strong>{labelBarisDipakai(hapusTarget)}</strong> akan dihapus permanen. Tindakan ini tercatat di audit log.
          </p>
          <p className="teks-redup teks-kecil">Bila data sudah dipakai dokumen lain, penghapusan akan ditolak oleh sistem.</p>
        </Modal>
      )}

      {hasilImpor && (
        <Modal
          judul={diurungkanImpor ? 'Impor Diurungkan' : 'Hasil Impor Excel'}
          lebar={hasilImpor.errors.length ? 'lebar' : 'kecil'}
          onTutup={() => setHasilImpor(null)}
          aksi={
            <>
              {hasilImpor.urungkan_tersedia && hasilImpor.batch_id && !diurungkanImpor && (
                <button type="button" className="tombol tombol--netral" onClick={() => void urungkanImporTerakhir()}>
                  Urungkan impor ini
                </button>
              )}
              <button type="button" className="tombol tombol--primer" onClick={() => setHasilImpor(null)}>
                Tutup
              </button>
            </>
          }
        >
          {diurungkanImpor ? (
            <p>Impor diurungkan — baris yang ditambah/diubah telah dikembalikan.</p>
          ) : (
            <>
              <p>
                <strong>{hasilImpor.total_baris}</strong> baris akan diproses ·{' '}
                <strong className="teks-sukses">{hasilImpor.baris_valid} masuk</strong>
                {typeof hasilImpor.jumlah_baru === 'number' ? ` (${hasilImpor.jumlah_baru} baru · ${hasilImpor.jumlah_perbarui ?? 0} diperbarui)` : ''} ·{' '}
                {hasilImpor.baris_dilewati > 0 ? `${hasilImpor.baris_dilewati} dilewati · ` : ''}
                <strong className="teks-galat">{hasilImpor.baris_error} gagal</strong>
              </p>
              {hasilImpor.ringkasan && hasilImpor.ringkasan.length > 0 && hasilImpor.baris_error > 0 && (
                <p className="teks-kecil">
                  Alasan terbanyak: <strong>“{hasilImpor.ringkasan[0].alasan}”</strong> ({hasilImpor.ringkasan[0].jumlah} baris)
                </p>
              )}
              {hasilImpor.errors.length > 0 && (
                <>
                  <div className="wiz-error-alat">
                    <span className="teks-redup teks-kecil">Menampilkan {Math.min(50, hasilImpor.errors.length)} dari {hasilImpor.errors.length} error</span>
                    <button
                      type="button"
                      className="tombol tombol--netral tombol--kecil"
                      onClick={() =>
                        void unduhLaporanError(entitas, 'impor.xlsx', hasilImpor.errors, 'laporan-error-impor.xlsx').catch((err) =>
                          beritahu((err as Error).message, 'galat'),
                        )
                      }
                    >
                      Unduh laporan error
                    </button>
                  </div>
                  <div className="wiz-tabel-bungkus">
                    <table className="tabel wiz-tabel-error">
                      <thead>
                        <tr>
                          <th className="rata-kanan">No Baris</th>
                          <th>Kolom</th>
                          <th>Nilai</th>
                          <th>Alasan</th>
                        </tr>
                      </thead>
                      <tbody>
                        {hasilImpor.errors.slice(0, 50).map((e, i) => (
                          <tr key={`${e.nomor_baris}-${i}`}>
                            <td className="rata-kanan">{e.nomor_baris}</td>
                            <td>{e.kolom || '—'}</td>
                            <td className="wiz-tabel-error__nilai">{e.nilai || '—'}</td>
                            <td>{e.pesan}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </Modal>
      )}
      {bukaSetMassal && massalUbah && (
        <Modal
          judul={`Atur ${massalUbah.label} — ${pilihan.terpilih.size} baris terpilih`}
          lebar="kecil"
          onTutup={() => setBukaSetMassal(false)}
          sedangKirim={sedangMassal}
          aksi={
            <>
              <button type="button" className="tombol tombol--netral" onClick={() => setBukaSetMassal(false)}>
                Batal
              </button>
              <button
                type="button"
                className="tombol tombol--primer"
                disabled={sedangMassal}
                onClick={() => void konfirmasiSetMassal()}
              >
                Terapkan
              </button>
            </>
          }
        >
          <label className="teks-kecil" style={{ display: 'block' }}>
            {massalUbah.label}
            <select
              value={nilaiSetMassal}
              onChange={(e) => setNilaiSetMassal(e.target.value)}
              aria-label={massalUbah.label}
              autoFocus
              style={{ display: 'block', width: '100%', marginTop: 4 }}
            >
              <option value="">{massalUbah.labelKosong}</option>
              {opsiSetMassal.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <p className="teks-redup teks-kecil" style={{ marginTop: 8 }}>
            Perubahan berlaku untuk semua baris yang dipilih dan tercatat di log aktivitas.
          </p>
        </Modal>
      )}
      {bukaHapusMassal && (
        <DialogHapusMassal
          judul={`Hapus Massal ${judul}?`}
          labelJumlah="data"
          jumlah={pilihan.jumlah}
          namaAwal={namaHapus ?? []}
          memuatNama={memuatNamaHapus}
          sedang={sedangMassal}
          saran="Data yang masih dipakai lain tidak bisa dihapus — sarannya: Nonaktifkan."
          progres={sedangMassal && progresMassal !== null ? <ProgresMassal nilai={progresMassal} keterangan={`Menghapus… ${progresMassal}%`} /> : undefined}
          onBatal={() => {
            if (!sedangMassal) {
              setBukaHapusMassal(false);
              setNamaHapus(null);
            }
          }}
          onHapus={() => void konfirmasiHapusMassal()}
        />
      )}

      {hasilMassal && <DialogHasilMassal hasil={hasilMassal} onTutup={() => setHasilMassal(null)} />}
    </>
  );
}

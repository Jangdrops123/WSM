import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/crud/Modal';
import {
  OPSI_IMPOR_BAWAAN,
  apiGet,
  imporExcel,
  kolomImpor,
  praTinjauImpor,
  unduhExcel,
  unduhLaporanError,
  urungkanImpor,
  type ImportResult,
  type KolomImpor,
  type OpsiImpor,
  type PraImpor,
} from '../../lib/api';
import { KOLOM_IMPOR_PRODUK, autoPemetaan, type KolomProduk } from './kolomProduk';
import './impor-ekspor.css';

const LANGKAH = ['Unggah file', 'Cocokkan kolom', 'Pratinjau', 'Selesai'];

function formatUkuran(ba: number): string {
  if (ba < 1024) return `${ba} B`;
  if (ba < 1024 * 1024) return `${(ba / 1024).toFixed(1)} KB`;
  return `${(ba / 1024 / 1024).toFixed(2)} MB`;
}

interface Props {
  entitas: string;
  /** Nama modul untuk judul & pesan — mis. "Produk". */
  judul: string;
  templateUrl: string;
  templateNama: string;
  /** Daftar kolom modul (default: KOLOM_PRODUK tanpa kolom turunan). */
  kolom?: KolomProduk[];
  onTutup: () => void;
  /** Dipanggil setelah impor benar-benar diterapkan (muat ulang data). */
  onSelesai: () => void | Promise<void>;
}

/**
 * Wizard Impor Excel empat langkah:
 *   1. Unggah file  → pilih berkas .xlsx
 *   2. Cocokkan kolom → pemetaan kolom file → kolom modul (terisi otomatis),
 *      panel kanan: info file, unduh template, hasil pengecekan & opsi impor
 *   3. Pratinjau → daftar baris valid + error per baris
 *   4. Selesai → ringkasan hasil
 */
export function DialogImporExcel({
  entitas,
  judul,
  templateUrl,
  templateNama,
  kolom = KOLOM_IMPOR_PRODUK,
  onTutup,
  onSelesai,
}: Props) {
  const [langkah, setLangkah] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState<KolomImpor | null>(null);
  const [pemetaan, setPemetaan] = useState<Record<string, string>>({});
  const [pra, setPra] = useState<PraImpor | null>(null);
  const [hasil, setHasil] = useState<ImportResult | null>(null);
  const [opsi, setOpsi] = useState<OpsiImpor>(OPSI_IMPOR_BAWAAN);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState('');
  const pilihFile = useRef<HTMLInputElement>(null);
  const [opsiProfil, setOpsiProfil] = useState<{ id: number; label: string }[]>([]);
  // AB1 — filter tabel detail error; AB3 — progres & status urungkan.
  const [cariError, setCariError] = useState('');
  const [memproses, setMemproses] = useState(false);
  const [diurungkan, setDiurungkan] = useState(false);
  const [pesanUrung, setPesanUrung] = useState('');

  // Saran isi kolom profil_size (X5.5) — daftar profil dari Pengaturan ▸ Aturan Kodi.
  useEffect(() => {
    if (!kolom.some((k) => k.key === 'profil_size')) return;
    let hidup = true;
    apiGet<{ data: { id: number; label: string }[] }>('/api/profil-size/opsi')
      .then((r) => {
        if (hidup) setOpsiProfil(r.data);
      })
      .catch(() => {
        /* profil belum tersedia — kolom tetap bisa dikosongkan */
      });
    return () => {
      hidup = false;
    };
  }, [kolom]);

  /** Tahap 0 → 1: baca judul kolom file lalu isi pemetaan otomatis. */
  const terimaFile = async (f: File) => {
    if (!/\.(xlsx|xls)$/i.test(f.name)) {
      setGalat('Format file harus .xlsx (Excel 2007 ke atas).');
      return;
    }
    setGalat('');
    setFile(f);
    setInfo(null);
    setPra(null);
    setPemetaan({});
    setHasil(null);
    setSibuk(true);
    try {
      const i = await kolomImpor(entitas, f);
      setInfo(i);
      setPemetaan(autoPemetaan(i.kolom, kolom));
      setLangkah(1);
    } catch (err) {
      setGalat((err as Error).message);
      setFile(null);
    } finally {
      setSibuk(false);
    }
  };

  // Pra-tinjau langkah 2 & 3 — dijalankan ulang setiap pemetaan/opsi berubah
  // sehingga hasil pengecekan di panel kanan selalu sinkron dengan pilihan.
  useEffect(() => {
    if (!file || !info || langkah < 1 || langkah > 2) return;
    let hidup = true;
    const t = window.setTimeout(() => {
      setSibuk(true);
      praTinjauImpor(entitas, file, pemetaan, opsi)
        .then((p) => {
          if (hidup) {
            setPra(p);
            setGalat('');
          }
        })
        .catch((err) => {
          if (hidup) {
            setPra(null);
            setGalat((err as Error).message);
          }
        })
        .finally(() => {
          if (hidup) setSibuk(false);
        });
    }, 350);
    return () => {
      hidup = false;
      window.clearTimeout(t);
    };
  }, [file, info, pemetaan, opsi, langkah, entitas]);

  const wajibBelum = kolom.filter((k) => k.wajib && !pemetaan[k.key]);
  const bolehLanjut =
    langkah === 0
      ? !!file && !!info
      : langkah === 1
        ? wajibBelum.length === 0 && !!pra && !pra.blokir && pra.baris_valid > 0
        : false;

  const diperbarui = pra?.jumlah_perbarui ?? pra?.baris.filter((b) => b.aksi === 'perbarui').length ?? 0;
  const valid = pra?.baris_valid ?? 0;
  const baru = pra?.jumlah_baru ?? valid - diperbarui;
  const peringatan = diperbarui + (pra?.baris_dilewati ?? 0);
  const galatJumlah = pra?.baris_error ?? 0;

  // AB1 — konsol debug: daftar alasan error + baris pertama (panduan perbaikan).
  useEffect(() => {
    if (!pra || pra.baris_error === 0) return;
    console.debug('[impor:pra-tinjau]', pra.nama_file, {
      total_baris: pra.total_baris,
      baris_valid: pra.baris_valid,
      baris_error: pra.baris_error,
      ringkasan_alasan: pra.ringkasan,
      peringatan: pra.peringatan?.length ?? 0,
      contoh_error: pra.errors.slice(0, 5),
    });
  }, [pra]);

  // AB1 — unduh laporan error Excel dari panel pengecekan / langkah pratinjau.
  const unduhError = async () => {
    if (!pra || pra.errors.length === 0) return;
    try {
      await unduhLaporanError(entitas, pra.nama_file || file?.name || 'impor.xlsx', pra.errors, 'laporan-error-impor.xlsx');
    } catch (err) {
      setGalat((err as Error).message);
    }
  };

  const konfirmasi = async () => {
    if (!file || !pra) return;
    setSibuk(true);
    setMemproses(true);
    setGalat('');
    try {
      const h = await imporExcel(entitas, file, pemetaan, opsi);
      setHasil(h);
      setLangkah(3);
      await onSelesai();
    } catch (err) {
      setGalat((err as Error).message);
    } finally {
      setMemproses(false);
      setSibuk(false);
    }
  };

  // AB3 — Urungkan impor yang baru saja diterapkan.
  const urungkan = async () => {
    if (!hasil?.batch_id) return;
    setSibuk(true);
    setGalat('');
    try {
      const r = await urungkanImpor(entitas, hasil.batch_id);
      setDiurungkan(true);
      setPesanUrung(r.pesan);
      await onSelesai();
    } catch (err) {
      setGalat((err as Error).message);
    } finally {
      setSibuk(false);
    }
  };

  const tutup = () => {
    if (sibuk) return;
    onTutup();
  };

  // --- Panel kanan: info file, template, hasil pengecekan, opsi ------------
  const panelKanan = (
    <aside className="wiz-panel">
      <div className="wiz-panel__blok">
        <h5>Info file</h5>
        {file ? (
          <>
            <div className="wiz-panel__baris"><span>Nama</span><span>{file.name}</span></div>
            <div className="wiz-panel__baris"><span>Ukuran</span><span>{formatUkuran(file.size)}</span></div>
            <div className="wiz-panel__baris"><span>Baris data</span><span>{info?.total_baris ?? '…'}</span></div>
            <div className="wiz-panel__baris"><span>Kolom terdeteksi</span><span>{info?.kolom.length ?? '…'}</span></div>
          </>
        ) : (
          <p className="teks-redup teks-kecil" style={{ margin: 0 }}>Belum ada file dipilih.</p>
        )}
      </div>

      <div className="wiz-panel__blok">
        <h5>Template Excel</h5>
        <p className="teks-redup teks-kecil" style={{ margin: '0 0 8px' }}>
          Unduh template resmi agar judul kolom langsung cocok.
        </p>
        <button
          type="button"
          className="tombol tombol--netral tombol--kecil"
          onClick={() => void unduhExcel(templateUrl, templateNama)}
        >
          <Icon nama="file-down" size={15} /> Unduh template Excel
        </button>
      </div>

      {langkah >= 1 && pra && (
        <div className="wiz-panel__blok">
          <h5>Hasil pengecekan</h5>
          <div className="hasil-cek">
            <div className="hasil-cek__baris hasil-cek__baris--valid">
              <span>Baris valid</span>
              <b>{valid}</b>
            </div>
            <div className="hasil-cek__baris hasil-cek__baris--peringatan">
              <span>Peringatan</span>
              <b>{peringatan}</b>
            </div>
            <div className="hasil-cek__baris hasil-cek__baris--error">
              <span>Error</span>
              <b>{galatJumlah}</b>
            </div>
          </div>

          {/* AB1 — alasan terbanyak di atas panel pengecekan. */}
          {galatJumlah > 0 && pra.ringkasan && pra.ringkasan.length > 0 && (
            <div className="wiz-banner wiz-banner--peringatan wiz-banner--rapat">
              <Icon nama="circle-check" size={15} />
              <span>
                Alasan terbanyak: <strong>“{pra.ringkasan[0].alasan}”</strong> ({pra.ringkasan[0].jumlah} baris).
              </span>
            </div>
          )}

          {/* AB3 — ringkasan jumlah yang akan ditulis. */}
          <p className="teks-redup teks-kecil" style={{ margin: '8px 0 0' }}>
            {valid} baris akan ditulis ({baru} baru · {diperbarui} diperbarui)
            {pra.baris_dilewati > 0 ? ` · ${pra.baris_dilewati} dilewati` : ''}.
          </p>

          {/* AB1 — peringatan non-memutus dari server. */}
          {(pra.peringatan?.length ?? 0) > 0 && (
            <p className="teks-redup teks-kecil" style={{ margin: '6px 0 0' }}>
              ⚠ {pra.peringatan!.length} peringatan: {pra.peringatan!.slice(0, 3).map((p) => p.pesan).join(' · ')}
              {pra.peringatan!.length > 3 ? ' …' : ''}
            </p>
          )}

          {/* AB1 — unduh laporan error (tabel No Baris | Kolom | Nilai | Alasan). */}
          {galatJumlah > 0 && (
            <button
              type="button"
              className="tombol tombol--netral tombol--kecil"
              style={{ marginTop: 10 }}
              onClick={() => void unduhError()}
            >
              <Icon nama="file-down" size={15} /> Unduh laporan error
            </button>
          )}
        </div>
      )}

      {langkah >= 1 && langkah <= 2 && (
        <div className="wiz-panel__blok">
          <h5>Opsi impor</h5>
          <div className="wiz-opsi">
            <label>
              <input
                type="checkbox"
                checked={opsi.perbarui}
                onChange={(e) => setOpsi((o) => ({ ...o, perbarui: e.target.checked }))}
              />
              <span>Perbarui data jika Kode sudah ada</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={opsi.lewati_error}
                onChange={(e) => setOpsi((o) => ({ ...o, lewati_error: e.target.checked }))}
              />
              <span>Lewati baris yang error</span>
            </label>
          </div>
        </div>
      )}
    </aside>
  );

  // --- Isi per langkah ----------------------------------------------------
  let isi: ReactNode = null;

  if (langkah === 0) {
    isi = (
      <>
        <div
          className={`wiz-unggah${file ? ' wiz-unggah--aktif' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => pilihFile.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              pilihFile.current?.click();
            }
          }}
        >
          <div className="wiz-unggah__ikon">
            <Icon nama="upload" size={26} />
          </div>
          <h4>{file ? 'Ganti file Excel' : 'Seret file ke sini atau klik untuk memilih'}</h4>
          <p>Mendukung berkas .xlsx — baris pertama harus berisi judul kolom.</p>
          {file && (
            <div className="wiz-unggah__file">
              <Icon nama="file-down" size={14} />
              {file.name} · {formatUkuran(file.size)}
            </div>
          )}
        </div>
        <p className="teks-redup teks-kecil">
          Setelah file dipilih, langkah berikutnya menampilkan pemetaan kolom otomatis beserta contoh data
          dari file Anda. Tidak ada data yang ditulis sebelum Anda menekan <strong>Konfirmasi Impor</strong>.
        </p>
      </>
    );
  } else if (langkah === 1) {
    isi = (
      <>
        {wajibBelum.length > 0 && (
          <div className="wiz-banner wiz-banner--peringatan">
            <Icon nama="circle-check" size={16} />
            <span>
              Kolom wajib berikut belum dipetakan: <strong>{wajibBelum.map((k) => k.label).join(', ')}</strong>.
            </span>
          </div>
        )}
        {wajibBelum.length === 0 && pra && pra.baris_valid === 0 && (
          <div className="wiz-banner wiz-banner--peringatan">
            <Icon nama="circle-check" size={16} />
            <span>
              {pra.baris_error > 0
                ? 'Tidak ada baris valid — perbaiki file atau pemetaan kolom.'
                : 'Semua baris dilewati dengan opsi saat ini — nyalakan “Perbarui data jika Kode sudah ada” atau gunakan file lain.'}
            </span>
          </div>
        )}
        <div className="wiz-tabel-bungkus">
          <table className="wiz-pemetaan">
            <thead>
              <tr>
                <th>Kolom {judul}</th>
                <th>Kolom di file Excel</th>
                <th>Contoh data</th>
                <th className="rata-tengah">Status</th>
              </tr>
            </thead>
            <tbody>
              {kolom.map((k) => {
                const terpilih = pemetaan[k.key] ?? '';
                const contoh = terpilih ? String(info?.contoh?.[terpilih] ?? '') : '';
                return (
                  <tr key={k.key} className={!terpilih && k.wajib ? 'wiz-pemetaan__baris--kosong' : undefined}>
                    <td>
                      <div className="wiz-pemetaan__nama">
                        {k.label}
                        {k.wajib && <em className="wajib">*</em>}
                      </div>
                      <div className="wiz-pemetaan__ket">{k.ket}</div>
                      {k.key === 'profil_size' && opsiProfil.length > 0 && (
                        <div className="wiz-pemetaan__ket">
                          Saran nilai: {opsiProfil.map((o) => o.label).join(' · ')}
                        </div>
                      )}
                    </td>
                    <td>
                      <select
                        value={terpilih}
                        aria-label={`Pemetaan kolom ${k.label}`}
                        onChange={(e) =>
                          setPemetaan((p) => ({ ...p, [k.key]: e.target.value }))
                        }
                      >
                        <option value="">— tidak dipetakan —</option>
                        {(info?.kolom ?? []).map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="wiz-pemetaan__contoh">{contoh || '—'}</td>
                    <td className="rata-tengah">
                      <span className={`lencana ${terpilih ? 'lencana--aktif' : 'lencana--peringatan'}`}>
                        {terpilih ? 'Cocok' : 'Belum dipetakan'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="tombol-baris">
          <button
            type="button"
            className="tombol tombol--netral tombol--kecil"
            onClick={() => info && setPemetaan(autoPemetaan(info.kolom, kolom))}
            disabled={!info}
          >
            <Icon nama="rotate-ccw" size={14} /> Kembalikan pemetaan otomatis
          </button>
          <span className="teks-redup teks-kecil">
            {Object.values(pemetaan).filter(Boolean).length} dari {kolom.length} kolom modul dipetakan
          </span>
        </div>
      </>
    );
  } else if (langkah === 2) {
    isi = (
      <>
        {pra?.blokir && (
          <div className="wiz-banner wiz-banner--galat">
            <Icon nama="circle-check" size={16} />
            <span>
              Ada <strong>{galatJumlah} baris error</strong> dan opsi <strong>Lewati baris yang error</strong>{' '}
              dimatikan — impor akan ditolak. Nyalakan opsi tersebut atau perbaiki file.
            </span>
          </div>
        )}
        {/* AB3 — progres indeterminatif saat konfirmasi menulis data. */}
        {memproses && (
          <div className="wiz-progres" role="progressbar" aria-label="Mengimpor data">
            <span />
          </div>
        )}
        {!pra && !galat && <p className="teks-redup">Memeriksa baris…</p>}
        {pra && (
          <>
            <p className="teks-kecil" style={{ margin: 0 }}>
              Total <strong>{pra.total_baris}</strong> baris ·{' '}
              <strong className="teks-sukses">{valid} valid</strong> ·{' '}
              <strong style={{ color: 'var(--warning)' }}>{peringatan} peringatan</strong> ·{' '}
              <strong className="teks-galat">{galatJumlah} error</strong>
            </p>

            {galatJumlah > 0 && (
              <>
                <h4 className="bagian-judul">Error per baris</h4>
                {/* AB1 — filter + tabel detail (No Baris | Kolom | Nilai | Alasan) + unduh laporan. */}
                <div className="wiz-error-alat">
                  <input
                    type="search"
                    value={cariError}
                    placeholder="Cari: nomor baris, kolom, nilai, atau alasan…"
                    aria-label="Filter error"
                    onChange={(e) => setCariError(e.target.value)}
                  />
                  <span className="teks-redup teks-kecil">
                    {(() => {
                      const q = cariError.trim().toLowerCase();
                      const n = q
                        ? pra.errors.filter(
                            (e) =>
                              String(e.nomor_baris).includes(q) ||
                              (e.kolom ?? '').toLowerCase().includes(q) ||
                              (e.nilai ?? '').toLowerCase().includes(q) ||
                              e.pesan.toLowerCase().includes(q),
                          ).length
                        : pra.errors.length;
                      return `${n} dari ${pra.errors.length} error`;
                    })()}
                  </span>
                  <button type="button" className="tombol tombol--netral tombol--kecil" onClick={() => void unduhError()}>
                    <Icon nama="file-down" size={14} /> Unduh laporan
                  </button>
                </div>
                {(() => {
                  const q = cariError.trim().toLowerCase();
                  const daftar = q
                    ? pra.errors.filter(
                        (e) =>
                          String(e.nomor_baris).includes(q) ||
                          (e.kolom ?? '').toLowerCase().includes(q) ||
                          (e.nilai ?? '').toLowerCase().includes(q) ||
                          e.pesan.toLowerCase().includes(q),
                      )
                    : pra.errors;
                  if (!daftar.length) return <p className="teks-redup">Tidak ada error yang cocok dengan filter.</p>;
                  return (
                    <>
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
                            {daftar.slice(0, 200).map((e, i) => (
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
                      {daftar.length > 200 && (
                        <p className="teks-redup teks-kecil">… dan {daftar.length - 200} error lainnya (unduh laporan untuk lengkapnya).</p>
                      )}
                    </>
                  );
                })()}
              </>
            )}

            <h4 className="bagian-judul">Baris yang akan ditulis (maks 50 ditampilkan)</h4>
            {pra.baris.length === 0 ? (
              <p className="teks-redup">Tidak ada baris yang akan ditulis.</p>
            ) : (
              <div className="wiz-tabel-bungkus">
                <table className="tabel">
                  <thead>
                    <tr>
                      <th>Baris</th>
                      <th>Kode Item</th>
                      <th>Nama Produk</th>
                      <th>SKU</th>
                      <th className="rata-tengah">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pra.baris.slice(0, 50).map((b) => (
                      <tr key={`${b.nomor}-${b.sku}`}>
                        <td>{b.nomor}</td>
                        <td>
                          <code>{b.kode_item}</code>
                        </td>
                        <td>{b.nama_produk}</td>
                        <td>{b.sku}</td>
                        <td className="rata-tengah">
                          <span className={`lencana ${b.aksi === 'baru' ? 'lencana--aktif' : 'lencana--peringatan'}`}>
                            {b.aksi === 'baru' ? 'Baru' : 'Perbarui'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {pra.baris.length > 50 && (
              <p className="teks-redup teks-kecil">… dan {pra.baris.length - 50} baris valid lainnya.</p>
            )}
          </>
        )}
      </>
    );
  } else {
    const semuaGalat = hasil?.baris_error ?? 0;
    const ikon = semuaGalat === 0 ? '' : hasil?.baris_valid ? 'peringatan' : 'galat';
    isi = (
      <div className="wiz-selesai">
        <div className={`wiz-selesai__ikon${ikon ? ` wiz-selesai__ikon--${ikon}` : ''}`}>
          <Icon nama={semuaGalat === 0 ? 'circle-check' : 'close'} size={32} />
        </div>
        <h4>{diurungkan ? 'Impor diurungkan' : 'Impor selesai'}</h4>
        <p>
          {diurungkan
            ? pesanUrung
            : `Berkas ${hasil?.batch_id ? `#${hasil.batch_id}` : ''} berhasil diproses.`}
        </p>
        {!diurungkan && (
          <p className="teks-kecil" style={{ marginTop: 6 }}>
            <strong>{hasil?.jumlah_baru ?? (hasil?.baris_valid ?? 0)}</strong> ditambahkan ·{' '}
            <strong>{hasil?.jumlah_perbarui ?? 0}</strong> diperbarui ·{' '}
            <strong>{hasil?.baris_dilewati ?? 0}</strong> dilewati
          </p>
        )}
        <div className="wiz-selesai__angka">
          <div>
            <strong>{hasil?.total_baris ?? 0}</strong>
            <span>Total baris</span>
          </div>
          <div>
            <strong className="teks-sukses">{hasil?.baris_valid ?? 0}</strong>
            <span>Masuk</span>
          </div>
          <div>
            <strong>{hasil?.baris_dilewati ?? 0}</strong>
            <span>Dilewati</span>
          </div>
          <div>
            <strong className={semuaGalat ? 'teks-galat' : ''}>{semuaGalat}</strong>
            <span>Gagal</span>
          </div>
        </div>
        {semuaGalat > 0 && (
          <ul className="daftar-error" style={{ textAlign: 'left' }}>
            {(hasil?.errors ?? []).slice(0, 20).map((e, i) => (
              <li key={i}>
                Baris {e.nomor_baris}: {e.pesan}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const aksi =
    langkah === 3 ? (
      <>
        {/* AB3 — Urungkan impor (bila batch punya jejak & belum diurungkan). */}
        {hasil?.urungkan_tersedia && hasil.batch_id && !diurungkan && (
          <button type="button" className="tombol tombol--netral" disabled={sibuk} onClick={() => void urungkan()}>
            <Icon nama="rotate-ccw" size={15} /> {sibuk ? 'Mengurungkan…' : 'Urungkan impor ini'}
          </button>
        )}
        <button type="button" className="tombol tombol--primer" onClick={tutup}>
          Tutup
        </button>
      </>
    ) : (
      <>
        {langkah > 0 && (
          <button
            type="button"
            className="tombol tombol--netral"
            disabled={sibuk}
            onClick={() => setLangkah((l) => l - 1)}
          >
            <Icon nama="chevron-left" size={15} /> Kembali
          </button>
        )}
        {langkah < 2 ? (
          <button
            type="button"
            className="tombol tombol--primer"
            disabled={sibuk || !bolehLanjut}
            onClick={() => setLangkah((l) => l + 1)}
          >
            Lanjut <Icon nama="chevron-right" size={15} />
          </button>
        ) : (
          <button
            type="button"
            className="tombol tombol--primer"
            disabled={sibuk || !pra || pra.baris_valid === 0 || pra.blokir}
            onClick={() => void konfirmasi()}
          >
            {sibuk ? 'Mengimpor…' : `Konfirmasi Impor (${valid} baris)`}
          </button>
        )}
      </>
    );

  return (
    <Modal
      judul={`Impor ${judul} dari Excel`}
      lebar="sangat"
      onTutup={tutup}
      sedangKirim={sibuk}
      aksi={
        langkah === 3 ? (
          aksi
        ) : (
          <>
            <span className="teks-redup teks-kecil">{file?.name ?? 'Belum ada file'}</span>
            <button
              type="button"
              className="tombol tombol--netral"
              disabled={sibuk}
              onClick={tutup}
            >
              Batal
            </button>
            {aksi}
          </>
        )
      }
    >
      <input
        ref={pilihFile}
        type="file"
        accept=".xlsx,.xls"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void terimaFile(f);
        }}
      />

      <ol className="wiz-langkah" aria-label="Langkah impor">
        {LANGKAH.map((n, i) => (
          <li key={n} style={{ display: 'contents' }}>
            {i > 0 && <span className="wiz-langkah__pipa" aria-hidden="true" />}
            <span
              className={
                'wiz-langkah__item' +
                (i === langkah ? ' wiz-langkah__item--aktif' : i < langkah ? ' wiz-langkah__item--selesai' : '')
              }
              aria-current={i === langkah ? 'step' : undefined}
            >
              <b>{i < langkah ? '✓' : i + 1}</b>
              {n}
            </span>
          </li>
        ))}
      </ol>

      {galat && langkah < 3 && (
        <div className="wiz-banner wiz-banner--galat" style={{ marginBottom: 12 }}>
          <Icon nama="close" size={16} />
          <span>{galat}</span>
        </div>
      )}

      <div className="wiz-badan">
        <div className="wiz-utama">{isi}</div>
        {panelKanan}
      </div>
    </Modal>
  );
}

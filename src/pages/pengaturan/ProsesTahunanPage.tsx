import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { beritahu } from '../../components/crud/Toast';
import { ambilOpsi, apiGet, apiPost, unduhExcel } from '../../lib/api';
import { useSegarkanModul } from '../../lib/segarkan';
import { cetakHtml } from '../../lib/code39';
import { formatAngka, formatRupiah, formatTanggalWaktu } from '../../lib/format';
import './pengaturan.css';
import './proses-tahunan.css';

/**
 * PROSES TAHUNAN — wizard 4 langkah (tidak bisa dilewati):
 *   1 Pilih Periode + ringkasan jumlah data per modul & peringatan tertahan
 *   2 Peringatan backup WAJIB (unduh .xlsx + centang) sebelum boleh lanjut
 *   3 Konversi Saldo Awal otomatis: tabel Saldo Akhir vs Saldo Awal + penyebab
 *   4 Konfirmasi akhir: ketik "HAPUS" + kata sandi → progres → laporan hasil
 * Setiap proses tercatat di Log Aktivitas; file backup bisa dipulihkan kembali.
 * Hanya Admin (dicek server) yang bisa memakai endpoint fitur ini.
 */

const BASE = '/api/proses-tahunan';

type Opsi = { id: number; label: string };

interface Ringkasan {
  batas: string;
  periodeBaruDari: string;
  ringkas: Record<Modul, number> & { total: number };
  tertahan: Record<string, number>;
  peringatan: string[];
}

type Modul =
  | 'penjualan'
  | 'pembelian'
  | 'retur_masuk'
  | 'retur_keluar'
  | 'persediaan_sub'
  | 'opname'
  | 'mutasi'
  | 'jurnal';

const MODUL: { k: Modul; label: string }[] = [
  { k: 'penjualan', label: 'Penjualan' },
  { k: 'pembelian', label: 'Pembelian' },
  { k: 'retur_masuk', label: 'Retur Masuk' },
  { k: 'retur_keluar', label: 'Retur Keluar' },
  { k: 'persediaan_sub', label: 'Persediaan Sub (Item Masuk/Keluar)' },
  { k: 'opname', label: 'Opname' },
  { k: 'mutasi', label: 'Mutasi (Transfer)' },
  { k: 'jurnal', label: 'Jurnal / Akuntansi' },
];

interface Pratinjau {
  batas: string;
  periodeBaruDari: string;
  baris: { kategori: string; sebelum: number; sesudah: number; selisih: number; alasan: string | null }[];
  rincian: {
    stok: { product_id: number; produk: string; gudang: string; qty: number; nilai: number; tertulis: number }[];
    piutang: { pelanggan: string; sisa: number }[];
    hutang: { supplier: string; sisa: number }[];
    akun: { kode: string; nama: string; tipe: string; kasbank: boolean; sebelum: number; sesudah: number }[];
  };
  stokTotal: number;
  akun1200: number;
  cocok: boolean;
  penyebab: string[];
  catatan: string[];
}

interface Laporan {
  no_proses: string;
  id: number;
  sampai: string;
  periode_baru_dari: string;
  dihapus: Record<Modul, number> & { total: number };
  dipertahankan: Record<string, number>;
  saldo_awal: {
    produk: number;
    nilai_stok: number;
    piutang: number;
    hutang: number;
    kasbank: number;
    id_jurnal_penutup: number;
    id_jurnal_pembuka: number;
  };
  stok: { sebelum: number; sesudah: number; sama: boolean };
  penyebab: string[];
  catatan: string[];
}

interface BarisProses {
  id: number;
  no_proses: string;
  sampai: string;
  periode_baru_dari: string;
  dibuat_pada: string;
  dipulihkan_pada: string | null;
  jumlah_hapus: string;
  gudang: string | null;
  pengguna: string | null;
}

const TAHAPAN: [number, string][] = [
  [8, 'Menyiapkan data & menghitung saldo akhir…'],
  [30, 'Menutup laba/rugi ke Laba Ditahan (jurnal penutup)…'],
  [50, 'Membuat Saldo Awal periode baru…'],
  [72, 'Menghapus riwayat transaksi…'],
  [88, 'Menyimpan laporan & log aktivitas…'],
];

function teksTahap(pct: number): string {
  let teks = 'Memulai…';
  for (const [batas, t] of TAHAPAN) if (pct >= batas) teks = t;
  return teks;
}

const LANGKAH_LABEL = ['Pilih Periode', 'Backup Wajib', 'Saldo Awal', 'Konfirmasi'];

/** HTML Bukti Saldo Awal untuk dicetak (dialog cetak → "Simpan sebagai PDF"). */
function htmlBukti(l: Laporan, p: Pratinjau | null): string {
  const barisKategori = (p?.baris ?? [])
    .map(
      (b) =>
        `<tr><td>${b.kategori}</td><td class="na">${formatRupiah(b.sebelum)}</td><td class="na">${formatRupiah(b.sesudah)}</td><td class="na">${formatRupiah(b.selisih)}</td><td>${b.alasan ?? ''}</td></tr>`,
    )
    .join('');
  const barisHapus = MODUL.map(
    (m) => `<tr><td>${m.label}</td><td class="na">${formatAngka(l.dihapus[m.k] ?? 0)}</td></tr>`,
  ).join('');
  return `
    <style>table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #ccc;padding:5px 7px;text-align:left}th{background:#eef2f7}td.na{text-align:right;font-variant-numeric:tabular-nums}h2{font-size:15px;margin:14px 0 4px}p.meta{margin:2px 0;font-size:12px}</style>
    <h1 style="font-size:17px;margin:0">Bukti Saldo Awal — Proses Tahunan ${l.no_proses}</h1>
    <p class="meta">Batas periode: ${l.sampai} · Saldo Awal berlaku sejak: ${l.periode_baru_dari}</p>
    <p class="meta">Dicetak: ${formatTanggalWaktu(new Date())}</p>
    <h2>Saldo Akhir vs Saldo Awal</h2>
    <table><thead><tr><th>Kategori</th><th>Saldo Akhir Sebelum</th><th>Saldo Awal Sesudah</th><th>Selisih</th><th>Keterangan</th></tr></thead><tbody>${barisKategori}</tbody></table>
    <h2>Transaksi Terhapus</h2>
    <table><thead><tr><th>Modul</th><th>Jumlah</th></tr></thead><tbody>${barisHapus}
      <tr><td><strong>Total</strong></td><td class="na"><strong>${formatAngka(l.dihapus.total)}</strong></td></tr></tbody></table>
    <h2>Saldo Awal yang Dibuat</h2>
    <table><tbody>
      <tr><td>Saldo Awal Stok</td><td class="na">${formatAngka(l.saldo_awal.produk)} produk · ${formatRupiah(l.saldo_awal.nilai_stok)}</td></tr>
      <tr><td>Saldo Awal Piutang</td><td class="na">${formatRupiah(l.saldo_awal.piutang)}</td></tr>
      <tr><td>Saldo Awal Hutang</td><td class="na">${formatRupiah(l.saldo_awal.hutang)}</td></tr>
      <tr><td>Saldo Awal Kas/Bank</td><td class="na">${formatRupiah(l.saldo_awal.kasbank)}</td></tr>
      <tr><td>Jumlah stok sebelum → sesudah</td><td class="na">${formatAngka(l.stok.sebelum)} → ${formatAngka(l.stok.sesudah)} ${l.stok.sama ? '(SAMA ✓)' : '(TIDAK SAMA!)'}</td></tr>
    </tbody></table>
    ${l.catatan.length ? `<h2>Catatan</h2><ul>${l.catatan.map((c) => `<li>${c}</li>`).join('')}</ul>` : ''}
  `;
}

export function ProsesTahunanPage() {
  const tahunLalu = new Date().getFullYear() - 1;
  const [langkah, setLangkah] = useState(1);
  const [gudangId, setGudangId] = useState('');
  const [sampai, setSampai] = useState(`${tahunLalu}-12-31`);
  const [opsiGudang, setOpsiGudang] = useState<Opsi[]>([]);

  const [ringkas, setRingkas] = useState<Ringkasan | null>(null);
  const [pratinjau, setPratinjau] = useState<Pratinjau | null>(null);
  const [hasil, setHasil] = useState<Laporan | null>(null);
  const [daftar, setDaftar] = useState<BarisProses[]>([]);

  const [sudahUnduh, setSudahUnduh] = useState(false);
  const [centang, setCentang] = useState(false);
  const [kata, setKata] = useState('');
  const [sandi, setSandi] = useState('');
  const [sibuk, setSibuk] = useState(false);
  const [progres, setProgres] = useState<{ pct: number; teks: string } | null>(null);

  const [pulihNo, setPulihNo] = useState('');
  const [pulihFile, setPulihFile] = useState<File | null>(null);
  const [pulihSibuk, setPulihSibuk] = useState(false);
  const [kunciInput, setKunciInput] = useState(0);

  const nomorReq = useRef(0);
  const timerProgres = useRef<number | null>(null);

  const q = useCallback(() => {
    const usp = new URLSearchParams({ sampai });
    if (gudangId) usp.set('gudang_id', gudangId);
    return usp.toString();
  }, [sampai, gudangId]);

  const muatDaftar = useCallback(async () => {
    try {
      const r = await apiGet<{ data: BarisProses[] }>(`${BASE}/daftar`);
      setDaftar(r.data);
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    }
  }, []);

  useEffect(() => {
    ambilOpsi('gudang').then(setOpsiGudang).catch(() => undefined);
    void muatDaftar();
  }, [muatDaftar]);
  // Tombol Refresh global di topbar: muat ulang riwayat proses tahunan.
  useSegarkanModul(muatDaftar);

  // Ringkasan langkah 1 — dimuat ulang tiap ganti tanggal/gudang.
  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sampai)) return;
    const nomor = ++nomorReq.current;
    apiGet<Ringkasan>(`${BASE}/ringkas?${q()}`)
      .then((r) => {
        if (nomor === nomorReq.current) setRingkas(r);
      })
      .catch((e: Error) => beritahu(e.message, 'galat'));
  }, [q, sampai]);

  useEffect(() => () => {
    if (timerProgres.current) window.clearInterval(timerProgres.current);
  }, []);

  async function muatPratinjau(): Promise<Pratinjau | null> {
    setSibuk(true);
    try {
      const r = await apiGet<Pratinjau>(`${BASE}/pratinjau?${q()}`);
      setPratinjau(r);
      return r;
    } catch (e) {
      beritahu((e as Error).message, 'galat');
      return null;
    } finally {
      setSibuk(false);
    }
  }

  async function lanjutKe2() {
    setLangkah(2);
  }

  async function unduhBackup() {
    try {
      await unduhExcel(`${BASE}/backup?${q()}`, `backup-proses-tahunan-${sampai}.xlsx`);
      setSudahUnduh(true);
      beritahu('File backup berhasil diunduh — simpan di tempat yang aman.', 'sukses');
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    }
  }

  async function lanjutKe3() {
    if (!sudahUnduh || !centang) return;
    const p = await muatPratinjau();
    if (p) setLangkah(3);
  }

  function lanjutKe4() {
    if (!pratinjau?.cocok) return;
    setLangkah(4);
  }

  async function jalankan() {
    if (kata !== 'HAPUS' || !sandi || sibuk) return;
    setSibuk(true);
    setProgres({ pct: 4, teks: 'Memulai…' });
    timerProgres.current = window.setInterval(() => {
      setProgres((p) => {
        if (!p || p.pct >= 88) return p;
        const pct = Math.min(88, p.pct + 6);
        return { pct, teks: teksTahap(pct) };
      });
    }, 450);
    try {
      const r = await apiPost<Laporan>(`${BASE}/jalankan`, { sampai, gudang_id: gudangId ? Number(gudangId) : null, kata, sandi: sandi });
      setProgres({ pct: 100, teks: 'Selesai.' });
      setHasil(r);
      setLangkah(5);
      beritahu(`Proses Tahunan ${r.no_proses} selesai.`, 'sukses');
      void muatDaftar();
    } catch (e) {
      beritahu((e as Error).message, 'galat');
      setProgres(null);
    } finally {
      if (timerProgres.current) window.clearInterval(timerProgres.current);
      timerProgres.current = null;
      setSibuk(false);
    }
  }

  function ulang() {
    setLangkah(1);
    setHasil(null);
    setPratinjau(null);
    setSudahUnduh(false);
    setCentang(false);
    setKata('');
    setSandi('');
    setProgres(null);
    setKunciInput((k) => k + 1);
  }

  function unduhBukti(id: number, no: string) {
    void unduhExcel(`${BASE}/${id}/bukti`, `bukti-saldo-awal-${no}.xlsx`).catch((e: Error) =>
      beritahu(e.message, 'galat'),
    );
  }

  function cetakBukti() {
    if (!hasil) return;
    cetakHtml(
      `Bukti Saldo Awal ${hasil.no_proses}`,
      htmlBukti(hasil, pratinjau),
      'body{color:#111}',
    );
  }

  async function pulihkan() {
    if (!pulihNo || !pulihFile || pulihSibuk) return;
    setPulihSibuk(true);
    try {
      const buf = await pulihFile.arrayBuffer();
      const res = await fetch(`${BASE}/pulihkan`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', 'x-no-proses': pulihNo },
        body: buf,
      });
      const data = (await res.json().catch(() => null)) as { pesan?: string } | null;
      if (!res.ok) throw new Error(data?.pesan ?? `Terjadi kesalahan (HTTP ${res.status}).`);
      beritahu(`Proses ${pulihNo} dipulihkan — data riwayat dikembalikan dari backup.`, 'sukses');
      setPulihFile(null);
      setKunciInput((k) => k + 1);
      void muatDaftar();
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    } finally {
      setPulihSibuk(false);
    }
  }

  const tanggalValid = /^\d{4}-\d{2}-\d{2}$/.test(sampai);

  return (
    <div>
      {/* Indikator 4 langkah */}
      <ol className="pt-langkah" aria-label="Tahapan Proses Tahunan">
        {LANGKAH_LABEL.map((label, i) => {
          const no = i + 1;
          const aktif = langkah === no || (langkah === 5 && no === 4);
          const selesai = langkah > no || langkah === 5;
          return (
            <li
              key={label}
              className={`pt-langkah__item${aktif ? ' pt-langkah__item--aktif' : ''}${selesai ? ' pt-langkah__item--selesai' : ''}`}
            >
              <span className="pt-langkah__no">{selesai ? '✓' : no}</span>
              {label}
            </li>
          );
        })}
      </ol>

      {/* ---------------- Langkah 1 — Pilih Periode ---------------- */}
      {langkah === 1 && (
        <section className="pt-kartu">
          <h3>Langkah 1 — Pilih Periode</h3>
          <p className="pt-kartu__desk">
            Pilih toko/gudang dan batas tanggal. Riwayat transaksi s.d. tanggal itu yang akan dihapus; saldo
            berjalan otomatis menjadi Saldo Awal periode baru.
          </p>
          <div className="pt-baris-input">
            <div className="pt-field">
              <label htmlFor="pt-gudang">Toko / Gudang</label>
              <select id="pt-gudang" value={gudangId} onChange={(e) => setGudangId(e.target.value)}>
                <option value="">Semua Toko/Gudang</option>
                {opsiGudang.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="pt-field">
              <label htmlFor="pt-sampai">Hapus transaksi s.d. tanggal</label>
              <input
                id="pt-sampai"
                type="date"
                value={sampai}
                onChange={(e) => setSampai(e.target.value)}
                max={new Date().toISOString().slice(0, 10)}
              />
            </div>
          </div>

          {ringkas ? (
            <>
              <table className="pt-tabel">
                <thead>
                  <tr>
                    <th>Modul</th>
                    <th className="rata-kanan">Jumlah data dihapus</th>
                  </tr>
                </thead>
                <tbody>
                  {MODUL.map((m) => (
                    <tr key={m.k}>
                      <td>{m.label}</td>
                      <td className="rata-kanan">{formatAngka(ringkas.ringkas[m.k] ?? 0)}</td>
                    </tr>
                  ))}
                  <tr className="pt-total">
                    <td>Total</td>
                    <td className="rata-kanan">{formatAngka(ringkas.ringkas.total)}</td>
                  </tr>
                </tbody>
              </table>

              <div className={`pt-kotak ${ringkas.peringatan.length ? 'pt-kotak--waspada' : 'pt-kotak--sukses'}`}>
                <p>
                  <strong>Transaksi yang TIDAK ikut dihapus</strong> (belum selesai / belum lunas — tetap ada dan
                  terbawa ke periode baru):
                </p>
                {ringkas.peringatan.length ? (
                  <ul>
                    {ringkas.peringatan.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                ) : (
                  <p>Tidak ada transaksi tertahan pada periode ini.</p>
                )}
              </div>
            </>
          ) : (
            <p className="pt-status-cetak">{tanggalValid ? 'Menghitung ringkasan…' : 'Masukkan tanggal yang valid.'}</p>
          )}

          <div className="pt-aksi-kelompok">
            <button type="button" className="pt-aksi pt-aksi--primer" onClick={lanjutKe2} disabled={!ringkas}>
              <Icon nama="chevron-right" size={16} />
              <span>Lanjut</span>
            </button>
          </div>
        </section>
      )}

      {/* ---------------- Langkah 2 — Peringatan Backup (wajib) ---------------- */}
      {langkah === 2 && (
        <section className="pt-kartu">
          <h3>Langkah 2 — Backup Wajib Sebelum Melanjutkan</h3>
          <div className="pt-kotak pt-kotak--bahaya">
            <p>
              <strong>PERINGATAN: Data yang dihapus TIDAK DAPAT dikembalikan.</strong>
            </p>
            <p>Lakukan backup data terlebih dahulu sebelum melanjutkan.</p>
          </div>

          <p className="pt-kartu__desk">
            File backup berisi seluruh data pada periode terpilih (Penjualan, Pembelian, Retur, Persediaan Sub,
            Opname, Mutasi, Kartu Stok, Jurnal) dalam satu berkas .xlsx — juga dipakai oleh fitur
            &laquo;Pulihkan dari Backup&raquo; bila terjadi kesalahan.
          </p>

          <div className="pt-aksi-kelompok">
            <button type="button" className="pt-aksi" onClick={unduhBackup}>
              <Icon nama="download" size={16} />
              <span>Backup Sekarang</span>
            </button>
            <span className="pt-status-cetak">
              {sudahUnduh ? '✓ File backup sudah diunduh' : 'Belum ada file backup yang diunduh.'}
            </span>
          </div>

          <label className={`pt-centang${sudahUnduh ? '' : ' pt-centang--kunci'}`}>
            <input
              type="checkbox"
              checked={centang}
              disabled={!sudahUnduh}
              onChange={(e) => setCentang(e.target.checked)}
            />
            <span>Saya sudah menyimpan file backup di tempat yang aman.</span>
          </label>

          <div className="pt-aksi-kelompok">
            <button type="button" className="pt-aksi" onClick={() => setLangkah(1)}>
              <Icon nama="chevron-left" size={16} />
              <span>Kembali</span>
            </button>
            <button
              type="button"
              className="pt-aksi pt-aksi--primer"
              onClick={lanjutKe3}
              disabled={!sudahUnduh || !centang}
            >
              <Icon nama="chevron-right" size={16} />
              <span>Lanjut</span>
            </button>
            {(!sudahUnduh || !centang) && (
              <span className="pt-status-cetak">
                Kunci terbuka setelah backup diunduh <em>dan</em> centang konfirmasi diisi.
              </span>
            )}
          </div>
        </section>
      )}

      {/* ---------------- Langkah 3 — Konversi Saldo Awal ---------------- */}
      {langkah === 3 && (
        <section className="pt-kartu">
          <h3>Langkah 3 — Konversi Saldo Awal (Otomatis)</h3>
          <p className="pt-kartu__desk">
            Sebelum riwayat dihapus, sistem menghitung saldo akhir per {sampai} lalu menyimpannya sebagai Saldo
            Awal periode baru ({ringkas?.periodeBaruDari ?? ''}). Periksa tabel perbandingan — proses hanya boleh
            lanjut bila kedua sisi COCOK (selisih = 0).
          </p>

          {sibuk && !pratinjau && <p className="pt-status-cetak">Menghitung pratinjau saldo awal…</p>}

          {pratinjau && (
            <>
              <table className="pt-tabel">
                <thead>
                  <tr>
                    <th>Kategori</th>
                    <th className="rata-kanan">Saldo Akhir Sebelum</th>
                    <th className="rata-kanan">Saldo Awal Sesudah</th>
                    <th className="rata-kanan">Selisih</th>
                    <th>Keterangan</th>
                  </tr>
                </thead>
                <tbody>
                  {pratinjau.baris.map((b) => (
                    <tr key={b.kategori}>
                      <td>{b.kategori}</td>
                      <td className="rata-kanan">{formatRupiah(b.sebelum)}</td>
                      <td className="rata-kanan">
                        {formatRupiah(b.sesudah)} <span className="pt-label-saldo">Saldo Awal</span>
                      </td>
                      <td className={`rata-kanan ${Math.abs(b.selisih) > 1 ? 'pt-selisih-ada' : 'pt-selisih-nol'}`}>
                        {formatRupiah(b.selisih)}
                      </td>
                      <td>{b.alasan ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {pratinjau.catatan.length > 0 && (
                <div className="pt-kotak pt-kotak--waspada">
                  {pratinjau.catatan.map((c) => (
                    <p key={c}>{c}</p>
                  ))}
                </div>
              )}

              {!pratinjau.cocok && (
                <div className="pt-kotak pt-kotak--bahaya">
                  <p>
                    <strong>Selisih ditemukan — tombol Lanjut terkunci.</strong> Selesaikan penyebab berikut dulu:
                  </p>
                  <ul>
                    {pratinjau.penyebab.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </div>
              )}

              <details className="pt-rincian">
                <summary>Saldo Awal Stok — {formatAngka(pratinjau.rincian.stok.length)} produk/gudang</summary>
                <table className="pt-tabel">
                  <thead>
                    <tr>
                      <th>Produk</th>
                      <th>Gudang</th>
                      <th className="rata-kanan">Qty</th>
                      <th className="rata-kanan">Nilai</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pratinjau.rincian.stok.map((s) => (
                      <tr key={`${s.product_id}-${s.gudang}`}>
                        <td>{s.produk}</td>
                        <td>
                          {s.gudang} <span className="pt-label-saldo">Saldo Awal</span>
                        </td>
                        <td className="rata-kanan">{formatAngka(s.qty)}</td>
                        <td className="rata-kanan">{formatRupiah(s.nilai)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>

              <div className="pt-grid2">
                <details className="pt-rincian">
                  <summary>Saldo Awal Piutang — {formatAngka(pratinjau.rincian.piutang.length)} pelanggan</summary>
                  <table className="pt-tabel">
                    <thead>
                      <tr>
                        <th>Pelanggan</th>
                        <th className="rata-kanan">Sisa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pratinjau.rincian.piutang.map((s) => (
                        <tr key={s.pelanggan}>
                          <td>
                            {s.pelanggan} <span className="pt-label-saldo">Saldo Awal</span>
                          </td>
                          <td className="rata-kanan">{formatRupiah(s.sisa)}</td>
                        </tr>
                      ))}
                      {pratinjau.rincian.piutang.length === 0 && (
                        <tr>
                          <td colSpan={2} className="teks-redup">
                            Tidak ada piutang belum lunas.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </details>

                <details className="pt-rincian">
                  <summary>Saldo Awal Hutang — {formatAngka(pratinjau.rincian.hutang.length)} supplier</summary>
                  <table className="pt-tabel">
                    <thead>
                      <tr>
                        <th>Supplier</th>
                        <th className="rata-kanan">Sisa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pratinjau.rincian.hutang.map((s) => (
                        <tr key={s.supplier}>
                          <td>
                            {s.supplier} <span className="pt-label-saldo">Saldo Awal</span>
                          </td>
                          <td className="rata-kanan">{formatRupiah(s.sisa)}</td>
                        </tr>
                      ))}
                      {pratinjau.rincian.hutang.length === 0 && (
                        <tr>
                          <td colSpan={2} className="teks-redup">
                            Tidak ada hutang belum lunas.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </details>
              </div>

              <details className="pt-rincian">
                <summary>Saldo Awal Akun Akuntansi — {formatAngka(pratinjau.rincian.akun.length)} akun</summary>
                <table className="pt-tabel">
                  <thead>
                    <tr>
                      <th>Kode</th>
                      <th>Akun</th>
                      <th>Tipe</th>
                      <th className="rata-kanan">Saldo Akhir</th>
                      <th className="rata-kanan">Saldo Awal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pratinjau.rincian.akun.map((a) => (
                      <tr key={a.kode}>
                        <td>{a.kode}</td>
                        <td>
                          {a.nama}{' '}
                          {a.tipe !== 'pendapatan' && a.tipe !== 'beban' && a.sebelum !== 0 && (
                            <span className="pt-label-saldo">Saldo Awal</span>
                          )}
                        </td>
                        <td>{a.tipe}</td>
                        <td className="rata-kanan">{formatRupiah(a.sebelum)}</td>
                        <td className="rata-kanan">{formatRupiah(a.sesudah)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          )}

          <div className="pt-aksi-kelompok">
            <button
              type="button"
              className="pt-aksi"
              onClick={() => {
                setLangkah(2);
                setPratinjau(null);
              }}
            >
              <Icon nama="chevron-left" size={16} />
              <span>Kembali</span>
            </button>
            <button
              type="button"
              className="pt-aksi pt-aksi--primer"
              onClick={lanjutKe4}
              disabled={sibuk || !pratinjau || !pratinjau.cocok}
            >
              <Icon nama="chevron-right" size={16} />
              <span>Lanjut</span>
            </button>
            <button type="button" className="pt-aksi" onClick={() => void muatPratinjau()} disabled={sibuk}>
              <Icon nama="rotate-ccw" size={16} />
              <span>Hitung Ulang</span>
            </button>
          </div>
        </section>
      )}

      {/* ---------------- Langkah 4 — Konfirmasi Akhir ---------------- */}
      {langkah === 4 && (
        <section className="pt-kartu">
          <h3>Langkah 4 — Konfirmasi Akhir</h3>
          <div className="pt-kotak pt-kotak--bahaya">
            <p>
              <strong>
                {formatAngka(ringkas?.ringkas.total ?? 0)} data transaksi periode s.d. {sampai} akan dihapus
                permanen.
              </strong>{' '}
              Saldo akhir (stok, piutang, hutang, kas/bank, akun) menjadi Saldo Awal periode baru. Transaksi belum
              selesai tetap bertahan.
            </p>
          </div>

          <div className="pt-baris-input">
            <div className="pt-field">
              <label htmlFor="pt-kata">Ketik HAPUS (huruf kapital) untuk membuka kunci</label>
              <input id="pt-kata" value={kata} onChange={(e) => setKata(e.target.value)} autoComplete="off" placeholder="HAPUS" />
            </div>
            <div className="pt-field">
              <label htmlFor="pt-sandi">Masukkan ulang kata sandi</label>
              <input
                id="pt-sandi"
                type="password"
                value={sandi}
                onChange={(e) => setSandi(e.target.value)}
                autoComplete="current-password"
                placeholder="Kata sandi akun"
              />
            </div>
          </div>

          {progres && (
            <div>
              <div className="pt-progres" role="progressbar" aria-valuenow={progres.pct} aria-valuemin={0} aria-valuemax={100}>
                <div className="pt-progres__isi" style={{ width: `${progres.pct}%` }} />
              </div>
              <div className="pt-progres__catatan">{progres.teks}</div>
            </div>
          )}

          <div className="pt-aksi-kelompok">
            <button type="button" className="pt-aksi" onClick={() => setLangkah(3)} disabled={sibuk}>
              <Icon nama="chevron-left" size={16} />
              <span>Kembali</span>
            </button>
            <button
              type="button"
              className="pt-aksi pt-aksi--bahaya pt-aksi--besar"
              onClick={() => void jalankan()}
              disabled={kata !== 'HAPUS' || !sandi || sibuk}
            >
              <Icon nama="trash" size={17} />
              <span>Hapus Riwayat Transaksi</span>
            </button>
            {(kata !== 'HAPUS' || !sandi) && (
              <span className="pt-status-cetak">
                Tombol aktif setelah kata &laquo;HAPUS&raquo; dan kata sandi diisi.
              </span>
            )}
          </div>
        </section>
      )}

      {/* ---------------- Langkah 5 — Laporan Hasil ---------------- */}
      {langkah === 5 && hasil && (
        <section className="pt-kartu">
          <h3>Proses Selesai — {hasil.no_proses}</h3>
          <div className="pt-kotak pt-kotak--sukses">
            <p>
              Riwayat transaksi s.d. {hasil.sampai} berhasil dihapus. Saldo Awal berlaku sejak{' '}
              {hasil.periode_baru_dari}. Stok sebelum proses {formatAngka(hasil.stok.sebelum)} → sesudah{' '}
              {formatAngka(hasil.stok.sesudah)} {hasil.stok.sama ? '(SAMA ✓)' : '(PERIKSA!)'}.
            </p>
          </div>

          <div className="pt-grid2">
            <table className="pt-tabel">
              <thead>
                <tr>
                  <th>Data terhapus</th>
                  <th className="rata-kanan">Jumlah</th>
                </tr>
              </thead>
              <tbody>
                {MODUL.map((m) => (
                  <tr key={m.k}>
                    <td>{m.label}</td>
                    <td className="rata-kanan">{formatAngka(hasil.dihapus[m.k] ?? 0)}</td>
                  </tr>
                ))}
                <tr className="pt-total">
                  <td>Total</td>
                  <td className="rata-kanan">{formatAngka(hasil.dihapus.total)}</td>
                </tr>
              </tbody>
            </table>

            <table className="pt-tabel">
              <thead>
                <tr>
                  <th>Saldo Awal yang dibuat</th>
                  <th className="rata-kanan">Nilai</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Stok ({formatAngka(hasil.saldo_awal.produk)} produk/gudang)</td>
                  <td className="rata-kanan">{formatRupiah(hasil.saldo_awal.nilai_stok)}</td>
                </tr>
                <tr>
                  <td>Piutang</td>
                  <td className="rata-kanan">{formatRupiah(hasil.saldo_awal.piutang)}</td>
                </tr>
                <tr>
                  <td>Hutang</td>
                  <td className="rata-kanan">{formatRupiah(hasil.saldo_awal.hutang)}</td>
                </tr>
                <tr>
                  <td>Kas/Bank</td>
                  <td className="rata-kanan">{formatRupiah(hasil.saldo_awal.kasbank)}</td>
                </tr>
                <tr>
                  <td>Jurnal penutup / pembuka</td>
                  <td className="rata-kanan">
                    #{hasil.saldo_awal.id_jurnal_penutup || '—'} / #{hasil.saldo_awal.id_jurnal_pembuka || '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="pt-aksi-kelompok">
            <button type="button" className="pt-aksi" onClick={() => unduhBukti(hasil.id, hasil.no_proses)}>
              <Icon nama="file-down" size={16} />
              <span>Unduh Bukti Saldo Awal (Excel)</span>
            </button>
            <button type="button" className="pt-aksi" onClick={cetakBukti}>
              <Icon nama="printer" size={16} />
              <span>Cetak / PDF</span>
            </button>
            <button type="button" className="pt-aksi pt-aksi--primer" onClick={ulang}>
              <Icon nama="rotate-ccw" size={16} />
              <span>Proses Baru</span>
            </button>
          </div>
        </section>
      )}

      {/* ---------------- Riwayat & Pulihkan ---------------- */}
      <section className="pt-kartu">
        <h3>Log Proses Tahunan</h3>
        <p className="pt-kartu__desk">
          Setiap proses tercatat di Log Aktivitas (siapa, kapan, periode, jumlah data). Ekspor Bukti Saldo Awal
          per proses dari kolom aksi.
        </p>
        <table className="pt-tabel">
          <thead>
            <tr>
              <th>No. Proses</th>
              <th>Periode s.d.</th>
              <th>Saldo Awal sejak</th>
              <th>Toko/Gudang</th>
              <th>Oleh</th>
              <th>Waktu</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {daftar.length === 0 && (
              <tr>
                <td colSpan={8} className="teks-redup">
                  Belum ada Proses Tahunan yang dijalankan.
                </td>
              </tr>
            )}
            {daftar.map((d) => (
              <tr key={d.id}>
                <td>
                  <strong>{d.no_proses}</strong>
                </td>
                <td>{d.sampai}</td>
                <td>{d.periode_baru_dari}</td>
                <td>{d.gudang ?? 'Semua'}</td>
                <td>{d.pengguna ?? 'Administrator'}</td>
                <td>{formatTanggalWaktu(d.dibuat_pada)}</td>
                <td>{d.dipulihkan_pada ? `Dipulihkan ${formatTanggalWaktu(d.dipulihkan_pada)}` : 'Aktif'}</td>
                <td>
                  <button
                    type="button"
                    className="pt-aksi"
                    onClick={() => unduhBukti(d.id, d.no_proses)}
                    aria-label={`Unduh bukti ${d.no_proses}`}
                  >
                    <Icon nama="file-down" size={16} />
                    <span>Bukti</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="pt-kartu">
        <h3>Pulihkan dari Backup</h3>
        <p className="pt-kartu__desk">
          Bila terjadi kesalahan, impor kembali file backup .xlsx yang diunduh pada Langkah 2. Data riwayat,
          kartu stok, dan jurnal pada periode itu dikembalikan seperti semula. Hanya bisa memulihkan proses
          terakhir (belum dipulihkan).
        </p>
        <div className="pt-baris-input">
          <div className="pt-field">
            <label htmlFor="pt-pulih-no">Proses yang dipulihkan</label>
            <select id="pt-pulih-no" value={pulihNo} onChange={(e) => setPulihNo(e.target.value)}>
              <option value="">— Pilih no. proses —</option>
              {daftar.map((d) => (
                <option key={d.id} value={d.no_proses} disabled={Boolean(d.dipulihkan_pada)}>
                  {d.no_proses} — s.d. {d.sampai}
                  {d.dipulihkan_pada ? ' (sudah dipulihkan)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="pt-field">
            <label htmlFor="pt-pulih-file">File backup (.xlsx)</label>
            <input
              key={kunciInput}
              id="pt-pulih-file"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => setPulihFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>
        <div className="pt-aksi-kelompok">
          <button
            type="button"
            className="pt-aksi"
            onClick={() => void pulihkan()}
            disabled={!pulihNo || !pulihFile || pulihSibuk}
          >
            <Icon nama="upload" size={16} />
            <span>{pulihSibuk ? 'Memulihkan…' : 'Pulihkan dari Backup'}</span>
          </button>
        </div>
      </section>
    </div>
  );
}

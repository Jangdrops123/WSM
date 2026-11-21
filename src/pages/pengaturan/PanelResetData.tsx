import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { beritahu } from '../../components/crud/Toast';
import { apiGet, apiPost, unduhExcel } from '../../lib/api';
import { mintaSegarkanModul, useSegarkanModul } from '../../lib/segarkan';
import { formatAngka, formatTanggalPanjang } from '../../lib/format';
import { peranAktif } from '../../lib/pengguna';
import { useSesi } from '../../lib/sesi';
// Wizard 4 langkah: alur & tata letaknya sama dengan Proses Tahunan, jadi kelas
// `pt-*` dari proses-tahunan.css dipakai ulang (CSS global, sekali muat).
import './proses-tahunan.css';

/**
 * RESET DATA — Pengaturan ▸ Database & Backup. Hanya Admin utama (dicek di
 * server lewat header x-peran; panel tidak dirender untuk peran lain).
 *
 * Alur wajib 4 langkah (tidak boleh dilewati):
 *   1 Pilih jenis reset + ringkasan jumlah data per modul
 *   2 Peringatan merah + "Backup Sekarang" (unduh file) + centang konfirmasi
 *   3 Ketik "RESET" + masukkan ulang kata sandi Admin
 *   4 Progres penghapusan → laporan hasil, plus "Pulihkan dari Backup"
 * Setiap reset tercatat di Log Aktivitas (siapa, kapan, jenis reset).
 */

type Jenis = 'transaksi' | 'master' | 'total';

const JENIS_PILIHAN: { kode: Jenis; label: string; ket: string }[] = [
  {
    kode: 'transaksi',
    label: '1 · Reset Transaksi',
    ket: 'Hapus permanen seluruh riwayat transaksi (penjualan, pembelian, retur, Item Masuk/Keluar, Opname, transfer, mutasi stok, jurnal, kas) — termasuk transaksi yang sudah dibatalkan — lalu kembalikan stok fisik, nilai persediaan, dan kartu stok ke 0. Master Barang, pengguna, dan pengaturan tetap dipertahankan.',
  },
  {
    kode: 'master',
    label: '2 · Reset Transaksi + Master Data',
    ket: 'Semua isi Reset Transaksi, ditambah produk, kategori, pelanggan, pemasok, dan gudang. Pengguna dan pengaturan tetap.',
  },
  {
    kode: 'total',
    label: '3 · Reset Total',
    ket: 'Kembalikan aplikasi ke kondisi awal (data kosong). Hanya akun Admin utama yang dipertahankan, pengaturan kembali ke bawaan.',
  },
];

const LANGKAH_LABEL = ['Pilih Jenis Reset', 'Backup Wajib', 'Konfirmasi', 'Progres & Laporan'];

interface BarisModul {
  kode: string;
  label: string;
  jumlah: number;
}

interface Ringkasan {
  jenis: Jenis;
  label: string;
  ket: string;
  modul: BarisModul[];
  total: number;
  dipertahankan: string[];
}

interface Hasil {
  jenis: Jenis;
  label: string;
  waktu: string;
  modul: BarisModul[];
  total: number;
  nomor_urut: number;
  pengguna_dihapus: number;
  pengguna_dipertahankan: number;
  pengaturan: number;
  log_dihapus: number;
  cadangan_pengaman: string;
  dipertahankan: string[];
  dilewati: string[];
  pesan?: string;
}

interface BarisCadangan {
  nama: string;
  ukuran: number;
  waktu: string;
}

const TAHAPAN: [number, string][] = [
  [10, 'Menghapus detail transaksi (baris anak)…'],
  [30, 'Menghapus dokumen induk (penjualan, pembelian, mutasi stok)…'],
  [55, 'Menghapus log transaksi yang sudah dibatalkan…'],
  [68, 'Mengosongkan stok & kartu stok (kembali 0)…'],
  [80, 'Membersihkan master data & nomor urut dokumen…'],
  [90, 'Menyimpan log aktivitas…'],
];

interface ProdukTanpaTransaksi {
  id: number;
  nama: string;
  sku: string;
}

function teksTahap(pct: number): string {
  let teks = 'Memulai…';
  for (const [batas, t] of TAHAPAN) if (pct >= batas) teks = t;
  return teks;
}

/**
 * Buang cache KLIEN yang menyimpan snapshot data pra-reset (keranjang pindah
 * mode POS, cache daftar/pencarian bila ada). Preferensi tampilan & sesi login
 * sengaja TIDAK ikut dihapus.
 */
function bersihkanCacheKlien(): void {
  for (const simpanan of [window.localStorage, window.sessionStorage]) {
    try {
      const buang: string[] = [];
      for (let i = 0; i < simpanan.length; i++) {
        const kunci = simpanan.key(i);
        if (kunci && (kunci.startsWith('nusapos.cache') || kunci === 'nusapos.pindah-mode')) buang.push(kunci);
      }
      for (const kunci of buang) simpanan.removeItem(kunci);
    } catch {
      /* storage diblokir — abaikan */
    }
  }
}

export function PanelResetData() {
  const navigate = useNavigate();
  // Tidak ada modul login — peran aktif dipilih di Pengaturan. Server tetap
  // menolak selain Admin utama; panel ini hanya tidak ditampilkan.
  const [langkah, setLangkah] = useState(1);
  const [jenis, setJenis] = useState<Jenis>('transaksi');
  const [ringkas, setRingkas] = useState<Ringkasan | null>(null);
  const [segarkan, setSegarkan] = useState(0);

  const [sudahUnduh, setSudahUnduh] = useState(false);
  const [centang, setCentang] = useState(false);
  const [kata, setKata] = useState('');
  const [sandi, setSandi] = useState('');
  const [sibuk, setSibuk] = useState(false);
  const [progres, setProgres] = useState<{ pct: number; teks: string } | null>(null);
  const [hasil, setHasil] = useState<Hasil | null>(null);

  const [cadangan, setCadangan] = useState<BarisCadangan[]>([]);
  const [pulihNama, setPulihNama] = useState('');
  const [pulihKata, setPulihKata] = useState('');
  const [pulihFile, setPulihFile] = useState<File | null>(null);
  const [pulihSibuk, setPulihSibuk] = useState(false);
  const [kunciFile, setKunciFile] = useState(0);

  // Opsi terpisah — master produk non-aktif tanpa riwayat transaksi.
  const [tanpa, setTanpa] = useState<{ jumlah: number; produk: ProdukTanpaTransaksi[] } | null>(null);
  const [hapusKata, setHapusKata] = useState('');
  const [hapusSibuk, setHapusSibuk] = useState(false);

  const nomorReq = useRef(0);
  const timerProgres = useRef<number | null>(null);

  const muatCadangan = useCallback(async () => {
    try {
      const r = await apiGet<{ cadangan: BarisCadangan[] }>('/api/pengaturan/sistem/info');
      setCadangan(r.cadangan ?? []);
    } catch {
      setCadangan([]);
    }
  }, []);

  const muatTanpaTransaksi = useCallback(async () => {
    try {
      setTanpa(
        await apiGet<{ jumlah: number; produk: ProdukTanpaTransaksi[] }>(
          '/api/pengaturan/sistem/reset/master-tanpa-transaksi',
        ),
      );
    } catch {
      setTanpa(null);
    }
  }, []);

  useEffect(() => {
    void muatCadangan();
    void muatTanpaTransaksi();
  }, [muatCadangan, muatTanpaTransaksi]);
  // Tombol Refresh global di topbar: muat ulang daftar cadangan database.
  useSegarkanModul(muatCadangan);

  // Ringkasan langkah 1 — dihitung server sesuai jenis reset yang dipilih.
  useEffect(() => {
    if (langkah !== 1) return;
    const nomor = ++nomorReq.current;
    setRingkas(null);
    apiGet<Ringkasan>(`/api/pengaturan/sistem/reset/ringkasan?jenis=${jenis}`)
      .then((r) => {
        if (nomor === nomorReq.current) setRingkas(r);
      })
      .catch((e: Error) => beritahu(e.message, 'galat'));
  }, [jenis, langkah, segarkan]);

  useEffect(
    () => () => {
      if (timerProgres.current) window.clearInterval(timerProgres.current);
    },
    [],
  );

  /* ----------------------------- Langkah 2 ----------------------------- */

  async function backupSekarang() {
    try {
      const r = await apiPost<{ nama: string; pesan: string }>('/api/pengaturan/sistem/backup', {
        alasan: 'backup wajib sebelum Reset Data',
      });
      await unduhExcel(
        `/api/pengaturan/sistem/backup/unduh?nama=${encodeURIComponent(r.nama)}`,
        r.nama,
      );
      setSudahUnduh(true);
      beritahu(`File backup ${r.nama} sudah diunduh — simpan di tempat aman.`, 'sukses');
      void muatCadangan();
    } catch (e) {
      beritahu(e instanceof Error ? e.message : 'Gagal membuat cadangan.', 'galat');
    }
  }

  /* ----------------------------- Langkah 4 ----------------------------- */

  async function jalankan() {
    if (kata !== 'RESET' || !sandi || sibuk) return;
    setSibuk(true);
    setLangkah(4);
    setProgres({ pct: 6, teks: 'Memulai…' });
    timerProgres.current = window.setInterval(() => {
      setProgres((p) => {
        if (!p || p.pct >= 88) return p;
        const pct = Math.min(88, p.pct + 6);
        return { pct, teks: teksTahap(pct) };
      });
    }, 450);
    try {
      const r = await apiPost<Hasil>('/api/pengaturan/sistem/reset', {
        jenis,
        konfirmasi: kata,
        sandi,
      });
      setProgres({ pct: 100, teks: 'Selesai.' });
      setHasil(r);
      beritahu(r.pesan ?? `${r.label} selesai.`, 'sukses');
      // Invalidasi cache KLIEN: keranjang pindah-mode POS menyimpan snapshot
      // produk/stok sebelum reset — dibuang agar pencarian & keranjang memuat
      // ulang data master terbaru. Bus "segarkan modul" memicu fetch ulang pada
      // komponen yang sedang tampil (tanpa reload halaman / kehilangan hasil).
      bersihkanCacheKlien();
      mintaSegarkanModul();
      void muatCadangan();
      void muatTanpaTransaksi();
      // Kembali ke Dashboard dengan data yang sudah bersih; jeda singkat agar
      // toast sukses sempat terbaca.
      window.setTimeout(() => navigate('/', { replace: true }), 1200);
    } catch (e) {
      beritahu(e instanceof Error ? e.message : 'Reset gagal dijalankan.', 'galat');
      setProgres(null);
      setLangkah(3);
    } finally {
      if (timerProgres.current) window.clearInterval(timerProgres.current);
      timerProgres.current = null;
      setSibuk(false);
    }
  }

  /* ------------------ Hapus Master Produk Tanpa Transaksi ----------------- */

  async function hapusTanpaTransaksi() {
    if (hapusKata !== 'HAPUS' || hapusSibuk) return;
    setHapusSibuk(true);
    try {
      const r = await apiPost<{ pesan: string; produk: number }>(
        '/api/pengaturan/sistem/reset/master-tanpa-transaksi',
        { konfirmasi: hapusKata },
      );
      beritahu(r.pesan, 'sukses');
      setHapusKata('');
      await muatTanpaTransaksi();
    } catch (e) {
      beritahu(e instanceof Error ? e.message : 'Gagal menghapus master produk.', 'galat');
    } finally {
      setHapusSibuk(false);
    }
  }

  function ulang() {
    setLangkah(1);
    setHasil(null);
    setSudahUnduh(false);
    setCentang(false);
    setKata('');
    setSandi('');
    setProgres(null);
    setSegarkan((n) => n + 1);
    void muatTanpaTransaksi();
  }

  /* ------------------------ Pulihkan dari Backup ----------------------- */

  async function pulihkanCadangan() {
    if (!pulihNama || pulihKata !== 'PULIHKAN' || pulihSibuk) return;
    setPulihSibuk(true);
    try {
      const r = await apiPost<{ pesan: string }>('/api/pengaturan/sistem/pulihkan', {
        nama: pulihNama,
        konfirmasi: pulihKata,
      });
      beritahu(r.pesan, 'sukses');
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      beritahu(e instanceof Error ? e.message : 'Gagal memulihkan.', 'galat');
    } finally {
      setPulihSibuk(false);
    }
  }

  async function pulihkanFile() {
    if (!pulihFile || pulihKata !== 'PULIHKAN' || pulihSibuk) return;
    setPulihSibuk(true);
    try {
      const buf = await pulihFile.arrayBuffer();
      const res = await fetch(
        `/api/pengaturan/sistem/pulihkan/unggah?konfirmasi=${encodeURIComponent(pulihKata)}&nama=${encodeURIComponent(pulihFile.name)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream', 'x-peran': peranAktif() },
          body: buf,
        },
      );
      const data = (await res.json().catch(() => null)) as { pesan?: string } | null;
      if (!res.ok) throw new Error(data?.pesan ?? `Terjadi kesalahan (HTTP ${res.status}).`);
      beritahu(data?.pesan ?? 'Database dipulihkan dari file backup.', 'sukses');
      setPulihFile(null);
      setKunciFile((k) => k + 1);
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      beritahu(e instanceof Error ? e.message : 'Gagal memulihkan file.', 'galat');
    } finally {
      setPulihSibuk(false);
    }
  }

  // AX — Reset Data hanya penanda Top (sesi).
  if (useSesi().info?.pengguna.admin !== true) return null;

  const pilihan = JENIS_PILIHAN.find((j) => j.kode === jenis)!;
  const kunciTerbuka = sudahUnduh && centang;

  return (
    <div>
      {/* Indikator 4 langkah */}
      <ol className="pt-langkah" aria-label="Tahapan Reset Data">
        {LANGKAH_LABEL.map((label, i) => {
          const no = i + 1;
          const aktif = langkah === no;
          const selesai = langkah > no;
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

      {/* ---------------- Langkah 1 — pilih jenis + ringkasan ---------------- */}
      {langkah === 1 && (
        <section className="pt-kartu">
          <h3>Reset Data — Pilih Jenis Reset</h3>
          <p className="pt-kartu__desk">
            Reset menghapus data secara permanen dan tidak bisa dibatalkan tanpa file backup.
            Pilih cakupannya lebih dulu; ringkasan jumlah data per modul dihitung dari database
            aktif.
          </p>

          <div className="pt-pilih-jenis">
            {JENIS_PILIHAN.map((j) => (
              <label
                key={j.kode}
                className={`pt-pilih-jenis__kartu${jenis === j.kode ? ' pt-pilih-jenis__kartu--aktif' : ''}`}
              >
                <input
                  type="radio"
                  name="reset-jenis"
                  value={j.kode}
                  checked={jenis === j.kode}
                  onChange={() => setJenis(j.kode)}
                />
                <span>
                  <strong>{j.label}</strong>
                  <small>{j.ket}</small>
                </span>
              </label>
            ))}
          </div>

          {ringkas ? (
            <>
              <h4 className="teks-redup">Ringkasan data yang akan dihapus</h4>
              <table className="pt-tabel">
                <thead>
                  <tr>
                    <th>Modul</th>
                    <th className="rata-kanan">Jumlah data dihapus</th>
                  </tr>
                </thead>
                <tbody>
                  {ringkas.modul.map((m) => (
                    <tr key={m.kode}>
                      <td>{m.label}</td>
                      <td className="rata-kanan">{formatAngka(m.jumlah)}</td>
                    </tr>
                  ))}
                  <tr className="pt-total">
                    <td>Total</td>
                    <td className="rata-kanan">{formatAngka(ringkas.total)}</td>
                  </tr>
                </tbody>
              </table>

              <div className="pt-kotak pt-kotak--sukses">
                <p>
                  <strong>Tetap dipertahankan:</strong>
                </p>
                <ul>
                  {ringkas.dipertahankan.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </div>
            </>
          ) : (
            <p className="pt-status-cetak">Menghitung ringkasan data…</p>
          )}

          <div className="pt-kotak" style={{ marginTop: 16 }}>
            <p>
              <strong>Hapus Master Produk Tanpa Transaksi</strong>
            </p>
            <p>
              Produk non-aktif yang tidak lagi memiliki riwayat transaksi (penjualan, pembelian,
              inbound, mutasi stok, opname) dapat dihapus permanen tanpa mengganggu Master Barang
              yang masih dipakai. Master Barang aktif <em>tidak</em> ikut terhapus.
            </p>
            {tanpa ? (
              <p className="pt-status-cetak">
                {tanpa.jumlah > 0
                  ? `${formatAngka(tanpa.jumlah)} produk non-aktif tanpa transaksi siap dihapus.`
                  : 'Tidak ada produk non-aktif tanpa transaksi saat ini.'}
              </p>
            ) : (
              <p className="pt-status-cetak">Menghitung produk non-aktif…</p>
            )}
            <div className="pt-baris-input">
              <div className="pt-field">
                <label htmlFor="rs-hapus-kata">Ketik HAPUS (huruf kapital) untuk membuka kunci</label>
                <input
                  id="rs-hapus-kata"
                  value={hapusKata}
                  onChange={(e) => setHapusKata(e.target.value)}
                  autoComplete="off"
                  placeholder="HAPUS"
                />
              </div>
            </div>
            <div className="pt-aksi-kelompok">
              <button
                type="button"
                className="pt-aksi pt-aksi--bahaya"
                onClick={() => void hapusTanpaTransaksi()}
                disabled={hapusKata !== 'HAPUS' || hapusSibuk || !tanpa?.jumlah}
              >
                <Icon nama="trash" size={16} />
                <span>{hapusSibuk ? 'Menghapus…' : 'Hapus Master Produk Tanpa Transaksi'}</span>
              </button>
            </div>
          </div>

          <div className="pt-aksi-kelompok">
            <button
              type="button"
              className="pt-aksi pt-aksi--primer"
              onClick={() => setLangkah(2)}
              disabled={!ringkas}
            >
              <Icon nama="chevron-right" size={16} />
              <span>Lanjut</span>
            </button>
          </div>
        </section>
      )}

      {/* ---------------- Langkah 2 — backup wajib ---------------- */}
      {langkah === 2 && (
        <section className="pt-kartu">
          <h3>Langkah 2 — Backup Wajib Sebelum Melanjutkan</h3>
          <div className="pt-kotak pt-kotak--bahaya">
            <p>
              <strong>PERINGATAN: Data TIDAK DAPAT dikembalikan setelah reset dijalankan.</strong>
            </p>
            <p>
              Jenis reset: <strong>{pilihan.label}</strong>. {ringkas ? `${formatAngka(ringkas.total)} baris data` : 'Data'}{' '}
              akan dihapus permanen. Unduh file backup terlebih dahulu.
            </p>
          </div>

          <p className="pt-kartu__desk">
            Backup berisi seluruh isi database (satu berkas <code>.sql.gz</code>) dan dipakai oleh
            fitur &laquo;Pulihkan dari Backup&raquo; bila terjadi kesalahan.
          </p>

          <div className="pt-aksi-kelompok">
            <button type="button" className="pt-aksi" onClick={() => void backupSekarang()}>
              <Icon nama="download" size={16} />
              <span>Backup Sekarang</span>
            </button>
            <span className="pt-status-cetak">
              {sudahUnduh ? '✓ File backup sudah diunduh' : 'Belum ada file backup yang diunduh.'}
            </span>
          </div>

          <label className={`pt-centang${kunciTerbuka ? '' : ' pt-centang--kunci'}`}>
            <input
              type="checkbox"
              checked={centang}
              disabled={!sudahUnduh}
              onChange={(e) => setCentang(e.target.checked)}
            />
            <span>Saya sudah menyimpan backup</span>
          </label>

          <div className="pt-aksi-kelompok">
            <button type="button" className="pt-aksi" onClick={() => setLangkah(1)}>
              <Icon nama="chevron-left" size={16} />
              <span>Kembali</span>
            </button>
            <button
              type="button"
              className="pt-aksi pt-aksi--primer"
              onClick={() => setLangkah(3)}
              disabled={!kunciTerbuka}
            >
              <Icon nama="chevron-right" size={16} />
              <span>Lanjut</span>
            </button>
            {!kunciTerbuka && (
              <span className="pt-status-cetak">
                Tombol Lanjut terkunci sampai backup diunduh <em>dan</em> centang konfirmasi diisi.
              </span>
            )}
          </div>
        </section>
      )}

      {/* ---------------- Langkah 3 — konfirmasi akhir ---------------- */}
      {langkah === 3 && (
        <section className="pt-kartu">
          <h3>Langkah 3 — Konfirmasi Akhir</h3>
          <div className="pt-kotak pt-kotak--bahaya">
            <p>
              <strong>
                {pilihan.label} akan menghapus {ringkas ? formatAngka(ringkas.total) : 'seluruh'}{' '}
                baris data secara permanen.
              </strong>
            </p>
            <p>{pilihan.ket}</p>
          </div>

          <div className="pt-baris-input">
            <div className="pt-field">
              <label htmlFor="rs-kata">Ketik RESET (huruf kapital) untuk membuka kunci</label>
              <input
                id="rs-kata"
                value={kata}
                onChange={(e) => setKata(e.target.value)}
                autoComplete="off"
                placeholder="RESET"
              />
            </div>
            <div className="pt-field">
              <label htmlFor="rs-sandi">Masukkan ulang kata sandi Admin</label>
              <input
                id="rs-sandi"
                type="password"
                value={sandi}
                onChange={(e) => setSandi(e.target.value)}
                autoComplete="current-password"
                placeholder="Kata sandi Admin"
              />
            </div>
          </div>

          <div className="pt-aksi-kelompok">
            <button
              type="button"
              className="pt-aksi"
              onClick={() => setLangkah(2)}
              disabled={sibuk}
            >
              <Icon nama="chevron-left" size={16} />
              <span>Kembali</span>
            </button>
            <button
              type="button"
              className="pt-aksi pt-aksi--bahaya pt-aksi--besar"
              onClick={() => void jalankan()}
              disabled={kata !== 'RESET' || !sandi || sibuk}
            >
              <Icon nama="trash" size={17} />
              <span>{pilihan.label}</span>
            </button>
            {(kata !== 'RESET' || !sandi) && (
              <span className="pt-status-cetak">
                Tombol aktif setelah kata &laquo;RESET&raquo; dan kata sandi Admin diisi.
              </span>
            )}
          </div>
        </section>
      )}

      {/* ---------------- Langkah 4 — progres & laporan hasil ---------------- */}
      {langkah === 4 && (
        <section className="pt-kartu">
          <h3>{hasil ? `Reset Selesai — ${hasil.label}` : 'Menjalankan Reset…'}</h3>

          {progres && !hasil && (
            <div>
              <div
                className="pt-progres"
                role="progressbar"
                aria-valuenow={progres.pct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="pt-progres__isi" style={{ width: `${progres.pct}%` }} />
              </div>
              <div className="pt-progres__catatan">{progres.teks}</div>
            </div>
          )}

          {hasil && (
            <>
              <div className="pt-kotak pt-kotak--sukses">
                <p>
                  {hasil.label} selesai pukul {formatTanggalPanjang(hasil.waktu)}.{' '}
                  {formatAngka(hasil.total)} baris data diproses, nomor urut dokumen direset{' '}
                  {formatAngka(hasil.nomor_urut)} counter. Cadangan pengaman{' '}
                  <strong>{hasil.cadangan_pengaman}</strong> dibuat sebelum reset.
                </p>
              </div>

              <div className="pt-grid2">
                <table className="pt-tabel">
                  <thead>
                    <tr>
                      <th>Data yang dihapus</th>
                      <th className="rata-kanan">Jumlah</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hasil.modul.map((m) => (
                      <tr key={m.kode}>
                        <td>{m.label}</td>
                        <td className="rata-kanan">{formatAngka(m.jumlah)}</td>
                      </tr>
                    ))}
                    <tr className="pt-total">
                      <td>Total</td>
                      <td className="rata-kanan">{formatAngka(hasil.total)}</td>
                    </tr>
                  </tbody>
                </table>

                <table className="pt-tabel">
                  <thead>
                    <tr>
                      <th>Dampak lain</th>
                      <th className="rata-kanan">Jumlah</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Nomor urut dokumen direset</td>
                      <td className="rata-kanan">{formatAngka(hasil.nomor_urut)}</td>
                    </tr>
                    <tr>
                      <td>Pengguna dihapus</td>
                      <td className="rata-kanan">{formatAngka(hasil.pengguna_dihapus)}</td>
                    </tr>
                    <tr>
                      <td>Pengguna dipertahankan</td>
                      <td className="rata-kanan">{formatAngka(hasil.pengguna_dipertahankan)}</td>
                    </tr>
                    <tr>
                      <td>Pengaturan dikembalikan ke bawaan</td>
                      <td className="rata-kanan">{formatAngka(hasil.pengaturan)}</td>
                    </tr>
                    <tr>
                      <td>Baris Log Aktivitas lama dihapus</td>
                      <td className="rata-kanan">{formatAngka(hasil.log_dihapus)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="pt-kotak pt-kotak--sukses">
                <p>
                  <strong>Tetap dipertahankan:</strong>
                </p>
                <ul>
                  {hasil.dipertahankan.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </div>

              {hasil.dilewati.length > 0 && (
                <div className="pt-kotak pt-kotak--waspada">
                  <p>
                    <strong>Sebagian data tidak terhapus:</strong>
                  </p>
                  <ul>
                    {hasil.dilewati.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="pt-kartu__desk">
                Reset ini tercatat di Pengaturan &rsaquo; Log Aktivitas (siapa, kapan, jenis reset,
                jumlah data per modul).
              </p>
            </>
          )}

          <div className="pt-aksi-kelompok">
            <button type="button" className="pt-aksi pt-aksi--primer" onClick={ulang}>
              <Icon nama="rotate-ccw" size={16} />
              <span>Reset Baru</span>
            </button>
          </div>

          {/* ---------------- Pulihkan dari Backup ---------------- */}
          <h3 style={{ marginTop: 18 }}>Pulihkan dari Backup</h3>
          <p className="pt-kartu__desk">
            Bila terjadi kesalahan, pulihkan kembali isi database dari file cadangan (unduhan
            Langkah 2 / cadangan pengaman / berkas yang pernah Anda simpan). Pemulihan menimpa
            seluruh isi database aktif.
          </p>

          <div className="pt-baris-input">
            <div className="pt-field">
              <label htmlFor="rs-pulih-nama">Cadangan di server</label>
              <select
                id="rs-pulih-nama"
                value={pulihNama}
                onChange={(e) => setPulihNama(e.target.value)}
              >
                <option value="">— Pilih berkas cadangan —</option>
                {cadangan.map((c) => (
                  <option key={c.nama} value={c.nama}>
                    {c.nama} — {formatTanggalPanjang(c.waktu)}
                  </option>
                ))}
              </select>
            </div>
            <div className="pt-field">
              <label htmlFor="rs-pulih-file">Atau unggah file backup (.sql, .sql.gz, .dump, .tar)</label>
              <input
                key={kunciFile}
                id="rs-pulih-file"
                type="file"
                accept=".sql,.sql.gz,.dump,.tar"
                onChange={(e) => setPulihFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>

          <div className="pt-baris-input">
            <div className="pt-field">
              <label htmlFor="rs-pulih-kata">Ketik PULIHKAN (huruf kapital) untuk membuka kunci</label>
              <input
                id="rs-pulih-kata"
                value={pulihKata}
                onChange={(e) => setPulihKata(e.target.value)}
                autoComplete="off"
                placeholder="PULIHKAN"
              />
            </div>
          </div>

          <div className="pt-aksi-kelompok">
            <button
              type="button"
              className="pt-aksi"
              onClick={() => void pulihkanCadangan()}
              disabled={!pulihNama || pulihKata !== 'PULIHKAN' || pulihSibuk}
            >
              <Icon nama="rotate-ccw" size={16} />
              <span>{pulihSibuk ? 'Memulihkan…' : 'Pulihkan dari cadangan server'}</span>
            </button>
            <button
              type="button"
              className="pt-aksi"
              onClick={() => void pulihkanFile()}
              disabled={!pulihFile || pulihKata !== 'PULIHKAN' || pulihSibuk}
            >
              <Icon nama="upload" size={16} />
              <span>Pulihkan dari file yang diunggah</span>
            </button>
            {pulihKata !== 'PULIHKAN' && (
              <span className="pt-status-cetak">
                Tombol pulihkan aktif setelah kata &laquo;PULIHKAN&raquo; diisi.
              </span>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

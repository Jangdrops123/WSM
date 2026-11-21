// BAGIAN L — Wizard "Impor Excel" Opname (4 langkah).
//   1) pilih/buat sesi  2) unduh template / unggah file  3) validasi & pratinjau
//   4) konfirmasi: Simpan Draft atau Sahkan
// Memakai komponen impor bersama (gaya wiz-* dari impor-ekspor.css, tabel
// pratinjau memakai DataTable bersama: checkbox + banner + bar aksi massal).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { TombolScan } from '../../components/ScanKamera';
import { Modal } from '../../components/crud/Modal';
import { beritahu } from '../../components/crud/Toast';
import { DataTable, type BarisTabel } from '../../components/crud/DataTable';
import { ProgresMassal, type AksiMassalItem } from '../../components/crud/AksiMassal';
import { usePilihan } from '../../lib/pilihan';
import { ambilOpsi, apiGet, apiPost, unduhExcel } from '../../lib/api';
import { formatAngka, formatRupiah } from '../../lib/format';
import { useSesi } from '../../lib/sesi';
import { can } from '../../lib/hak';
import { peranAktif } from '../../lib/pengguna';
import '../master/impor-ekspor.css';
import './opname.css';

export interface BarisPratinjau {
  nomor: number;
  kode_input: string;
  product_id: number | null;
  kode_item: string | null;
  nama_produk: string;
  sku: string;
  lokasi: string;
  lokasi_id: number | null;
  qty_sistem: number;
  qty_sistem_file: number | null;
  qty_fisik: number | null;
  selisih: number | null;
  nilai_selisih: number;
  harga_beli: number;
  status: 'valid' | 'peringatan' | 'error';
  pesan: string[];
  keterangan: string;
}

interface Ringkasan {
  total: number;
  valid: number;
  peringatan: number;
  error: number;
  selisih_lebih: number;
  selisih_kurang: number;
  nilai_selisih: number;
  produk_tidak_ada: number;
  duplikat: number;
}

interface HasilValidasi {
  nama_file: string;
  batas_persen: number;
  ringkasan: Ringkasan;
  kolom_tak_dikenal: string[];
  baris: BarisPratinjau[];
}

type Opsi = { id: number; label: string };

/** Angka ala server (1.250 / 1,250 / 1250,5) → number | null. */
function angkaStok(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!s) return null;
  if (!/^[-+]?[\d.,\s]+$/.test(s)) return null;
  const x = s.replace(/\s/g, '');
  const akhir = (t: string) => {
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };
  if (/^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(x)) return akhir(x.replace(/\./g, '').replace(',', '.'));
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(x)) return akhir(x.replace(/,/g, ''));
  if (/^[-+]?\d+,\d+$/.test(x)) return akhir(x.replace(',', '.'));
  if (/^[-+]?\d+(\.\d+)?$/.test(x)) return akhir(x);
  return null;
}

/** Kirim JSON dengan progress bar unggah (XHR — fetch tak punya progress). */
function kirimBerprogres<T>(url: string, body: unknown, onPersen?: (p: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('content-type', 'application/json');
    xhr.setRequestHeader('x-peran', peranAktif());
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onPersen) onPersen(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* balasan bukan JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else {
        const pesan = (data as { pesan?: string } | null)?.pesan ?? `Terjadi kesalahan (HTTP ${xhr.status}).`;
        reject(new Error(pesan));
      }
    };
    xhr.onerror = () => reject(new Error('Koneksi terputus saat mengirim file.'));
    xhr.send(JSON.stringify(body));
  });
}

/** POST → unduh berkas (laporan error Excel). */
async function unduhPost(url: string, body: unknown, nama: string): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-peran': peranAktif() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gagal mengunduh (HTTP ${res.status}).`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = nama;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
}

function keBase64(file: File): Promise<string> {
  return file.arrayBuffer().then((buf) => {
    // Potongan 0x8000 — spread byte besar bisa melewati batas argumen fungsi.
    const u8 = new Uint8Array(buf);
    let biner = '';
    for (let i = 0; i < u8.length; i += 0x8000) {
      biner += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    }
    return btoa(biner);
  });
}

/** Klasifikasi pesan agar status bisa dihitung ulang saat baris diedit. */
const PESAN_GALAT = /^(Produk tidak ditemukan|Produk .* nonaktif|Gudang |Lokasi |stok_fisik)/;
const PESAN_UBAH = /^(stok_fisik|Selisih |Stok sistem 0)/;
const statusDari = (pesan: string[]): BarisPratinjau['status'] =>
  pesan.some((p) => PESAN_GALAT.test(p)) ? 'error' : pesan.length ? 'peringatan' : 'valid';

const LABEL_STATUS: Record<BarisPratinjau['status'], string> = {
  valid: 'Valid',
  peringatan: 'Peringatan',
  error: 'Error',
};
const KELAS_STATUS: Record<BarisPratinjau['status'], string> = {
  valid: 'opname-lencana--sesuai',
  peringatan: 'opname-lencana--belum',
  error: 'opname-lencana--galat',
};

export function DialogImporOpname({
  tutup,
  sesiAwal,
  selesai,
}: {
  tutup: () => void;
  /** Sesi draft yang sudah diketahui (dari halaman detail) — langkah 1 dilewati. */
  sesiAwal?: number | null;
  /** Dipanggil setelah impor tersimpan / sesi disahkan (untuk memuat ulang). */
  selesai: () => void;
}) {
  const navigate = useNavigate();
  const [langkah, setLangkah] = useState<1 | 2 | 3 | 4>(sesiAwal ? 2 : 1);
  const [sibuk, setSibuk] = useState(false);
  const [progres, setProgres] = useState<number | null>(null);

  // Langkah 1 — sesi
  const [sesiId, setSesiId] = useState<number | null>(sesiAwal ?? null);
  const [daftarSesi, setDaftarSesi] = useState<{ id: number; label: string }[]>([]);
  const [buatBaru, setBuatBaru] = useState(!sesiAwal);
  const [opsiGudang, setOpsiGudang] = useState<Opsi[]>([]);
  const [opsiLokasi, setOpsiLokasi] = useState<Opsi[]>([]);
  const [opsiPengguna, setOpsiPengguna] = useState<Opsi[]>([]);
  const [form, setForm] = useState({ gudang: '', lokasi: '', tanggal: '', penanggung: '', catatan: '' });

  // Langkah 2 — file
  const [file, setFile] = useState<File | null>(null);
  const [seret, setSeret] = useState(false);
  const inputFile = useRef<HTMLInputElement>(null);

  // Langkah 3 — hasil validasi & opsi
  const [hasil, setHasil] = useState<HasilValidasi | null>(null);
  const [baris, setBaris] = useState<BarisPratinjau[]>([]);
  const [filter, setFilter] = useState<'semua' | 'error' | 'peringatan' | 'selisih'>('semua');
  const [cari, setCari] = useState('');
  const [dilewati, setDilewati] = useState<Set<number>>(() => new Set());
  const [hanyaValid, setHanyaValid] = useState(true);
  const [duplikat, setDuplikat] = useState<'jumlahkan' | 'terakhir'>('jumlahkan');
  const [produkTidakAda, setProdukTidakAda] = useState<'abaikan' | 'nol'>('abaikan');
  const [modeGabung, setModeGabung] = useState<'timpa' | 'tambah'>('timpa');
  const pilihan = usePilihan([filter, cari]);

  // Autocomplete perbaikan baris error
  const [pemilih, setPemilih] = useState<{ id: number; sku: string; barcode: string | null; produk_nama: string }[]>([]);
  const pemilihDimuat = useRef(false);

  // Langkah 4 — hasil akhir
  const [akhir, setAkhir] = useState<null | {
    disesuaikan: number;
    sama: number;
    dilewati: number;
    sesiId: number;
    disahkan: boolean;
  }>(null);
  const sesiInfo = useSesi().info;
  // AX — Sahkan = sel Sahkan pada Opname.
  const bolehSahkan = can(sesiInfo, 'opname', 'sahkan');
  const [galat, setGalat] = useState('');
  /** Konteks sesi: gudang/lokasi/tahap — untuk validasi, template, dan impor. */
  const [konteks, setKonteks] = useState<{ warehouse_id: number; location_id: number | null; tahap: string } | null>(null);
  const [halPratinjau, setHalPratinjau] = useState(1);

  // --- Muat opsi dasar -----------------------------------------------------
  useEffect(() => {
    ambilOpsi('gudang').then(setOpsiGudang).catch(() => undefined);
    apiGet<{ data: { id: number; nama: string }[] }>('/api/opname/opsi-pengguna')
      .then((r) => setOpsiPengguna(r.data.map((u) => ({ id: Number(u.id), label: u.nama }))))
      .catch(() => undefined);
  }, []);

  // Lokasi mengikuti gudang terpilih (langkah 1 — buat sesi baru)
  useEffect(() => {
    setOpsiLokasi([]);
    if (!form.gudang) return;
    apiGet<{ data: { id: number; kode_lokasi: string }[] }>(`/api/master/lokasi?per=500&warehouse_id=${form.gudang}`)
      .then((r) => setOpsiLokasi(r.data.map((l) => ({ id: Number(l.id), label: l.kode_lokasi }))))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.gudang]);

  // Daftar sesi draft tahap hitung (langkah 1 — pilih sesi lama)
  useEffect(() => {
    if (sesiAwal || langkah !== 1) return;
    apiGet<{ data: Record<string, unknown>[] }>('/api/opname?hal=1&per=50&tahap=hitung')
      .then((r) =>
        setDaftarSesi(
          r.data.map((b) => ({ id: Number(b.id), label: `${String(b.no_dokumen)} — ${String(b.gudang_kode ?? '')}` })),
        ),
      )
      .catch(() => undefined);
  }, [langkah, sesiAwal]);

  // Konteks sesi (gudang, lokasi, tahap) begitu sesi diketahui
  useEffect(() => {
    if (!sesiId) {
      setKonteks(null);
      return;
    }
    let hidup = true;
    apiGet<{ data: Record<string, unknown> }>(`/api/opname/${sesiId}`)
      .then((r) => {
        if (!hidup) return;
        const d = r.data;
        setKonteks({
          warehouse_id: Number(d.warehouse_id),
          location_id: d.location_id === null || d.location_id === undefined ? null : Number(d.location_id),
          tahap: String(d.tahap ?? 'hitung'),
        });
      })
      .catch((e: Error) => {
        if (hidup) setGalat(e.message);
      });
    return () => {
      hidup = false;
    };
  }, [sesiId]);

  const gudangTemplate = konteks?.warehouse_id ?? (form.gudang ? Number(form.gudang) : null);
  const batasP = hasil?.batas_persen ?? 10;

  // --- Ringkasan hidup — dihitung dari data tabel, diperbarui saat diedit ---
  const ringkasHidup = useMemo(() => {
    let valid = 0;
    let peringatan = 0;
    let error = 0;
    let lebih = 0;
    let kurang = 0;
    let nilai = 0;
    for (const b of baris) {
      if (b.status === 'valid') valid++;
      else if (b.status === 'error') error++;
      else peringatan++;
      // Selisih & nilai hanya untuk baris yang sudah cocok produknya —
      // baris error “produk tidak ditemukan” tidak punya selisih berarti.
      if (b.product_id !== null && b.qty_fisik !== null) {
        const s = b.qty_fisik - b.qty_sistem;
        if (s > 0) lebih += s;
        else if (s < 0) kurang += -s;
        nilai += Math.abs(s) * (b.harga_beli || 0);
      }
    }
    return { valid, peringatan, error, lebih, kurang, nilai: Math.round(nilai) };
  }, [baris]);

  // --- Penyaringan & paginasi pratinjau (100 baris per halaman) ------------
  const tersaring = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return baris.filter((b) => {
      if (filter === 'error' && b.status !== 'error') return false;
      if (filter === 'peringatan' && b.status !== 'peringatan') return false;
      if (filter === 'selisih' && (b.qty_fisik === null || b.qty_fisik === b.qty_sistem)) return false;
      if (!q) return true;
      return (
        String(b.kode_item ?? '').toLowerCase().includes(q) ||
        b.sku.toLowerCase().includes(q) ||
        b.nama_produk.toLowerCase().includes(q) ||
        b.lokasi.toLowerCase().includes(q)
      );
    });
  }, [baris, filter, cari]);

  useEffect(() => setHalPratinjau(1), [filter, cari]);

  // Pratinjau: daftar produk untuk perbaikan inline dimuat sekali sejak awal
  // (fokus pada input autocomplete tetap memuat ulang bila gagal).
  useEffect(() => {
    if (langkah === 3) void bebanPemilih();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [langkah]);
  const totalHalPratinjau = Math.max(1, Math.ceil(tersaring.length / 100));
  const halamanIni = useMemo(() => {
    const h = Math.min(halPratinjau, totalHalPratinjau);
    return tersaring.slice((h - 1) * 100, h * 100);
  }, [tersaring, halPratinjau, totalHalPratinjau]);

  const errorSisa = useMemo(
    () => baris.filter((b) => b.status === 'error' && !dilewati.has(b.nomor)).length,
    [baris, dilewati],
  );

  /** Hitung ulang pesan yang tergantung qty (stok_fisik / selisih / batas %). */
  const klasifikasi = (b: BarisPratinjau): string[] => {
    const pesan = b.pesan.filter((p) => !PESAN_UBAH.test(p));
    const qty = b.qty_fisik;
    if (qty === null) {
      pesan.push('stok_fisik kosong — wajib diisi (boleh 0).');
      return pesan;
    }
    if (qty < 0) {
      pesan.push('stok_fisik negatif — harus ≥ 0.');
      return pesan;
    }
    const selisih = qty - b.qty_sistem;
    if (b.qty_sistem > 0) {
      const pct = (Math.abs(selisih) / b.qty_sistem) * 100;
      if (pct > batasP) pesan.push(`Selisih ${pct.toFixed(1)}% melebihi batas ${batasP}% (Pengaturan ▸ Opname).`);
    } else if (b.qty_sistem === 0 && qty > 0) {
      pesan.push('Stok sistem 0 tetapi stok fisik terisi — periksa kembali.');
    }
    return pesan;
  };

  const tutupBaris = (b: BarisPratinjau, pesan: string[]): BarisPratinjau => {
    const selisih = b.qty_fisik === null ? null : b.qty_fisik - b.qty_sistem;
    return {
      ...b,
      selisih,
      nilai_selisih: selisih === null ? 0 : Math.round(Math.abs(selisih) * (b.harga_beli || 0)),
      pesan,
      status: statusDari(pesan),
    };
  };

  /** Edit stok_fisik langsung di tabel — status dihitung ulang (L4). */
  const ubahQty = (nomor: number, teks: string) => {
    setBaris((prev) =>
      prev.map((b) => {
        if (b.nomor !== nomor) return b;
        if (teks.trim() === '') {
          const nb = { ...b, qty_fisik: null };
          return tutupBaris(nb, klasifikasi(nb));
        }
        const n = angkaStok(teks);
        if (n === null) {
          const pesan = [
            ...b.pesan.filter((p) => !PESAN_UBAH.test(p)),
            `stok_fisik bukan angka (${teks.slice(0, 20)}).`,
          ];
          return tutupBaris({ ...b, qty_fisik: null }, pesan);
        }
        const nb = { ...b, qty_fisik: n };
        return tutupBaris(nb, klasifikasi(nb));
      }),
    );
  };

  // --- Autocomplete produk untuk perbaikan inline ---------------------------
  const bebanPemilih = async () => {
    if (pemilihDimuat.current) return;
    pemilihDimuat.current = true;
    try {
      const r = await apiGet<{ data: { id: number; sku: string; barcode: string | null; produk_nama: string }[] }>(
        '/api/master/produk/pemilih?per=1000&aktif=1',
      );
      setPemilih(r.data);
    } catch {
      pemilihDimuat.current = false;
    }
  };

  /** Perbaikan inline baris error: pasangkan produk + ambil stok sistem terbaru. */
  const perbaikiProduk = async (nomor: number, kunci: string, bisu = false) => {
    const k = kunci.trim().toLowerCase();
    if (!k) return;
    const cocok = pemilih.find((p) => p.sku.toLowerCase() === k || (p.barcode ?? '').toLowerCase() === k);
    if (!cocok) {
      if (!bisu) beritahu(`Produk "${kunci}" tidak ditemukan — pilih dari daftar saran.`, 'galat');
      return;
    }
    try {
      const r = await apiPost<{ stok: Record<string, number> }>('/api/opname/impor/stok', {
        product_ids: [cocok.id],
        warehouse_id: konteks?.warehouse_id,
        sesi_id: sesiId,
      });
      const qtySistem = Number(r.stok[String(cocok.id)] ?? 0);
      setBaris((prev) =>
        prev.map((b) => {
          if (b.nomor !== nomor) return b;
          const nb: BarisPratinjau = {
            ...b,
            product_id: cocok.id,
            sku: cocok.sku,
            nama_produk: cocok.produk_nama,
            kode_item: cocok.sku,
            qty_sistem: qtySistem,
            pesan: b.pesan.filter((p) => !/^(Produk tidak ditemukan|Stok sistem berubah)/.test(p)),
          };
          return tutupBaris(nb, klasifikasi(nb));
        }),
      );
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    }
  };

  // --- Aksi massal pada pratinjau -------------------------------------------
  const aksiPratinjau: AksiMassalItem[] = [
    {
      kode: 'lewati',
      label: 'Keluarkan baris terpilih dari impor',
      ikon: 'close',
      bahaya: true,
      jalan: () => {
        setDilewati((d) => {
          const n = new Set(d);
          for (const b of baris) if (pilihan.terpilih.has(b.nomor)) n.add(b.nomor);
          return n;
        });
        pilihan.bersihkan();
      },
    },
    {
      kode: 'kembalikan',
      label: 'Kembalikan baris terpilih',
      ikon: 'rotate-ccw',
      jalan: () => {
        setDilewati((d) => {
          const n = new Set(d);
          for (const b of baris) if (pilihan.terpilih.has(b.nomor)) n.delete(b.nomor);
          return n;
        });
        pilihan.bersihkan();
      },
    },
    {
      kode: 'nol',
      label: 'Isi stok fisik = 0 untuk terpilih',
      jalan: () => {
        setBaris((prev) =>
          prev.map((b) => {
            if (!pilihan.terpilih.has(b.nomor)) return b;
            const nb = { ...b, qty_fisik: 0 };
            return tutupBaris(nb, klasifikasi(nb));
          }),
        );
        pilihan.bersihkan();
      },
    },
  ];

  // --- Navigasi langkah -----------------------------------------------------
  const lanjutLangkah1 = async () => {
    if (buatBaru) {
      if (!form.gudang) {
        beritahu('Pilih gudang terlebih dahulu.', 'galat');
        return;
      }
      setSibuk(true);
      try {
        const r = await apiPost<{ id: number }>('/api/opname', {
          warehouse_id: Number(form.gudang),
          location_id: form.lokasi ? Number(form.lokasi) : null,
          tanggal: form.tanggal || undefined,
          penanggung_jawab_id: form.penanggung ? Number(form.penanggung) : undefined,
          catatan: form.catatan || undefined,
        });
        setSesiId(r.id);
        setLangkah(2);
      } catch (e) {
        beritahu((e as Error).message, 'galat');
      } finally {
        setSibuk(false);
      }
    } else {
      if (!sesiId) {
        beritahu('Pilih sesi draft terlebih dahulu.', 'galat');
        return;
      }
      setLangkah(2);
    }
  };

  /** Unduh template (L2): berisi stok terkini (per gudang sesi) atau kosong. */
  const unduhTemplate = (isi: 'stok' | 'kosong') => {
    const q = new URLSearchParams({ isi });
    if (isi === 'stok') {
      if (!gudangTemplate) {
        beritahu('Tentukan gudang pada langkah 1 untuk template berisi stok.', 'galat');
        return;
      }
      q.set('gudang', String(gudangTemplate));
      if (konteks?.location_id) q.set('lokasi', String(konteks.location_id));
    }
    void unduhExcel(
      `/api/opname/template?${q.toString()}`,
      isi === 'stok' ? 'template-opname-stok-terkini.xlsx' : 'template-opname-kosong.xlsx',
    ).catch((e: Error) => beritahu(e.message, 'galat'));
  };

  /** Terima file → validasi di server → langkah 3. */
  const terimaFile = async (f: File) => {
    if (!/\.(xlsx|xls|csv)$/i.test(f.name)) {
      setGalat('Format file harus .xlsx, .xls, atau .csv.');
      return;
    }
    setGalat('');
    setFile(f);
    setSibuk(true);
    try {
      const base64 = await keBase64(f);
      const r = await apiPost<HasilValidasi>('/api/opname/impor/validasi', {
        nama_file: f.name,
        data_base64: base64,
        sesi_id: sesiId ?? undefined,
        warehouse_id: sesiId ? undefined : gudangTemplate ?? undefined,
        location_id: sesiId ? undefined : konteks?.location_id ?? undefined,
      });
      pilihan.bersihkan();
      setDilewati(new Set());
      setCari('');
      setFilter('semua');
      setHasil(r);
      setBaris(r.baris);
      setLangkah(3);
    } catch (e) {
      setGalat((e as Error).message);
      setFile(null);
    } finally {
      setSibuk(false);
    }
  };

  const unduhLaporanError = () => {
    const galatBaris = baris.filter((b) => b.status === 'error');
    if (!galatBaris.length) return;
    void unduhPost('/api/opname/impor/laporan-error', { baris: galatBaris }, 'laporan-error-opname.xlsx').catch(
      (e: Error) => beritahu(e.message, 'galat'),
    );
  };

  /** Kirim baris terpilih ke sesi (batch 500, satu transaksi di server). */
  const terapkan = async (): Promise<{ terisi: number; errorSisa: number } | null> => {
    if (!sesiId) return null;
    if (!hanyaValid && errorSisa > 0) {
      setGalat(
        `Ada ${errorSisa} baris error dan opsi "Hentikan jika ada error" aktif — perbaiki atau keluarkan baris tersebut.`,
      );
      return null;
    }
    const siap = baris
      .filter((b) => !dilewati.has(b.nomor) && b.status !== 'error')
      .map((b) => ({
        product_id: b.product_id,
        qty_fisik: b.qty_fisik,
        lokasi_id: b.lokasi_id,
        keterangan: b.keterangan || undefined,
      }));
    if (!siap.length) {
      setGalat('Tidak ada baris siap diimpor.');
      return null;
    }
    setGalat('');
    // Sesi tahap tinjau harus kembali ke hitung agar impor diterima server.
    if (konteks?.tahap === 'tinjau') {
      await apiPost(`/api/opname/${sesiId}/buka`, {});
      setKonteks((k) => (k ? { ...k, tahap: 'hitung' } : k));
    }
    const r = await kirimBerprogres<{ terisi: number; dilewati: number }>(`/api/opname/${sesiId}/impor`, {
      baris: siap,
      opsi: { mode: modeGabung, duplikat, produk_tidak_ada: produkTidakAda },
      nama_file: hasil?.nama_file ?? file?.name ?? 'impor.xlsx',
      data_base64: file ? await keBase64(file) : undefined,
      total_file: hasil?.ringkasan.total ?? siap.length,
      baris_error: errorSisa,
    }, setProgres);
    return { terisi: r.terisi, errorSisa };
  };

  const simpanDraft = async () => {
    setSibuk(true);
    try {
      const r = await terapkan();
      if (!r) return;
      beritahu(`Tersimpan sebagai draft — ${r.terisi} baris hitung diperbarui; sesi bisa dilanjutkan Manual/Scan.`, 'sukses');
      selesai();
      tutup();
    } catch (e) {
      setGalat((e as Error).message);
    } finally {
      setSibuk(false);
      setProgres(null);
    }
  };

  const sahkanImpor = async () => {
    setSibuk(true);
    try {
      const r = await terapkan();
      if (!r || !sesiId) return;
      // Ringkasan diambil dari respons /selesai (dihitung & jumlah selisih
      // tidak berubah setelah disahkan — respons /sahkan tidak memuatnya).
      const rSelesai = await apiPost<{
        ringkasan?: { jumlah?: number; dihitung?: number; selisih_lebih?: number; selisih_kurang?: number };
      }>(`/api/opname/${sesiId}/selesai`, {});
      const s = await apiPost<{
        penyesuaian: { jumlah_baris: number };
      }>(`/api/opname/${sesiId}/sahkan`, {});
      const rk = rSelesai.ringkasan ?? {};
      const selisihTotal = Number(rk.selisih_lebih ?? 0) + Number(rk.selisih_kurang ?? 0);
      setAkhir({
        disesuaikan: s.penyesuaian.jumlah_baris,
        sama: Math.max(0, Number(rk.dihitung ?? 0) - selisihTotal),
        dilewati: Math.max(0, Number(rk.jumlah ?? 0) - Number(rk.dihitung ?? 0)) + r.errorSisa,
        sesiId,
        disahkan: true,
      });
      setLangkah(4);
      selesai();
    } catch (e) {
      setGalat((e as Error).message);
    } finally {
      setSibuk(false);
      setProgres(null);
    }
  };

  // --- Baris & kepala tabel pratinjau (komponen tabel bersama) -------------
  const barisSiap = baris.filter((b) => !dilewati.has(b.nomor) && b.status !== 'error');
  const totSiap = barisSiap.reduce(
    (a, b) => {
      if (b.qty_fisik !== null) {
        const s = b.qty_fisik - b.qty_sistem;
        if (s > 0) a.lebih += s;
        else if (s < 0) a.kurang += -s;
        a.nilai += Math.abs(s) * (b.harga_beli || 0);
      }
      return a;
    },
    { lebih: 0, kurang: 0, nilai: 0 },
  );

  const kepalaPratinjau = (
    <>
      <th className="rata-kanan">No</th>
      <th>Kode Item</th>
      <th>Nama Produk</th>
      <th>Lokasi</th>
      <th className="rata-kanan">Stok Sistem</th>
      <th className="rata-kanan">Stok Fisik</th>
      <th className="rata-kanan">Selisih</th>
      <th className="rata-tengah">Status</th>
      <th>Pesan</th>
    </>
  );

  const fokusFisikBerikut = (indeks: number) => {
    // Hanya input stok_fisik (type=number) — input perbaikan produk ikut kelas
    // opname-input-fisik tapi tidak boleh menggeser urutan navigasi Enter.
    const semua = Array.from(document.querySelectorAll<HTMLInputElement>('.opname-input-fisik[type="number"]'));
    const berikut = semua[indeks + 1];
    if (berikut) {
      berikut.focus();
      berikut.select();
    }
  };

  const barisTabel: BarisTabel[] = halamanIni.map((b, idx) => {
    const keluar = dilewati.has(b.nomor);
    return {
      id: b.nomor,
      aria: `Baris ${b.nomor} ${b.nama_produk}`,
      kelas: keluar ? 'opname-baris-keluar' : b.status === 'error' ? 'opname-baris-error' : undefined,
      isi: [
        <td key={`n${b.nomor}`} className="rata-kanan">
          {b.nomor}
        </td>,
        <td key={`k${b.nomor}`}>
          {b.product_id !== null ? (
            <code>{b.kode_item ?? b.sku}</code>
          ) : (
            <input
              className="opname-input-fisik opname-input-perbaikan"
              style={{ width: 150 }}
              list="opname-saran-produk"
              defaultValue={b.kode_input}
              placeholder="Pilih produk…"
              onFocus={void bebanPemilih}
              onChange={(e) => void perbaikiProduk(b.nomor, e.target.value, true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void perbaikiProduk(b.nomor, e.currentTarget.value);
                }
              }}
              aria-label={`Perbaiki produk baris ${b.nomor}`}
            />
          )}
        </td>,
        <td key={`p${b.nomor}`}>{b.nama_produk}</td>,
        <td key={`l${b.nomor}`} className="teks-kecil pos-td-lokasi">
          {b.lokasi || '—'}
        </td>,
        <td key={`s${b.nomor}`} className="rata-kanan">
          {formatAngka(b.qty_sistem)}
        </td>,
        <td key={`f${b.nomor}`} className="rata-kanan">
          <input
            className="opname-input-fisik"
            type="number"
            min={0}
            step="any"
            inputMode="numeric"
            value={b.qty_fisik ?? ''}
            placeholder="—"
            disabled={keluar}
            onChange={(e) => ubahQty(b.nomor, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                fokusFisikBerikut(idx);
              } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                const kini = Number(e.currentTarget.value) || 0;
                ubahQty(b.nomor, String(Math.max(0, kini + (e.key === 'ArrowUp' ? 1 : -1))));
              }
            }}
            aria-label={`Stok fisik baris ${b.nomor}`}
          />
        </td>,
        <td
          key={`d${b.nomor}`}
          className={`rata-kanan ${b.selisih === null || b.selisih === 0 ? '' : b.selisih > 0 ? 'opname-lebih' : 'opname-kurang'}`}
        >
          {b.selisih === null
            ? '—'
            : b.selisih > 0
              ? `↑ +${formatAngka(b.selisih)}`
              : b.selisih < 0
                ? `↓ ${formatAngka(b.selisih)}`
                : formatAngka(0)}
        </td>,
        <td key={`t${b.nomor}`} className="rata-tengah">
          <span className={`opname-lencana ${KELAS_STATUS[b.status]}`}>{LABEL_STATUS[b.status]}</span>
          {keluar && <span className="opname-lencana opname-lencana--keluar">Dikeluarkan</span>}
        </td>,
        <td key={`m${b.nomor}`} className="teks-kecil teks-redup">
          {b.pesan.length ? b.pesan.join(' ') : '—'}
        </td>,
      ],
    };
  });

  const LANGKAH_NAMA = ['Pilih Sesi', 'Template & Unggah', 'Validasi & Pratinjau', 'Konfirmasi'];

  // --- Isi per langkah ------------------------------------------------------
  let isi: ReactNode = null;

  if (langkah === 1) {
    isi = (
      <>
        <div className="wiz-opsi">
          <label>
            <input type="radio" name="tujuan" checked={!buatBaru} onChange={() => setBuatBaru(false)} />
            <span>Impor ke sesi draft yang sudah ada (tahap penghitungan)</span>
          </label>
          <label>
            <input type="radio" name="tujuan" checked={buatBaru} onChange={() => setBuatBaru(true)} />
            <span>Buat sesi opname baru — stok sistem difoto (snapshot) saat dibuat</span>
          </label>
        </div>

        {!buatBaru ? (
          <label className="bidang" style={{ marginTop: 12 }}>
            <span>Sesi draft</span>
            <select
              value={sesiId ?? ''}
              onChange={(e) => setSesiId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">— Pilih sesi —</option>
              {daftarSesi.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            {daftarSesi.length === 0 && (
              <small className="teks-redup">Belum ada sesi draft tahap hitung — buat sesi baru di bawah.</small>
            )}
          </label>
        ) : (
          <div className="form-grid" style={{ marginTop: 12 }}>
            <label className="bidang">
              <span>Gudang *</span>
              <select value={form.gudang} onChange={(e) => setForm({ ...form, gudang: e.target.value, lokasi: '' })}>
                <option value="">— Pilih —</option>
                {opsiGudang.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="bidang">
              <span>Lokasi / rak (opsional — kosong = seluruh gudang)</span>
              <select value={form.lokasi} onChange={(e) => setForm({ ...form, lokasi: e.target.value })} disabled={!form.gudang}>
                <option value="">Seluruh gudang</option>
                {opsiLokasi.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
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
                {opsiPengguna.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="bidang bidang--lebar">
              <span>Keterangan (opsional)</span>
              <input
                type="text"
                value={form.catatan}
                onChange={(e) => setForm({ ...form, catatan: e.target.value })}
                placeholder="mis. Opname akhir bulan gudang pusat"
                maxLength={1000}
              />
            </label>
          </div>
        )}
        <p className="teks-redup teks-kecil" style={{ marginTop: 12 }}>
          Snapshot stok sistem dibekukan saat sesi dibuat/dipilih — selisih dihitung dari snapshot ini, bukan dari
          kolom stok_sistem di file.
        </p>
      </>
    );
  } else if (langkah === 2) {
    isi = (
      <>
        <div className="wiz-panel__blok" style={{ marginBottom: 12 }}>
          <h5>1. Unduh template</h5>
          <p className="teks-redup teks-kecil" style={{ margin: '0 0 8px' }}>
            Template selalu mengikuti kolom terbaru: kode_item · sku · barcode · nama_produk · satuan · gudang ·
            lokasi · stok_sistem (terkunci) · stok_fisik (diisi) · selisih (rumus) · keterangan.
          </p>
          <div className="tombol-baris">
            <button
              type="button"
              className="tombol tombol--netral tombol--kecil"
              disabled={!gudangTemplate}
              title={gudangTemplate ? 'Isi otomatis semua produk gudang terpilih' : 'Pilih gudang dulu'}
              onClick={() => unduhTemplate('stok')}
            >
              <Icon nama="file-down" size={15} /> Template berisi stok saat ini
            </button>
            <button
              type="button"
              className="tombol tombol--netral tombol--kecil"
              title="Template kosong dengan 3 baris contoh"
              onClick={() => unduhTemplate('kosong')}
            >
              <Icon nama="file-down" size={15} /> Template kosong (3 baris contoh)
            </button>
          </div>
        </div>

        <h5>2. Unggah file terisi</h5>
        <div
          className={`wiz-unggah${file ? ' wiz-unggah--aktif' : ''}${seret ? ' wiz-unggah--aktif' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => inputFile.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              inputFile.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setSeret(true);
          }}
          onDragLeave={() => setSeret(false)}
          onDrop={(e) => {
            e.preventDefault();
            setSeret(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void terimaFile(f);
          }}
        >
          <div className="wiz-unggah__ikon">
            <Icon nama="upload" size={26} />
          </div>
          <h4>{file ? 'Ganti file' : 'Seret file ke sini atau klik untuk memilih'}</h4>
          <p>Mendukung berkas .xlsx, .xls, dan .csv — baris pertama = judul kolom.</p>
          {file && (
            <div className="wiz-unggah__file">
              <Icon nama="file-down" size={14} />
              {file.name}
            </div>
          )}
        </div>
        <p className="teks-redup teks-kecil">
          Setelah file dipilih, sistem memvalidasi & menampilkan pratinjau. <strong>Tidak ada stok yang berubah</strong>{' '}
          sampai Anda menekan Simpan Draft / Sahkan.
        </p>
      </>
    );
  } else if (langkah === 3) {
    const kolomAneh = hasil?.kolom_tak_dikenal ?? [];
    isi = (
      <>
        {/* Ringkasan L4 — dihitung ulang real-time saat stok_fisik diedit */}
        <div className="opname-ringkas" style={{ marginTop: 0 }}>
          <span className="kartu-ringkas">
            Total baris: <strong>{formatAngka(hasil?.ringkasan.total ?? 0)}</strong>
          </span>
          <span className="kartu-ringkas">
            Valid: <strong className="teks-sukses">{formatAngka(ringkasHidup.valid)}</strong>
          </span>
          <span className="kartu-ringkas">
            Peringatan: <strong style={{ color: 'var(--warning)' }}>{formatAngka(ringkasHidup.peringatan)}</strong>
          </span>
          <span className="kartu-ringkas">
            Error: <strong className="teks-galat">{formatAngka(ringkasHidup.error)}</strong>
          </span>
          <span className="kartu-ringkas">
            Selisih: <strong style={{ color: 'var(--success)' }}>+{formatAngka(ringkasHidup.lebih)}</strong>
            {' / '}
            <strong className="teks-galat">−{formatAngka(ringkasHidup.kurang)}</strong>
          </span>
          <span className="kartu-ringkas">
            Nilai selisih: <strong>{formatRupiah(ringkasHidup.nilai)}</strong>
          </span>
        </div>

        {kolomAneh.length > 0 && (
          <div className="wiz-banner wiz-banner--peringatan">
            <Icon nama="close" size={16} />
            <span>
              Kolom tak dikenal diabaikan: <strong>{kolomAneh.join(', ')}</strong>.
            </span>
          </div>
        )}
        {!hanyaValid && errorSisa > 0 && (
          <div className="wiz-banner wiz-banner--galat">
            <Icon nama="close" size={16} />
            <span>
              Ada <strong>{errorSisa} baris error</strong> dan opsi <strong>Hentikan jika ada error</strong> aktif —
              perbaiki barisnya (edit stok_fisik / pilih produk) atau keluarkan dari impor.
            </span>
          </div>
        )}

        {/* Alat: cari + filter status + laporan error */}
        <div className="alat-tabel">
          <div className="cari-scan">
          <input
            className="input-cari"
            type="search"
            placeholder="Cari kode item / SKU / nama / lokasi…"
            value={cari}
            onChange={(e) => setCari(e.target.value)}
          />
          <TombolScan onHasil={setCari} />
          </div>
          {([
            ['semua', 'Semua'],
            ['error', 'Error'],
            ['peringatan', 'Peringatan'],
            ['selisih', 'Ada selisih'],
          ] as const).map(([nilai, label]) => (
            <button
              key={nilai}
              type="button"
              className={`tombol tombol--kecil ${filter === nilai ? '' : 'tombol--netral'}`}
              aria-pressed={filter === nilai}
              onClick={() => setFilter(nilai)}
            >
              {label}
            </button>
          ))}
          <IconButton
            ikon="file-down"
            label="Unduh laporan error (Excel)"
            ukuran="toolbar"
            disabled={ringkasHidup.error === 0}
            onClick={unduhLaporanError}
          />
        </div>

        <datalist id="opname-saran-produk">
          {pemilih.map((p) => (
            <option key={p.id} value={p.sku}>
              {p.produk_nama}
              {p.barcode ? ` · ${p.barcode}` : ''}
            </option>
          ))}
        </datalist>

        <DataTable
          pilihan={pilihan}
          idsHalaman={halamanIni.map((b) => b.nomor)}
          label="baris"
          total={tersaring.length}
          onPilihSemua={() => pilihan.pilihFilter(tersaring.map((b) => b.nomor))}
          kepala={kepalaPratinjau}
          baris={barisTabel}
          colSpan={10}
          kosong={tersaring.length === 0 ? 'Tidak ada baris yang cocok dengan filter.' : 'Memuat…'}
          aksiBar={aksiPratinjau}
        />

        <div className="paginasi">
          <span className="teks-redup teks-kecil">
            Hal {Math.min(halPratinjau, totalHalPratinjau)} dari {totalHalPratinjau} · {tersaring.length} baris
          </span>
          <div className="paginasi__kontrol">
            <button
              type="button"
              className="tombol tombol--kecil"
              disabled={halPratinjau <= 1}
              onClick={() => setHalPratinjau((h) => Math.max(1, h - 1))}
            >
              ‹ Sebelumnya
            </button>
            <button
              type="button"
              className="tombol tombol--kecil"
              disabled={halPratinjau >= totalHalPratinjau}
              onClick={() => setHalPratinjau((h) => h + 1)}
            >
              Berikutnya ›
            </button>
          </div>
        </div>
      </>
    );
  } else if (langkah === 4 && akhir) {
    isi = (
      <div className="wiz-selesai">
        <div className="wiz-selesai__ikon">
          <Icon nama="circle-check" size={32} />
        </div>
        <h4>Opname disahkan</h4>
        <p>
          <strong>{formatAngka(akhir.disesuaikan)}</strong> produk disesuaikan,{' '}
          <strong>{formatAngka(akhir.sama)}</strong> sama, <strong>{formatAngka(akhir.dilewati)}</strong> dilewati.
        </p>
        <div className="wiz-selesai__angka">
          <div>
            <strong className="teks-sukses">{formatAngka(akhir.disesuaikan)}</strong>
            <span>Disesuaikan</span>
          </div>
          <div>
            <strong>{formatAngka(akhir.sama)}</strong>
            <span>Sama</span>
          </div>
          <div>
            <strong className="teks-galat">{formatAngka(akhir.dilewati)}</strong>
            <span>Dilewati</span>
          </div>
        </div>
        <p className="teks-redup teks-kecil">
          Stok disesuaikan lewat kartu stok &amp; jurnal penyesuaian — unduh Berita Acara Opname sebagai bukti.
        </p>
      </div>
    );
  } else {
    // Langkah 4 — konfirmasi (menyebut jumlah produk & total selisih)
    isi = (
      <>
        <div className="opname-ringkas" style={{ marginTop: 0 }}>
          <span className="kartu-ringkas">
            Produk diproses: <strong>{formatAngka(barisSiap.length)}</strong>
          </span>
          <span className="kartu-ringkas">
            Selisih lebih: <strong style={{ color: 'var(--success)' }}>+{formatAngka(totSiap.lebih)}</strong>
          </span>
          <span className="kartu-ringkas">
            Selisih kurang: <strong className="teks-galat">−{formatAngka(totSiap.kurang)}</strong>
          </span>
          <span className="kartu-ringkas">
            Nilai selisih: <strong>{formatRupiah(totSiap.nilai)}</strong>
          </span>
          <span className="kartu-ringkas">
            Dilewati: <strong>{formatAngka(dilewati.size + errorSisa)}</strong>
          </span>
        </div>

        <h4 className="bagian-judul">Gabung dengan data sesi (Manual / Scan)</h4>
        <div className="wiz-opsi">
          <label>
            <input type="radio" name="mode-gabung" checked={modeGabung === 'timpa'} onChange={() => setModeGabung('timpa')} />
            <span>Timpa — hasil impor menimpa nilai manual/scan yang sudah ada (impor ulang).</span>
          </label>
          <label>
            <input type="radio" name="mode-gabung" checked={modeGabung === 'tambah'} onChange={() => setModeGabung('tambah')} />
            <span>Tambahkan — baris yang sudah dihitung tidak diubah; hanya baris kosong yang diisi.</span>
          </label>
        </div>

        {progres !== null && (
          <ProgresMassal
            nilai={progres}
            keterangan={progres >= 100 ? 'Memproses di server… (batch 500 baris per transaksi)' : `Mengunggah… ${progres}%`}
          />
        )}

        {bolehSahkan ? (
          <div className="wiz-panel__blok" style={{ marginTop: 14 }}>
            <h5>Sahkan sekarang</h5>
            <p className="teks-redup teks-kecil" style={{ margin: '0 0 8px' }}>
              Akan menyesuaikan <strong>{formatAngka(barisSiap.length)} produk</strong> dengan total selisih{' '}
              <strong>+{formatAngka(totSiap.lebih)}</strong> / <strong>−{formatAngka(totSiap.kurang)}</strong> (nilai{' '}
              {formatRupiah(totSiap.nilai)}) — kartu stok &amp; jurnal penyesuaian dibuat otomatis, sesi terkunci.
            </p>
          </div>
        ) : (
          <div className="wiz-banner wiz-banner--peringatan" style={{ marginTop: 14 }}>
            <Icon nama="close" size={16} />
            <span>
              Peran Anda belum memiliki izin Sahkan Opname. Simpan sebagai <strong>Draft</strong>, lalu sahkan dari halaman sesi.
            </span>
          </div>
        )}
      </>
    );
  }

  // --- Panel kanan: info file + opsi impor ---------------------------------
  const panelKanan = (
    <aside className="wiz-panel">
      <div className="wiz-panel__blok">
        <h5>Info file</h5>
        {file ? (
          <>
            <div className="wiz-panel__baris">
              <span>Nama</span>
              <span>{hasil?.nama_file ?? file.name}</span>
            </div>
            <div className="wiz-panel__baris">
              <span>Baris data</span>
              <span>{formatAngka(hasil?.ringkasan.total ?? 0)}</span>
            </div>
            <div className="wiz-panel__baris">
              <span>Batas selisih</span>
              <span>{batasP}%</span>
            </div>
            <div className="wiz-panel__baris">
              <span>Sesi</span>
              <span>#{sesiId ?? '—'}</span>
            </div>
          </>
        ) : (
          <p className="teks-redup teks-kecil" style={{ margin: 0 }}>
            Belum ada file dipilih.
          </p>
        )}
      </div>

      {langkah === 3 && (
        <>
          <div className="wiz-panel__blok">
            <h5>Baris dengan error</h5>
            <div className="wiz-opsi">
              <label>
                <input type="radio" name="opsi-error" checked={hanyaValid} onChange={() => setHanyaValid(true)} />
                <span>Hanya impor baris valid</span>
              </label>
              <label>
                <input type="radio" name="opsi-error" checked={!hanyaValid} onChange={() => setHanyaValid(false)} />
                <span>Hentikan jika ada error</span>
              </label>
            </div>
          </div>

          {(hasil?.ringkasan.duplikat ?? 0) > 0 && (
            <div className="wiz-panel__blok">
              <h5>Baris duplikat ({formatAngka(hasil!.ringkasan.duplikat)})</h5>
              <div className="wiz-opsi">
                <label>
                  <input type="radio" name="opsi-dup" checked={duplikat === 'jumlahkan'} onChange={() => setDuplikat('jumlahkan')} />
                  <span>Jumlahkan qty baris kembar</span>
                </label>
                <label>
                  <input type="radio" name="opsi-dup" checked={duplikat === 'terakhir'} onChange={() => setDuplikat('terakhir')} />
                  <span>Pakai baris terakhir</span>
                </label>
              </div>
            </div>
          )}

          {(hasil?.ringkasan.produk_tidak_ada ?? 0) > 0 && (
            <div className="wiz-panel__blok">
              <h5>Produk tidak ada di file ({formatAngka(hasil!.ringkasan.produk_tidak_ada)})</h5>
              <div className="wiz-opsi">
                <label>
                  <input type="radio" name="opsi-kosong" checked={produkTidakAda === 'abaikan'} onChange={() => setProdukTidakAda('abaikan')} />
                  <span>Abaikan — tidak dihitung</span>
                </label>
                <label>
                  <input type="radio" name="opsi-kosong" checked={produkTidakAda === 'nol'} onChange={() => setProdukTidakAda('nol')} />
                  <span>Anggap 0 — stok fisik 0</span>
                </label>
              </div>
            </div>
          )}
        </>
      )}
    </aside>
  );

  // --- Footer (aksi per langkah) --------------------------------------------
  const aksi: ReactNode =
    langkah === 4 ? (
      akhir ? (
        <>
          <button
            type="button"
            className="tombol tombol--netral"
            onClick={() => {
              tutup();
              navigate(`/stok/opname/${akhir.sesiId}?cetak=acara`);
            }}
          >
            <Icon nama="file-down" size={15} /> Unduh Berita Acara Opname
          </button>
          <button
            type="button"
            className="tombol tombol--primer"
            onClick={() => {
              tutup();
              navigate(`/stok/opname/${akhir.sesiId}`);
            }}
          >
            Buka dokumen opname
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="tombol tombol--netral"
            disabled={sibuk}
            onClick={() => setLangkah(3)}
          >
            <Icon nama="chevron-left" size={15} /> Kembali
          </button>
          <button
            type="button"
            className="tombol tombol--netral"
            disabled={sibuk || progres !== null || barisSiap.length === 0}
            onClick={() => void simpanDraft()}
          >
            Simpan sebagai Draft
          </button>
          <button
            type="button"
            className="tombol tombol--primer"
            disabled={sibuk || progres !== null || !bolehSahkan}
            onClick={() => void sahkanImpor()}
          >
            {sibuk ? 'Memproses…' : 'Sahkan & Terapkan'}
          </button>
        </>
      )
    ) : (
      <>
        <span className="teks-redup teks-kecil">{file?.name ?? 'Belum ada file'}</span>
        <button type="button" className="tombol tombol--netral" disabled={sibuk} onClick={tutup}>
          Batal
        </button>
        {langkah > 1 && !(langkah === 2 && sesiAwal) && (
          <button
            type="button"
            className="tombol tombol--netral"
            disabled={sibuk}
            onClick={() => setLangkah(langkah === 3 ? 2 : 1)}
          >
            <Icon nama="chevron-left" size={15} /> Kembali
          </button>
        )}
        {langkah === 1 && (
          <button type="button" className="tombol tombol--primer" disabled={sibuk} onClick={() => void lanjutLangkah1()}>
            {sibuk ? 'Menyiapkan…' : buatBaru ? 'Buat Sesi & Lanjut' : 'Lanjut'} <Icon nama="chevron-right" size={15} />
          </button>
        )}
        {langkah === 3 && (
          <button
            type="button"
            className="tombol tombol--primer"
            disabled={sibuk || (!hanyaValid && errorSisa > 0) || barisSiap.length === 0}
            onClick={() => setLangkah(4)}
          >
            Konfirmasi ({formatAngka(barisSiap.length)} baris) <Icon nama="chevron-right" size={15} />
          </button>
        )}
      </>
    );

  return (
    <Modal
      judul="Impor Opname dari Excel"
      lebar="sangat"
      onTutup={() => {
        if (!sibuk) tutup();
      }}
      sedangKirim={sibuk}
      aksi={aksi}
    >
      <input
        ref={inputFile}
        type="file"
        accept=".xlsx,.xls,.csv"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void terimaFile(f);
        }}
      />

      <ol className="wiz-langkah" aria-label="Langkah impor opname">
        {LANGKAH_NAMA.map((n, i) => (
          <li key={n} style={{ display: 'contents' }}>
            {i > 0 && <span className="wiz-langkah__pipa" aria-hidden="true" />}
            <span
              className={
                'wiz-langkah__item' +
                (i + 1 === langkah
                  ? ' wiz-langkah__item--aktif'
                  : i + 1 < langkah
                    ? ' wiz-langkah__item--selesai'
                    : '')
              }
              aria-current={i + 1 === langkah ? 'step' : undefined}
            >
              <b>{i + 1 < langkah ? '✓' : i + 1}</b>
              {n}
            </span>
          </li>
        ))}
      </ol>

      {galat && (
        <div className="wiz-banner wiz-banner--galat" style={{ marginBottom: 12 }}>
          <Icon nama="close" size={16} />
          <span>{galat}</span>
        </div>
      )}

      <div className="wiz-badan">
        <div className="wiz-utama">{isi}</div>
        {langkah >= 2 && langkah <= 3 && panelKanan}
      </div>
    </Modal>
  );
}

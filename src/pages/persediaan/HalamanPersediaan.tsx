// ============================================================================
// MODUL PERSEDIAAN SUB — form dokumen Item Masuk / Item Keluar.
//
// Metode input barang DIPERBARAN dari Kasir Tanpa Foto (POS Mode Cepat):
//   • kolom "Kode Item" dengan autocomplete /api/pos/cari — muncul sejak 1 huruf,
//     urut A-Z, daftar hanya menampilkan NAMA + STOK (tanpa foto);
//   • ↑/↓ memilih saran (highlight), Enter memasukkan barang ke tabel,
//     lalu fokus pindah ke kolom Qty baris itu;
//   • Qty diubah lewat angka di keyboard saja (tanpa tombol +/-);
//   • ↑/↓ pindah antar baris, Tab pindah kolom, Del hapus baris;
//   • scan barcode: Enter kilat → ambil segar → kecocokan barcode/kode tepat.
// Perubahan stok terjadi di server saat Simpan (ubahStok), bukan di sini.
// ============================================================================

import { useEffect, useRef, useState, type KeyboardEvent as KunciEvent } from 'react';
import { ambilOpsi, apiGet, apiPost } from '../../lib/api';
import { useSegarkanModul } from '../../lib/segarkan';
import { beritahu } from '../../components/crud/Toast';
import { formatAngka } from '../../lib/format';
import { Icon } from '../../components/Icon';
import { useGardaForm } from '../../lib/gardaForm';
import { gulirKeBaris } from '../../lib/barisTransaksi';
import { TombolScan } from '../../components/ScanKamera';
import type { Opsi, SaranCari } from '../pos/tipe';
import { ModalCariBarang, type BarisHasilCari } from '../../components/ModalCariBarang';
import { putarUmpanBalikScan } from '../../lib/umpanBalikScan';
import { RiwayatPersediaan } from './RiwayatPersediaan';
import type { Arah, BarisItem, BarisSaldo, MetaPersediaan } from './tipe';
import '../pos/pos.css';
import './persediaan.css';


/** "20*kaos" → qty 20 + kata "kaos"; "kaos" biasa → qty 1. (sama dengan POS) */
function pisahCari(masukan: string): { qty: number; kata: string } {
  const m = /^(\d+)\s*\*\s*(.*)$/.exec(masukan.trim());
  if (m) return { qty: Math.max(1, parseInt(m[1], 10) || 1), kata: m[2].trim() };
  return { qty: 1, kata: masukan.trim() };
}


function isoHariIni(): string {
  const b = (n: number) => String(n).padStart(2, '0');
  const d = new Date();
  return `${d.getFullYear()}-${b(d.getMonth() + 1)}-${b(d.getDate())}`;
}

export function HalamanPersediaan({ arah }: { arah: Arah }) {
  const masuk = arah === 'masuk';
  const judul = masuk ? 'Item Masuk' : 'Item Keluar';

  const [meta, setMeta] = useState<MetaPersediaan | null>(null);
  const [gudangOpsi, setGudangOpsi] = useState<Opsi[]>([]);
  const [gudangId, setGudangId] = useState(0);
  const [tanggal, setTanggal] = useState(isoHariIni);
  const [alasan, setAlasan] = useState('');
  const [keterangan, setKeterangan] = useState('');
  const [baris, setBaris] = useState<BarisItem[]>([]);
  const [stokMinus, setStokMinus] = useState(false);
  const [kirim, setKirim] = useState(false);
  const [segarkan, setSegarkan] = useState(0);
  // VIEW 1 = riwayat (default), VIEW 2 = formulir input.
  const [mode, setMode] = useState<'riwayat' | 'input'>('riwayat');

  // Autocomplete (state disalin dari Kasir Tanpa Foto / Mode Cepat).
  const [cari, setCari] = useState('');
  // Enter-Triggered Search — hasil pencarian tampil di pop-up modal.
  const [modalHasil, setModalHasil] = useState<SaranCari[] | null>(null);
  const [modalKata, setModalKata] = useState('');
  const [modalQty, setModalQty] = useState(1);
  const [teksQty, setTeksQty] = useState<Record<number, string>>({});

  const cariRef = useRef<HTMLInputElement>(null);
  const tabelRef = useRef<HTMLTableSectionElement>(null);
  const idPermintaan = useRef(0);
  const urutanFokus = useRef(0);
  const [fokusQty, setFokusQty] = useState<{ r: number; n: number } | null>(null);

  const daftarAlasan = meta?.alasan[arah] ?? [];
  const alasanEfektif = daftarAlasan.some((a) => a.kode === alasan) ? alasan : daftarAlasan[0]?.kode ?? '';
  const totalQty = baris.reduce((t, b) => t + b.qty, 0);
  const barisKurang =
    arah === 'keluar' && !stokMinus ? baris.filter((b) => b.qty > b.stokSebelum) : [];

  /* --------------------------- muat data awal ---------------------------- */
  // Tombol Refresh global di topbar: muat ulang meta/opsi (tanpa menyentuh draft baris).
  useSegarkanModul(() => void muatMeta());
  const muatMeta = async () => {
    try {
      const r = await apiGet<{ data: MetaPersediaan }>('/api/persediaan/meta');
      setMeta(r.data);
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    }
  };

  useEffect(() => {
    void muatMeta();
    (async () => {
      try {
        const [go, mt] = await Promise.all([
          ambilOpsi('gudang'),
          apiGet<{ pengaturan: Record<string, string> }>('/api/meta').catch(() => ({
            pengaturan: {} as Record<string, string>,
          })),
        ]);
        setGudangOpsi(go);
        setGudangId((prev) => prev || go[0]?.id || 0);
        const v = String(mt.pengaturan['stok_minus'] ?? '').toLowerCase();
        setStokMinus(v === '1' || v === 'true');
      } catch (e) {
        beritahu((e as Error).message, 'galat');
      }
    })();
    cariRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Router memakai ulang komponen yang sama saat pindah masuk ↔ keluar —
  // bersihkan form dan muat ulang daftar alasan arah baru.
  useEffect(() => {
    setBaris([]);
    setTeksQty({});
    setCari('');
    setModalHasil(null);
    setModalKata('');
    setKeterangan('');
    setFokusQty(null);
    setKirim(false);
    setMode('riwayat');
    void muatMeta();
  }, [arah]);

  /* ------------- Enter-Triggered Search (tanpa query saat mengetik) ------- */
  const ambilSaran = async (q: string): Promise<SaranCari[]> => {
    const r = await apiGet<{ data: SaranCari[] }>(
      `/api/pos/cari?cari=${encodeURIComponent(q)}${gudangId > 0 ? `&gudang=${gudangId}` : ''}`,
    );
    // Spesifikasi modul: hasil diurutkan A-Z (server mengirim peringkat relevansi).
    const urut = [...r.data].sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
    // Item Keluar: barang stok kosong di gudang terpilih tidak dimunculkan
    // (pemilihannya pun ditolak server/validasi). Item Masuk tetap menampilkan
    // semuanya karena mengisi stok — termasuk barang yang sedang kosong.
    return arah === 'keluar' ? urut.filter((s) => s.stok > 0) : urut;
  };


  // Fokus Qty baris setelah barang dimasukkan / pindah baris.
  useEffect(() => {
    if (!fokusQty) return;
    const el = tabelRef.current?.querySelector<HTMLInputElement>(
      `input[data-baris="${fokusQty.r}"]`,
    );
    el?.focus();
    el?.select();
    // Baris bisa berada di luar area gulir tabel → gulir otomatis ke sana.
    gulirKeBaris(el);
  }, [fokusQty]);

  /* --------------------------- baris tabel -------------------------------- */
  const batasQty = (b: BarisItem): number =>
    arah === 'keluar' && !stokMinus ? Math.max(1, b.stokSebelum) : Number.MAX_SAFE_INTEGER;

  const tambahBaris = (s: SaranCari, jumlahMinta: number): void => {
    const jumlah = Math.max(1, jumlahMinta);
    const idx = baris.findIndex((b) => b.productId === s.product_id);
    const sekarang = idx >= 0 ? baris[idx].qty : 0;
    if (arah === 'keluar' && !stokMinus && sekarang + jumlah > s.stok) {
      beritahu(
        s.stok <= 0 && idx < 0
          ? `Stok ${s.nama} habis di gudang terpilih.`
          : `Stok ${s.nama} di gudang terpilih sisa ${s.stok}.`,
        'galat',
      );
      return;
    }
    if (idx >= 0) {
      setBaris((bs) => bs.map((b, i) => (i === idx ? { ...b, qty: b.qty + jumlah } : b)));
    } else {
      const baru: BarisItem = {
        productId: s.product_id,
        kode: s.kode_item || s.sku,
        nama: s.nama,
        size: null,
        satuan: null,
        qty: jumlah,
        stokSebelum: s.stok,
      };
      setBaris((bs) => [...bs, baru]);
      // Satuan tidak ikut hasil pencarian — ambil sekali dari server.
      void apiGet<{ data: BarisSaldo[] }>(
        `/api/persediaan/stok?gudang=${gudangId}&produk=${s.product_id}`,
      )
        .then((r) => {
          const d = r.data[0];
          if (!d) return;
          setBaris((bs) =>
            bs.map((b) =>
              b.productId === s.product_id ? { ...b, satuan: d.satuan ?? b.satuan } : b,
            ),
          );
        })
        .catch(() => {
          /* satuan bersifat tampilan — gagal tidak menghalangi input */
        });
    }
  };

  const terimaSaran = (s: SaranCari | undefined, qty: number, kataAsli: string): void => {
    if (!s) {
      // ISOLASI GUDANG — pencarian terkunci gudang dokumen: tanpa hasil
      // berarti barang tidak terdaftar di gudang ini.
      const labelGudang = gudangOpsi.find((o) => o.id === gudangId)?.label;
      beritahu(
        labelGudang ? `Barang ini tidak terdaftar di ${labelGudang}.` : `Tidak ada barang cocok dengan "${kataAsli}".`,
        'info',
        2500,
      );
      return;
    }
    tambahBaris(s, qty);
    setCari('');
    setModalHasil(null);
    setModalKata('');
    setModalQty(1);
    // Fokus TETAP di kolom cari (mouse maupun Enter/scan) agar barang
    // berikutnya bisa langsung diketik — pindah ke tabel via Tab / ↓.
    fokusCari();
  };

  /** Cari ulang dari dalam modal (kata kunci diubah lalu Enter). */
  const cariModal = async (k: string): Promise<void> => {
    try {
      const data = await ambilSaran(k);
      setModalKata(k);
      setModalHasil(data);
      if (data.length === 0) {
        putarUmpanBalikScan('gagal');
        beritahu(`Barang tidak ditemukan untuk "${k}".`, 'info', 2500);
      }
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    }
  };

  const petaModal = new Map<string, SaranCari>();
  for (const s of modalHasil ?? []) petaModal.set(String(s.product_id), s);
  const barisModal: BarisHasilCari[] = (modalHasil ?? []).map((s) => ({
    key: s.product_id,
    kode: s.kode_item || s.sku || s.barcode || '',
    nama: s.nama,
    kategori: (s as { kategori?: string | null }).kategori ?? null,
    stok: s.stok,
    harga: s.harga,
  }));

  // kodeLangsung: hasil pindaian kamera HP (melewati state cari yang async).
  const konfirmasiCari = async (kodeLangsung?: string): Promise<void> => {
    const { qty, kata: k } = pisahCari(kodeLangsung ?? cari);
    if (!k) {
      beritahu('Ketik nama / kode item / barcode dulu.', 'info', 2500);
      return;
    }
    // Enter = satu-satunya pemicu pencarian.
    try {
      const id = ++idPermintaan.current;
      const data = await ambilSaran(k);
      if (id !== idPermintaan.current) return;
      const q = k.toLowerCase();
      const persis = data.filter(
        (s) =>
          (s.barcode ? s.barcode.toLowerCase() === q : false) ||
          s.sku.toLowerCase() === q ||
          (s.kode_item ? s.kode_item.toLowerCase() === q : false),
      );
      // 1x scan kode persis → langsung masuk tabel.
      if (persis.length === 1) {
        terimaSaran(persis[0], qty, k);
        return;
      }
      // Banyak hasil / pencarian umum → pop-up modal.
      setModalKata(k);
      setModalQty(qty);
      setModalHasil(data);
      if (data.length === 0) {
        putarUmpanBalikScan('gagal');
        beritahu(`Barang tidak ditemukan untuk "${k}".`, 'info', 2500);
      }
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    }
  };

  const fokusCari = (): void => {
    cariRef.current?.focus();
    cariRef.current?.select();
  };

  // F2 di mana saja pada modul ini → kembali ke kolom pencarian.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        fokusCari();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const fokusQtyBaris = (r: number): void => {
    if (r < 0 || r >= baris.length) return;
    setFokusQty({ r, n: ++urutanFokus.current });
  };

  const ubahQty = (b: BarisItem, mentah: string): void => {
    const bersih = mentah.replace(/\D/g, '');
    setTeksQty((t) => ({ ...t, [b.productId]: bersih }));
    if (bersih === '') return; // biarkan nilai lama sampai blur
    const n = Number(bersih);
    setBaris((bs) =>
      bs.map((x) => {
        if (x.productId !== b.productId) return x;
        return { ...x, qty: Math.max(1, Math.min(batasQty(x), n)) };
      }),
    );
  };

  const akhiriQty = (b: BarisItem): void =>
    setTeksQty((t) => {
      if (!(b.productId in t)) return t;
      const salinan = { ...t };
      delete salinan[b.productId];
      return salinan;
    });

  /** Angka ditekan di sel non-input → langsung mengetik Qty baris itu. */
  const mulaiQtyDenganAngka = (r: number, angka: string): void => {
    const b = baris[r];
    if (!b) return;
    setTeksQty((t) => ({ ...t, [b.productId]: angka }));
    const n = Number(angka);
    setBaris((bs) =>
      bs.map((x, i) => (i === r ? { ...x, qty: Math.max(1, Math.min(batasQty(x), n)) } : x)),
    );
    setFokusQty({ r, n: ++urutanFokus.current });
  };

  const hapusBaris = (r: number): void => {
    const b = baris[r];
    if (!b) return;
    const sisa = baris.filter((_, i) => i !== r);
    setBaris(sisa);
    setTeksQty((t) => {
      const salinan = { ...t };
      delete salinan[b.productId];
      return salinan;
    });
    if (sisa.length === 0) fokusCari();
    else setFokusQty({ r: Math.min(r, sisa.length - 1), n: ++urutanFokus.current });
  };

  /** Keyboard di tabel: ↑/↓ antar baris, Tab antar kolom (alami), Del hapus. */
  const kunciTabel = (e: KunciEvent<HTMLTableSectionElement>): void => {
    const el = e.target as HTMLElement;
    const tr = el.closest('tr[data-baris]') as HTMLTableRowElement | null;
    if (!tr) return;
    const r = Number(tr.dataset.baris);
    const dalamInput = el instanceof HTMLInputElement;

    if (e.key === 'Tab') return; // alami: kolom berikutnya → baris berikutnya
    if (e.key === 'Enter') {
      e.preventDefault();
      if (dalamInput) fokusCari();
      else fokusQtyBaris(r);
      return;
    }
    if (e.key === 'Delete') {
      e.preventDefault();
      hapusBaris(r);
      return;
    }
    if (e.key === 'Escape' || e.key === 'F2') {
      e.preventDefault();
      if (dalamInput) akhiriQty(baris[r]);
      fokusCari();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (r < baris.length - 1) fokusQtyBaris(r + 1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (r > 0) fokusQtyBaris(r - 1);
      else fokusCari();
      return;
    }
    if (!dalamInput && /^[0-9]$/.test(e.key)) {
      e.preventDefault();
      mulaiQtyDenganAngka(r, e.key);
    }
  };

  /* --------------------------- header form -------------------------------- */
  const gantiGudang = async (idBaru: number): Promise<void> => {
    setGudangId(idBaru);
    if (baris.length === 0) return;
    try {
      const r = await apiGet<{ data: BarisSaldo[] }>(
        `/api/persediaan/stok?gudang=${idBaru}&produk=${baris.map((b) => b.productId).join(',')}`,
      );
      const peta = new Map(r.data.map((d) => [d.product_id, d]));
      setBaris((bs) =>
        bs.map((b) => ({
          ...b,
          stokSebelum: peta.get(b.productId)?.qty ?? 0,
          satuan: peta.get(b.productId)?.satuan ?? b.satuan,
        })),
      );
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    }
  };

  const simpan = async (): Promise<void> => {
    if (kirim) return;
    if (baris.length === 0) {
      beritahu('Belum ada barang — cari di kolom Kode Item lalu tekan Enter.', 'info', 3000);
      fokusCari();
      return;
    }
    if (!gudangId) {
      beritahu('Gudang belum dipilih.', 'galat');
      return;
    }
    if (!alasanEfektif) {
      beritahu('Alasan belum dipilih.', 'galat');
      return;
    }
    if (alasanEfektif === 'lainnya' && !keterangan.trim()) {
      beritahu('Keterangan wajib diisi untuk alasan Lainnya.', 'galat');
      return;
    }
    if (barisKurang.length > 0) {
      const b = barisKurang[0];
      beritahu(
        `Stok ${b.nama} tidak cukup — tersisa ${formatAngka(b.stokSebelum)}, diminta ${formatAngka(b.qty)}.`,
        'galat',
      );
      return;
    }
    setKirim(true);
    try {
      const r = await apiPost<{ data: { no_dokumen: string } }>('/api/persediaan', {
        arah,
        warehouse_id: gudangId,
        tanggal,
        alasan: alasanEfektif,
        keterangan: keterangan.trim() || null,
        items: baris.map((b) => ({ product_id: b.productId, qty: b.qty })),
      });
      beritahu(`Dokumen ${r.data.no_dokumen} disimpan — stok diperbarui.`, 'sukses');
      setBaris([]);
      setTeksQty({});
      setKeterangan('');
      setAlasan(''); // kembali ke alasan pertama (default arah)
      void muatMeta();
      setSegarkan((n) => n + 1);
      // Kembali otomatis ke riwayat & muat ulang daftar.
      setMode('riwayat');
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    } finally {
      setKirim(false);
    }
  };

  const hapusSemuaBaris = (): void => {
    if (baris.length === 0) {
      beritahu('Belum ada baris untuk dihapus.', 'info', 2000);
      return;
    }
    setBaris([]);
    setTeksQty({});
    beritahu('Baris dikosongkan.', 'info', 2000);
    fokusCari();
  };

  const batalForm = (): void => {
    setBaris([]);
    setTeksQty({});
    setCari('');
    setModalHasil(null);
    setModalKata('');
    setTanggal(isoHariIni());
    setAlasan('');
    setKeterangan('');
    beritahu('Form dibersihkan.', 'info', 2000);
    fokusCari();
  };

  // Garda navigasi: cegah baris belum disimpan hilang saat pindah modul.
  const kotorRef = useRef(false);
  kotorRef.current = mode === 'input' && baris.length > 0;
  const { garda, minta } = useGardaForm({
    aktif: kotorRef.current,
    simpan,
    masihKotor: () => kotorRef.current,
    buang: () => batalForm(),
  });

  const bukaInput = (): void => {
    setMode('input');
    // Fokus ke kolom cari setelah tampilan input muncul.
    setTimeout(() => cariRef.current?.focus(), 0);
  };

  // ==================== VIEW 1: RIWAYAT (DEFAULT) — satu kartu terpadu ====
  if (mode === 'riwayat') {
    return (
      <div className="halaman sub-halaman">
        <RiwayatPersediaan arah={arah} segarkan={segarkan} tambahLabel={`+ Tambah ${judul}`} onTambah={bukaInput} />
      </div>
    );
  }

  // ==================== VIEW 2: FORMULIR INPUT ====================
  // Kunci setinggi viewport (tanpa scroll luar): hanya tabel item menggulir.
  return (
    <div className="halaman sub-halaman halaman--fit">
      {/* --- Satu kartu terpadu: header + formulir ------------------------------ */}
      <section className="kartu kartu--sub-fit">
        <div className="kartu__kepala kartu__kepala--kompak kepala-kartu">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              className="tombol tombol--netral tombol--kecil"
              onClick={() => minta(() => setMode('riwayat'))}
              title="Kembali ke Riwayat"
            >
              ← Kembali ke Riwayat
            </button>
            <div>
              <h3>
                Formulir {judul} — {masuk ? 'stok bertambah' : 'stok berkurang'}
              </h3>
              <p className="teks-redup teks-kecil">Nomor dokumen dibuat otomatis saat disimpan{meta ? ` (${meta.nomor[arah]} berikutnya)` : ''}</p>
            </div>
          </div>
        </div>

        <div className="sub-kepala">
          <label className="bidang sub-nomor">
            <span>Nomor Dokumen (otomatis)</span>
            <input
              readOnly
              value={meta?.nomor[arah] ?? ''}
              placeholder="Memuat…"
              aria-label="Nomor dokumen otomatis"
            />
          </label>
          <label className="bidang">
            <span>Tanggal</span>
            <input
              type="date"
              value={tanggal}
              onChange={(e) => setTanggal(e.target.value)}
              aria-label="Tanggal dokumen"
            />
          </label>
          <label className="bidang">
            <span>Gudang</span>
            <select
              value={gudangId}
              onChange={(e) => void gantiGudang(Number(e.target.value))}
              aria-label="Gudang"
            >
              {gudangOpsi.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="bidang">
            <span>Alasan</span>
            <select
              value={alasanEfektif}
              onChange={(e) => setAlasan(e.target.value)}
              aria-label={`Alasan ${judul}`}
            >
              {daftarAlasan.map((a) => (
                <option key={a.kode} value={a.kode}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label className="bidang sub-keterangan">
            <span>
              Keterangan{alasanEfektif === 'lainnya' && <em className="wajib"> *</em>}
            </span>
            <input
              value={keterangan}
              onChange={(e) => setKeterangan(e.target.value)}
              placeholder={
                alasanEfektif === 'lainnya' ? 'Wajib untuk alasan Lainnya' : 'Catatan (opsional)'
              }
              maxLength={255}
              aria-label="Keterangan"
            />
          </label>
        </div>

        {/* --- Input barang (identik Kasir Tanpa Foto) --------------------- */}
        <div className="sub-baris" style={{ marginTop: 12 }}>
          <div className="pos-cari sub-cari">
            <span className="pos-cari__ikon" aria-hidden>
              <svg width="1em" height="1em" style={{ fontSize: '0.9375rem' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            </span>
            <input
              ref={cariRef}
              id="search-item-input"
              value={cari}
              placeholder="Kode Item — ketik ≥1 huruf, scan barcode, atau 5*kode"
              aria-label="Kode Item — cari atau scan barcode"
              autoComplete="off"
              onChange={(e) => setCari(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void konfirmasiCari();
                  return;
                }
                if (e.key === 'ArrowDown') {
                  if (baris.length > 0) {
                    e.preventDefault();
                    fokusQtyBaris(0);
                  }
                  return;
                }
                if (e.key === 'Escape') {
                  // Tutup modal bila terbuka; teks di kolom cari tidak dibuang.
                  setModalHasil(null);
                  setModalKata('');
                  return;
                }
                if (e.key === 'Tab' && !e.shiftKey && baris.length > 0) {
                  e.preventDefault();
                  fokusQtyBaris(0);
                }
              }}
            />
            <TombolScan mode="berkelanjutan" onHasil={(t) => { setCari(t); void konfirmasiCari(t); }} judul="Pindai barcode barang" />
            {modalHasil !== null && (
              <ModalCariBarang
                judul="Hasil pencarian barang"
                kata={modalKata}
                baris={barisModal}
                onCari={(k) => void cariModal(k)}
                onPilih={(b) => {
                  const s = petaModal.get(String(b.key));
                  if (s) terimaSaran(s, modalQty, modalKata);
                  else setModalHasil(null);
                }}
                onTutup={() => {
                  setModalHasil(null);
                  setModalKata('');
                  fokusCari();
                }}
                labelAksi="Tambah"
              />
            )}
          </div>

          <div className="sub-ringkas">
            <strong>{formatAngka(baris.length)}</strong> barang · total{' '}
            <strong>{formatAngka(totalQty)}</strong> qty
            {arah === 'keluar' && stokMinus && <span className="sub-flag">stok minus: aktif</span>}
            {barisKurang.length > 0 && (
              <span className="sub-flag" title="Baris melebihi stok tersedia">
                {barisKurang.length} baris melebihi stok
              </span>
            )}
          </div>

          <div className="sub-aksi">
            <button
              type="button"
              className="tombol-ikon-teks tombol-ikon-teks--primer"
              onClick={() => void simpan()}
              disabled={kirim}
              title="Simpan dokumen — stok langsung diperbarui"
            >
              <Icon nama="circle-check" size={17} />
              <span>{kirim ? 'Menyimpan…' : 'Simpan'}</span>
            </button>
            <button
              type="button"
              className="tombol-ikon-teks tombol-ikon-teks--bahaya"
              onClick={hapusSemuaBaris}
              title="Hapus semua baris tabel"
            >
              <Icon nama="trash" size={17} />
              <span>Hapus</span>
            </button>
            <button
              type="button"
              className="tombol-ikon-teks"
              onClick={batalForm}
              title="Batal — kembalikan form ke awal"
            >
              <Icon nama="rotate-ccw" size={17} />
              <span>Batal</span>
            </button>
          </div>
        </div>
      </section>

      {/* --- Tabel item ------------------------------------------------------ */}
      <div className="sub-tabel-bungkus">
        <table className="sub-tabel tabel-transaksi">
          <thead>
            <tr>
              <th className="num">No</th>
              <th>Kode Item</th>
              <th>Nama</th>
              <th>Size/Varian</th>
              <th className="num">Qty</th>
              <th>Satuan</th>
              <th className="num">Stok Sebelum</th>
              <th className="num">Stok Sesudah</th>
              <th aria-label="Aksi" />
            </tr>
          </thead>
          <tbody ref={tabelRef} onKeyDown={kunciTabel}>
            {baris.length === 0 ? (
              <tr>
                <td colSpan={9} className="sub-kosong">
                  Belum ada barang. Ketik minimal <b>1 huruf</b> di kolom <b>Kode Item</b> —
                  daftar muncul otomatis; tekan <b>↑/↓</b> lalu <b>Enter</b> untuk memasukkan.
                </td>
              </tr>
            ) : (
              baris.map((b, r) => {
                const sesudah = masuk ? b.stokSebelum + b.qty : b.stokSebelum - b.qty;
                const melebihi = barisKurang.some((x) => x.productId === b.productId);
                return (
                  <tr key={b.productId} data-baris={r}>
                    <td className="num" tabIndex={0}>
                      {r + 1}
                    </td>
                    <td className="sub-td-kode" tabIndex={0}>
                      {b.kode}
                    </td>
                    <td className="sub-td-nama" tabIndex={0} title={b.nama}>
                      {b.nama}
                    </td>
                    <td className="sub-td-redup" tabIndex={0} title="Master tanpa varian">
                      {b.size ?? '—'}
                    </td>
                    <td className="num sub-td-sel">
                      <input
                        className="pos-sel-input"
                        name="qty"
                        data-baris={r}
                        inputMode="numeric"
                        aria-label={`Qty ${b.nama}`}
                        value={teksQty[b.productId] ?? String(b.qty)}
                        onChange={(e) => ubahQty(b, e.target.value)}
                        onBlur={() => akhiriQty(b)}
                      />
                    </td>
                    <td tabIndex={0}>{b.satuan ?? '—'}</td>
                    <td className="num" tabIndex={0}>
                      {formatAngka(b.stokSebelum)}
                    </td>
                    <td
                      className={`num ${sesudah < 0 || melebihi ? 'sub-minus' : ''}`}
                      title={melebihi ? 'Melebihi stok tersedia' : undefined}
                      tabIndex={0}
                    >
                      {formatAngka(sesudah)}
                    </td>
                    <td className="sub-td-aksi">
                      <button
                        type="button"
                        className="pos-sel-hapus"
                        aria-label={`Hapus ${b.nama} dari tabel`}
                        onClick={() => hapusBaris(r)}
                      >
                        <Icon nama="trash" size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="sub-petunjuk">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> pilih saran / pindah baris
        </span>
        <span>
          <kbd>Enter</kbd> masukkan barang → fokus Qty
        </span>
        <span>
          <kbd>Tab</kbd> pindah kolom
        </span>
        <span>
          <kbd>Del</kbd> hapus baris
        </span>
        <span>Angka langsung mengetik Qty (tanpa tombol +/−)</span>
      </p>
      {garda}
    </div>
  );
}

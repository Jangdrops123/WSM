import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CariBarang, type HasilProduk } from '../../components/CariBarang';
import { beritahu } from '../../components/crud/Toast';
import { ambilOpsi, apiGet, apiPost, apiPut } from '../../lib/api';
import { formatRupiah } from '../../lib/format';
import { bolehKelolaTransaksi, can, MODUL_PO } from '../../lib/hak';
import { useSesi } from '../../lib/sesi';
import { TIP_GUDANG_TERKUNCI, idGudangBawaan, idGudangTerkunci } from '../../lib/gudang';
import { navigasiBarisPo } from './navKeyboard';
import { gulirBarisDalamWadah, gulirKeBaris } from '../../lib/barisTransaksi';
import { useGardaForm } from '../../lib/gardaForm';
import { pakaiKodi, pakaiQtyNol, tampilQty } from './pakaiKodi';
import './po.css';
import './po-hub.css';

type Opsi = { id: number; label: string };

interface Keranjang {
  kunci: string;
  product_id: number;
  kode: string;
  nama: string;
  kodi: string;
  pcs: string;
  harga: string;
  ket: string;
}

const kunciBaru = (): string => `k${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function hariIni(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Buat PO (halaman penuh) — alur kasir: cari barang → tap → keranjang (kodi/pcs, harga, subtotal). */
export function PoBuat() {
  const navigasi = useNavigate();
  const sesiInfo = useSesi().info;
  const boleh = can(sesiInfo, MODUL_PO, 'tambah');
  // Token Edit — /po/edit/<id> (juga /po/buat?edit=<id>) memuat ulang PO ke form ini.
  const [params] = useSearchParams();
  const rute = useParams();
  const editId = Number(params.get('edit') ?? rute.id ?? 0) || null;
  // PO SUSULAN — /po/buat?ref_po_id=<id> menyalin header PO referensi.
  const refId = editId ? null : Number(params.get('ref_po_id') ?? 0) || null;
  const [editInfo, setEditInfo] = useState<{ no_po: string; status: string } | null>(null);
  const [refInfo, setRefInfo] = useState<{ no_po: string; sisa: number } | null>(null);
  /** Barang PO referensi yang masih bersisa (belum datang) — untuk diisi 1 klik. */
  const [refSisa, setRefSisa] = useState<
    { product_id: number; nama: string; kode: string; pcs: number; harga: number; ket: string }[]
  >([]);
  const [refSibuk, setRefSibuk] = useState(false);
  /** Header PO referensi hanya diisi sekali (tidak menimpa ubahan pengguna). */
  const refSudahMuat = useRef(false);
  const bolehUbah = can(sesiInfo, MODUL_PO, 'ubah');
  const bolehEditPosting = bolehKelolaTransaksi(sesiInfo);

  const [supplier, setSupplier] = useState('');
  const [gudang, setGudang] = useState('');
  /** Nomor PO manual — OPSIONAL. Kosong = dibuat otomatis oleh server. */
  const [noPo, setNoPo] = useState('');
  const [tanggal, setTanggal] = useState(hariIni());
  const [tenggat, setTenggat] = useState('');
  const [catatan, setCatatan] = useState('');
  /** PPN 11% opsional — bawaan tidak aktif (PO tanpa pajak). */
  const [ppnAktif, setPpnAktif] = useState(false);
  const [items, setItems] = useState<Keranjang[]>([]);
  const [fokusCari, setFokusCari] = useState(0);
  const [sibuk, setSibuk] = useState(false);
  const { isiKodi, kodiAktif, setKodiAktif } = pakaiKodi();
  const { qtyNolAktif, setQtyNolAktif } = pakaiQtyNol();
  const [opsiSupplier, setOpsiSupplier] = useState<Opsi[]>([]);
  const [opsiGudang, setOpsiGudang] = useState<Opsi[]>([]);
  const sibukRef = useRef(false);
  // WI — pengguna dengan akses satu gudang: gudang tujuan PO dikunci.
  const gudangTerkunci = idGudangTerkunci(sesiInfo, opsiGudang);

  useEffect(() => {
    ambilOpsi('pemasok').then(setOpsiSupplier).catch((e: Error) => beritahu(e.message, 'galat'));
    ambilOpsi('gudang').then(setOpsiGudang).catch((e: Error) => beritahu(e.message, 'galat'));
  }, []);

  // WI2 — gudang terkunci menang; bila tidak terkunci, gudang default sesi.
  useEffect(() => {
    // PO susulan memakai gudang PO referensi — jangan ditimpa gudang bawaan sesi.
    if (editId || refId) return;
    const awal = gudangTerkunci ?? idGudangBawaan(sesiInfo, opsiGudang);
    if (awal !== null) setGudang(String(awal));
  }, [gudangTerkunci, opsiGudang, sesiInfo, editId, refId]);

  /**
   * MODE BATCH SELECTION — tambah dari dropdown, fokus TETAP di kolom cari
   * agar pengguna bisa memasukkan barang ke-2, ke-3, dst. berurutan.
   * Barang baru otomatis qty 1 pcs (kodi 0 + pcs 1); barang yang sama +1 pcs.
   */
  /** Nilai desimal untuk <input type="number"> (titik desimal): 30 pcs @20 → "1.5". */
  const formatKodiInput = (totalPcs: number): string => {
    const per = isiKodi > 0 ? isiKodi : 20;
    const v = Math.max(0, Math.floor(Number(totalPcs) || 0)) / per;
    return String(Math.round(v * 100) / 100);
  };

  const tambah = (h: HasilProduk) => {
    const ada = items.find((x) => x.product_id === h.product_id);
    const barisIdx = ada ? items.findIndex((x) => x.product_id === h.product_id) : items.length;
    if (ada) {
      const total = (Number(ada.pcs) || 0) + 1;
      setItems(items.map((x) => (x.product_id === h.product_id ? { ...x, kodi: formatKodiInput(total), pcs: String(total) } : x)));
    } else {
      setItems([
        ...items,
        {
          kunci: kunciBaru(),
          product_id: h.product_id,
          kode: h.kode_item ?? h.sku,
          nama: h.produk,
          kodi: '0',
          pcs: '1',
          harga: String(h.harga_terakhir ?? h.harga_beli ?? 0),
          ket: '',
        },
      ]);
    }
    // Fokus TETAP di kolom cari (dikosongkan lewat token) supaya operator bisa
    // langsung mengetik/memindai barang berikutnya — sama untuk pilihan manual
    // maupun barcode. Baris tetap digulir agar hasilnya terlihat; pindah ke
    // tabel dilakukan sengaja lewat Tab / Panah Bawah.
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLInputElement>(
        `input[data-po-baris="${barisIdx}"][data-po-kolom="pcs"]`,
      );
      if (el) gulirKeBaris(el);
    });
    setFokusCari((t) => t + 1);
  };

  /** MODE EDIT TABEL — pindah fokus dari kolom cari ke PCS baris pertama. */
  const keTabel = () => {
    if (items.length === 0) return;
    const el = document.querySelector<HTMLInputElement>(
      'input[data-po-baris="0"][data-po-kolom="pcs"]',
    );
    if (el) {
      el.focus();
      el.select();
    }
  };

  /**
   * Penangan tombol di sel tabel (MODE EDIT TABEL, tegas terpisah dari mode cari):
   * - ↑/↓ : pindah baris (navigasiBarisPo; angka tak berubah karena preventDefault).
   * - Tab / Shift+Tab : pindah kolom (bawaan browser).
   * - Esc dari baris pertama : kembali ke kolom pencarian.
   */
  const tombolTabel = (e: KeyboardEvent<HTMLElement>, idx: number, kolom: string) => {
    // Enter di sel tabel = konfirmasi angka → kembali ke kolom cari (F2) untuk
    // barang berikutnya, tanpa perlu mouse.
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('search-item-input')?.focus();
      return;
    }
    if (e.key === 'Escape' && idx === 0) {
      e.preventDefault();
      document.getElementById('search-item-input')?.focus();
      return;
    }
    navigasiBarisPo(e, idx, kolom);
  };

  /** Wadah gulir tabel item — sasaran auto-scroll baris baru/aktif. */
  const tabelRef = useRef<HTMLDivElement>(null);

  const ubah = (kunci: string, patch: Partial<Keranjang>) =>
    setItems((list) => list.map((b) => (b.kunci === kunci ? { ...b, ...patch } : b)));

  const hapusBaris = (kunci: string) => setItems((list) => list.filter((b) => b.kunci !== kunci));

  /** BASE UNIT: seluruh qty & harga dihitung dari kolom PCS (konversi Kodi read-only). */
  const qtyPcs = (b: Keranjang): number => Math.max(0, Math.floor(Number(b.pcs) || 0));

  /** Teks konversi Kodi read-only: 50 pcs @20 → "2,5 kd". */
  const teksKonversi = (pcs: number): string => {
    const q = Math.max(0, Math.floor(Number(pcs) || 0));
    if (q <= 0) return '—';
    const per = isiKodi > 0 ? isiKodi : 20;
    return `${(q / per).toLocaleString('id-ID', { maximumFractionDigits: 2 })} kd`;
  };

  /** Qty HANYA diinput di PCS; kolom Kodi terhitung otomatis (Kodi = PCS ÷ isi). */
  const ubahPcs = (kunci: string, mentah: string) => {
    const bersih = mentah.replace(/[^0-9]/g, '');
    const total = Math.max(0, Math.floor(Number(bersih) || 0));
    ubah(kunci, { pcs: bersih, kodi: formatKodiInput(total) });
  };
  const totalPcs = items.reduce((n, b) => n + qtyPcs(b), 0);
  const totalHarga = items.reduce((n, b) => n + qtyPcs(b) * (Number(b.harga) || 0), 0);
  const nilaiPpn = ppnAktif ? Math.round(totalHarga * 0.11) : 0;
  const grandTotal = totalHarga + nilaiPpn;

  // Estafet tampilan: barang yang baru ditambahkan (mis. item ke-11 dst.)
  // otomatis terlihat lewat gulir halus di dalam wadah tabel saja — halaman,
  // header form, dan footer ringkasan tidak ikut bergeser.
  useEffect(() => {
    if (items.length === 0) return;
    const wadah = tabelRef.current;
    const baris = wadah?.querySelector<HTMLElement>('tbody > tr:last-child');
    if (!wadah || !baris) return;
    const delta = baris.getBoundingClientRect().bottom - wadah.getBoundingClientRect().bottom;
    if (delta > 0) wadah.scrollTo({ top: wadah.scrollTop + delta + 6, behavior: 'smooth' });
  }, [items.length]);

  // Muat PO yang akan diedit ke form (Token Edit).
  useEffect(() => {
    if (!editId) return;
    if (!bolehUbah) {
      beritahu('Peran Anda belum memiliki izin Ubah pada Pembelian.', 'galat');
      return;
    }
    apiGet<{ data: Record<string, any> }>(`/api/po/${editId}`)
      .then((r) => {
        const d = r.data;
        if (String(d.status) === 'draft' ? false : !bolehEditPosting) {
          beritahu('Edit PO yang sudah dikirim butuh Administrator atau Hak Khusus "Hapus transaksi".', 'galat');
          return;
        }
        setEditInfo({ no_po: String(d.no_po), status: String(d.status) });
        setSupplier(String(d.supplier_id));
        setGudang(String(d.warehouse_id ?? ''));
        setTanggal(String(d.tanggal).slice(0, 10));
        setTenggat(d.tenggat ? String(d.tenggat).slice(0, 10) : '');
        setCatatan(String(d.catatan ?? ''));
        setPpnAktif(d.is_tax_enabled === true || d.is_tax_enabled === 1);
        setItems(
          ((d.items ?? []) as Record<string, any>[]).map((i) => ({
            kunci: kunciBaru(),
            product_id: Number(i.product_id),
            kode: String(i.sku ?? i.kode_item ?? ''),
            nama: String(i.produk_nama ?? ''),
            kodi: '0',
            pcs: String(Number(i.qty_pesan) || 0),
            harga: String(Number(i.harga_beli) || 0),
            ket: String(i.catatan ?? ''),
          })),
        );
      })
      .catch((e: Error) => beritahu(e.message, 'galat'));
  }, [editId, bolehEditPosting, bolehUbah]);

  // Muat PO referensi untuk PO susulan: pemasok, gudang, catatan, daftar sisa.
  useEffect(() => {
    if (!refId || refSudahMuat.current) return;
    refSudahMuat.current = true;
    setRefSibuk(true);
    apiGet<{ data: Record<string, any> }>(`/api/po/${refId}`)
      .then((r) => {
        const d = r.data;
        const sisa = ((d.items ?? []) as Record<string, any>[])
          .filter((i) => Number(i.sisa) > 0)
          .map((i) => ({
            product_id: Number(i.product_id),
            nama: String(i.produk_nama ?? ''),
            kode: String(i.sku ?? i.kode_item ?? ''),
            pcs: Math.max(0, Math.floor(Number(i.sisa) || 0)),
            harga: Number(i.harga_beli) || 0,
            ket: String(i.catatan ?? ''),
          }));
        setRefInfo({ no_po: String(d.no_po), sisa: sisa.length });
        setRefSisa(sisa);
        setSupplier(String(d.supplier_id));
        // Gudang terkunci (akses satu gudang) tetap menang atas gudang referensi.
        if (gudangTerkunci === null && d.warehouse_id) setGudang(String(d.warehouse_id));
        setCatatan((c) => (c.trim() ? c : `PO Susulan / Tambahan dari ${String(d.no_po)}`));
        // Tenggat sengaja dibiarkan kosong agar pengguna memilih tanggal baru.
        setFokusCari((t) => t + 1);
      })
      .catch((e: Error) => beritahu(e.message, 'galat'))
      .finally(() => setRefSibuk(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refId]);

  // Akses satu gudang: gudang terkunci menang atas gudang PO referensi.
  useEffect(() => {
    if (refId && gudangTerkunci !== null) setGudang(String(gudangTerkunci));
  }, [refId, gudangTerkunci]);

  /** Muat sisa barang PO referensi ke tabel input (boleh diubah/dihapus lagi). */
  const muatSisaReferensi = () => {
    if (refSisa.length === 0) return;
    setItems((lama) => {
      const hasil = [...lama];
      for (const s of refSisa) {
        const idx = hasil.findIndex((b) => b.product_id === s.product_id);
        if (idx >= 0) {
          const total = qtyPcs(hasil[idx]) + s.pcs;
          hasil[idx] = { ...hasil[idx], pcs: String(total), kodi: formatKodiInput(total) };
        } else {
          hasil.push({
            kunci: kunciBaru(),
            product_id: s.product_id,
            kode: s.kode,
            nama: s.nama,
            kodi: formatKodiInput(s.pcs),
            pcs: String(s.pcs),
            harga: String(s.harga),
            ket: s.ket,
          });
        }
      }
      return hasil;
    });
    setFokusCari((t) => t + 1);
    beritahu(`${refSisa.length} barang sisa dari ${refInfo?.no_po ?? 'PO referensi'} dimuat.`, 'info');
  };

  const payload = (): Record<string, unknown> | null => {
    if (!editId && !boleh) {
      beritahu('Peran Anda belum memiliki izin Tambah pada Pembelian.', 'galat');
      return null;
    }
    if (editId && !bolehUbah) {
      beritahu('Peran Anda belum memiliki izin Ubah pada Pembelian.', 'galat');
      return null;
    }
    if (!supplier) {
      beritahu('Pilih pemasok dulu.', 'galat');
      return null;
    }
    if (items.length === 0) {
      beritahu('Tambahkan minimal satu barang.', 'galat');
      return null;
    }
    // Baris Qty 0: subtotal Rp 0 & tidak menambah total — di luar payload
    // (kolom DB qty_pesan CHECK > 0), tapi tetap tampil di tabel sebagai catatan.
    const valid = qtyNolAktif ? items.filter((b) => qtyPcs(b) > 0) : items;
    for (const b of valid) {
      if (!(qtyPcs(b) > 0)) {
        beritahu(`Qty "${b.nama}" harus lebih dari 0.`, 'galat');
        return null;
      }
      if (!((Number(b.harga) || 0) >= 0)) {
        beritahu(`Harga "${b.nama}" tidak boleh negatif.`, 'galat');
        return null;
      }
    }
    if (valid.length === 0) {
      beritahu('Tambahkan minimal satu barang dengan Qty lebih dari 0.', 'galat');
      return null;
    }
    if (qtyNolAktif && valid.length < items.length) {
      beritahu(`${items.length - valid.length} baris Qty 0 tidak ikut disimpan.`, 'info');
    }
    return {
      supplier_id: Number(supplier),
      warehouse_id: gudang ? Number(gudang) : undefined,
      // Hanya saat membuat PO baru — Kosong = server membuat nomor unik.
      no_po: !editId && noPo.trim() ? noPo.trim() : undefined,
      // PO susulan menaut ke PO referensi (nomor PO tetap baru dari server).
      parent_po_id: !editId && refId ? refId : undefined,
      tanggal: new Date(`${tanggal}T12:00:00`).toISOString(),
      tenggat: tenggat || null,
      catatan: catatan.trim() || null,
      is_tax_enabled: ppnAktif,
      tax_rate: ppnAktif ? 11 : 0,
      items: valid.map((b) => ({
        product_id: b.product_id,
        qty_pesan: qtyPcs(b),
        harga_beli: Number(b.harga) || 0,
        catatan: b.ket.trim() || undefined,
      })),
    };
  };

  /** Simpan PO lalu kirim (status Proses) dan kembali ke Daftar PO. */
  const simpan = async () => {
    if (sibukRef.current) return; // cegah double submit
    const body = payload();
    if (!body) return;
    sibukRef.current = true;
    setSibuk(true);
    try {
      if (editId) {
        // Token Edit — simpan perubahan ke PO yang sama (tanpa kirim ulang).
        await apiPut(`/api/po/${editId}`, body);
        beritahu(`PO ${editInfo?.no_po ?? ''} diperbarui.`);
        selesaiRef.current = true; // simpan sukses → tanpa dialog konfirmasi
        navigasi(`/po/${editId}`);
        return;
      }
      const r = await apiPost<{ data: { id: number; no_po: string } }>('/api/po', body);
      await apiPost(`/api/po/${r.data.id}/kirim`, {});
      beritahu(`PO Berhasil Dibuat (${r.data.no_po}).`);
      selesaiRef.current = true; // simpan sukses → tanpa dialog konfirmasi
      navigasi('/po');
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      sibukRef.current = false;
      setSibuk(false);
    }
  };

  /* ------------- Garda navigasi: perubahan belum disimpan ---------------- */
  // Sidik form = header + seluruh baris keranjang. Dibandingkan dengan sidik
  // awal agar halaman Edit PO yang baru terbuka (data termuat dari server)
  // TIDAK langsung dianggap kotor, sementara form kosong juga tidak.
  const selesaiRef = useRef(false);
  const awalSidikRef = useRef<string | null>(null);
  const sidik = JSON.stringify({
    supplier,
    gudang,
    noPo,
    tanggal,
    tenggat,
    catatan,
    ppnAktif,
    items: items.map((b) => [b.kunci, b.pcs, b.harga, b.ket]),
  });
  useEffect(() => {
    if (awalSidikRef.current !== null) return;
    if (editId && !editInfo) return; // tunggu PO termuat
    if (!editId && !gudang) return; // tunggu gudang bawaan sesi
    awalSidikRef.current = sidik;
  }, [sidik, editId, editInfo, gudang]);
  const kotor = !selesaiRef.current && awalSidikRef.current !== null && awalSidikRef.current !== sidik;
  const kotorRef = useRef(kotor);
  kotorRef.current = kotor;

  /** Tombol merah dialog: buang semua inputan lalu lanjut ke halaman tujuan. */
  const buangForm = (): void => {
    setItems([]);
    setSupplier('');
    setNoPo('');
    setTenggat('');
    setCatatan('');
    setPpnAktif(false);
  };

  const { garda, minta } = useGardaForm({
    aktif: kotor,
    mode: 'tinggalkan',
    judul: 'Perubahan Belum Disimpan',
    pesan:
      'Data penginputan Purchase Order saat ini belum disimpan. Apakah Anda yakin ingin meninggalkan halaman ini dan menghapus inputan?',
    simpan: async () => {
      await simpan();
    },
    masihKotor: () => kotorRef.current,
    buang: buangForm,
  });

  return (
    <div className="halaman po-modul">
      {garda}
      <div className="po-bar">
        <h2>
          {editId
            ? `Edit Purchase Order ${editInfo?.no_po ?? ''}`
            : refId
              ? `Buat PO Susulan${refInfo ? ` dari ${refInfo.no_po}` : ''}`
              : 'Buat Purchase Order'}
        </h2>
        <div className="po-bar__aksi">
          <Link className="hub-btn hub-btn--gelap" to="/po" title="Kembali ke Daftar PO">
            ‹ Kembali ke Daftar PO
          </Link>
        </div>
      </div>
      <section className="kartu">
        <div className="po-buat-bar">
          <div className="po-pengaturan-grup">
            <label className="po-pengaturan" title={`Kolom Kodi sebagai pembantu konversi (1 kodi = ${isiKodi} pcs). Preferensi tersimpan di perangkat ini.`}>
              <span aria-hidden="true">⚙️</span>
              <span className="po-saklar">
                <input type="checkbox" checked={kodiAktif} onChange={(e) => setKodiAktif(e.target.checked)} aria-label="Tampilkan Satuan Kodi" />
                <span className="po-saklar__rel" aria-hidden="true" />
              </span>
              <span>Tampilkan Satuan Kodi</span>
            </label>
            <label className="po-pengaturan" title="Bila aktif, baris ber-Qty 0 boleh ada di tabel (subtotal Rp 0) dan otomatis tidak ikut tersimpan saat Simpan/Kirim. Preferensi tersimpan di perangkat ini.">
              <span className="po-saklar">
                <input type="checkbox" checked={qtyNolAktif} onChange={(e) => setQtyNolAktif(e.target.checked)} aria-label="Izinkan Qty 0" />
                <span className="po-saklar__rel" aria-hidden="true" />
              </span>
              <span>Izinkan Qty 0</span>
            </label>
            <label className="po-pengaturan" title="Bila aktif, faktur PO menghitung PPN 11% di atas subtotal barang diterima (Grand Total = Subtotal + PPN).">
              <span className="po-saklar">
                <input type="checkbox" checked={ppnAktif} onChange={(e) => setPpnAktif(e.target.checked)} aria-label="Terapkan PPN 11%" />
                <span className="po-saklar__rel" aria-hidden="true" />
              </span>
              <span>Terapkan PPN (11%)</span>
            </label>
          </div>
        </div>

        <div className="po-filter po-buat-grid">
          <label className="bidang">
            <span>Pemasok *</span>
            <select value={supplier} onChange={(e) => setSupplier(e.target.value)} aria-label="Pemasok">
              <option value="">— Pilih pemasok —</option>
              {opsiSupplier.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className="bidang" title={gudangTerkunci !== null ? TIP_GUDANG_TERKUNCI : undefined}>
            <span>Gudang tujuan{gudangTerkunci !== null ? ' 🔒' : ''}</span>
            <select
              value={gudang}
              onChange={(e) => setGudang(e.target.value)}
              aria-label="Gudang tujuan"
              disabled={gudangTerkunci !== null}
            >
              <option value="">— Gudang bawaan —</option>
              {opsiGudang.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className="bidang" title="Opsional. Kosongkan agar sistem membuat nomor unik otomatis (PO-YYYYMM-0001). Bila nomor yang Anda isi sudah dipakai, sistem memakai nomor otomatis berikutnya.">
            <span>No. PO (opsional)</span>
            <input
              value={noPo}
              onChange={(e) => setNoPo(e.target.value)}
              placeholder="Otomatis — PO-YYYYMM-0001"
              aria-label="Nomor PO (opsional)"
              maxLength={40}
              disabled={Boolean(editId)}
            />
          </label>
          <label className="bidang">
            <span>Tanggal</span>
            <input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} aria-label="Tanggal PO" />
          </label>
          {/* Satu baris dua kolom 50:50: Tenggat di kiri, Catatan di kanan. */}
          <div className="po-baris-dua">
            <label className="bidang" title="Batas periode PO — bila terlewati & barang belum lengkap, muncul badge Lewat tenggat (opsional).">
              <span>Tenggat (opsional)</span>
              <input type="date" value={tenggat} min={tanggal} onChange={(e) => setTenggat(e.target.value)} aria-label="Tanggal tenggat PO" />
            </label>
            <label className="bidang">
              <span>Catatan (opsional)</span>
              <input value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Catatan untuk pemasok" maxLength={400} aria-label="Catatan PO (opsional)" />
            </label>
          </div>
        </div>

        {refInfo && (
          <div className="po-susulan-banner" role="note">
            <span className="teks-redup teks-kecil">
              🔗 PO referensi <strong>{refInfo.no_po}</strong> — pemasok, gudang, dan catatan sudah terisi otomatis.
              Tenggat dikosongkan agar Anda menentukan tanggal baru.
            </span>
            {refInfo.sisa > 0 && (
              <button
                type="button"
                className="tombol tombol--netral tombol--kecil"
                onClick={muatSisaReferensi}
                disabled={refSibuk}
                title="Masukkan semua barang yang belum datang dari PO referensi"
              >
                📋 Muat Sisa Barang Belum Datang dari {refInfo.no_po} ({refInfo.sisa} Item)
              </button>
            )}
          </div>
        )}

        <div className="po-buat-keranjang">
          {!supplier ? (
            <div className="cari-barang cari-barang--nonaktif">
              <input className="cari-barang__input" placeholder="Cari / scan: kode item, nama, SKU, barcode..." disabled aria-label="Cari barang" />
              <p className="cari-barang__hint">Pilih pemasok dulu</p>
            </div>
          ) : (
            <CariBarang
              posisi={{ supplier_id: supplier, gudang_id: gudang }}
              aktif={true}
              fokusToken={fokusCari}
              onPilih={tambah}
              onTanggaBawah={keTabel}
              onProdukBaru={(teks) => beritahu(`"${teks}" belum terdaftar — daftarkan dulu di Master Data › Produk.`, 'info')}
            />
          )}
          <p className="teks-redup teks-kecil" style={{ marginTop: 6 }}>
            ↑↓: Pilih barang | Enter: Tambah (fokus tetap di kolom cari) | Tab/↓ (kosong): ke tabel | Enter di Qty: kembali ke cari
          </p>
        </div>

        {items.length === 0 ? (
          <div className="po-kosong" style={{ marginTop: 12 }}>
            <div className="po-kosong-ikon" aria-hidden="true">🧺</div>
            <strong>Keranjang masih kosong</strong>
            <p>Ketik nama barang di kolom cari, lalu tap hasil untuk masuk keranjang.</p>
          </div>
        ) : (
          <div className="tabel-bungkus po-tabel-gulir" ref={tabelRef} style={{ marginTop: 12 }}>
            <table className="tabel po-tabel tabel-transaksi">
              <thead>
                <tr>
                  <th>Barang</th>
                  <th className="rata-kanan">Pcs</th>
                  {kodiAktif && <th className="rata-kanan">Konversi kodi</th>}
                  <th className="rata-kanan">Harga beli</th>
                  <th>Keterangan</th>
                  <th className="rata-kanan">Subtotal</th>
                  <th className="rata-tengah">Aksi</th>
                </tr>
              </thead>
              <tbody onFocusCapture={(e) => gulirBarisDalamWadah(e.target as HTMLElement)}>
                {items.map((b, idx) => (
                  <tr key={b.kunci}>
                    <td data-label="Barang">
                      <strong>{b.nama}</strong>
                      <div className="teks-redup teks-kecil">{b.kode}</div>
                    </td>
                    <td data-label="Pcs" className="rata-kanan">
                      <span className="po-kodi">
                        <input
                          type="number" min={0} value={b.pcs} aria-label={`Pcs ${b.nama}`}
                          name="qty"
                          data-po-baris={idx} data-po-kolom="pcs"
                          onKeyDown={(e) => tombolTabel(e, idx, 'pcs')}
                          onChange={(e) => ubahPcs(b.kunci, e.target.value)}
                        />
                        <span className="teks-redup">pcs</span>
                      </span>
                    </td>
                    {kodiAktif && (
                      <td data-label="Konversi kodi" className="rata-kanan">
                        <span className="teks-redup" title={`Otomatis: PCS ÷ ${isiKodi}`}>{teksKonversi(qtyPcs(b))}</span>
                      </td>
                    )}
                    <td data-label="Harga beli" className="rata-kanan">
                      <input
                        type="number" min={0} value={b.harga} aria-label={`Harga ${b.nama}`}
                        data-po-baris={idx} data-po-kolom="harga"
                        onKeyDown={(e) => tombolTabel(e, idx, 'harga')}
                        className="input-angka"
                        style={{ width: '7rem', padding: '0.375rem 0.5rem', border: '1px solid var(--border)', borderRadius: '0.375rem', font: 'inherit', background: 'var(--surface)' }}
                        onChange={(e) => ubah(b.kunci, { harga: e.target.value.replace(/[^0-9]/g, '') })}
                      />
                    </td>
                    <td data-label="Keterangan">
                      <input
                        value={b.ket} aria-label={`Keterangan ${b.nama}`}
                        placeholder="cth: hitam, uk. L…" maxLength={200}
                        data-po-baris={idx} data-po-kolom="ket"
                        onKeyDown={(e) => tombolTabel(e, idx, 'ket')}
                        className="input-angka"
                        style={{ width: '9rem', padding: '0.375rem 0.5rem', border: '1px solid var(--border)', borderRadius: '0.375rem', font: 'inherit', background: 'var(--surface)' }}
                        onChange={(e) => ubah(b.kunci, { ket: e.target.value })}
                      />
                    </td>
                    <td data-label="Subtotal" className="rata-kanan">{formatRupiah(qtyPcs(b) * (Number(b.harga) || 0))}</td>
                    <td data-label="Aksi" className="rata-tengah">
                      <button type="button" className="tombol tombol--kecil tombol--bahaya" onClick={() => hapusBaris(b.kunci)}>
                        Hapus
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="po-footer-sticky kartu">
        <span className="teks-redup teks-kecil">{items.length} item</span>
        <span>Total: <strong>{totalPcs.toLocaleString('id-ID')} Pasang</strong><span className="teks-redup"> / {kodiAktif ? tampilQty(totalPcs, isiKodi, true) : `${totalPcs.toLocaleString('id-ID')} pcs`}</span></span>
        <span className="po-total">
          <span>
            {ppnAktif ? (
              <>
                <span className="teks-redup teks-kecil">Subtotal {formatRupiah(totalHarga)} · PPN 11% {formatRupiah(nilaiPpn)} · </span>
                Total <strong>{formatRupiah(grandTotal)}</strong>
              </>
            ) : (
              <>Total <strong>{formatRupiah(totalHarga)}</strong></>
            )}
          </span>
          <button type="button" className="tombol tombol--netral" disabled={sibuk} onClick={() => minta('/po')}>
            Batal
          </button>
          <button type="button" className="tombol tombol--primer" disabled={sibuk || items.length === 0} onClick={() => void simpan()}>
            {sibuk ? 'Menyimpan…' : editId ? 'Simpan Perubahan' : 'Simpan & Send PO'}
          </button>
        </span>
      </div>
    </div>
  );
}

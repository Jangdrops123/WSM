import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { IconButton } from '../../components/IconButton';
import { TombolScan } from '../../components/ScanKamera';
import { Modal } from '../../components/crud/Modal';
import { beritahu } from '../../components/crud/Toast';
import { apiGet, apiPost, unduhExcel } from '../../lib/api';
import { useSegarkanModul } from '../../lib/segarkan';
import { useSesi } from '../../lib/sesi';
import { can, pesanIzin } from '../../lib/hak';
import { Tip } from '../../components/Tip';
import { formatAngka, formatTanggalWaktu } from '../../lib/format';
import { BeritaAcara, LembarHitung } from './CetakOpname';
import { DialogImporOpname } from './DialogImporOpname';
import { useGardaForm } from '../../lib/gardaForm';
import './opname.css';

type Baris = Record<string, any>;
type Opsi = { id: number; label: string };

const METODE: Record<string, string> = { manual: 'Manual', scan: 'Scan 1 per 1', gabungan: 'Gabungan' };

export function SesiOpname() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const sesiId = Number(id);
  const sesiInfo = useSesi().info;
  // AX — Sahkan = sel Sahkan pada Opname (Top selalu lolos via can()).
  const bolehSahkanIzin = can(sesiInfo, 'opname', 'sahkan');
  const tipSahkan = bolehSahkanIzin ? undefined : pesanIzin(sesiInfo, 'opname', 'sahkan', 'Mengesahkan opname');

  const [sibuk, setSibuk] = useState(true);
  const [sesi, setSesi] = useState<Baris | null>(null);
  const [items, setItems] = useState<Baris[]>([]);
  const [ringkas, setRingkas] = useState<Baris | null>(null);

  const [tab, setTab] = useState<'hitung' | 'tinjau'>('hitung');
  const [cari, setCari] = useState('');
  const [hanyaSelisih, setHanyaSelisih] = useState(false);
  const [draft, setDraft] = useState<Record<number, string>>({});
  /** W1c — baris terpilih/klik (tint --row-selected) & fokus keyboard. */
  const [barisTerpilih, setBarisTerpilih] = useState<number | null>(null);

  // Panel scan
  const [opsiLokasi, setOpsiLokasi] = useState<Opsi[]>([]);
  const [lokasiScan, setLokasiScan] = useState('');
  const [barcode, setBarcode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanTerakhir, setScanTerakhir] = useState<{ nama: string; sku: string; qty: number; waktu: string } | null>(null);
  const [galatScan, setGalatScan] = useState<string | null>(null);
  const inputScan = useRef<HTMLInputElement>(null);
  /** Wadah tabel aktif (hitung/tinjau) — sasaran tombol gulir atas/bawah. */
  const gulirRef = useRef<HTMLDivElement>(null);

  const [modeSahkan, setModeSahkan] = useState(false);
  const [modeImpor, setModeImpor] = useState(false);
  const [sibukAksi, setSibukAksi] = useState(false);
  const [cetak, setCetak] = useState<null | 'lembar' | 'acara'>(null);

  const muat = useCallback(async (senyap = false) => {
    if (!senyap) setSibuk(true);
    try {
      const r = await apiGet<{ data: Baris }>(`/api/opname/${sesiId}`);
      const s = r.data;
      setSesi(s);
      setItems(s.items ?? []);
      setRingkas(s.ringkasan ?? null);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibuk(false);
    }
  }, [sesiId]);

  useEffect(() => {
    void muat();
  }, [muat]);
  // Tombol Refresh global di topbar: muat ulang sesi opname.
  useSegarkanModul(muat);

  // O4 — ?cetak=acara|lembar (dari daftar/laporan) langsung membuka pratinjau cetak.
  const sudahCekCetak = useRef(false);
  useEffect(() => {
    if (!sesi || sudahCekCetak.current) return;
    sudahCekCetak.current = true;
    const c = sp.get('cetak');
    if (c === 'acara' || c === 'lembar') setCetak(c);
  }, [sesi, sp]);

  // Opsi lokasi scan bila sesi mencakup seluruh gudang
  useEffect(() => {
    setOpsiLokasi([]);
    if (!sesi) return;
    if (sesi.location_id) {
      setLokasiScan(String(sesi.location_id));
      return;
    }
    apiGet<{ data: { id: number; kode_lokasi: string }[] }>(`/api/master/lokasi?per=500&warehouse_id=${sesi.warehouse_id}`)
      .then((r) => {
        const opsi = r.data.map((l) => ({ id: Number(l.id), label: l.kode_lokasi }));
        setOpsiLokasi(opsi);
        if (opsi.length > 0) setLokasiScan((prev) => prev || String(opsi[0].id));
      })
      .catch((e: Error) => beritahu(e.message, 'galat'));
  }, [sesi]);

  // AX — hitung/scan/selesai = sel Ubah pada Opname + status sesi.
  const bolehUbah = sesi?.status === 'draft' && sesi?.tahap === 'hitung' && can(sesiInfo, 'opname', 'ubah');
  const bolehTinjau = sesi?.status === 'draft' && sesi?.tahap === 'tinjau';
  const sudahDisahkan = sesi?.status === 'disahkan';

  // --- Scan -----------------------------------------------------------------
  // kodeLangsung: hasil pindaian kamera HP (melewati state input yang async).
  const lakukanScan = async (kodeLangsung?: string) => {
    const kode = (kodeLangsung ?? barcode).trim();
    if (!kode || scanning) return;
    setScanning(true);
    try {
      const r = await apiPost<{ dikenal: boolean; pesan?: string; baris?: Baris }>(`/api/opname/${sesiId}/scan`, {
        barcode: kode,
        location_id: lokasiScan ? Number(lokasiScan) : undefined,
      });
      if (r.dikenal && r.baris) {
        setGalatScan(null);
        setScanTerakhir({
          nama: r.baris.produk ?? `Produk ${r.baris.product_id}`,
          sku: r.baris.sku ?? String(r.baris.product_id),
          qty: Number(r.baris.qty_fisik),
          waktu: new Date().toLocaleTimeString('id-ID'),
        });
        // Buang draft manual produk ini agar tidak menutupi hasil scan saat refresh.
        setDraft((d) => {
          const n = { ...d };
          delete n[r.baris!.product_id];
          return n;
        });
      } else {
        setGalatScan(r.pesan ?? `Barcode "${kode}" tidak dikenal.`);
        setScanTerakhir(null);
      }
      setBarcode('');
      void muat(true);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setScanning(false);
      inputScan.current?.focus();
    }
  };

  const urungkanScan = async () => {
    try {
      await apiPost(`/api/opname/${sesiId}/scan/undo`, {});
      beritahu('Scan terakhir diurungkan.');
      setScanTerakhir(null);
      setGalatScan(null);
      void muat(true);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      inputScan.current?.focus();
    }
  };

  // --- Hitung manual --------------------------------------------------------
  const ubahDraft = (productId: number, nilai: string) => setDraft((d) => ({ ...d, [productId]: nilai }));

  const commitBaris = async (it: Baris) => {
    const nilai = draft[it.product_id];
    if (nilai === undefined) return;
    const qty = Number(nilai);
    if (!Number.isFinite(qty) || qty < 0) {
      beritahu('Stok fisik harus bilangan >= 0.', 'galat');
      return;
    }
    // Baris belum terhitung (qty_fisik masih snapshot 0) tetap dikirim agar ditandai terhitung,
    // meski nilainya sama dengan yang tersimpan.
    const sudahPas = qty === Number(it.qty_fisik) && Number(it.terhitung) === 1;
    if (sudahPas) {
      setDraft((d) => {
        const n = { ...d };
        delete n[it.product_id];
        return n;
      });
      return;
    }
    try {
      await apiPost(`/api/opname/${sesiId}/hitung`, {
        items: [{ product_id: it.product_id, location_id: it.location_id, qty_fisik: qty }],
      });
      setDraft((d) => {
        const n = { ...d };
        delete n[it.product_id];
        return n;
      });
      void muat(true);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    }
  };

  const tampilkanQty = (it: Baris): string => {
    const d = draft[it.product_id];
    if (d !== undefined) return d;
    return Number(it.terhitung) ? String(it.qty_fisik) : '';
  };

  // L1 — unduh template Excel (berisi stok sesi ini) untuk sesi draft.
  const unduhTemplate = () => {
    const q = new URLSearchParams({ isi: 'stok', gudang: String(sesi?.warehouse_id ?? '') });
    if (sesi?.location_id) q.set('lokasi', String(sesi.location_id));
    void unduhExcel(`/api/opname/template?${q.toString()}`, 'template-opname-stok-terkini.xlsx').catch((e: Error) =>
      beritahu(e.message, 'galat'),
    );
  };

  // --- Tahap ----------------------------------------------------------------
  const selesaiHitung = async () => {
    try {
      await apiPost(`/api/opname/${sesiId}/selesai`, {});
      beritahu('Penghitungan selesai — periksa selisih sebelum disahkan.');
      setTab('tinjau');
      await muat(true);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    }
  };

  const bukaKembali = async () => {
    try {
      await apiPost(`/api/opname/${sesiId}/buka`, {});
      setTab('hitung');
      await muat(true);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    }
  };

  const sahkan = async () => {
    setSibukAksi(true);
    try {
      const r = await apiPost<{ penyesuaian: { jumlah_baris: number; nilai_lebih: number; nilai_kurang: number; jurnal_id: number | null } }>(
        `/api/opname/${sesiId}/sahkan`,
        {},
      );
      beritahu(`Opname disahkan — ${r.penyesuaian.jumlah_baris} baris disesuaikan lewat kartu stok & jurnal.`);
      setModeSahkan(false);
      await muat();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibukAksi(false);
    }
  };

  // --- Penyaringan tabel ----------------------------------------------------
  // Garda navigasi: draft hitung yang belum dikomit ikut tersimpan dulu.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const { garda, minta } = useGardaForm({
    aktif: Object.keys(draft).length > 0,
    simpan: async () => {
      const antre = items.filter((it) => draftRef.current[it.product_id] !== undefined);
      for (const it of antre) await commitBaris(it);
    },
    masihKotor: () => Object.keys(draftRef.current).length > 0,
    buang: () => setDraft({}),
    labelSimpan: 'Simpan & Pindah',
  });

  const terlihat = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return items.filter((it) => {
      if (hanyaSelisih && (Number(it.terhitung) === 0 || Number(it.selisih) === 0)) return false;
      if (!q) return true;
      return (
        String(it.sku ?? '').toLowerCase().includes(q) ||
        String(it.barcode ?? '').toLowerCase().includes(q) ||
        String(it.produk ?? '').toLowerCase().includes(q) ||
        String(it.size ?? '').toLowerCase().includes(q) ||
        String(it.warna ?? '').toLowerCase().includes(q)
      );
    });
  }, [items, cari, hanyaSelisih]);

  const itemTerakhir = scanTerakhir;
  const belumDihitung = (ringkas?.belum ?? 0) as number;

  // W1f — Qty sistem & Qty fisik dihitung dari data YANG SAMA dengan tabel
  // (seluruh baris; kolom stok fisik kosong = 0) dan diperbarui real-time saat
  // qty fisik diisi lewat draft.
  const qtySistemTabel = useMemo(
    () => items.reduce((a, it) => a + Number(it.qty_sistem || 0), 0),
    [items],
  );
  const qtyFisikTabel = useMemo(
    () =>
      items.reduce((a, it) => {
        const d = draft[it.product_id];
        if (d !== undefined && d !== '') {
          const n = Number(d);
          return a + (Number.isFinite(n) && n >= 0 ? n : 0);
        }
        return a + (Number(it.terhitung) ? Number(it.qty_fisik) : 0);
      }, 0),
    [items, draft],
  );

  /** Pindah ke input stok fisik baris berikutnya setelah Enter (W1d). */
  const fokusBarisBerikut = (indeks: number) => {
    const semua = Array.from(document.querySelectorAll<HTMLInputElement>('.opname-input-fisik'));
    const berikut = semua[indeks + 1];
    if (berikut) {
      berikut.focus();
      berikut.select();
    }
  };

  if (sibuk && !sesi) {
    return (
      <div className="halaman">
        <section className="kartu"><p className="teks-redup">Memuat sesi opname…</p></section>
      </div>
    );
  }
  if (!sesi) {
    return (
      <div className="halaman">
        <section className="kartu">
          <p>Sesi opname tidak ditemukan.</p>
          <button type="button" className="tombol" onClick={() => minta('/stok/opname')}>← Kembali ke daftar</button>
        </section>
      </div>
    );
  }

  return (
    <div className="halaman halaman--fit">
      <section className="kartu opname-sesi">
        <div className="kartu__kepala kartu__kepala--kompak">
          <div>
            <h3>
              Opname <code>{sesi.no_dokumen}</code>{' '}
              <span className={`lencana ${sudahDisahkan ? 'lencana--aktif' : sesi.status === 'batal' ? 'lencana--bahaya' : bolehTinjau ? 'lencana--netral' : 'lencana--peringatan'}`}>
                {sudahDisahkan ? 'Disahkan' : sesi.status === 'batal' ? 'Dibatalkan' : bolehTinjau ? 'Tinjau Selisih' : 'Menghitung'}
              </span>
            </h3>
            <p className="teks-redup teks-kecil">
              {sesi.gudang_kode} — {sesi.gudang_nama}
              {sesi.lokasi_kode ? ` · Lokasi ${sesi.lokasi_kode}` : ' · Seluruh gudang'} · {formatTanggalWaktu(sesi.tanggal)} · Metode {METODE[sesi.metode] ?? sesi.metode} · PJ {sesi.penanggung_jawab ?? '—'}
            </p>
          </div>
          <div className="tombol-baris">
            <button type="button" className="tombol tombol--netral" onClick={() => minta('/stok/opname')}>← Daftar</button>
            {sesi.status === 'draft' && (
              <>
                <IconButton ikon="upload" label="Impor Excel ke sesi ini" ukuran="toolbar" onClick={() => setModeImpor(true)} />
                <IconButton ikon="download" label="Unduh Template" ukuran="toolbar" onClick={unduhTemplate} />
              </>
            )}
            <button type="button" className="tombol tombol--netral" onClick={() => setCetak('lembar')}>Cetak Lembar Hitung</button>
            {(bolehTinjau || sudahDisahkan) && (
              <button type="button" className="tombol tombol--netral" onClick={() => setCetak('acara')}>Cetak Berita Acara</button>
            )}
            {bolehTinjau && (
              <>
                <button type="button" className="tombol tombol--netral" onClick={() => void bukaKembali()}>Kembali Hitung</button>
                <Tip teks={tipSahkan ?? ''}>
                  <button type="button" className="tombol" onClick={() => setModeSahkan(true)} disabled={!bolehSahkanIzin}>Setujui &amp; Sahkan</button>
                </Tip>
              </>
            )}
            {bolehUbah && (
              <span title={(ringkas?.dihitung ?? 0) === 0 ? 'Hitung semua baris dulu' : undefined}>
                <button type="button" className="tombol" onClick={() => void selesaiHitung()} disabled={(ringkas?.dihitung ?? 0) === 0}>
                  Selesai Hitung →
                </button>
              </span>
            )}
          </div>
        </div>

        {/* Ringkasan atas */}
        <div className="opname-ringkas">
          <span className="kartu-ringkas">Baris: <strong>{formatAngka(ringkas?.jumlah ?? 0)}</strong></span>
          <span className="kartu-ringkas">Dihitung: <strong>{formatAngka(ringkas?.dihitung ?? 0)}</strong></span>
          <span className={`kartu-ringkas ${belumDihitung > 0 ? 'kartu-ringkas--bahaya' : ''}`}>Belum: <strong>{formatAngka(belumDihitung)}</strong></span>
          <span className="kartu-ringkas kartu-ringkas--sukses">Selisih lebih: <strong>+{formatAngka(ringkas?.selisih_lebih ?? 0)}</strong></span>
          <span className="kartu-ringkas kartu-ringkas--bahaya">Selisih kurang: <strong>−{formatAngka(ringkas?.selisih_kurang ?? 0)}</strong></span>
          <span className="kartu-ringkas">Qty sistem: <strong>{formatAngka(qtySistemTabel)}</strong></span>
          <span className="kartu-ringkas">Qty fisik: <strong>{formatAngka(qtyFisikTabel)}</strong></span>
        </div>

        {sudahDisahkan && (
          <div className="opname-banner opname-banner--sukses">
            Opname disahkan{sesi.disetujui_oleh_nama ? ` oleh ${sesi.disetujui_oleh_nama}` : ''}{sesi.disetujui_pada ? ` pada ${formatTanggalWaktu(sesi.disetujui_pada)}` : ''}.
            Selisih sudah disesuaikan lewat kartu stok dan jurnal penyesuaian persediaan.
          </div>
        )}
        {sesi.status === 'batal' && <div className="opname-banner opname-banner--bahaya">Sesi ini dibatalkan — tidak menggerakkan stok.</div>}

        {/* Panel scan — hanya pada tahap hitung */}
        {bolehUbah && (
          <div className="opname-scan">
            <div className="opname-scan__input">
              <label htmlFor="opname-scan-input">Scan barcode (Enter untuk tambah 1)</label>
              <input
                id="opname-scan-input"
                ref={inputScan}
                type="text"
                value={barcode}
                placeholder="Pindai barcode produk…"
                onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void lakukanScan();
                  }
                }}
                autoFocus
              />
              {opsiLokasi.length > 0 && (
                <select value={lokasiScan} onChange={(e) => setLokasiScan(e.target.value)} aria-label="Lokasi penempatan scan">
                  {opsiLokasi.map((o) => (<option key={o.id} value={o.id}>{o.label}</option>))}
                </select>
              )}
              <TombolScan
                label="Pindai dengan kamera HP"
                judul="Pindai barcode produk"
                mode="berkelanjutan"
                onHasil={(t) => { setBarcode(t); void lakukanScan(t); }}
              />
              <button type="button" className="tombol" onClick={() => void lakukanScan()} disabled={scanning || !barcode.trim()}>
                {scanning ? 'Memindai…' : 'Scan'}
              </button>
              <button type="button" className="tombol tombol--netral" onClick={() => void urungkanScan()}>
                Undo Scan Terakhir
              </button>
            </div>
            {itemTerakhir && (
              <div className="opname-scan__terakhir">
                Terakhir: <strong>{itemTerakhir.nama}</strong> ({itemTerakhir.sku}) — qty fisik kini <strong>{formatAngka(itemTerakhir.qty)}</strong> · {itemTerakhir.waktu}
              </div>
            )}
            {galatScan && <div className="opname-scan__galat">⚠ {galatScan} — barcode tidak dikenal, tidak menambah hitungan.</div>}
            {Number(sesi.scan_tak_dikenal) > 0 && (
              <div className="opname-scan__galat">{formatAngka(Number(sesi.scan_tak_dikenal))} scan barcode tak dikenal tercatat pada sesi ini.</div>
            )}
          </div>
        )}

        {/* Tab */}
        <div className="opname-tab">
          <button type="button" className={`opname-tab__tombol ${tab === 'hitung' ? 'opname-tab__tombol--aktif' : ''}`} onClick={() => setTab('hitung')}>
            Hitung
            <span className="opname-tab__jumlah">{formatAngka(ringkas?.dihitung ?? 0)}/{formatAngka(ringkas?.jumlah ?? 0)}</span>
          </button>
          <button type="button" className={`opname-tab__tombol ${tab === 'tinjau' ? 'opname-tab__tombol--aktif' : ''}`} onClick={() => setTab('tinjau')}>
            Tinjau Selisih
            <span className="opname-tab__jumlah">{formatAngka((ringkas?.selisih_lebih ?? 0) + (ringkas?.selisih_kurang ?? 0))}</span>
          </button>
        </div>

        {tab === 'hitung' && (
          <>
            <div className="alat-tabel">
              <div className="cari-scan">
              <input className="input-cari" type="search" placeholder="Cari SKU, barcode, nama, size…" value={cari} onChange={(e) => setCari(e.target.value)} />
              <TombolScan onHasil={setCari} />
              </div>
              <IconButton ikon="chevron-up" label="Gulir tabel ke atas" ukuran="toolbar" onClick={() => gulirRef.current?.scrollTo({ top: 0, behavior: 'smooth' })} />
              <IconButton ikon="chevron-down" label="Gulir tabel ke bawah" ukuran="toolbar" onClick={() => gulirRef.current?.scrollTo({ top: gulirRef.current.scrollHeight, behavior: 'smooth' })} />
              <IconButton ikon="rotate-ccw" label="Muat ulang data sesi" ukuran="toolbar" onClick={() => void muat(true)} />
              <label className="opname-cek">
                <input type="checkbox" checked={hanyaSelisih} onChange={(e) => setHanyaSelisih(e.target.checked)} /> Hanya baris selisih
              </label>
              {Object.keys(draft).length > 0 && (
                <span className="teks-redup teks-kecil">{Object.keys(draft).length} perubahan belum disimpan (klik luar kolom untuk simpan)</span>
              )}
            </div>
            <div className="tabel-bungkus opname-tabel-bungkus sembunyi-hp" ref={gulirRef}>
              <table className="tabel opname-tabel">
                <thead>
                  <tr>
                    <th>Produk</th>
                    <th>SKU</th>
                    <th>Lokasi</th>
                    <th className="rata-kanan">Stok sistem</th>
                    <th className="rata-kanan">Stok fisik</th>
                    <th className="rata-kanan">Selisih</th>
                  </tr>
                </thead>
                <tbody>
                  {terlihat.length === 0 ? (
                    <tr><td colSpan={6} className="tabel-kosong">Tidak ada baris yang cocok.</td></tr>
                  ) : (
                    terlihat.map((it, idx) => {
                      const adaDraft = draft[it.product_id] !== undefined;
                      const fisikTampil = tampilkanQty(it);
                      const selisihTampil = Number(it.terhitung) || adaDraft
                        ? (adaDraft ? Number(draft[it.product_id]) - Number(it.qty_sistem) : Number(it.selisih))
                        : null;
                      const selisihCls = selisihTampil !== null && selisihTampil !== 0
                        ? (selisihTampil > 0 ? 'opname-baris-lebih' : 'opname-baris-kurang')
                        : '';
                      const kelasBaris = [
                        Number(it.terhitung) ? '' : 'opname-baris-belum',
                        selisihCls,
                        barisTerpilih === it.id ? 'baris-terpilih' : '',
                      ]
                        .filter(Boolean)
                        .join(' ');
                      return (
                        <tr
                          key={it.id}
                          className={kelasBaris}
                          tabIndex={0}
                          onClick={() => setBarisTerpilih(it.id)}
                        >
                          <td className="pos-td-nama">
                            {it.produk}
                            {!Number(it.terhitung) && <span className="opname-lencana opname-lencana--belum">Belum</span>}
                            {Number(it.terhitung) && Number(it.selisih) === 0 && (
                              <span className="opname-lencana opname-lencana--sesuai">Sesuai</span>
                            )}
                          </td>
                          <td><code>{it.sku}</code></td>
                          <td className="teks-kecil pos-td-lokasi">{it.kode_lokasi ?? '—'}</td>
                          <td className="rata-kanan">{formatAngka(Number(it.qty_sistem))}</td>
                          <td className="rata-kanan">
                            {bolehUbah ? (
                              <input
                                className="opname-input-fisik"
                                type="number"
                                min={0}
                                step="any"
                                inputMode="numeric"
                                value={fisikTampil}
                                placeholder="—"
                                onChange={(e) => ubahDraft(it.product_id, e.target.value)}
                                onBlur={() => void commitBaris(it)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    void commitBaris(it).then(() => fokusBarisBerikut(idx));
                                  } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                    // W1d — panah atas/bawah mengubah angka (kelipatan 1).
                                    e.preventDefault();
                                    const kini = Number(draft[it.product_id] ?? it.qty_fisik ?? 0) || 0;
                                    const langkah = e.key === 'ArrowUp' ? 1 : -1;
                                    ubahDraft(it.product_id, String(Math.max(0, kini + langkah)));
                                  }
                                }}
                                aria-label={`Stok fisik ${it.sku}`}
                              />
                            ) : (
                              <span>{Number(it.terhitung) ? formatAngka(Number(it.qty_fisik)) : '—'}</span>
                            )}
                          </td>
                          <td className={`rata-kanan ${selisihTampil === null || selisihTampil === 0 ? '' : selisihTampil > 0 ? 'opname-lebih' : 'opname-kurang'}`}>
                            {selisihTampil === null
                              ? '—'
                              : selisihTampil > 0
                                ? `↑ +${formatAngka(selisihTampil)}`
                                : selisihTampil < 0
                                  ? `↓ ${formatAngka(selisihTampil)}`
                                  : formatAngka(0)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {/* MOBILE OTOMATIS — baris hitung jadi kartu, input fisik tetap bisa diisi. */}
            <div className="hp-daftar">
              {terlihat.length === 0 ? (
                <div className="hp-kartu"><div className="hp-kartu__sub">Tidak ada baris yang cocok.</div></div>
              ) : (
                terlihat.map((it) => {
                  const adaDraftHp = draft[it.product_id] !== undefined;
                  const fisikHp = tampilkanQty(it);
                  const selisihHp = Number(it.terhitung) || adaDraftHp
                    ? (adaDraftHp ? Number(draft[it.product_id]) - Number(it.qty_sistem) : Number(it.selisih))
                    : null;
                  return (
                    <article className={`hp-kartu ${barisTerpilih === it.id ? 'hp-kartu--aktif' : ''}`} key={`hp-hitung-${it.id}`} onClick={() => setBarisTerpilih(it.id)}>
                      <div className="hp-kartu__atas">
                        <span className="hp-kartu__kode">{it.sku}</span>
                        <span className="hp-kartu__kanan">{it.kode_lokasi ?? '—'}</span>
                      </div>
                      <div className="hp-kartu__nama">{it.produk} {!Number(it.terhitung) && <span className="lencana lencana--peringatan">Belum</span>}{Number(it.terhitung) > 0 && Number(it.selisih) === 0 && <span className="lencana lencana--aktif">Sesuai</span>}</div>
                      <div className="hp-grid">
                        <div className="hp-sel"><div className="hp-label">Sistem</div><div className="hp-nilai">{formatAngka(Number(it.qty_sistem))}</div></div>
                        <div className="hp-sel"><div className="hp-label">Selisih</div><div className="hp-nilai">{selisihHp === null ? '—' : selisihHp > 0 ? `↑ +${formatAngka(selisihHp)}` : selisihHp < 0 ? `↓ ${formatAngka(selisihHp)}` : formatAngka(0)}</div></div>
                        <div className="hp-sel hp-sel--penuh"><div className="hp-label">Stok fisik</div>
                          {bolehUbah ? (
                            <input
                              className="opname-input-fisik hp-input-fisik"
                              type="number"
                              min={0}
                              step="any"
                              inputMode="numeric"
                              value={fisikHp}
                              placeholder="—"
                              onChange={(e) => ubahDraft(it.product_id, e.target.value)}
                              onBlur={() => void commitBaris(it)}
                              aria-label={`Stok fisik ${it.sku}`}
                            />
                          ) : (
                            <div className="hp-nilai">{Number(it.terhitung) ? formatAngka(Number(it.qty_fisik)) : '—'}</div>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </>
        )}

        {tab === 'tinjau' && (
          <>
            {belumDihitung > 0 && (
              <div className="opname-banner opname-banner--peringatan">
                {formatAngka(belumDihitung)} baris belum dihitung — mereka dianggap sesuai sistem dan tidak disesuaikan. Lanjutkan penghitungan bila perlu.
              </div>
            )}
            <div className="tabel-bungkus opname-tabel-bungkus sembunyi-hp" ref={gulirRef}>
              <table className="tabel opname-tabel">
                <thead>
                  <tr>
                    <th>Produk</th>
                    <th>SKU</th>
                    <th>Lokasi</th>
                    <th className="rata-kanan">Sistem</th>
                    <th className="rata-kanan">Fisik</th>
                    <th className="rata-kanan">Selisih</th>
                    <th className="rata-kanan">Nilai</th>
                  </tr>
                </thead>
                <tbody>
                  {items.filter((it) => Number(it.terhitung) && Number(it.selisih) !== 0).length === 0 ? (
                    <tr><td colSpan={7} className="tabel-kosong">Tidak ada selisih — seluruh baris yang dihitung sesuai sistem.</td></tr>
                  ) : (
                    items
                      .filter((it) => Number(it.terhitung) && Number(it.selisih) !== 0)
                      .sort((a, b) => Math.abs(Number(b.selisih)) - Math.abs(Number(a.selisih)))                          .map((it) => {
                            const nilai = Math.abs(Number(it.selisih)) * Number(it.rata ?? 0);
                            return (
                              <tr key={it.id} className={Number(it.selisih) > 0 ? 'opname-baris-lebih' : 'opname-baris-kurang'}>
                                <td className="pos-td-nama">{it.produk}</td>
                                <td><code>{it.sku}</code></td>
                                <td className="teks-kecil pos-td-lokasi">{it.kode_lokasi ?? '—'}</td>
                                <td className="rata-kanan">{formatAngka(Number(it.qty_sistem))}</td>
                                <td className="rata-kanan">{formatAngka(Number(it.qty_fisik))}</td>
                                <td className={`rata-kanan ${Number(it.selisih) > 0 ? 'opname-lebih' : 'opname-kurang'}`}>
                                  {Number(it.selisih) > 0 ? `↑ +${formatAngka(Number(it.selisih))}` : `↓ ${formatAngka(Number(it.selisih))}`}
                                </td>
                            <td className="rata-kanan">{formatAngka(nilai)}</td>
                          </tr>
                        );
                      })
                  )}
                </tbody>
              </table>
            </div>
            {/* MOBILE OTOMATIS — selisih jadi kartu (<=767px). */}
            <div className="hp-daftar">
              {items.filter((it) => Number(it.terhitung) && Number(it.selisih) !== 0).length === 0 ? (
                <div className="hp-kartu"><div className="hp-kartu__sub">Tidak ada selisih — seluruh baris yang dihitung sesuai sistem.</div></div>
              ) : (
                items
                  .filter((it) => Number(it.terhitung) && Number(it.selisih) !== 0)
                  .sort((a, b) => Math.abs(Number(b.selisih)) - Math.abs(Number(a.selisih)))
                  .map((it) => {
                    const nilaiHp = Math.abs(Number(it.selisih)) * Number(it.rata ?? 0);
                    return (
                      <article className="hp-kartu" key={`hp-tinjau-${it.id}`}>
                        <div className="hp-kartu__atas">
                          <span className="hp-kartu__kode">{it.sku}</span>
                          <span className="hp-kartu__kanan">{it.kode_lokasi ?? '—'}</span>
                        </div>
                        <div className="hp-kartu__nama">{it.produk}</div>
                        <div className="hp-grid">
                          <div className="hp-sel"><div className="hp-label">Sistem</div><div className="hp-nilai">{formatAngka(Number(it.qty_sistem))}</div></div>
                          <div className="hp-sel"><div className="hp-label">Fisik</div><div className="hp-nilai">{formatAngka(Number(it.qty_fisik))}</div></div>
                          <div className="hp-sel"><div className="hp-label">Selisih</div><div className="hp-nilai">{Number(it.selisih) > 0 ? `↑ +${formatAngka(Number(it.selisih))}` : `↓ ${formatAngka(Number(it.selisih))}`}</div></div>
                          <div className="hp-sel"><div className="hp-label">Nilai</div><div className="hp-nilai">{formatAngka(nilaiHp)}</div></div>
                        </div>
                      </article>
                    );
                  })
              )}
            </div>
            <p className="teks-redup teks-kecil" style={{ marginTop: 8 }}>
              Penyesuaian akan menggerakkan stok lewat kartu stok (tipe opname) dan membuat jurnal penyesuaian persediaan (Debit/Kredit 1200 Persediaan ↔ 5102 Selisih Opname) sesuai rata-rata bergerak tiap lokasi.
            </p>
          </>
        )}

        {/* Kaki kartu terkunci di dasar (flex-shrink 0): ringkasan baris, tidak ikut gulir. */}
        <div className="opname-kaki">
          <span>
            {tab === 'hitung'
              ? `Menampilkan ${formatAngka(terlihat.length)} dari ${formatAngka(items.length)} baris`
              : `${formatAngka(items.filter((it) => Number(it.terhitung) && Number(it.selisih) !== 0).length)} baris berselisih dari ${formatAngka(items.length)} baris`}
          </span>
          {Object.keys(draft).length > 0 && <span>{formatAngka(Object.keys(draft).length)} perubahan belum disimpan</span>}
        </div>
      </section>
      {garda}

      {/* L1 — wizard Impor Excel (4 langkah) — sesi ini jadi tujuan langsung */}
      {modeImpor && (
        <DialogImporOpname
          sesiAwal={sesiId}
          tutup={() => setModeImpor(false)}
          selesai={() => void muat(true)}
        />
      )}

      {/* AW5 — Modal sahkan: konfirmasi biasa tanpa PIN */}
      {modeSahkan && (
        <Modal
          lebar="kecil"
          judul="Sahkan Opname"
          onTutup={() => setModeSahkan(false)}
          sedangKirim={sibukAksi}
          aksi={
            <div className="tombol-baris">
              <button type="button" className="tombol tombol--netral" onClick={() => setModeSahkan(false)} disabled={sibukAksi}>Batal</button>
              <button type="button" className="tombol" onClick={() => void sahkan()} disabled={sibukAksi}>
                {sibukAksi ? 'Mengesahkan…' : 'Sahkan & Terapkan Penyesuaian'}
              </button>
            </div>
          }
        >
          {(() => {
            const selisih = items.filter((it) => Number(it.terhitung) && Number(it.selisih) !== 0);
            const nLebih = selisih.filter((it) => Number(it.selisih) > 0);
            const nKurang = selisih.filter((it) => Number(it.selisih) < 0);
            const qtyLebih = nLebih.reduce((a, it) => a + Number(it.selisih), 0);
            const qtyKurang = nKurang.reduce((a, it) => a + Math.abs(Number(it.selisih)), 0);
            const nilai = selisih.reduce((a, it) => a + Math.abs(Number(it.selisih)) * Number(it.rata ?? 0), 0);
            return (
              <div>
                <p className="teks-redup teks-kecil">
                  Mengesahkan akan menyesuaikan stok sistem mengikuti stok fisik untuk {formatAngka(selisih.length)} baris berselisih dan mencatat jurnal penyesuaian. Tindakan ini mengunci sesi.
                </p>
                <ul className="teks-kecil" style={{ marginTop: 8 }}>
                  <li>Baris berselisih: <strong>{formatAngka(selisih.length)}</strong> (lebih {formatAngka(nLebih.length)}, kurang {formatAngka(nKurang.length)})</li>
                  <li>Total selisih qty: <strong>+{formatAngka(qtyLebih)} / −{formatAngka(qtyKurang)}</strong></li>
                  <li>Nilai selisih (Rp): <strong>{formatAngka(Math.round(nilai))}</strong></li>
                </ul>
              </div>
            );
          })()}
        </Modal>
      )}

      {/* Pratinjau cetak + window.print() */}
      {cetak && (
        <div className="opname-cetak-overlay">
          <div className="opname-cetak-wadah">
            {cetak === 'lembar' ? <LembarHitung sesi={sesi} items={items} /> : <BeritaAcara sesi={sesi} items={items} />}
          </div>
          <div className="opname-cetak-aksi">
            <button type="button" className="tombol" onClick={() => window.print()}>Cetak / Simpan PDF</button>
            <button type="button" className="tombol tombol--netral" onClick={() => setCetak(null)}>Tutup</button>
          </div>
        </div>
      )}
    </div>
  );
}

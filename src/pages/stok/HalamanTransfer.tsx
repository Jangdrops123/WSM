import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '../../components/crud/Modal';
import { beritahu } from '../../components/crud/Toast';
import { ambilOpsi, apiGet, apiPost, apiPut } from '../../lib/api';
import { useSegarkanModul } from '../../lib/segarkan';
import { formatAngka, formatTanggalWaktu } from '../../lib/format';
import { IconButton } from '../../components/IconButton';
import { TombolScan } from '../../components/ScanKamera';
import { FooterDaftar } from '../../components/crud/FooterDaftar';
import { useBarisOtomatis } from '../../lib/barisOtomatis';
import { useSesi } from '../../lib/sesi';
import { idGudangBawaan } from '../../lib/gudang';

type Baris = Record<string, any>;
type Opsi = { id: number; label: string };
type ItemForm = { product_id: string; qty: string };

const TAHAP: Record<string, { label: string; lencana: string }> = {
  draft: { label: 'Draft', lencana: 'lencana--netral' },
  dikirim: { label: 'Terkirim', lencana: 'lencana--peringatan' },
  selesai: { label: 'Selesai', lencana: 'lencana--aktif' },
  batal: { label: 'Dibatalkan', lencana: 'lencana--bahaya' },
};

export function HalamanTransfer() {
  const [data, setData] = useState<Baris[]>([]);
  const [total, setTotal] = useState(0);
  const [hal, setHal] = useState(1);
  const areaRef = useRef<HTMLDivElement>(null);
  // AJ — baris per halaman otomatis (Otomatis/20/50/100) + footer terpadu.
  const { per, mode: modeBaris, setMode: setModeBaris } = useBarisOtomatis({
    kunci: 'stok-transfer',
    areaRef,
    total,
    hal,
    setHal,
  });
  const [cari, setCari] = useState('');
  const [cariTunda, setCariTunda] = useState('');
  const [tahap, setTahap] = useState('');
  const [gudang, setGudang] = useState('');
  const [sibuk, setSibuk] = useState(false);
  // WI2 — gudang default pengguna dipakai sebagai gudang asal usulan.
  const sesiInfo = useSesi().info;

  const [opsiGudang, setOpsiGudang] = useState<Opsi[]>([]);

  // mode: null | 'form' (buat/ubah draft) | 'terima' | 'batal'
  const [mode, setMode] = useState<null | 'form' | 'terima' | 'batal'>(null);
  const [aktif, setAktif] = useState<Baris | null>(null);

  const [form, setForm] = useState({ dari: '', ke: '' });
  const [items, setItems] = useState<ItemForm[]>([{ product_id: '', qty: '1' }]);
  const [stokAsal, setStokAsal] = useState<Baris[]>([]);
  const [detailItems, setDetailItems] = useState<Baris[]>([]);
  const [sibukSimpan, setSibukSimpan] = useState(false);
  // Penjaga kirim-ganda: state sibuk bisa basi pada klik beruntun dalam satu tick.
  const aksiRef = useRef(false);

  const [opsiLokasi, setOpsiLokasi] = useState<Opsi[]>([]);
  const [lokasiTerima, setLokasiTerima] = useState('');
  const [alasanBatal, setAlasanBatal] = useState('');

  useEffect(() => {
    const t = window.setTimeout(() => {
      setCariTunda(cari);
      setHal(1);
    }, 350);
    return () => window.clearTimeout(t);
  }, [cari]);

  useEffect(() => {
    ambilOpsi('gudang').then(setOpsiGudang).catch((e: Error) => beritahu(e.message, 'galat'));
  }, []);

  const muat = useCallback(async () => {
    setSibuk(true);
    try {
      const q = new URLSearchParams({ hal: String(hal), per: String(per), cari: cariTunda });
      if (tahap) q.set('tahap', tahap);
      if (gudang) q.set('gudang', gudang);
      const r = await apiGet<{ data: Baris[]; total: number }>(`/api/stock/transfer?${q.toString()}`);
      setData(r.data);
      setTotal(r.total);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibuk(false);
    }
  }, [hal, per, cariTunda, tahap, gudang]);

  useEffect(() => {
    void muat();
  }, [muat]);
  // Tombol Refresh global di topbar: muat ulang daftar transfer.
  useSegarkanModul(muat);

  // Opsi produk yang punya stok di gudang asal (untuk pemilih item)
  useEffect(() => {
    setStokAsal([]);
    if (!form.dari) return;
    apiGet<{ data: Baris[] }>(`/api/stock/saldo?gudang=${form.dari}&per=200`)
      .then((r) => setStokAsal(r.data.filter((b) => Number(b.qty) > 0)))
      .catch((e: Error) => beritahu(e.message, 'galat'));
  }, [form.dari]);

  const totalHal = Math.max(1, Math.ceil(total / per));

  /** Gabungan opsi produk: stok gudang asal + yang sudah terpilih di draft. */
  const petaOpsi = (): Map<number, Baris> => {
    const peta = new Map<number, Baris>();
    for (const s of stokAsal) peta.set(Number(s.product_id), s);
    for (const d of detailItems) {
      const id = Number(d.product_id);
      if (!peta.has(id)) peta.set(id, { ...d, qty: null });
    }
    return peta;
  };

  const labelProduk = (b: Baris): string => {
    const stok = b.qty === null || b.qty === undefined ? '' : ` (${formatAngka(Number(b.qty))} pcs)`;
    return `${b.sku} — ${b.produk}${stok}`;
  };

  const bukaForm = (baris?: Baris) => {
    if (baris) {
      setAktif(baris);
      setForm({ dari: String(baris.dari_warehouse), ke: String(baris.ke_warehouse) });
      setDetailItems([]);
      setItems([{ product_id: '', qty: '1' }]);
      apiGet<{ data: Baris }>(`/api/stock/transfer/${baris.id}`)
        .then((d) => {
          setDetailItems(d.data.items ?? []);
          setItems((d.data.items ?? []).map((i: Baris) => ({ product_id: String(i.product_id), qty: String(i.qty) })));
        })
        .catch((e: Error) => beritahu(e.message, 'galat'));
    } else {
      setAktif(null);
      const bawaan = idGudangBawaan(sesiInfo, opsiGudang);
      setForm({ dari: bawaan !== null ? String(bawaan) : '', ke: '' });
      setDetailItems([]);
      setItems([{ product_id: '', qty: '1' }]);
    }
    setMode('form');
  };

  const bangunPayload = (): { dari_warehouse: number; ke_warehouse: number; items: { product_id: number; qty: number }[] } | null => {
    const payload = {
      dari_warehouse: Number(form.dari),
      ke_warehouse: Number(form.ke),
      items: items
        .filter((i) => i.product_id && Number(i.qty) > 0)
        .map((i) => ({ product_id: Number(i.product_id), qty: Number(i.qty) })),
    };
    if (!payload.dari_warehouse) {
      beritahu('Pilih gudang asal.', 'galat');
      return null;
    }
    if (!payload.ke_warehouse) {
      beritahu('Pilih gudang tujuan.', 'galat');
      return null;
    }
    if (payload.dari_warehouse === payload.ke_warehouse) {
      beritahu('Gudang asal dan tujuan tidak boleh sama.', 'galat');
      return null;
    }
    if (payload.items.length === 0) {
      beritahu('Tambahkan minimal satu item.', 'galat');
      return null;
    }
    if (payload.items.some((i) => !Number.isInteger(i.qty))) {
      beritahu('Qty harus bilangan bulat.', 'galat');
      return null;
    }
    return payload;
  };

  const simpanDraft = async (): Promise<Baris | null> => {
    const payload = bangunPayload();
    if (!payload) return null;
    setSibukSimpan(true);
    try {
      const r = aktif
        ? await apiPut<{ data: Baris }>(`/api/stock/transfer/${aktif.id}`, payload)
        : await apiPost<{ data: Baris }>('/api/stock/transfer', payload);
      beritahu(`Transfer ${r.data?.no_dokumen ?? ''} disimpan sebagai draft.`);
      return r.data;
    } catch (err) {
      beritahu((err as Error).message, 'galat');
      return null;
    } finally {
      setSibukSimpan(false);
    }
  };

  const simpanDraftSaja = async () => {
    const r = await simpanDraft();
    if (r) {
      setMode(null);
      await muat();
    }
  };

  const simpanDanKirim = async () => {
    const r = await simpanDraft();
    if (!r) return;
    try {
      await apiPost(`/api/stock/transfer/${r.id}/kirim`, {});
      beritahu(`Transfer ${r.no_dokumen} terkirim — stok gudang asal berkurang.`);
      setMode(null);
    } catch (err) {
      beritahu(`Draft tersimpan, tetapi pengiriman gagal: ${(err as Error).message}`, 'galat');
    } finally {
      await muat();
    }
  };

  const kirim = async (b: Baris) => {
    try {
      await apiPost(`/api/stock/transfer/${b.id}/kirim`, {});
      beritahu(`Transfer ${b.no_dokumen} terkirim — stok gudang asal berkurang.`);
      await muat();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    }
  };

  const bukaTerima = async (b: Baris) => {
    setAktif(b);
    setLokasiTerima('');
    try {
      const [detail, lokasi] = await Promise.all([
        apiGet<{ data: Baris }>(`/api/stock/transfer/${b.id}`),
        apiGet<{ data: { id: number; kode_lokasi: string }[] }>(`/api/master/lokasi?per=500&warehouse_id=${b.ke_warehouse}`),
      ]);
      setDetailItems(detail.data.items ?? []);
      setOpsiLokasi(lokasi.data.map((l) => ({ id: Number(l.id), label: l.kode_lokasi })));
      if (lokasi.data.length > 0) setLokasiTerima(String(lokasi.data[0].id));
      if (lokasi.data.length === 0) beritahu('Gudang tujuan belum memiliki lokasi.', 'galat');
      setMode('terima');
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    }
  };

  const konfirmasiTerima = async () => {
    if (!aktif || sibukSimpan || aksiRef.current) return;
    if (!lokasiTerima) return beritahu('Pilih lokasi tujuan penerimaan.', 'galat');
    aksiRef.current = true;
    setSibukSimpan(true);
    try {
      await apiPost(`/api/stock/transfer/${aktif.id}/terima`, { location_id: Number(lokasiTerima) });
      beritahu(`Transfer ${aktif.no_dokumen} diterima — stok masuk gudang tujuan.`);
      setMode(null);
      // Refresh daftar best-effort: kegagalannya tidak boleh menutupi sukses.
      try {
        await muat();
      } catch (e) {
        console.error('[Transfer] muat() setelah terima gagal:', e);
      }
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      aksiRef.current = false;
      setSibukSimpan(false);
    }
  };

  const bukaBatal = (b: Baris) => {
    setAktif(b);
    setAlasanBatal('');
    setMode('batal');
  };

  const konfirmasiBatal = async () => {
    if (!aktif || sibukSimpan || aksiRef.current) return;
    if (aktif.tahap !== 'draft' && !alasanBatal.trim()) {
      beritahu('Alasan pembatalan wajib diisi.', 'galat');
      return;
    }
    aksiRef.current = true;
    setSibukSimpan(true);
    try {
      await apiPost(`/api/stock/transfer/${aktif.id}/batal`, { alasan: alasanBatal });
      beritahu(`Transfer ${aktif.no_dokumen} dibatalkan${aktif.tahap !== 'draft' ? ' — pergerakan dipulihkan' : ''}.`);
      setMode(null);
      // Refresh daftar best-effort: kegagalannya tidak boleh menutupi sukses.
      try {
        await muat();
      } catch (e) {
        console.error('[Transfer] muat() setelah batal gagal:', e);
      }
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      aksiRef.current = false;
      setSibukSimpan(false);
    }
  };

  const opsiProduk = petaOpsi();

  return (
    <div className="halaman halaman--fit">
      <section className="kartu kartu--daftar">
        <div className="kartu__kepala kartu__kepala--kompak">
          <div>
            <h3>Transfer Antar Gudang</h3>
            <p className="teks-redup teks-kecil">
              Alur: Draft → Kirim (stok keluar gudang asal) → Terima (stok masuk gudang tujuan). Satu-satunya jalur pindah gudang — kartu stok tercatat di kedua sisi.
            </p>
          </div>
          <span className="kartu__jumlah">{total} transfer</span>
          <div className="tombol-baris">
            <button type="button" className="tombol" onClick={() => bukaForm()}>+ Transfer Baru</button>
          </div>
        </div>

        <div className="alat-tabel toolbar-kompak">
          <div className="cari-scan">
          <input
            className="input-cari"
            type="search"
            placeholder="Cari kode transfer…"
            value={cari}
            onChange={(e) => {
              setCari(e.target.value);
              setHal(1);
            }}
          />
          <TombolScan onHasil={(t) => { setCari(t); setHal(1); }} />
          </div>
          <span className="filter-inline">
          <select className="input-pilih" value={tahap} onChange={(e) => { setTahap(e.target.value); setHal(1); }} aria-label="Filter tahap">
            <option value="">Semua tahap</option>
            {Object.entries(TAHAP).map(([k, v]) => (<option key={k} value={k}>{v.label}</option>))}
          </select>
          <select className="input-pilih" value={gudang} onChange={(e) => { setGudang(e.target.value); setHal(1); }} aria-label="Filter gudang">
            <option value="">Semua gudang</option>
            {opsiGudang.map((o) => (<option key={o.id} value={o.id}>{o.label}</option>))}
          </select>
          </span>
        </div>

        <div ref={areaRef} className="tabel-bungkus">
          <table className="tabel">
            <thead>
              <tr>
                <th>No. dokumen</th>
                <th>Tanggal (WIB)</th>
                <th>Rute</th>
                <th className="rata-kanan">Item</th>
                <th className="rata-kanan">Total qty</th>
                <th className="rata-tengah">Status</th>
                <th className="rata-kanan">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {sibuk && data.length === 0 ? (
                <tr><td colSpan={7} className="tabel-kosong">Memuat…</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={7} className="tabel-kosong">Belum ada transfer{cariTunda ? ` untuk "${cariTunda}"` : ''}.</td></tr>
              ) : (
                data.map((b) => {
                  const info = TAHAP[b.tahap] ?? { label: b.tahap, lencana: 'lencana--netral' };
                  return (
                    <tr key={b.id}>
                      <td><code>{b.no_dokumen}</code></td>
                      <td className="whitespace-nowrap teks-kecil">
                        {formatTanggalWaktu(b.dibuat_pada)}
                        {b.dikirim_pada && <div className="teks-redup">dikirim {formatTanggalWaktu(b.dikirim_pada)}</div>}
                        {b.diterima_pada && <div className="teks-redup">diterima {formatTanggalWaktu(b.diterima_pada)}</div>}
                      </td>
                      <td className="whitespace-nowrap">
                        <strong>{b.dari_kode} → {b.ke_kode}</strong>
                        <div className="teks-redup teks-kecil">{b.dari_nama} → {b.ke_nama}</div>
                      </td>
                      <td className="rata-kanan">{b.jumlah_item}</td>
                      <td className="rata-kanan"><strong>{formatAngka(Number(b.jumlah_qty))}</strong></td>
                      <td className="rata-tengah"><span className={`lencana ${info.lencana}`}>{info.label}</span></td>
                      <td className="rata-kanan">
                        <div className="tombol-baris tombol-baris--kanan">
                          {b.tahap === 'draft' && (
                            <>
                              <button type="button" className="tombol tombol--kecil" onClick={() => void kirim(b)}>Kirim</button>
                              <IconButton label="Ubah" ikon="pencil" arah="atas" onClick={() => void bukaForm(b)} />
                              <button type="button" className="tombol tombol--kecil tombol--bahaya" onClick={() => bukaBatal(b)}>Batal</button>
                            </>
                          )}
                          {b.tahap === 'dikirim' && (
                            <>
                              <button type="button" className="tombol tombol--kecil" onClick={() => void bukaTerima(b)}>Terima</button>
                              <button type="button" className="tombol tombol--kecil tombol--bahaya" onClick={() => bukaBatal(b)}>Batal</button>
                            </>
                          )}
                          {b.tahap === 'selesai' && (
                            <button type="button" className="tombol tombol--kecil tombol--bahaya" onClick={() => bukaBatal(b)}>Batal &amp; Pulihkan</button>
                          )}
                          {b.tahap === 'batal' && <span className="teks-redup teks-kecil">—</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <FooterDaftar mode={modeBaris} onMode={setModeBaris} hal={hal} totalHal={totalHal} total={total} onHal={setHal} />
      </section>

      {mode === 'form' && (
        <Modal
          lebar="lebar"
          judul={aktif ? `Ubah Draft ${aktif.no_dokumen}` : 'Transfer Baru'}
          onTutup={() => setMode(null)}
          sedangKirim={sibukSimpan}
          aksi={
            <div className="tombol-baris">
              <button type="button" className="tombol tombol--netral" onClick={() => setMode(null)} disabled={sibukSimpan}>Tutup</button>
              <button type="button" className="tombol" onClick={() => void simpanDraftSaja()} disabled={sibukSimpan}>
                {sibukSimpan ? 'Menyimpan…' : 'Simpan Draft'}
              </button>
              {!aktif && (
                <button type="button" className="tombol" onClick={() => void simpanDanKirim()} disabled={sibukSimpan}>
                  Simpan &amp; Kirim
                </button>
              )}
            </div>
          }
        >
          <p className="teks-redup teks-kecil">
            Draft tidak menggerakkan stok. Stok baru bergerak saat <strong>Kirim</strong> (keluar gudang asal) dan <strong>Terima</strong> (masuk gudang tujuan).
          </p>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <label className="bidang">
              <span>Gudang asal *</span>
              <select value={form.dari} onChange={(e) => setForm({ ...form, dari: e.target.value })}>
                <option value="">— Pilih —</option>
                {opsiGudang.map((o) => (<option key={o.id} value={o.id}>{o.label}</option>))}
              </select>
            </label>
            <label className="bidang">
              <span>Gudang tujuan *</span>
              <select value={form.ke} onChange={(e) => setForm({ ...form, ke: e.target.value })} disabled={!form.dari}>
                <option value="">— Pilih —</option>
                {opsiGudang.filter((o) => String(o.id) !== form.dari).map((o) => (<option key={o.id} value={o.id}>{o.label}</option>))}
              </select>
            </label>
          </div>

          <h4 className="bagian-judul">Item transfer</h4>
          {!form.dari ? (
            <p className="teks-redup">Pilih gudang asal terlebih dahulu untuk memuat produk yang tersedia.</p>
          ) : (
            <>
              <div className="daftar-item">
                {items.map((it, idx) => (
                  <div className="baris-item" key={idx}>
                    <select
                      value={it.product_id}
                      onChange={(e) => setItems(items.map((x, i) => (i === idx ? { ...x, product_id: e.target.value } : x)))}
                      aria-label="Produk"
                    >
                      <option value="">— Pilih produk —</option>
                      {[...opsiProduk.entries()]
                        .sort((a, b) => labelProduk(a[1]).localeCompare(labelProduk(b[1])))
                        .map(([id, o]) => (
                          <option key={id} value={id}>{labelProduk(o)}</option>
                        ))}
                    </select>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={it.qty}
                      onChange={(e) => setItems(items.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x)))}
                      aria-label="Qty"
                    />
                    <button
                      type="button"
                      className="tombol tombol--kecil tombol--bahaya"
                      onClick={() => setItems(items.filter((_, i) => i !== idx))}
                      disabled={items.length === 1}
                    >
                      Hapus
                    </button>
                  </div>
                ))}
              </div>
              <div className="tombol-baris" style={{ marginTop: 8 }}>
                <button type="button" className="tombol tombol--kecil tombol--netral" onClick={() => setItems([...items, { product_id: '', qty: '1' }])}>
                  + Tambah item
                </button>
                <span className="teks-redup teks-kecil">
                  Total {formatAngka(items.reduce((n, i) => n + (Number(i.qty) || 0), 0))} pcs
                </span>
              </div>
            </>
          )}
        </Modal>
      )}

      {mode === 'terima' && aktif && (
        <Modal
          judul={`Terima ${aktif.no_dokumen}`}
          onTutup={() => setMode(null)}
          sedangKirim={sibukSimpan}
          aksi={
            <div className="tombol-baris">
              <button type="button" className="tombol tombol--netral" onClick={() => setMode(null)} disabled={sibukSimpan}>Kembali</button>
              <button type="button" className="tombol" onClick={() => void konfirmasiTerima()} disabled={sibukSimpan || !lokasiTerima}>
                {sibukSimpan ? 'Memproses…' : 'Konfirmasi Terima'}
              </button>
            </div>
          }
        >
          <p className="teks-redup teks-kecil">
            Penerimaan penuh: seluruh item masuk ke lokasi tujuan di gudang <strong>{aktif.ke_kode} — {aktif.ke_nama}</strong>.
            Stok tujuan bertambah dan kartu stok kedua gudang tercatat.
          </p>
          <label className="bidang" style={{ marginTop: 12, maxWidth: 420 }}>
            <span>Lokasi tujuan *</span>
            <select value={lokasiTerima} onChange={(e) => setLokasiTerima(e.target.value)}>
              <option value="">— Pilih lokasi —</option>
              {opsiLokasi.map((o) => (<option key={o.id} value={o.id}>{o.label}</option>))}
            </select>
          </label>
          <h4 className="bagian-judul">Item yang diterima</h4>
          <div className="daftar-item">
            {detailItems.map((i) => (
              <div className="baris-item" key={i.id}>
                <div className="baris-item__info">
                  <strong>{i.sku} — {i.produk}</strong>
                </div>
                <span className="kartu-ringkas">{formatAngka(Number(i.qty))} pcs</span>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {mode === 'batal' && aktif && (
        <Modal
          judul={`Batal Transfer ${aktif.no_dokumen}`}
          onTutup={() => setMode(null)}
          sedangKirim={sibukSimpan}
          aksi={
            <div className="tombol-baris">
              <button type="button" className="tombol tombol--netral" onClick={() => setMode(null)} disabled={sibukSimpan}>Kembali</button>
              <button type="button" className="tombol tombol--bahaya" onClick={() => void konfirmasiBatal()} disabled={sibukSimpan}>
                {sibukSimpan ? 'Memproses…' : 'Batalkan Transfer'}
              </button>
            </div>
          }
        >
          <p className="teks-redup teks-kecil">
            {aktif.tahap === 'draft'
              ? 'Draft dapat dibatalkan tanpa alasan. Dokumen tetap tersimpan dengan status Dibatalkan.'
              : 'Pergerakan stok yang sudah terjadi akan dipulihkan (kartu stok tetap tercatat), dan alasan dicatat di audit log. Jika stok tujuan sudah terpakai lain, pembatalan ditolak — selesaikan lewat Opname.'}
          </p>
          <label className="bidang" style={{ marginTop: 12 }}>
            <span>Alasan{aktif.tahap !== 'draft' ? ' *' : ' (opsional)'}</span>
            <textarea rows={3} value={alasanBatal} onChange={(e) => setAlasanBatal(e.target.value)} placeholder="Contoh: salah tujuan gudang" />
          </label>
        </Modal>
      )}
    </div>
  );
}

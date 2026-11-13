import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../../components/crud/Modal';
import { IconButton } from '../../components/IconButton';
import { beritahu } from '../../components/crud/Toast';
import { ambilOpsi, apiDelete, apiGet, apiPost, apiPut } from '../../lib/api';
import { formatRupiah, formatTanggalWaktu } from '../../lib/format';
import { useSesi } from '../../lib/sesi';
import { bacaUsaha } from '../../lib/usaha';
import { DialogWa } from '../faktur/DialogWa';
import {
  cetakStruk,
  pesanWaStruk,
  pratinjauStruk,
  PROFIL_STRUK_BAWAAN,
  simpanStrukPdf,
  type ProfilStruk,
  type StrukData,
} from './struk';
import { bagikanGambar, bisaBagikanGambar, dokKePng, gambarStrukDok } from '../../lib/gambarDok';
import { type BarisKeranjang, type Opsi, type ShiftAktif } from './tipe';
// Gaya dialog Riwayat/Void/Retur. Dialog ini juga dibuka dari halaman
// Penjualan, jadi CSS-nya harus ikut termuat di luar layar POS (dulu hanya
// diimpor PosFoto/PosCepat sehingga modal retur tampil tanpa tabel/gaya).
import './pos.css';

/* ============================ Bayar (F4) ================================== */

export function DialogBayar({
  total,
  items,
  diskon,
  pajakPersen,
  gudangId,
  namaUsaha,
  alamatUsaha = null,
  teleponUsaha = null,
  logoUrl = null,
  modePos = 'foto',
  pelangganIdAwal = '',
  namaPelangganAwal = null,
  teleponPelangganAwal = null,
  catatanAwal = '',
  /** Token Edit — id penjualan yang sedang diubah; simpan memakai PUT. */
  editId = null,
  pembayaranAwal = [],
  onSukses,
  onTutup,
}: {
  total: number;
  items: BarisKeranjang[];
  diskon: number;
  pajakPersen: number;
  gudangId: number;
  namaUsaha: string;
  /** Identitas toko untuk kop/kepala struk (BAGIAN J3). */
  alamatUsaha?: string | null;
  teleponUsaha?: string | null;
  logoUrl?: string | null;
  /** Tercatat di kolom sales.mode_pos: 'foto' (bawaan) atau 'cepat'. */
  modePos?: 'foto' | 'cepat';
  /** Pelanggan & catatan dari panel kasir (kanan) — masuk payload API. */
  pelangganIdAwal?: string;
  namaPelangganAwal?: string | null;
  /** Telepon pelanggan terpilih di panel kasir (master) — default kirim struk. */
  teleponPelangganAwal?: string | null;
  catatanAwal?: string;
  editId?: number | null;
  /** Pembayaran lama (Token Edit) — dimuat ulang ke kolom tunai/transfer/qris/kredit. */
  pembayaranAwal?: { metode: string; jumlah: number }[];
  onSukses: (struk: StrukData) => void;
  onTutup: () => void;
}) {
  const awalJumlah = (metode: string): string => {
    const n = Number(pembayaranAwal.find((p) => p.metode === metode)?.jumlah ?? 0);
    return n > 0 ? String(n) : '';
  };
  const [tunai, setTunai] = useState(() => awalJumlah('tunai'));
  const [transfer, setTransfer] = useState(() => awalJumlah('transfer'));
  const [qris, setQris] = useState(() => awalJumlah('qris'));
  const [kredit, setKredit] = useState(() => awalJumlah('kredit'));
  const [pelangganId, setPelangganId] = useState(pelangganIdAwal ?? '');
  const [pelangganOpsi, setPelangganOpsi] = useState<Opsi[]>([]);
  const [sibuk, setSibuk] = useState(false);
  // Catatan milik panel kasir (read-only di dialog — ubah di panel kanan).
  const catatan = (catatanAwal ?? '').trim();

  const totalQty = items.reduce((jumlah, item) => jumlah + Number(item.qty || 0), 0);
  const angka = (s: string) => Math.max(0, Number(s) || 0);
  const tunaiN = angka(tunai);
  const nonTunai = angka(transfer) + angka(qris) + angka(kredit);
  const sisaTunai = Math.max(0, total - nonTunai);
  const kurang = total - (tunaiN + nonTunai);
  const kembalian = Math.max(0, tunaiN - sisaTunai);
  const kreditN = angka(kredit);

  // Opsi pelanggan: wajib saat bayar kredit/piutang, atau bila kasir sudah
  // memilih pelanggan di panel kanan (agar nama tampil & tervalidasi).
  useEffect(() => {
    if ((kreditN > 0 || pelangganId !== '') && pelangganOpsi.length === 0) {
      ambilOpsi('pelanggan')
        .then(setPelangganOpsi)
        .catch((e: Error) => beritahu(e.message, 'galat'));
    }
  }, [kreditN, pelangganId, pelangganOpsi.length]);

  // Nominal cepat: SATU daftar gabungan (uang pas + pembulatan + pecahan umum),
  // di-dedupe lalu diurutkan menaik. Tanpa dedupe, "PAS" dan "Uang pas" serta
  // nominal pembulatan yang sama dengan pecahan umum (mis. 50.000/100.000)
  // muncul berulang. Contoh total 35.000 → [35.000 (pas), 40.000, 50.000, 100.000].
  const bayarCepat = useMemo(() => {
    const bulat = (n: number, kelipatan: number) => (n <= 0 ? 0 : Math.ceil(n / kelipatan) * kelipatan);
    const opsi = [
      sisaTunai,
      bulat(sisaTunai, 5_000),
      bulat(sisaTunai, 10_000),
      bulat(sisaTunai, 50_000),
      bulat(sisaTunai, 100_000),
      10_000,
      20_000,
      50_000,
      100_000,
    ];
    return [...new Set(opsi)]
      .filter((n) => Number.isFinite(n) && n > 0 && n >= sisaTunai)
      .sort((a, b) => a - b);
  }, [sisaTunai]);

  const siapBayar = kurang < 0.5 && (kreditN <= 0 || pelangganId !== '');

  const bayar = async () => {
    if (!siapBayar || sibuk) return;
    setSibuk(true);
    try {
      const pembayaran = [
        { metode: 'tunai', jumlah: tunaiN },
        { metode: 'transfer', jumlah: angka(transfer) },
        { metode: 'qris', jumlah: angka(qris) },
        { metode: 'kredit', jumlah: kreditN },
      ].filter((p) => p.jumlah > 0);
      const muatan = {
        warehouse_id: gudangId,
        customer_id: pelangganId ? Number(pelangganId) : null,
        // Catatan kasir untuk nota/faktur (disimpan server bila kolom tersedia).
        notes: catatan || undefined,
        items: items.map((b) => ({ product_id: b.productId, qty: b.qty, harga: b.harga, diskon: b.diskon ?? 0 })),
        diskon,
        pajak_persen: pajakPersen,
        mode_pos: modePos,
        payments: pembayaran,
        // Waktu transaksi dari jam kasir (live clock header POS) — server
        // memvalidasi & memakai sebagai tanggal bila masuk akal.
        created_at: new Date().toISOString(),
      };
      // Token Edit — PUT merekonsiliasi stok, kas, piutang, dan faktur.
      const r = editId
        ? await apiPut<{ id: number; no_dokumen: string }>(`/api/pos/sales/${editId}`, muatan).then((v) => ({
            ...v,
            kembalian: kembalian,
            faktur: null as { id: number; no_faktur: string } | null,
          }))
        : await apiPost<{
            id: number;
            no_dokumen: string;
            kembalian: number;
            faktur?: { id: number; no_faktur: string } | null;
          }>('/api/pos/sales', muatan);
      const subtotal = items.reduce((a, b) => a + b.qty * b.harga, 0);
      // Total diskon struk = diskon kasir + Σ diskon baris (sama dengan server).
      const diskonTotal = diskon + items.reduce((a, b) => a + (b.diskon ?? 0), 0);
      const dasar = Math.max(0, subtotal - diskonTotal);
      const pajak = Math.round((dasar * pajakPersen) / 100);
      onSukses({
        namaUsaha,
        alamatUsaha,
        teleponUsaha,
        logoUrl,
        noDokumen: r.no_dokumen,
        tanggal: formatTanggalWaktu(new Date()),
        kasir: 'Admin',
        pelanggan: pelangganOpsi.find((o) => o.id === Number(pelangganId))?.label ?? namaPelangganAwal ?? null,
        // Nomor WhatsApp pelanggan dari master → dialog kirim struk terisi otomatis.
        pelangganTelepon:
          pelangganOpsi.find((o) => o.id === Number(pelangganId))?.telepon ?? teleponPelangganAwal ?? null,
        catatan: catatan || null,
        items: items.map((b) => ({
          nama: b.nama,
          kode: b.sku,
          qty: b.qty,
          harga: b.harga,
          jumlah: b.qty * b.harga,
        })),
        subtotal,
        diskon: diskonTotal,
        pajak,
        total,
        bayar: pembayaran,
        kembalian: r.kembalian,
        fakturId: r.faktur?.id ?? null,
        noFaktur: r.faktur?.no_faktur ?? null,
      });
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    } finally {
      setSibuk(false);
    }
  };

  // Keyboard penuh: Enter = Bayar & Simpan (tombol yang sedang difokus tidak
  // ikut agar tidak dobel — klik native pada tombol sudah menangani Enter).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || sibuk) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'BUTTON' || t.closest('button'))) return;
      e.preventDefault();
      void bayar();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <Modal
      judul={editId ? 'Edit Pembayaran' : 'Pembayaran'}
      lebar="sedang"
      onTutup={onTutup}
      sedangKirim={sibuk}
      aksi={
        <>
          <button type="button" className="tombol" onClick={onTutup} disabled={sibuk}>
            Batal (Esc)
          </button>
          <button type="button" className="tombol tombol--primer" onClick={bayar} disabled={!siapBayar || sibuk}>
            {sibuk
              ? 'Menyimpan…'
              : editId
                ? `Simpan Perubahan${kurang >= 0.5 ? ` (kurang ${formatRupiah(kurang)})` : ''}`
                : `Bayar & Simpan${kurang >= 0.5 ? ` (kurang ${formatRupiah(kurang)})` : ''}`}
          </button>
        </>
      }
    >
      <div className="pos-dialog">
        <div className="pos-struk-ringkas">
          <div className="r">
            <span>Total tagihan</span>
            <b>{formatRupiah(total)}</b>
            <small>Total Qty: {totalQty.toLocaleString('id-ID')}</small>
          </div>
          {(pelangganId !== '' || catatan !== '') && (
            <div className="r pos-dialog__meta">
              <span>{pelangganOpsi.find((o) => o.id === Number(pelangganId))?.label ?? namaPelangganAwal ?? 'Pelanggan Umum'}</span>
              {catatan !== '' && <span className="pos-dialog__catatan">“{catatan}”</span>}
            </div>
          )}
        </div>

        <label htmlFor="pos-tunai">Tunai</label>
        <input
          id="pos-tunai"
          inputMode="numeric"
          autoFocus
          placeholder="0"
          value={tunai}
          onChange={(e) => setTunai(e.target.value.replace(/\D/g, ''))}
        />
        <div className="pos-bayar-cepat" role="group" aria-label="Nominal pembayaran cepat">
          {bayarCepat.map((n) => (
            <button
              key={n}
              type="button"
              className={n === sisaTunai ? 'pos-bayar-cepat__pas' : undefined}
              title={n === sisaTunai ? 'Uang pas sebesar sisa tagihan' : `Isi tunai ${formatRupiah(n)}`}
              onClick={() => setTunai(String(n))}
            >
              {n === sisaTunai ? 'Uang Pas' : formatRupiah(n)}
            </button>
          ))}
          <button type="button" onClick={() => setTunai('')}>
            Kosongkan
          </button>
        </div>

        <div className="baris" style={{ marginTop: 10 }}>
          <div>
            <label htmlFor="pos-transfer">Transfer</label>
            <input id="pos-transfer" inputMode="numeric" placeholder="0" value={transfer} onChange={(e) => setTransfer(e.target.value.replace(/\D/g, ''))} />
          </div>
          <div>
            <label htmlFor="pos-qris">QRIS</label>
            <input id="pos-qris" inputMode="numeric" placeholder="0" value={qris} onChange={(e) => setQris(e.target.value.replace(/\D/g, ''))} />
          </div>
        </div>

        <label htmlFor="pos-kredit">Kredit / Piutang</label>
        <input id="pos-kredit" inputMode="numeric" placeholder="0" value={kredit} onChange={(e) => setKredit(e.target.value.replace(/\D/g, ''))} />
        {kreditN > 0 && (
          <>
            <label htmlFor="pos-pelanggan">Pelanggan (wajib untuk kredit)</label>
            <select id="pos-pelanggan" value={pelangganId} onChange={(e) => setPelangganId(e.target.value)}>
              <option value="">— Pilih pelanggan —</option>
              {pelangganOpsi.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            {pelangganOpsi.length === 0 && (
              <p className="pos-catatan-kecil">Belum ada pelanggan — buat dulu di Master › Pelanggan.</p>
            )}
          </>
        )}

        <div className="pos-kembalian">
          <span>{kurang >= 0.5 ? 'Kurang' : 'Kembalian'}</span>
          <b className={kurang >= 0.5 ? 'kurang' : 'cukup'}>{formatRupiah(kurang >= 0.5 ? kurang : kembalian)}</b>
        </div>
      </div>
    </Modal>
  );
}

/* ============================ Tahan transaksi (F8) ======================== */

export function DialogTahan({ onSimpan, onTutup }: { onSimpan: (nama: string) => Promise<void>; onTutup: () => void }) {
  const [nama, setNama] = useState('');
  const [sibuk, setSibuk] = useState(false);
  return (
    <Modal
      judul="Tahan Transaksi (F8)"
      lebar="kecil"
      onTutup={onTutup}
      sedangKirim={sibuk}
      aksi={
        <>
          <button type="button" className="tombol" onClick={onTutup} disabled={sibuk}>
            Batal
          </button>
          <button
            type="button"
            className="tombol tombol--primer"
            disabled={sibuk}
            onClick={async () => {
              setSibuk(true);
              try {
                await onSimpan(nama);
              } finally {
                setSibuk(false);
              }
            }}
          >
            {sibuk ? 'Menahan…' : 'Tahan'}
          </button>
        </>
      }
    >
      <div className="pos-dialog">
        <label htmlFor="pos-nama-tahan">Nama / catatan transaksi tertahan (opsional)</label>
        <input id="pos-nama-tahan" autoFocus placeholder="Contoh: Bayi beli 3 dus, bayar nanti" value={nama} onChange={(e) => setNama(e.target.value)} />
        <p className="pos-catatan-kecil">Keranjang dikosongkan; lanjutkan nanti dengan F9.</p>
      </div>
    </Modal>
  );
}

export interface BarisTertahan {
  id: number;
  dibuat_pada: string;
  data: { nama?: string; items: BarisKeranjang[]; diskon?: number; pajak_persen?: number; gudangId?: number } | null;
}

export function DialogTertahan({ onLanjut, onTutup }: { onLanjut: (b: BarisTertahan) => Promise<void>; onTutup: () => void }) {
  const [daftar, setDaftar] = useState<BarisTertahan[] | null>(null);
  const muat = () =>
    apiGet<{ data: BarisTertahan[] }>('/api/pos/held')
      .then((r) => setDaftar(r.data))
      .catch((e: Error) => beritahu(e.message, 'galat'));
  useEffect(() => {
    void muat();
  }, []);

  return (
    <Modal judul="Transaksi Tertahan (F9)" lebar="sedang" onTutup={onTutup}>
      <div className="pos-dialog">
        {daftar === null && <p className="teks-redup">Memuat…</p>}
        {daftar?.length === 0 && <p className="teks-redup">Belum ada transaksi tertahan. Tahan dengan F8.</p>}
        {daftar && daftar.length > 0 && (
          <table className="pos-tabel-mini">
            <thead>
              <tr>
                <th>Waktu</th>
                <th>Nama</th>
                <th className="num">Item</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {daftar.map((b) => (
                <tr key={b.id}>
                  <td>{formatTanggalWaktu(b.dibuat_pada)}</td>
                  <td>{b.data?.nama || '—'}</td>
                  <td className="num">{b.data?.items?.length ?? 0}</td>
                  <td>
                    <button type="button" onClick={() => void onLanjut(b)}>
                      Lanjutkan
                    </button>
                    <button
                      type="button"
                      className="bahaya"
                      onClick={() => {
                        apiDelete(`/api/pos/held/${b.id}`)
                          .then(muat)
                          .catch((e: Error) => beritahu(e.message, 'galat'));
                      }}
                    >
                      Hapus
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}

/* ============================ Shift kasir ================================= */

export function DialogShiftBuka({ onSukses, onTutup }: { onSukses: (s: ShiftAktif) => void; onTutup: () => void }) {
  const [kasAwal, setKasAwal] = useState('');
  const [sibuk, setSibuk] = useState(false);
  const buka = async () => {
    setSibuk(true);
    try {
      const r = await apiPost<{ id: number; data: ShiftAktif }>('/api/pos/shift/buka', { kas_awal: Number(kasAwal) || 0 });
      onSukses(r.data);
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    } finally {
      setSibuk(false);
    }
  };
  return (
    <Modal
      judul="Buka Kasir"
      lebar="kecil"
      onTutup={onTutup}
      sedangKirim={sibuk}
      aksi={
        <>
          <button type="button" className="tombol" onClick={onTutup} disabled={sibuk}>
            Batal
          </button>
          <button type="button" className="tombol tombol--primer" onClick={buka} disabled={sibuk}>
            {sibuk ? 'Membuka…' : 'Buka Shift'}
          </button>
        </>
      }
    >
      <div className="pos-dialog">
        <label htmlFor="pos-kas-awal">Kas awal (jumlah uang di laci saat buka)</label>
        <input id="pos-kas-awal" autoFocus inputMode="numeric" placeholder="0" value={kasAwal} onChange={(e) => setKasAwal(e.target.value.replace(/\D/g, ''))} />
        <p className="pos-catatan-kecil">Penjualan baru bisa dilakukan setelah shift dibuka.</p>
      </div>
    </Modal>
  );
}

export function DialogShiftTutup({ shift, onSukses, onTutup }: { shift: ShiftAktif; onSukses: () => void; onTutup: () => void }) {
  const [fisik, setFisik] = useState('');
  const [sibuk, setSibuk] = useState(false);
  const [hasil, setHasil] = useState<{ kas_akhir_sistem: number; kas_akhir_fisik: number; selisih: number } | null>(null);

  const tutup = async () => {
    setSibuk(true);
    try {
      const r = await apiPost<{ kas_akhir_sistem: number; kas_akhir_fisik: number; selisih: number }>('/api/pos/shift/tutup', {
        kas_akhir_fisik: Number(fisik) || 0,
      });
      setHasil(r);
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    } finally {
      setSibuk(false);
    }
  };

  return (
    <Modal
      judul="Tutup Kasir"
      lebar="kecil"
      onTutup={onTutup}
      sedangKirim={sibuk}
      aksi={
        hasil ? (
          <button
            type="button"
            className="tombol tombol--primer"
            onClick={() => {
              onSukses();
              onTutup();
            }}
          >
            Selesai
          </button>
        ) : (
          <>
            <button type="button" className="tombol" onClick={onTutup} disabled={sibuk}>
              Batal
            </button>
            <button type="button" className="tombol tombol--primer" onClick={tutup} disabled={sibuk}>
              {sibuk ? 'Menutup…' : 'Hitung & Tutup'}
            </button>
          </>
        )
      }
    >
      <div className="pos-dialog">
        <div className="pos-hasil-tutup">
          <div className="r">
            <span>Kas awal</span>
            <b>{formatRupiah(shift.kas_awal)}</b>
          </div>
          <div className="r">
            <span>Penjualan (disahkan)</span>
            <b>{formatRupiah(shift.ringkasan.penjualan)}</b>
          </div>
          <div className="r">
            <span>Uang tunai masuk (penjualan)</span>
            <b>{formatRupiah(shift.ringkasan.tunai)}</b>
          </div>
          {Number(shift.ringkasan.tunai_piutang ?? 0) > 0 && (
            <div className="r">
              <span>Pelunasan piutang tunai</span>
              <b>{formatRupiah(Number(shift.ringkasan.tunai_piutang))}</b>
            </div>
          )}
        </div>

        {!hasil ? (
          <>
            <label htmlFor="pos-kas-fisik">Hitungan kas fisik di laci</label>
            <input id="pos-kas-fisik" autoFocus inputMode="numeric" placeholder="0" value={fisik} onChange={(e) => setFisik(e.target.value.replace(/\D/g, ''))} />
            <p className="pos-catatan-kecil">
              Selisih = kas fisik − (kas awal + tunai penjualan + pelunasan piutang tunai).
            </p>
          </>
        ) : (
          <div className="pos-hasil-tutup">
            <div className="r">
              <span>Kas sistem</span>
              <b>{formatRupiah(hasil.kas_akhir_sistem)}</b>
            </div>
            <div className="r">
              <span>Kas fisik</span>
              <b>{formatRupiah(hasil.kas_akhir_fisik)}</b>
            </div>
            <div className="r">
              <span>Selisih</span>
              <b className={hasil.selisih < 0 ? 'selisih-minus' : hasil.selisih > 0 ? 'selisih-plus' : ''}>
                {formatRupiah(hasil.selisih)}
                {hasil.selisih < 0 ? ' (kurang)' : hasil.selisih > 0 ? ' (lebih)' : ''}
              </b>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ================== Riwayat: void & retur (Admin + sandi) ================ */export interface BarisRiwayat {
  id: number;
  no_dokumen: string;
  tanggal: string;
  total: number;
  total_qty: number;
  /** NET SALES — akumulasi qty & nominal retur disahkan (dari /api/pos/sales). */
  qty_retur?: number;
  total_retur?: number;
  has_return?: number | boolean;
  total_qty_net?: number;
  total_net?: number;
  status: string;
  pelanggan: string | null;
  /** Telepon/WA pelanggan dari master (default dialog kirim struk). */
  pelanggan_telepon?: string | null;
  kasir: string | null;
  metode: string | null;
  /** Faktur penjualan terbit (R2 — kolom Dokumen di Riwayat & Dokumen). */
  faktur_id?: number | null;
  no_faktur?: string | null;
}

export interface DetailJual {
  id: number;
  no_dokumen: string;
  tanggal: string;
  subtotal: number;
  diskon: number;
  pajak: number;
  total: number;
  status: string;
  pelanggan: string | null;
  pelanggan_telepon?: string | null;
  kasir: string | null;
  /** qty_retur: akumulasi qty yang sudah diretur (retur disahkan). */
  items: {
    product_id: number;
    qty: number;
    harga: number;
    subtotal: number;
    sku: string;
    nama_produk: string;
    qty_retur?: number;
  }[];
  payments: { metode: string; jumlah: number; referensi: string | null }[];
  /** Retur yang pernah dibuat untuk penjualan ini (bila ada). */
  retur?: { id: number; no_dokumen: string; tanggal: string; total: number; status: string }[];
}

/**
 * Bangun data struk dari penjualan tersimpan — dipakai DialogLayanan (POS)
 * dan halaman Riwayat Penjualan (aksi cetak ulang/kirim).
 */
export async function strukDariSale(saleId: number, namaUsaha?: string): Promise<StrukData> {
  const r = await apiGet<{ data: DetailJual }>(`/api/pos/sales/${saleId}`);
  const d = r.data;
  // Header usaha selalu dari store global terbaru (bukan cache halaman),
  // supaya cetak ulang struk memakai nama/alamat/telepon terkini.
  const usaha = bacaUsaha();
  return {
    namaUsaha: namaUsaha?.trim() || usaha.nama,
    alamatUsaha: usaha.alamat || null,
    teleponUsaha: usaha.telepon || null,
    logoUrl: usaha.logo || null,
    noDokumen: d.no_dokumen,
    tanggal: formatTanggalWaktu(d.tanggal),
    kasir: d.kasir ?? 'Admin',
    pelanggan: d.pelanggan,
    pelangganTelepon: d.pelanggan_telepon ?? null,
    items: d.items.map((i) => ({ nama: i.nama_produk, kode: i.sku, qty: i.qty, harga: i.harga, jumlah: i.subtotal })),
    subtotal: Number(d.subtotal),
    diskon: Number(d.diskon),
    pajak: Number(d.pajak),
    total: Number(d.total),
    bayar: d.payments.map((x) => ({ metode: x.metode, jumlah: Number(x.jumlah) })),
    kembalian: 0,
  };
}

export function DialogLayanan({
  namaUsaha,
  profil,
  langkahAwal,
  onSelesai,
  onTutup,
}: {
  namaUsaha: string;

  /** Profil struk aktif (J3/J4) untuk cetak ulang dari riwayat. */
  profil?: ProfilStruk | null;
  /** M5 — buka langsung pada langkah void/retur tertentu (dari halaman Riwayat). */
  langkahAwal?: { mode: 'void' | 'retur'; sale: BarisRiwayat };
  /** Dipanggil setelah void/retur sukses bila dibuka dari luar POS (tutup + muat ulang). */
  onSelesai?: () => void;
  onTutup: () => void;
}) {
  const [daftar, setDaftar] = useState<BarisRiwayat[] | null>(null);
  const [langkah, setLangkah] = useState<{ mode: 'void' | 'retur'; sale: BarisRiwayat } | null>(null);
  const [waStruk, setWaStruk] = useState<StrukData | null>(null);
  const [detail, setDetail] = useState<DetailJual | null>(null);
  const [sandiAdmin, setSandiAdmin] = useState('');
  const admin = useSesi().info?.pengguna.admin ?? false;
  const [alasan, setAlasan] = useState('');
  const [qtyRetur, setQtyRetur] = useState<Record<number, number>>({});
  const [sibuk, setSibuk] = useState(false);
  /** Galat void/retur ditampilkan di dalam modal (bukan hanya toast). */
  const [galatKirim, setGalatKirim] = useState<string | null>(null);

  const muat = () =>
    apiGet<{ data: BarisRiwayat[] }>('/api/pos/sales?per=50')
      .then((r) => setDaftar(r.data))
      .catch((e: Error) => beritahu(e.message, 'galat'));
  useEffect(() => {
    void muat();
  }, []);

  const bukaLangkah = async (mode: 'void' | 'retur', sale: BarisRiwayat) => {
    setLangkah({ mode, sale });
    setSandiAdmin('');
    setAlasan('');
    setQtyRetur({});
    setDetail(null);
    setGalatKirim(null);
    if (mode !== 'void') {
      try {
        const r = await apiGet<{ data: DetailJual }>(`/api/pos/sales/${sale.id}`);
        setDetail(r.data);
      } catch (e) {
        beritahu((e as Error).message, 'galat');
        setLangkah(null);
      }
    }
  };

  // M5 — dibuka dari halaman Riwayat Penjualan: langsung ke langkah yang diminta.
  const sudahAwal = useRef(false);
  useEffect(() => {
    if (sudahAwal.current || !langkahAwal) return;
    sudahAwal.current = true;
    void bukaLangkah(langkahAwal.mode, langkahAwal.sale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Pesan galat siap tampil: detail teknis basis data tidak pernah ditampilkan. */
  const pesanGalat = (e: unknown): string => {
    const mentah = (e as Error)?.message ?? 'Terjadi kesalahan. Coba lagi.';
    if (/current transaction is aborted|SQLSTATE|ER_|pg_|constraint|violates/i.test(mentah)) {
      return 'Proses pembatalan gagal dan tidak ada data yang berubah. Muat ulang daftar lalu coba lagi; bila berulang, hubungi administrator.';
    }
    return mentah;
  };

  const kirim = async () => {
    if (!langkah) return;
    setSibuk(true);
    setGalatKirim(null);
    try {
      if (langkah.mode === 'void') {
        await apiPost(`/api/pos/sales/${langkah.sale.id}/void`, { sandi: sandiAdmin, alasan: alasan || 'Void POS' });
        beritahu(`Penjualan ${langkah.sale.no_dokumen} di-void; stok & jurnal dibatalkan.`, 'sukses');
      } else {
        const items = Object.entries(qtyRetur)
          .map(([productId, qty]) => ({ product_id: Number(productId), qty }))
          .filter((i) => i.qty > 0);
        if (items.length === 0) {
          beritahu('Tentukan qty retur minimal satu item.', 'galat');
          setSibuk(false);
          return;
        }
        const r = await apiPost<{ no_dokumen: string }>(`/api/pos/sales/${langkah.sale.id}/retur`, { sandi: sandiAdmin, alasan: alasan || null, items });
        beritahu(`Retur ${r.no_dokumen} dibuat; stok kembali & kartu stok tercatat.`, 'sukses');
      }
      setLangkah(null);
      setDetail(null);
      setGalatKirim(null);
      if (onSelesai) {
        // Dibuka dari halaman Riwayat: tutup dialog & muat ulang daftar.
        onSelesai();
      } else {
        await muat();
      }
    } catch (e) {
      const pesan = pesanGalat(e);
      // Modal tetap terbuka agar password/alasan bisa diperbaiki.
      setGalatKirim(pesan);
      setSandiAdmin('');
      beritahu(pesan, 'galat');
    } finally {
      setSibuk(false);
    }
  };

  const p = profil ?? PROFIL_STRUK_BAWAAN;

  const strukDari = (sale: BarisRiwayat): Promise<StrukData> => strukDariSale(sale.id, namaUsaha);

  const cetakUlang = async (sale: BarisRiwayat) => {
    try {
      cetakStruk(await strukDari(sale), p);
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    }
  };

  const pdfUlang = async (sale: BarisRiwayat) => {
    try {
      simpanStrukPdf(await strukDari(sale), p);
      beritahu('Pilih "Save as PDF" pada dialog cetak — nama file mengikuti nomor struk.', 'info', 4000);
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    }
  };

  const kirimUlang = async (sale: BarisRiwayat) => {
    try {
      setWaStruk(await strukDari(sale));
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    }
  };

  return (
    <Modal judul={langkah ? (langkah.mode === 'void' ? `Void ${langkah.sale.no_dokumen}` : `Retur ${langkah.sale.no_dokumen}`) : 'Riwayat & Layanan Penjualan'} lebar="lebar" onTutup={onTutup}>
      <div className="pos-dialog">
        {!langkah && daftar === null && <p className="teks-redup">Memuat…</p>}
        {!langkah && daftar?.length === 0 && <p className="teks-redup">Belum ada penjualan.</p>}
        {!langkah && daftar && daftar.length > 0 && (
          <table className="pos-tabel-mini">
            <thead>
              <tr>
                <th>No. Dokumen</th>
                <th>Waktu</th>
                <th>Pelanggan</th>
                <th className="num">Total Qty</th>
                <th className="num">Total</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {daftar.map((s) => (
                <tr key={s.id}>
                  <td>{s.no_dokumen}</td>
                  <td>{formatTanggalWaktu(s.tanggal)}</td>
                  <td>{s.pelanggan ?? 'Umum'}</td>
                  <td className="num">{Number(s.total_qty ?? 0).toLocaleString('id-ID')}</td>
                  <td className="num">{formatRupiah(Number(s.total))}</td>
                  <td>{s.status}</td>
                  <td>
                    {s.status === 'disahkan' && admin && (
                      <>
                        <button type="button" className="bahaya" onClick={() => void bukaLangkah('void', s)}>
                          Void
                        </button>
                        <button type="button" onClick={() => void bukaLangkah('retur', s)}>
                          Retur
                        </button>
                      </>
                    )}
                    {/* J3: aksi struk — ikon saja (tooltip). */}
                    <IconButton label="Cetak struk" ikon="printer" ukuran="baris" onClick={() => void cetakUlang(s)} />
                    <IconButton label="Simpan struk (PDF)" ikon="download" ukuran="baris" onClick={() => void pdfUlang(s)} />
                    <IconButton label="Kirim struk (WhatsApp / Bagikan)" ikon="send" ukuran="baris" onClick={() => void kirimUlang(s)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {langkah && (
          <div className="pos-langkah">
            <p className="pos-catatan-kecil">
              {langkah.mode === 'void'
                ? 'Void membatalkan penjualan: stok kembali dan kas/piutang dibalik.'
                : 'Retur mengembalikan stok ke gudang dan mencatatnya di kartu stok (tipe Retur Penjualan).'}
            </p>

            {langkah.mode === 'retur' && (
              <section className="pos-langkah__tabel" aria-label="Daftar item yang diretur">
                <table className="pos-tabel-mini pos-tabel-mini--retur tabel-transaksi">
                  <colgroup>
                    <col style={{ width: '40%' }} />
                    <col style={{ width: '20%' }} />
                    <col style={{ width: '20%' }} />
                    <col style={{ width: '20%' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Produk</th>
                      <th>Qty Terjual</th>
                      <th>Harga</th>
                      <th>Qty Retur</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail?.items ?? []).map((i) => {
                      // Sisa yang masih boleh diretur = qty terjual − qty yang
                      // sudah diretur sebelumnya (retur disahkan).
                      const maks = Math.max(0, Number(i.qty) - Number(i.qty_retur ?? 0));
                      return (
                      <tr key={i.product_id}>
                        <td>{i.nama_produk}</td>
                        <td>{i.qty}</td>
                        <td>{formatRupiah(Number(i.harga))}</td>
                        <td>
                          {/* Nilai selalu dijepit 0..sisa: mengetik/menempel
                              angka lebih besar otomatis turun ke batas maksimal. */}
                          <input
                            className="pos-qty-retur"
                            name="qty"
                            inputMode="numeric"
                            disabled={maks === 0}
                            aria-label={`Qty retur ${i.nama_produk} (maks. ${maks})`}
                            title={maks === 0 ? 'Item ini sudah diretur seluruhnya' : `Maksimal ${maks}`}
                            max={maks}
                            value={qtyRetur[i.product_id] ?? 0}
                            onChange={(e) => {
                              const v = Math.min(maks, Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0));
                              setQtyRetur((q) => ({ ...q, [i.product_id]: v }));
                            }}
                            onBlur={(e) => {
                              const v = Math.min(maks, Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0));
                              setQtyRetur((q) => ({ ...q, [i.product_id]: v }));
                            }}
                          />
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            )}

            <section className="pos-langkah__form">
              <label className="bidang" htmlFor="pos-alasan">
                <span>{langkah.mode === 'void' ? 'Alasan pembatalan' : 'Alasan retur'}</span>
                <input
                  id="pos-alasan"
                  placeholder={langkah.mode === 'void' ? 'Alasan (opsional)' : 'mis. ukuran tidak sesuai / barang cacat'}
                  value={alasan}
                  onChange={(e) => setAlasan(e.target.value)}
                />
              </label>

              <label className="bidang" htmlFor="pos-sandi-admin">
                <span>
                  Password login Admin <span className="wajib">*</span>
                </span>
                <input
                  id="pos-sandi-admin"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  placeholder="Masukkan password Admin yang sedang login"
                  value={sandiAdmin}
                  onChange={(e) => {
                    setSandiAdmin(e.target.value);
                    if (galatKirim) setGalatKirim(null);
                  }}
                />
              </label>

              {galatKirim && (
                <p className="pos-galat-form" role="alert">
                  {galatKirim}
                </p>
              )}
            </section>

            <div className="pos-langkah__kaki">
              <button type="button" className="tombol" onClick={() => setLangkah(null)} disabled={sibuk}>
                Kembali
              </button>
              <button
                type="button"
                className="tombol tombol--primer"
                style={{ background: 'var(--danger-fill)', borderColor: 'var(--danger-fill)' }}
                onClick={kirim}
                disabled={sibuk || sandiAdmin.length === 0}
              >
                {sibuk ? 'Memproses…' : langkah.mode === 'void' ? 'Void Sekarang' : 'Buat Retur'}
              </button>
            </div>
          </div>
        )}
      </div>
      {waStruk && (
        <DialogWa
          faktur={{
            id: 0,
            no_faktur: waStruk.noDokumen,
            tanggal: waStruk.tanggal,
            total: waStruk.total,
          }}
          pihakNama={waStruk.pelanggan ?? ''}
          teleponAwal={waStruk.pelangganTelepon ?? ''}
          pesanLain={pesanWaStruk(waStruk)}
          gambar={gambarStrukDok(waStruk, p)}
          onTutup={() => setWaStruk(null)}
        />
      )}
    </Modal>
  );
}

/* ============================ Hasil struk ================================= */

/**
 * Dialog sukses transaksi (BAGIAN J3): pratinjau struk sesuai profil aktif +
 * aksi ikon (Simpan PDF, Cetak, Kirim, Transaksi Baru) dengan tooltip.
 * Pintasan: Enter = Cetak, N = Transaksi Baru, Esc = tutup.
 */
export function DialogStruk({
  struk,
  profil,
  cetakOtomatis = false,
  onBaru,
  onTutup,
}: {
  struk: StrukData;
  profil?: ProfilStruk | null;
  /** Opsi "Cetak otomatis setelah bayar" (Pengaturan › Struk). */
  cetakOtomatis?: boolean;
  onBaru?: () => void;
  onTutup: () => void;
}) {
  const [dlgWa, setDlgWa] = useState(false);
  const navigasi = useNavigate();
  const wadahBaruRef = useRef<HTMLSpanElement>(null);
  const p = profil ?? PROFIL_STRUK_BAWAAN;
  /** Pilihan cepat ukuran kertas di header pratinjau — hanya untuk tampilan
   *  dialog ini (profil tersimpan di Pengaturan › Struk tidak diubah). */
  const [kertasCepat, setKertasCepat] = useState(p.kertas);
  const pAktif: ProfilStruk = { ...p, kertas: kertasCepat };
  const tautan = struk.fakturId ? `${window.location.origin}/penjualan/dokumen/${struk.fakturId}` : '';
  const suai = { width: '100%', border: '0', background: '#fff' };

  const cetak = () => {
    try {
      cetakStruk(struk, pAktif);
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    }
  };
  const simpanPdf = () => {
    try {
      simpanStrukPdf(struk, pAktif);
      beritahu('Pilih "Save as PDF" pada dialog cetak — nama file mengikuti nomor struk.', 'info', 4000);
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    }
  };

  // Web Share API (perangkat yang mendukung) — bagikan GAMBAR struk + teks.
  const bisaBagikan = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const [sibukBagikan, setSibukBagikan] = useState(false);
  const bagikan = () => {
    if (sibukBagikan) return;
    setSibukBagikan(true);
    void (async () => {
      try {          const dok = gambarStrukDok(struk, pAktif);
          const png = await dokKePng(dok.model, dok.lebarPx);
        if (bisaBagikanGambar()) {
          const hasil = await bagikanGambar(png, dok.namaBerkas, `Struk ${struk.noDokumen}`, pesanWaStruk(struk));
          if (hasil === 'dibagikan') beritahu('Gambar struk dibagikan.', 'sukses');
          return;
        }
        void navigator
          .share({ title: `Struk ${struk.noDokumen}`, text: pesanWaStruk(struk), url: tautan || undefined })
          .catch(() => undefined); // pengguna membatalkan — abaikan
      } catch (e) {
        beritahu(e instanceof Error ? e.message : 'Gagal membagikan gambar struk.', 'galat');
      } finally {
        setSibukBagikan(false);
      }
    })();
  };

  // Cetak otomatis setelah bayar (sekali saat dialog dibuka).
  useEffect(() => {
    if (!cetakOtomatis) return;
    const t = window.setTimeout(() => {
      try {
        cetakStruk(struk, pAktif);
      } catch {
        /* popup diblokir — biarkan pengguna mencetak manual */
      }
    }, 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pintasan dialog: Enter = Cetak, N = Transaksi Baru.
  useEffect(() => {
    // Tombol "Transaksi Baru" (ikon plus) mendapat fokus otomatis.
    wadahBaruRef.current?.querySelector('button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        cetak();
        return;
      }
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        if (onBaru) onBaru();
        else onTutup();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <Modal
      judul="Transaksi Berhasil"
      lebar="sedang"
      onTutup={onTutup}
      aksi={
        <>
          <button type="button" className="tombol no-print" onClick={onTutup}>
            Tutup (Esc)
          </button>
        </>
      }
    >
      <div className="pos-dialog">
        {/* Pilihan cepat ukuran kertas — langsung memperbarui pratinjau */}
        <div className="pos-struk-kertas aksi-baris" role="group" aria-label="Ukuran kertas struk">
          <span className="teks-redup teks-kecil">Kertas</span>
          {(['58mm', '80mm', 'A4'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={`tombol tombol--kecil ${kertasCepat === k ? 'tombol--primer' : 'tombol--netral'}`}
              aria-pressed={kertasCepat === k}
              onClick={() => setKertasCepat(k)}
            >
              {k === 'A4' ? 'A4 / Fit Lebar Kertas' : k}
            </button>
          ))}
        </div>
        {/* Pratinjau struk sesuai profil aktif (BAGIAN J4) */}
        <div className="pos-struk-pratinjau">
          <iframe
            title="Pratinjau struk"
            srcDoc={pratinjauStruk(struk, pAktif)}
            style={{ ...suai, height: 360 }}
            aria-label="Pratinjau struk"
          />
        </div>

        {/* Aksi ikon (tooltip) — J3 */}
        <div className="faktur-sukses">
          <span className="teks-redup teks-kecil">
            Struk {struk.noDokumen} · {kertasCepat}
          </span>
          <div className="aksi-baris">
            {/* J3: Transaksi Baru — ikon plus, fokus otomatis; pintasan N. */}
            <span ref={wadahBaruRef} className="ikon-transaksi-baru">
              <IconButton
                label="Transaksi Baru (N)"
                ikon="plus"
                warna="primer"
                ukuran="toolbar"
                onClick={() => (onBaru ? onBaru() : onTutup())}
              />
            </span>
            <IconButton label="Simpan (PDF)" ikon="download" onClick={simpanPdf} />
            <IconButton label="Cetak" ikon="printer" onClick={cetak} />
            <IconButton label="Kirim (WhatsApp / Bagikan)" ikon="send" onClick={() => setDlgWa(true)} />
            {bisaBagikan && <IconButton label="Bagikan (Web Share)" ikon="share" onClick={bagikan} />}
            {struk.fakturId ? (
              <IconButton
                label="Buka faktur"
                ikon="faktur"
                onClick={() => navigasi(`/penjualan/dokumen/${struk.fakturId}`)}
              />
            ) : null}
          </div>
        </div>
        <p className="pos-catatan-kecil no-print">
          Enter = cetak · N = transaksi baru · Esc = tutup. Stok berkurang, kartu stok &amp; jurnal terbentuk otomatis.
        </p>

        {dlgWa && (
          <DialogWa
            faktur={{
              id: Number(struk.fakturId ?? 0),
              no_faktur: struk.noDokumen,
              tanggal: struk.tanggal,
              total: struk.total,
            }}
          pihakNama={struk.pelanggan ?? ''}
          teleponAwal={struk.pelangganTelepon ?? ''}
          pesanLain={pesanWaStruk(struk, tautan)}
          gambar={gambarStrukDok(struk, pAktif)}
          onTutup={() => setDlgWa(false)}
          />
        )}
      </div>
    </Modal>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '../../components/crud/Modal';
import { beritahu } from '../../components/crud/Toast';
import { apiGet, apiPost } from '../../lib/api';
import { formatRupiah } from '../../lib/format';
import { bukaWa, formatWa62, nomorWaValid } from '../faktur/aksi';

/**
 * BAYAR PIUTANG DARI KASIR — daftar tagihan piutang aktif pelanggan, input
 * nominal (cicilan / pelunasan penuh), metode Tunai atau Transfer.
 *
 * Endpoint `/api/pos/piutang/:id/catat` memakai izin modul Penjualan/POS
 * (bukan Akuntansi), mengurangi sisa piutang, melunasi status saat sisa 0,
 * menggerakkan Kas & Bank, dan menautkan penerimaan TUNAI ke shift kasir
 * aktif agar laporan tutup kasir akurat.
 */

export interface BarisPiutang {
  id: number;
  no_dokumen: string;
  tanggal: string;
  pelanggan: string | null;
  pelanggan_telepon?: string | null;
  jatuh_tempo: string | null;
  total: number;
  terbayar: number;
  sisa: number;
  status: string;
}

/** Pesan pengingat tagihan via WhatsApp (nomor otomatis 62xxx). */
export function pesanPengingatPiutang(b: BarisPiutang): string {
  const tgl = (v: string | null): string => (v ? String(v).slice(0, 10) : '—');
  return [
    `Halo ${b.pelanggan ?? 'Bapak/Ibu'},`,
    '',
    `Kami mengingatkan tagihan *${b.no_dokumen}* tanggal ${tgl(b.tanggal)}:`,
    `Total: ${formatRupiah(Number(b.total) || 0)}`,
    `Sudah dibayar: ${formatRupiah(Number(b.terbayar) || 0)}`,
    `Sisa: *${formatRupiah(Number(b.sisa) || 0)}*`,
    `Jatuh tempo: ${tgl(b.jatuh_tempo)}`,
    '',
    'Terima kasih.',
  ].join('\n');
}

export function DialogPiutang({
  onTutup,
  onSukses,
}: {
  onTutup: () => void;
  /** Dipanggil setelah pembayaran tersimpan (muat ulang shift/ringkasan). */
  onSukses?: () => void;
}) {
  const [daftar, setDaftar] = useState<BarisPiutang[]>([]);
  const [memuat, setMemuat] = useState(true);
  const [kata, setKata] = useState('');
  const [pilih, setPilih] = useState<BarisPiutang | null>(null);
  const [jumlah, setJumlah] = useState('');
  const [metode, setMetode] = useState<'tunai' | 'transfer'>('tunai');
  const [sibuk, setSibuk] = useState(false);

  const muat = useCallback(async () => {
    setMemuat(true);
    try {
      const r = await apiGet<{ data: BarisPiutang[] }>('/api/pos/receivables?per=100');
      setDaftar(r.data.filter((x) => x.status !== 'lunas' && x.status !== 'batal' && Number(x.sisa) > 0));
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    } finally {
      setMemuat(false);
    }
  }, []);

  useEffect(() => {
    void muat();
  }, [muat]);

  const tersaring = useMemo(() => {
    const k = kata.trim().toLowerCase();
    if (!k) return daftar;
    return daftar.filter((b) =>
      `${b.no_dokumen} ${b.pelanggan ?? ''} ${b.pelanggan_telepon ?? ''}`.toLowerCase().includes(k),
    );
  }, [daftar, kata]);

  const totalSisa = tersaring.reduce((n, b) => n + (Number(b.sisa) || 0), 0);
  const nominal = Math.round(Number(jumlah) || 0);

  const bukaPilih = (b: BarisPiutang) => {
    setPilih(b);
    setJumlah(String(Math.round(Number(b.sisa) || 0)));
    setMetode('tunai');
  };

  const simpan = async () => {
    if (!pilih || sibuk) return;
    if (!(nominal > 0)) {
      beritahu('Nominal pembayaran harus lebih dari 0.', 'galat');
      return;
    }
    if (nominal > Number(pilih.sisa) + 0.5) {
      beritahu('Nominal melebihi sisa piutang.', 'galat');
      return;
    }
    setSibuk(true);
    try {
      const r = await apiPost<{ status: string; sisa: number; tunai: boolean }>(
        `/api/pos/piutang/${pilih.id}/catat`,
        { jumlah: nominal, metode },
      );
      beritahu(
        r.status === 'lunas'
          ? `Piutang ${pilih.no_dokumen} LUNAS.${r.tunai ? ' Uang tunai masuk shift kasir.' : ''}`
          : `Pembayaran ${formatRupiah(nominal)} dicatat — sisa ${formatRupiah(r.sisa)}.${r.tunai ? ' Tunai masuk shift kasir.' : ''}`,
        'sukses',
      );
      setPilih(null);
      setJumlah('');
      await muat();
      onSukses?.();
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    } finally {
      setSibuk(false);
    }
  };

  const kirimWa = (b: BarisPiutang) => {
    if (!nomorWaValid(b.pelanggan_telepon ?? '')) {
      beritahu('Nomor WhatsApp pelanggan belum ada di master. Lengkapi di Master › Pelanggan.', 'galat');
      return;
    }
    bukaWa(String(b.pelanggan_telepon), pesanPengingatPiutang(b));
  };

  return (
    <Modal
      judul="Bayar Piutang"
      lebar="sedang"
      onTutup={onTutup}
      aksi={
        <>
          <button type="button" className="tombol tombol--netral" onClick={onTutup} disabled={sibuk}>
            Tutup
          </button>
          {pilih && (
            <button type="button" className="tombol tombol--primer" onClick={() => void simpan()} disabled={sibuk}>
              {sibuk ? 'Menyimpan…' : 'Catat Pembayaran'}
            </button>
          )}
        </>
      }
    >
      <div className="pos-piutang">
        <label className="bidang">
          <span>Cari tagihan / pelanggan</span>
          <input
            value={kata}
            onChange={(e) => setKata(e.target.value)}
            placeholder="No. dokumen, nama, atau nomor WA…"
            aria-label="Cari tagihan piutang"
            autoFocus
          />
          <small className="teks-redup">
            {tersaring.length} tagihan aktif · total sisa {formatRupiah(totalSisa)}
          </small>
        </label>

        <div className="tabel-bungkus pos-piutang__daftar">
          <table className="tabel">
            <thead>
              <tr>
                <th>Dokumen</th>
                <th>Pelanggan</th>
                <th>Jatuh tempo</th>
                <th className="rata-kanan">Sisa</th>
                <th className="rata-tengah">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {memuat && (
                <tr>
                  <td colSpan={5} className="tabel-kosong">Memuat piutang…</td>
                </tr>
              )}
              {!memuat && tersaring.length === 0 && (
                <tr>
                  <td colSpan={5} className="tabel-kosong">Tidak ada piutang aktif.</td>
                </tr>
              )}
              {tersaring.map((b) => {
                const telat = b.jatuh_tempo ? new Date(b.jatuh_tempo).getTime() < Date.now() : false;
                return (
                  <tr key={b.id} className={pilih?.id === b.id ? 'pos-piutang__pilih' : undefined}>
                    <td data-label="Dokumen">
                      <strong>{b.no_dokumen}</strong>
                      <div className="teks-redup teks-kecil">{String(b.tanggal).slice(0, 10)}</div>
                    </td>
                    <td data-label="Pelanggan">
                      {b.pelanggan ?? 'Umum'}
                      {b.pelanggan_telepon ? (
                        <div className="teks-redup teks-kecil">WA {formatWa62(b.pelanggan_telepon)}</div>
                      ) : (
                        <div className="teks-redup teks-kecil">nomor WA belum ada</div>
                      )}
                    </td>
                    <td data-label="Jatuh tempo">
                      {b.jatuh_tempo ? String(b.jatuh_tempo).slice(0, 10) : '—'}
                      {telat && <span className="lencana lencana--bahaya">Telat</span>}
                    </td>
                    <td data-label="Sisa" className="rata-kanan">
                      <strong>{formatRupiah(Number(b.sisa) || 0)}</strong>
                      <div className="teks-redup teks-kecil">dari {formatRupiah(Number(b.total) || 0)}</div>
                    </td>
                    <td data-label="Aksi" className="rata-tengah">
                      <span className="aksi-baris">
                        <button type="button" className="tombol tombol--kecil tombol--primer" onClick={() => bukaPilih(b)}>
                          Bayar
                        </button>
                        <button
                          type="button"
                          className="tombol tombol--kecil"
                          onClick={() => kirimWa(b)}
                          title="Kirim pengingat tagihan via WhatsApp"
                        >
                          💬 WA
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {pilih && (
          <div className="pos-piutang__form">
            <h4>Bayar {pilih.no_dokumen}</h4>
            <p className="teks-redup teks-kecil">
              Pelanggan {pilih.pelanggan ?? 'Umum'} · sisa{' '}
              <strong>{formatRupiah(Number(pilih.sisa) || 0)}</strong>
            </p>
            <div className="pos-piutang__isi">
              <label className="bidang">
                <span>Nominal bayar (cicilan / pelunasan)</span>
                <input
                  type="number"
                  min={0}
                  max={Number(pilih.sisa) || 0}
                  value={jumlah}
                  onChange={(e) => setJumlah(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void simpan();
                  }}
                  aria-label="Nominal pembayaran piutang"
                />
              </label>
              <label className="bidang">
                <span>Metode bayar</span>
                <select
                  value={metode}
                  onChange={(e) => setMetode(e.target.value === 'transfer' ? 'transfer' : 'tunai')}
                  aria-label="Metode pembayaran piutang"
                >
                  <option value="tunai">Tunai (masuk shift kasir)</option>
                  <option value="transfer">Transfer / Rekening Kas &amp; Bank</option>
                </select>
              </label>
            </div>
            <div className="tombol-baris">
              <button type="button" className="tombol tombol--netral tombol--kecil" onClick={() => setJumlah(String(Math.round(Number(pilih.sisa) || 0)))}>
                Lunasi ({formatRupiah(Number(pilih.sisa) || 0)})
              </button>
              <button type="button" className="tombol tombol--netral tombol--kecil" onClick={() => setPilih(null)}>
                Batal pilih
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

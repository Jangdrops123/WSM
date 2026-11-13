import { useState } from 'react';
import { Modal } from '../../components/crud/Modal';
import { beritahu } from '../../components/crud/Toast';
import { apiPost } from '../../lib/api';
import { formatRupiah } from '../../lib/format';
import type { BarisPengingat } from './tipe';

/**
 * Dialog "Catat pembayaran" dari kartu Pengingat: mencatat pelunasan piutang
 * / pembayaran hutang (boleh sebagian) langsung dari Dashboard —
 * server memperbarui terbayar, tabel payments, dan jurnal (Dr Kas / Cr Piutang,
 * atau Dr Utang / Cr Kas).
 */
export function DialogBayar({
  baris,
  tipe,
  onTutup,
  onSelesai,
}: {
  baris: BarisPengingat;
  tipe: 'piutang' | 'hutang';
  onTutup: () => void;
  onSelesai: () => void;
}) {
  const [jumlah, setJumlah] = useState(String(Math.round(baris.sisa)));
  const [metode, setMetode] = useState('tunai');
  const [kirim, setKirim] = useState(false);

  const nilai = Number(jumlah);
  valid();
  function valid(): boolean {
    return Number.isFinite(nilai) && nilai > 0 && nilai <= baris.sisa + 0.5;
  }

  async function simpan() {
    if (!valid()) {
      beritahu(`Jumlah tidak valid — maksimal ${formatRupiah(baris.sisa)} (sisa tagihan).`, 'galat');
      return;
    }
    setKirim(true);
    try {
      const r = await apiPost<{ data: { status: string } }>('/api/dashboard/pelunasan', {
        tipe,
        id: baris.id,
        jumlah: nilai,
        metode,
      });
      beritahu(
        r.data.status === 'lunas'
          ? `${baris.no_faktur} lunas. Pembayaran tercatat.`
          : `Pembayaran ${formatRupiah(nilai)} tercatat — sisa ${formatRupiah(baris.sisa - nilai)}.`,
      );
      onSelesai();
      onTutup();
    } catch (e) {
      beritahu(e instanceof Error ? e.message : 'Gagal mencatat pembayaran.', 'galat');
    } finally {
      setKirim(false);
    }
  }

  return (
    <Modal
      judul={`Catat pembayaran ${tipe === 'piutang' ? 'piutang' : 'hutang'}`}
      onTutup={onTutup}
      sedangKirim={kirim}
      aksi={
        <>
          <button type="button" className="tombol tombol--netral" onClick={onTutup} disabled={kirim}>
            Batal
          </button>
          <button type="button" className="tombol tombol--sukses" onClick={() => void simpan()} disabled={kirim}>
            {kirim ? 'Menyimpan…' : 'Simpan pembayaran'}
          </button>
        </>
      }
    >
      <div className="bayar-ringkas">
        <span className="teks-redup">
          {baris.pihak} · {baris.no_faktur}
          {baris.jatuh_tempo ? ` · jatuh tempo ${baris.jatuh_tempo.slice(0, 10)}` : ''}
        </span>
        <strong>{formatRupiah(baris.sisa)}</strong>
        <span className="teks-redup teks-kecil">
          Sisa tagihan (total {formatRupiah(baris.total)}, sudah dibayar {formatRupiah(baris.terbayar)}).
        </span>
      </div>

      <label className="bidang" style={{ marginBottom: 14 }}>
        <span>Jumlah pembayaran</span>
        <input
          type="number"
          min={1}
          max={Math.round(baris.sisa)}
          value={jumlah}
          onChange={(e) => setJumlah(e.target.value)}
          autoFocus
        />
        <small className="teks-redup">
          Bayar sebagian diperbolehkan — masukkan angka lebih kecil dari sisa.
        </small>
      </label>

      <div>
        <span className="teks-redup teks-kecil">Metode (akun kas tujuan):</span>
        <div className="bayar-metode" style={{ marginTop: 8 }}>
          {[
            { v: 'tunai', l: 'Tunai (Kas)' },
            { v: 'transfer', l: 'Transfer (Bank)' },
            { v: 'qris', l: 'QRIS' },
          ].map((m) => (
            <label key={m.v} className={metode === m.v ? 'aktif' : ''}>
              <input
                type="radio"
                name="metode-bayar"
                checked={metode === m.v}
                onChange={() => setMetode(m.v)}
              />
              {m.l}
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}

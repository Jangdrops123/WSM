import { useState } from 'react';
import { Modal } from '../crud/Modal';

/**
 * Dialog konfirmasi pembatalan transaksi (Penjualan, Pembelian, PO).
 * Alasan wajib diisi; transaksi POS juga meminta password akun sendiri karena
 * void mengembalikan stok & membalik kas/piutang.
 */
export function DialogBatal({
  judul,
  deskripsi,
  butuhSandi = false,
  labelKonfirmasi = 'Ya, batalkan transaksi',
  sibuk = false,
  galat = null,
  onKirim,
  onTutup,
}: {
  judul: string;
  deskripsi: string;
  butuhSandi?: boolean;
  labelKonfirmasi?: string;
  sibuk?: boolean;
  /** Pesan galat dari server (mis. password salah) — tampil di dalam modal. */
  galat?: string | null;
  onKirim: (alasan: string, sandi: string) => void | Promise<void>;
  onTutup: () => void;
}) {
  const [alasan, setAlasan] = useState('');
  const [sandi, setSandi] = useState('');
  const siap = alasan.trim().length > 0 && (!butuhSandi || sandi.length > 0);

  return (
    <Modal
      judul={judul}
      lebar="kecil"
      onTutup={onTutup}
      sedangKirim={sibuk}
      aksi={
        <>
          <button type="button" className="tombol tombol--netral" onClick={onTutup} disabled={sibuk}>
            Kembali
          </button>
          <button
            type="button"
            className="tombol tombol--bahaya"
            disabled={!siap || sibuk}
            onClick={() => void onKirim(alasan.trim(), sandi)}
          >
            {sibuk ? 'Memproses…' : labelKonfirmasi}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <p className="teks-redup teks-kecil">{deskripsi}</p>
        <label className="bidang">
          <span>Alasan pembatalan *</span>
          <textarea
            value={alasan}
            rows={3}
            maxLength={500}
            placeholder="mis. salah input qty / pelanggan membatalkan pesanan"
            onChange={(e) => setAlasan(e.target.value)}
            autoFocus
          />
        </label>
        {butuhSandi && (
          <label className="bidang">
            <span>Password akun Anda *</span>
            <input
              type="password"
              value={sandi}
              autoComplete="current-password"
              placeholder="Ketik ulang password login"
              onChange={(e) => setSandi(e.target.value)}
            />
          </label>
        )}
        {galat && (
          <p className="teks-galat teks-kecil" role="alert" style={{ margin: 0 }}>
            {galat}
          </p>
        )}
        <p className="teks-redup teks-kecil">
          Stok, piutang/hutang, dan kas terkait akan disesuaikan otomatis; tindakan ini tercatat di audit log.
        </p>
      </div>
    </Modal>
  );
}

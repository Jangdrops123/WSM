import { useState } from 'react';
import { Modal } from '../../components/crud/Modal';
import { beritahu } from '../../components/crud/Toast';
import { bukaWa, formatWa62, nomorWaValid, pesanWaFaktur } from './aksi';
import {
  bagikanGambar,
  bisaBagikanGambar,
  dokKePng,
  gambarFaktur,
  unduhBlob,
  type GambarDok,
} from '../../lib/gambarDok';

/**
 * Dialog "Kirim via WhatsApp" (BAGIAN I4): mengisi otomatis nomor faktur,
 * tanggal, total, dan tautan dokumen. Bila nomor kosong/tidak valid, pengguna
 * diminta mengisinya dulu; nomor otomatis diformat ke kode negara 62.
 *
 * Selain teks, dialog bisa mengirim GAMBAR dokumen (struk/faktur):
 * - prop `gambar`: struk sudah jadi (HTML + lebar + nama berkas).
 * - bila tidak ada tapi `faktur.id > 0`: kartu faktur diambil dari server.
 * Gambar dibagikan lewat Web Share API (langsung terpasang di WhatsApp)
 * atau diunduh agar dilampirkan manual bila perangkat tak mendukung.
 */
export function DialogWa({
  faktur,
  namaToko,
  teleponAwal = '',
  pihakNama = '',
  pesanLain,
  gambar,
  onTutup,
}: {
  faktur: { id: number; no_faktur: string; tanggal: string; total: number };
  namaToko?: string;
  teleponAwal?: string;
  pihakNama?: string;
  /** Isi pesan lain (mis. struk POS) menggantikan pesan faktur otomatis. */
  pesanLain?: string;
  /** Dokumen gambar siap raster (struk). Kosong = ambil kartu faktur via id. */
  gambar?: GambarDok;
  onTutup: () => void;
}) {
  const [nomor, setNomor] = useState(teleponAwal);
  const [sibukGambar, setSibukGambar] = useState(false);
  const pesan = pesanLain ?? pesanWaFaktur(faktur, namaToko);
  const adaGambar = Boolean(gambar) || faktur.id > 0;

  const kirim = () => {
    if (!nomorWaValid(nomor)) {
      beritahu('Nomor WhatsApp belum valid — isi nomor dulu (contoh: 08123456789).', 'galat');
      return;
    }
    bukaWa(nomor, pesan);
    onTutup();
  };

  const kirimGambar = () => {
    if (sibukGambar) return;
    if (!nomorWaValid(nomor)) {
      beritahu('Nomor WhatsApp belum valid — isi nomor dulu (contoh: 08123456789).', 'galat');
      return;
    }
    setSibukGambar(true);
    void (async () => {
      try {          const dok = gambar ?? (await gambarFaktur(faktur.id));
          const png = await dokKePng(dok.model, dok.lebarPx);
        if (bisaBagikanGambar()) {
          const hasil = await bagikanGambar(png, dok.namaBerkas, faktur.no_faktur, pesan);
          if (hasil === 'dibagikan') {
            beritahu('Gambar terkirim — lanjutkan pengiriman di WhatsApp.', 'sukses');
            onTutup();
            return;
          }
          if (hasil === 'batal') return; // pengguna membatalkan — diam saja
        }
        // Perangkat tak mendukung berbagi berkas: unduh + buka teks seperti biasa.
        unduhBlob(png, dok.namaBerkas);
        beritahu('Gambar dokumen diunduh — lampirkan manual di WhatsApp.', 'info', 5000);
        bukaWa(nomor, pesan);
        onTutup();
      } catch (e) {
        beritahu(e instanceof Error ? e.message : 'Gagal membuat gambar dokumen.', 'galat');
      } finally {
        setSibukGambar(false);
      }
    })();
  };

  return (
    <Modal
      judul={`Kirim faktur ${faktur.no_faktur} via WhatsApp`}
      onTutup={onTutup}
      aksi={
        <>
          <button type="button" className="tombol tombol--netral" onClick={onTutup}>
            Batal
          </button>
          <button type="button" className="tombol tombol--netral" onClick={kirim}>
            Buka WhatsApp
          </button>
          {adaGambar && (
            <button
              type="button"
              className="tombol tombol--primer"
              onClick={kirimGambar}
              disabled={sibukGambar}
            >
              {sibukGambar ? 'Menyiapkan gambar…' : 'Kirim gambar'}
            </button>
          )}
        </>
      }
    >
      <div className="faktur-wa">
        <label className="bidang">
          <span>Nomor WhatsApp{pihakNama ? ` (${pihakNama})` : ''}</span>
          <input
            type="tel"
            value={nomor}
            onChange={(e) => setNomor(e.target.value)}
            placeholder="08123456789 atau 628123456789"
            autoFocus
          />
          <small className="teks-redup">
            {nomor.trim()
              ? `Akan dikirim ke ${formatWa62(nomor) || '—'} (kode negara 62 otomatis).`
              : 'Nomor kosong — isi dulu sebelum dikirim.'}
          </small>
        </label>
        <div>
          <div className="teks-redup teks-kecil">Pesan otomatis:</div>
          <div className="faktur-wa__pratinjau">{pesan}</div>
          {adaGambar && (
            <div className="teks-redup teks-kecil" style={{ marginTop: 6 }}>
              “Kirim gambar” melampirkan gambar struk/faktur, bukan hanya tulisan.
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

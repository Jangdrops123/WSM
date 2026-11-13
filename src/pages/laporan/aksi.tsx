import { useState } from 'react';
import { MenuAksi } from '../../components/MenuAksi';
import { Modal } from '../../components/crud/Modal';
import { beritahu } from '../../components/crud/Toast';
import { apiPost } from '../../lib/api';
import { namaPeran, peranAktif } from '../../lib/pengguna';
import { bukaWa, nomorWaValid } from '../faktur/aksi';
import { cetakLaporan, type MetaCetak, type OpsiCetak } from './cetak';
import { DialogCetakLaporan } from './DialogCetakLaporan';
import type { KolomLaporan } from './tipe';

/**
 * N4 — Opsi A: satu tombol kebab "Aksi laporan" berisi menu turun:
 * Ekspor Excel, Ekspor PDF, Cetak, Kirim, Simpan Laporan, Segarkan.
 * Ekspor & cetak dicatat ke log aktivitas (N7).
 */

export interface PropsAksi {
  kode: string;
  judul: string;
  kolom: KolomLaporan[];
  rows: Record<string, unknown>[];
  total: Record<string, unknown> | null;
  filter: [string, string][];
  /** Query string filter & periode lengkap (untuk URL ekspor). */
  ser: string;
  namaUsaha: string;
  alamatUsaha?: string;
  pesanRingkas: string;
  onSegar: () => void;
  setelahSimpan?: () => void;
}

function catat(kode: string, aksi: 'cetak' | 'kirim' | 'ekspor'): void {
  void apiPost('/api/laporan/log-aksi', { kode, aksi }).catch(() => undefined);
}

export function AksiLaporan(p: PropsAksi) {
  const [dlg, setDlg] = useState<'cetak' | 'kirim' | 'simpan' | null>(null);
  const [nomor, setNomor] = useState('');
  const [pesan, setPesan] = useState('');
  const [namaSimpan, setNamaSimpan] = useState('');
  const [jadwal, setJadwal] = useState('');
  const [sibuk, setSibuk] = useState(false);

  const eksporUrl = `/api/laporan/${encodeURIComponent(p.kode)}/ekspor?${p.ser}`;

  const jalanCetak = (opsi: OpsiCetak) => {
    setDlg(null);
    const w = cetakLaporan({
      judul: p.judul,
      namaUsaha: p.namaUsaha,
      alamatUsaha: p.alamatUsaha,
      kolom: p.kolom,
      rows: p.rows,
      total: p.total,
      filter: p.filter,
      opsi,
      pencetak: namaPeran(peranAktif()),
    });
    if (w) catat(p.kode, 'cetak');
    else beritahu('Popup cetak diblokir peramban — izinkan popup untuk situs ini.', 'galat');
  };

  const bukaDlg = (d: 'cetak' | 'kirim' | 'simpan') => {
    if (d === 'kirim') setPesan(p.pesanRingkas);
    if (d === 'simpan') setNamaSimpan(`${p.judul} — ${p.filter[0]?.[1] ?? ''}`.slice(0, 80));
    setDlg(d);
  };

  return (
    <>
      <MenuAksi
        label="Aksi laporan"
        items={[
          { label: 'Ekspor Excel', href: eksporUrl, unduh: true, jalan: () => catat(p.kode, 'ekspor') },
          { label: 'Ekspor PDF', jalan: () => setDlg('cetak') },
          { label: 'Cetak', jalan: () => setDlg('cetak') },
          { label: 'Kirim (WhatsApp / Bagikan)', jalan: () => bukaDlg('kirim') },
          { label: 'Simpan Laporan', jalan: () => bukaDlg('simpan') },
          { label: 'Segarkan', jalan: () => p.onSegar() },
        ]}
      />

      {dlg === 'cetak' && (
        <DialogCetakLaporan
          meta={{
            judul: p.judul,
            namaUsaha: p.namaUsaha,
            alamatUsaha: p.alamatUsaha,
            kolom: p.kolom,
            rows: p.rows,
            total: p.total,
            filter: p.filter,
            pencetak: namaPeran(peranAktif()),
            // Opsi cetak awal diisi DialogCetakLaporan dari default + preferensi
            // tersimpan (localStorage), bukan dari konstanta ini.
          } satisfies MetaCetak}
          onTutup={() => setDlg(null)}
          onCetak={jalanCetak}
          onKirim={() => {
            setPesan(p.pesanRingkas);
            setDlg('kirim');
          }}
        />
      )}

      {dlg === 'kirim' && (
        <Modal
          judul={`Kirim laporan: ${p.judul}`}
          lebar="sedang"
          onTutup={() => setDlg(null)}
          aksi={
            <>
              <button type="button" className="tombol tombol--netral" onClick={() => setDlg(null)}>
                Batal
              </button>
              <button
                type="button"
                className="tombol"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(pesan)
                    .then(() => beritahu('Pesan laporan disalin ke papan klip.', 'sukses'));
                }}
              >
                Salin pesan
              </button>
              <button
                type="button"
                className="tombol tombol--primer"
                onClick={async () => {
                  if (nomor && !nomorWaValid(nomor)) {
                    beritahu('Nomor WhatsApp belum valid (min. 9 digit).', 'galat');
                    return;
                  }
                  catat(p.kode, 'kirim');
                  if (nomor) {
                    bukaWa(nomor, pesan);
                    setDlg(null);
                    return;
                  }
                  if (navigator.share) {
                    try {
                      await navigator.share({ title: p.judul, text: pesan });
                      setDlg(null);
                      return;
                    } catch {
                      /* pengguna batal — biarkan dialog terbuka */
                    }
                  }
                  beritahu('Isi nomor WhatsApp atau gunakan tombol Salin pesan.', 'info');
                }}
              >
                {nomor ? 'Buka WhatsApp' : 'Bagikan'}
              </button>
            </>
          }
        >
          <label className="bidang">
            <span>Nomor WhatsApp (opsional)</span>
            <input
              type="tel"
              value={nomor}
              onChange={(e) => setNomor(e.target.value)}
              placeholder="08123456789 — kosongkan untuk memakai dialog berbagi"
            />
          </label>
          <label className="bidang">
            <span>Pesan</span>
            <textarea rows={7} value={pesan} onChange={(e) => setPesan(e.target.value)} />
          </label>
          <p className="teks-redup teks-kecil">
            Lampirkan PDF-nya dengan lebih dulu membuka ikon Cetak → “Save as PDF”.
          </p>
        </Modal>
      )}

      {dlg === 'simpan' && (
        <Modal
          judul="Simpan Laporan"
          lebar="kecil"
          onTutup={() => setDlg(null)}
          sedangKirim={sibuk}
          aksi={
            <>
              <button type="button" className="tombol tombol--netral" onClick={() => setDlg(null)} disabled={sibuk}>
                Batal
              </button>
              <button
                type="button"
                className="tombol tombol--primer"
                disabled={sibuk || !namaSimpan.trim()}
                onClick={async () => {
                  setSibuk(true);
                  try {
                    await apiPost('/api/laporan/tersimpan', {
                      nama: namaSimpan.trim(),
                      laporan: p.kode,
                      params: Object.fromEntries(new URLSearchParams(p.ser)),
                      jadwal: jadwal || null,
                    });
                    beritahu(`Laporan tersimpan${jadwal ? ` · jadwal ${jadwal}` : ''}.`, 'sukses');
                    setDlg(null);
                    p.setelahSimpan?.();
                  } catch (e) {
                    beritahu((e as Error).message, 'galat');
                  } finally {
                    setSibuk(false);
                  }
                }}
              >
                Simpan
              </button>
            </>
          }
        >
          <label className="bidang">
            <span>Nama laporan</span>
            <input value={namaSimpan} onChange={(e) => setNamaSimpan(e.target.value)} autoFocus placeholder="Contoh: Penjualan Bulan Ini - Gudang Pusat" />
          </label>
          <label className="bidang">
            <span>Penjadwalan (opsional)</span>
            <select value={jadwal} onChange={(e) => setJadwal(e.target.value)}>
              <option value="">Tanpa jadwal</option>
              <option value="harian">Harian</option>
              <option value="mingguan">Mingguan</option>
              <option value="bulanan">Bulanan</option>
            </select>
            <small className="teks-redup">
              Laporan berjadwal dijalankan dari halaman “Laporan Tersimpan” dan hasilnya masuk berkas laporan.
            </small>
          </label>
        </Modal>
      )}
    </>
  );
}

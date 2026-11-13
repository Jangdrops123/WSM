// BAGIAN AJ — footer paginasi bersama untuk semua daftar Master Data.
// Sisi kiri: ringkasan halaman, atau (saat ada pilihan) jumlah terpilih +
// ikon aksi massal + tautan "pilih semua sesuai filter". Sisi kanan: baris per
// halaman (Otomatis/20/50/100) dan tombol Sebelumnya/Berikutnya. Footer tidak
// ikut tergulir karena berada di luar area tabel yang flex.
import type { AksiMassalItem } from './AksiMassal';
import { IconButton } from '../IconButton';
import { PILIHAN_BARIS, type ModeBaris } from '../../lib/barisOtomatis';

export interface SeleksiFooter {
  jumlah: number;
  total: number;
  semuaFilter: boolean;
  label: string;
  onPilihSemua: () => void;
  onBatal: () => void;
  aksi: AksiMassalItem[];
}

export function FooterDaftar({
  mode,
  onMode,
  hal,
  totalHal,
  total,
  onHal,
  seleksi,
}: {
  mode: ModeBaris;
  onMode: (m: ModeBaris) => void;
  hal: number;
  totalHal: number;
  total: number;
  onHal: (n: number) => void;
  /** Tanpa objek ini → footer ringkasan + paginasi biasa (tanpa pilihan). */
  seleksi?: SeleksiFooter;
}) {
  const adaPilihan = !!seleksi && seleksi.jumlah > 0;

  return (
    <div className={`paginasi paginasi--fit ${adaPilihan ? 'paginasi--pilih-aktif' : ''}`}>
      <div className="paginasi__kiri">
        {adaPilihan ? (
          <div className="paginasi__pilih">
            <strong>
              {seleksi.jumlah} {seleksi.label} dipilih
            </strong>
            <span className="ikon-grup" role="group" aria-label="Aksi massal">
              {seleksi.aksi.map((a) => (
                <IconButton
                  key={a.kode}
                  label={a.label}
                  ikon={a.ikon ?? 'pencil'}
                  ukuran="baris"
                  warna={a.bahaya ? 'bahaya' : a.primer ? 'primer' : 'netral'}
                  onClick={a.jalan}
                />
              ))}
              <IconButton label="Batalkan pilihan" ikon="close" ukuran="baris" onClick={seleksi.onBatal} />
            </span>
            {!seleksi.semuaFilter && seleksi.total > seleksi.jumlah && (
              <button type="button" className="paginasi__tautan" onClick={seleksi.onPilihSemua}>
                Pilih semua {seleksi.total} {seleksi.label} sesuai filter
              </button>
            )}
          </div>
        ) : (
          <span className="teks-redup teks-kecil paginasi__ringkas">
            Hal {hal} dari {totalHal} · {total} data
          </span>
        )}
      </div>

      <div className="paginasi__kontrol">
        {/* AL4 — kompak mobile: "1/19" + ikon < >. */}
        <span className="paginasi__kompak" aria-hidden="true">
          {hal}/{totalHal}
        </span>
        <label className="paginasi__per">
          <span>Baris per halaman</span>
          <select
            className="input-pilih input-pilih--kecil"
            value={String(mode)}
            onChange={(e) => onMode(e.target.value === 'auto' ? 'auto' : Number(e.target.value))}
            aria-label="Baris per halaman"
          >
            <option value="auto">Otomatis</option>
            {PILIHAN_BARIS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="tombol tombol--kecil paginasi__tombol" disabled={hal <= 1} onClick={() => onHal(hal - 1)} aria-label="Halaman sebelumnya">
          <span aria-hidden="true">‹</span>
          <span className="paginasi__tombol-teks"> Sebelumnya</span>
        </button>
        <button
          type="button"
          className="tombol tombol--kecil paginasi__tombol"
          disabled={hal >= totalHal}
          onClick={() => onHal(hal + 1)}
          aria-label="Halaman berikutnya"
        >
          <span className="paginasi__tombol-teks">Berikutnya </span>
          <span aria-hidden="true">›</span>
        </button>
      </div>
    </div>
  );
}

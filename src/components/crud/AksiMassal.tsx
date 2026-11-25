import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal } from './Modal';
import { IconButton } from '../IconButton';
import type { NamaIcon } from '../Icon';
import { unduhCsv, type BarisDilewati } from '../../lib/massal';

/** Ikon bawaan tiap aksi massal — bisa ditimpa lewat prop `ikon`. */
const IKON_MASSAL: Record<string, NamaIcon> = {
  nonaktif: 'power',
  aktif: 'circle-check',
  ubah: 'pencil',
  kat: 'folder-input',
  merek: 'tag',
  ekspor: 'download',
  hapus: 'trash',
  pulihkan: 'rotate-ccw',
  cetak: 'printer',
  foto: 'image-up',
};

/** Checkbox header tabel — mendukung status indeterminate. */
export function CentangHeader({
  penuh,
  sebagian,
  onUbah,
  label,
}: {
  penuh: boolean;
  sebagian: boolean;
  onUbah: () => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = sebagian;
  }, [sebagian]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="centang-baris"
      checked={penuh}
      onClick={(e) => e.stopPropagation()}
      onChange={onUbah}
      aria-label={label}
    />
  );
}

/** Banner "N di halaman ini dipilih" + tautan pilih semua sesuai filter. */
export function BannerPilihan({
  padaHalaman,
  jumlah,
  total,
  semuaFilter,
  label,
  onPilihSemua,
  onBatal,
}: {
  padaHalaman: number;
  jumlah: number;
  total: number;
  semuaFilter: boolean;
  label: string;
  onPilihSemua: () => void;
  onBatal: () => void;
}) {
  if (padaHalaman === 0) return null;
  if (semuaFilter || jumlah >= total) {
    return (
      <div className="pilihan-banner" role="status">
        <span>
          Semua <strong>{total}</strong> {label} sesuai filter dipilih.
        </span>
        <button type="button" onClick={onBatal}>
          Batalkan pilih
        </button>
      </div>
    );
  }
  return (
    <div className="pilihan-banner" role="status">
      <span>
        <strong>{jumlah}</strong> {label} dipilih
        {jumlah > padaHalaman ? ` (termasuk ${jumlah - padaHalaman} dari halaman lain)` : ' di halaman ini'}.
      </span>
      {total > jumlah && (
        <button type="button" onClick={onPilihSemua}>
          Pilih semua {total} {label} sesuai filter
        </button>
      )}
      <button type="button" onClick={onBatal}>
        Batalkan pilih
      </button>
    </div>
  );
}

export interface AksiMassalItem {
  kode: string;
  label: string;
  jalan: () => void;
  bahaya?: boolean;
  primer?: boolean;
  ikon?: NamaIcon;
}

/** Bar aksi massal — sticky di bawah tabel; di layar kecil jadi menu "Aksi ▾". */
export function BarAksiMassal({
  jumlah,
  labelJumlah = 'data',
  aksi,
  onBatal,
}: {
  jumlah: number;
  labelJumlah?: string;
  aksi: AksiMassalItem[];
  onBatal: () => void;
}) {
  const [kecil, setKecil] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const onUbah = () => setKecil(window.matchMedia('(max-width: 767px)').matches);
    const mq = window.matchMedia('(max-width: 767px)');
    mq.addEventListener('change', onUbah);
    window.addEventListener('resize', onUbah);
    return () => {
      mq.removeEventListener('change', onUbah);
      window.removeEventListener('resize', onUbah);
    };
  }, []);

  if (jumlah === 0) return null;
  return (
    <div className={`bar-massal ${kecil ? 'bar-massal--kecil' : ''}`} role="region" aria-label="Aksi massal">
      <strong className="bar-massal__jumlah">
        {jumlah} {labelJumlah} dipilih
      </strong>
      {kecil ? (
        <select
          className="input-pilih"
          value=""
          onChange={(e) => {
            const a = aksi.find((x) => x.kode === e.target.value);
            e.target.value = '';
            a?.jalan();
          }}
          aria-label="Pilih aksi"
        >
          <option value="">Aksi ▾</option>
          {aksi.map((a) => (
            <option key={a.kode} value={a.kode}>
              {a.label}
            </option>
          ))}
        </select>
      ) : (
        <span className="ikon-grup" role="group" aria-label="Aksi massal">
          {aksi.map((a) => (
            <IconButton
              key={a.kode}
              label={a.label}
              ikon={a.ikon ?? IKON_MASSAL[a.kode] ?? 'pencil'}
              warna={a.bahaya ? 'bahaya' : a.primer ? 'primer' : 'netral'}
              onClick={a.jalan}
            />
          ))}
        </span>
      )}
      <IconButton label="Batal pilih" ikon="close" onClick={onBatal} />
    </div>
  );
}

/** Progress bar batch (0–100). */
export function ProgresMassal({ nilai, keterangan }: { nilai: number | null; keterangan?: string }) {
  if (nilai === null) return null;
  return (
    <div className="progres-massal">
      <div className="kemajuan">
        <div className="kemajuan__isi" style={{ width: `${nilai}%` }} />
      </div>
      <span className="teks-redup teks-kecil">
        {keterangan ?? `Memproses… ${nilai}%`}
      </span>
    </div>
  );
}

export interface HasilMassalState {
  judul: string;
  berhasil: number;
  dilewati: BarisDilewati[];
  saran?: string;
  /** Bila ada → tombol "Urungkan" aktif 10 detik. */
  onUrungkan?: () => Promise<void>;
}

/** Dialog hasil aksi massal: ringkasan, daftar dilewati + alasan, undo 10 detik. */
export function DialogHasilMassal({ hasil, onTutup }: { hasil: HasilMassalState; onTutup: () => void }) {
  const [sisa, setSisa] = useState(hasil.onUrungkan ? 10 : 0);
  const [urungSibuk, setUrungSibuk] = useState(false);

  useEffect(() => {
    if (sisa <= 0) return;
    const t = window.setInterval(() => setSisa((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(t);
  }, [sisa > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const urungkan = async () => {
    if (!hasil.onUrungkan) return;
    setUrungSibuk(true);
    try {
      await hasil.onUrungkan();
    } finally {
      setUrungSibuk(false);
    }
  };

  return (
    <Modal judul={hasil.judul} lebar={hasil.dilewati.length ? 'lebar' : 'kecil'} onTutup={onTutup} aksi={
      <>
        {hasil.dilewati.length > 0 && (
          <button
            type="button"
            className="tombol tombol--netral"
            onClick={() =>
              unduhCsv(
                `dilewati-${new Date().toISOString().slice(0, 10)}.csv`,
                ['Nama', 'Alasan'],
                hasil.dilewati.map((d) => [d.nama, d.alasan]),
              )
            }
          >
            Unduh daftar dilewati
          </button>
        )}
        {hasil.onUrungkan && sisa > 0 && (
          <button type="button" className="tombol tombol--netral" onClick={() => void urungkan()} disabled={urungSibuk}>
            {urungSibuk ? 'Mengurungkan…' : `Urungkan (${sisa} detik)`}
          </button>
        )}
        <button type="button" className="tombol tombol--primer" onClick={onTutup}>
          Tutup
        </button>
      </>
    }>
      <p>
        <strong className="teks-sukses">{hasil.berhasil} berhasil</strong>
        {hasil.dilewati.length > 0 && (
          <>
            {' · '}
            <strong className="teks-galat">{hasil.dilewati.length} dilewati</strong>
          </>
        )}
      </p>
      {hasil.dilewati.length > 0 && (
        <>
          {hasil.saran && <p className="teks-redup teks-kecil">{hasil.saran}</p>}
          <div className="daftar-dilewati">
            {hasil.dilewati.map((d, i) => (
              <div key={`${d.id ?? i}-${d.nama}`}>
                <b>{d.nama}</b>
                <span>{d.alasan}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

/** Dialog konfirmasi hapus massal: jumlah + 5 nama pertama + ketik "HAPUS". */
export function DialogHapusMassal({
  judul = 'Hapus Massal?',
  labelJumlah = 'data',
  jumlah,
  namaAwal,
  memuatNama,
  sedang,
  progres,
  saran,
  onBatal,
  onHapus,
  children,
}: {
  judul?: string;
  labelJumlah?: string;
  jumlah: number;
  namaAwal: string[];
  memuatNama?: boolean;
  sedang?: boolean;
  progres?: ReactNode;
  saran?: string;
  onBatal: () => void;
  onHapus: () => void;
  children?: ReactNode;
}) {
  const [kata, setKata] = useState('');
  const boleh = kata === 'HAPUS' && !sedang;
  return (
    <Modal judul={judul} lebar="kecil" onTutup={onBatal} sedangKirim={sedang} aksi={
      <>
        <button type="button" className="tombol tombol--netral" onClick={onBatal} disabled={sedang}>
          Batal
        </button>
        <button type="button" className="tombol tombol--bahaya" onClick={onHapus} disabled={!boleh}>
          {sedang ? 'Menghapus…' : `Hapus ${jumlah} ${labelJumlah}`}
        </button>
      </>
    }>
      <p>
        <strong>{jumlah}</strong> {labelJumlah} akan dihapus ke <strong>Sampah</strong> (bisa dipulihkan).
      </p>
      {memuatNama ? (
        <p className="teks-redup teks-kecil">Memuat nama terpilih…</p>
      ) : (
        <ul className="daftar-error">
          {namaAwal.slice(0, 5).map((n, i) => (
            <li key={i}>{n}</li>
          ))}
          {jumlah > Math.min(5, namaAwal.length) && <li>… dan {jumlah - Math.min(5, namaAwal.length)} lainnya</li>}
        </ul>
      )}
      {children}
      {saran && <p className="teks-redup teks-kecil">{saran}</p>}
      {progres}
      <label className="bidang" style={{ marginTop: 8 }}>
        <span>
          Ketik <strong>HAPUS</strong> untuk melanjutkan <em className="wajib">*</em>
        </span>
        <input value={kata} onChange={(e) => setKata(e.target.value)} placeholder="HAPUS" autoComplete="off" />
      </label>
    </Modal>
  );
}

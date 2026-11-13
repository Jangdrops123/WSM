import type { ReactNode } from 'react';
import type { IconName } from '../config/menu';

/**
 * Ikon aksi (tombol ikon Master Data & toolbar). Sengaja memakai set yang sama
 * dengan ikon menu: satu pustaka, satu ketebalan garis (strokeWidth 1.7),
 * satu viewBox 24×24 — tampilan seragam di seluruh aplikasi.
 */
export type IkonAksi =
  | 'pencil'
  /** Simpan identitas aplikasi (Y2.1 — tombol ikon bantuan). */
  | 'save'
  | 'power'
  | 'circle-check'
  | 'eye'
  | 'eye-off'
  | 'trash'
  | 'download'
  | 'upload'
  | 'file-down'
  | 'image-up'
  | 'archive'
  | 'plus'
  | 'printer'
  | 'chevron-left'
  | 'chevron-right'
  | 'folder-input'
  | 'tag'
  | 'rotate-ccw'
  | 'whatsapp'
  | 'message-circle'
  | 'send'
  | 'share'
  | 'qr'
  /** Pindai barcode/QR dengan kamera HP (semua pencarian). */
  | 'scan'
  | 'faktur'
  | 'sliders'
  | 'bell'
  | 'sun'
  | 'moon'
  | 'monitor'
  | 'chevron-up'
  | 'chevron-down'
  /** Mode Fokus (U1): perluas/rimpikan layar penuh. */
  | 'expand'
  | 'contract'
  /** Menu titik tiga (kebab) — aksi sekunder pada layar kecil (N8). */
  | 'kebab'
  /** Pegangan geser kartu Dashboard (mode Atur Tampilan, X2). */
  | 'grip'
  /** Duplikat kartu / baris. */
  | 'copy'
  /** Pintasan keyboard (tombol Pintasan F1 pada POS Mode Foto — Y1.3). */
  | 'keyboard'
  /** Pilihan ukuran kartu produk (POS Mode Foto — Y1.4). */
  | 'grid'
  /** AI5 — putar pratinjau layar muat (Identitas Aplikasi). */
  | 'play'
  /** BAGIAN AA — kendali pratinjau kertas (zoom & dipaskan). */
  | 'minus'
  | 'zoom-in'
  | 'zoom-out'
  | 'fit-width'
  | 'fit-page';

export type NamaIcon = IconName | 'menu' | 'close' | 'check' | 'database' | IkonAksi;

// Ikon SVG garis (stroke) — ringan dan konsisten dengan tampilan ramping.
const PATHS: Record<NamaIcon, ReactNode> = {
  save: (
    <>
      <path d="M4 4a1 1 0 0 1 1-1h10l5 5v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
      <path d="M8 3v5h6" />
      <rect x="8" y="13" width="8" height="7" rx="1" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  grip: (
    <>
      {[8, 12, 16].map((cy) =>
        [9, 15].map((cx) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.5" fill="currentColor" stroke="none" />
        )),
      )}
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </>
  ),
  kebab: (
    <>
      <circle cx="12" cy="5" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.7" fill="currentColor" stroke="none" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h6M14 7h6M4 17h2M10 17h10" />
      <circle cx="12" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </>
  ),
  expand: (
    <>
      <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
    </>
  ),
  contract: (
    <>
      <path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5" />
    </>
  ),
  bell: (
    <>
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" />
      <path d="M10.5 20a2 2 0 0 0 3 0" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />,
  monitor: (
    <>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  pos: (
    <>
      <path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.5a2 2 0 0 0 2-1.5L20 8H6" />
      <circle cx="9.5" cy="19.5" r="1.5" />
      <circle cx="17" cy="19.5" r="1.5" />
    </>
  ),
  pembelian: (
    <>
      <path d="M3 8.5 12 4l9 4.5v7L12 20l-9-4.5v-7Z" />
      <path d="M3 8.5 12 13l9-4.5" />
      <path d="M12 13v7" />
    </>
  ),
  stok: (
    <>
      <rect x="3" y="12" width="8" height="8" rx="1" />
      <rect x="13" y="12" width="8" height="8" rx="1" />
      <rect x="8" y="4" width="8" height="7" rx="1" />
    </>
  ),
  opname: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4.5V3.5A1.5 1.5 0 0 1 10.5 2h3A1.5 1.5 0 0 1 15 3.5v1" />
      <path d="m8.5 12.5 2.2 2.2 4.3-4.4" />
    </>
  ),
  penjualan: (
    <>
      <path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21V3Z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </>
  ),
  akuntansi: (
    <>
      <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5v-17Z" />
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M9 7h7" />
    </>
  ),
  laporan: (
    <>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="M8 20v-6M12.5 20V8M17 20v-9" />
    </>
  ),
  master: (
    <>
      <ellipse cx="12" cy="5.5" rx="8" ry="3" />
      <path d="M4 5.5v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
      <path d="M4 11.5v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </>
  ),
  pengaturan: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
      <circle cx="9" cy="7" r="2.2" />
      <circle cx="15" cy="12" r="2.2" />
      <circle cx="8" cy="17" r="2.2" />
    </>
  ),
  menu: (
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </>
  ),
  close: (
    <>
      <path d="m6 6 12 12M18 6 6 18" />
    </>
  ),
  check: (
    <>
      <path d="m5 13 4.5 4.5L19 7" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5.5" rx="8" ry="3" />
      <path d="M4 5.5v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
      <path d="M4 11.5v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </>
  ),
  // --- Ikon aksi ---------------------------------------------------------
  pencil: (
    <>
      <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z" />
    </>
  ),
  power: (
    <>
      <path d="M12 2v10" />
      <path d="M18.4 6.6a9 9 0 1 1-12.8.04" />
    </>
  ),
  'circle-check': (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  eye: (
    <>
      <path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M10.73 5.08A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.39-1.61" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <path d="m2 2 20 20" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </>
  ),
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </>
  ),
  upload: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 8 5-5 5 5" />
      <path d="M12 3v12" />
    </>
  ),
  'file-down': (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M12 18v-6" />
      <path d="m9 15 3 3 3-3" />
    </>
  ),
  'image-up': (
    <>
      <rect x="3" y="2" width="18" height="13" rx="2" />
      <circle cx="8.5" cy="6.5" r="1.5" />
      <path d="m21 12-4.5-4.5L9 14" />
      <path d="M16 22v-6" />
      <path d="m13 19 3 3 3-3" />
    </>
  ),
  archive: (
    <>
      <rect x="2" y="3" width="20" height="5" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
    </>
  ),
  plus: <path d="M5 12h14M12 5v14" />,
  minus: <path d="M5 12h14" />,
  'zoom-in': (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M20 20l-4.9-4.9M10.5 7.5v6M7.5 10.5h6" />
    </>
  ),
  'zoom-out': (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M20 20l-4.9-4.9M7.5 10.5h6" />
    </>
  ),
  'fit-width': (
    <>
      <path d="M3 6v12M21 6v12M7 12h10M9.5 9.5 7 12l2.5 2.5M14.5 9.5 17 12l-2.5 2.5" />
    </>
  ),
  'fit-page': (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M8.5 9.5 11 12l-2.5 2.5M15.5 9.5 13 12l2.5 2.5" />
    </>
  ),
  printer: (
    <>
      <path d="M6 9V2h12v7" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" rx="1" />
    </>
  ),
  'chevron-left': <path d="m15 18-6-6 6-6" />,
  'chevron-right': <path d="m9 18 6-6-6-6" />,
  'chevron-up': <path d="m6 15 6-6 6 6" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'folder-input': (
    <>
      <path d="M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-2" />
      <path d="M2 13h10" />
      <path d="m9 16 3-3-3-3" />
    </>
  ),
  tag: (
    <>
      <path d="M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42Z" />
      <path d="M7.5 7.5h.01" />
    </>
  ),
  play: <path d="M8 4.5 19 12 8 19.5Z" />,
  'rotate-ccw': (
    <>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </>
  ),
  // --- I4: aksi faktur (WhatsApp / kirim pesan) --------------------------
  whatsapp: (
    <>
      <path d="M20.5 11.6a8.5 8.5 0 0 1-12.6 7.4L3.5 20.5l1.6-4.3A8.5 8.5 0 1 1 20.5 11.6Z" />
      <path d="M8.9 9.2c.3-.7.6-.7.9-.7h.7c.2 0 .5 0 .7.6l.7 1.6c.1.3 0 .5-.1.7l-.4.5c-.1.2-.2.4 0 .7.3.5.9 1.2 1.6 1.7.6.4 1 .6 1.2.7.3.1.5 0 .6-.1l.6-.7c.2-.2.4-.2.6-.1l1.5.7c.3.1.4.3.4.5 0 .6-.3 1.3-.9 1.6-.5.3-1.2.4-2 .3-1.3-.3-3-1-4.5-2.4-1.3-1.2-2.2-2.7-2.5-3.9-.2-.8-.1-1.5.1-2Z" />
    </>
  ),
  'message-circle': (
    <>
      <path d="M20.5 11.6a8.5 8.5 0 0 1-12.6 7.4L3.5 20.5l1.6-4.3A8.5 8.5 0 1 1 20.5 11.6Z" />
      <path d="M8.5 11.5h7M8.5 14.5h4" />
    </>
  ),
  // --- J3: kirim struk (WhatsApp / bagikan / QR nomor struk) --------------
  send: (
    <>
      <path d="M21.5 2.5 11 13" />
      <path d="M21.5 2.5 15 21l-4-8-8-4 18.5-6.5Z" />
    </>
  ),
  share: (
    <>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" />
    </>
  ),
  qr: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM20 14h1M14 20h1M18 20h3v1" />
    </>
  ),
  scan: (
    <>
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
      <path d="M4 12h16" />
    </>
  ),
  faktur: (
    <>
      <path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21V3Z" />
      <path d="M9 8h6M9 11.5h6M9 15h3.5" />
    </>
  ),
};

export interface IconProps {
  nama: NamaIcon;
  size?: number;
  className?: string;
}

export function Icon({ nama, size = 20, className }: IconProps) {
  return (
    <svg
      className={className}
      /* AH2b — ikon memakai em: mengikuti Ukuran Font (--font-scale).
         Aturan CSS (mis. mode Padat) tetap bisa menimpa lewat width/height. */
      width="1em"
      height="1em"
      style={{ fontSize: `${size / 16}rem` }}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[nama]}
    </svg>
  );
}

// ============================================================================
// UMPAN BALIK SCAN — suara (Web Audio API) & getar (Vibration API)
// ============================================================================
// Dipakai seluruh input scanner transaksi: POS (Foto & Tanpa Foto), Pembelian,
// Buat PO, dan Barang Datang (GRN). Semua pemutaran bersifat non-blocking:
// tidak pernah menahan proses penambahan barang ke tabel.
//
// Preferensi (ON/OFF, preset, volume, file kustom) disimpan di database
// pengaturan tab "Suara & Getar Scan" dan dicache di localStorage agar scan
// pertama setelah muat ulang halaman tetap memakai pilihan pengguna — bahkan
// saat server sedang tidak dapat dihubungi (preset tetap berbunyi).
// ============================================================================
import { apiGet } from './api';

export type PresetBerhasil = 'beep-standar' | 'ting-chime' | 'pop-modern';
export type PresetGagal = 'buzz' | 'double-beep' | 'error-tone';
export type JenisScan = 'ok' | 'gagal';

export interface PreferensiScan {
  suara: boolean;
  getar: boolean;
  suaraBerhasil: PresetBerhasil;
  suaraGagal: PresetGagal;
  /** URL / data URL file kustom; kosong = pakai preset. */
  audioBerhasil: string;
  audioGagal: string;
  /** 0–100. */
  volume: number;
}

export const BAWAAN_SCAN: PreferensiScan = {
  suara: true,
  getar: true,
  suaraBerhasil: 'beep-standar',
  suaraGagal: 'buzz',
  audioBerhasil: '',
  audioGagal: '',
  volume: 80,
};

const KUNCI_CACHE = 'nusapos.scan.umpanBalik';

let prefs: PreferensiScan = { ...BAWAAN_SCAN };
let siap = false;
let konteksAudio: AudioContext | null = null;
let audioKustom: { url: string; el: HTMLAudioElement } | null = null;

const PRESET_BERHASIL: PresetBerhasil[] = ['beep-standar', 'ting-chime', 'pop-modern'];
const PRESET_GAGAL: PresetGagal[] = ['buzz', 'double-beep', 'error-tone'];

function angkaVolume(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return BAWAAN_SCAN.volume;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** Petakan nilai tab pengaturan (kunci server) → preferensi klien. */
export function dariNilaiPengaturan(nilai: Record<string, unknown> | null | undefined): PreferensiScan {
  const n = nilai ?? {};
  const suaraBerhasil = PRESET_BERHASIL.includes(String(n.scan_suara_berhasil) as PresetBerhasil)
    ? (String(n.scan_suara_berhasil) as PresetBerhasil)
    : BAWAAN_SCAN.suaraBerhasil;
  const suaraGagal = PRESET_GAGAL.includes(String(n.scan_suara_gagal) as PresetGagal)
    ? (String(n.scan_suara_gagal) as PresetGagal)
    : BAWAAN_SCAN.suaraGagal;
  return {
    suara: n.scan_suara_aktif === undefined ? BAWAAN_SCAN.suara : n.scan_suara_aktif === true,
    getar: n.scan_getar_aktif === undefined ? BAWAAN_SCAN.getar : n.scan_getar_aktif === true,
    suaraBerhasil,
    suaraGagal,
    audioBerhasil: String(n.scan_audio_berhasil ?? '').trim(),
    audioGagal: String(n.scan_audio_gagal ?? '').trim(),
    volume: angkaVolume(n.scan_volume ?? BAWAAN_SCAN.volume),
  };
}

/** Preferensi yang sedang berlaku (dipakai panel pengaturan untuk tes). */
export function preferensiScan(): PreferensiScan {
  return prefs;
}

/** Terapkan preferensi baru (dipakai setelah Simpan agar langsung berlaku). */
export function terapkanPreferensiScan(p: Partial<PreferensiScan>): void {
  prefs = { ...prefs, ...p };
  siap = true;
  try {
    localStorage.setItem(KUNCI_CACHE, JSON.stringify(prefs));
  } catch {
    /* penyimpanan penuh/nonaktif — abaikan */
  }
}

function bacaCache(): PreferensiScan | null {
  try {
    const mentah = localStorage.getItem(KUNCI_CACHE);
    if (!mentah) return null;
    const j = JSON.parse(mentah) as Partial<PreferensiScan>;
    return { ...BAWAAN_SCAN, ...j };
  } catch {
    return null;
  }
}

/**
 * Muat preferensi dari server sekali per sesi halaman. Aman dipanggil
 * berulang: kegagalan jaringan tidak menghapus cache (suara tetap jalan).
 */
export async function muatPreferensiScan(): Promise<PreferensiScan> {
  if (!siap) {
    prefs = bacaCache() ?? { ...BAWAAN_SCAN };
  }
  try {
    const r = await apiGet<{ nilai: Record<string, unknown> }>('/api/pengaturan/suara-scan');
    prefs = dariNilaiPengaturan(r.nilai);
  } catch {
    /* server belum siap / offline — pakai cache atau bawaan */
  }
  // File audio kustom dibaca dari endpoint global (semua peran boleh baca) agar
  // terminal kasir/staf memutar file terbaru hasil unggahan Admin.
  try {
    const s = await apiGet<{
      data?: { custom_success_sound?: string; custom_error_sound?: string };
    }>('/api/settings/sound');
    const sukses = String(s.data?.custom_success_sound ?? '').trim();
    const gagal = String(s.data?.custom_error_sound ?? '').trim();
    prefs = {
      ...prefs,
      audioBerhasil: sukses || prefs.audioBerhasil,
      audioGagal: gagal || prefs.audioGagal,
    };
  } catch {
    /* endpoint suara global belum tersedia — nilai tab tetap dipakai */
  }
  try {
    localStorage.setItem(KUNCI_CACHE, JSON.stringify(prefs));
  } catch {
    /* cache gagal — prefs di memori tetap dipakai */
  }
  siap = true;
  return prefs;
}

/* ------------------------------ generator -------------------------------- */

function akunAudio(): AudioContext | null {
  try {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    konteksAudio ??= new AC();
    if (konteksAudio.state === 'suspended') void konteksAudio.resume();
    return konteksAudio;
  } catch {
    return null;
  }
}

interface Nada {
  mulai: number;
  durasi: number;
  frekuensi: number;
  frekuensiAkhir?: number;
  bentuk?: OscillatorType;
  amplitudo?: number;
}

function mainkanNada(ctx: AudioContext, nada: Nada, volume: number): void {
  const t0 = ctx.currentTime + nada.mulai;
  const t1 = t0 + nada.durasi;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const puncak = Math.max(0.0001, volume * (nada.amplitudo ?? 0.2));
  osc.type = nada.bentuk ?? 'sine';
  osc.frequency.setValueAtTime(nada.frekuensi, t0);
  if (nada.frekuensiAkhir) osc.frequency.exponentialRampToValueAtTime(nada.frekuensiAkhir, t1);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(puncak, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t1);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t1 + 0.02);
}

/** Susunan nada tiap preset (detik). */
function nadaPreset(jenis: JenisScan, p: PreferensiScan): Nada[] {
  if (jenis === 'ok') {
    switch (p.suaraBerhasil) {
      case 'ting-chime':
        return [
          { mulai: 0, durasi: 0.1, frekuensi: 1046, bentuk: 'sine', amplitudo: 0.18 },
          { mulai: 0.1, durasi: 0.14, frekuensi: 1568, bentuk: 'sine', amplitudo: 0.16 },
        ];
      case 'pop-modern':
        return [{ mulai: 0, durasi: 0.07, frekuensi: 600, frekuensiAkhir: 1000, bentuk: 'sine', amplitudo: 0.22 }];
      case 'beep-standar':
      default:
        return [{ mulai: 0, durasi: 0.1, frekuensi: 900, bentuk: 'square', amplitudo: 0.14 }];
    }
  }
  switch (p.suaraGagal) {
    case 'double-beep':
      return [
        { mulai: 0, durasi: 0.12, frekuensi: 300, bentuk: 'square', amplitudo: 0.16 },
        { mulai: 0.2, durasi: 0.12, frekuensi: 300, bentuk: 'square', amplitudo: 0.16 },
      ];
    case 'error-tone':
      return [{ mulai: 0, durasi: 0.18, frekuensi: 420, frekuensiAkhir: 180, bentuk: 'sawtooth', amplitudo: 0.16 }];
    case 'buzz':
    default:
      return [
        { mulai: 0, durasi: 0.15, frekuensi: 220, bentuk: 'square', amplitudo: 0.18 },
        { mulai: 0.23, durasi: 0.15, frekuensi: 220, bentuk: 'square', amplitudo: 0.18 },
      ];
  }
}

function mainkanFile(url: string, volume: number): boolean {
  if (!url) return false;
  try {
    if (!audioKustom || audioKustom.url !== url) {
      const el = new Audio(url);
      el.preload = 'auto';
      audioKustom = { url, el };
    }
    const el = audioKustom.el;
    el.volume = Math.min(1, Math.max(0, volume));
    try {
      el.currentTime = 0;
    } catch {
      /* metadata belum siap — play() tetap memulai dari awal */
    }
    void el.play().catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/** Getar: 1x untuk berhasil, 2x beruntun untuk gagal. */
function getar(jenis: JenisScan): void {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    navigator.vibrate(jenis === 'ok' ? 100 : [150, 80, 150]);
  } catch {
    /* perangkat tanpa getar */
  }
}

/** Putar umpan balik untuk satu hasil scan (tidak pernah melempar galat). */
export function putarUmpanBalikScan(jenis: JenisScan, opsi?: { suara?: boolean; getar?: boolean }): void {
  const p = prefs;
  const volume = p.volume / 100;
  const bolehSuara = (opsi?.suara ?? p.suara) && volume > 0;
  const bolehGetar = opsi?.getar ?? p.getar;

  if (bolehSuara) {
    const url = jenis === 'ok' ? p.audioBerhasil : p.audioGagal;
    // Prioritas utama: file kustom. Preset Web Audio hanya dipakai bila file
    // kustom tidak ada (bukan sebagai fallback saat play gagal).
    if (!url || !mainkanFile(url, volume)) {
      const ctx = akunAudio();
      if (ctx) {
        try {
          for (const n of nadaPreset(jenis, p)) mainkanNada(ctx, n, volume);
        } catch {
          /* AudioContext ditutup — abaikan */
        }
      }
    }
  }
  if (bolehGetar) getar(jenis);
}

/**
 * Pratinjau untuk tombol "Tes Suara" di Pengaturan: memakai nilai form yang
 * sedang diubah (belum tentu tersimpan) tanpa mengubah preferensi aktif.
 */
export function putarPratinjauScan(jenis: JenisScan, p: PreferensiScan): void {
  const volume = p.volume / 100;
  if (volume <= 0) {
    getar(jenis);
    return;
  }
  const url = jenis === 'ok' ? p.audioBerhasil : p.audioGagal;
  if (!url || !mainkanFile(url, volume)) {
    const ctx = akunAudio();
    if (ctx) {
      try {
        for (const n of nadaPreset(jenis, p)) mainkanNada(ctx, n, volume);
      } catch {
        /* abaikan */
      }
    }
  }
  if (p.getar) getar(jenis);
}

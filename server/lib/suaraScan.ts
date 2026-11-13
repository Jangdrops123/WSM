// ============================================================================
// SUARA SCAN GLOBAL — file audio kustom (.mp3/.wav) untuk umpan balik scan.
//
// Nilai disimpan di tabel `settings` (database PostgreSQL) pada kunci yang sama
// dengan tab "Suara & Getar Scan", sehingga endpoint ini, form pengaturan, dan
// cache localStorage klien selalu melihat data yang identik.
//
//   scan_audio_berhasil / scan_audio_gagal              → Base64 Data URL / URL
//   scan_audio_berhasil_nama / scan_audio_gagal_nama    → nama berkas
//
// Penguncian hak akses (hanya Admin yang boleh menulis) dilakukan di route.
// ============================================================================
import { getSettings } from '../db.pg.ts';
import { tolak } from './http.ts';
import { TAB_PENGATURAN, kunciSimpan, tulisTab } from './pengaturanBaru.ts';

/** Batas data audio tersimpan — 400 KB biner ≈ 547 ribu karakter Base64. */
const BATAS_AUDIO = 800_000;
const BATAS_NAMA = 200;

const TAB = TAB_PENGATURAN.find((t) => t.kode === 'suara-scan')!;

function kunciBidang(nama: string): string {
  const b = TAB.bidang.find((x) => x.kunci === nama);
  return b ? kunciSimpan(TAB, b, null) : `peng.suara-scan.${nama}`;
}

const KUNCI = {
  audioBerhasil: kunciBidang('scan_audio_berhasil'),
  audioGagal: kunciBidang('scan_audio_gagal'),
  namaBerhasil: kunciBidang('scan_audio_berhasil_nama'),
  namaGagal: kunciBidang('scan_audio_gagal_nama'),
};

export interface SuaraScanGlobal {
  custom_success_sound: string;
  custom_error_sound: string;
  custom_success_filename: string;
  custom_error_filename: string;
}

/** Baca file audio kustom global (kosong = memakai preset Web Audio). */
export async function bacaSuaraScanGlobal(): Promise<SuaraScanGlobal> {
  const s = await getSettings();
  return {
    custom_success_sound: s[KUNCI.audioBerhasil] ?? '',
    custom_error_sound: s[KUNCI.audioGagal] ?? '',
    custom_success_filename: s[KUNCI.namaBerhasil] ?? '',
    custom_error_filename: s[KUNCI.namaGagal] ?? '',
  };
}

/** Validasi data audio: kosong, Base64 Data URL, atau URL http(s). */
function nilaiAudio(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return '';
  if (!/^data:audio\/[\w.+-]+;base64,/i.test(s) && !/^https?:\/\//i.test(s)) {
    throw tolak(400, 'File audio kustom harus berupa data audio Base64 atau URL http(s).');
  }
  if (s.length > BATAS_AUDIO) {
    throw tolak(400, 'Data audio terlalu besar — unggah file maksimal 400 KB.');
  }
  return s;
}

function nilaiNama(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length > BATAS_NAMA) throw tolak(400, `Nama file maksimal ${BATAS_NAMA} karakter.`);
  return s;
}

/** Simpan sebagian/seluruh nilai audio kustom lalu kembalikan nilai terbaru. */
export async function simpanSuaraScanGlobal(body: Record<string, unknown>): Promise<SuaraScanGlobal> {
  const patch: Record<string, unknown> = {};
  if ('custom_success_sound' in body) patch.scan_audio_berhasil = nilaiAudio(body.custom_success_sound);
  if ('custom_error_sound' in body) patch.scan_audio_gagal = nilaiAudio(body.custom_error_sound);
  if ('custom_success_filename' in body) patch.scan_audio_berhasil_nama = nilaiNama(body.custom_success_filename);
  if ('custom_error_filename' in body) patch.scan_audio_gagal_nama = nilaiNama(body.custom_error_filename);
  if (Object.keys(patch).length === 0) return await bacaSuaraScanGlobal();
  await tulisTab(TAB, patch, null);
  return await bacaSuaraScanGlobal();
}

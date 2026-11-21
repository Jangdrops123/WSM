import { useEffect, useState } from 'react';
import { apiPut } from '../../lib/api';
import { useSesi } from '../../lib/sesi';
import { dariNilaiPengaturan, muatPreferensiScan, putarPratinjauScan, type JenisScan } from '../../lib/umpanBalikScan';

/** Batas file kustom — disimpan sebagai data URL di baris settings. */
const MAKS_BYTE = 400 * 1024;

/** Kunci settings untuk file audio kustom + nama berkasnya. */
const KUNCI_AUDIO: Record<JenisScan, string> = {
  ok: 'scan_audio_berhasil',
  gagal: 'scan_audio_gagal',
};
const KUNCI_NAMA: Record<JenisScan, string> = {
  ok: 'scan_audio_berhasil_nama',
  gagal: 'scan_audio_gagal_nama',
};

interface Unggahan {
  url: string;
  nama: string;
  ukuran: number;
}

const ukuranTeks = (byte: number): string =>
  byte >= 1024 ? `${Math.round(byte / 1024)} KB` : `${byte} B`;

/**
 * Kartu tambahan tab "Suara & Getar Scan": tombol uji bunyi dan unggah file
 * audio kustom (.mp3/.wav). Nilai mengikuti form (props `nilai`/`ubah`) agar
 * tes memakai pilihan yang sedang diubah, bukan yang sudah tersimpan.
 */
export function PanelSuaraScan({
  nilai,
  ubah,
}: {
  nilai: Record<string, unknown>;
  ubah: (kunci: string, v: unknown) => void;
}) {
  const [galat, setGalat] = useState<string | null>(null);
  // Penguncian global: hanya Administrator yang boleh mengubah suara scan.
  const terkunci = useSesi().info?.pengguna.admin !== true;
  // Hasil unggahan pada sesi ini — dipakai agar nama file langsung tampil dan
  // tombol Tes memutar file kustom walau form induk belum selesai dirender.
  const [pending, setPending] = useState<Record<JenisScan, Unggahan | null>>({ ok: null, gagal: null });
  const p = dariNilaiPengaturan(nilai);

  const urlTersimpan: Record<JenisScan, string> = {
    ok: p.audioBerhasil,
    gagal: p.audioGagal,
  };

  // Sinkronkan status dengan nilai form: unggahan lokal dibuang bila nilai
  // dikosongkan (mis. tombol "Kembalikan ke Bawaan") atau berubah dari server.
  useEffect(() => {
    setPending((prev) => ({
      ok: prev.ok && prev.ok.url !== urlTersimpan.ok ? null : prev.ok,
      gagal: prev.gagal && prev.gagal.url !== urlTersimpan.gagal ? null : prev.gagal,
    }));
  }, [urlTersimpan.ok, urlTersimpan.gagal]);

  const info: Record<JenisScan, Unggahan | null> = {
    ok:
      pending.ok ??
      (urlTersimpan.ok
        ? { url: urlTersimpan.ok, nama: String(nilai[KUNCI_NAMA.ok] ?? '') || 'File kustom terpasang', ukuran: 0 }
        : null),
    gagal:
      pending.gagal ??
      (urlTersimpan.gagal
        ? { url: urlTersimpan.gagal, nama: String(nilai[KUNCI_NAMA.gagal] ?? '') || 'File kustom terpasang', ukuran: 0 }
        : null),
  };

  /** Preferensi pratinjau: unggahan yang baru dipilih menang atas nilai form. */
  const preferensiTes = () => ({
    ...p,
    audioBerhasil: info.ok?.url ?? p.audioBerhasil,
    audioGagal: info.gagal?.url ?? p.audioGagal,
  });

  /** Simpan langsung ke endpoint global (Admin) agar tidak hilang walau
   *  tombol Simpan form tidak ditekan; nilai form tetap ikut diperbarui. */
  async function simpanGlobal(jenis: JenisScan, url: string, nama: string): Promise<void> {
    try {
      await apiPut('/api/settings/sound', jenis === 'ok'
        ? { custom_success_sound: url, custom_success_filename: nama }
        : { custom_error_sound: url, custom_error_filename: nama });
      void muatPreferensiScan().catch(() => undefined);
    } catch (err) {
      setGalat((err as Error).message);
    }
  }

  function unggah(jenis: JenisScan, file: File | undefined): void {
    setGalat(null);
    if (terkunci) {
      setGalat('🔒 Pengaturan suara dan getar scan dikunci — hanya Administrator yang dapat mengubahnya.');
      return;
    }
    if (!file) return;
    const audio = /^audio\//.test(file.type) || /\.(mp3|wav|ogg|m4a)$/i.test(file.name);
    if (!audio) {
      setGalat('File harus audio .mp3 atau .wav.');
      return;
    }
    if (file.size > MAKS_BYTE) {
      setGalat('Ukuran file maksimal 400 KB agar tetap tersimpan di pengaturan.');
      return;
    }
    const pembaca = new FileReader();
    pembaca.onload = () => {
      const url = String(pembaca.result ?? '');
      if (!url.startsWith('data:')) {
        setGalat('Gagal membaca file audio.');
        return;
      }
      // Base64 Data URL disimpan langsung di settings (aman untuk Docker —
      // tidak bergantung path folder) + nama berkas untuk ditampilkan lagi.
      setPending((prev) => ({ ...prev, [jenis]: { url, nama: file.name, ukuran: file.size } }));
      ubah(KUNCI_AUDIO[jenis], url);
      ubah(KUNCI_NAMA[jenis], file.name);
      void simpanGlobal(jenis, url, file.name);
    };
    pembaca.onerror = () => setGalat('Gagal membaca file audio.');
    pembaca.readAsDataURL(file);
  }

  function hapus(jenis: JenisScan): void {
    setGalat(null);
    if (terkunci) return;
    setPending((prev) => ({ ...prev, [jenis]: null }));
    ubah(KUNCI_AUDIO[jenis], '');
    ubah(KUNCI_NAMA[jenis], '');
    void simpanGlobal(jenis, '', '');
  }

  const baris: { jenis: JenisScan; judul: string }[] = [
    { jenis: 'ok', judul: 'Suara Berhasil Scan' },
    { jenis: 'gagal', judul: 'Suara Gagal Scan' },
  ];

  return (
    <section className="kartu" aria-label="Tes suara dan file audio kustom">
      <div className="kartu__kepala kartu__kepala--kompak">
        <div>
          <h3>Tes Suara &amp; File Kustom</h3>
          <p className="teks-redup teks-kecil">
            Uji bunyi sebelum menyimpan, atau unggah file .mp3/.wav (maks 400 KB). Nilai mengikuti isian di bawah —
            tombol <strong>Simpan</strong> menerapkannya ke semua perangkat.
          </p>
        </div>
        <span className="aksi-baris">
          <button type="button" className="tombol tombol--kecil" onClick={() => putarPratinjauScan('ok', preferensiTes())}>
            🔊 Tes Berhasil
          </button>
          <button type="button" className="tombol tombol--kecil" onClick={() => putarPratinjauScan('gagal', preferensiTes())}>
            🔊 Tes Gagal
          </button>
        </span>
      </div>

      {terkunci && (
        <p className="teks-redup teks-kecil" role="note">
          🔒 Pengaturan suara dan getar scan dikunci secara global dan hanya dapat diubah oleh Administrator.
        </p>
      )}

      {baris.map((b) => {
        const terpilih = info[b.jenis];
        return (
          <div className="bidang" key={b.jenis}>
            <span>{b.judul}</span>
            <span className="aksi-baris">
              <label
                className={`tombol tombol--kecil tombol--netral${terkunci ? ' tombol--nonaktif' : ''}`}
                style={{ cursor: terkunci ? 'not-allowed' : 'pointer', opacity: terkunci ? 0.55 : 1 }}
                aria-disabled={terkunci}
                title={terkunci ? 'Hanya Administrator yang dapat mengunggah audio' : 'Unggah file audio kustom'}
              >
                Unggah .mp3/.wav
                <input
                  type="file"
                  accept="audio/mpeg,audio/wav,audio/*,.mp3,.wav"
                  style={{ display: 'none' }}
                  disabled={terkunci}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.currentTarget.value = '';
                    unggah(b.jenis, file);
                  }}
                />
              </label>
              {terpilih ? (
                <>
                  <span className="teks-redup teks-kecil">
                    ✓ {terpilih.nama}
                    {terpilih.ukuran > 0 ? ` (${ukuranTeks(terpilih.ukuran)})` : ''} — dipakai sebagai prioritas
                  </span>
                  {!terkunci && (
                    <button
                      type="button"
                      className="tombol tombol--kecil tombol--bahaya"
                      onClick={() => hapus(b.jenis)}
                    >
                      ✕ Hapus File
                    </button>
                  )}
                </>
              ) : (
                <span className="teks-redup teks-kecil">Memakai preset pilihan di bawah.</span>
              )}
            </span>
          </div>
        );
      })}

      {galat && (
        <p className="teks-redup" role="alert" style={{ color: 'var(--danger, #b91c1c)' }}>
          {galat}
        </p>
      )}
    </section>
  );
}

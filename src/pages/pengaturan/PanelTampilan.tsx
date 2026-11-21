import { useState } from 'react';
import {
  HALAMAN_SCROLL,
  bacaScrollHalaman,
  simpanScrollHalaman,
  type PreferensiScroll,
} from '../../lib/scrollHalaman';

/**
 * AH2e/AH3 — panel halaman Pengaturan ▸ Tampilan:
 * - kartu pratinjau berisi judul, paragraf, tombol, badge, dan tabel yang
 *   berubah LANGSUNG saat pilihan digeser (skala diterapkan oleh
 *   TabPengaturan pada setiap perubahan, tanpa muat ulang);
 * - slider persentase kustom (75–150%, langkah 1%) bila Ukuran Font = Kustom.
 */
export function PanelTampilan({
  nilai,
  ubah,
}: {
  nilai: Record<string, unknown>;
  ubah: (kunci: string, v: unknown) => void;
}) {
  const pilihan = String(nilai.ukuran_font ?? '100');
  const kustomAktif = pilihan === 'kustom';
  const persen = kustomAktif
    ? Math.min(150, Math.max(75, Number(nilai.ukuran_font_kustom ?? 100) || 100))
    : Number(pilihan) || 100;

  return (
    <section className="kartu">
      <div className="kartu__kepala kartu__kepala--kompak">
        <h3>Pratinjau langsung</h3>
        <span className="teks-redup">
          Berubah langsung saat pilihan digeser — <b>Simpan</b> menyimpannya, <b>Batal</b> membatalkannya.
        </span>
      </div>

      {kustomAktif && (
        <div className="skala-font">
          <label htmlFor="ukuran-font-kustom">Persentase kustom</label>
          <input
            id="ukuran-font-kustom"
            type="range"
            min={75}
            max={150}
            step={1}
            value={persen}
            onChange={(e) => ubah('ukuran_font_kustom', Number(e.target.value))}
          />
          <output htmlFor="ukuran-font-kustom">{persen}%</output>
        </div>
      )}

      <div className="kartu-contoh">
        <h4>Judul kartu contoh</h4>
        <p>
          Paragraf contoh: teks ini membesar dan mengecil mengikuti <b>Ukuran Font</b>, sedangkan{' '}
          <b>Kepadatan</b> hanya mengatur jarak, padding, dan tinggi baris.
        </p>
        <div className="kartu-contoh__baris">
          <button type="button" className="tombol tombol--primer tombol--kecil">
            Tombol utama
          </button>
          <button type="button" className="tombol tombol--netral tombol--kecil">
            Tombol netral
          </button>
          <span className="lencana lencana--aktif">Aktif</span>
          <span className="lencana lencana--peringatan">Menunggu</span>
          <span className="lencana lencana--bahaya">Terlambat</span>
        </div>
        <table className="tabel">
          <thead>
            <tr>
              <th>Dokumen</th>
              <th>Pelanggan</th>
              <th className="rata-kanan">Nilai</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>INV-0001</td>
              <td>Toko Maju</td>
              <td className="rata-kanan">Rp 125.000</td>
            </tr>
            <tr>
              <td>INV-0002</td>
              <td>Warung Sejahtera</td>
              <td className="rata-kanan">Rp 98.500</td>
            </tr>
            <tr>
              <td>INV-0003</td>
              <td>PT Sinar Jaya</td>
              <td className="rata-kanan">Rp 1.242.750</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Section Pengaturan ▸ Tampilan: kontrol scroll area luar per halaman.
 * Disimpan otomatis (localStorage) dan langsung berlaku — tidak menunggu
 * tombol Simpan, karena preferensi ini murni perangkat.
 */
export function PanelScrollHalaman() {
  const [scroll, setScroll] = useState<PreferensiScroll>(bacaScrollHalaman);

  const simpan = (next: PreferensiScroll) => {
    setScroll(next);
    simpanScrollHalaman(next);
  };
  const ubahAktif = (aktif: boolean) => simpan({ ...scroll, aktif });
  const ubahHalaman = (kode: string, izin: boolean) =>
    simpan({ ...scroll, halaman: { ...scroll.halaman, [kode]: izin } });

  return (
    <section className="kartu" style={{ marginTop: 16 }}>
      <div className="kartu__kepala kartu__kepala--kompak">
        <h3>Pengaturan Scrolling Area Luar (Window Overflow)</h3>
        <span className="teks-redup">
          Halaman tanpa centang dikunci setinggi layar: gulir hanya terjadi di dalam tabel/area kontennya,
          bukan menggeser seluruh jendela. Tersimpan otomatis di perangkat ini.
        </span>
      </div>

      <div className="bidang bidang--centang scroll-halaman__utama">
        <input
          id="scroll-halaman-aktif"
          type="checkbox"
          checked={scroll.aktif}
          onChange={(e) => ubahAktif(e.target.checked)}
        />
        <span>
          <label htmlFor="scroll-halaman-aktif">Aktifkan Kontrol Scroll per Halaman</label>
          <em className="teks-redup">
            Bila dimatikan, semua halaman memakai scroll luar seperti biasa.
          </em>
        </span>
      </div>

      <div className={`scroll-halaman__daftar${scroll.aktif ? '' : ' scroll-halaman__daftar--nonaktif'}`}>
        {HALAMAN_SCROLL.map((h) => {
          const id = `scroll-${h.kode}`;
          const izin = scroll.halaman[h.kode] ?? h.bawaan;
          return (
            <div className="bidang bidang--centang" key={h.kode}>
              <input
                id={id}
                type="checkbox"
                checked={izin}
                disabled={!scroll.aktif}
                onChange={(e) => ubahHalaman(h.kode, e.target.checked)}
              />
              <span>
                <label htmlFor={id}>{h.label}</label>
                <em className="teks-redup">
                  {izin ? 'Diizinkan scroll luar' : 'Fixed — scroll internal saja'} · bawaan{' '}
                  {h.bawaan ? 'diizinkan' : 'dikunci'}
                </em>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

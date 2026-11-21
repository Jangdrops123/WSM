import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { BannerPilihan, BarAksiMassal, CentangHeader, type AksiMassalItem } from './AksiMassal';
import { statusCentang, usePilihan } from '../../lib/pilihan';

/**
 * DataTable — tabel dengan pilihan massal BERSAMA untuk semua halaman
 * (Master Data, Item Masuk/Keluar, dll). Satu-satunya tempat definisi:
 *
 * - checkbox header (indeterminate) + kolom centang 34px,
 * - baris terpilih: hanya tint `--row-selected` (tanpa garis per sel),
 *   kolom Aksi sticky ikut warna baris via token `--sticky-*`,
 * - banner "N … dipilih di halaman ini" + "Pilih semua … sesuai filter",
 * - bar aksi massal sticky (latar padat `--bar-bg`) dengan padding bawah
 *   `.tabel-bungkus--bar` agar baris terakhir bisa di-scroll penuh,
 * - keyboard: fokus baris (Tab), Spasi mencentang, Enter membuka baris.
 *
 * Gaya sepenuhnya dari token tema (--row-selected, --row-hover, --banner-*,
 * --bar-bg, --border) sehingga tema terang & gelap otomatis konsisten.
 */

/** Definisi satu baris data. Sel (kecuali kolom centang) diberikan halaman. */
export interface BarisTabel {
  id: number;
  /** aria-label checkbox baris, mis. "Pilih ABC". */
  aria: string;
  /** Sel <td> setelah kolom centang — termasuk sel Aksi bila ada. */
  isi: ReactNode[];
  /** kelas tr tambahan (mis. "baris-detail"). */
  kelas?: string;
  /** Klik baris (mis. buka detail). Enter pada fokus keyboard juga memakai ini. */
  onKlik?: () => void;
}

type PilihanApi = ReturnType<typeof usePilihan>;

export function DataTable({
  pilihan,
  idsHalaman,
  label,
  total,
  onPilihSemua,
  kepala,
  baris,
  colSpan,
  kosong,
  aksiBar,
  stickyAksi,
  kelasTabel,
  areaRef,
  seleksiDiFooter,
}: {
  pilihan: PilihanApi;
  idsHalaman: number[];
  /** Kata benda halaman: 'produk', 'dokumen', 'data', … */
  label: string;
  total: number;
  onPilihSemua: () => void;
  /** th kolom data (fragment/array), setelah kolom centang — termasuk th "Aksi" bila ada. */
  kepala: ReactNode;
  baris: BarisTabel[];
  /** Jumlah kolom total (untuk baris kosong/sibuk). */
  colSpan: number;
  /** Isi baris kosong/sibuk (mis. "Tidak ada produk."). */
  kosong?: ReactNode;
  /** Aksi massal bar bawah; [] / undefined = tanpa bar. */
  aksiBar?: AksiMassalItem[];
  /** Kolom Aksi (terakhir) sticky — pakai kelas `tabel--aksi`. */
  stickyAksi?: boolean;
  kelasTabel?: string;
  /** Wadah scroll tabel — dipakai pengukur "Baris Otomatis" (BAGIAN AJ). */
  areaRef?: RefObject<HTMLDivElement | null>;
  /** Pilihan massal dirender di footer halaman, bukan banner/bar di atas-bawah tabel. */
  seleksiDiFooter?: boolean;
}) {
  const shiftRef = useRef(false);
  const tabelRef = useRef<HTMLTableElement>(null);
  const st = statusCentang(baris, pilihan.terpilih);
  const adaBar = !seleksiDiFooter && !!aksiBar && aksiBar.length > 0;

  // R4 — beri `data-label` pada tiap sel dari judul kolomnya, supaya di ponsel
  // tabel yang kolomnya banyak bisa berubah menjadi tampilan kartu
  // (lihat aturan `.tabel:has(...)` di crud.css). Dilakukan di DOM, jadi tidak
  // ada halaman yang perlu mengubah definisi kolomnya.
  useEffect(() => {
    const t = tabelRef.current;
    if (!t) return;
    const kepala = Array.from(t.querySelectorAll('thead th')).map((th) =>
      (th.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
    for (const tr of t.querySelectorAll('tbody tr')) {
      Array.from(tr.children).forEach((sel, i) => {
        const label = kepala[i] ?? '';
        if (label) {
          if (sel.getAttribute('data-label') !== label) sel.setAttribute('data-label', label);
        } else if (sel.hasAttribute('data-label')) {
          sel.removeAttribute('data-label');
        }
      });
    }
  });

  return (
    <>
      {!seleksiDiFooter && (
        <BannerPilihan
          padaHalaman={baris.filter((b) => pilihan.terpilih.has(b.id)).length}
          jumlah={pilihan.jumlah}
          total={total}
          semuaFilter={pilihan.semuaFilter}
          label={label}
          onPilihSemua={onPilihSemua}
          onBatal={pilihan.bersihkan}
        />
      )}

      <div ref={areaRef} className={`tabel-bungkus ${adaBar ? 'tabel-bungkus--bar' : ''}`}>
        <table
          ref={tabelRef}
          className={`tabel ${stickyAksi ? 'tabel--aksi' : ''} ${
            seleksiDiFooter ? 'tabel--daftar' : ''
          } ${kelasTabel ?? ''}`.trim()}
        >
          <thead>
            <tr>
              <th className="kolom-pilih rata-tengah">
                <CentangHeader
                  penuh={st.penuh}
                  sebagian={st.sebagian}
                  onUbah={() => pilihan.setSemuaHalaman(idsHalaman, !st.penuh)}
                  label="Pilih semua di halaman ini"
                />
              </th>
              {kepala}
            </tr>
          </thead>
          <tbody>
            {baris.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="tabel-kosong">
                  {kosong}
                </td>
              </tr>
            ) : (
              baris.map((b) => {
                const terpilih = pilihan.terpilih.has(b.id);
                return (
                  <tr
                    key={b.id}
                    className={[b.kelas, terpilih ? 'baris-terpilih' : ''].filter(Boolean).join(' ')}
                    tabIndex={0}
                    onClick={b.onKlik}
                    onKeyDown={(e) => {
                      if (e.key === ' ' || e.key === 'Spacebar') {
                        e.preventDefault();
                        pilihan.toggle(b.id, e.shiftKey, idsHalaman);
                      } else if (e.key === 'Enter') {
                        e.preventDefault();
                        b.onKlik?.();
                      }
                    }}
                  >
                    <td className="kolom-pilih rata-tengah" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="centang-baris"
                        checked={terpilih}
                        onMouseDown={(e) => {
                          shiftRef.current = e.shiftKey;
                        }}
                        onChange={() => pilihan.toggle(b.id, shiftRef.current, idsHalaman)}
                        aria-label={b.aria}
                      />
                    </td>
                    {b.isi}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {adaBar && (
        <BarAksiMassal jumlah={pilihan.jumlah} labelJumlah={label} aksi={aksiBar!} onBatal={pilihan.bersihkan} />
      )}
    </>
  );
}

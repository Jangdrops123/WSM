import { useLayoutEffect, useRef, useState } from 'react';
import { PratinjauKertas } from '../../components/PratinjauKertas';
import {
  RATA_KOLOM,
  blokAktif,
  kolomAktifTabel,
  labelKolom,
  lebarKolomPersen,
  rupiah,
  tanggalPanjang,
  teksTotalQty,
  ukuranKertas,
  type FakturDTO,
  type IsiFaktur,
  type TemplateFaktur,
} from './tipe';
import './faktur.css';

/** PT → piksel layar (96 dpi) — dasar perhitungan auto-fit font kolom. */
const PT_KE_PX = 96 / 72;
/** Font kolom auto-fit tidak boleh di bawah 6pt (BAGIAN K3). */
const FONT_KOLOM_MIN = 6;
/** Padding horizontal sel (4px 6px) + border — ikut dalam lebar teks butuh. */
const PAD_SEL_PX = 14;

/** Kolom yang ISI & HEADER-nya wajib nowrap (angka + kode — BAGIAN K3). */
const KOLOM_NOWRAP = new Set(['kode', 'qty', 'harga', 'diskon', 'subtotal']);

const FONT_CSS = "'Segoe UI', system-ui, -apple-system, sans-serif";

/**
 * Render satu dokumen faktur sesuai template.
 *
 * BAGIAN K — mesin tabel yang sama untuk pratinjau, cetak, dan PDF:
 *  - table-layout:fixed + colgroup; lebar menyesuaikan jenis data (K2): No
 *    sempit mengikuti digit, Kode/Harga/Diskon/Subtotal sedang, Jumlah &
 *    Satuan sempit, Nama Barang menyerap sisa lebar.
 *  - Header & kolom angka/Kode nowrap (K3); font kolom auto-fit (min 6pt)
 *    agar angka tidak pernah terpotong; Nama Barang maksimal 2 baris
 *    (line-clamp:2) tanpa memecah kata.
 *  - Label kolom mengikuti pengaturan template (singkatan otomatis bila
 *    kertas sempit; bisa diganti per kolom).
 *
 * BAGIAN I2/I3: blok, urutan kolom, font, aksen, teks tetap, ukuran kertas,
 * orientasi, margin, dan skala isi semuanya datang dari template.
 */
export function FakturDokumen({
  faktur,
  isi,
  template,
}: {
  faktur: FakturDTO;
  isi: IsiFaktur;
  template: TemplateFaktur | null;
}) {
  const ukuran = ukuranKertas(template);
  const font = Number(template?.ukuran_font ?? 10);
  const aksen = template?.aksen ?? '#2563eb';
  const skala = Math.max(0.5, Math.min(2, Number(template?.skala ?? 100) / 100));
  const margin = {
    atas: Number(template?.margin_atas ?? 12),
    kanan: Number(template?.margin_kanan ?? 12),
    bawah: Number(template?.margin_bawah ?? 12),
    kiri: Number(template?.margin_kiri ?? 12),
  };
  const teks = template?.teks ?? {};
  const judul =
    teks['judul'] ||
    (faktur.jenis === 'penjualan' ? 'FAKTUR PENJUALAN' : 'FAKTUR PEMBELIAN');

  const kolom = kolomAktifTabel(template);

  // Kertas sempit (termal/A6 dst.) → header singkat agar tidak terpecah (K3).
  const lebarKontenMm = Math.max(20, ukuran.lebar - margin.kiri - margin.kanan);
  const modeSingkat = template?.singkat_kolom ?? 'auto';
  const singkat =
    modeSingkat === 'ya' || (modeSingkat !== 'tidak' && lebarKontenMm < 120);

  // Rata isi+header mengikuti kolom (custom > otomatis per jenis).
  const rata = (k: string): 'kiri' | 'tengah' | 'kanan' =>
    template?.pengaturan_kolom?.[k]?.rata ?? RATA_KOLOM[k] ?? 'kiri';
  const kelasRata = (k: string): string => {
    const r = rata(k);
    return r === 'kanan' ? 'rata-kanan' : r === 'tengah' ? 'rata-tengah' : '';
  };

  // Lebar kolom (persen) — dihitung ulang otomatis saat kolom tampil/sembunyi.
  // Skala memperbesar/mengecilkan lebar layout isi secara proporsional.
  const { persen } = lebarKolomPersen(
    template,
    kolom,
    lebarKontenMm / skala,
    isi.items.length,
  );

  const angkaQty = (n: number): string =>
    Number(n).toLocaleString('id-ID', { maximumFractionDigits: 3 });

  const isiSel = (kunci: string, item: IsiFaktur['items'][number]): string => {
    switch (kunci) {
      case 'kode':
        return item.kode || '—';
      case 'nama':
        return item.nama;
      case 'qty':
        return angkaQty(item.qty);
      case 'satuan':
        return item.satuan || '—';
      case 'harga':
        return rupiah(item.harga);
      case 'diskon':
        return item.diskon ? rupiah(item.diskon) : '—';
      case 'subtotal':
        return rupiah(item.subtotal);
      default:
        return '';
    }
  };

  // --- Auto-fit font kolom (K3) -------------------------------------------
  // Ukur teks terpanjang tiap kolom nowrap (header + isi) dengan canvas pada
  // font DASAR template, lalu bandingkan dengan lebar kolom hasil layout
  // (clientWidth — layout px, tidak terpengaruh transform CSS). Bila ada
  // kolom yang butuh lebih lebar, font kolom dikecilkan seragam sampai muat,
  // minimum 6pt. Satu langkah ukur → tanpa siklus; hasil identik di layar,
  // cetak, dan PDF karena komponen yang sama dipakai ketiganya.
  const [fontKolomPt, setFontKolomPt] = useState(font);
  const refTabel = useRef<HTMLTableElement>(null);

  useLayoutEffect(() => {
    const tabel = refTabel.current;
    if (!tabel) return;
    let batal = false;

    const ukur = () => {
      const t = refTabel.current;
      const kepala = t?.tHead?.rows[0];
      if (!t || !kepala) return;

      const dasarPx = font * PT_KE_PX;
      const kanvas = document.createElement('canvas');
      const ctx = kanvas.getContext('2d');
      if (!ctx) return;

      const lebarTeks = (teks: string, tebal: boolean): number => {
        ctx.font = `${tebal ? '600 ' : ''}${dasarPx}px ${FONT_CSS}`;
        return ctx.measureText(teks).width + PAD_SEL_PX;
      };

      let rasioTerburuk = 1;
      Array.from(kepala.cells).forEach((th, i) => {
        const kunci = i === 0 ? 'no' : kolom[i - 1];
        if (!kunci || kunci === 'nama') return; // nama membungkus — boleh lebih panjang
        const lebarKolom = th.clientWidth || th.offsetWidth;
        if (lebarKolom <= 0) return;

        let butuh = lebarTeks(labelKolom(template, kunci, singkat), true);
        for (const it of isi.items) {
          butuh = Math.max(butuh, lebarTeks(isiSel(kunci, it), false));
        }
        rasioTerburuk = Math.max(rasioTerburuk, butuh / lebarKolom);
      });

      if (batal) return;
      setFontKolomPt(
        Math.max(FONT_KOLOM_MIN, Math.round((font / rasioTerburuk) * 10) / 10),
      );
    };

    // Setelah layout final (termasuk bila pratinjau baru diskalakan ulang).
    const id = requestAnimationFrame(ukur);
    return () => {
      batal = true;
      cancelAnimationFrame(id);
    };
    // fontKolomPt sengaja TIDAK dependensi: pengukuran memakai font dasar,
    // sehingga hasilnya stabil (tidak loop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [font, kolom.join(','), singkat, template, isi.items.length]);

  // Akumulasi qty fisik seluruh item ("32 Psg" / "12 Psg / 10 Pcs").
  const totalQty = teksTotalQty(isi.items);

  // RETUR — faktur menampilkan nilai BERSIH bila dokumen sumbernya punya retur
  // yang sudah disahkan (dikirim server di faktur.retur).
  // Faktur pembelian tidak lagi memiliki retur (fitur Retur Pembelian dihapus);
  // faktur penjualan tetap menampilkan retur & nilai bersih.
  const returSah = faktur.jenis === 'pembelian' ? [] : (faktur.retur ?? []);
  const totalRetur = returSah.reduce((n, r) => n + Number(r.total ?? 0), 0);
  const adaRetur = returSah.length > 0 && totalRetur > 0;
  const labelRetur = 'Retur Penjualan';

  const sumber = isi.sumber ?? {};
  const str = (k: string): string | null => {
    const v = sumber[k];
    return v === undefined || v === null || v === '' ? null : String(v);
  };

  const gaya = {
    ['--faktur-lebar' as string]: `${ukuran.lebar}mm`,
    ['--faktur-tinggi' as string]: `${ukuran.tinggi}mm`,
    ['--faktur-m-atas' as string]: `${margin.atas}mm`,
    ['--faktur-m-kanan' as string]: `${margin.kanan}mm`,
    ['--faktur-m-bawah' as string]: `${margin.bawah}mm`,
    ['--faktur-m-kiri' as string]: `${margin.kiri}mm`,
    ['--faktur-font' as string]: `${font}pt`,
    ['--faktur-font-kolom' as string]: `${fontKolomPt}pt`,
    ['--faktur-aksen' as string]: aksen,
    ['--faktur-skala' as string]: String(skala),
  };

  const kelasSel = (k: string): string =>
    [kelasRata(k), KOLOM_NOWRAP.has(k) ? 'faktur__sel-nowrap' : '']
      .filter(Boolean)
      .join(' ');

  // Termal 58/80 mm: kertas gulungan — tinggi mengikuti isi (AA4), bukan
  // tinggi nominal 200 mm (min-height dimatikan lewat atribut data-termal).
  const termal = template?.kertas === '58mm' || template?.kertas === '80mm';

  return (
    <div className="faktur-wadah">
      {/* Cetak & ekspor PDF memakai ukuran kertas template. */}
      <style>{`@page { size: ${ukuran.lebar}mm ${ukuran.tinggi}mm; margin: 0; }`}</style>

      <div
        className="faktur"
        style={gaya}
        data-jenis={faktur.jenis}
        data-termal={termal ? '' : undefined}
      >
        <div className="faktur__isi">
          {/* Kop toko */}
          <header className="faktur__kop">
            {blokAktif(template, 'logo', true) && isi.toko.logo && (
              <img className="faktur__logo" src={isi.toko.logo} alt="Logo toko" />
            )}
            <div className="faktur__kop-teks">
              <strong className="faktur__usaha">{isi.toko.nama}</strong>
              {blokAktif(template, 'alamat', true) && isi.toko.alamat && (
                <div className="faktur__redup">{isi.toko.alamat}</div>
              )}
              {blokAktif(template, 'telepon', true) && isi.toko.telepon && (
                <div className="faktur__redup">Telp: {isi.toko.telepon}</div>
              )}
            </div>
          </header>

          <h1 className="faktur__judul">{judul}</h1>

          {/* Nomor & tanggal / pihak */}
          <div className="faktur__meta">
            <div className="faktur__meta-kiri">
              {blokAktif(template, 'pihak', true) && (
                <div className="faktur__pihak">
                  <span className="faktur__redup">
                    {faktur.jenis === 'penjualan' ? 'Pelanggan' : 'Pemasok'}
                  </span>
                  <strong>{faktur.pihak.nama || 'Umum'}</strong>
                  {faktur.pihak.alamat && (
                    <div className="faktur__redup">{faktur.pihak.alamat}</div>
                  )}
                  {faktur.pihak.telepon && (
                    <div className="faktur__redup">Telp: {faktur.pihak.telepon}</div>
                  )}
                </div>
              )}
              {blokAktif(template, 'gudang', true) && (str('gudang') || str('kasir')) && (
                <div className="faktur__redup">
                  {str('gudang') ? `Gudang: ${str('gudang')}` : ''}
                  {str('gudang') && str('kasir') ? ' · ' : ''}
                  {str('kasir') ? `Kasir: ${str('kasir')}` : ''}
                </div>
              )}
            </div>
            <div className="faktur__meta-kanan">
              {blokAktif(template, 'nomor', true) && (
                <div>
                  <span className="faktur__redup">No. </span>
                  <strong className="faktur__nomor">{faktur.no_faktur}</strong>
                </div>
              )}
              <div className="faktur__redup">Tanggal: {tanggalPanjang(faktur.tanggal)}</div>
              {faktur.no_sumber && <div className="faktur__redup">Ref: {faktur.no_sumber}</div>}
              {str('no_grn') && <div className="faktur__redup">GRN: {str('no_grn')}</div>}
            </div>
          </div>

          {/* Tabel item — fixed layout + colgroup (K2/K3). */}
          <table className="faktur__tabel" ref={refTabel}>
            <colgroup>
              <col style={{ width: `${persen['no'] ?? 4}%` }} />
              {kolom.map((k) => (
                <col key={k} style={{ width: `${persen[k] ?? 10}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="rata-tengah faktur__th-no">No</th>
                {kolom.map((k) => (
                  <th key={k} className={kelasSel(k)}>
                    {labelKolom(template, k, singkat)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isi.items.map((it, i) => (
                <tr key={`${it.kode}-${i}`}>
                  <td className="rata-tengah faktur__td-no">{i + 1}</td>
                  {kolom.map((k) => (
                    <td key={k} className={kelasSel(k)}>
                      {k === 'nama' ? (
                        <span className="faktur__nama-sel">{isiSel(k, it)}</span>
                      ) : (
                        isiSel(k, it)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Ringkasan — disembunyikan untuk Surat Jalan (tanpa kolom harga, K5). */}
          {adaRetur && template?.jenis !== 'surat_jalan' && (
            <div className="faktur__retur-badge">FAKTUR DENGAN RETUR</div>
          )}

          {template?.jenis !== 'surat_jalan' && (
            <div className="faktur__bawah">
              {(blokAktif(template, 'terbilang', true) && Boolean(faktur.terbilang)) ||
              (blokAktif(template, 'catatan', true) && Boolean(faktur.catatan || teks['catatan'])) ||
              (blokAktif(template, 'rekening', false) && Boolean(teks['rekening'])) ? (
                <div className="faktur__terbilang">
                  {blokAktif(template, 'terbilang', true) && faktur.terbilang && (
                    <>
                      <span className="faktur__redup">Terbilang:</span>
                      <div>{faktur.terbilang}</div>
                    </>
                  )}
                  {blokAktif(template, 'catatan', true) && (faktur.catatan || teks['catatan']) && (
                    <div className="faktur__catatan">{faktur.catatan || teks['catatan']}</div>
                  )}
                  {blokAktif(template, 'rekening', false) && teks['rekening'] && (
                    <div className="faktur__redup">Rekening: {teks['rekening']}</div>
                  )}
                </div>
              ) : null}

              <table className="faktur__ringkas">
                <tbody>
                  {/* Ringkasan Total Qty — akumulasi kuantitas fisik item.
                      Bisa dimatikan lewat Template Faktur ▸ Tampilan blok. */}
                  {blokAktif(template, 'total_qty', true) && totalQty && (
                    <tr className="faktur__ringkas-qty">
                      <td>Total Qty</td>
                      <td className="rata-kanan">{totalQty}</td>
                    </tr>
                  )}
                  <tr>
                    <td>
                      {adaRetur
                        ? faktur.jenis === 'pembelian'
                          ? 'Subtotal Pembelian Awal'
                          : 'Subtotal Penjualan Awal'
                        : 'Subtotal'}
                    </td>
                    <td className="rata-kanan">{rupiah(faktur.subtotal)}</td>
                  </tr>
                  {adaRetur &&
                    returSah.map((r) => (
                      <tr key={`retur-${r.id}`} className="faktur__ringkas-retur">
                        <td>
                          {labelRetur} ({r.no_dokumen})
                        </td>
                        <td className="rata-kanan">− {rupiah(Number(r.total))}</td>
                      </tr>
                    ))}
                  {faktur.diskon > 0 && (
                    <tr>
                      <td>Diskon</td>
                      <td className="rata-kanan">− {rupiah(faktur.diskon)}</td>
                    </tr>
                  )}
                  {(faktur.pajak > 0 || faktur.pajak_persen > 0) && (
                    <tr>
                      <td>Pajak ({faktur.pajak_persen}%)</td>
                      <td className="rata-kanan">{rupiah(faktur.pajak)}</td>
                    </tr>
                  )}
                  <tr className="faktur__total">
                    <td>{adaRetur ? 'Total Bersih (Net Amount)' : 'Total'}</td>
                    <td className="rata-kanan">
                      {rupiah(adaRetur ? Math.max(0, Number(faktur.total) - totalRetur) : faktur.total)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Tanda tangan — label mengikuti jenis dokumen (K5). */}
          {blokAktif(template, 'tanda_tangan', true) && (
            <div className="faktur__tanda-tangan">
              <div className="faktur__ttd-pihak">
                <div className="faktur__ttd-ruang" />
                <div>{faktur.jenis === 'penjualan' ? 'Penerima' : 'Pemasok'},</div>
                <div className="faktur__redup">{faktur.pihak.nama || ''}</div>
              </div>
              <div className="faktur__ttd-toko">
                <div className="faktur__ttd-ruang" />
                <div>Hormat kami,</div>
                <strong>{isi.toko.nama}</strong>
              </div>
            </div>
          )}

          {teks['catatan_kaki'] && <footer className="faktur__kaki">{teks['catatan_kaki']}</footer>}
        </div>
      </div>
    </div>
  );
}

/**
 * Pratinjau layar yang selalu tampil PENUH & terpusat (BAGIAN AA1/AA2):
 * kertas dirender ukuran asli lalu diskalakan fit-to-container lewat
 * wadah bersama PratinjauKertas (alat zoom, penanda halaman, layar penuh).
 * Cetak/PDF tetap 1:1 — FakturDokumen yang sama dipakai ketiganya, dan
 * aturan print melepas skala pratinjau.
 *
 * Termal 58/80 mm: tinggi mengikuti isi (pratinjau strip tinggi, tanpa
 * penanda halaman — kertas gulungan). Lainnya: penanda "Halaman n/N" bila
 * isi melebihi satu halaman.
 */
export function PratinjauFaktur({
  faktur,
  isi,
  template,
}: {
  faktur: FakturDTO;
  isi: IsiFaktur;
  template: TemplateFaktur | null;
}) {
  const ukuran = ukuranKertas(template);
  const termal = template?.kertas === '58mm' || template?.kertas === '80mm';

  return (
    <PratinjauKertas
      lebarMm={ukuran.lebar}
      tinggiMm={termal ? null : ukuran.tinggi}
      halamanMm={termal ? null : ukuran.tinggi}
    >
      <FakturDokumen faktur={faktur} isi={isi} template={template} />
    </PratinjauKertas>
  );
}

// BAGIAN X3.2 — Pop up "Cetak / Ekspor PDF" dua kolom:
//   kiri  — ukuran kertas (A4/Letter/Legal/thermal/kustom), orientasi, margin,
//           skala, pilihan kolom yang dicetak, kop toko;
//   kanan — pratinjau halaman berlatar PUTIH (selalu, kedua tema) dengan
//           navigasi halaman ‹ n / N ›;
//   kaki  — tombol IKON ber_tooltip: Cetak, Simpan PDF, Kirim (WhatsApp), Batal.
// Pratinjau memakai HTML yang SAMA dengan jendela cetak (htmlLaporan) sehingga
// hasil cetak identik dengan yang terlihat.
import { useEffect, useMemo, useRef, useState } from 'react';
import { IconButton } from '../../components/IconButton';
import { Modal } from '../../components/crud/Modal';
import { MM_KE_PX, PratinjauKertas } from '../../components/PratinjauKertas';
import {
  OPSI_CETAK_AWAL,
  PADDING_PRATINJAU_MM,
  UKURAN_CETAK,
  htmlLaporan,
  muatPreferensiCetak,
  simpanPreferensiCetak,
  lebarHalamanPx,
  tinggiHalamanPx,
  type MetaCetak,
  type OpsiCetak,
  type OrientasiCetak,
} from './cetak';
import './laporan.css';

export function DialogCetakLaporan({
  meta,
  onTutup,
  onCetak,
  onKirim,
}: {
  meta: MetaCetak;
  onTutup: () => void;
  /** Buka jendela cetak (Print → Save as PDF) dengan opsi terpilih. */
  onCetak: (opsi: OpsiCetak) => void;
  /** Beralih ke dialog Kirim (WhatsApp). */
  onKirim?: () => void;
}) {
  const [opsi, setOpsi] = useState<OpsiCetak>(() => ({
    ...OPSI_CETAK_AWAL,
    ...muatPreferensiCetak(),
    ...(meta.opsi ?? {}),
  }));
  const [hal, setHal] = useState(1);
  const [jumlahHal, setJumlahHal] = useState(1);
  const frame = useRef<HTMLIFrameElement>(null);

  const html = useMemo(() => htmlLaporan({ ...meta, opsi }, true), [meta, opsi]);
  const lebarPx = lebarHalamanPx(opsi);
  const tinggiPx = tinggiHalamanPx(opsi); /* null = thermal (tinggi otomatis) */
  // Kompensasi ruang udara pratinjau (px layar, mengikuti skala): dikurangkan
  // dari scrollHeight agar hitungan halaman & lompat halaman tetap tepat.
  const padVertikalPx = Math.round(
    ((PADDING_PRATINJAU_MM.atas + PADDING_PRATINJAU_MM.bawah) * MM_KE_PX * opsi.skala) / 100,
  );
  const padAtasPx = Math.round((PADDING_PRATINJAU_MM.atas * MM_KE_PX * opsi.skala) / 100);

  const ubah = (patch: Partial<OpsiCetak>) => {
    setOpsi((o) => {
      const baru = { ...o, ...patch };
      // Preferensi "Sembunyikan Laba", "Tampilkan Rincian Barang" &
      // "Tampilkan Baris Total di PDF" diingat untuk laporan berikutnya
      // (localStorage).
      if ('sembunyikanLaba' in patch || 'rincianBarang' in patch || 'tampilkanTotal' in patch) simpanPreferensiCetak(baru);
      return baru;
    });
    setHal(1);
  };

  /** Hitung jumlah halaman setelah isi iframe siap (skala fit → PratinjauKertas). */
  const ukur = () => {
    const doc = frame.current?.contentDocument;
    if (!doc?.body) return;
    const isiBersih = Math.max(0, doc.body.scrollHeight - padVertikalPx);
    const tinggiIsi = tinggiPx ?? isiBersih;
    const n = Math.max(1, Math.ceil(isiBersih / Math.max(1, tinggiIsi) - 0.03));
    setJumlahHal(n);
  };

  useEffect(() => {
    ukur();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, opsi]);

  const keHalaman = (n: number) => {
    const target = Math.min(Math.max(1, n), jumlahHal);
    setHal(target);
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    const tinggiIsi = tinggiPx ?? Math.max(0, doc.body.scrollHeight - padVertikalPx);
    doc.defaultView?.scrollTo(0, padAtasPx + (target - 1) * tinggiIsi);
  };

  const kolom = meta.kolom;
  const dipilih = opsi.kolomDipilih ?? [];
  const alihKolom = (kunci: string) => {
    const kini = dipilih.length ? dipilih : kolom.map((k) => k.kunci);
    const next = kini.includes(kunci) ? kini.filter((k) => k !== kunci) : [...kini, kunci];
    ubah({ kolomDipilih: next.length === kolom.length ? [] : next });
  };

  // Tinggi iframe = tinggi isi + ruang udara atas-bawah agar padding bawah
  // pratinjau ikut terlihat (bukan terpotong / butuh gulir dalam).
  const bingkai = (tinggiPx ?? Math.min(900, Math.round(lebarPx * 2.2))) + padVertikalPx;

  return (
    <Modal judul="Cetak / Ekspor PDF" lebar="cetak" onTutup={onTutup}>
      <div className="cetak-dialog">
        {/* ---- Kolom kiri: pengaturan ---- */}
        <div className="cetak-dialog__pengaturan">
          <label className="bidang">
            <span>Ukuran kertas</span>
            <select
              className="input-pilih"
              value={opsi.ukuran}
              onChange={(e) => ubah({ ukuran: e.target.value as OpsiCetak['ukuran'] })}
            >
              {UKURAN_CETAK.map((u) => (
                <option key={u.nilai} value={u.nilai}>
                  {u.teks}
                </option>
              ))}
            </select>
          </label>

          <label className="bidang">
            <span>Orientasi</span>
            <select
              className="input-pilih"
              value={opsi.orientasi}
              disabled={opsi.ukuran === '58mm' || opsi.ukuran === '80mm'}
              onChange={(e) => ubah({ orientasi: e.target.value as OrientasiCetak })}
            >
              <option value="potret">Potret</option>
              <option value="lanskap">Lanskap</option>
            </select>
          </label>

          <div className="cetak-dialog__baris">
            <label className="bidang">
              <span>Margin (mm)</span>
              <input
                type="number"
                min={1}
                max={40}
                value={opsi.margin}
                disabled={opsi.ukuran === '58mm' || opsi.ukuran === '80mm' || opsi.ukuran === 'custom'}
                onChange={(e) => ubah({ margin: Math.min(40, Math.max(1, Number(e.target.value) || 14)) })}
              />
            </label>
            <label className="bidang">
              <span>Skala (%)</span>
              <select
                className="input-pilih"
                value={opsi.skala}
                onChange={(e) => ubah({ skala: Number(e.target.value) })}
              >
                {[75, 85, 100, 110, 125].map((s) => (
                  <option key={s} value={s}>
                    {s}%
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="cetak-dialog__cek">
            <input type="checkbox" checked={opsi.kop} onChange={(e) => ubah({ kop: e.target.checked })} />
            <span>Tampilkan kop toko (nama &amp; alamat)</span>
          </label>

          <div className="cetak-dialog__opsi">
            <b>Opsi Cetak PDF</b>
            <label className="cetak-dialog__cek">
              <input
                type="checkbox"
                checked={opsi.sembunyikanLaba !== false}
                onChange={(e) => ubah({ sembunyikanLaba: e.target.checked })}
              />
              <span>Sembunyikan Kolom Laba</span>
            </label>
            <label className="cetak-dialog__cek">
              <input
                type="checkbox"
                checked={opsi.rincianBarang !== false}
                onChange={(e) => ubah({ rincianBarang: e.target.checked })}
              />
              <span>Tampilkan Rincian Barang</span>
            </label>
            <label className="cetak-dialog__cek">
              <input
                type="checkbox"
                checked={opsi.tampilkanTotal === true}
                onChange={(e) => ubah({ tampilkanTotal: e.target.checked })}
              />
              <span>Tampilkan Baris Total di PDF</span>
            </label>
          </div>

          <div className="cetak-dialog__kolom">
            <b>Kolom yang dicetak</b>
            {kolom.map((k) => (
              <label key={k.kunci} className="cetak-dialog__cek">
                <input
                  type="checkbox"
                  checked={dipilih.length === 0 || dipilih.includes(k.kunci)}
                  onChange={() => alihKolom(k.kunci)}
                />
                <span>{k.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* ---- Kolom kanan: pratinjau halaman (selalu putih) ---- */}
        <div className="cetak-dialog__pratinjau">
          <div className="cetak-dialog__baris-atas">
            <span className="teks-redup teks-kecil">Pratinjau — hasil cetak identik</span>
            {jumlahHal > 1 && (
              <span className="cetak-nav">
                <IconButton
                  ikon="chevron-left"
                  label="Halaman sebelumnya"
                  ukuran="baris"
                  disabled={hal <= 1}
                  onClick={() => keHalaman(hal - 1)}
                />
                <span>
                  {hal} / {jumlahHal}
                </span>
                <IconButton
                  ikon="chevron-right"
                  label="Halaman berikutnya"
                  ukuran="baris"
                  disabled={hal >= jumlahHal}
                  onClick={() => keHalaman(hal + 1)}
                />
              </span>
            )}
          </div>
          {/* BAGIAN AA — wadah pratinjau bersama: fit-to-container (batas
              atas 100%), alat zoom/layar penuh, terpusat tanpa potongan. */}
          <PratinjauKertas lebarMm={lebarPx / MM_KE_PX} tinggiMm={bingkai / MM_KE_PX}>
            <iframe
              ref={frame}
              title="Pratinjau cetak"
              srcDoc={html}
              onLoad={ukur}
              style={{
                width: lebarPx,
                height: bingkai,
                border: 0,
                display: 'block',
                background: '#ffffff',
              }}
            />
          </PratinjauKertas>
        </div>
      </div>

      {/* ---- Kaki: ikon + tooltip (X3.2) ---- */}
      <div className="cetak-dialog__aksi">
        <IconButton ikon="printer" label="Cetak" warna="primer" onClick={() => onCetak(opsi)} />
        <IconButton ikon="file-down" label="Simpan PDF" onClick={() => onCetak(opsi)} />
        {onKirim && <IconButton ikon="send" label="Kirim (WhatsApp)" onClick={onKirim} />}
        <IconButton ikon="close" label="Batal" onClick={onTutup} />
      </div>
    </Modal>
  );
}

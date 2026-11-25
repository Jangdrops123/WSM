import type { DaftarPengaturan } from './tipePengaturan';

/* ---------------------- Kartu Dashboard (tab 5) -------------------------- */

/**
 * Pilih kartu yang tampil beserta urutannya (baris pertama = paling atas).
 * Nilai disimpan sebagai daftar kode; kartu yang tidak ada di daftar disembunyikan.
 */
export function PanelKartuDashboard({
  daftar,
  nilai,
  ubah,
}: {
  daftar: DaftarPengaturan;
  nilai: Record<string, unknown>;
  ubah: (kunci: string, v: unknown) => void;
}) {
  const urut = (Array.isArray(nilai.kartu) ? nilai.kartu : []).filter((x): x is string => typeof x === 'string');
  const semua = daftar.kartu;
  const tersedia = semua.filter((k) => !urut.includes(k.kode));

  const set = (v: string[]) => ubah('kartu', v);

  function toggle(kode: string, tampil: boolean) {
    if (!tampil) {
      const i = urut.indexOf(kode);
      if (i >= 0) {
        const next = [...urut];
        next.splice(i, 1);
        set(next);
      }
    } else if (!urut.includes(kode)) {
      set([...urut, kode]);
    }
  }

  function geser(i: number, delta: number) {
    const next = [...urut];
    const j = i + delta;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    set(next);
  }

  return (
    <section className="kartu">
      <div className="kartu__kepala kartu__kepala--kompak">
        <h3>Kartu yang Tampil &amp; Urutannya</h3>
        <span className="teks-redup">Baris pertama tampil paling atas.</span>
      </div>

      {urut.length === 0 ? (
        <p className="teks-redup">Semua kartu disembunyikan — tampilkan minimal satu kartu.</p>
      ) : (
        <ol className="kartu-urut">
          {urut.map((kode, i) => (
            <li key={kode}>
              <span className="kartu-urut__label">{semua.find((k) => k.kode === kode)?.label ?? kode}</span>
              <span className="aksi-baris">
                <button type="button" className="tombol tombol--kecil" onClick={() => geser(i, -1)} disabled={i === 0} aria-label="Naikkan">
                  ↑
                </button>
                <button
                  type="button"
                  className="tombol tombol--kecil"
                  onClick={() => geser(i, 1)}
                  disabled={i === urut.length - 1}
                  aria-label="Turunkan"
                >
                  ↓
                </button>
                <button type="button" className="tombol tombol--kecil tombol--bahaya" onClick={() => toggle(kode, false)}>
                  Sembunyikan
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}

      {tersedia.length > 0 && (
        <>
          <h4 className="teks-redup">Kartu tersembunyi</h4>
          <ul className="kartu-urut kartu-urut--sembunyi">
            {tersedia.map((k) => (
              <li key={k.kode}>
                <span className="kartu-urut__label">{k.label}</span>
                <button type="button" className="tombol tombol--kecil" onClick={() => toggle(k.kode, true)}>
                  Tampilkan
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/* --------------------- Pratinjau label (tab 12) -------------------------- */

const BLOK_LABEL: { kode: string; label: string; contoh: string }[] = [
  { kode: 'nama', label: 'Nama', contoh: 'Kaos Distro Premium' },
  { kode: 'kode', label: 'Kode', contoh: 'BRG-0001' },
  { kode: 'sku', label: 'SKU', contoh: 'KDP-BRU-M' },
  { kode: 'size', label: 'Size', contoh: 'M' },
  { kode: 'warna', label: 'Warna', contoh: 'Hitam' },
  { kode: 'harga', label: 'Harga', contoh: 'Rp125.000' },
];

/** Pratinjau label cetak: ukuran, margin, blok yang tampil, dan bentuk barcode. */
export function PanelPratinjauLabel({ nilai }: { nilai: Record<string, unknown> }) {
  const blok = (Array.isArray(nilai.blok_label) ? nilai.blok_label : []).filter(
    (x): x is string => typeof x === 'string',
  );
  const lebar = Number(nilai.lebar_label ?? 50);
  const tinggi = Number(nilai.tinggi_label ?? 30);
  const margin = Number(nilai.margin_label ?? 2);
  const format = String(nilai.format_barcode ?? 'code128');

  const polos = format === 'qr';

  return (
    <section className="kartu">
      <div className="kartu__kepala kartu__kepala--kompak">
        <h3>Pratinjau Label</h3>
        <span className="teks-redup">
          {lebar} × {tinggi} mm · margin {margin} mm · {format.toUpperCase()}
        </span>
      </div>

      <div className="label-pratinjau-wadah">
        <div
          className="label-pratinjau"
          style={{ width: `${Math.min(240, lebar * 4)}px`, minHeight: `${Math.min(160, tinggi * 4)}px`, padding: `${Math.max(2, margin * 2)}px` }}
        >
          {blok.includes('nama') && <strong>Kaos Distro Premium</strong>}
          <div className={`label-barcode label-barcode--${polos ? 'qr' : 'batang'}`} aria-hidden="true" />
          {blok.includes('kode') && <span>BRG-0001</span>}
          <span className="label-baris-bawah">
            {blok.includes('sku') && <span>KDP-BRU-M</span>}
            {blok.includes('size') && <span>M</span>}
            {blok.includes('warna') && <span>Hitam</span>}
            {blok.includes('harga') && <b>Rp125.000</b>}
          </span>
          {blok.length === 0 && <em className="teks-redup">Tidak ada blok yang dipilih.</em>}
        </div>
      </div>

      <p className="teks-redup">
        Blok aktif: {blok.length ? blok.map((b) => BLOK_LABEL.find((x) => x.kode === b)?.label ?? b).join(', ') : '—'}
      </p>
    </section>
  );
}

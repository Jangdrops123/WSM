import { NavLink } from 'react-router-dom';
import type { Bidang } from './tipePengaturan';

/**
 * Renderer satu bidang pengaturan. Dipakai semua tab baru di Grup Umum &
 * Grup Transaksi sehingga bentuk form seragam (label, satuan, batas, bantuan).
 */
export function BidangPengaturan({
  b,
  nilai,
  ubah,
  opsi,
}: {
  b: Bidang;
  nilai: unknown;
  ubah: (nilai: unknown) => void;
  opsi?: { nilai: string; label: string }[];
}) {
  const kelas = ['bidang'];
  if (b.tipe === 'bool') kelas.push('bidang--centang');
  if (b.tipe === 'teks_panjang' || b.tipe === 'daftar') kelas.push('bidang--lebar');
  // Layanan luar (WhatsApp/API, SMTP) yang belum tersambung: tampil nonaktif
  // dengan petunjuk, bukan pesan galat.
  if (b.nonaktif) kelas.push('bidang--nonaktif');

  const id = `pg-${b.kunci}`;
  const labelTeks = (
    <label htmlFor={id}>
      {b.label}
      {b.wajib && <i className="wajib"> *</i>}
      {b.cakupan === 'toko' && <span className="lencana-per-toko">Per toko</span>}
    </label>
  );

  if (b.tipe === 'catatan') {
    return (
      <div className="bidang bidang--lebar bidang--catatan">
        <span>{b.label}</span>
        <p className="catatan-bidang">{b.ket ?? String(nilai ?? '')}</p>
      </div>
    );
  }

  // Y2.2 — tautan antar halaman Pengaturan (mis. "Ubah logo aplikasi di
  // Identitas Aplikasi" pada tab Profil Usaha). Tidak ada nilai yang disimpan.
  if (b.tipe === 'tautan') {
    return (
      <div className="bidang bidang--lebar bidang--tautan">
        <NavLink className="tombol tombol--kecil tombol--netral" to={b.ke ?? '#'}>
          {b.label}
        </NavLink>
        {b.ket && <span className="bidang-ket">{b.ket}</span>}
      </div>
    );
  }

  if (b.tipe === 'bool') {
    return (
      <div className={kelas.join(' ')}>
        <input
          id={id}
          type="checkbox"
          checked={nilai === true}
          disabled={Boolean(b.nonaktif)}
          onChange={(e) => ubah(e.target.checked)}
        />
        <span>
          <label htmlFor={id}>{b.label}</label>
          {b.cakupan === 'toko' && <span className="lencana-per-toko">Per toko</span>}
          {b.ket && <em className="teks-redup">{b.ket}</em>}
        </span>
      </div>
    );
  }

  const isi = (() => {
    switch (b.tipe) {
      case 'teks_panjang':
        return (
          <textarea
            id={id}
            rows={3}
            value={String(nilai ?? '')}
            maxLength={b.max ?? 4000}
            disabled={Boolean(b.nonaktif)}
            onChange={(e) => ubah(e.target.value)}
          />
        );
      case 'angka':
      case 'bilangan':
        return (
          <input
            id={id}
            type="number"
            inputMode="decimal"
            value={nilai === null || nilai === undefined ? '' : String(nilai)}
            min={b.min ?? undefined}
            max={b.max ?? undefined}
            step={b.tipe === 'angka' ? 1 : 'any'}
            disabled={Boolean(b.nonaktif)}
            onChange={(e) => {
              const v = e.target.value;
              ubah(v === '' ? '' : b.tipe === 'angka' ? Number.parseInt(v, 10) : Number.parseFloat(v));
            }}
          />
        );
      case 'pilihan':
        return (
          <select id={id} value={String(nilai ?? '')} disabled={Boolean(b.nonaktif)} onChange={(e) => ubah(e.target.value)}>
            {(opsi ?? b.opsi ?? []).map((o) => (
              <option key={o.nilai} value={o.nilai}>
                {o.label}
              </option>
            ))}
          </select>
        );
      case 'daftar':
        return (
          <textarea
            id={id}
            rows={Math.min(10, Math.max(3, (Array.isArray(nilai) ? nilai.length : 0) + 1))}
            value={(Array.isArray(nilai) ? nilai : []).join('\n')}
            onChange={(e) => ubah(e.target.value.split('\n'))}
            placeholder="Satu baris satu nilai"
          />
        );
      case 'gambar':
        return (
          <span className="bidang-gambar">
            <input
              id={id}
              type="url"
              value={String(nilai ?? '')}
              placeholder="https://…"
              onChange={(e) => ubah(e.target.value)}
            />
            {String(nilai ?? '') ? <img src={String(nilai)} alt={b.label} /> : null}
          </span>
        );
      default:
        return (
          <input
            id={id}
            type="text"
            value={String(nilai ?? '')}
            maxLength={b.max ?? 4000}
            disabled={Boolean(b.nonaktif)}
            onChange={(e) => ubah(e.target.value)}
          />
        );
    }
  })();

  return (
    <div className={kelas.join(' ')}>
      {labelTeks}
      {isi}
      <span className="bidang-ket">
        {b.ket}
        {b.satuan ? ` (${b.satuan})` : ''}
        {b.nonaktif && <em className="petunjuk-nonaktif">{b.nonaktif}</em>}
      </span>
    </div>
  );
}

/**
 * Editor Penomoran Dokumen: format + panjang digit + reset urutan,
 * lengkap dengan pratinjau contoh nomor dan daftar token yang tersedia.
 */
export function BidangPenomoran({
  b,
  nilai,
  ubah,
  token,
  prefix,
  kodeToko,
}: {
  b: Bidang;
  nilai: unknown;
  ubah: (nilai: unknown) => void;
  token: string[];
  prefix: string;
  kodeToko: string;
}) {
  const v = (nilai ?? { format: '', digit: 4, reset: 'tahun' }) as {
    format: string;
    digit: number;
    reset: string;
  };
  const set = (patch: Partial<typeof v>) => ubah({ ...v, ...patch });

  return (
    <div className="penomoran-baris">
      <div className="bidang bidang--nomor">
        <label htmlFor={`pg-${b.kunci}-format`}>{b.label}</label>
        <input
          id={`pg-${b.kunci}-format`}
          type="text"
          value={v.format}
          maxLength={120}
          onChange={(e) => set({ format: e.target.value })}
        />
        <span className="bidang-ket">Token tersedia: {token.join(' ')}</span>
      </div>

      <div className="bidang bidang--kecil">
        <label htmlFor={`pg-${b.kunci}-digit`}>Digit nomor</label>
        <input
          id={`pg-${b.kunci}-digit`}
          type="number"
          min={1}
          max={12}
          value={v.digit}
          onChange={(e) => set({ digit: Number.parseInt(e.target.value, 10) || 1 })}
        />
      </div>

      <div className="bidang bidang--kecil">
        <label htmlFor={`pg-${b.kunci}-reset`}>Reset urutan</label>
        <select id={`pg-${b.kunci}-reset`} value={v.reset} onChange={(e) => set({ reset: e.target.value })}>
          <option value="tidak_pernah">Tidak pernah</option>
          <option value="tahun">Tiap tahun</option>
          <option value="bulan">Tiap bulan</option>
        </select>
      </div>

      <div className="bidang bidang--pratinjau">
        <span>Pratinjau</span>
        <strong className="teks-nomor">{pratinjauLokal(v.format, v.digit, prefix, kodeToko)}</strong>
      </div>
    </div>
  );
}

/** Contoh nomor untuk format yang sedang diketik (tanpa menyentuh counter). */
function pratinjauLokal(
  format: string,
  digit: number,
  prefix: string,
  kodeToko: string,
): string {
  const t = new Date();
  const tahun = String(t.getFullYear());
  const bulan = String(t.getMonth() + 1).padStart(2, '0');
  const hasil = (format ?? '')
    .replace(/\{KODE_TOKO\}/g, kodeToko || prefix)
    .replace(/\{KODE\}/g, prefix)
    .replace(/\{TAHUN\}/g, tahun)
    .replace(/\{BULAN\}/g, bulan)
    .replace(/\{NOMOR\}/g, String(1).padStart(Math.min(12, Math.max(1, digit || 1)), '0'));
  return hasil || '—';
}

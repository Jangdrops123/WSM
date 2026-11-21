// MODUL STOK OPNAME — dokumen cetak: Lembar Hitung & Berita Acara.
// Keduanya dirender di dalam .opname-cetak-wadah; saat window.print(),
// CSS opname.css menyembunyikan seluruh aplikasi dan hanya dokumen ini yang tercetak.
import { formatAngka, formatTanggal, formatTanggalPanjang, formatTanggalWaktu } from '../../lib/format';

type Baris = Record<string, any>;

function NamaToko(): string {
  return 'NusaSuite'; // diambil dari meta bila tersedia; cukup untuk kop dokumen internal
}

function Kop({ judul, sesi }: { judul: string; sesi: Baris }) {
  return (
    <header className="opname-dok__kop">
      <div>
        <div className="opname-dok__toko">{NamaToko()}</div>
        <div className="opname-dok__sub">{sesi.gudang_nama} · {sesi.gudang_kode}</div>
      </div>
      <div className="opname-dok__judul">
        <h1>{judul}</h1>
        <div className="opname-dok__no">No. {sesi.no_dokumen}</div>
      </div>
    </header>
  );
}

function InfoGrid({ sesi }: { sesi: Baris }) {
  return (
    <dl className="opname-dok__info">
      <div><dt>Tanggal opname</dt><dd>{formatTanggal(sesi.tanggal)}</dd></div>
      <div><dt>Gudang</dt><dd>{sesi.gudang_nama} ({sesi.gudang_kode})</dd></div>
      <div><dt>Lokasi / rak</dt><dd>{sesi.lokasi_kode ?? 'Seluruh gudang'}</dd></div>
      <div><dt>Penanggung jawab</dt><dd>{sesi.penanggung_jawab ?? '—'}</dd></div>
      <div><dt>Metode hitung</dt><dd>{sesi.metode === 'manual' ? 'Manual' : sesi.metode === 'scan' ? 'Scan 1 per 1' : 'Gabungan (manual + scan)'}</dd></div>
      <div><dt>Status</dt><dd>{sesi.status === 'disahkan' ? 'Disahkan' : sesi.status === 'batal' ? 'Dibatalkan' : sesi.tahap === 'tinjau' ? 'Tinjau selisih' : 'Menghitung'}</dd></div>
    </dl>
  );
}

function TandaTangan({ sesi }: { sesi: Baris }) {
  return (
    <div className="opname-dok__ttd">
      <div>
        <div className="opname-dok__ttd-label">Penanggung Jawab Opname</div>
        <div className="opname-dok__ttd-isi">
          <span className="opname-dok__ttd-nama">{sesi.penanggung_jawab ?? '(……………………………)'}</span>
        </div>
      </div>
      <div>
        <div className="opname-dok__ttd-label">Pengesah / Mengetahui</div>
        <div className="opname-dok__ttd-isi">
          <span className="opname-dok__ttd-nama">{sesi.disetujui_oleh_nama ?? '(……………………………)'}</span>
        </div>
      </div>
    </div>
  );
}

/** Lembar Hitung — daftar baris untuk diisi petugas hitung fisik (sistem dicetak sebagai pembanding). */
export function LembarHitung({ sesi, items }: { sesi: Baris; items: Baris[] }) {
  return (
    <article className="opname-dok">
      <Kop judul="LEMBAR HITUNG OPNAME" sesi={sesi} />
      <InfoGrid sesi={sesi} />
      <table className="opname-dok__tabel">
        <thead>
          <tr>
            <th className="opname-dok__n">No</th>
            <th>SKU</th>
            <th>Produk</th>
            <th>Lokasi</th>
            <th className="opname-dok__angka">Stok sistem</th>
            <th className="opname-dok__angka">Stok fisik</th>
            <th className="opname-dok__angka">Selisih</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={it.id}>
              <td className="opname-dok__n">{i + 1}</td>
              <td>{it.sku}</td>
              <td>{it.produk}</td>
              <td>{it.kode_lokasi ?? '—'}</td>
              <td className="opname-dok__angka">{formatAngka(Number(it.qty_sistem))}</td>
              <td className="opname-dok__kosong" />
              <td className="opname-dok__kosong" />
            </tr>
          ))}
        </tbody>
      </table>
      <p className="opname-dok__catatan">
        Isi kolom <strong>Stok fisik</strong> sesuai penghitungan fisik di lapangan. Selisih dihitung otomatis (fisik − sistem) setelah data diinput ke aplikasi.
      </p>
      <TandaTangan sesi={sesi} />
    </article>
  );
}

/** Berita Acara — dokumen resmi hasil opname: ringkasan selisih + penyesuaian. */
export function BeritaAcara({ sesi, items }: { sesi: Baris; items: Baris[] }) {
  const terhitung = items.filter((it) => Number(it.terhitung));
  const berselisih = terhitung.filter((it) => Number(it.selisih) !== 0);
  const lebih = berselisih.filter((it) => Number(it.selisih) > 0);
  const kurang = berselisih.filter((it) => Number(it.selisih) < 0);
  const nilaiLebih = lebih.reduce((a, b) => a + Math.abs(Number(b.selisih)) * Number(b.rata ?? 0), 0);
  const nilaiKurang = kurang.reduce((a, b) => a + Math.abs(Number(b.selisih)) * Number(b.rata ?? 0), 0);
  const belum = items.length - terhitung.length;

  return (
    <article className="opname-dok">
      <Kop judul="BERITA ACARA OPNAME" sesi={sesi} />
      <InfoGrid sesi={sesi} />
      <p className="opname-dok__paragraf">
        Pada tanggal {formatTanggalPanjang(sesi.tanggal)} telah dilakukan penghitungan stok fisik atas persediaan barang di {sesi.gudang_nama}
        {sesi.lokasi_kode ? ` lokasi ${sesi.lokasi_kode}` : ' (seluruh gudang)'} dengan metode{' '}
        {sesi.metode === 'manual' ? 'manual' : sesi.metode === 'scan' ? 'scan 1 per 1' : 'gabungan manual dan scan'}. Hasil penghitungan sebagai berikut:
      </p>

      <div className="opname-dok__ringkas">
        <div><span>Total baris</span><strong>{formatAngka(items.length)}</strong></div>
        <div><span>Sudah dihitung</span><strong>{formatAngka(terhitung.length)}</strong></div>
        <div><span>Belum dihitung</span><strong>{formatAngka(belum)}</strong></div>
        <div><span>Selisih lebih</span><strong className="opname-lebih">+{formatAngka(lebih.length)} baris (nilai ±{formatAngka(nilaiLebih)})</strong></div>
        <div><span>Selisih kurang</span><strong className="opname-kurang">−{formatAngka(kurang.length)} baris (nilai ±{formatAngka(nilaiKurang)})</strong></div>
      </div>

      <h2 className="opname-dok__h2">Rincian Selisih</h2>
      {berselisih.length === 0 ? (
        <p className="opname-dok__paragraf">Seluruh baris yang dihitung sesuai dengan stok sistem — tidak ada selisih.</p>
      ) : (
        <table className="opname-dok__tabel">
          <thead>
            <tr>
              <th className="opname-dok__n">No</th>
              <th>SKU</th>
              <th>Produk</th>
              <th>Lokasi</th>
              <th className="opname-dok__angka">Sistem</th>
              <th className="opname-dok__angka">Fisik</th>
              <th className="opname-dok__angka">Selisih</th>
              <th className="opname-dok__angka">Nilai</th>
            </tr>
          </thead>
          <tbody>
            {berselisih.map((it, i) => (
              <tr key={it.id}>
                <td className="opname-dok__n">{i + 1}</td>
                <td>{it.sku}</td>
                <td>{it.produk}</td>
                <td>{it.kode_lokasi ?? '—'}</td>
                <td className="opname-dok__angka">{formatAngka(Number(it.qty_sistem))}</td>
                <td className="opname-dok__angka">{formatAngka(Number(it.qty_fisik))}</td>
                <td className={`opname-dok__angka ${Number(it.selisih) > 0 ? 'opname-lebih' : 'opname-kurang'}`}>
                  {Number(it.selisih) > 0 ? '+' : ''}{formatAngka(Number(it.selisih))}
                </td>
                <td className="opname-dok__angka">{formatAngka(Math.abs(Number(it.selisih)) * Number(it.rata ?? 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="opname-dok__paragraf">
        Demikian berita acara ini dibuat dengan sebenarnya untuk dipergunakan sebagaimana mestinya.
        {sesi.status === 'disahkan'
          ? ' Selisih di atas telah disetujui dan disesuaikan pada sistem persediaan (kartu stok & jurnal penyesuaian).'
          : ' Dokumen ini belum disahkan — penyesuaian stok belum diterapkan.'}
      </p>
      <TandaTangan sesi={sesi} />
      <div className="opname-dok__footer">
        Dicetak {formatTanggalWaktu(new Date())} · {sesi.no_dokumen}
      </div>
    </article>
  );
}

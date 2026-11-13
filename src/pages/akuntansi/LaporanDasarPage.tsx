import { useCallback, useEffect, useState } from 'react';
import { apiGet, unduhExcel } from '../../lib/api';
import { useSegarkanModul } from '../../lib/segarkan';
import { beritahu } from '../../components/crud/Toast';
import { MenuAksi } from '../../components/MenuAksi';
import { cetakHtml } from '../../lib/code39';
import { useSesi } from '../../lib/sesi';
import { can } from '../../lib/hak';
import { rp } from './tipe';
import './akuntansi.css';

type Jenis = 'kas-bank' | 'laba-rugi' | 'rekap-piutang' | 'rekap-hutang';

const JUDUL: Record<Jenis, string> = {
  'kas-bank': 'Laporan Kas & Bank',
  'laba-rugi': 'Laba Rugi Sederhana',
  'rekap-piutang': 'Rekap Piutang',
  'rekap-hutang': 'Rekap Hutang',
};

interface BarisKas {
  kode: string;
  nama: string;
  saldo_awal: number;
  masuk: number;
  keluar: number;
  saldo_akhir: number;
}
interface BarisRekap {
  entitas: string;
  jumlah_tagihan: number;
  total: number;
  terbayar: number;
  sisa: number;
}

/**
 * LAPORAN DASAR (Akuntansi Dasar) — Kas & Bank, Laba Rugi Sederhana, Rekap
 * Piutang, Rekap Hutang. Filter tanggal & ekspor Excel/PDF. Tanpa neraca/arus
 * kas berbasis jurnal.
 */
export function LaporanDasarPage() {
  const tahun = new Date().getFullYear();
  const [jenis, setJenis] = useState<Jenis>('kas-bank');
  const [dari, setDari] = useState(`${tahun}-01-01`);
  const [sampai, setSampai] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  // AX — unduh Excel laporan = sel Ekspor pada Akuntansi.
  const info = useSesi().info;
  const bolehEkspor = can(info, 'akuntansi', 'ekspor');

  const muat = useCallback(async () => {
    const q = new URLSearchParams({ dari, sampai });
    const r = await apiGet<Record<string, unknown>>(`/api/akuntansi/laporan/${jenis}?${q.toString()}`);
    setData(r);
  }, [jenis, dari, sampai]);

  useEffect(() => {
    void muat().catch((e: Error) => beritahu(e.message, 'galat'));
  }, [muat]);
  // Tombol Refresh global di topbar: muat ulang laporan dasar.
  useSegarkanModul(muat);

  const ekspor = async () => {
    try {
      await unduhExcel(`/api/akuntansi/laporan/${jenis}/xlsx?dari=${dari}&sampai=${sampai}`, `laporan-dasar-${jenis}.xlsx`);
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    }
  };

  const cetak = () => {
    const isi = document.querySelector('.laporan-dasar')?.outerHTML ?? '';
    cetakHtml(`${JUDUL[jenis]} (${dari} s/d ${sampai})`, isi, '');
  };

  const t = jenis === 'kas-bank' ? (data as unknown as { akun?: BarisKas[]; total?: Record<string, number> }) : null;
  const lr = jenis === 'laba-rugi' ? (data as unknown as Record<string, number>) : null;
  const rekap = jenis === 'rekap-piutang' || jenis === 'rekap-hutang'
    ? (data as unknown as { baris?: BarisRekap[]; total_sisa?: number })
    : null;

  return (
    <div className="halaman akuntansi">
      {/* ============ Satu kartu terpadu: header + isi ============ */}
      <section className="kartu">
        <div className="kartu__kepala kartu__kepala--kompak kepala-kartu">
          <div>
            <h3>Laporan Dasar</h3>
            <p className="teks-redup teks-kecil">Kas & bank, laba rugi sederhana, rekap piutang/hutang.</p>
          </div>
          {bolehEkspor && (
            <MenuAksi
              label="Aksi laporan"
              items={[
                { label: 'Ekspor Excel', jalan: () => void ekspor() },
                { label: 'Cetak / PDF', jalan: cetak },
              ]}
            />
          )}
        </div>
        <div className="alat-tabel">
          <select className="input-pilih" value={jenis} onChange={(e) => setJenis(e.target.value as Jenis)} aria-label="Jenis laporan">
            <option value="kas-bank">Kas &amp; Bank</option>
            <option value="laba-rugi">Laba Rugi Sederhana</option>
            <option value="rekap-piutang">Rekap Piutang</option>
            <option value="rekap-hutang">Rekap Hutang</option>
          </select>
          <label className="teks-kecil">Dari
            <input type="date" className="input-cari" value={dari} onChange={(e) => setDari(e.target.value)} />
          </label>
          <label className="teks-kecil">Sampai
            <input type="date" className="input-cari" value={sampai} onChange={(e) => setSampai(e.target.value)} />
          </label>
        </div>

        <div className="laporan-dasar">
          {!data && <p className="teks-redup">Memuat…</p>}

          {data && jenis === 'kas-bank' && t && (
            <table className="tabel">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Kode</th>
                  <th>Rekening</th>
                  <th className="rata-kanan" style={{ width: 140 }}>Saldo Awal</th>
                  <th className="rata-kanan" style={{ width: 140 }}>Masuk</th>
                  <th className="rata-kanan" style={{ width: 140 }}>Keluar</th>
                  <th className="rata-kanan" style={{ width: 140 }}>Saldo Akhir</th>
                </tr>
              </thead>
              <tbody>
                {(t.akun ?? []).map((a, i) => (
                  <tr key={i}>
                    <td><code>{a.kode}</code></td>
                    <td>{a.nama}</td>
                    <td className="rata-kanan">{rp(a.saldo_awal)}</td>
                    <td className="rata-kanan">{rp(a.masuk)}</td>
                    <td className="rata-kanan">{rp(a.keluar)}</td>
                    <td className="rata-kanan"><strong>{rp(a.saldo_akhir)}</strong></td>
                  </tr>
                ))}
                {t.total && (
                  <tr>
                    <td colSpan={2} className="rata-kanan"><strong>TOTAL</strong></td>
                    <td className="rata-kanan"><strong>{rp(t.total.saldo_awal ?? 0)}</strong></td>
                    <td className="rata-kanan"><strong>{rp(t.total.masuk ?? 0)}</strong></td>
                    <td className="rata-kanan"><strong>{rp(t.total.keluar ?? 0)}</strong></td>
                    <td className="rata-kanan"><strong>{rp(t.total.saldo_akhir ?? 0)}</strong></td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {data && jenis === 'laba-rugi' && lr && (
            <table className="tabel">
              <tbody>
                <tr><td>Penjualan</td><td className="rata-kanan">{rp(lr.penjualan ?? 0)}</td></tr>
                <tr><td>(−) Retur Penjualan</td><td className="rata-kanan">{rp(lr.retur ?? 0)}</td></tr>
                <tr><td><strong>Penjualan Bersih</strong></td><td className="rata-kanan"><strong>{rp(lr.penjualan_bersih ?? 0)}</strong></td></tr>
                <tr><td>(−) Harga Pokok Penjualan (HPP)</td><td className="rata-kanan">{rp(lr.hpp ?? 0)}</td></tr>
                <tr><td><strong>Laba Kotor</strong></td><td className="rata-kanan"><strong>{rp(lr.laba_kotor ?? 0)}</strong></td></tr>
                <tr><td>(−) Total Pengeluaran / Biaya</td><td className="rata-kanan">{rp(lr.pengeluaran ?? 0)}</td></tr>
                <tr><td>(+) Pemasukan Lain</td><td className="rata-kanan">{rp(lr.pemasukan_lain ?? 0)}</td></tr>
                <tr style={{ fontSize: 16 }}>
                  <td><strong>LABA BERSIH</strong></td>
                  <td className="rata-kanan"><strong>{rp(lr.laba_bersih ?? 0)}</strong></td>
                </tr>
              </tbody>
            </table>
          )}

          {data && (jenis === 'rekap-piutang' || jenis === 'rekap-hutang') && rekap && (
            <table className="tabel">
              <thead>
                <tr>
                  <th>{jenis === 'rekap-piutang' ? 'Pelanggan' : 'Pemasok'}</th>
                  <th className="rata-kanan" style={{ width: 120 }}>Tagihan</th>
                  <th className="rata-kanan" style={{ width: 140 }}>Total</th>
                  <th className="rata-kanan" style={{ width: 140 }}>Terbayar</th>
                  <th className="rata-kanan" style={{ width: 140 }}>Sisa</th>
                </tr>
              </thead>
              <tbody>
                {(rekap.baris ?? []).length === 0 && <tr><td colSpan={5} className="tabel-kosong">Tidak ada {jenis === 'rekap-piutang' ? 'piutang' : 'hutang'} berjalan.</td></tr>}
                {(rekap.baris ?? []).map((b, i) => (
                  <tr key={i}>
                    <td>{b.entitas ?? '—'}</td>
                    <td className="rata-kanan">{b.jumlah_tagihan}</td>
                    <td className="rata-kanan">{rp(b.total)}</td>
                    <td className="rata-kanan">{rp(b.terbayar)}</td>
                    <td className="rata-kanan"><strong>{rp(b.sisa)}</strong></td>
                  </tr>
                ))}
                <tr>
                  <td className="rata-kanan"><strong>TOTAL SISA</strong></td>
                  <td colSpan={3} />
                  <td className="rata-kanan"><strong>{rp(rekap.total_sisa ?? 0)}</strong></td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

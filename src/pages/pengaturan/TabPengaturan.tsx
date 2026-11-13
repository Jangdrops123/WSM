import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { beritahu } from '../../components/crud/Toast';
import { apiGet, apiPost, apiPut } from '../../lib/api';
import { useSegarkanModul } from '../../lib/segarkan';
import { useSesi } from '../../lib/sesi';
import { BidangPengaturan, BidangPenomoran } from './BidangPengaturan';
import { segarkanRegional } from '../../lib/regional';
import { segarkanUsaha } from '../../lib/usaha';
import { simpanTampilanBaru, terapkanTampilanBaru, type TampilanBaru } from '../../lib/tampilanBaru';
import { terapkanPreferensi } from '../../lib/tema';
import { dariNilaiPengaturan, terapkanPreferensiScan } from '../../lib/umpanBalikScan';
import type { Bidang, DaftarPengaturan, NilaiTab, Opsi, Tab } from './tipePengaturan';

/**
 * Kerangka umum tab Pengaturan baru (Grup Umum & Grup Transaksi):
 * memuat nilai dari server, merender form dari registry, dan menyediakan
 * tombol **Simpan**, **Kembalikan ke Bawaan**, serta peringatan bila ada
 * perubahan yang belum disimpan.
 *
 * Tab yang tab-tab lama (Template Faktur, Aturan Kodi, Struk, Halaman Awal,
 * Proses Tahunan) tidak lewat komponen ini — isinya tidak disentuh.
 */
export function TabPengaturan({
  tab,
  daftar,
  toko,
  kustomAtas,
  kecuali = [],
  simpanKecuali = [],
  panel,
}: {
  tab: Tab;
  daftar: DaftarPengaturan;
  /** Kode toko aktif — hanya untuk tab bertanda per toko. */
  toko: string;
  /** Komponen khusus yang dirender di atas form. */
  kustomAtas?: React.ReactNode;
  /** Kunci bidang yang dirender oleh komponen khusus (jangan digandakan). */
  kecuali?: string[];
  /** Kunci bidang yang disimpan sendiri oleh komponen khusus (tidak ikut
   *  dikirim saat Simpan agar perubahan form lain tidak menimpanya). */
  simpanKecuali?: string[];
  /** Panel khusus yang ikut alur form: menerima nilai & callback ubah. */
  panel?: (nilai: Record<string, unknown>, ubah: (kunci: string, v: unknown) => void) => ReactNode;
}) {
  const [tersimpan, setTersimpan] = useState<Record<string, unknown> | null>(null);
  const [nilai, setNilai] = useState<Record<string, unknown>>({});
  const [opsi, setOpsi] = useState<Record<string, Opsi[]>>({});
  const [sibuk, setSibuk] = useState(false);
  const [kotor, setKotor] = useState(false);
  const [muatUlang, setMuatUlang] = useState(0);
  const perToko = tab.cakupan === 'toko' ? toko : null;
  const navigate = useNavigate();
  const menuAwalTab = useSesi().info?.menuAwal?.rute ?? '/';
  // Penguncian global: tab Suara & Getar Scan (termasuk audio kustom) hanya
  // dapat diubah Administrator — peran lain melihat nilai secara read-only.
  const terkunci = tab.kode === 'suara-scan' && useSesi().info?.pengguna.admin !== true;

  const muat = useCallback(async (terapkan = false) => {
    if (tab.cakupan === 'toko' && !perToko) return;
    try {
      const q = perToko ? `?toko=${encodeURIComponent(perToko)}` : '';
      const r = await apiGet<NilaiTab>(`/api/pengaturan/${tab.kode}${q}`);
      setTersimpan(r.nilai);
      setNilai(r.nilai);
      setKotor(false);
      // Suara scan: cache localStorage ikut nilai server, sehingga setelah muat
      // ulang / "Kembalikan ke Bawaan" audio kustom lama tidak diputar lagi.
      if (tab.kode === 'suara-scan') terapkanPreferensiScan(dariNilaiPengaturan(r.nilai));
      // Setelah "Kembalikan ke Bawaan" — nilai baru langsung terlihat (AH2c).
      if (terapkan && tab.kode === 'tampilan') terapkanTampilan(r.nilai, true);
    } catch (e) {
      const pesan = e instanceof Error ? e.message : 'Gagal memuat pengaturan.';
      // Peran tanpa izin tab ini (mis. URL langsung): tanpa popup — kembali
      // diam-diam ke halaman awal peran (toast akses-ditolak juga disaring
      // di beritahu sebagai pengaman ganda).
      if (/tidak punya akses|tidak memiliki izin|tidak berhak/i.test(pesan)) {
        navigate(menuAwalTab, { replace: true });
        return;
      }
      beritahu(pesan, 'galat');
    }
  }, [tab.kode, perToko, navigate, menuAwalTab]);

  useEffect(() => {
    void muat(muatUlang > 0);
  }, [muat, muatUlang]);
  // Tombol Refresh global di topbar: muat ulang nilai tab (tanpa menyentuh form).
  useSegarkanModul(muat);

  // Pilihan dinamis (mis. daftar gudang/satuan) diambil sekali per tab.
  useEffect(() => {
    let batal = false;
    const urls = [...new Set(tab.bidang.map((b) => b.opsiUrl).filter((u): u is string => Boolean(u)))];
    if (!urls.length) return;
    void Promise.all(
      urls.map((u) => apiGet<{ data: Opsi[] }>(u).then((r) => [u, r.data] as const).catch(() => [u, [] as Opsi[]] as const)),
    ).then((hasil) => {
      if (batal) return;
      setOpsi(Object.fromEntries(hasil));
    });
    return () => {
      batal = true;
    };
  }, [tab.kode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Salinan nilai terbaru untuk pratinjau tampilan (tanpa menunggu render).
  const nilaiRef = useRef(nilai);
  nilaiRef.current = nilai;

  const ubah = (kunci: string, v: unknown) => {
    if (terkunci) return;
    // Pembaruan fungsional: dua `ubah()` berurutan dalam satu event (mis. file
    // audio + nama berkasnya) tidak saling menimpa.
    nilaiRef.current = { ...nilaiRef.current, [kunci]: v };
    setNilai((prev) => ({ ...prev, [kunci]: v }));
    setKotor(true);
    // AH2c — tab Tampilan: pratinjau langsung tanpa muat ulang.
    if (tab.kode === 'tampilan') terapkanTampilan(nilaiRef.current, false);
  };

  const bersih = useMemo(
    () => tersimpan && JSON.stringify(nilai) === JSON.stringify(tersimpan),
    [nilai, tersimpan],
  );

  // Peringatan sebelum meninggalkan halaman / menutup tab bila belum disimpan.
  useEffect(() => {
    if (kotor && !bersih) {
      const cegah = (e: BeforeUnloadEvent) => {
        e.preventDefault();
        e.returnValue = '';
      };
      window.addEventListener('beforeunload', cegah);
      return () => window.removeEventListener('beforeunload', cegah);
    }
    return;
  }, [kotor, bersih]);

  async function simpan() {
    // Peringatan dampak: pengaturan yang menyangkut data lama (metode HPP,
    // penomoran, kunci periode) minta konfirmasi sebelum ditulis.
    const dampak = new Set<string>();
    if (tab.dampak) dampak.add(tab.dampak);
    for (const b of tab.bidang) {
      if (!b.dampak) continue;
      if (JSON.stringify(nilai[b.kunci] ?? null) !== JSON.stringify(tersimpan?.[b.kunci] ?? null)) {
        dampak.add(`${b.label}: ${b.dampak}`);
      }
    }
    if (dampak.size > 0) {
      const teks = [...dampak].map((d) => `• ${d}`).join('\n\n');
      if (!window.confirm(`Periksa dampak perubahan ini sebelum menyimpan:\n\n${teks}`)) return;
    }

    setSibuk(true);
    try {
      const q = perToko ? `?toko=${encodeURIComponent(perToko)}` : '';
      const kirim: Record<string, unknown> = { ...nilai };
      for (const kunci of simpanKecuali) delete kirim[kunci];
      const r = await apiPut<{ pesan: string }>(`/api/pengaturan/${tab.kode}${q}`, { nilai: kirim });
      beritahu(r.pesan);
      setTersimpan(nilai);
      setKotor(false);
      // Audio kustom langsung berlaku & dicache untuk semua layar scan.
      if (tab.kode === 'suara-scan') terapkanPreferensiScan(dariNilaiPengaturan(nilai));
      setMuatUlang((x) => x + 1);
      if (tab.kode === 'tampilan') terapkanTampilan(nilai, true);
      // Regional (zona/format) langsung berlaku: jam header & laporan ikut.
      if (tab.kode === 'umum-regional') void segarkanRegional().catch(() => undefined);
      // Profil Usaha langsung berlaku: header kasir, struk, faktur & laporan ikut.
      if (tab.kode === 'profil-usaha') void segarkanUsaha().catch(() => undefined);
    } catch (e) {
      beritahu(e instanceof Error ? e.message : 'Gagal menyimpan.', 'galat');
    } finally {
      setSibuk(false);
    }
  }

  async function keBawaan() {
    setSibuk(true);
    try {
      const body = perToko ? { toko: perToko } : {};
      const r = await apiPost<{ pesan: string }>(`/api/pengaturan/${tab.kode}/bawaan`, body);
      beritahu(r.pesan, 'info');
      setMuatUlang((x) => x + 1);
      if (tab.kode === 'umum-regional') void segarkanRegional().catch(() => undefined);
      if (tab.kode === 'profil-usaha') void segarkanUsaha().catch(() => undefined);
    } catch (e) {
      beritahu(e instanceof Error ? e.message : 'Gagal mengembalikan ke bawaan.', 'galat');
    } finally {
      setSibuk(false);
    }
  }

  /** AH2c — batalkan perubahan yang belum disimpan & kembalikan tampilan. */
  function batal() {
    if (!tersimpan) return;
    setNilai(tersimpan);
    setKotor(false);
    if (tab.kode === 'suara-scan') terapkanPreferensiScan(dariNilaiPengaturan(tersimpan));
    if (tab.kode === 'tampilan') terapkanTampilan(tersimpan, true);
  }

  if (!tersimpan) return <p className="teks-redup">Memuat pengaturan…</p>;

  return (
    <div className="tab-pengaturan">
      {kustomAtas}
      {panel?.(nilai, ubah)}

      <section className="kartu">
        <div className="kartu__kepala kartu__kepala--kompak">
          <h3>{tab.label}</h3>
          <span className="teks-redup">
            {tab.cakupan === 'toko'
              ? `Berlaku per toko — sedang mengatur toko ${toko || 'belum dipilih'}.`
              : 'Berlaku untuk seluruh database.'}
          </span>
        </div>
        {tab.ket && <p className="teks-redup">{tab.ket}</p>}
        {terkunci && (
          <p className="teks-redup" role="note">
            🔒 Pengaturan suara dan getar scan dikunci secara global dan hanya dapat diubah oleh Administrator.
          </p>
        )}

        {tab.bidang.length === 0 ? (
          <p className="teks-redup">{tab.ket ?? 'Tab ini tidak memiliki pengaturan yang dapat diubah.'}</p>
        ) : (
          <fieldset
            disabled={terkunci}
            style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
            aria-label={terkunci ? `${tab.label} (hanya baca)` : tab.label}
          >
            <div className="form-grid">
              {tab.bidang.filter((b) => !kecuali.includes(b.kunci)).map((b) => (
                <BidangField
                  key={b.kunci}
                  b={b}
                  nilai={nilai[b.kunci]}
                  ubah={(v) => ubah(b.kunci, v)}
                  opsi={opsi[b.opsiUrl ?? '']}
                  daftar={daftar}
                  toko={perToko ?? ''}
                />
              ))}
            </div>
          </fieldset>
        )}

        {!tab.informatif && !terkunci && (
          <div className="tombol-baris tombol-baris--kanan">
            {kotor && !bersih && (
              <span className="peringatan-kotor" role="status">
                Ada perubahan yang belum disimpan
              </span>
            )}
            {kotor && !bersih && (
              <button type="button" className="tombol tombol--netral" onClick={batal} disabled={sibuk}>
                Batal
              </button>
            )}
            <button type="button" className="tombol tombol--netral" onClick={() => void keBawaan()} disabled={sibuk}>
              Kembalikan ke Bawaan
            </button>
            <button type="button" className="tombol" onClick={() => void simpan()} disabled={sibuk || !kotor}>
              Simpan
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function BidangField({
  b,
  nilai,
  ubah,
  opsi,
  daftar,
  toko,
}: {
  b: Bidang;
  nilai: unknown;
  ubah: (v: unknown) => void;
  opsi?: Opsi[];
  daftar: DaftarPengaturan;
  toko: string;
}) {
  if (b.tipe === 'penomoran') {
    const j = daftar.jenisNomor.find((x) => x.kode === b.kunci);
    return (
      <div className="bidang--lebar">
        <BidangPenomoran
          b={b}
          nilai={nilai}
          ubah={ubah}
          token={['{KODE}', '{KODE_TOKO}', '{TAHUN}', '{BULAN}', '{NOMOR}']}
          prefix={j?.prefix ?? 'INV'}
          kodeToko={toko}
        />
      </div>
    );
  }
  return (
    <BidangPengaturan
      b={b}
      nilai={nilai}
      ubah={ubah}
      opsi={opsi?.map((o) => ({ nilai: String(o.nilai ?? o.id ?? ''), label: o.label }))}
    />
  );
}

/** Terapkan preferensi tampilan (tema + kepadatan + Ukuran Font) ke layar.
 *  `simpan = true` — ikut ditulis ke localStorage (setelah Simpan / Batal /
 *  Kembalikan ke Bawaan); `false` hanya pratinjau langsung (AH2c). */
function terapkanTampilan(nilai: Record<string, unknown>, simpan: boolean): void {
  terapkanPreferensi({
    tema: (['terang', 'gelap', 'sistem'] as const).includes(String(nilai.tema) as never)
      ? (String(nilai.tema) as 'terang' | 'gelap' | 'sistem')
      : 'sistem',
    aksen: String(nilai.aksen ?? '') as never,
    sidebar: (String(nilai.sidebar_tampilan ?? 'gelap') === 'terang' ? 'terang' : 'gelap') as never,
  });
  const p: TampilanBaru = {
    // Nilai lama (normal/ringkas) dipetakan; selain itu ikut nilai baru.
    kepadatan: (() => {
      const k = String(nilai.kepadatan ?? 'nyaman');
      if (k === 'padat' || k === 'longgar' || k === 'nyaman') return k;
      if (k === 'ringkas') return 'padat';
      if (k === 'normal') return 'nyaman';
      return 'nyaman';
    })(),
    ukuran_font: String(nilai.ukuran_font ?? '100'),
    ukuran_font_kustom: Number.isFinite(Number(nilai.ukuran_font_kustom))
      ? Math.min(150, Math.max(75, Math.round(Number(nilai.ukuran_font_kustom))))
      : 100,
    sidebar_ciut: nilai.sidebar_ciut === true,
  };
  if (simpan) simpanTampilanBaru(p);
  else terapkanTampilanBaru(p);
}

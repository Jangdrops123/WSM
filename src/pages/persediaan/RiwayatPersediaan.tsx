// ============================================================================
// Kartu "Riwayat" modul Persediaan Sub — daftar dokumen tersimpan/batal.
//   • checkbox aksi massal (batalkan dokumen, ekspor Excel terpilih)
//   • urut A-Z / Z-A (nomor dokumen)
//   • aksi ikon per baris: Lihat (detail) & Batalkan
//   • ekspor Excel (.xlsx), cetak/PDF, impor massal + contoh file otomatis
// Dokumen tidak pernah dihapus permanen — hanya dibatalkan (stok kembali).
// ============================================================================

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { apiGet, apiPost, unduhExcel, type ImportResult, type ResponsDaftar } from '../../lib/api';
import { useSegarkanModul } from '../../lib/segarkan';
import { beritahu } from '../../components/crud/Toast';
import { PenyesuaianOpnameRiwayat } from './PenyesuaianOpname';
import { Modal } from '../../components/crud/Modal';
import { type AksiMassalItem } from '../../components/crud/AksiMassal';
import { DataTable } from '../../components/crud/DataTable';
import { FooterDaftar } from '../../components/crud/FooterDaftar';
import { useBarisOtomatis } from '../../lib/barisOtomatis';
import { IconButton } from '../../components/IconButton';
import { MobileList, type AksiIkonBaris, type BarisMobile } from '../../components/MobileList';
import { usePilihan } from '../../lib/pilihan';
import { cetakHtml } from '../../lib/code39';
import { formatAngka, formatTanggal, formatTanggalWaktu } from '../../lib/format';
import { MenuAksi } from '../../components/MenuAksi';
import type { Arah, DokumenSub, ItemDokumen } from './tipe';

/** Gaya cetak ringkas — dialog print muncul, pilih "Simpan sebagai PDF". */
const GAYA_CETAK = `@page{size:A4 landscape;margin:12mm}
body{color:#111}
h1{font-size:16px;margin:0 0 2px}
.sub{color:#555;font-size:10px;margin:0 0 10px}
table{width:100%;border-collapse:collapse}
th,td{border:1px solid #999;padding:4px 6px;text-align:left;font-size:10.5px}
thead th{background:#eee;font-size:9.5px;text-transform:uppercase;letter-spacing:.03em}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}`;

interface DetailDokumen {
  dokumen: DokumenSub;
  item: ItemDokumen[];
}

type HasilImpor = ImportResult & { dokumen_dibuat: number };

export function RiwayatPersediaan({ arah, segarkan, tambahLabel, onTambah }: { arah: Arah; segarkan: number; tambahLabel?: string; onTambah?: () => void }) {
  const judul = arah === 'masuk' ? 'Item Masuk' : 'Item Keluar';

  const [data, setData] = useState<DokumenSub[]>([]);
  const [total, setTotal] = useState(0);
  const [hal, setHal] = useState(1);
  const areaRef = useRef<HTMLDivElement>(null);
  // AJ — baris per halaman otomatis (Otomatis/20/50/100) + footer terpadu.
  const { per, mode: modeBaris, setMode: setModeBaris } = useBarisOtomatis({
    kunci: 'persediaan',
    areaRef,
    total,
    hal,
    setHal,
  });
  const [urutArah, setUrutArah] = useState<'ASC' | 'DESC'>('ASC'); // A-Z / Z-A nomor
  // O4b — tampilan terpisah via token: Dokumen | Penyesuaian Opname.
  const [pandangan, setPandangan] = useState<'dokumen' | 'opname'>('dokumen');
  const [sibuk, setSibuk] = useState(false);
  const [sibukImpor, setSibukImpor] = useState(false);
  const [lihat, setLihat] = useState<DetailDokumen | null>(null);
  const [konfirmasi, setKonfirmasi] = useState<{ ids: number[]; nama: string[]; alasan: string } | null>(null);
  const [sedangBatal, setSedangBatal] = useState(false);
  const [hasilImpor, setHasilImpor] = useState<HasilImpor | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pilihan = usePilihan([arah, urutArah]);
  const idsHalaman = data.map((d) => d.id);
  // AZ — kartu mobile dari DATA (<768px): layar kecil, mode pilih, pratinjau
  // barang adaptif (AZ3.1), dan kartu pengisi bila daftar lebih pendek dari
  // layar (AZ3.2). DataTable desktop tidak berubah.
  const [layarKecil, setLayarKecil] = useState(() => window.matchMedia('(max-width: 767.98px)').matches);
  const [modePilih, setModePilih] = useState(false);
  const [pratinjau, setPratinjau] = useState<Record<number, ItemDokumen[]>>({});
  const [jmlPratinjau, setJmlPratinjau] = useState(0);
  const [tampilPengisi, setTampilPengisi] = useState(false);
  const daftarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767.98px)');
    const selaras = () => {
      setLayarKecil(mq.matches);
      if (!mq.matches) setModePilih(false);
    };
    mq.addEventListener('change', selaras);
    // Cadangan: sebagian peramban/otomasi tidak menembakkan 'change' saat
    // viewport diubah (rotasi harus tetap mengganti tampilan).
    window.addEventListener('resize', selaras);
    return () => {
      mq.removeEventListener('change', selaras);
      window.removeEventListener('resize', selaras);
    };
  }, []);

  const muat = useCallback(async () => {
    setSibuk(true);
    try {
      const q = new URLSearchParams({
        arah,
        hal: String(hal),
        per: String(per),
        urut: 'no_dokumen',
        arah_urut: urutArah,
      });
      const r = await apiGet<ResponsDaftar<DokumenSub>>(`/api/persediaan?${q}`);
      setData(r.data);
      setTotal(r.total);
      if (hal > 1 && r.total > 0 && r.data.length === 0) setHal(1);
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    } finally {
      setSibuk(false);
    }
  }, [arah, hal, per, urutArah]);

  useEffect(() => {
    void muat();
  }, [muat, segarkan]);
  // AZ3.1 — ambil rincian barang kartu tampil (cache per dokumen) hanya saat
  // mobile butuh baris pratinjau; batal aman bila halaman berganti.
  useEffect(() => {
    if (!layarKecil || pandangan !== 'dokumen' || jmlPratinjau <= 0 || data.length === 0) return;
    const kurang = data.map((d) => d.id).filter((id) => pratinjau[id] === undefined);
    if (kurang.length === 0) return;
    let batal = false;
    void (async () => {
      const hasil = await Promise.allSettled(
        kurang.map(async (id) => ({ id, r: await apiGet<{ data: DetailDokumen }>(`/api/persediaan/${id}`) })),
      );
      if (batal) return;
      setPratinjau((lama) => {
        const baru = { ...lama };
        for (const h of hasil) if (h.status === 'fulfilled') baru[h.value.id] = h.value.r.data.item;
        return baru;
      });
    })();
    return () => {
      batal = true;
    };
  }, [layarKecil, pandangan, jmlPratinjau, data, pratinjau]);
  // AZ3.1 — hitung baris pratinjau dari ruang bebas per kartu (0–5).
  useLayoutEffect(() => {
    if (!layarKecil || pandangan !== 'dokumen' || data.length === 0) {
      setJmlPratinjau(0);
      return;
    }
    const el = daftarRef.current;
    if (!el) return;
    const bebas = Math.max(0, el.clientHeight - el.scrollHeight);
    const perKartu = bebas / data.length;
    setJmlPratinjau(Math.max(0, Math.min(5, Math.floor(perKartu / 20))));
  }, [layarKecil, pandangan, data, hal]);
  // AZ3.2 — tampilkan kartu pengisi bila sisa ruang >100px setelah pratinjau.
  useEffect(() => {
    if (!layarKecil || pandangan !== 'dokumen' || data.length === 0) {
      setTampilPengisi(false);
      return;
    }
    const el = daftarRef.current;
    if (!el) return;
    setTampilPengisi(el.clientHeight - el.scrollHeight > 100);
  }, [layarKecil, pandangan, data, jmlPratinjau, pratinjau, hal]);
  // Tombol Refresh global di topbar: muat ulang riwayat (tanpa menyentuh seleksi baris).
  useSegarkanModul(muat);

  // Pindah arah → halaman pertama.
  useEffect(() => {
    setHal(1);
  }, [arah]);

  /** Ambil seluruh baris sesuai filter (untuk cetak/PDF). */
  const ambilSemua = async (): Promise<DokumenSub[]> => {
    const out: DokumenSub[] = [];
    for (let h = 1; h <= 50; h++) {
      const q = new URLSearchParams({
        arah,
        hal: String(h),
        per: '200',
        urut: 'no_dokumen',
        arah_urut: urutArah,
      });
      const r = await apiGet<ResponsDaftar<DokumenSub>>(`/api/persediaan?${q}`);
      out.push(...r.data);
      if (out.length >= r.total) break;
    }
    return out;
  };

  const eksporExcel = async (ids?: number[]): Promise<void> => {
    try {
      const q = new URLSearchParams({ arah });
      if (ids && ids.length > 0) q.set('ids', ids.join(','));
      const nama = `riwayat-persediaan-${arah}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      await unduhExcel(`/api/persediaan/ekspor?${q}`, nama);
      beritahu('File Excel diunduh.', 'sukses');
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    }
  };

  const cetakPdf = async (): Promise<void> => {
    try {
      const semua = await ambilSemua();
      if (semua.length === 0) {
        beritahu('Tidak ada dokumen untuk dicetak.', 'info');
        return;
      }
      const judulCetak = `Riwayat Persediaan Sub — ${judul}`;
      const baris = semua
        .map(
          (d) => `<tr>
            <td>${formatTanggal(d.tanggal)}</td>
            <td>${d.no_dokumen}</td>
            <td>${[d.gudang_kode, d.gudang_nama].filter(Boolean).join(' — ')}</td>
            <td>${d.alasan_label}</td>
            <td>${d.keterangan ?? ''}</td>
            <td class="n">${formatAngka(d.total_qty)}</td>
            <td>${d.status_label}</td>
          </tr>`,
        )
        .join('');
      cetakHtml(
        judulCetak,
        `<h1>${judulCetak}</h1>
         <p class="sub">Dicetak ${formatTanggalWaktu(new Date())} · ${semua.length} dokumen · urut ${urutArah === 'ASC' ? 'A→Z' : 'Z→A'}</p>
         <table>
           <thead><tr><th>Tanggal</th><th>Nomor</th><th>Gudang</th><th>Alasan</th><th>Keterangan</th><th class="n">Total Qty</th><th>Status</th></tr></thead>
           <tbody>${baris}</tbody>
         </table>`,
        GAYA_CETAK,
      );
      beritahu('Dialog cetak terbuka — pilih "Simpan sebagai PDF" untuk ekspor PDF.', 'info', 5000);
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    }
  };

  const unduhContoh = async (): Promise<void> => {
    try {
      await unduhExcel(`/api/persediaan/template?arah=${arah}`, `contoh-impor-persediaan-${arah}.xlsx`);
      beritahu('Contoh file diunduh — hapus baris contoh sebelum impor.', 'sukses');
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    }
  };

  const imporFile = async (file: File): Promise<void> => {
    setSibukImpor(true);
    try {
      const buf = await file.arrayBuffer();
      const biner = Array.from(new Uint8Array(buf), (b) => String.fromCharCode(b)).join('');
      const balas = await apiPost<HasilImpor & { data?: HasilImpor }>('/api/persediaan/impor', {
        arah,
        nama_file: file.name,
        data_base64: btoa(biner),
      });
      // Server membungkus hasil dalam { data }; terima juga bentuk datar (kompatibilitas lama).
      const r = (balas.data ?? balas) as HasilImpor;
      setHasilImpor(r);
      beritahu(
        r.baris_error > 0
          ? `${r.dokumen_dibuat} dokumen dibuat, ${r.baris_error} kesalahan.`
          : `${r.dokumen_dibuat} dokumen dibuat dari impor.`,
        r.baris_error > 0 ? 'info' : 'sukses',
      );
      void muat();
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    } finally {
      setSibukImpor(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const bukaDetail = async (d: DokumenSub): Promise<void> => {
    try {
      const r = await apiGet<{ data: DetailDokumen }>(`/api/persediaan/${d.id}`);
      setLihat(r.data);
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    }
  };

  const mintaBatal = (ids: number[], nama: string[]): void => {
    const belum = ids.filter((id) => data.find((d) => d.id === id)?.status !== 'batal');
    if (belum.length === 0) {
      beritahu('Semua dokumen terpilih sudah pernah dibatalkan.', 'info');
      return;
    }
    const namaBaru = nama.filter((_, i) => ids[i] !== undefined).slice(0, 5);
    setKonfirmasi({ ids: belum, nama: namaBaru.length > 0 ? namaBaru : belum.map(String), alasan: '' });
  };

  const batalkanTerpilih = async (): Promise<void> => {
    if (!konfirmasi) return;
    setSedangBatal(true);
    let ok = 0;
    let gagal = '';
    for (const id of konfirmasi.ids) {
      try {
        await apiPost(`/api/persediaan/${id}/batal`, {
          alasan: konfirmasi.alasan.trim() || null,
        });
        ok++;
      } catch (e) {
        if (!gagal) gagal = (e as Error).message;
      }
    }
    setSedangBatal(false);
    setKonfirmasi(null);
    setLihat(null);
    pilihan.bersihkan();
    if (gagal) {
      beritahu(`${ok} dokumen dibatalkan — gagal pertama: ${gagal}`, 'galat', 6000);
    } else {
      beritahu(`${ok} dokumen dibatalkan — stok dikembalikan otomatis.`, 'sukses');
    }
    void muat();
  };

  const aksiMassal: AksiMassalItem[] = [
    {
      kode: 'batal',
      label: 'Batalkan dokumen',
      ikon: 'rotate-ccw',
      bahaya: true,
      jalan: () =>
        mintaBatal(
          [...pilihan.terpilih],
          data.filter((d) => pilihan.terpilih.has(d.id)).map((d) => d.no_dokumen),
        ),
    },
    {
      kode: 'ekspor',
      label: 'Ekspor Excel (terpilih)',
      ikon: 'download',
      jalan: () => void eksporExcel([...pilihan.terpilih]),
    },
  ];

  const totalHal = Math.max(1, Math.ceil(total / per));
  // AZ1 — petakan dokumen ke anatomi kartu mobile (judul+status, info,
  // keterangan, pratinjau barang, kaki nilai + aksi ikon 44px).
  const kartuData: BarisMobile[] = data.map((d) => {
    const item = pratinjau[d.id] ?? [];
    const tampil = item.slice(0, jmlPratinjau);
    const sisa = Math.max(0, (d.jumlah_item || item.length) - tampil.length);
    const aksiIkon: AksiIkonBaris[] = [
      { label: 'Lihat', ikon: 'eye', jalan: () => void bukaDetail(d) },
      ...(d.status === 'disahkan'
        ? [{ label: 'Batalkan', ikon: 'rotate-ccw', warna: 'bahaya', jalan: () => mintaBatal([d.id], [d.no_dokumen]) } as const]
        : []),
    ];
    return {
      id: d.id,
      aria: `Buka ${d.no_dokumen}`,
      judul: d.no_dokumen,
      status: (
        <span className={`lencana ${d.status === 'batal' ? 'lencana--bahaya' : 'lencana--aktif'}`}>{d.status_label}</span>
      ),
      info: `${formatTanggal(d.tanggal)} · ${[d.gudang_kode, d.gudang_nama].filter(Boolean).join(' — ')}`,
      ket: d.keterangan ? `${d.alasan_label} — ${d.keterangan}` : d.alasan_label,
      pratinjau: tampil.map((it) => `${it.nama} x${formatAngka(it.qty)}`),
      pratinjauLebih: sisa,
      kaki: `Total qty ${formatAngka(d.total_qty)}`,
      aksiIkon,
    };
  });

  return (
    <div className="halaman halaman--fit">
    <section className="kartu kartu--daftar">
      <div className="kartu__kepala kartu__kepala--kompak kepala-kartu sub-kepala-riwayat">
        <div>
          <h3>Riwayat {judul}</h3>
          <p className="teks-redup teks-kecil">
            Daftar semua dokumen {arah === 'masuk' ? 'penambahan stok (stok awal, temuan, koreksi +)' : 'pengurangan stok (rusak, hilang, koreksi −)'}
          </p>
        </div>
        <span className="kartu__jumlah">{formatAngka(total)} dokumen</span>
        <div className="rr-token-grup" role="tablist" aria-label="Tampilan riwayat">
          <button
            type="button"
            role="tab"
            aria-selected={pandangan === 'dokumen'}
            title="Riwayat Dokumen"
            className={`rr-token${pandangan === 'dokumen' ? ' rr-token--aktif' : ''}`}
            onClick={() => setPandangan('dokumen')}
          >
            <svg className="rr-token__ikon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="rr-token__label">Dokumen</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={pandangan === 'opname'}
            title="Penyesuaian Opname"
            className={`rr-token${pandangan === 'opname' ? ' rr-token--aktif' : ''}`}
            onClick={() => setPandangan('opname')}
          >
            <svg className="rr-token__ikon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            <span className="rr-token__label">Penyesuaian Opname</span>
          </button>
        </div>
        <div className="tombol-baris sub-riwayat__alat">
          {tambahLabel && onTambah && (
            <button type="button" className="tombol tombol--primer" onClick={onTambah}>
              {tambahLabel}
            </button>
          )}
          <MenuAksi
            label="Aksi riwayat"
            items={[
              { label: `Urutkan: ${urutArah === 'ASC' ? 'A → Z' : 'Z → A'}`, jalan: () => setUrutArah((u) => (u === 'ASC' ? 'DESC' : 'ASC')) },
              { label: 'Ekspor Excel', jalan: () => void eksporExcel() },
              { label: 'Cetak / PDF', jalan: () => void cetakPdf() },
              { label: 'Contoh file impor', jalan: () => void unduhContoh() },
              { label: sibukImpor ? 'Mengimpor…' : 'Impor Excel', jalan: () => fileRef.current?.click(), nonaktif: sibukImpor },
            ]}
          />
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void imporFile(f);
            }}
          />
        </div>
      </div>

      {pandangan === 'dokumen' ? (
      layarKecil ? (
      <>
      <div className="sub-daftar-hp" ref={daftarRef}>
        <MobileList
          tampilan="kartu"
          data={kartuData}
          sibuk={sibuk}
          kosong={sibuk ? 'Memuat…' : 'Belum ada dokumen. Simpan form di atas untuk membuat dokumen pertama.'}
          tombolKosong={onTambah ? { label: tambahLabel ?? 'Tambah', jalan: () => onTambah() } : undefined}
          onBuka={(id) => { const d = data.find((x) => x.id === id); if (d) void bukaDetail(d); }}
          terpilih={pilihan.terpilih}
          modePilih={modePilih}
          onTogglePilih={(id) => pilihan.toggle(id, false, idsHalaman)}
          onMasukModePilih={(id) => { setModePilih(true); if (!pilihan.terpilih.has(id)) pilihan.toggle(id, false, idsHalaman); }}
          onKeluarModePilih={() => { setModePilih(false); pilihan.bersihkan(); }}
          labelPilih="dokumen"
          pengisi={tampilPengisi ? {
            judul: 'Tidak ada dokumen lainnya',
            aksi: [
              ...(onTambah ? [{ label: tambahLabel ?? 'Tambah', jalan: () => onTambah() }] : []),
              { label: 'Impor Excel', primer: false, jalan: () => fileRef.current?.click() },
            ],
          } : null}
        />
      </div>
      <FooterDaftar
        mode={modeBaris} onMode={setModeBaris} hal={hal} totalHal={totalHal} total={total} onHal={setHal}
        seleksi={modePilih ? {
          jumlah: pilihan.jumlah,
          total,
          semuaFilter: false,
          label: 'dokumen',
          onPilihSemua: () => void (async () => { pilihan.pilihFilter((await ambilSemua()).map((d) => d.id)); })(),
          onBatal: () => { setModePilih(false); pilihan.bersihkan(); },
          aksi: aksiMassal,
        } : undefined}
      />
      </>
      ) : (
      <>
      <DataTable
        kelasTabel="tabel--kompak"
        pilihan={pilihan}
        idsHalaman={idsHalaman}
        label="dokumen"
        total={total}
        areaRef={areaRef}
        onPilihSemua={async () => pilihan.pilihFilter((await ambilSemua()).map((d) => d.id))}
        kepala={
          <>
            <th>Tanggal</th>
            <th>Nomor</th>
            <th>Gudang</th>
            <th>Alasan / Keterangan</th>
            <th className="num">Total Qty</th>
            <th>Status</th>
            <th className="kolom-aksi">Aksi</th>
          </>
        }
        baris={data.map((d) => ({
          id: d.id,
          aria: `Pilih ${d.no_dokumen}`,
          isi: [
            <td key="tanggal">{formatTanggal(d.tanggal)}</td>,
            <td key="nomor" className="sub-td-nomor">{d.no_dokumen}</td>,
            <td key="gudang">{[d.gudang_kode, d.gudang_nama].filter(Boolean).join(' — ')}</td>,
            <td key="ket">
              {d.alasan_label}
              {d.keterangan && <span className="sub-ket"> — {d.keterangan}</span>}
            </td>,
            <td key="qty" className="num">{formatAngka(d.total_qty)}</td>,
            <td key="status">
              <span className={`lencana ${d.status === 'batal' ? 'lencana--bahaya' : 'lencana--aktif'}`}>
                {d.status_label}
              </span>
            </td>,
            <td key="aksi" className="sub-td-aksi-riwayat">
              <IconButton label="Lihat" ikon="eye" onClick={() => void bukaDetail(d)} />
              {d.status === 'disahkan' && (
                <IconButton
                  label="Batalkan"
                  ikon="rotate-ccw"
                  warna="bahaya"
                  onClick={() => mintaBatal([d.id], [d.no_dokumen])}
                />
              )}
            </td>,
          ],
        }))}
        colSpan={8}
        kosong={sibuk ? 'Memuat…' : 'Belum ada dokumen. Simpan form di atas untuk membuat dokumen pertama.'}
        aksiBar={aksiMassal}
      />

      <FooterDaftar mode={modeBaris} onMode={setModeBaris} hal={hal} totalHal={totalHal} total={total} onHal={setHal} />
      </>
      )
      ) : (
        <PenyesuaianOpnameRiwayat arah={arah} dalamKartu />
      )}

      {/* --- Modal detail ---------------------------------------------------- */}
      {lihat && (
        <Modal
          judul={`Dokumen ${lihat.dokumen.no_dokumen}`}
          lebar="lebar"
          onTutup={() => setLihat(null)}
          aksi={
            <>
              {lihat.dokumen.status === 'disahkan' && (
                <button
                  type="button"
                  className="tombol tombol--bahaya"
                  onClick={() => {
                    const ids = [lihat.dokumen.id];
                    const nama = [lihat.dokumen.no_dokumen];
                    setLihat(null);
                    setKonfirmasi({ ids, nama, alasan: '' });
                  }}
                >
                  Batalkan dokumen
                </button>
              )}
              <button type="button" className="tombol tombol--netral" onClick={() => setLihat(null)}>
                Tutup
              </button>
            </>
          }
        >
          <div className="sub-detail__kop">
            <div>
              <span>Tanggal</span>
              <strong>{formatTanggal(lihat.dokumen.tanggal)}</strong>
            </div>
            <div>
              <span>Gudang</span>
              <strong>{[lihat.dokumen.gudang_kode, lihat.dokumen.gudang_nama].filter(Boolean).join(' — ')}</strong>
            </div>
            <div>
              <span>Alasan</span>
              <strong>{lihat.dokumen.alasan_label}</strong>
            </div>
            <div>
              <span>Keterangan</span>
              <strong>{lihat.dokumen.keterangan || '—'}</strong>
            </div>
            <div>
              <span>Total</span>
              <strong>
                {formatAngka(lihat.dokumen.total_qty)} qty · {lihat.dokumen.jumlah_item} barang
              </strong>
            </div>
            <div>
              <span>Status</span>
              <strong>
                <span className={`lencana ${lihat.dokumen.status === 'batal' ? 'lencana--bahaya' : 'lencana--aktif'}`}>
                  {lihat.dokumen.status_label}
                </span>
              </strong>
            </div>
            {lihat.dokumen.status === 'batal' && (
              <div>
                <span>Dibatalkan</span>
                <strong>
                  {formatTanggalWaktu(lihat.dokumen.dibatalkan_pada)}
                  {lihat.dokumen.alasan_batal ? ` — ${lihat.dokumen.alasan_batal}` : ''}
                </strong>
              </div>
            )}
          </div>
          <div className="tabel-bungkus">
            <table className="tabel">
              <thead>
                <tr>
                  <th>Kode Item</th>
                  <th>Nama</th>
                  <th className="num">Qty</th>
                  <th>Satuan</th>
                  <th className="num">Stok Sebelum</th>
                  <th className="num">Stok Sesudah</th>
                </tr>
              </thead>
              <tbody>
                {lihat.item.map((it) => (
                  <tr key={it.id}>
                    <td className="sub-td-nomor">{it.kode_item ?? '—'}</td>
                    <td className="sub-td-nama">{it.nama}</td>
                    <td className="num">{formatAngka(it.qty)}</td>
                    <td>{it.satuan ?? '—'}</td>
                    <td className="num">{formatAngka(it.stok_sebelum)}</td>
                    <td className="num">{formatAngka(it.stok_sesudah)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {/* --- Modal konfirmasi batalkan --------------------------------------- */}
      {konfirmasi && (
        <Modal
          judul="Batalkan Dokumen?"
          lebar="kecil"
          onTutup={() => setKonfirmasi(null)}
          sedangKirim={sedangBatal}
          aksi={
            <>
              <button
                type="button"
                className="tombol tombol--netral"
                onClick={() => setKonfirmasi(null)}
                disabled={sedangBatal}
              >
                Kembali
              </button>
              <button
                type="button"
                className="tombol tombol--bahaya"
                onClick={() => void batalkanTerpilih()}
                disabled={sedangBatal}
              >
                {sedangBatal ? 'Membatalkan…' : `Batalkan ${konfirmasi.ids.length} dokumen`}
              </button>
            </>
          }
        >
          <p>
            <strong>{konfirmasi.ids.length}</strong> dokumen akan dibatalkan. Stok barang{' '}
            <strong>dikembalikan otomatis</strong>; dokumen tetap tersimpan dengan status
            Dibatalkan (tidak dihapus permanen).
          </p>
          <ul className="daftar-error">
            {konfirmasi.nama.slice(0, 5).map((n) => (
              <li key={n}>{n}</li>
            ))}
            {konfirmasi.ids.length > konfirmasi.nama.slice(0, 5).length && (
              <li>… dan {konfirmasi.ids.length - konfirmasi.nama.slice(0, 5).length} lainnya</li>
            )}
          </ul>
          <label className="bidang" style={{ marginTop: 10 }}>
            <span>Alasan pembatalan (opsional)</span>
            <input
              value={konfirmasi.alasan}
              onChange={(e) => setKonfirmasi({ ...konfirmasi, alasan: e.target.value })}
              placeholder="mis. salah input"
              maxLength={255}
              disabled={sedangBatal}
            />
          </label>
        </Modal>
      )}

      {/* --- Modal hasil impor ------------------------------------------------ */}
      {hasilImpor && (
        <Modal
          judul="Hasil Impor Excel"
          lebar={hasilImpor.baris_error > 0 ? 'lebar' : 'kecil'}
          onTutup={() => setHasilImpor(null)}
          aksi={
            <button type="button" className="tombol tombol--primer" onClick={() => setHasilImpor(null)}>
              Tutup
            </button>
          }
        >
          <p>
            <strong className="teks-sukses">{formatAngka(hasilImpor.baris_valid)} baris valid</strong>
            {' · '}
            <strong>{formatAngka(hasilImpor.dokumen_dibuat)} dokumen dibuat</strong>
            {hasilImpor.baris_error > 0 && (
              <>
                {' · '}
                <strong className="teks-galat">{formatAngka(hasilImpor.baris_error)} kesalahan</strong>
              </>
            )}
          </p>
          <p className="teks-redup teks-kecil">
            Total baris dibaca: {formatAngka(hasilImpor.total_baris)}.
            {hasilImpor.baris_error > 0 &&
              ' Baris berkesalahan tidak diimpor; kelompok dengan stok tidak mencukupi dilewati seluruhnya.'}
          </p>
          {hasilImpor.ringkasan && hasilImpor.ringkasan.length > 0 && hasilImpor.baris_error > 0 && (
            <p className="teks-kecil">
              Alasan terbanyak: <strong>“{hasilImpor.ringkasan[0].alasan}”</strong> ({hasilImpor.ringkasan[0].jumlah} baris)
            </p>
          )}
          {hasilImpor.errors.length > 0 && (
            <div className="sub-daftar-error">
              {hasilImpor.errors.slice(0, 50).map((er, i) => (
                <div key={i}>
                  <b>Baris {er.nomor_baris}{er.kolom ? ` · ${er.kolom}` : ''}{er.nilai ? ` · nilai: ${er.nilai}` : ''}</b>
                  <span>{er.pesan}</span>
                </div>
              ))}
              {hasilImpor.errors.length > 50 && (
                <div>
                  <b>… {hasilImpor.errors.length - 50} kesalahan lain</b>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
    </section>
    </div>
  );
}

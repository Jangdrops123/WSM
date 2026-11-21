import { useCallback, useEffect, useRef, useState } from 'react';
import { beritahu } from '../../components/crud/Toast';
import { Modal } from '../../components/crud/Modal';
import { IconButton } from '../../components/IconButton';
import { TombolScan } from '../../components/ScanKamera';
import { ambilOpsi, apiDelete, apiGet, apiPost, apiPut, unduhExcel } from '../../lib/api';
import { useSegarkanModul } from '../../lib/segarkan';
import './pengaturan.css';

type SizeBaris = { size: string; jatah: number };

type Profil = {
  id: number;
  kode: string;
  nama: string;
  pasang_per_kodi: number;
  kata_kunci: string[];
  bawaan: boolean;
  sizes: SizeBaris[];
  default?: boolean;
};

type Draft = { nama: string; pasang_per_kodi: number; kata: string; sizes: SizeBaris[] };

/** Data Klasifikasi Barang (AF2) — GET /api/profil-size/klasifikasi */
type Usulan = { id: number; nama: string; kode: string; dasar: string } | null;
type KlasProfil = {
  id: number;
  kode: string;
  nama: string;
  pasang_per_kodi: number;
  sizes: SizeBaris[];
  jumlah_kategori: number;
  jumlah_produk: number;
};
type KlasKategori = {
  id: number;
  nama: string;
  profil_id: number | null;
  profil_nama: string | null;
  jumlah_produk: number;
  usulan: Usulan;
};
type KlasProduk = { id: number; nama: string; kategori: string | null; usulan: Usulan };
type Klasifikasi = {
  profil: KlasProfil[];
  kategori: KlasKategori[];
  belum_produk: KlasProduk[];
  ringkasan: {
    produk_per_profil: { nama: string; jumlah: number }[];
    kategori_tanpa_profil: number;
    produk_tanpa_profil: number;
    produk_dikoreksi: number;
  };
};

type KonfirmPindah = {
  kategori_id: number;
  nama: string;
  profil_id: number | null;
  profil_nama: string;
  ikut: number;
  dioverride: number;
};

// --- AG10 — tab Aturan Chatbot (Operator, Alias, Ambang) --------------------
type TabAturan = 'profil' | 'klasifikasi' | 'operator' | 'alias' | 'ambang';

type Operator = { id: number; label: string; pengali: number; kata_kunci: string[]; aktif: boolean };

type AliasBaris = {
  id: number;
  teks: string;
  product_id: number | null;
  grup: string | null;
  supplier_id: number | null;
  pakai: number;
  terakhir_pakai: string;
  produk_nama: string | null;
  pemasok_nama: string | null;
};

/** AG10 — tab Pengaturan ▸ Aturan Kode (Chatbot). */
const TAB_ATURAN: [TabAturan, string][] = [
  ['profil', 'Profil Size'],
  ['klasifikasi', 'Klasifikasi Barang'],
  ['operator', 'Operator Db/Tp'],
  ['alias', 'Alias Barang'],
  ['ambang', 'Ambang Kecocokan'],
];

const BAWAAN_SIZES: SizeBaris[] = [
  { size: '39', jatah: 4 },
  { size: '40', jatah: 4 },
  { size: '41', jatah: 4 },
  { size: '42', jatah: 4 },
  { size: '43', jatah: 4 },
];

/** Daftar size → "39-43" bila berurutan, selain itu "37, 38, …". */
const rentangSize = (sizes: SizeBaris[]): string => {
  const angka = sizes.map((s) => s.size.trim());
  if (angka.length > 1 && angka.every((s) => /^\d+$/.test(s))) {
    const urut = [...angka].map(Number).sort((a, b) => a - b);
    if (urut.every((n, i) => i === 0 || n === urut[i - 1] + 1)) return `${urut[0]}-${urut[urut.length - 1]}`;
  }
  return angka.join(', ');
};

const draftDari = (p: Profil): Draft => ({
  nama: p.nama,
  pasang_per_kodi: p.pasang_per_kodi,
  kata: p.kata_kunci.join(', '),
  sizes: p.sizes.map((s) => ({ ...s })),
});

const sama = (a: number[], b: number[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * PENGATURAN > ATURAN KODI (X5.4) — dua kolom: daftar Profil Size di kiri,
 * editor profil di kanan. Setiap profil membawa daftar size + jatah pasang per
 * size (total wajib = jumlah pasang per kodi), kata kunci resolusi chatbot,
 * penetapan kategori/merek, dan contoh dinamis. Parser Chatbot memakai profil:
 * produk > kategori/merek > kata kunci > profil default.
 */
export function AturanKodiPage() {
  const [daftar, setDaftar] = useState<Profil[]>([]);
  const [pilihId, setPilihId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [sizeBaru, setSizeBaru] = useState('');
  const [contohKodi, setContohKodi] = useState(6);
  const [hapusKonfirm, setHapusKonfirm] = useState<number | null>(null);
  const [opsiKategori, setOpsiKategori] = useState<{ id: number; label: string }[]>([]);
  const [opsiMerek, setOpsiMerek] = useState<{ id: number; label: string }[]>([]);
  const [katTerpilih, setKatTerpilih] = useState<number[]>([]);
  const [merekTerpilih, setMerekTerpilih] = useState<number[]>([]);
  const [katAsli, setKatAsli] = useState<number[]>([]);
  const [merekAsli, setMerekAsli] = useState<number[]>([]);
  const pilihRef = useRef<number | null>(null);
  // --- Klasifikasi Barang (AF2/AF6) ---------------------------------------
  const [klas, setKlas] = useState<Klasifikasi | null>(null);
  const [konfirm, setKonfirm] = useState<KonfirmPindah | null>(null);
  const [sibukKlas, setSibukKlas] = useState(false);

  // --- AG10 — tab & data tab lain ------------------------------------------
  const [tab, setTab] = useState<TabAturan>('profil');

  const [operators, setOperators] = useState<Operator[]>([]);
  const [opDraft, setOpDraft] = useState<Record<number, { pengali: string; kata: string; aktif: boolean }>>({});
  const [opBaru, setOpBaru] = useState({ label: '', pengali: '2', kata: '' });
  const [sibukOp, setSibukOp] = useState(false);

  const [aliases, setAliases] = useState<AliasBaris[]>([]);
  const [aliasCari, setAliasCari] = useState('');
  const [aliasEdit, setAliasEdit] = useState<AliasBaris | null>(null);
  const [aliasDraft, setAliasDraft] = useState({
    teks: '',
    product_id: '',
    cariProduk: '',
    hasilProduk: [] as { id: number; nama: string }[],
  });
  const [sibukAlias, setSibukAlias] = useState(false);

  const [ambang, setAmbang] = useState({ yakin: 85, selisih: 10, kabur: 60 });
  const [sibukAmbang, setSibukAmbang] = useState(false);

  const muat = useCallback(async () => {
    try {
      const r = await apiGet<{ data: Profil[] }>('/api/profil-size');
      setDaftar(r.data);
      setPilihId((id) => (id && r.data.some((p) => p.id === id) ? id : (r.data.find((p) => p.default)?.id ?? r.data[0]?.id ?? null)));
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    }
  }, []);

  const muatKlasifikasi = useCallback(async () => {
    try {
      setKlas(await apiGet<Klasifikasi>('/api/profil-size/klasifikasi'));
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    }
  }, []);

  useEffect(() => {
    void muat();
    void muatKlasifikasi();
    ambilOpsi('kategori').then(setOpsiKategori).catch(() => setOpsiKategori([]));
    ambilOpsi('merek').then(setOpsiMerek).catch(() => setOpsiMerek([]));
  }, [muat, muatKlasifikasi]);
  // Tombol Refresh global di topbar: muat ulang profil, klasifikasi & tab aturan.
  useSegarkanModul(() => {
    void muat();
    void muatKlasifikasi();
    void muatOperator();
    void muatAmbang();
  });

  // --- AG10 — pemuat & aksi tab Operator / Alias / Ambang / Uji Coba --------
  const muatOperator = useCallback(async () => {
    try {
      const r = await apiGet<{ data: Operator[] }>('/api/chat-aturan/operator');
      const d = r.data ?? [];
      setOperators(d);
      setOpDraft(
        Object.fromEntries(d.map((o) => [o.id, { pengali: String(o.pengali), kata: o.kata_kunci.join(', '), aktif: o.aktif }])),
      );
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    }
  }, []);

  const muatAlias = useCallback(async (cari?: string) => {
    try {
      const r = await apiGet<{ data: AliasBaris[] }>(
        `/api/chat-aturan/alias${cari ? `?cari=${encodeURIComponent(cari)}` : ''}`,
      );
      setAliases(r.data ?? []);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    }
  }, []);

  const muatAmbang = useCallback(async () => {
    try {
      const r = await apiGet<{ data: { yakin: number; selisih: number; kabur: number } }>('/api/chat-aturan/ambang');
      setAmbang(r.data);
    } catch {
      /* ambang bawaan */
    }
  }, []);

  useEffect(() => {
    if (tab === 'operator') void muatOperator();
    if (tab === 'alias') void muatAlias();
    if (tab === 'ambang') void muatAmbang();
  }, [tab, muatOperator, muatAlias, muatAmbang]);

  const simpanOperator = async (id: number) => {
    const d = opDraft[id];
    const op = operators.find((o) => o.id === id);
    if (!d || !op) return;
    setSibukOp(true);
    try {
      await apiPut(`/api/chat-aturan/operator/${id}`, {
        label: op.label,
        pengali: Number(d.pengali),
        kata_kunci: d.kata.split(',').map((k) => k.trim()).filter(Boolean),
        aktif: d.aktif,
      });
      beritahu(`Operator ${op.label} disimpan — perubahan dicatat di log aktivitas.`);
      await muatOperator();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibukOp(false);
    }
  };

  const tambahOperator = async () => {
    if (!opBaru.label.trim()) {
      beritahu('Label operator wajib diisi.', 'galat');
      return;
    }
    setSibukOp(true);
    try {
      await apiPost('/api/chat-aturan/operator', {
        label: opBaru.label.trim(),
        pengali: Number(opBaru.pengali) || 0,
        kata_kunci: opBaru.kata.split(',').map((k) => k.trim()).filter(Boolean),
      });
      setOpBaru({ label: '', pengali: '2', kata: '' });
      beritahu('Operator ditambahkan.');
      await muatOperator();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibukOp(false);
    }
  };

  const hapusOperator = async (o: Operator) => {
    setSibukOp(true);
    try {
      await apiDelete(`/api/chat-aturan/operator/${o.id}`);
      beritahu(`Operator ${o.label} dihapus.`);
      await muatOperator();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibukOp(false);
    }
  };

  const bukaAliasEdit = (a: AliasBaris) => {
    setAliasEdit(a);
    setAliasDraft({
      teks: a.teks,
      product_id: a.product_id ? String(a.product_id) : '',
      cariProduk: a.produk_nama ?? '',
      hasilProduk: [],
    });
  };

  const cariProdukAlias = async (q: string) => {
    setAliasDraft((d) => ({ ...d, cariProduk: q }));
    if (q.trim().length < 2) {
      setAliasDraft((d) => ({ ...d, hasilProduk: [] }));
      return;
    }
    try {
      const r = await apiGet<{ data: { id: number; nama: string; sku: string }[] }>(
        `/api/master/produk?cari=${encodeURIComponent(q)}&per=8`,
      );
      setAliasDraft((d) => ({
        ...d,
        hasilProduk: (r.data ?? []).map((p) => ({ id: Number(p.id), nama: `${p.sku} — ${p.nama}` })),
      }));
    } catch {
      /* pencarian gagal → diam */
    }
  };

  const simpanAliasEdit = async () => {
    if (!aliasEdit) return;
    setSibukAlias(true);
    try {
      await apiPut(`/api/chat-aturan/alias/${aliasEdit.id}`, {
        teks: aliasDraft.teks,
        ...(aliasDraft.product_id ? { product_id: Number(aliasDraft.product_id) } : {}),
      });
      beritahu('Alias disimpan.');
      setAliasEdit(null);
      await muatAlias(aliasCari);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibukAlias(false);
    }
  };

  const hapusAlias = async (id: number) => {
    setSibukAlias(true);
    try {
      await apiDelete(`/api/chat-aturan/alias/${id}`);
      beritahu('Alias dihapus.');
      setAliasEdit(null);
      await muatAlias(aliasCari);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibukAlias(false);
    }
  };

  /** Impor alias dari Excel — kolom: Teks Alias, Produk, Grup, Pemasok. */
  const imporAliasFile = async (file: File) => {
    setSibukAlias(true);
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result ?? ''));
        fr.onerror = () => reject(new Error('Berkas gagal dibaca.'));
        fr.readAsDataURL(file);
      });
      const r = await apiPost<{ masuk: number; dilewat: number; contoh_galat: string[] }>(
        '/api/chat-aturan/alias/impor',
        { data_base64: dataBase64 },
      );
      beritahu(`Impor alias: ${r.masuk} masuk, ${r.dilewat} dilewat.`);
      if (r.contoh_galat?.length) beritahu(r.contoh_galat.join(' · '), 'info');
      await muatAlias();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibukAlias(false);
    }
  };

  const simpanAmbang = async () => {
    setSibukAmbang(true);
    try {
      const r = await apiPut<{ data: { yakin: number; selisih: number; kabur: number } }>('/api/chat-aturan/ambang', ambang);
      setAmbang(r.data ?? ambang);
      beritahu('Ambang kecocokan disimpan — keputusan pencocokan memakai nilai baru.');
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibukAmbang(false);
    }
  };

  const profil = daftar.find((p) => p.id === pilihId) ?? null;

  // Sinkronkan draft & penetapan saat pilihan berubah; muat ulang dari server
  // setelah simpan (bila tidak ada edit yang belum disimpan).
  useEffect(() => {
    const ganti = pilihRef.current !== pilihId;
    pilihRef.current = pilihId;
    const p = daftar.find((x) => x.id === pilihId);
    if (!p) {
      setDraft(null);
      setKatTerpilih([]);
      setMerekTerpilih([]);
      setKatAsli([]);
      setMerekAsli([]);
      return;
    }
    const kotorSaatIni = !!(
      draft &&
      JSON.stringify(draft) !== JSON.stringify(draftDari(p))
    );
    if (ganti || !kotorSaatIni) setDraft(draftDari(p));
    if (ganti) {
      apiGet<{ kategori_ids: number[]; merek_ids: number[] }>(`/api/profil-size/${p.id}/penetapan`)
        .then((r) => {
          setKatTerpilih(r.kategori_ids);
          setMerekTerpilih(r.merek_ids);
          setKatAsli(r.kategori_ids);
          setMerekAsli(r.merek_ids);
        })
        .catch((e: Error) => beritahu(e.message, 'galat'));
      setHapusKonfirm(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pilihId, daftar, draft]);

  const totalJatah = draft?.sizes.reduce((n, s) => n + (Number(s.jatah) || 0), 0) ?? 0;
  const cocok = !!draft && draft.sizes.length > 0 && totalJatah === Number(draft.pasang_per_kodi);
  const selisih = totalJatah - Number(draft?.pasang_per_kodi ?? 0);

  const ubah = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const tambahSize = () => {
    const u = sizeBaru.trim();
    if (!u) return beritahu('Isi size baru (mis. 44 atau XL).', 'galat');
    if (u.length > 20) return beritahu('Size maksimal 20 karakter.', 'galat');
    if (draft?.sizes.some((s) => s.size.toLowerCase() === u.toLowerCase())) return beritahu(`Size "${u}" sudah ada.`, 'galat');
    ubah({ sizes: [...(draft?.sizes ?? []), { size: u, jatah: 0 }] });
    setSizeBaru('');
  };

  /** Bagi rata pasang per kodi ke semua size — sisa ke size tengah (X5.1). */
  const bagiRata = () => {
    if (!draft || draft.sizes.length === 0) return;
    const total = Number(draft.pasang_per_kodi);
    const n = draft.sizes.length;
    const dasar = Math.floor(total / n);
    const sisa = total - dasar * n;
    const sizes = draft.sizes.map((s) => ({ ...s, jatah: dasar }));
    for (let k = 0; k < sisa; k++) {
      const i = n >= 3 ? Math.round(Math.floor(n / 2) - (sisa - 1) / 2 + k) : k % n;
      const idx = Math.min(n - 1, Math.max(0, i));
      sizes[idx].jatah += 1;
    }
    ubah({ sizes });
    if (sisa > 0) {
      beritahu(
        `${total} tidak habis dibagi ${n} size — dasar ${dasar}, sisa ${sisa} diberikan ke size di tengah. Periksa sebelum menyimpan.`,
        'info',
        6000,
      );
    }
  };

  const simpan = async () => {
    if (!draft || !pilihId) return;
    const nama = draft.nama.trim();
    if (!nama) return beritahu('Nama profil wajib diisi.', 'galat');
    if (draft.sizes.length === 0) return beritahu('Profil minimal berisi satu size.', 'galat');
    if (!Number.isInteger(Number(draft.pasang_per_kodi)) || Number(draft.pasang_per_kodi) < 1) {
      return beritahu('Jumlah pasang per kodi harus bilangan bulat lebih dari 0.', 'galat');
    }
    if (!cocok) {
      return beritahu(
        `Total jatah semua size (${totalJatah}) belum sama dengan jumlah pasang per kodi (${draft.pasang_per_kodi}). Selisih: ${selisih}.`,
        'galat',
      );
    }
    setSibuk(true);
    try {
      await apiPut(`/api/profil-size/${pilihId}`, {
        nama,
        pasang_per_kodi: Number(draft.pasang_per_kodi),
        kata_kunci: draft.kata.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
        sizes: draft.sizes.map((s) => ({ size: s.size.trim(), jatah: Number(s.jatah) })),
      });
      beritahu('Profil disimpan — parser Chatbot memakainya sejak sekarang.');
      await muat();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibuk(false);
    }
  };

  const tambahProfil = async () => {
    setSibuk(true);
    try {
      const r = await apiPost<Profil>('/api/profil-size', {
        nama: 'Profil Baru',
        pasang_per_kodi: 20,
        kata_kunci: [],
        sizes: BAWAAN_SIZES.map((s) => ({ ...s })),
      });
      beritahu('Profil baru dibuat — ubah nama, size, dan jatahnya lalu Simpan.');
      await muat();
      setPilihId(r.id);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibuk(false);
    }
  };

  const duplikat = async () => {
    if (!pilihId) return;
    setSibuk(true);
    try {
      const r = await apiPost<Profil>(`/api/profil-size/${pilihId}/duplikat`, {});
      beritahu('Profil diduplikat.');
      await muat();
      setPilihId(r.id);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibuk(false);
    }
  };

  const jadikanDefault = async () => {
    if (!pilihId) return;
    setSibuk(true);
    try {
      await apiPut(`/api/profil-size/${pilihId}/default`, {});
      beritahu('Profil default diperbarui — dipakai baris “Total = …” & baris tanpa profil.');
      await muat();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibuk(false);
    }
  };

  const hapus = async () => {
    if (!pilihId) return;
    setSibuk(true);
    try {
      await apiDelete(`/api/profil-size/${pilihId}`);
      beritahu('Profil dihapus — produk/kategorinya kembali ke resolusi otomatis.');
      setHapusKonfirm(null);
      await muat();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibuk(false);
    }
  };

  const penetapanKotor = !sama(katTerpilih, katAsli) || !sama(merekTerpilih, merekAsli);
  const terapkanPenetapan = async () => {
    if (!pilihId) return;
    setSibuk(true);
    try {
      const r = await apiPut<{ kategori_ids: number[]; merek_ids: number[] }>(`/api/profil-size/${pilihId}/terapkan`, {
        kategori_ids: katTerpilih,
        merek_ids: merekTerpilih,
      });
      setKatAsli(r.kategori_ids);
      setMerekAsli(r.merek_ids);
      beritahu('Penetapan kategori/merek diterapkan.');
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibuk(false);
    }
  };

  const ukuranContoh = draft?.sizes ?? [];
  const half = Math.max(1, Math.floor(contohKodi / 2));
  const tp = ukuranContoh[0];
  const db = ukuranContoh[ukuranContoh.length - 1];

  // ===== Klasifikasi Barang (AF2/AF6) ======================================
  /** Minta konfirmasi pindah/lepas profil kategori — sertakan jumlah terdampak. */
  const mintaPindah = async (k: { id: number; nama: string }, profilId: number | null, profilNama: string) => {
    try {
      const t = await apiGet<{ ikut: number; dioverride: number }>(
        `/api/profil-size/terdampak?kategori_id=${k.id}`,
      );
      setKonfirm({ kategori_id: k.id, nama: k.nama, profil_id: profilId, profil_nama: profilNama, ikut: t.ikut, dioverride: t.dioverride });
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    }
  };

  const konfirmPindah = async () => {
    if (!konfirm) return;
    setSibukKlas(true);
    try {
      await apiPost('/api/profil-size/koreksi', {
        tipe: 'kategori',
        id: konfirm.kategori_id,
        profil_id: konfirm.profil_id,
      });
      beritahu(
        `Kategori “${konfirm.nama}” → ${konfirm.profil_nama}.` +
          (konfirm.ikut ? ` ${konfirm.ikut} produk ikut kategori langsung mengikuti; ${konfirm.dioverride} produk dengan override sendiri tidak berubah.` : ''),
      );
      setKonfirm(null);
      await muatKlasifikasi();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibukKlas(false);
    }
  };

  const buatKategoriCepat = async () => {
    setSibukKlas(true);
    try {
      const r = await apiPost<{ dibuat: { nama: string }[]; terpasang: { nama: string }[]; dilewat: string[] }>(
        '/api/profil-size/kategori-cepat',
        {},
      );
      beritahu(
        `Kategori cepat: ${r.dibuat.length} baru, ${r.terpasang.length} dipasang profilnya, ${r.dilewat.length} dilewat.`,
      );
      await Promise.all([muatKlasifikasi(), ambilOpsi('kategori').then(setOpsiKategori).catch(() => undefined)]);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibukKlas(false);
    }
  };

  const terapkanUsulanProduk = async (p: KlasProduk, usulan: NonNullable<Usulan>) => {
    setSibukKlas(true);
    try {
      await apiPost('/api/profil-size/koreksi', { tipe: 'produk', id: p.id, profil_id: usulan.id });
      beritahu(`Produk “${p.nama}” diklasifikasi ke ${usulan.nama} (override produk).`);
      await muatKlasifikasi();
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibukKlas(false);
    }
  };

  /** Kartu klasifikasi per kelompok (Pria / Wanita). */
  const kartuKlas = (kata: 'Pria' | 'Wanita') => {
    const semuaProfil = klas?.profil ?? [];
    const diKelompok = semuaProfil.filter((p) => new RegExp(`\\b${kata.toLowerCase()}\\b`, 'i').test(p.nama));
    const utama = diKelompok.find((p) => p.kode.startsWith('sepatu-')) ?? diKelompok[0];
    const idSet = new Set(diKelompok.map((p) => p.id));
    const kategoriKelompok = (klas?.kategori ?? []).filter((k) => k.profil_id !== null && idSet.has(k.profil_id));
    const kategoriLain = (klas?.kategori ?? []).filter((k) => k.profil_id === null || !idSet.has(k.profil_id));
    const rentang = utama ? rentangSize(utama.sizes) : '—';
    const jumlahProduk = diKelompok.reduce((n, p) => n + p.jumlah_produk, 0);
    return (
      <div key={kata} className="klasifikasi-kartu">
        <div className="klasifikasi-kartu__kepala kartu__kepala--kompak">
          <strong>{kata} ({utama ? utama.sizes.length : 0} size: {rentang})</strong>
          <span className="lencana lencana--aktif">{jumlahProduk} produk</span>
        </div>
        {kategoriKelompok.length === 0 ? (
          <p className="teks-redup teks-kecil">Belum ada kategori — pakai “+ Tambah kategori”.</p>
        ) : (
          <ul className="klasifikasi-daftar">
            {kategoriKelompok.map((k) => (
              <li key={k.id}>
                <span>{k.nama}</span>
                <span className="teks-redup teks-kecil">{k.jumlah_produk} produk</span>
                <button
                  type="button"
                  className="tautan-kecil"
                  onClick={() => void mintaPindah(k, null, 'belum diklasifikasi')}
                  disabled={sibukKlas}
                >
                  lepas
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="aturan-ubah" style={{ marginTop: 8 }}>
          <select
            value=""
            aria-label={`Tambah kategori ke ${kata}`}
            onChange={(e) => {
              const id = Number(e.target.value);
              if (!id) return;
              const k = kategoriLain.find((x) => x.id === id);
              e.target.value = '';
              if (!k || !utama) return;
              void mintaPindah(k, utama.id, utama.nama);
            }}
          >
            <option value="">+ Tambah kategori…</option>
            {kategoriLain.map((k) => (
              <option key={k.id} value={k.id}>
                {k.nama} ({k.jumlah_produk} produk)
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  };

  const kategoriPerlu = (klas?.kategori ?? []).filter((k) => k.profil_id === null);
  const jumlahPerlu = kategoriPerlu.length + (klas?.belum_produk.length ?? 0);

  return (
    <div className="halaman">
      <nav className="tab-aturan" aria-label="Bagian Aturan Chatbot">
        {TAB_ATURAN.map(([k, l]) => (
          <button
            key={k}
            type="button"
            className={`tab-aturan__tombol${tab === k ? ' aktif' : ''}`}
            aria-current={tab === k ? 'page' : undefined}
            onClick={() => setTab(k)}
          >
            {l}
          </button>
        ))}
      </nav>

      {tab === 'profil' && (
      <section className="kartu">
        <div className="kartu__kepala kartu__kepala--kompak">
          <div>
            <h3>Aturan kodi — Profil Size (mode Chatbot)</h3>
            <p className="teks-redup teks-kecil">
              Satu profil = daftar size + jatah pasang per size; total jatah wajib sama dengan jumlah pasang per kodi.
              Parser Chatbot memakai profil per baris: produk &rarr; kategori/merek &rarr; kata kunci &rarr; profil
              default — termasuk komposisi “(3kd db 42 tp 39)”.
            </p>
          </div>
          <button type="button" className="tombol tombol--primer" onClick={() => void simpan()} disabled={sibuk || !draft}>
            {sibuk ? 'Menyimpan…' : 'Simpan profil'}
          </button>
        </div>

        <div className="aturan-kolum">
          {/* --- Kolom kiri: daftar profil ---------------------------------- */}
          <div className="aturan-kiri">
            <div className="aturan-ubah" style={{ marginTop: 0, justifyContent: 'space-between' }}>
              <strong>Daftar profil</strong>
              <button type="button" className="tombol tombol--kecil tombol--netral" onClick={() => void tambahProfil()} disabled={sibuk}>
                + Profil
              </button>
            </div>
            {daftar.length === 0 ? (
              <p className="teks-redup teks-kecil">Belum ada profil — klik “+ Profil”.</p>
            ) : (
              <ul className="profil-daftar">
                {daftar.map((p) => (
                  <li key={p.id} className={`profil-item ${p.id === pilihId ? 'aktif' : ''}`}>
                    <button type="button" className="profil-pilih" onClick={() => setPilihId(p.id)}>
                      <strong>{p.nama}</strong>
                      <span className="profil-meta">
                        {p.sizes.length} size · {p.pasang_per_kodi} pasang/kodi
                        {p.default ? ' · default' : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="teks-redup teks-kecil" style={{ marginTop: 8 }}>
              Profil default dipakai untuk baris “Total = …” dan baris tanpa produk/kata kunci.
            </p>
          </div>

          {/* --- Kolom kanan: editor profil --------------------------------- */}
          {draft && profil ? (
            <div className="aturan-kanan">
              <div className="aturan-ubah" style={{ marginTop: 0 }}>
                <span>Nama profil</span>
                <input
                  value={draft.nama}
                  onChange={(e) => ubah({ nama: e.target.value })}
                  maxLength={60}
                  aria-label="Nama profil"
                  style={{ flex: '1 1 180px', font: 'inherit', padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 8 }}
                />
                {profil.default && <span className="lencana lencana--aktif">Default</span>}
              </div>

              <div className="aturan-ubah">
                <span>Jumlah pasang per kodi</span>
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={draft.pasang_per_kodi}
                  onChange={(e) => ubah({ pasang_per_kodi: Number(e.target.value) })}
                  aria-label="Jumlah pasang per kodi"
                />
                <span className="teks-redup teks-kecil">1 kodi = {draft.pasang_per_kodi} pasang</span>
              </div>

              <div className="aturan-ubah">
                <span>Kata kunci chat</span>
                <input
                  value={draft.kata}
                  onChange={(e) => ubah({ kata: e.target.value })}
                  placeholder="mis. sandal wanita, cwe, kids"
                  aria-label="Kata kunci chat"
                  style={{ flex: '1 1 200px', font: 'inherit', padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 8 }}
                />
                <span className="teks-redup teks-kecil">dipisah koma — dipakai bila baris tidak cocok ke produk</span>
              </div>

              <table className="aturan-tabel">
                <thead>
                  <tr>
                    <th>Size</th>
                    <th>Jatah pasang per kodi</th>
                    <th>Kodi contoh ({contohKodi} kd)</th>
                    <th style={{ width: 60 }} />
                  </tr>
                </thead>
                <tbody>
                  {draft.sizes.map((s, i) => (
                    <tr key={`${s.size}-${i}`}>
                      <td>
                        <input
                          value={s.size}
                          maxLength={20}
                          aria-label={`Size baris ${i + 1}`}
                          onChange={(e) => {
                            const sizes = [...draft.sizes];
                            sizes[i] = { ...s, size: e.target.value };
                            ubah({ sizes });
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          value={s.jatah}
                          aria-label={`Jatah size ${s.size}`}
                          onChange={(e) => {
                            const sizes = [...draft.sizes];
                            sizes[i] = { ...s, jatah: Number(e.target.value) };
                            ubah({ sizes });
                          }}
                        />
                      </td>
                      <td className="teks-redup">
                        {s.size || '—'}: {(Number(s.jatah) || 0) * contohKodi} pasang ({contohKodi} kd)
                      </td>
                      <td className="rata-tengah">
                        <IconButton
                          label={`Hapus size ${s.size}`}
                          ikon="trash"
                          warna="bahaya"
                          onClick={() => ubah({ sizes: draft.sizes.filter((_, j) => j !== i) })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="aturan-ubah">
                <input
                  type="text"
                  value={sizeBaru}
                  onChange={(e) => setSizeBaru(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      tambahSize();
                    }
                  }}
                  placeholder="size baru (mis. 44 / XL)"
                  aria-label="Tambah size"
                  style={{ font: 'inherit', padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 8 }}
                />
                <button type="button" className="tombol tombol--kecil" onClick={tambahSize}>
                  + Tambah size
                </button>
                <button type="button" className="tombol tombol--kecil" onClick={bagiRata} title="Bagi rata pasang per kodi ke semua size">
                  Bagi rata
                </button>
                <button
                  type="button"
                  className="tombol tombol--kecil"
                  onClick={() => ubah({ sizes: BAWAAN_SIZES.map((s) => ({ ...s })), pasang_per_kodi: 20 })}
                  title="Kembalikan ke aturan bawaan (39–43 × 4)"
                >
                  Kembalikan bawaan
                </button>
                <span className="teks-redup teks-kecil">
                  contoh kodi:{' '}
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={contohKodi}
                    onChange={(e) => setContohKodi(Math.max(1, Number(e.target.value) || 1))}
                    aria-label="Jumlah kodi contoh"
                    style={{ width: 64, font: 'inherit', padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 8 }}
                  />
                </span>
              </div>

              <div className={`aturan-ringkas ${cocok ? 'aturan-ringkas--benar' : 'aturan-ringkas--salah'}`}>
                {cocok ? '✔' : '⚠'} Total jatah per size = <b>{totalJatah}</b> pasang dari {draft.pasang_per_kodi} pasang
                per kodi
                {!cocok && draft.sizes.length > 0 && (
                  <>
                    {' '}
                    — selisih <b>{selisih > 0 ? `+${selisih}` : selisih}</b>.
                  </>
                )}
                {cocok && ukuranContoh.length > 0 && (
                  <div className="teks-redup teks-kecil" style={{ marginTop: 4 }}>
                    Contoh: “barang A — {contohKodi} kd” → {ukuranContoh.map((s) => `${s.size || '-'}: ${s.jatah * contohKodi}`).join(' · ')}.
                    {ukuranContoh.length >= 2 && tp && db && (
                      <>
                        {' '}
                        “({half}kd db {db.size} tp {tp.size})” → {db.size} jadi {(db.jatah + tp.jatah) * half} pasang/kodi,{' '}
                        {tp.size} jadi 0.
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Penetapan kategori/merek (X5.2 — tingkat resolusi kedua) */}
              <div className="panel-kepala" style={{ marginTop: 14 }}>
                <h4>Berlaku untuk kategori / merek</h4>
                <div className="tombol-baris">
                  <button
                    type="button"
                    className="tombol tombol--kecil tombol--primer"
                    onClick={() => void terapkanPenetapan()}
                    disabled={sibuk || !penetapanKotor}
                  >
                    Terapkan penetapan
                  </button>
                </div>
              </div>
              <div className="penetapan-grid">
                <label className="bidang">
                  <span>Kategori yang memakai profil ini</span>
                  <select
                    multiple
                    size={5}
                    value={katTerpilih.map(String)}
                    onChange={(e) =>
                      setKatTerpilih(Array.from(e.target.selectedOptions).map((o) => Number(o.value)))
                    }
                  >
                    {opsiKategori.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="bidang">
                  <span>Merek yang memakai profil ini</span>
                  <select
                    multiple
                    size={5}
                    value={merekTerpilih.map(String)}
                    onChange={(e) =>
                      setMerekTerpilih(Array.from(e.target.selectedOptions).map((o) => Number(o.value)))
                    }
                  >
                    {opsiMerek.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="teks-redup teks-kecil">
                Tahan Ctrl/Cmd untuk memilih banyak. Kategori/merek di luar daftar ini memakai kata kunci lalu profil
                default. {penetapanKotor && <b>— ada perubahan belum diterapkan.</b>}
              </p>

              <div className="aturan-ubah">
                <button type="button" className="tombol tombol--netral tombol--kecil" onClick={() => void duplikat()} disabled={sibuk}>
                  Duplikat profil
                </button>
                {!profil.default && (
                  <button type="button" className="tombol tombol--netral tombol--kecil" onClick={() => void jadikanDefault()} disabled={sibuk}>
                    Jadikan default
                  </button>
                )}
                <span className="tombol-baris" style={{ marginLeft: 'auto' }}>
                  {hapusKonfirm === profil.id ? (
                    <>
                      <span className="teks-redup teks-kecil">Hapus “{profil.nama}”?</span>
                      <button type="button" className="tombol tombol--kecil tombol--netral" onClick={() => setHapusKonfirm(null)} disabled={sibuk}>
                        Batal
                      </button>
                      <button type="button" className="tombol tombol--kecil tombol--bahaya" onClick={() => void hapus()} disabled={sibuk}>
                        Ya, hapus
                      </button>
                    </>
                  ) : (
                    <button type="button" className="tombol tombol--kecil tombol--bahaya" onClick={() => setHapusKonfirm(profil.id)} disabled={sibuk}>
                      Hapus profil
                    </button>
                  )}
                </span>
              </div>
            </div>
          ) : (
            <p className="teks-redup">Pilih profil di kiri, atau buat baru dengan “+ Profil”.</p>
          )}
        </div>
      </section>
      )}

      {/* ===== AF2 — KLASIFIKASI BARANG PRIA/WANITA LEWAT KATEGORI ========= */}
      {tab === 'klasifikasi' && (
      <section className="kartu">
        <div className="kartu__kepala kartu__kepala--kompak">
          <div>
            <h3>Klasifikasi Barang — Pria / Wanita</h3>
            <p className="teks-redup teks-kecil">
              Kelompokkan kategori ke Profil Size. Chatbot memakai urutan: override produk &rarr; profil kategori
              &rarr; kata penanda &rarr; petunjuk size Db/Tp &rarr; profil default &rarr; tanyakan di pratinjau.
            </p>
          </div>
          <div className="tombol-baris">
            <button
              type="button"
              className="tombol tombol--kecil tombol--primer"
              onClick={() => void buatKategoriCepat()}
              disabled={sibukKlas}
              title="Buat Sepatu Pria, Sepatu Wanita, Sandal Pria, Sandal Wanita bila belum ada — langsung terhubung ke profilnya"
            >
              + Buat kategori cepat
            </button>
            <button type="button" className="tombol tombol--kecil tombol--netral" onClick={() => void muatKlasifikasi()}>
              Segarkan
            </button>
          </div>
        </div>

        {!klas ? (
          <p className="teks-redup">Memuat data klasifikasi…</p>
        ) : (
          <>
            <div className="klasifikasi-grid">
              {kartuKlas('Pria')}
              {kartuKlas('Wanita')}
            </div>

            {/* Panel perlu klasifikasi — USULAN harus dikonfirmasi pengguna */}
            {jumlahPerlu > 0 && (
              <div className="klasifikasi-perlu">
                <h4>Perlu klasifikasi ({jumlahPerlu})</h4>
                <p className="teks-redup teks-kecil">
                  Saran di bawah USULAN dari kata pada nama — klik Terapkan untuk memastikan; tidak ada yang
                  diterapkan diam-diam.
                </p>
                {kategoriPerlu.length > 0 && (
                  <ul className="klasifikasi-daftar">
                    {kategoriPerlu.map((k) => (
                      <li key={k.id}>
                        <span>
                          {k.nama} <span className="teks-redup teks-kecil">· {k.jumlah_produk} produk</span>
                        </span>
                        {k.usulan ? (
                          <span className="klasifikasi-usulan">
                            <span className="teks-redup teks-kecil">saran: {k.usulan.nama}</span>
                            <button
                              type="button"
                              className="tombol tombol--kecil tombol--primer"
                              onClick={() => void mintaPindah(k, k.usulan!.id, k.usulan!.nama)}
                              disabled={sibukKlas}
                            >
                              Terapkan “{k.usulan.nama}”
                            </button>
                          </span>
                        ) : (
                          <select
                            value=""
                            aria-label={`Pilih profil untuk kategori ${k.nama}`}
                            onChange={(e) => {
                              const id = Number(e.target.value);
                              if (!id) return;
                              e.target.value = '';
                              const p = (klas?.profil ?? []).find((x) => x.id === id);
                              if (p) void mintaPindah(k, p.id, p.nama);
                            }}
                          >
                            <option value="">Pilih profil…</option>
                            {(klas?.profil ?? []).map((p) => (
                              <option key={p.id} value={p.id}>{p.nama}</option>
                            ))}
                          </select>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {klas.belum_produk.length > 0 && (
                  <ul className="klasifikasi-daftar">
                    {klas.belum_produk.slice(0, 12).map((p) => (
                      <li key={p.id}>
                        <span>
                          {p.nama}{' '}
                          <span className="teks-redup teks-kecil">· {p.kategori ? `kategori ${p.kategori}` : 'tanpa kategori'}</span>
                        </span>
                        {p.usulan ? (
                          <span className="klasifikasi-usulan">
                            <span className="teks-redup teks-kecil">saran: {p.usulan.nama}</span>
                            <button
                              type="button"
                              className="tombol tombol--kecil tombol--primer"
                              onClick={() => void terapkanUsulanProduk(p, p.usulan!)}
                              disabled={sibukKlas}
                            >
                              Terapkan “{p.usulan.nama}”
                            </button>
                          </span>
                        ) : (
                          <span className="teks-redup teks-kecil">tanpa saran — atur lewat Master Data › Produk</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* AF6 — laporan ringkas */}
            <div className="klasifikasi-laporan">
              <h4>Laporan klasifikasi</h4>
              <div className="tombol-baris">
                {klas.ringkasan.produk_per_profil.map((r) => (
                  <span key={r.nama} className="lencana lencana--aktif">{r.nama}: {r.jumlah} produk</span>
                ))}
                <span className={`lencana ${klas.ringkasan.kategori_tanpa_profil ? 'lencana--peringatan' : 'lencana--aktif'}`}>
                  {klas.ringkasan.kategori_tanpa_profil} kategori tanpa profil
                </span>
                <span className={`lencana ${klas.ringkasan.produk_tanpa_profil ? 'lencana--peringatan' : 'lencana--aktif'}`}>
                  {klas.ringkasan.produk_tanpa_profil} produk belum terklasifikasi
                </span>
                <span className="lencana lencana--aktif">{klas.ringkasan.produk_dikoreksi} produk pernah dikoreksi</span>
              </div>
            </div>
          </>
        )}
      </section>
      )}

      {/* ===== AG10 — OPERATOR KOMPOSISI Db/Tp ============================= */}
      {tab === 'operator' && (
        <section className="kartu">
          <div className="kartu__kepala kartu__kepala--kompak">
            <div>
              <h3>Operator komposisi Db/Tp</h3>
              <p className="teks-redup teks-kecil">
                Kata kunci yang dibaca parser tiap baris chat (mis. “(3kd db 42 tp 39)”) beserta pengalinya: Db
                menggandakan jatah size (&times;2), Tp menghapusnya (&times;0), pengali lain mengikuti nilai operator.
                Hanya Admin/Manajer — setiap perubahan tercatat di log aktivitas.
              </p>
            </div>
          </div>
          <div className="tabel-bungkus">
            <table className="tabel">
              <thead>
                <tr>
                  <th>Label</th>
                  <th className="rata-kanan">Pengali</th>
                  <th>Kata kunci (dipisah koma)</th>
                  <th className="rata-tengah">Aktif</th>
                  <th className="rata-tengah">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {operators.map((o) => {
                  const d = opDraft[o.id] ?? { pengali: String(o.pengali), kata: o.kata_kunci.join(', '), aktif: o.aktif };
                  return (
                    <tr key={o.id}>
                      <td><strong>{o.label}</strong></td>
                      <td className="rata-kanan">
                        <input
                          className="input-angka"
                          type="number"
                          min={0}
                          max={99}
                          value={d.pengali}
                          aria-label={`Pengali ${o.label}`}
                          onChange={(e) => setOpDraft((m) => ({ ...m, [o.id]: { ...d, pengali: e.target.value } }))}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={d.kata}
                          aria-label={`Kata kunci ${o.label}`}
                          onChange={(e) => setOpDraft((m) => ({ ...m, [o.id]: { ...d, kata: e.target.value } }))}
                        />
                      </td>
                      <td className="rata-tengah">
                        <input
                          type="checkbox"
                          checked={d.aktif}
                          aria-label={`Operator ${o.label} aktif`}
                          onChange={(e) => setOpDraft((m) => ({ ...m, [o.id]: { ...d, aktif: e.target.checked } }))}
                        />
                      </td>
                      <td className="rata-tengah">
                        <div className="tombol-baris">
                          <button
                            type="button"
                            className="tombol tombol--kecil tombol--primer"
                            disabled={sibukOp}
                            onClick={() => void simpanOperator(o.id)}
                          >
                            Simpan
                          </button>
                          <button
                            type="button"
                            className="tombol tombol--kecil tombol--bahaya"
                            disabled={sibukOp}
                            onClick={() => void hapusOperator(o)}
                          >
                            Hapus
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="tombol-baris" style={{ marginTop: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label className="teks-kecil">
              Label
              <input
                type="text"
                value={opBaru.label}
                placeholder="mis. Db2"
                style={{ display: 'block' }}
                onChange={(e) => setOpBaru((b) => ({ ...b, label: e.target.value }))}
              />
            </label>
            <label className="teks-kecil">
              Pengali
              <input
                className="input-angka"
                type="number"
                min={0}
                max={99}
                value={opBaru.pengali}
                style={{ display: 'block' }}
                onChange={(e) => setOpBaru((b) => ({ ...b, pengali: e.target.value }))}
              />
            </label>
            <label className="teks-kecil">
              Kata kunci
              <input
                type="text"
                value={opBaru.kata}
                placeholder="db, dbl, double, dobel, x2"
                style={{ display: 'block' }}
                onChange={(e) => setOpBaru((b) => ({ ...b, kata: e.target.value }))}
              />
            </label>
            <button type="button" className="tombol tombol--primer" disabled={sibukOp} onClick={() => void tambahOperator()}>
              + Operator
            </button>
          </div>
        </section>
      )}

      {/* ===== AG10 — ALIAS BARANG ======================================== */}
      {tab === 'alias' && (
        <section className="kartu">
          <div className="kartu__kepala kartu__kepala--kompak">
            <div>
              <h3>Alias Barang</h3>
              <p className="teks-redup teks-kecil">
                Teks ternormalisasi &rarr; produk/grup (opsional per pemasok). Alias dipelajari dari koreksi manual
                di mode Chatbot, mempercepat pesan berikutnya (skor 100). Bisa dilihat, diedit, dihapus, diimpor,
                dan diekspor ke Excel.
              </p>
            </div>
            <div className="tombol-baris">
              <div className="cari-scan">
              <input
                type="text"
                placeholder="Cari alias…"
                value={aliasCari}
                aria-label="Cari alias"
                onChange={(e) => setAliasCari(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void muatAlias(aliasCari);
                }}
              />
              <TombolScan onHasil={(t) => { setAliasCari(t); void muatAlias(t); }} />
              </div>
              <button type="button" className="tombol tombol--kecil" onClick={() => void muatAlias(aliasCari)}>
                Cari
              </button>
              <label className="tombol tombol--kecil" style={{ cursor: 'pointer' }}>
                Impor Excel
                <input
                  type="file"
                  accept=".xlsx"
                  hidden
                  disabled={sibukAlias}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void imporAliasFile(f);
                    e.target.value = '';
                  }}
                />
              </label>
              <button
                type="button"
                className="tombol tombol--kecil"
                disabled={sibukAlias}
                onClick={() => void unduhExcel('/api/chat-aturan/alias/ekspor', 'alias-barang.xlsx')}
              >
                Ekspor Excel
              </button>
            </div>
          </div>
          {aliases.length === 0 ? (
            <p className="teks-redup">
              Belum ada alias — pilih produk manual di mode Chatbot untuk membangunnya, atau impor dari Excel.
            </p>
          ) : (
            <div className="tabel-bungkus">
              <table className="tabel">
                <thead>
                  <tr>
                    <th>Alias</th>
                    <th>Produk / Grup</th>
                    <th>Pemasok</th>
                    <th className="rata-kanan">Dipakai</th>
                    <th>Terakhir</th>
                    <th className="rata-tengah">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {aliases.map((a) => (
                    <tr key={a.id}>
                      <td>{a.teks}</td>
                      <td>{a.produk_nama ?? (a.grup ? `grup: ${a.grup}` : '—')}</td>
                      <td>{a.pemasok_nama ?? 'semua pemasok'}</td>
                      <td className="rata-kanan">{a.pakai}</td>
                      <td className="teks-kecil">{a.terakhir_pakai.slice(0, 16)}</td>
                      <td className="rata-tengah">
                        <div className="tombol-baris">
                          <button type="button" className="tombol tombol--kecil" onClick={() => bukaAliasEdit(a)}>
                            Edit
                          </button>
                          <button
                            type="button"
                            className="tombol tombol--kecil tombol--bahaya"
                            disabled={sibukAlias}
                            onClick={() => void hapusAlias(a.id)}
                          >
                            Hapus
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {aliasEdit && (
            <Modal
              judul="Edit alias"
              lebar="kecil"
              onTutup={() => setAliasEdit(null)}
              sedangKirim={sibukAlias}
              aksi={
                <>
                  <button type="button" className="tombol tombol--netral" onClick={() => setAliasEdit(null)}>
                    Batal
                  </button>
                  <button
                    type="button"
                    className="tombol tombol--primer"
                    disabled={sibukAlias}
                    onClick={() => void simpanAliasEdit()}
                  >
                    {sibukAlias ? 'Menyimpan…' : 'Simpan'}
                  </button>
                </>
              }
            >
              <label className="teks-kecil" style={{ display: 'block' }}>
                Teks alias
                <input
                  type="text"
                  value={aliasDraft.teks}
                  autoFocus
                  style={{ display: 'block', width: '100%' }}
                  onChange={(e) => setAliasDraft((d) => ({ ...d, teks: e.target.value }))}
                />
              </label>
              <label className="teks-kecil" style={{ display: 'block', marginTop: 8 }}>
                Cari produk pengganti
                <input
                  type="text"
                  value={aliasDraft.cariProduk}
                  placeholder="SKU atau nama produk…"
                  style={{ display: 'block', width: '100%' }}
                  onChange={(e) => void cariProdukAlias(e.target.value)}
                />
              </label>
              {aliasDraft.hasilProduk.length > 0 && (
                <select
                  value={aliasDraft.product_id}
                  style={{ width: '100%', marginTop: 4 }}
                  aria-label="Pilih produk pengganti"
                  onChange={(e) => setAliasDraft((d) => ({ ...d, product_id: e.target.value }))}
                >
                  <option value="">— pilih produk hasil pencarian —</option>
                  {aliasDraft.hasilProduk.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nama}
                    </option>
                  ))}
                </select>
              )}
              <p className="teks-redup teks-kecil" style={{ marginTop: 8 }}>
                Pemasok: {aliasEdit.pemasok_nama ?? 'semua pemasok'} · grup: {aliasEdit.grup ?? '—'}
              </p>
            </Modal>
          )}
        </section>
      )}

      {/* ===== AG10 — AMBANG KECOCOKAN ==================================== */}
      {tab === 'ambang' && (
        <section className="kartu">
          <div className="kartu__kepala kartu__kepala--kompak">
            <div>
              <h3>Ambang kecocokan</h3>
              <p className="teks-redup teks-kecil">
                Skor 0–100: ≥ {ambang.yakin} dengan selisih ≥ {ambang.selisih} dari peringkat 2 → diterima otomatis
                (hijau); {ambang.kabur}–{Math.max(ambang.kabur, ambang.yakin - 1)} atau selisih kecil → tampilkan 3
                kandidat (kuning); di bawah {ambang.kabur} → tidak ditemukan (merah, tersedia “Cari manual” &amp;
                “Buat produk baru”).
              </p>
            </div>
            <button type="button" className="tombol tombol--primer" disabled={sibukAmbang} onClick={() => void simpanAmbang()}>
              {sibukAmbang ? 'Menyimpan…' : 'Simpan ambang'}
            </button>
          </div>
          <div className="tombol-baris" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label className="teks-kecil">
              Ambang yakin (50–100)
              <input
                className="input-angka"
                type="number"
                min={50}
                max={100}
                value={ambang.yakin}
                style={{ display: 'block' }}
                onChange={(e) => setAmbang((a) => ({ ...a, yakin: Number(e.target.value) || 0 }))}
              />
            </label>
            <label className="teks-kecil">
              Selisih minimal peringkat 2 (0–50)
              <input
                className="input-angka"
                type="number"
                min={0}
                max={50}
                value={ambang.selisih}
                style={{ display: 'block' }}
                onChange={(e) => setAmbang((a) => ({ ...a, selisih: Number(e.target.value) || 0 }))}
              />
            </label>
            <label className="teks-kecil">
              Ambang kabur / tampilkan kandidat (10–99)
              <input
                className="input-angka"
                type="number"
                min={10}
                max={99}
                value={ambang.kabur}
                style={{ display: 'block' }}
                onChange={(e) => setAmbang((a) => ({ ...a, kabur: Number(e.target.value) || 0 }))}
              />
            </label>
          </div>
        </section>
      )}

      {/* Konfirmasi perubahan profil kategori — menampilkan jumlah terdampak (AF2) */}
      {konfirm && (
        <Modal
          judul="Ubah profil kategori?"
          lebar="kecil"
          onTutup={() => setKonfirm(null)}
          sedangKirim={sibukKlas}
          aksi={
            <>
              <button type="button" className="tombol tombol--netral" onClick={() => setKonfirm(null)} disabled={sibukKlas}>
                Batal
              </button>
              <button type="button" className="tombol tombol--primer" onClick={() => void konfirmPindah()} disabled={sibukKlas}>
                {sibukKlas ? 'Menerapkan…' : 'Ya, terapkan'}
              </button>
            </>
          }
        >
          <p>
            Kategori <strong>{konfirm.nama}</strong> → <strong>{konfirm.profil_nama}</strong>.
          </p>
          <p>
            <strong>{konfirm.ikut}</strong> produk yang <em>ikut kategori</em> akan langsung memakai profil baru;
            {' '}<strong>{konfirm.dioverride}</strong> produk dengan profil sendiri (override) TIDAK berubah.
          </p>
        </Modal>
      )}
    </div>
  );
}

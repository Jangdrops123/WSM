import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '../../components/crud/Modal';
import { beritahu } from '../../components/crud/Toast';
import { apiGet, apiPost } from '../../lib/api';
import { FOTO_MAKS_BYTES, kompresGambar, namaTanpaDirektori } from '../../lib/foto';
import { IconButton } from '../../components/IconButton';

type Target = { id: number; label: string };

type Berkas = {
  key: number;
  file: File;
  nama: string;
  ukuran: number;
  pratinjau: string;
  target: Target | null;
  timpa: boolean;
  status: 'siap' | 'proses' | 'sukses' | 'gagal' | 'tolak';
  pesan: string;
};

type PetaProduk = {
  id: number;
  kode_item: string | null;
  sku: string | null;
  nama: string;
  foto_url: string | null;
};

let keyBerkas = 1;

/** Baca seluruh entri direktori (drop folder) menjadi daftar File. */
async function telusuriEntri(entry: any, awalan: string, keluar: File[]): Promise<void> {
  if (!entry) return;
  if (entry.isFile) {
    const f: File = await new Promise((res) => entry.file(res, () => res(null as never)));
    if (f) keluar.push(new File([f], awalan + f.name, { type: f.type }));
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    for (;;) {
      const batch: any[] = await new Promise((res) => reader.readEntries(res, () => res([])));
      if (batch.length === 0) break;
      for (const e of batch) await telusuriEntri(e, awalan + entry.name + '/', keluar);
    }
  }
}

async function daftarDariDrop(dt: DataTransfer): Promise<File[]> {
  const entri: any[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    const e = (item as any).webkitGetAsEntry?.();
    if (e) entri.push(e);
  }
  if (entri.length === 0) return Array.from(dt.files);
  const hasil: File[] = [];
  for (const e of entri) await telusuriEntri(e, '', hasil);
  return hasil;
}

const formatUkuran = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Persentase progres bar per berkas (antrean unggah berjalan berurutan). */
const persenBerkas = (s: Berkas['status']) => (s === 'siap' ? 0 : s === 'proses' ? 55 : 100);

export function UnggahFotoMassal({ tutup, selesai, produkTerpilih }: { tutup: () => void; selesai: () => void; produkTerpilih?: number[] }) {
  const [peta, setPeta] = useState<PetaProduk[]>([]);
  const [berkas, setBerkas] = useState<Berkas[]>([]);
  const [seret, setSeret] = useState(false);
  const [mengunggah, setMengunggah] = useState(false);
  const [ringkas, setRingkas] = useState<{ sukses: number; gagal: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const pratinjauBaru = useRef<string[]>([]);

  useEffect(() => {
    apiGet<{ data: PetaProduk[] }>('/api/master/produk/foto-map')
      .then((r) =>
        // Dibuka dari bar aksi massal → batasi pilihan produk hanya ke yang terpilih.
        setPeta(produkTerpilih?.length ? r.data.filter((p) => produkTerpilih.includes(p.id)) : r.data),
      )
      .catch((e: Error) => beritahu(e.message, 'galat'));
    return () => {
      for (const u of pratinjauBaru.current) URL.revokeObjectURL(u);
    };
  }, []);

  const cariTarget = (target: Target | null): boolean => {
    if (!target) return false;
    return !!peta.find((p) => p.id === target.id)?.foto_url;
  };

  /** Pencocokan: BRG-0001.jpg → produk (satu baris = satu produk). */
  const cocokkan = (namaBerkas: string): { target: Target | null; pesan: string } => {
    const dasar = namaTanpaDirektori(namaBerkas).replace(/\.[^.]+$/, '').trim();
    const [kode, ...sisa] = dasar.split('_');
    const produk = peta.find((p) => p.kode_item && p.kode_item.toLowerCase() === kode.toLowerCase());
    if (!produk) return { target: null, pesan: `Kode item "${kode}" tidak ditemukan — pilih produk manual.` };
    const target = { id: produk.id, label: `${produk.kode_item} — ${produk.nama}` };
    if (sisa.length === 0) return { target, pesan: '' };
    return { target, pesan: `Akhiran "${sisa.join('_')}" diabaikan → foto produk.` };
  };

  const tambahBerkas = useCallback(
    (daftar: File[]) => {
      const baru: Berkas[] = [];
      for (const file of daftar) {
        const ukuran = file.size;
        const bukanGambar = !file.type.startsWith('image/');
        const kegedean = ukuran > FOTO_MAKS_BYTES;
        const { target, pesan } = cocokkan(file.name);
        const url = URL.createObjectURL(file);
        pratinjauBaru.current.push(url);
        baru.push({
          key: keyBerkas++,
          file,
          nama: namaTanpaDirektori(file.name),
          ukuran,
          pratinjau: url,
          target,
          timpa: cariTarget(target),
          status: bukanGambar || kegedean ? 'tolak' : 'siap',
          pesan: bukanGambar ? 'Bukan berkas gambar.' : kegedean ? 'Melebihi batas 5 MB.' : pesan,
        });
      }    setBerkas((b) => [...b, ...baru]);
    setRingkas(null);
  }, [peta]);

  const ubahTarget = (key: number, nilai: string) => {
    setBerkas((daftar) =>
      daftar.map((b) => {
        if (b.key !== key) return b;
        if (!nilai) return { ...b, target: null, timpa: false, status: b.status === 'tolak' ? 'tolak' : 'siap' };
        const id = Number(nilai);
        const p = peta.find((x) => x.id === id);
        const label = p ? `${p.kode_item} — ${p.nama}` : '';
        return { ...b, target: { id, label }, timpa: cariTarget({ id, label }), status: 'siap', pesan: '' };
      }),
    );
  };

  const antre = berkas.filter((b) => b.status === 'siap' && b.target);
  const jumlahTolak = berkas.filter((b) => b.status === 'tolak').length;

  const unggahSemua = async () => {
    if (antre.length === 0) return beritahu('Tidak ada berkas siap untuk diunggah.', 'galat');
    setMengunggah(true);
    setRingkas(null);
    let sukses = 0;
    let gagal = 0;
    for (const b of antre) {
      setBerkas((d) => d.map((x) => (x.key === b.key ? { ...x, status: 'proses', pesan: '' } : x)));
      try {
        const dataUrl = await kompresGambar(b.file);
        const t = b.target!;
        await apiPost('/api/master/produk/foto', {
          target: 'produk',
          id: t.id,
          data_base64: dataUrl,
          nama_file: b.nama,
        });
        sukses++;
        setBerkas((d) => d.map((x) => (x.key === b.key ? { ...x, status: 'sukses', pesan: 'Tersimpan.' } : x)));
        selesai(); // segarkan daftar produk di belakang dialog
      } catch (err) {
        gagal++;
        setBerkas((d) => d.map((x) => (x.key === b.key ? { ...x, status: 'gagal', pesan: (err as Error).message } : x)));
      }
    }
    setMengunggah(false);
    setRingkas({ sukses, gagal: gagal + jumlahTolak });
    beritahu(`Unggah foto: ${sukses} berhasil, ${gagal + jumlahTolak} gagal.`, gagal + jumlahTolak > 0 ? 'info' : 'sukses');
  };

  const selesaiPersen = berkas.length
    ? Math.round(((berkas.filter((b) => b.status === 'sukses' || b.status === 'gagal' || b.status === 'tolak').length) / berkas.length) * 100)
    : 0;

  return (
    <Modal
      judul="Unggah Foto Massal"
      lebar="lebar"
      onTutup={tutup}
      sedangKirim={mengunggah}
      aksi={
        <div className="tombol-baris">
          <span className="teks-redup teks-kecil">
            {berkas.length} berkas · {antre.length} siap · {jumlahTolak} ditolak
          </span>
          <button type="button" className="tombol tombol--netral" onClick={tutup} disabled={mengunggah}>
            Tutup
          </button>
          <button type="button" className="tombol tombol--primer" onClick={() => void unggahSemua()} disabled={mengunggah || antre.length === 0}>
            {mengunggah ? 'Mengunggah…' : `Unggah Semua (${antre.length})`}
          </button>
        </div>
      }
    >
      <div
        className={`dropzone ${seret ? 'dropzone--aktif' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setSeret(true);
        }}
        onDragLeave={() => setSeret(false)}
        onDrop={(e) => {
          e.preventDefault();
          setSeret(false);
          void daftarDariDrop(e.dataTransfer).then(tambahBerkas);
        }}
      >
        <p>
          <strong>Seret file atau folder ke sini</strong> — nama file = kode item (<code>BRG-0001.jpg</code>).
        </p>
        <div className="tombol-baris" style={{ justifyContent: 'center' }}>
          <button type="button" className="tombol tombol--kecil tombol--netral" onClick={() => fileInput.current?.click()}>
            Pilih Banyak File
          </button>
          <button type="button" className="tombol tombol--kecil tombol--netral" onClick={() => folderInput.current?.click()}>
            Pilih Folder
          </button>
          <span className="teks-redup teks-kecil">Kompresi otomatis maks 1000 px (WebP/JPEG) · batas 5 MB/file</span>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            tambahBerkas(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
        <input
          ref={folderInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          onChange={(e) => {
            tambahBerkas(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      </div>

      {berkas.length > 0 && (
        <div className="kemajuan" title={`Progres: ${selesaiPersen}%`}>
          <div className="kemajuan__isi" style={{ width: `${selesaiPersen}%` }} />
        </div>
      )}

      <div className="daftar-berkas">
        {berkas.map((b) => (
          <div className={`baris-berkas baris-berkas--${b.status}`} key={b.key}>
            <span className="foto-thumb">
              <img src={b.pratinjau} alt="" />
            </span>
            <div className="baris-berkas__nama">
              <strong>{b.nama}</strong>
              <div className="teks-redup teks-kecil">
                {formatUkuran(b.ukuran)}
                {b.pesan ? ` · ${b.pesan}` : ''}
              </div>
            </div>
            <select
              value={b.target ? String(b.target.id) : ''}
              onChange={(e) => ubahTarget(b.key, e.target.value)}
              disabled={mengunggah}
              aria-label={`Target ${b.nama}`}
            >
              <option value="">— pilih produk —</option>
              {peta.map((p) => (
                <option key={`p-${p.id}`} value={String(p.id)}>
                  {p.kode_item} — {p.nama}
                </option>
              ))}
            </select>
            {b.timpa && b.target && <span className="lencana lencana--peringatan">Menimpa foto lama</span>}
            {b.target && !b.timpa && <span className="lencana lencana--aktif">Foto produk</span>}
            <span className={`lencana ${b.status === 'sukses' ? 'lencana--aktif' : b.status === 'gagal' || b.status === 'tolak' ? 'lencana--bahaya' : b.status === 'proses' ? 'lencana--peringatan' : 'lencana--netral'}`}>
              {b.status === 'siap' ? 'Siap' : b.status === 'proses' ? 'Mengunggah…' : b.status === 'sukses' ? 'Berhasil' : b.status === 'gagal' ? 'Gagal' : 'Ditolak'}
            </span>
            <IconButton
              label="Hapus dari daftar"
              ikon="trash"
              warna="bahaya"
              duaKetuk
              disabled={mengunggah}
              onClick={() => setBerkas((d) => d.filter((x) => x.key !== b.key))}
            />
            <div
              className={`progres-mini progres-mini--${b.status}`}
              role="progressbar"
              aria-label={`Progres ${b.nama}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={persenBerkas(b.status)}
              title={`Progres: ${persenBerkas(b.status)}%`}
            >
              <div className="progres-mini__isi" />
            </div>
          </div>
        ))}
      </div>

      {ringkas && (
        <p className={`ringkasan-unggah ${ringkas.gagal > 0 ? 'teks-galat' : 'teks-sukses'}`}>
          {ringkas.sukses} berhasil, {ringkas.gagal} gagal.
        </p>
      )}
      {berkas.length === 0 && <p className="teks-redup teks-kecil">Belum ada berkas. Cocok otomatis memakai nama file = kode item.</p>}
    </Modal>
  );
}

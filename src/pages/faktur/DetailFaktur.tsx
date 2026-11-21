import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { MenuAksi } from '../../components/MenuAksi';
import { beritahu } from '../../components/crud/Toast';
import { apiGet } from '../../lib/api';
import { useSegarkanModul } from '../../lib/segarkan';
import { PratinjauFaktur } from './FakturDokumen';
import { DialogWa } from './DialogWa';
import { cetakFaktur } from './aksi';
import type { FakturDTO, IsiFaktur, TemplateFaktur } from './tipe';
import './faktur.css';

/**
 * Halaman detail faktur (BAGIAN I1/I4): dokumen dibuka ulang dari Daftar
 * Dokumen, lengkap dengan menu Aksi — Kirim via WhatsApp, Simpan (PDF),
 * Cetak. Ekspor PDF & cetak memakai CSS @page sesuai ukuran kertas
 * template (BAGIAN I3).
 */
export function DetailFaktur() {
  const { id } = useParams();
  const navigasi = useNavigate();
  const [params, setParams] = useSearchParams();
  const [faktur, setFaktur] = useState<FakturDTO | null>(null);
  const [isi, setIsi] = useState<IsiFaktur | null>(null);
  const [template, setTemplate] = useState<TemplateFaktur | null>(null);
  const [sibuk, setSibuk] = useState(true);
  const [dlgWa, setDlgWa] = useState(false);

  const muat = useCallback(async () => {
    setSibuk(true);
    try {
      const r = await apiGet<{ faktur: FakturDTO; isi: IsiFaktur; template: TemplateFaktur | null }>(
        `/api/faktur/${id}`,
      );
      setFaktur(r.faktur);
      setIsi(r.isi);
      setTemplate(r.template);
    } catch (err) {
      beritahu((err as Error).message, 'galat');
    } finally {
      setSibuk(false);
    }
  }, [id]);

  useEffect(() => {
    void muat();
  }, [muat]);
  // Tombol Refresh global di topbar: muat ulang detail faktur.
  useSegarkanModul(muat);

  // Dari daftar: "?cetak=1" langsung membuka dialog cetak/simpan PDF.
  useEffect(() => {
    if (!sibuk && faktur && params.get('cetak') === '1') {
      setParams({}, { replace: true });
      const t = window.setTimeout(() => cetakFaktur(), 250);
      return () => window.clearTimeout(t);
    }
  }, [sibuk, faktur, params, setParams]);

  if (sibuk) return <p className="teks-redup">Memuat faktur…</p>;
  if (!faktur || !isi) return <p className="teks-redup">Faktur tidak ditemukan.</p>;

  const namaToko = isi.toko?.nama ?? '';
  // M7 — POS pindah ke modul Penjualan; tautan sumber mengikuti rute baru.
  const sumberPath = faktur.sumber_tipe === 'penjualan' ? '/penjualan' : '/pembelian';

  return (
    <div className="faktur-halaman">
      <div className="faktur-toolbar">
        <div className="faktur-toolbar__isi">
          <strong>{faktur.no_faktur}</strong>
          <span className="teks-redup teks-kecil">
            {faktur.jenis === 'penjualan' ? 'Faktur penjualan' : 'Faktur pembelian'}
            {faktur.no_sumber ? ` · dokumen ${faktur.no_sumber}` : ''}
          </span>
        </div>

        <div className="faktur-toolbar__aksi">
          <MenuAksi
            label="Aksi faktur"
            items={[
              { label: 'Kirim via WhatsApp', jalan: () => setDlgWa(true) },
              { label: 'Simpan (PDF)', jalan: () => cetakFaktur() },
              { label: 'Cetak', jalan: () => cetakFaktur() },
            ]}
          />
        </div>

        <Link className="tombol tombol--kecil tombol--netral" to={sumberPath}>
          ‹ Kembali ke Riwayat
        </Link>
        <button type="button" className="tombol tombol--kecil" onClick={() => navigasi(sumberPath)}>
          Dokumen sumber
        </button>
      </div>

      {/* BAGIAN AA — pratinjau fit-to-container (penuh & terpusat) dengan
          alat tampilan; satu sumber render dengan cetak/PDF. */}
      <PratinjauFaktur faktur={faktur} isi={isi} template={template} />

      {dlgWa && (
        <DialogWa
          faktur={{ id: faktur.id, no_faktur: faktur.no_faktur, tanggal: faktur.tanggal, total: faktur.total }}
          namaToko={namaToko}
          teleponAwal={faktur.pihak.telepon ?? ''}
          pihakNama={faktur.pihak.nama ?? ''}
          onTutup={() => setDlgWa(false)}
        />
      )}
    </div>
  );
}

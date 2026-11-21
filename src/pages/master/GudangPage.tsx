import { useCallback, useEffect, useState } from 'react';
import { HalamanGenerik, type BidangForm, type KolomTabel, type OpsiSelect } from '../../components/crud/HalamanGenerik';
import { beritahu } from '../../components/crud/Toast';
import { ambilOpsi } from '../../lib/api';
import { useSegarkanModul } from '../../lib/segarkan';

const KOLOM_GUDANG: KolomTabel[] = [
  { key: 'kode', label: 'Kode' },
  { key: 'nama', label: 'Nama Gudang' },
  // AS1 — status terlihat di Master agar nonaktif tidak membingungkan.
  { key: 'aktif', label: 'Status', render: (b) => (Number(b.aktif ?? 1) === 1 ? 'Aktif' : 'Nonaktif') },
];

const FORM_GUDANG: BidangForm[] = [
  { key: 'kode', label: 'Kode Gudang', tipe: 'teks', wajib: true, contoh: 'G1' },
  { key: 'nama', label: 'Nama Gudang', tipe: 'teks', wajib: true, contoh: 'Gudang Utama' },
  // AS3 — menonaktifkan melepas akses pengguna ke gudang ini (dengan pemberitahuan).
  { key: 'aktif', label: 'Aktif (matikan untuk mengunci & melepas akses)', tipe: 'bool' },
];

const KOLOM_LOKASI: KolomTabel[] = [
  { key: 'kode_lokasi', label: 'Kode Lokasi' },
  { key: 'warehouse_id', label: 'Gudang', render: (b) => b.warehouse_id_label ?? '—' },
  { key: 'zona', label: 'Zona' },
  { key: 'rak', label: 'Rak' },
  { key: 'bin', label: 'Bin' },
];

/** Halaman Gudang + Lokasi (zona › rak › bin, kode_lokasi unik). */
export function GudangPage() {
  const [opsiGudang, setOpsiGudang] = useState<OpsiSelect[]>([]);

  const muatOpsi = useCallback(() => {
    ambilOpsi('gudang')
      .then(setOpsiGudang)
      .catch((err: Error) => beritahu(err.message, 'galat'));
  }, []);

  useEffect(() => {
    muatOpsi();
  }, [muatOpsi]);
  // Tombol Refresh global di topbar: muat ulang opsi gudang (tabel via HalamanGenerik ikut segar).
  useSegarkanModul(muatOpsi);

  const formLokasi: BidangForm[] = [
    { key: 'warehouse_id', label: 'Gudang', tipe: 'ref', wajib: true, opsi: opsiGudang },
    { key: 'kode_lokasi', label: 'Kode Lokasi', tipe: 'teks', wajib: true, contoh: 'G1-A-01-01' },
    { key: 'zona', label: 'Zona', tipe: 'teks', contoh: 'A' },
    { key: 'rak', label: 'Rak', tipe: 'teks', contoh: '01' },
    { key: 'bin', label: 'Bin', tipe: 'teks', contoh: '01' },
  ];

  return (
    <>
      <HalamanGenerik
        entitas="gudang"
        judul="Gudang"
        deskripsi="Daftar gudang/cabang penyimpanan barang."
        kolom={KOLOM_GUDANG}
        form={FORM_GUDANG}
        cariContoh="Cari kode atau nama gudang…"
        onBerubah={muatOpsi}
        labelBaris={(b) => `${b.kode} — ${b.nama}`}
      />
      <HalamanGenerik
        entitas="lokasi"
        judul="Lokasi (Zona › Rak › Bin)"
        deskripsi="Kode lokasi unik per gudang — dipakai untuk penempatan stok."
        kolom={KOLOM_LOKASI}
        form={formLokasi}
        cariContoh="Cari kode_lokasi, zona, rak, atau bin…"
        urutBawaan="kode_lokasi"
        filter={{ key: 'warehouse_id', label: 'Gudang', opsi: opsiGudang }}
        labelTambah="Tambah Lokasi"
        labelBaris={(b) => String(b.kode_lokasi ?? b.id)}
      />
    </>
  );
}

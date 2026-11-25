import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPut } from '../../lib/api';
import { formatKodi } from '../../lib/kodi';

/** Kunci preferensi lokal — menimpa nilai server di perangkat ini. */
const KUNCI_LOKAL = 'po_tampilkan_kodi';

function bacaLokal(): boolean | null {
  try {
    const v = window.localStorage.getItem(KUNCI_LOKAL);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {
    /* abaikan */
  }
  return null;
}

/**
 * Pengaturan konversi kodi modul Purchase (Pengaturan › Pembelian & Inbound):
 * - isiKodi: 1 kodi = N pasang (bawaan 20).
 * - kodiAktif: toggle `enable_kodi_conversion` — bila mati, kolom/input Kodi
 *   disembunyikan dan fokus hanya pada Pasang/Pcs.
 * Preferensi toggle disimpan di localStorage (per perangkat, langsung berlaku)
 * dan — bila akun punya izin Pengaturan — diteruskan juga ke server agar
 * berlaku di perangkat lain. Kegagalan simpan server diabaikan diam-diam.
 */
export function pakaiKodi(): { isiKodi: number; kodiAktif: boolean; setKodiAktif: (aktif: boolean) => void } {
  const [isiKodi, setIsiKodi] = useState(20);
  const [kodiAktif, setKodiAktifState] = useState<boolean>(() => bacaLokal() ?? true);
  useEffect(() => {
    apiGet<{ isi_per_kodi: number; enable_kodi_conversion?: boolean }>('/api/po/pengaturan')
      .then((r) => {
        if (r.isi_per_kodi) setIsiKodi(r.isi_per_kodi);
        // Pengaturan database berlaku sama untuk semua perangkat.
        if (typeof r.enable_kodi_conversion === 'boolean') setKodiAktifState(r.enable_kodi_conversion);
      })
      .catch(() => undefined);
  }, []);
  const setKodiAktif = useCallback((aktif: boolean) => {
    setKodiAktifState(aktif);
    try {
      window.localStorage.setItem(KUNCI_LOKAL, aktif ? '1' : '0');
    } catch {
      /* abaikan */
    }
    // Best-effort: samakan juga pengaturan global (perlu izin Pengaturan).
    apiPut('/api/pengaturan/pembelian-wms', { nilai: { enable_kodi_conversion: aktif } }).catch(() => undefined);
  }, []);
  return { isiKodi, kodiAktif, setKodiAktif };
}

/** Toggle "Izinkan Qty 0" — preferensi lokal per perangkat (bawaan OFF). */
export function pakaiQtyNol(): { qtyNolAktif: boolean; setQtyNolAktif: (aktif: boolean) => void } {
  const [qtyNolAktif, setQtyNolAktifState] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('po_izinkan_qty0') === '1';
    } catch {
      return false;
    }
  });
  const setQtyNolAktif = useCallback((aktif: boolean) => {
    setQtyNolAktifState(aktif);
    try {
      window.localStorage.setItem('po_izinkan_qty0', aktif ? '1' : '0');
    } catch {
      /* abaikan */
    }
  }, []);
  return { qtyNolAktif, setQtyNolAktif };
}

/** Tampilan qty: "3 kodi 5 pcs" bila konverter aktif, "65 pcs" bila nonaktif. */
export function tampilQty(totalPcs: number, isiKodi: number, kodiAktif: boolean): string {
  const t = Math.max(0, Math.floor(Number(totalPcs) || 0));
  if (!kodiAktif) return `${t.toLocaleString('id-ID')} pcs`;
  return formatKodi(t, isiKodi);
}

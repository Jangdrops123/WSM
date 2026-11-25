import { Router } from 'express';
import { routerProduk, routerKonversi } from './produk.ts';
import { routerPaket } from './paket.ts';
import { routerEntitasUmum } from './umum.ts';

/**
 * Peta rute /api/master/*
 * Urutan penting: rute spesifik didahulukan sebelum rute generik /:entitas.
 */
export function routerMaster(): Router {
  const r = Router();

  r.use('/produk', routerProduk());
  r.use('/konversi', routerKonversi());
  r.use('/paket', routerPaket());
  r.use('/', routerEntitasUmum()); // kategori, merek, satuan, pelanggan, pemasok, gudang, lokasi

  return r;
}

-- Keterangan per barang pada modul Purchase Order.
ALTER TABLE purchase_order_items ADD COLUMN catatan TEXT;
ALTER TABLE po_receipt_items ADD COLUMN catatan TEXT;

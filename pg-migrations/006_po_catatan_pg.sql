-- Keterangan per barang pada modul Purchase Order (PostgreSQL).
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS catatan TEXT;
ALTER TABLE po_receipt_items ADD COLUMN IF NOT EXISTS catatan TEXT;

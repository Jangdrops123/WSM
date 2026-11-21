-- 035 — AX6: hapus kode izin tambahan (terima/batal/batal_disahkan).
-- Aman diulang. Centang matriks peran dipertahankan persis (tidak ada izin
-- otomatis); baris kode-luar-matriks dihapus; CHECK dikencangkan ke 8 sel.
-- Pemetaan yang dihapus: Terima→Ubah, Batal draft/GRN→Hapus,
-- Batal disahkan→Hapus+Sahkan, Sahkan→Sahkan (lihat server/lib/hak.ts).

-- 1) Hapus baris kode di luar matriks.
DELETE FROM role_permissions WHERE aksi IN ('terima', 'batal', 'batal_disahkan');

-- 2) Kencangkan CHECK ke delapan sel matriks saja.
CREATE TABLE IF NOT EXISTS role_permissions_ax (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  menu    TEXT NOT NULL,
  aksi    TEXT NOT NULL
         CHECK (aksi IN ('lihat','tambah','ubah','hapus','sahkan','impor','ekspor','cetak')),
  UNIQUE (role_id, menu, aksi)
);
INSERT OR IGNORE INTO role_permissions_ax (id, role_id, menu, aksi)
  SELECT id, role_id, menu, aksi FROM role_permissions
  WHERE aksi IN ('lihat','tambah','ubah','hapus','sahkan','impor','ekspor','cetak');
DROP TABLE role_permissions;
ALTER TABLE role_permissions_ax RENAME TO role_permissions;
CREATE UNIQUE INDEX IF NOT EXISTS idx_role_menu_aksi ON role_permissions (role_id, menu, aksi);

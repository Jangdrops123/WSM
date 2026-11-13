// Sekali pakai: memotong blok "Varian (SKU)" + modal generator di ProdukPage.
const fs = require('fs');
const p = 'src/pages/master/ProdukPage.tsx';
let s = fs.readFileSync(p, 'utf8');
const anchor = (i, m) => {
  if (i < 0) throw new Error('anchor tidak ditemukan: ' + m);
  return i;
};

const baris = [
  '          <div className="varian-kepala">',
  '            <h4>Konversi Satuan</h4>',
  '            <div className="tombol-baris">',
  '              <button type="button" className="tombol tombol--netral tombol--kecil" onClick={tambahKonversi}>',
  '                + Tambah konversi',
  '              </button>',
  '            </div>',
  '          </div>',
  '',
  '          <div className="konversi-panel">',
  '            <p className="teks-redup teks-kecil">',
  '              Konversi satuan (contoh: 1 lusin = 12 pcs, 1 kodi = 20 pcs) — dihitung dari satuan dasar produk.',
  '            </p>',
  '            {form.konversi.map((k, ki) => (',
  '              <div className="konversi-baris" key={ki}>',
  '                <input',
  '                  type="number"',
  '                  min={0}',
  '                  className="konversi-baris__jumlah"',
  '                  value={k.jumlah}',
  '                  placeholder="Jumlah"',
  '                  onChange={(e) => ubahKonversi(ki, { jumlah: e.target.value })}',
  '                />',
  '                <span className="teks-redup">=</span>',
  '                <select',
  '                  value={String(k.unit_id)}',
  '                  onChange={(e) => ubahKonversi(ki, { unit_id: e.target.value === \'\' ? \'\' : Number(e.target.value) })}',
  '                >',
  '                  <option value="">— satuan —</option>',
  '                  {opsiSatuanTanpaDasar(form.satuan_dasar_id).map((o) => (',
  '                    <option key={o.id} value={o.id}>{o.label}</option>',
  '                  ))}',
  '                </select>',
  '                <span className="teks-redup teks-kecil">dari satuan dasar</span>',
  '                <button type="button" className="tombol tombol--kecil tombol--bahaya" onClick={() => hapusKonversi(ki)}>',
  '                  Hapus',
  '                </button>',
  '              </div>',
  '            ))}',
  '            {form.konversi.length === 0 && (',
  '              <p className="teks-redup">Belum ada konversi satuan. Klik “+ Tambah konversi”.</p>',
  '            )}',
  '          </div>',
  '',
  '        </Modal>',
  '      )}',
  '',
  '',
].join('\n');

// 1) Blok "Varian (SKU)" + daftar-varian → panel Konversi Satuan (sampai modal generator).
const a1 = anchor(s.indexOf('          <div className="varian-kepala">'), 'varian-kepala');
const a2 = anchor(s.indexOf('      {generator.buka && (', a1), 'modal generator');
s = s.slice(0, a1) + baris + s.slice(a2);

// 2) Hapus modal "Buat Varian Otomatis" utuh.
const g1 = anchor(s.indexOf('      {generator.buka && ('), 'generator start');
const g2 = anchor(s.indexOf('      {hapusTarget && (', g1), 'hapusTarget');
s = s.slice(0, g1) + s.slice(g2);

fs.writeFileSync(p, s);
console.log('OK — panjang baru:', s.length);

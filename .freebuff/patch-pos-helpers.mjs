import fs from 'node:fs';

const file = 'server/routes/pos.ts';
const src = fs.readFileSync(file, 'utf8').split(/\r?\n/);
const CR = '\r';

/** Ganti baris [dari..sampai] (1-indexed, inklusif) dengan teks baru. */
function ganti(dari, sampai, teks) {
  src.splice(dari - 1, sampai - dari + 1, ...teks.split('\n'));
}

const helper = fs.readFileSync('.freebuff/pos-helpers.txt','utf8');

const blokBaruPost = `      const siap = await hitungPenjualan(req, body);
      const { customerId, warehouseId, subtotal, diskonTotal, pajak, total, dibayar } = siap;

      const shift = await shiftAktif();
      if (!shift) throw tolak(409, 'Buka kasir dulu sebelum bertransaksi.');
      const kasir = await idKasir();`;

const efekBaru = `        await terapkanPenjualan(saleId, siap, kasir, noDok);`;

// Bottom-up agar nomor baris di atasnya tidak bergeser.
ganti(612, 675, efekBaru);
ganti(598, 605, `            siap.tanggal,${CR}            shift.id,${CR}            kasir,${CR}            customerId,${CR}            warehouseId,${CR}            siap.modePos,${CR}            subtotal,${CR}            diskonTotal,`);
ganti(493, 590, blokBaruPost);
ganti(482, 491, '');
ganti(57, 57, `const METODE = new Set(['tunai', 'transfer', 'qris', 'kredit']);${CR}${CR}${helper.trim()}`);

fs.writeFileSync(file, src.join('\n'));
console.log('ok');

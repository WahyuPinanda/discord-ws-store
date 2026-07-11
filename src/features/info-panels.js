import { AttachmentBuilder } from 'discord.js';
import { existsSync } from 'node:fs';

const RULES_IMAGE_PATH = 'assets/ws-store-rules.png';
const HOW_TO_ORDER_IMAGE_PATH = 'assets/ws-store-how-to-order.png';

function attachBanner(payload, imagePath, fileName) {
  if (!existsSync(imagePath)) return payload;

  payload.embeds[0].setImage(`attachment://${fileName}`);
  payload.files = [new AttachmentBuilder(imagePath, { name: fileName })];
  return payload;
}

export function rulesPanelPayload(embedBase) {
  const payload = {
    embeds: [
      embedBase()
        .setTitle('📜 WS STORE SERVER RULES')
        .setDescription([
          '1. Hormati semua member dan staff.',
          '2. Dilarang spam, promosi tanpa izin, atau jualan di luar product resmi WS Store.',
          '3. Jangan share password, cookie, OTP, atau data login.',
          '4. Semua transaksi wajib lewat ticket agar tercatat.',
          '5. Untuk transaksi pihak ketiga, gunakan jasa rekber / middleman resmi WS Store.',
          '6. Refund mengikuti syarat dan bukti transaksi yang valid.'
        ].join('\n'))
    ]
  };

  return attachBanner(payload, RULES_IMAGE_PATH, 'ws-store-rules.png');
}

export function howToOrderPanelPayload(embedBase) {
  const payload = {
    embeds: [
      embedBase()
        .setTitle('📌 CARA PEMESANAN')
        .setDescription([
          '1. Cek pricelist, stock, dan status layanan di server stats.',
          '2. Masuk ke channel ticket order.',
          '3. Pilih tombol layanan sesuai kebutuhan: Gamepass & GIG, Payout Instant, VILOG, Robux Via Username, atau Limited Item.',
          '4. Isi form order di ticket sesuai layanan yang dipilih.',
          '5. Tunggu admin claim ticket dan ikuti arahan pembayaran.',
          '6. Klik tombol payment untuk QRIS, lalu kirim bukti pembayaran.',
          '7. Setelah order selesai, invoice dikirim ke DM dan transaksi masuk ke channel vouch/transaction.'
        ].join('\n'))
    ]
  };

  return attachBanner(payload, HOW_TO_ORDER_IMAGE_PATH, 'ws-store-how-to-order.png');
}

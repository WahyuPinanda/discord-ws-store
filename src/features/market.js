import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';
import { existsSync } from 'node:fs';

const VIA_LOGIN_IMAGE_PATH = 'assets/ws-store-via-login.png';
const VIA_USERNAME_IMAGE_PATH = 'assets/ws-store-via-username.png';

function buyRobuxRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket:create:order')
      .setLabel('Buy Robux')
      .setEmoji('🪙')
      .setStyle(ButtonStyle.Success)
  );
}

function attachBanner(payload, imagePath, fileName) {
  if (!existsSync(imagePath)) return payload;

  payload.embeds[0].setImage(`attachment://${fileName}`);
  payload.files = [new AttachmentBuilder(imagePath, { name: fileName })];
  return payload;
}

export function valueUpdatePayload(embedBase) {
  return {
    embeds: [
      embedBase()
        .setTitle('🔎 VALUE UPDATE REALTIME')
        .setDescription([
          'Gunakan channel ini untuk cek value item limited secara realtime.',
          '',
          'Klik tombol **Rolimons** untuk membuka market value tracker.'
        ].join('\n'))
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Open Rolimons')
          .setEmoji('🔎')
          .setStyle(ButtonStyle.Link)
          .setURL('https://www.rolimons.com')
      )
    ]
  };
}

export function viaLoginPricePayload(embedBase) {
  const payload = {
    embeds: [
      embedBase()
        .setTitle('💜 PRICE LIST VIA LOGIN (INSTANT)')
        .setDescription([
          '**100% Aman, Clean & Anti-CC ✅**',
          'Top-up Robux langsung masuk tanpa pending. Proses dijamin aman dan akun otomatis logout setelah selesai.',
          '',
          '**Rate: Rp 150 / 1 Robux**',
          '500 🪙 ➤ Rp 75.000',
          '1000 🪙 ➤ Rp 150.000',
          '1500 🪙 ➤ Rp 225.000',
          '2000 🪙 ➤ Rp 300.000',
          '5000 🪙 ➤ Rp 750.000',
          '10000 🪙 ➤ Rp 1.500.000',
          '',
          '*Minimal pembelian 500 Robux.*'
        ].join('\n'))
    ],
    components: [buyRobuxRow()]
  };

  return attachBanner(payload, VIA_LOGIN_IMAGE_PATH, 'ws-store-via-login.png');
}

export function viaUsernamePricePayload(embedBase) {
  const payload = {
    embeds: [
      embedBase()
        .setTitle('💎 PRICE LIST VIA SEND USERNAME')
        .setDescription([
          '**Instant & cepat via Roblox Plus 🔧**',
          'Robux dikirim secara instant tanpa pending. Kamu cukup memberikan username Roblox kamu.',
          '',
          '**Rate: Rp 140 / 1 Robux**',
          '100 🪙 ➤ Rp 14.000',
          '500 🪙 ➤ Rp 70.000',
          '1000 🪙 ➤ Rp 140.000',
          '2000 🪙 ➤ Rp 280.000',
          '5000 🪙 ➤ Rp 700.000',
          '10000 🪙 ➤ Rp 1.400.000'
        ].join('\n'))
    ],
    components: [buyRobuxRow()]
  };

  return attachBanner(payload, VIA_USERNAME_IMAGE_PATH, 'ws-store-via-username.png');
}

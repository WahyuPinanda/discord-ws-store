import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';
import { existsSync } from 'node:fs';

const VIA_LOGIN_IMAGE_PATH = 'assets/ws-store-via-login.png';
const VIA_USERNAME_IMAGE_PATH = 'assets/ws-store-via-username.png';
const ITEM_TUMBAL_IMAGE_PATH = 'assets/ws-store-item-tumbal-v2.png';

const TUMBAL_TRADE_LINKS = [
  'https://www.roblox.com/catalog/3798248888/Cake-Topper',
  'https://www.roblox.com/catalog/152980589/Bellegg',
  'https://www.roblox.com/catalog/4773591735/Saber-Boss-Egg',
  'https://www.roblox.com/catalog/4773579034/Brainfreeze-Egg',
  'https://www.roblox.com/catalog/4771629993/Deteggctive-W-Wolf',
  'https://www.roblox.com/catalog/108150260/Tiger-Egg',
  'https://www.roblox.com/catalog/3798251754/Sugar-Shades',
  'https://www.roblox.com/catalog/1556235379/Teapot-Egg',
  'https://www.roblox.com/catalog/102611450/Cannonical-Egg',
  'https://www.roblox.com/catalog/4771632715/Eggmunition',
  'https://www.roblox.com/catalog/2528066922/Catrin-Dia-de-Muertos-Mask',
  'https://www.roblox.com/catalog/3016210752/Rocket-Eggscape',
  'https://www.roblox.com/catalog/4786877411/Tiny-Tank-Egg',
  'https://www.roblox.com/catalog/3798239844/Frosting-Flyers',
  'https://www.roblox.com/catalog/3581868178/Goldrow',
  'https://www.roblox.com/catalog/3016722037/Eggcient-Woolly-Mammoth',
  'https://www.roblox.com/catalog/3016590511/Tallaheggsee-Zombie-Slayer',
  'https://www.roblox.com/catalog/110706992/GGE'
];

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

function separatedLinks(links) {
  return links.flatMap((link, index) => (index === 0 ? [link] : ['', link]));
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

export function itemTumbalTradePayload(embedBase) {
  const payload = {
    embeds: [
      embedBase()
        .setTitle('💎 ITEM TUMBAL TRADE')
        .setDescription([
          'BUAT YANG MAU BELI LIMITED ITEM 8BIT ROYAL CROWN, HP BAR, DLL.',
          'BISA BELI ITEM TUMBAL NYA DULU, KARNA WAJIB MEMPUNYAI MINIMAL 1 ITEM TUMBAL DAN UNTUK ITEM YANG BARU DIBELI, BISA DI TRADE MINIMAL SETELAH 1 MINGGU.',
          'SILAHKAN DIPILIH SAJA TUMBAL DI BAWAH. CARI YANG MURAH KARNA SEMUANYA BISA DI TRADE.',
          '',
          ...separatedLinks(TUMBAL_TRADE_LINKS)
        ].join('\n'))
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('ticket:create:order')
          .setLabel('Beli Item Tumbal')
          .setEmoji('🎟️')
          .setStyle(ButtonStyle.Success)
      )
    ]
  };

  return attachBanner(payload, ITEM_TUMBAL_IMAGE_PATH, 'ws-store-item-tumbal-v2.png');
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

import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} from 'discord.js';
import { existsSync } from 'node:fs';

export function createCorePayloadService({
  config,
  embedBase,
  verifyImagePath
}) {
  function verifyPanelPayload() {
    const hasVerifyImage = existsSync(verifyImagePath);
    const embed = embedBase()
      .setTitle('🔐 VERIFICATION SYSTEM')
      .setDescription([
        `Selamat datang di **${config.storeName}**! 👋`,
        '',
        'Untuk mengakses seluruh channel dan fitur server, silakan lakukan verifikasi terlebih dahulu.',
        '',
        '📌 **Cara Verifikasi:**',
        'Klik tombol **Verify** di bawah ini.',
        '',
        '⚠️ **Catatan:**',
        '• Jangan berikan password, cookie, OTP, atau kode login kepada siapa pun.',
        '• Jika ada kendala, buka ticket support setelah verifikasi.',
        '',
        '**Terima kasih dan selamat bergabung!**'
      ].join('\n'));

    if (hasVerifyImage) {
      embed
        .setThumbnail('attachment://ws-store-verify-banner.png')
        .setImage('attachment://ws-store-verify-banner.png');
    }

    const payload = {
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('verify:member')
            .setLabel('Verify')
            .setEmoji('✅')
            .setStyle(ButtonStyle.Primary)
        )
      ]
    };

    if (hasVerifyImage) {
      payload.files = [new AttachmentBuilder(verifyImagePath, { name: 'ws-store-verify-banner.png' })];
    }

    return payload;
  }

  function ticketControlRows(type) {
    const firstRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket:claim')
        .setLabel('Claim Ticket')
        .setEmoji('🎯')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('ticket:payment')
        .setLabel('Payment QRIS')
        .setEmoji('💳')
        .setStyle(ButtonStyle.Secondary)
    );

    if (type !== 'support') {
      firstRow.addComponents(
        new ButtonBuilder()
          .setCustomId('ticket:complete')
          .setLabel('Order Selesai')
          .setEmoji('✅')
          .setStyle(ButtonStyle.Success)
      );
    }

    const secondRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket:close')
        .setLabel('Close Ticket')
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Danger)
    );

    return [firstRow, secondRow];
  }

  function qrisReplyPayload({ ephemeral = false } = {}) {
    const file = new AttachmentBuilder(config.qrisImagePath, { name: 'qris-ws-store.png' });
    const payload = {
      embeds: [
        embedBase()
          .setTitle('💳 QRIS WS Store')
          .setDescription('Scan QRIS di bawah ini. Setelah pembayaran berhasil, kirim bukti transfer di ticket kamu.')
          .setImage('attachment://qris-ws-store.png')
      ],
      files: [file]
    };

    if (ephemeral) payload.flags = MessageFlags.Ephemeral;
    return payload;
  }

  return { qrisReplyPayload, ticketControlRows, verifyPanelPayload };
}

import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';
import { existsSync } from 'node:fs';

export function createTicketPanelFeature({
  config,
  embedBase,
  operatingStatusText,
  orderTicketServices,
  rekberImagePath,
  orderTicketServiceIsAvailable,
  serviceIsOpen,
  serviceStatusIsSet,
  ticketServiceIsAvailable
}) {
  function ticketTypeLabel(type) {
    const labels = {
      order: 'Order Ticket',
      rekber: 'Rekber / Middleman Ticket',
      support: 'Support Ticket'
    };
    return labels[type] || 'Ticket';
  }

  function orderTicketService(service) {
    return orderTicketServices.find((item) => item.service === service) || null;
  }

  function serviceStatusText(service) {
    return serviceIsOpen(config.guildId, service)
      ? 'OPEN | Mengikuti server stats.'
      : 'CLOSED | Mengikuti server stats.';
  }

  function orderTicketRows() {
    const buttons = orderTicketServices.map((item) =>
      new ButtonBuilder()
        .setCustomId(`ticket:create:order:${item.service}`)
        .setLabel(item.label)
        .setEmoji(item.emoji)
        .setStyle(ButtonStyle.Success)
        .setDisabled(!orderTicketServiceIsAvailable(config.guildId, item.service))
    );

    return [
      new ActionRowBuilder().addComponents(buttons.slice(0, 2)),
      new ActionRowBuilder().addComponents(buttons.slice(2, 4)),
      new ActionRowBuilder().addComponents(buttons.slice(4))
    ];
  }

  function ticketOpenButton(type) {
    const labels = {
      order: 'Buka Ticket Order',
      rekber: 'Buka Ticket Rekber',
      support: 'Buka Ticket Support'
    };

    return new ButtonBuilder()
      .setCustomId(`ticket:create:${type}`)
      .setLabel(labels[type])
      .setEmoji(type === 'rekber' ? '🤝' : type === 'support' ? '🛠️' : '🎟️')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!ticketServiceIsAvailable(config.guildId, type));
  }

  function ticketPanelPayload(type) {
    const description = {
      order: [
        '**Pilih layanan yang ingin kamu order lewat tombol di bawah.**',
        '',
        ...orderTicketServices.flatMap((item) => [
          `${item.emoji} **${item.label}**`,
          item.description,
          `Status: ${serviceStatusText(item.service)}`,
          ''
        ]),
        `Jam operasional normal ${String(config.openHour).padStart(2, '0')}:00-${String(config.closeHour).padStart(2, '0')}:00 ${config.timezoneLabel}.`
      ].join('\n').trim(),
      rekber: [
        '**WS Store Middleman Service**',
        'Buka ticket ini jika kamu butuh penengah transaksi agar proses jual-beli lebih tertata, aman, dan tercatat.',
        '',
        '**Fee Rekber:**',
        '• Rp1.000 - Rp500.000 → Rp4.000',
        '• Rp500.000 - Rp10.000.000 → Rp10.000',
        '• Rp10.000.000 - Rp20.000.000 → Rp15.000',
        '• Rp20.000.000 - Rp50.000.000 → Rp20.000',
        '',
        '**Ketentuan singkat:**',
        '• Buyer dan seller wajib berada di ticket.',
        '• Bukti deal, nominal, dan detail item harus jelas.',
        '• Jangan lanjut transaksi di luar arahan middleman WS Store.',
        '',
        '**Catatan:** Ticket rekber selalu bisa dibuka, tetapi proses akan dibantu selagi admin / middleman sedang online.'
      ].join('\n'),
      support: 'Gunakan ticket ini untuk pertanyaan, kendala order, atau bantuan umum.'
    };
    const statusText = type === 'order'
      ? `${ticketServiceIsAvailable(config.guildId, 'order') ? 'OPEN' : 'CLOSED'} | Gerbang Ticket Order mengikuti jadwal atau status manual staff.\nStatus tombol layanan mengikuti server stats masing-masing.`
      : type === 'rekber'
        ? `OPEN | Rekber selalu bisa dibuka. Jam operasional store ${String(config.openHour).padStart(2, '0')}:00-${String(config.closeHour).padStart(2, '0')}:00 ${config.timezoneLabel}`
        : serviceStatusIsSet(config.guildId, type)
          ? `${serviceIsOpen(config.guildId, type) ? 'OPEN' : 'CLOSED'} | Status diatur manual oleh staff. Jam normal ${String(config.openHour).padStart(2, '0')}:00-${String(config.closeHour).padStart(2, '0')}:00 ${config.timezoneLabel}`
          : operatingStatusText();

    const embed = embedBase()
      .setTitle(`🎟️ ${ticketTypeLabel(type)}`)
      .setDescription(`${description[type]}\n\n${statusText}`);
    const payload = {
      embeds: [embed],
      components: type === 'order'
        ? orderTicketRows()
        : [new ActionRowBuilder().addComponents(ticketOpenButton(type))]
    };

    if (type === 'rekber' && existsSync(rekberImagePath)) {
      embed.setImage('attachment://ws-store-rekber.png');
      payload.files = [new AttachmentBuilder(rekberImagePath, { name: 'ws-store-rekber.png' })];
    }

    return payload;
  }

  return {
    orderTicketService,
    ticketPanelPayload,
    ticketTypeLabel
  };
}

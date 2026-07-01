import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  Partials,
  PermissionFlagsBits,
  PermissionsBitField,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { config } from './config.js';
import { keepSupabaseAwake, supabase } from './db.js';
import { startHealthServer } from './health.js';
import { formatRupiah, isStoreOpen, operatingStatusText } from './time.js';

const ROLE = {
  owner: '👑 Owner',
  admin: '🛡️ Admin',
  middleman: '🤝 Middleman / Rekber Staff',
  creator: '🎬 Content Creator',
  booster: '🚀 Server Booster',
  customer: '🛒 Customer',
  client: '✅ Client',
  unverified: '🔒 Unverified'
};

const TIER_ROLES = [
  { min: 50_000_000, name: '💎 Customer 50Jt+' },
  { min: 20_000_000, name: '💠 Customer 20Jt+' },
  { min: 10_000_000, name: '🔷 Customer 10Jt+' },
  { min: 5_000_000, name: '🔹 Customer 5Jt+' },
  { min: 1_000_000, name: '⭐ Customer 1Jt+' }
];

const SPAM_SETTINGS = {
  windowMs: 7_000,
  maxMessages: 5,
  rapidWindowMs: 2_500,
  rapidMaxMessages: 5,
  cleanupWindowMs: 15_000,
  warningExpiresMs: 5 * 60_000,
  timeoutMs: 5 * 60_000
};

const spamState = new Map();

const CATEGORY = {
  stats: '📊 SERVER STATS',
  info: '📌 INFORMATION',
  market: '💎 MARKET & PRICE',
  ticket: '🎟️ ORDER / BERTANYA DISINI',
  activeTicket: '🎫 ACTIVE TICKETS',
  lounge: '💬 LOUNGE',
  community: '🎉 COMMUNITY',
  transaction: '📂 TRANSACTION',
  admin: '🔐 ADMIN AREA'
};

const CHANNEL = {
  verify: '✅・verify',
  rules: '📜・rules',
  howToOrder: '📌・how-to-order',
  payment: '💳・payment-method',
  ticketOrder: '🎟️・ticket-order',
  ticketRekber: '🤝・ticket-rekber',
  ticketSupport: '🛠️・ticket-support',
  successTransaction: '✅・success-transaction',
  ticketTranscript: '📜・ticket-transcript',
  adminLog: '📋・admin-log',
  ticketLog: '🎫・ticket-log'
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

const healthServer = startHealthServer(client);

function embedBase() {
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setFooter({ text: config.storeName });
}

function staffRoleNames() {
  return [ROLE.owner, ROLE.admin, ROLE.middleman];
}

function memberIsStaff(member) {
  return member.permissions.has(PermissionFlagsBits.Administrator)
    || staffRoleNames().some((roleName) => member.roles.cache.some((role) => role.name === roleName));
}

function memberIsOwner(member, userId) {
  return userId === config.ownerDiscordId
    || member.roles.cache.some((role) => role.name === ROLE.owner);
}

function pruneSpamTimestamps(timestamps, windowMs, now = Date.now()) {
  return timestamps.filter((timestamp) => now - timestamp <= windowMs);
}

function getSpamBucket(message) {
  const key = `${message.guildId}:${message.author.id}`;
  const now = Date.now();
  const existing = spamState.get(key) || {
    timestamps: [],
    warnedAt: 0,
    lastActionAt: 0
  };

  existing.timestamps = pruneSpamTimestamps(existing.timestamps, SPAM_SETTINGS.windowMs, now);
  existing.timestamps.push(now);
  spamState.set(key, existing);

  return existing;
}

async function deleteRecentSpamMessages(message) {
  if (!message.channel?.messages?.fetch) return;

  const since = Date.now() - SPAM_SETTINGS.cleanupWindowMs;
  const fetched = await message.channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!fetched) return;

  const spamMessages = fetched.filter((item) =>
    item.author.id === message.author.id
    && item.createdTimestamp >= since
    && item.deletable
  );

  if (!spamMessages.size) return;

  if (message.channel.bulkDelete) {
    await message.channel.bulkDelete(spamMessages, true).catch(async () => {
      await Promise.all([...spamMessages.values()].map((item) => item.delete().catch(() => null)));
    });
    return;
  }

  await Promise.all([...spamMessages.values()].map((item) => item.delete().catch(() => null)));
}

async function sendSpamNotice(message, description) {
  const warning = await message.channel.send({
    content: `<@${message.author.id}> ${description}`
  }).catch(() => null);

  if (warning) {
    setTimeout(() => warning.delete().catch(() => null), 12_000).unref();
  }
}

async function timeoutForSpam(message, reason) {
  const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);

  await deleteRecentSpamMessages(message);

  if (member?.moderatable) {
    await member.timeout(SPAM_SETTINGS.timeoutMs, reason).catch(() => null);
    await sendSpamNotice(message, `kamu terkena timeout 5 menit karena spam. Alasan: ${reason}`);
    return;
  }

  await sendSpamNotice(message, 'spam terdeteksi dan pesan sudah dihapus, tetapi bot tidak bisa memberi timeout pada role kamu.');
}

function ticketTypeLabel(type) {
  const labels = {
    order: 'Order Ticket',
    rekber: 'Rekber / Middleman Ticket',
    support: 'Support Ticket'
  };
  return labels[type] || 'Ticket';
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
    .setDisabled(!isStoreOpen());
}

function ticketPanelPayload(type) {
  const description = {
    order: 'Klik tombol di bawah untuk membeli produk WS Store. Ticket hanya dapat dibuka saat jam operasional.',
    rekber: 'Gunakan ticket ini untuk jasa middleman / rekber agar transaksi lebih aman.',
    support: 'Gunakan ticket ini untuk pertanyaan, kendala order, atau bantuan umum.'
  };

  return {
    embeds: [
      embedBase()
        .setTitle(`🎟️ ${ticketTypeLabel(type)}`)
        .setDescription(`${description[type]}\n\n${operatingStatusText()}`)
    ],
    components: [new ActionRowBuilder().addComponents(ticketOpenButton(type))]
  };
}

function verifyPanelPayload() {
  return {
    embeds: [
      embedBase()
        .setTitle('🔐 VERIFICATION SYSTEM')
        .setDescription([
          `Selamat datang di **${config.storeName}**!`,
          '',
          'Untuk mengakses seluruh channel dan fitur server, silakan lakukan verifikasi terlebih dahulu.',
          '',
          '📌 **Cara Verifikasi:**',
          'Klik tombol **Verify** di bawah ini.',
          '',
          '⚠️ **Catatan:**',
          '• Jangan berikan password, cookie, OTP, atau kode login kepada siapa pun.',
          '• Jika ada kendala, buka ticket support setelah verifikasi.'
        ].join('\n'))
    ],
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
}

function paymentPanelPayload() {
  return {
    embeds: [
      embedBase()
        .setTitle('💳 PAYMENT METHOD')
        .setDescription('Klik tombol di bawah untuk menampilkan QRIS WS Store. Setelah transfer, kirim bukti pembayaran di ticket order kamu.')
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('payment:qris')
          .setLabel('Tampilkan QRIS')
          .setEmoji('💳')
          .setStyle(ButtonStyle.Primary)
      )
    ]
  };
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

function qrisReplyPayload() {
  const file = new AttachmentBuilder(config.qrisImagePath, { name: 'qris-ws-store.png' });
  return {
    embeds: [
      embedBase()
        .setTitle('💳 QRIS WS Store')
        .setDescription('Scan QRIS di bawah ini. Setelah pembayaran berhasil, kirim bukti transfer di ticket kamu.')
        .setImage('attachment://qris-ws-store.png')
    ],
    files: [file],
    flags: MessageFlags.Ephemeral
  };
}

function getTier(totalSpent) {
  return TIER_ROLES.find((tier) => totalSpent >= tier.min) || null;
}

async function ensureRole(guild, name, options = {}) {
  const existing = guild.roles.cache.find((role) => role.name === name);
  if (existing) return existing;

  return guild.roles.create({
    name,
    color: options.color || 0x95a5a6,
    hoist: Boolean(options.hoist),
    mentionable: Boolean(options.mentionable),
    permissions: options.permissions || []
  });
}

async function ensureCategory(guild, name, permissionOverwrites = []) {
  const existing = guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildCategory && channel.name === name
  );
  if (existing) return existing;

  return guild.channels.create({
    name,
    type: ChannelType.GuildCategory,
    permissionOverwrites
  });
}

async function ensureTextChannel(guild, name, parent, permissionOverwrites = []) {
  const existing = guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildText && channel.name === name
  );
  if (existing) {
    if (parent && existing.parentId !== parent.id) await existing.setParent(parent);
    return existing;
  }

  return guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent,
    permissionOverwrites
  });
}

async function upsertPanel(type, message) {
  await supabase.from('ticket_panels').upsert({
    guild_id: message.guildId,
    channel_id: message.channelId,
    message_id: message.id,
    type
  }, { onConflict: 'guild_id,type' });
}

async function publishOrEditPanel(channel, type, payload) {
  const { data } = await supabase
    .from('ticket_panels')
    .select('*')
    .eq('guild_id', channel.guildId)
    .eq('type', type)
    .maybeSingle();

  if (data?.channel_id && data?.message_id) {
    try {
      const oldChannel = await client.channels.fetch(data.channel_id);
      const oldMessage = await oldChannel.messages.fetch(data.message_id);
      const edited = await oldMessage.edit(payload);
      await upsertPanel(type, edited);
      return edited;
    } catch {
      // The old panel was deleted or moved; send a new one below.
    }
  }

  const message = await channel.send(payload);
  await upsertPanel(type, message);
  return message;
}

async function setupServer(interaction) {
  if (!memberIsOwner(interaction.member, interaction.user.id)) {
    await interaction.reply({
      content: 'Hanya owner yang bisa menjalankan setup server.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const guild = interaction.guild;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ownerRole = await ensureRole(guild, ROLE.owner, { color: 0xf1c40f, hoist: true });
  const adminRole = await ensureRole(guild, ROLE.admin, {
    color: 0xe74c3c,
    hoist: true,
    permissions: [PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ManageMessages]
  });
  const middlemanRole = await ensureRole(guild, ROLE.middleman, { color: 0x1abc9c, hoist: true });
  await ensureRole(guild, ROLE.creator, { color: 0x9b59b6 });
  await ensureRole(guild, ROLE.booster, { color: 0xff73fa });
  await ensureRole(guild, ROLE.customer, { color: 0x2ecc71 });
  await ensureRole(guild, ROLE.client, { color: 0x3498db });
  await ensureRole(guild, ROLE.unverified, { color: 0x7f8c8d });

  for (const tier of TIER_ROLES) {
    await ensureRole(guild, tier.name, { color: 0x00d2ff, hoist: true });
  }

  const everyone = guild.roles.everyone;
  const clientRole = guild.roles.cache.find((role) => role.name === ROLE.client);
  const unverifiedRole = guild.roles.cache.find((role) => role.name === ROLE.unverified);

  const staffAllow = [
    { id: ownerRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
    { id: adminRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
    { id: middlemanRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
  ];

  const publicReadOnly = [
    { id: everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: clientRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory], deny: [PermissionsBitField.Flags.SendMessages] },
    ...staffAllow
  ];

  const publicChat = [
    { id: everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: clientRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
    ...staffAllow
  ];

  const infoCategory = await ensureCategory(guild, CATEGORY.info, publicReadOnly);
  const marketCategory = await ensureCategory(guild, CATEGORY.market, publicReadOnly);
  const ticketCategory = await ensureCategory(guild, CATEGORY.ticket, publicReadOnly);
  const activeTicketCategory = await ensureCategory(guild, CATEGORY.activeTicket, [
    { id: everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    ...staffAllow
  ]);
  const loungeCategory = await ensureCategory(guild, CATEGORY.lounge, publicChat);
  const communityCategory = await ensureCategory(guild, CATEGORY.community, publicChat);
  const transactionCategory = await ensureCategory(guild, CATEGORY.transaction, publicReadOnly);
  const adminCategory = await ensureCategory(guild, CATEGORY.admin, [
    { id: everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: ownerRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
    { id: adminRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
  ]);

  const verifyChannel = await ensureTextChannel(guild, CHANNEL.verify, infoCategory, [
    { id: everyone.id, deny: [PermissionsBitField.Flags.SendMessages], allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory] },
    { id: unverifiedRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory], deny: [PermissionsBitField.Flags.SendMessages] },
    { id: clientRole.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    ...staffAllow
  ]);

  await ensureTextChannel(guild, '📢・announcements', infoCategory, publicReadOnly);
  await ensureTextChannel(guild, '📦・stock-update', infoCategory, publicReadOnly);
  const rulesChannel = await ensureTextChannel(guild, CHANNEL.rules, infoCategory, [
    { id: everyone.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory], deny: [PermissionsBitField.Flags.SendMessages] },
    ...staffAllow
  ]);
  const howToOrderChannel = await ensureTextChannel(guild, CHANNEL.howToOrder, infoCategory, publicReadOnly);
  const paymentChannel = await ensureTextChannel(guild, CHANNEL.payment, infoCategory, publicReadOnly);

  await ensureTextChannel(guild, '💵・gift-gamepass-all-map', marketCategory, publicReadOnly);
  await ensureTextChannel(guild, '🌟・stock-limited-item', marketCategory, publicReadOnly);
  await ensureTextChannel(guild, '➤・item-tumbal-trade', marketCategory, publicReadOnly);
  await ensureTextChannel(guild, '💎・robux-instant-vilog', marketCategory, publicReadOnly);
  await ensureTextChannel(guild, '🌟・group-payout', marketCategory, publicReadOnly);

  const ticketOrderChannel = await ensureTextChannel(guild, CHANNEL.ticketOrder, ticketCategory, publicReadOnly);
  const ticketRekberChannel = await ensureTextChannel(guild, CHANNEL.ticketRekber, ticketCategory, publicReadOnly);
  const ticketSupportChannel = await ensureTextChannel(guild, CHANNEL.ticketSupport, ticketCategory, publicReadOnly);

  await ensureTextChannel(guild, '💬・chat', loungeCategory, publicChat);
  await ensureTextChannel(guild, '🏷️・check-payout', loungeCategory, publicChat);
  await ensureTextChannel(guild, '💎・check-tumbal-limited', loungeCategory, publicChat);
  await ensureTextChannel(guild, '❌・report-scammer', loungeCategory, publicChat);
  await ensureTextChannel(guild, '⚙️・setting-room-voice', loungeCategory, publicReadOnly);
  await ensureTextChannel(guild, '💬・chit-chat', communityCategory, publicChat);
  await ensureTextChannel(guild, '🧾・vouches', communityCategory, publicChat);
  await ensureTextChannel(guild, '🎉・giveaways', communityCategory, publicReadOnly);
  await ensureTextChannel(guild, '🤖・bot-cmd', communityCategory, publicChat);

  await ensureTextChannel(guild, CHANNEL.successTransaction, transactionCategory, publicReadOnly);
  await ensureTextChannel(guild, CHANNEL.ticketTranscript, transactionCategory, publicReadOnly);
  await ensureTextChannel(guild, '🧾・rekber-history', transactionCategory, publicReadOnly);
  await ensureTextChannel(guild, CHANNEL.adminLog, adminCategory);
  await ensureTextChannel(guild, CHANNEL.ticketLog, adminCategory);
  await ensureTextChannel(guild, '💰・order-log', adminCategory);
  await ensureTextChannel(guild, '🚨・mod-log', adminCategory);

  await publishOrEditPanel(verifyChannel, 'verify', verifyPanelPayload());
  await publishOrEditPanel(ticketOrderChannel, 'ticket_order', ticketPanelPayload('order'));
  await publishOrEditPanel(ticketRekberChannel, 'ticket_rekber', ticketPanelPayload('rekber'));
  await publishOrEditPanel(ticketSupportChannel, 'ticket_support', ticketPanelPayload('support'));
  await publishOrEditPanel(paymentChannel, 'payment_qris', paymentPanelPayload());

  await publishOrEditPanel(rulesChannel, 'seed_rules', {
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
  });

  await publishOrEditPanel(howToOrderChannel, 'seed_how_to_order', {
    embeds: [
      embedBase()
        .setTitle('📌 CARA PEMESANAN')
        .setDescription([
          '1. Cek pricelist dan stock sesuai produk yang kamu butuhkan.',
          '2. Buka ticket order.',
          '3. Isi detail pesanan dan tunggu admin claim ticket.',
          '4. Klik tombol payment untuk QRIS, lalu kirim bukti pembayaran.',
          '5. Setelah order selesai, invoice akan dikirim ke DM dan transaksi masuk ke channel vouch/transaction.'
        ].join('\n'))
    ]
  });

  await interaction.editReply('Setup server selesai. Role, channel, verify, ticket, payment QRIS, dan panel sudah dibuat.');
}

async function refreshPanels(guild) {
  const { data: panels } = await supabase
    .from('ticket_panels')
    .select('*')
    .eq('guild_id', guild.id);

  for (const panel of panels || []) {
    if (!panel.type.startsWith('ticket_')) continue;

    const type = panel.type.replace('ticket_', '');
    try {
      const channel = await client.channels.fetch(panel.channel_id);
      const message = await channel.messages.fetch(panel.message_id);
      await message.edit(ticketPanelPayload(type));
    } catch (error) {
      console.warn(`Failed to refresh panel ${panel.type}:`, error.message);
    }
  }
}

async function handleVerify(interaction) {
  const member = interaction.member;
  const clientRole = interaction.guild.roles.cache.find((role) => role.name === ROLE.client);
  const unverifiedRole = interaction.guild.roles.cache.find((role) => role.name === ROLE.unverified);

  if (clientRole) await member.roles.add(clientRole).catch(() => null);
  if (unverifiedRole) await member.roles.remove(unverifiedRole).catch(() => null);

  await interaction.reply({
    content: 'Verifikasi berhasil. Selamat datang di WS Store Official!',
    flags: MessageFlags.Ephemeral
  });
}

async function createTicket(interaction, type) {
  if (!isStoreOpen()) {
    await interaction.reply({
      content: `Store sedang closed. ${operatingStatusText()}`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const { data: existing } = await supabase
    .from('tickets')
    .select('*')
    .eq('guild_id', interaction.guildId)
    .eq('opener_id', interaction.user.id)
    .eq('type', type)
    .in('status', ['open', 'claimed'])
    .maybeSingle();

  if (existing?.channel_id) {
    await interaction.reply({
      content: `Kamu masih punya ticket aktif: <#${existing.channel_id}>`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const { data: ticket, error } = await supabase
    .from('tickets')
    .insert({
      type,
      guild_id: interaction.guildId,
      opener_id: interaction.user.id,
      opener_tag: interaction.user.tag
    })
    .select('*')
    .single();

  if (error) throw error;

  const activeCategory = interaction.guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildCategory && channel.name === CATEGORY.activeTicket
  );
  const opener = interaction.member;
  const overwrites = [
    { id: interaction.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: opener.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AttachFiles] }
  ];

  for (const roleName of staffRoleNames()) {
    const role = interaction.guild.roles.cache.find((item) => item.name === roleName);
    if (role) {
      overwrites.push({
        id: role.id,
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AttachFiles]
      });
    }
  }

  const channel = await interaction.guild.channels.create({
    name: `ticket-${ticket.id}`,
    type: ChannelType.GuildText,
    parent: activeCategory,
    topic: `${ticketTypeLabel(type)} | opener:${interaction.user.id} | ticket:${ticket.id}`,
    permissionOverwrites: overwrites
  });

  await supabase
    .from('tickets')
    .update({ channel_id: channel.id })
    .eq('id', ticket.id);

  await channel.send({
    content: `<@${interaction.user.id}>`,
    embeds: [
      embedBase()
        .setTitle('🎟️ Ticket Created')
        .setDescription([
          `Hello <@${interaction.user.id}>! Terima kasih telah membuka ticket.`,
          '',
          type === 'order'
            ? '**Form order:**\nProduk:\nJumlah:\nUsername Roblox:\nMetode pembayaran:\nCatatan:'
            : type === 'rekber'
              ? '**Form rekber:**\nBuyer/Seller:\nBarang transaksi:\nNominal:\nPihak lawan:\nBukti kesepakatan:'
              : '**Form support:**\nMasalah:\nOrder ID jika ada:\nBukti screenshot:\nPenjelasan:',
          '',
          'Silakan isi form di atas dan tunggu admin menerima ticket.'
        ].join('\n'))
    ],
    components: ticketControlRows(type)
  });

  await interaction.editReply(`Ticket berhasil dibuat: <#${channel.id}>`);
}

async function claimTicket(interaction) {
  if (!memberIsStaff(interaction.member)) {
    await interaction.reply({ content: 'Hanya staff yang bisa claim ticket.', flags: MessageFlags.Ephemeral });
    return;
  }

  const { data: ticket } = await supabase
    .from('tickets')
    .select('*')
    .eq('channel_id', interaction.channelId)
    .maybeSingle();

  if (!ticket) {
    await interaction.reply({ content: 'Data ticket tidak ditemukan di Supabase.', flags: MessageFlags.Ephemeral });
    return;
  }

  await supabase
    .from('tickets')
    .update({ claimed_by: interaction.user.id, status: 'claimed' })
    .eq('id', ticket.id);

  await interaction.reply({
    embeds: [
      embedBase()
        .setColor(0x2ecc71)
        .setTitle('🎯 Ticket Claimed')
        .setDescription(`Ticket ini sudah diclaim oleh <@${interaction.user.id}>.`)
        .addFields({ name: 'Claimed at', value: new Date().toLocaleString('id-ID', { timeZone: config.timezone }) })
    ]
  });
}

async function showCompleteModal(interaction) {
  if (!memberIsStaff(interaction.member)) {
    await interaction.reply({ content: 'Hanya staff yang bisa menyelesaikan order.', flags: MessageFlags.Ephemeral });
    return;
  }

  const { data: ticket } = await supabase
    .from('tickets')
    .select('*')
    .eq('channel_id', interaction.channelId)
    .maybeSingle();

  if (!ticket) {
    await interaction.reply({ content: 'Data ticket tidak ditemukan.', flags: MessageFlags.Ephemeral });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`ticket:complete-modal:${ticket.id}`)
    .setTitle('Selesaikan Order');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('product')
        .setLabel('Produk')
        .setPlaceholder('Contoh: 1500 Robux Group Payout')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('amount')
        .setLabel('Nominal Rupiah')
        .setPlaceholder('Contoh: 1250000')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('payment')
        .setLabel('Payment')
        .setPlaceholder('QRIS / BCA / DANA')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('note')
        .setLabel('Catatan')
        .setPlaceholder('Opsional')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
    )
  );

  await interaction.showModal(modal);
}

async function updateCustomerAndRoles(guild, buyerId, buyerTag, amount) {
  const { data: oldCustomer } = await supabase
    .from('customers')
    .select('*')
    .eq('discord_user_id', buyerId)
    .maybeSingle();

  const totalSpent = Number(oldCustomer?.total_spent || 0) + Number(amount || 0);
  const tier = getTier(totalSpent);

  await supabase.from('customers').upsert({
    discord_user_id: buyerId,
    username: buyerTag,
    total_spent: totalSpent,
    tier: tier?.name || null
  }, { onConflict: 'discord_user_id' });

  const member = await guild.members.fetch(buyerId).catch(() => null);
  if (member) {
    const customerRole = guild.roles.cache.find((role) => role.name === ROLE.customer);
    if (customerRole) await member.roles.add(customerRole).catch(() => null);

    const tierRoleIds = TIER_ROLES
      .map((item) => guild.roles.cache.find((role) => role.name === item.name)?.id)
      .filter(Boolean);

    if (tierRoleIds.length) await member.roles.remove(tierRoleIds).catch(() => null);

    if (tier) {
      const tierRole = guild.roles.cache.find((role) => role.name === tier.name);
      if (tierRole) await member.roles.add(tierRole).catch(() => null);
    }
  }

  return { totalSpent, tier };
}

async function sendInvoiceDm({ user, transaction, totalSpent, tier, transcript }) {
  const file = transcript
    ? new AttachmentBuilder(Buffer.from(transcript.html), { name: transcript.fileName })
    : null;

  const payload = {
    embeds: [
      embedBase()
        .setTitle('🧾 Invoice WS Store')
        .setDescription('Terima kasih sudah order di WS Store Official. Invoice transaksi kamu ada di bawah ini.')
        .addFields(
          { name: 'Invoice', value: `WS-${String(transaction.id).padStart(5, '0')}`, inline: true },
          { name: 'Produk', value: transaction.product, inline: true },
          { name: 'Nominal', value: formatRupiah(transaction.amount), inline: true },
          { name: 'Payment', value: transaction.payment_method, inline: true },
          { name: 'Total Belanja', value: formatRupiah(totalSpent), inline: true },
          { name: 'Tier', value: tier?.name || 'Belum masuk tier', inline: true }
        )
        .setTimestamp(new Date(transaction.created_at))
    ],
    files: file ? [file] : []
  };

  await user.send(payload).catch(() => null);
}

async function postTransaction(guild, transaction, buyerId, totalSpent, tier) {
  const channel = guild.channels.cache.find((item) => item.name === CHANNEL.successTransaction);
  if (!channel) return;

  await channel.send({
    embeds: [
      embedBase()
        .setTitle('✅ TRANSACTION SUCCESS')
        .setDescription('Order berhasil diselesaikan dan tercatat otomatis.')
        .addFields(
          { name: 'Buyer', value: `<@${buyerId}>`, inline: true },
          { name: 'Product', value: transaction.product, inline: true },
          { name: 'Nominal', value: formatRupiah(transaction.amount), inline: true },
          { name: 'Payment', value: transaction.payment_method, inline: true },
          { name: 'Handled by', value: transaction.handled_by ? `<@${transaction.handled_by}>` : '-', inline: true },
          { name: 'Customer Total', value: formatRupiah(totalSpent), inline: true },
          { name: 'Tier', value: tier?.name || 'Customer', inline: true }
        )
        .setTimestamp(new Date(transaction.created_at))
    ]
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function buildTranscript(channel, ticket) {
  const messages = [];
  let before;

  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    messages.push(...batch.values());
    before = batch.last().id;
  }

  messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const rows = messages.map((message) => {
    const attachments = [...message.attachments.values()]
      .map((item) => `<a href="${escapeHtml(item.url)}">${escapeHtml(item.name || item.url)}</a>`)
      .join('<br>');
    const embeds = message.embeds
      .map((embed) => `<div class="embed"><strong>${escapeHtml(embed.title || 'Embed')}</strong><br>${escapeHtml(embed.description || '')}</div>`)
      .join('');

    return `
      <article class="message">
        <img src="${escapeHtml(message.author.displayAvatarURL())}" alt="" />
        <div>
          <div><strong>${escapeHtml(message.author.tag)}</strong> <span>${new Date(message.createdTimestamp).toLocaleString('id-ID', { timeZone: config.timezone })}</span></div>
          <p>${escapeHtml(message.content).replaceAll('\n', '<br>')}</p>
          ${attachments ? `<div class="attachments">${attachments}</div>` : ''}
          ${embeds}
        </div>
      </article>`;
  }).join('\n');

  const html = `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <title>Ticket ${ticket.id} Transcript</title>
  <style>
    body { background:#111318; color:#e8e8ea; font-family:Arial,sans-serif; margin:0; padding:24px; }
    header { border-bottom:1px solid #343842; margin-bottom:20px; padding-bottom:16px; }
    .message { display:flex; gap:12px; border-bottom:1px solid #252a33; padding:14px 0; }
    img { width:42px; height:42px; border-radius:50%; }
    p { margin:8px 0; white-space:normal; }
    span { color:#9ca3af; font-size:12px; margin-left:8px; }
    .embed { border-left:4px solid #2ecc71; background:#20232b; padding:10px; margin-top:8px; border-radius:6px; }
    a { color:#61a8ff; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(config.storeName)} - Ticket #${ticket.id}</h1>
    <p>Type: ${escapeHtml(ticket.type)} | Opener: ${escapeHtml(ticket.opener_tag || ticket.opener_id)}</p>
  </header>
  ${rows}
</body>
</html>`;

  return {
    html,
    fileName: `ticket-${ticket.id}-transcript.html`
  };
}

async function sendTranscriptLog(guild, ticket, transcript, closedBy) {
  const channel = guild.channels.cache.find((item) => item.name === CHANNEL.ticketTranscript)
    || guild.channels.cache.find((item) => item.name === CHANNEL.ticketLog);
  if (!channel) return;

  await channel.send({
    embeds: [
      embedBase()
        .setTitle('🔒 Ticket Closed')
        .setDescription(`Ticket #${ticket.id} ditutup oleh <@${closedBy}>.`)
        .addFields(
          { name: 'Type', value: ticket.type, inline: true },
          { name: 'Opener', value: `<@${ticket.opener_id}>`, inline: true }
        )
    ],
    files: [new AttachmentBuilder(Buffer.from(transcript.html), { name: transcript.fileName })]
  });
}

async function closeTicketChannel(channel, ticket, closedBy, options = {}) {
  const transcript = await buildTranscript(channel, ticket);
  const opener = await client.users.fetch(ticket.opener_id).catch(() => null);

  await sendTranscriptLog(channel.guild, ticket, transcript, closedBy);

  if (opener && !options.skipDm) {
    await opener.send({
      embeds: [
        embedBase()
          .setTitle('🔒 Your Ticket Was Closed')
          .setDescription(`Ticket kamu di **${config.storeName}** sudah ditutup.`)
          .addFields(
            { name: 'Ticket', value: `#${ticket.id}`, inline: true },
            { name: 'Closed by', value: `<@${closedBy}>`, inline: true }
          )
      ],
      files: [new AttachmentBuilder(Buffer.from(transcript.html), { name: transcript.fileName })]
    }).catch(() => null);
  }

  await supabase
    .from('tickets')
    .update({ status: options.status || 'closed', closed_at: new Date().toISOString() })
    .eq('id', ticket.id);

  await channel.send('Ticket akan ditutup dalam 8 detik.');
  setTimeout(() => channel.delete('Ticket closed by WS Store bot').catch(() => null), 8000);
  return transcript;
}

async function completeTicket(interaction) {
  const ticketId = interaction.customId.split(':').at(-1);
  const product = interaction.fields.getTextInputValue('product');
  const amountRaw = interaction.fields.getTextInputValue('amount');
  const paymentMethod = interaction.fields.getTextInputValue('payment');
  const note = interaction.fields.getTextInputValue('note') || null;
  const amount = Number(amountRaw.replace(/[^\d]/g, ''));

  if (!amount || Number.isNaN(amount)) {
    await interaction.reply({ content: 'Nominal tidak valid. Isi angka rupiah, contoh: 1250000.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const { data: ticket } = await supabase
    .from('tickets')
    .select('*')
    .eq('id', ticketId)
    .maybeSingle();

  if (!ticket) {
    await interaction.editReply('Ticket tidak ditemukan.');
    return;
  }

  const buyer = await client.users.fetch(ticket.opener_id);

  const { data: transaction, error } = await supabase
    .from('transactions')
    .insert({
      ticket_id: ticket.id,
      buyer_id: ticket.opener_id,
      buyer_tag: buyer.tag,
      product,
      amount,
      payment_method: paymentMethod,
      handled_by: interaction.user.id,
      note
    })
    .select('*')
    .single();

  if (error) throw error;

  await supabase
    .from('tickets')
    .update({ status: 'completed', total_amount: amount })
    .eq('id', ticket.id);

  const { totalSpent, tier } = await updateCustomerAndRoles(interaction.guild, ticket.opener_id, buyer.tag, amount);
  await postTransaction(interaction.guild, transaction, ticket.opener_id, totalSpent, tier);

  await interaction.channel.send({
    embeds: [
      embedBase()
        .setTitle('✅ Order Selesai')
        .setDescription(`Order <@${ticket.opener_id}> berhasil diselesaikan. Invoice dikirim ke DM pembeli dan transaksi masuk ke channel transaction.`)
    ]
  });

  const transcript = await buildTranscript(interaction.channel, ticket);
  await sendInvoiceDm({ user: buyer, transaction, totalSpent, tier, transcript });
  await sendTranscriptLog(interaction.guild, ticket, transcript, interaction.user.id);

  await supabase
    .from('tickets')
    .update({ status: 'completed', closed_at: new Date().toISOString() })
    .eq('id', ticket.id);

  await interaction.editReply('Order selesai, invoice DM terkirim jika DM pembeli terbuka, dan ticket akan ditutup.');
  await interaction.channel.send('Ticket akan ditutup dalam 8 detik.');
  setTimeout(() => interaction.channel.delete('Order completed by WS Store bot').catch(() => null), 8000);
}

async function closeTicket(interaction) {
  if (!memberIsStaff(interaction.member)) {
    await interaction.reply({ content: 'Hanya staff yang bisa close ticket.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const { data: ticket } = await supabase
    .from('tickets')
    .select('*')
    .eq('channel_id', interaction.channelId)
    .maybeSingle();

  if (!ticket) {
    await interaction.editReply('Ticket tidak ditemukan di database.');
    return;
  }

  await closeTicketChannel(interaction.channel, ticket, interaction.user.id);
  await interaction.editReply('Ticket ditutup dan transcript dikirim.');
}

async function addManualTransaction(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const buyer = interaction.options.getUser('buyer', true);
  const amount = interaction.options.getInteger('amount', true);
  const product = interaction.options.getString('product', true);
  const payment = interaction.options.getString('payment') || 'Manual';

  const { data: transaction, error } = await supabase
    .from('transactions')
    .insert({
      buyer_id: buyer.id,
      buyer_tag: buyer.tag,
      product,
      amount,
      payment_method: payment,
      handled_by: interaction.user.id,
      note: 'Manual transaction from slash command'
    })
    .select('*')
    .single();

  if (error) throw error;

  const { totalSpent, tier } = await updateCustomerAndRoles(interaction.guild, buyer.id, buyer.tag, amount);
  await postTransaction(interaction.guild, transaction, buyer.id, totalSpent, tier);
  await sendInvoiceDm({ user: buyer, transaction, totalSpent, tier });

  await interaction.editReply(`Transaksi manual berhasil. Total ${buyer.tag}: ${formatRupiah(totalSpent)} (${tier?.name || 'Customer'}).`);
}

async function showCustomer(interaction) {
  const user = interaction.options.getUser('user') || interaction.user;
  const { data } = await supabase
    .from('customers')
    .select('*')
    .eq('discord_user_id', user.id)
    .maybeSingle();

  await interaction.reply({
    embeds: [
      embedBase()
        .setTitle('🛒 Customer Profile')
        .addFields(
          { name: 'User', value: `<@${user.id}>`, inline: true },
          { name: 'Total Belanja', value: formatRupiah(data?.total_spent || 0), inline: true },
          { name: 'Tier', value: data?.tier || 'Belum ada tier', inline: true }
        )
    ],
    flags: MessageFlags.Ephemeral
  });
}

client.on('messageCreate', async (message) => {
  try {
    if (!message.guild || message.author.bot || !message.member) return;
    if (memberIsStaff(message.member)) return;

    const now = Date.now();
    const bucket = getSpamBucket(message);
    const rapidCount = pruneSpamTimestamps(bucket.timestamps, SPAM_SETTINGS.rapidWindowMs, now).length;
    const normalCount = bucket.timestamps.length;
    const hasActiveWarning = bucket.warnedAt && now - bucket.warnedAt <= SPAM_SETTINGS.warningExpiresMs;
    const actionCooldown = now - bucket.lastActionAt < 5_000;

    if (actionCooldown) return;

    if (rapidCount >= SPAM_SETTINGS.rapidMaxMessages) {
      bucket.lastActionAt = now;
      bucket.timestamps = [];
      await timeoutForSpam(message, 'spam terlalu cepat');
      return;
    }

    if (normalCount >= SPAM_SETTINGS.maxMessages) {
      bucket.lastActionAt = now;
      bucket.timestamps = [];

      if (hasActiveWarning) {
        await timeoutForSpam(message, 'mengulang spam setelah peringatan');
        bucket.warnedAt = 0;
        return;
      }

      bucket.warnedAt = now;
      await deleteRecentSpamMessages(message);
      await sendSpamNotice(message, 'jangan spam. Ini peringatan pertama. Jika mengulang, kamu akan terkena timeout 5 menit.');
    }
  } catch (error) {
    console.warn('Anti-spam handler failed:', error.message);
  }
});

client.on('guildMemberAdd', async (member) => {
  const role = member.guild.roles.cache.find((item) => item.name === ROLE.unverified);
  if (role) await member.roles.add(role).catch(() => null);
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'setup-server') await setupServer(interaction);
      if (interaction.commandName === 'refresh-panels') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await refreshPanels(interaction.guild);
        await interaction.editReply('Panel ticket sudah direfresh.');
      }
      if (interaction.commandName === 'add-transaction') await addManualTransaction(interaction);
      if (interaction.commandName === 'customer') await showCustomer(interaction);
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'verify:member') await handleVerify(interaction);
      if (interaction.customId.startsWith('ticket:create:')) await createTicket(interaction, interaction.customId.split(':').at(-1));
      if (interaction.customId === 'ticket:claim') await claimTicket(interaction);
      if (interaction.customId === 'ticket:payment' || interaction.customId === 'payment:qris') await interaction.reply(qrisReplyPayload());
      if (interaction.customId === 'ticket:complete') await showCompleteModal(interaction);
      if (interaction.customId === 'ticket:close') await closeTicket(interaction);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket:complete-modal:')) {
      await completeTicket(interaction);
    }
  } catch (error) {
    console.error(error);
    const message = 'Terjadi error di bot. Cek console/log server bot.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message).catch(() => null);
    } else {
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => null);
    }
  }
});

client.once('ready', async () => {
  console.log(`${client.user.tag} online for ${config.storeName}.`);
  await keepSupabaseAwake().catch((error) => console.warn('Supabase heartbeat failed:', error.message));

  const guild = await client.guilds.fetch(config.guildId).catch(() => null);
  if (guild) await refreshPanels(guild).catch((error) => console.warn('Panel refresh failed:', error.message));

  setInterval(async () => {
    await keepSupabaseAwake().catch((error) => console.warn('Supabase heartbeat failed:', error.message));
  }, 24 * 60 * 60 * 1000);

  setInterval(async () => {
    const targetGuild = await client.guilds.fetch(config.guildId).catch(() => null);
    if (targetGuild) await refreshPanels(targetGuild).catch((error) => console.warn('Panel refresh failed:', error.message));
  }, 60 * 1000);
});

function shutdown(signal) {
  console.log(`Received ${signal}; shutting down Discord client.`);
  client.destroy();
  healthServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

await client.login(config.discordToken);

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
import { existsSync } from 'node:fs';
import { config } from './config.js';
import { CATEGORY, CHANNEL, REKBER_IMAGE_PATH, ROLE, SERVICE_DEFINITIONS, SPAM_SETTINGS, TICKET_SERVICE_TYPES, TIER_ROLES, VERIFIED_ROLE_ALIASES, VERIFY_IMAGE_PATH } from './constants.js';
import { keepSupabaseAwake, supabase } from './db.js';
import { createAntiSpamFeature } from './features/anti-spam.js';
import { createGiveawayFeature } from './features/giveaways.js';
import { howToOrderPanelPayload, rulesPanelPayload } from './features/info-panels.js';
import { createInviteTrackerFeature } from './features/invite-tracker.js';
import { itemTumbalTradePayload, valueUpdatePayload, viaLoginPricePayload, viaUsernamePricePayload } from './features/market.js';
import { startHealthServer } from './health.js';
import { formatRupiah, getStoreDateKey, getStoreHour, isStoreOpen, operatingStatusText } from './time.js';

const serviceStatusCache = new Map();
const panelTextOverrideCache = new Map();
let lastStoreOpenState = null;
let panelTextOverrideSchemaWarningShown = false;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
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

function findRoleByNames(guild, names) {
  return guild.roles.cache.find((role) => names.includes(role.name));
}

function findVerifiedRole(guild) {
  return findRoleByNames(guild, [ROLE.client, ...VERIFIED_ROLE_ALIASES]);
}

function memberIsVerified(member) {
  return member.roles.cache.some((role) => [ROLE.client, ...VERIFIED_ROLE_ALIASES].includes(role.name));
}

function memberIsStaff(member) {
  return member.permissions.has(PermissionFlagsBits.Administrator)
    || staffRoleNames().some((roleName) => member.roles.cache.some((role) => role.name === roleName));
}

function memberIsOwner(member, userId) {
  return userId === config.ownerDiscordId
    || member.roles.cache.some((role) => role.name === ROLE.owner);
}

function serviceCacheKey(guildId, service) {
  return `${guildId}:${service}`;
}

function panelTextOverrideKey(guildId, type) {
  return `${guildId}:${type}`;
}

function panelTextOverride(guildId, type) {
  return panelTextOverrideCache.get(panelTextOverrideKey(guildId, type)) || {};
}

function isPanelTextOverrideSchemaMissing(error) {
  const message = error?.message || '';
  return error?.code === 'PGRST205'
    || message.includes("Could not find the table 'public.panel_text_overrides'")
    || message.includes('schema cache');
}

function normalizeServiceName(service) {
  return service === 'via_login' ? 'via-login'
    : service === 'via_username' ? 'via-username'
    : service === 'group_payout' ? 'group-payout'
      : service === 'gift_gamepass' ? 'gift-gamepass'
        : service;
}

function serviceIsOpen(guildId, service) {
  const normalized = normalizeServiceName(service);
  const cached = serviceStatusCache.get(serviceCacheKey(guildId, normalized));
  return cached?.isOpen ?? true;
}

function serviceManualOverrideIsActive(updatedAt, date = new Date()) {
  if (!updatedAt) return false;

  const updatedDate = new Date(updatedAt);
  const updatedDateKey = getStoreDateKey(updatedDate);
  const currentDateKey = getStoreDateKey(date);
  const yesterdayDateKey = getStoreDateKey(new Date(date.getTime() - 24 * 60 * 60 * 1000));
  const updatedHour = getStoreHour(updatedDate);
  const currentHour = getStoreHour(date);

  if (currentHour >= config.openHour && currentHour < config.closeHour) {
    return updatedDateKey === currentDateKey && updatedHour >= config.openHour;
  }

  if (currentHour >= config.closeHour) {
    return updatedDateKey === currentDateKey && updatedHour >= config.closeHour;
  }

  return (updatedDateKey === yesterdayDateKey && updatedHour >= config.closeHour)
    || (updatedDateKey === currentDateKey && updatedHour < config.openHour);
}

function serviceStatusIsSet(guildId, service) {
  const normalized = normalizeServiceName(service);
  const cached = serviceStatusCache.get(serviceCacheKey(guildId, normalized));
  return serviceManualOverrideIsActive(cached?.updatedAt);
}

function ticketServiceIsAvailable(guildId, type) {
  if (type === 'rekber') return true;
  if (serviceStatusIsSet(guildId, type)) return serviceIsOpen(guildId, type);
  return isStoreOpen();
}

async function loadServiceStatuses(guildId) {
  const { data, error } = await supabase
    .from('service_statuses')
    .select('service,is_open,updated_at')
    .eq('guild_id', guildId);

  if (error) {
    console.warn('Failed to load service statuses:', error.message);
    return;
  }

  for (const key of serviceStatusCache.keys()) {
    if (key.startsWith(`${guildId}:`)) serviceStatusCache.delete(key);
  }

  for (const row of data || []) {
    const service = normalizeServiceName(row.service);
    serviceStatusCache.set(serviceCacheKey(guildId, service), {
      isOpen: Boolean(row.is_open),
      updatedAt: row.updated_at
    });
  }
}

async function loadPanelTextOverrides(guildId) {
  const { data, error } = await supabase
    .from('panel_text_overrides')
    .select('type,title,description')
    .eq('guild_id', guildId);

  if (error) {
    if (isPanelTextOverrideSchemaMissing(error)) {
      if (!panelTextOverrideSchemaWarningShown) {
        console.warn('panel_text_overrides table is missing. Run the latest Supabase schema to enable editable panel text.');
        panelTextOverrideSchemaWarningShown = true;
      }
      return;
    }

    console.warn('Failed to load panel text overrides:', error.message);
    return;
  }

  for (const key of panelTextOverrideCache.keys()) {
    if (key.startsWith(`${guildId}:`)) panelTextOverrideCache.delete(key);
  }

  for (const row of data || []) {
    panelTextOverrideCache.set(panelTextOverrideKey(guildId, row.type), {
      title: row.title || undefined,
      description: row.description || undefined
    });
  }
}

function statusChannelName(service, isOpen) {
  const definition = SERVICE_DEFINITIONS[service];
  const statusIcon = isOpen ? '🟢' : '🔴';
  return `${statusIcon}｜${definition.voiceStatsLabel || definition.statsLabel}`;
}

function serviceStatusNameKeys(definition) {
  return [...new Set([
    definition.statsLabel,
    definition.voiceStatsLabel,
    definition.label,
    ...(definition.voiceAliases || [])
  ].filter(Boolean).map((item) => channelNameKey(item)))];
}

async function updateServiceStatus(guild, service, isOpen, updatedBy) {
  const normalized = normalizeServiceName(service);

  if (!SERVICE_DEFINITIONS[normalized]) {
    throw new Error(`Unknown service: ${service}`);
  }

  const { error } = await supabase
    .from('service_statuses')
    .upsert({
      guild_id: guild.id,
      service: normalized,
      is_open: isOpen,
      updated_by: updatedBy
    }, { onConflict: 'guild_id,service' });

  if (error) throw error;

  serviceStatusCache.set(serviceCacheKey(guild.id, normalized), {
    isOpen,
    updatedAt: new Date().toISOString()
  });
}

function refreshGuildUiInBackground(guild, reason) {
  setImmediate(async () => {
    try {
      await refreshServerStats(guild);
      await refreshPanels(guild);
    } catch (error) {
      console.warn(`${reason} refresh failed:`, error.message);
    }
  });
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
  const available = ticketServiceIsAvailable(config.guildId, type);
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
    .setDisabled(!available);
}

function ticketPanelPayload(type) {
  const description = {
    order: 'Klik tombol di bawah untuk membeli produk WS Store. Ticket hanya dapat dibuka saat jam operasional.',
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
  const statusText = type === 'rekber'
    ? `OPEN | Rekber selalu bisa dibuka. Jam operasional store ${String(config.openHour).padStart(2, '0')}:00-${String(config.closeHour).padStart(2, '0')}:00 ${config.timezoneLabel}`
    : serviceStatusIsSet(config.guildId, type)
      ? `${serviceIsOpen(config.guildId, type) ? 'OPEN' : 'CLOSED'} | Status diatur manual oleh staff. Jam normal ${String(config.openHour).padStart(2, '0')}:00-${String(config.closeHour).padStart(2, '0')}:00 ${config.timezoneLabel}`
      : operatingStatusText();

  const embed = embedBase()
    .setTitle(`🎟️ ${ticketTypeLabel(type)}`)
    .setDescription(`${description[type]}\n\n${statusText}`);
  const payload = {
    embeds: [
      embed
    ],
    components: [new ActionRowBuilder().addComponents(ticketOpenButton(type))]
  };

  if (type === 'rekber' && existsSync(REKBER_IMAGE_PATH)) {
    embed.setImage('attachment://ws-store-rekber.png');
    payload.files = [new AttachmentBuilder(REKBER_IMAGE_PATH, { name: 'ws-store-rekber.png' })];
  }

  return payload;
}

function verifyPanelPayload() {
  const hasVerifyImage = existsSync(VERIFY_IMAGE_PATH);
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
    payload.files = [new AttachmentBuilder(VERIFY_IMAGE_PATH, { name: 'ws-store-verify-banner.png' })];
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

function getTier(totalSpent) {
  return TIER_ROLES.find((tier) => totalSpent >= tier.min) || null;
}

async function ensureRole(guild, name, options = {}) {
  const existing = guild.roles.cache.find((role) => role.name === name);
  if (existing) return existing;

  const aliasMatch = options.aliases?.map((alias) => guild.roles.cache.find((role) => role.name === alias)).find(Boolean);
  if (aliasMatch) {
    await aliasMatch.setName(name).catch(() => null);
    return aliasMatch;
  }

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
    (channel) => channel.type === ChannelType.GuildCategory && channelMatchesName(channel, name)
  );
  if (existing) {
    if (existing.name !== name) await existing.setName(name).catch(() => null);
    if (permissionOverwrites.length) await existing.permissionOverwrites.set(permissionOverwrites).catch(() => null);
    return existing;
  }

  return guild.channels.create({
    name,
    type: ChannelType.GuildCategory,
    permissionOverwrites
  });
}

function channelNameKey(name) {
  return String(name)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f\ufe0e\ufe0f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

function channelMatchesName(channel, name) {
  return channel.name === name || channelNameKey(channel.name) === channelNameKey(name);
}

function findManagedChannel(guild, type, name, parent) {
  const matches = guild.channels.cache.filter(
    (channel) => channel.type === type && channelMatchesName(channel, name)
  );

  if (!matches.size) return null;
  if (parent) return matches.find((channel) => channel.parentId === parent.id) || null;
  return matches.first();
}

async function ensureTextChannel(guild, name, parent, permissionOverwrites = []) {
  const existing = findManagedChannel(guild, ChannelType.GuildText, name, parent);
  if (existing) {
    if (existing.name !== name) await existing.setName(name).catch(() => null);
    if (permissionOverwrites.length) await existing.permissionOverwrites.set(permissionOverwrites).catch(() => null);
    return existing;
  }

  return guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent,
    permissionOverwrites
  });
}

async function ensureAnnouncementChannel(guild, name, parent, permissionOverwrites = []) {
  const existingAnnouncement = findManagedChannel(guild, ChannelType.GuildAnnouncement, name, parent);
  if (existingAnnouncement) {
    if (existingAnnouncement.name !== name) await existingAnnouncement.setName(name).catch(() => null);
    if (permissionOverwrites.length) await existingAnnouncement.permissionOverwrites.set(permissionOverwrites).catch(() => null);
    return existingAnnouncement;
  }

  const existingText = findManagedChannel(guild, ChannelType.GuildText, name, parent);
  if (existingText) {
    try {
      const converted = await existingText.setType(ChannelType.GuildAnnouncement);
      if (converted.name !== name) await converted.setName(name).catch(() => null);
      if (permissionOverwrites.length) await converted.permissionOverwrites.set(permissionOverwrites).catch(() => null);
      return converted;
    } catch {
      // Keep the text channel intact and create a new announcement channel below.
    }
  }

  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildAnnouncement,
    parent,
    permissionOverwrites
  });
  return channel;
}

async function ensureVoiceChannel(guild, name, parent, permissionOverwrites = []) {
  const existing = findManagedChannel(guild, ChannelType.GuildVoice, name, parent);
  if (existing) {
    if (existing.name !== name) await existing.setName(name).catch(() => null);
    if (permissionOverwrites.length) await existing.permissionOverwrites.set(permissionOverwrites).catch(() => null);
    return existing;
  }

  return guild.channels.create({
    name,
    type: ChannelType.GuildVoice,
    parent,
    permissionOverwrites
  });
}

const {
  handleGiveawayCommand,
  handleGiveawayJoin,
  endDueGiveaways
} = createGiveawayFeature({
  client,
  supabase,
  embedBase,
  memberIsStaff,
  channelMatchesName,
  giveawayChannelName: CHANNEL.giveaways
});

const { handleMessageCreate } = createAntiSpamFeature({
  settings: SPAM_SETTINGS,
  memberIsStaff
});

const {
  refreshInviteCache,
  handleGuildMemberAdd,
  handleInviteCreate,
  handleInviteDelete
} = createInviteTrackerFeature({
  channelMatchesName,
  unverifiedRoleName: ROLE.unverified,
  welcomeChannelName: CHANNEL.welcome
});

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
      if (data.channel_id !== channel.id) {
        await oldMessage.delete().catch(() => null);
        throw new Error('Panel moved to another channel');
      }
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

function managedPanelPayload(guildId, type) {
  const overrides = panelTextOverride(guildId, type);
  const panelPayloads = {
    verify: () => verifyPanelPayload(),
    ticket_order: () => ticketPanelPayload('order'),
    ticket_rekber: () => ticketPanelPayload('rekber'),
    ticket_support: () => ticketPanelPayload('support'),
    market_value_update: () => valueUpdatePayload(embedBase, overrides),
    market_item_tumbal_trade: () => itemTumbalTradePayload(embedBase, overrides),
    price_via_login: () => viaLoginPricePayload(embedBase, overrides),
    price_via_username: () => viaUsernamePricePayload(embedBase, overrides),
    seed_rules: () => rulesPanelPayload(embedBase),
    seed_how_to_order: () => howToOrderPanelPayload(embedBase)
  };

  return panelPayloads[type]?.();
}

function editablePanelTypes() {
  return new Set([
    'market_value_update',
    'market_item_tumbal_trade',
    'price_via_login',
    'price_via_username'
  ]);
}

async function refreshServerStats(guild) {
  const everyone = guild.roles.everyone;
  const clientRole = findVerifiedRole(guild);
  const ownerRole = guild.roles.cache.find((role) => role.name === ROLE.owner);
  const adminRole = guild.roles.cache.find((role) => role.name === ROLE.admin);

  const announcementOverwrites = [
    { id: everyone.id, deny: [PermissionsBitField.Flags.SendMessages], allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory] }
  ];
  if (clientRole) {
    announcementOverwrites.push({ id: clientRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory], deny: [PermissionsBitField.Flags.SendMessages] });
  }
  if (ownerRole) {
    announcementOverwrites.push({ id: ownerRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory], deny: [PermissionsBitField.Flags.SendMessages] });
  }
  if (adminRole) {
    announcementOverwrites.push({ id: adminRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory], deny: [PermissionsBitField.Flags.SendMessages] });
  }

  const statsVoiceOverwrites = [
    { id: everyone.id, deny: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect] }
  ];
  if (clientRole) {
    statsVoiceOverwrites.push({
      id: clientRole.id,
      allow: [PermissionsBitField.Flags.ViewChannel],
      deny: [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak]
    });
  }
  if (ownerRole) {
    statsVoiceOverwrites.push({
      id: ownerRole.id,
      allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak]
    });
  }
  if (adminRole) {
    statsVoiceOverwrites.push({
      id: adminRole.id,
      allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak]
    });
  }
  if (config.ownerDiscordId) {
    statsVoiceOverwrites.push({
      id: config.ownerDiscordId,
      allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak]
    });
  }

  const statsCategory = await ensureCategory(guild, CATEGORY.stats, announcementOverwrites);
  await ensureAnnouncementChannel(guild, '📢・announcement-server', statsCategory, announcementOverwrites);

  for (const service of Object.keys(SERVICE_DEFINITIONS)) {
    const definition = SERVICE_DEFINITIONS[service];
    if (!definition.showInStats) continue;

    const serviceNameKeys = serviceStatusNameKeys(definition);
    const candidates = [...guild.channels.cache.values()]
      .filter((channel) =>
        channel.type === ChannelType.GuildVoice
        && channel.parentId === statsCategory.id
        && serviceNameKeys.some((serviceNameKey) => channelNameKey(channel.name).includes(serviceNameKey))
      )
      .sort((left, right) => (left.rawPosition ?? left.position ?? 0) - (right.rawPosition ?? right.position ?? 0));
    const desiredName = statusChannelName(service, serviceIsOpen(guild.id, service));
    const current = candidates.find((channel) => channelMatchesName(channel, desiredName)) || candidates[0];

    if (current) {
      if (current.name !== desiredName) await current.setName(desiredName).catch(() => null);
      await current.permissionOverwrites.set(statsVoiceOverwrites).catch(() => null);
    } else {
      await ensureVoiceChannel(guild, desiredName, statsCategory, statsVoiceOverwrites);
    }
  }
}

function storeStatusAnnouncementPayload(guild, storeOpen) {
  const verifiedRole = findVerifiedRole(guild);
  const mention = verifiedRole ? `<@&${verifiedRole.id}>` : '';
  const title = storeOpen ? '🟢 OPEN ORDER!' : '🔴 CLOSE ORDER!';
  const description = storeOpen
    ? [
      `WS Store sudah **OPEN** untuk order hari ini.`,
      '',
      `Silakan cek pricelist dan buka ticket sesuai kebutuhan kamu.`,
      `Jam operasional ${String(config.openHour).padStart(2, '0')}:00-${String(config.closeHour).padStart(2, '0')}:00 ${config.timezoneLabel}.`,
      '',
      '**Selamat berbelanja dengan harga terjangkau.**'
    ]
    : [
      `WS Store sudah **CLOSE** untuk order reguler hari ini.`,
      '',
      `Open kembali besok ${String(config.openHour).padStart(2, '0')}:00 ${config.timezoneLabel} - ${String(config.closeHour).padStart(2, '0')}:00 ${config.timezoneLabel}.`,
      '',
      `Terima kasih banyak untuk semua yang sudah berbelanja hari ini di **${config.storeName}**.`,
      '',
      '**Good Night**'
    ];

  const embed = embedBase()
    .setTitle(title)
    .setDescription(description.join('\n'))
    .setColor(storeOpen ? 0x2ecc71 : 0xe74c3c);

  if (client.user) embed.setThumbnail(client.user.displayAvatarURL());

  return {
    content: mention || undefined,
    embeds: [embed],
    allowedMentions: verifiedRole ? { roles: [verifiedRole.id] } : { parse: [] }
  };
}

async function sendStoreStatusAnnouncement(guild, storeOpen) {
  const channel = guild.channels.cache.find((item) => channelMatchesName(item, '📢・announcement-server'));
  if (!channel?.send) return;

  await channel.send(storeStatusAnnouncementPayload(guild, storeOpen)).catch((error) => {
    console.warn('Store status announcement failed:', error.message);
  });
}

async function checkStoreStatusAnnouncement(guild, options = {}) {
  const currentState = isStoreOpen();
  if (lastStoreOpenState === null) {
    lastStoreOpenState = currentState;
    if (options.announceInitial) await sendStoreStatusAnnouncement(guild, currentState);
    return;
  }

  if (currentState === lastStoreOpenState) return;

  lastStoreOpenState = currentState;
  await sendStoreStatusAnnouncement(guild, currentState);
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
  await interaction.editReply('Setup server sedang diproses. Bot sedang merapikan role, permission, channel, dan panel...');

  const ownerRole = await ensureRole(guild, ROLE.owner, { color: 0xf1c40f, hoist: true });
  const adminRole = await ensureRole(guild, ROLE.admin, {
    color: 0xe74c3c,
    hoist: true,
    permissions: [PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ManageMessages]
  });
  const middlemanRole = await ensureRole(guild, ROLE.middleman, { color: 0x1abc9c, hoist: true });
  const rolimonsBotRole = await ensureRole(guild, ROLE.rolimonsBot, { color: 0x3498db });
  await ensureRole(guild, ROLE.creator, { color: 0x9b59b6 });
  await ensureRole(guild, ROLE.booster, { color: 0xff73fa });
  await ensureRole(guild, ROLE.customer, { color: 0x2ecc71 });
  const clientRole = await ensureRole(guild, ROLE.client, { color: 0x3498db, aliases: VERIFIED_ROLE_ALIASES });
  const unverifiedRole = await ensureRole(guild, ROLE.unverified, { color: 0x7f8c8d });

  for (const tier of TIER_ROLES) {
    await ensureRole(guild, tier.name, { color: 0x00d2ff, hoist: true, aliases: tier.aliases });
  }

  const everyone = guild.roles.everyone;

  const staffAllow = [
    { id: ownerRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
    { id: adminRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
    { id: middlemanRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
  ];

  const ownerAdminPublish = [
    { id: everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: clientRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory], deny: [PermissionsBitField.Flags.SendMessages] },
    { id: ownerRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
    { id: adminRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
    { id: middlemanRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory], deny: [PermissionsBitField.Flags.SendMessages] }
  ];

  const valueUpdatePublish = [
    ...ownerAdminPublish,
    {
      id: rolimonsBotRole.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.EmbedLinks,
        PermissionsBitField.Flags.AttachFiles
      ]
    }
  ];

  const publicReadOnly = [
    { id: everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: clientRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory], deny: [PermissionsBitField.Flags.SendMessages] },
    ...staffAllow
  ];

  const transactionReadOnly = [
    { id: everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: clientRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AddReactions], deny: [PermissionsBitField.Flags.SendMessages] },
    { id: ownerRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AddReactions] },
    { id: adminRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AddReactions], deny: [PermissionsBitField.Flags.SendMessages] },
    { id: middlemanRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AddReactions], deny: [PermissionsBitField.Flags.SendMessages] }
  ];

  const publicChat = [
    { id: everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: clientRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
    ...staffAllow
  ];

  const staffOnly = [
    { id: everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: clientRole.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    ...staffAllow
  ];

  const publicVoice = [
    { id: everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: clientRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak] },
    { id: ownerRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak] },
    { id: adminRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak] }
  ];

  const welcomeReadOnly = [
    { id: everyone.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory], deny: [PermissionsBitField.Flags.SendMessages] },
    { id: clientRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory], deny: [PermissionsBitField.Flags.SendMessages] },
    ...staffAllow
  ];

  const gateCategory = await ensureCategory(guild, CATEGORY.gate, welcomeReadOnly);
  const infoCategory = await ensureCategory(guild, CATEGORY.info, ownerAdminPublish);
  const marketCategory = await ensureCategory(guild, CATEGORY.market, ownerAdminPublish);
  const ticketCategory = await ensureCategory(guild, CATEGORY.ticket, publicReadOnly);
  const activeTicketCategory = await ensureCategory(guild, CATEGORY.activeTicket, [
    { id: everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    ...staffAllow
  ]);
  const loungeCategory = await ensureCategory(guild, CATEGORY.lounge, publicChat);
  const transactionCategory = await ensureCategory(guild, CATEGORY.transaction, transactionReadOnly);
  const adminCategory = await ensureCategory(guild, CATEGORY.admin, [
    { id: everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: ownerRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
    { id: adminRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
  ]);

  await loadServiceStatuses(guild.id);
  await loadPanelTextOverrides(guild.id);
  await refreshServerStats(guild);

  await ensureTextChannel(guild, CHANNEL.welcome, gateCategory, welcomeReadOnly);
  const verifyChannel = await ensureTextChannel(guild, CHANNEL.verify, infoCategory, [
    { id: everyone.id, deny: [PermissionsBitField.Flags.SendMessages], allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory] },
    { id: unverifiedRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory], deny: [PermissionsBitField.Flags.SendMessages] },
    { id: clientRole.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    ...staffAllow
  ]);

  await ensureTextChannel(guild, '📢・announcements', infoCategory, ownerAdminPublish);
  await ensureTextChannel(guild, '📦・stock-update', infoCategory, ownerAdminPublish);
  const rulesChannel = await ensureTextChannel(guild, CHANNEL.rules, infoCategory, ownerAdminPublish);
  const howToOrderChannel = await ensureTextChannel(guild, CHANNEL.howToOrder, infoCategory, ownerAdminPublish);

  await ensureTextChannel(guild, '💵・gift-gamepass-all-map', marketCategory, ownerAdminPublish);
  await ensureTextChannel(guild, '🌟・stock-limited-item', marketCategory, ownerAdminPublish);
  const itemTumbalChannel = await ensureTextChannel(guild, '➤・item-tumbal-trade', marketCategory, ownerAdminPublish);
  const robuxChannel = await ensureTextChannel(guild, '💎・robux-instant-vilog', marketCategory, ownerAdminPublish);
  const viaUsernameChannel = await ensureTextChannel(guild, CHANNEL.robuxViaUsername, marketCategory, ownerAdminPublish);
  await ensureTextChannel(guild, '🌟・group-payout', marketCategory, ownerAdminPublish);
  const valueUpdateChannel = await ensureTextChannel(guild, CHANNEL.valueUpdate, marketCategory, valueUpdatePublish);

  const ticketOrderChannel = await ensureTextChannel(guild, CHANNEL.ticketOrder, ticketCategory, publicReadOnly);
  const ticketRekberChannel = await ensureTextChannel(guild, CHANNEL.ticketRekber, ticketCategory, publicReadOnly);
  const ticketSupportChannel = await ensureTextChannel(guild, CHANNEL.ticketSupport, ticketCategory, publicReadOnly);

  await ensureTextChannel(guild, '💬・chat', loungeCategory, publicChat);
  await ensureTextChannel(guild, '🏷️・check-payout', loungeCategory, publicChat);
  await ensureTextChannel(guild, '💎・check-tumbal-limited', loungeCategory, publicChat);
  await ensureTextChannel(guild, '❌・report-scammer', loungeCategory, publicChat);
  await ensureTextChannel(guild, '💬・chit-chat', loungeCategory, publicChat);
  await ensureTextChannel(guild, '🧾・vouches', loungeCategory, publicChat);
  await ensureTextChannel(guild, CHANNEL.giveaways, loungeCategory, publicReadOnly);
  await ensureVoiceChannel(guild, 'Room 1', loungeCategory, publicVoice);

  await ensureTextChannel(guild, CHANNEL.successTransaction, transactionCategory, transactionReadOnly);
  await ensureTextChannel(guild, '🧾・rekber-history', transactionCategory, transactionReadOnly);
  await ensureTextChannel(guild, CHANNEL.adminLog, adminCategory);
  await ensureTextChannel(guild, CHANNEL.ticketLog, adminCategory);
  await ensureTextChannel(guild, CHANNEL.ticketTranscript, adminCategory, staffOnly);
  await ensureTextChannel(guild, '💰・order-log', adminCategory);
  await ensureTextChannel(guild, '🚨・mod-log', adminCategory);

  await publishOrEditPanel(verifyChannel, 'verify', verifyPanelPayload());
  await publishOrEditPanel(ticketOrderChannel, 'ticket_order', ticketPanelPayload('order'));
  await publishOrEditPanel(ticketRekberChannel, 'ticket_rekber', ticketPanelPayload('rekber'));
  await publishOrEditPanel(ticketSupportChannel, 'ticket_support', ticketPanelPayload('support'));

  await publishOrEditPanel(valueUpdateChannel, 'market_value_update', managedPanelPayload(guild.id, 'market_value_update'));
  await publishOrEditPanel(itemTumbalChannel, 'market_item_tumbal_trade', managedPanelPayload(guild.id, 'market_item_tumbal_trade'));
  await publishOrEditPanel(robuxChannel, 'price_via_login', managedPanelPayload(guild.id, 'price_via_login'));
  await publishOrEditPanel(viaUsernameChannel, 'price_via_username', managedPanelPayload(guild.id, 'price_via_username'));

  await publishOrEditPanel(rulesChannel, 'seed_rules', rulesPanelPayload(embedBase));
  await publishOrEditPanel(howToOrderChannel, 'seed_how_to_order', howToOrderPanelPayload(embedBase));

  await interaction.editReply('Setup server selesai. Role, channel, verify, ticket, QRIS button, voice Room 1, server stats, welcome invite tracker, dan admin transcript sudah dibuat.');
}

async function refreshPanels(guild) {
  await loadPanelTextOverrides(guild.id);

  const { data: panels } = await supabase
    .from('ticket_panels')
    .select('*')
    .eq('guild_id', guild.id);

  for (const panel of panels || []) {
    const payload = managedPanelPayload(guild.id, panel.type);
    if (!payload) continue;

    try {
      const channel = await client.channels.fetch(panel.channel_id);
      const message = await channel.messages.fetch(panel.message_id);
      await message.edit(payload);
    } catch (error) {
      console.warn(`Failed to refresh panel ${panel.type}:`, error.message);
    }
  }
}

async function handleVerify(interaction) {
  const member = interaction.member;
  const clientRole = findVerifiedRole(interaction.guild);
  const unverifiedRole = interaction.guild.roles.cache.find((role) => role.name === ROLE.unverified);

  if (clientRole) await member.roles.add(clientRole).catch(() => null);
  if (unverifiedRole) await member.roles.remove(unverifiedRole).catch(() => null);

  await interaction.reply({
    content: 'Verifikasi berhasil. Selamat datang di WS Store Official!',
    flags: MessageFlags.Ephemeral
  });
}

async function createTicketForMember(interaction, type, openerMember, options = {}) {
  const { bypassStoreHours = false, openedByStaff = false } = options;
  const openerUser = openerMember.user;

  const { data: existing } = await supabase
    .from('tickets')
    .select('*')
    .eq('guild_id', interaction.guildId)
    .eq('opener_id', openerUser.id)
    .eq('type', type)
    .in('status', ['open', 'claimed'])
    .maybeSingle();

  if (existing?.channel_id) {
    return { existingChannelId: existing.channel_id };
  }

  const { data: ticket, error } = await supabase
    .from('tickets')
    .insert({
      type,
      guild_id: interaction.guildId,
      opener_id: openerUser.id,
      opener_tag: openerUser.tag
    })
    .select('*')
    .single();

  if (error) throw error;

  const activeCategory = interaction.guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildCategory && channel.name === CATEGORY.activeTicket
  );
  const overwrites = [
    { id: interaction.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: openerMember.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AttachFiles] }
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
    topic: `${ticketTypeLabel(type)} | opener:${openerUser.id} | ticket:${ticket.id}`,
    permissionOverwrites: overwrites
  });

  await supabase
    .from('tickets')
    .update({ channel_id: channel.id })
    .eq('id', ticket.id);

  await channel.send({
    content: `<@${openerUser.id}>`,
    embeds: [
      embedBase()
        .setTitle('🎟️ Ticket Created')
        .setDescription([
          `Hello <@${openerUser.id}>! Terima kasih telah membuka ticket.`,
          openedByStaff ? `Ticket ini dibukakan oleh staff <@${interaction.user.id}>.` : null,
          bypassStoreHours ? 'Catatan: ticket ini dibuka oleh staff di luar jam operasional.' : null,
          '',
          type === 'order'
            ? '**Form order:**\nProduk:\nJumlah:\nUsername Roblox:\nMetode pembayaran:\nCatatan:'
            : type === 'rekber'
              ? '**Form rekber:**\nBuyer/Seller:\nBarang transaksi:\nNominal:\nPihak lawan:\nBukti kesepakatan:'
              : '**Form support:**\nMasalah:\nOrder ID jika ada:\nBukti screenshot:\nPenjelasan:',
          '',
          'Silakan isi form di atas dan tunggu admin menerima ticket.'
        ].filter(Boolean).join('\n'))
    ],
    components: ticketControlRows(type)
  });

  return { channelId: channel.id };
}

async function createTicket(interaction, type) {
  if (!memberIsStaff(interaction.member) && !memberIsVerified(interaction.member)) {
    await interaction.reply({
      content: 'Kamu harus verify terlebih dahulu sebelum membuka ticket.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const isAlwaysOpenRekber = type === 'rekber';

  if (!isAlwaysOpenRekber && !ticketServiceIsAvailable(interaction.guildId, type)) {
    await interaction.reply({
      content: serviceStatusIsSet(interaction.guildId, type)
        ? `${ticketTypeLabel(type)} sedang closed. Silakan cek status server atau tunggu admin membuka kembali.`
        : `Store sedang closed. ${operatingStatusText()}`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await createTicketForMember(interaction, type, interaction.member);
  if (result.existingChannelId) {
    await interaction.editReply(`Kamu masih punya ticket aktif: <#${result.existingChannelId}>`);
    return;
  }

  await interaction.editReply(`Ticket berhasil dibuat: <#${result.channelId}>`);
}

async function openTicketForUser(interaction) {
  if (!memberIsStaff(interaction.member)) {
    await interaction.reply({
      content: 'Hanya staff yang bisa membuka ticket untuk member lain.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const targetUser = interaction.options.getUser('user', true);
  const type = interaction.options.getString('type', true);
  const openerMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

  if (!openerMember) {
    await interaction.reply({
      content: 'Member tidak ditemukan di server ini.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await createTicketForMember(interaction, type, openerMember, {
    bypassStoreHours: true,
    openedByStaff: true
  });

  if (result.existingChannelId) {
    await interaction.editReply(`<@${targetUser.id}> masih punya ticket aktif: <#${result.existingChannelId}>`);
    return;
  }

  await interaction.editReply(`Ticket ${ticketTypeLabel(type)} untuk <@${targetUser.id}> berhasil dibuat: <#${result.channelId}>`);
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
      .flatMap((item) => [item.name, ...(item.aliases || [])])
      .map((roleName) => guild.roles.cache.find((role) => role.name === roleName)?.id)
      .filter(Boolean);

    if (tierRoleIds.length) await member.roles.remove(tierRoleIds).catch(() => null);

    if (tier) {
      const tierRole = guild.roles.cache.find((role) => role.name === tier.name);
      if (tierRole) await member.roles.add(tierRole).catch(() => null);
    }
  }

  return { totalSpent, tier };
}

async function sendInvoiceDm({ user, transaction, totalSpent, tier }) {
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
    ]
  };

  await user.send(payload).catch(() => null);
}

async function postTransaction(guild, transaction, buyerId, totalSpent, tier) {
  const channel = guild.channels.cache.find((item) => channelMatchesName(item, CHANNEL.successTransaction));
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
  const channel = guild.channels.cache.find((item) => channelMatchesName(item, CHANNEL.ticketTranscript))
    || guild.channels.cache.find((item) => channelMatchesName(item, CHANNEL.ticketLog));
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
      ]
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
  await sendInvoiceDm({ user: buyer, transaction, totalSpent, tier });
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
  if (!memberIsStaff(interaction.member)) {
    await interaction.reply({
      content: 'Hanya staff yang bisa menambahkan transaksi manual.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

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

  if (user.id !== interaction.user.id && !memberIsStaff(interaction.member)) {
    await interaction.reply({
      content: 'Hanya staff yang bisa cek profile customer member lain.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

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

async function setPanelText(interaction) {
  if (!memberIsStaff(interaction.member)) {
    await interaction.reply({
      content: 'Hanya staff yang bisa mengubah teks panel.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const type = interaction.options.getString('panel', true);
  const description = interaction.options.getString('description', true);
  const title = interaction.options.getString('title') || null;

  if (!editablePanelTypes().has(type)) {
    await interaction.reply({
      content: 'Panel ini tidak bisa diedit lewat command.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const { error } = await supabase
    .from('panel_text_overrides')
    .upsert({
      guild_id: interaction.guildId,
      type,
      title,
      description,
      updated_by: interaction.user.id
    }, { onConflict: 'guild_id,type' });

  if (error) {
    if (isPanelTextOverrideSchemaMissing(error)) {
      await interaction.editReply('Table `panel_text_overrides` belum ada. Jalankan schema Supabase terbaru dulu, lalu coba lagi.');
      return;
    }
    throw error;
  }

  await interaction.editReply('Teks panel berhasil diupdate. Panel sedang direfresh di background.');
  refreshGuildUiInBackground(interaction.guild, 'Panel text');
}

async function resetPanelText(interaction) {
  if (!memberIsStaff(interaction.member)) {
    await interaction.reply({
      content: 'Hanya staff yang bisa reset teks panel.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const type = interaction.options.getString('panel', true);

  if (!editablePanelTypes().has(type)) {
    await interaction.reply({
      content: 'Panel ini tidak bisa direset lewat command.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const { error } = await supabase
    .from('panel_text_overrides')
    .delete()
    .eq('guild_id', interaction.guildId)
    .eq('type', type);

  if (error) {
    if (isPanelTextOverrideSchemaMissing(error)) {
      await interaction.editReply('Table `panel_text_overrides` belum ada. Jalankan schema Supabase terbaru dulu, lalu coba lagi.');
      return;
    }
    throw error;
  }

  await interaction.editReply('Teks panel sudah dikembalikan ke default. Panel sedang direfresh di background.');
  refreshGuildUiInBackground(interaction.guild, 'Panel text');
}

async function handleServiceStatusCommand(interaction, isOpen) {
  if (!memberIsStaff(interaction.member)) {
    await interaction.reply({
      content: 'Hanya admin atau owner yang bisa mengubah status service.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const service = interaction.options.getSubcommand();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (service === 'rekber') {
    await updateServiceStatus(interaction.guild, service, true, interaction.user.id);
    await interaction.editReply('Ticket rekber dibuat selalu OPEN. Proses tetap dibantu selagi admin / middleman sedang online.');
    refreshGuildUiInBackground(interaction.guild, 'Service status');
    return;
  }

  await updateServiceStatus(interaction.guild, service, isOpen, interaction.user.id);

  const label = SERVICE_DEFINITIONS[service].statsLabel;
  const statusText = isOpen ? 'OPEN 🟢' : 'CLOSED 🔴';
  await interaction.editReply(`${label} sekarang ${statusText}. Server stats dan tombol ticket sedang diperbarui di background.`);
  refreshGuildUiInBackground(interaction.guild, 'Service status');
}

client.on('messageCreate', async (message) => {
  try {
    await handleMessageCreate(message);
  } catch (error) {
    console.warn('Anti-spam handler failed:', error.message);
  }
});

client.on('guildMemberAdd', async (member) => {
  await handleGuildMemberAdd(member);
});

client.on('inviteCreate', handleInviteCreate);
client.on('inviteDelete', handleInviteDelete);

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'setup-server') await setupServer(interaction);
      if (interaction.commandName === 'refresh-panels') {
        if (!memberIsStaff(interaction.member)) {
          await interaction.reply({
            content: 'Hanya staff yang bisa refresh panel.',
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await refreshPanels(interaction.guild);
        await interaction.editReply('Semua panel WS Store yang terdaftar sudah direfresh.');
      }
      if (interaction.commandName === 'add-transaction') await addManualTransaction(interaction);
      if (interaction.commandName === 'customer') await showCustomer(interaction);
      if (interaction.commandName === 'open-ticket') await openTicketForUser(interaction);
      if (interaction.commandName === 'set-panel-text') await setPanelText(interaction);
      if (interaction.commandName === 'reset-panel-text') await resetPanelText(interaction);
      if (interaction.commandName === 'open') await handleServiceStatusCommand(interaction, true);
      if (interaction.commandName === 'close') await handleServiceStatusCommand(interaction, false);
      if (interaction.commandName === 'giveaway') await handleGiveawayCommand(interaction);
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'verify:member') await handleVerify(interaction);
      if (interaction.customId.startsWith('ticket:create:')) await createTicket(interaction, interaction.customId.split(':').at(-1));
      if (interaction.customId === 'ticket:claim') await claimTicket(interaction);
      if (interaction.customId === 'ticket:payment') await interaction.reply(qrisReplyPayload({ ephemeral: false }));
      if (interaction.customId === 'payment:qris') await interaction.reply(qrisReplyPayload({ ephemeral: true }));
      if (interaction.customId === 'ticket:complete') await showCompleteModal(interaction);
      if (interaction.customId === 'ticket:close') await closeTicket(interaction);
      if (interaction.customId.startsWith('giveaway:join:')) await handleGiveawayJoin(interaction, Number(interaction.customId.split(':').at(-1)));
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
  if (guild) {
    await loadServiceStatuses(guild.id).catch((error) => console.warn('Service status load failed:', error.message));
    await refreshInviteCache(guild).catch((error) => console.warn('Invite cache refresh failed:', error.message));
    await refreshServerStats(guild).catch((error) => console.warn('Server stats refresh failed:', error.message));
    await refreshPanels(guild).catch((error) => console.warn('Panel refresh failed:', error.message));
    await checkStoreStatusAnnouncement(guild).catch((error) => console.warn('Store status announcement check failed:', error.message));
    await endDueGiveaways().catch((error) => console.warn('Giveaway auto-end failed:', error.message));
  }

  setInterval(async () => {
    await keepSupabaseAwake().catch((error) => console.warn('Supabase heartbeat failed:', error.message));
  }, 24 * 60 * 60 * 1000);

  setInterval(async () => {
    const targetGuild = await client.guilds.fetch(config.guildId).catch(() => null);
    if (targetGuild) {
      await checkStoreStatusAnnouncement(targetGuild).catch((error) => console.warn('Store status announcement check failed:', error.message));
      await refreshServerStats(targetGuild).catch((error) => console.warn('Server stats refresh failed:', error.message));
      await refreshPanels(targetGuild).catch((error) => console.warn('Panel refresh failed:', error.message));
    }
  }, 60 * 1000);

  setInterval(async () => {
    await endDueGiveaways().catch((error) => console.warn('Giveaway auto-end failed:', error.message));
  }, 30 * 1000);
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

import { ChannelType, MessageFlags, PermissionsBitField } from 'discord.js';
import { config } from '../config/env.js';
import {
  CATEGORY,
  CHANNEL,
  ROLE,
  SERVICE_DEFINITIONS,
  TIER_ROLES,
  VERIFIED_ROLE_ALIASES
} from '../config/constants.js';
import { isStoreOpen } from '../libs/store-time.js';
import {
  channelMatchesName,
  channelNameKey,
  ensureAnnouncementChannel,
  ensureCategory,
  ensureRole,
  ensureTextChannel,
  ensureVoiceChannel
} from './discord-resource-service.js';

export function createServerManagementService({
  client,
  embedBase,
  findVerifiedRole,
  memberIsOwner,
  serviceIsOpen,
  loadServiceStatuses,
  loadPanelTextOverrides,
  publishOrEditPanel,
  managedPanelPayload,
  logger = console
}) {
  let lastStoreOpenState = null;

  function statusChannelName(service, isOpen) {
    const definition = SERVICE_DEFINITIONS[service];
    return `${isOpen ? '🟢' : '🔴'}｜${definition.voiceStatsLabel || definition.statsLabel}`;
  }

  function serviceStatusNameKeys(definition) {
    return [...new Set([
      definition.statsLabel,
      definition.voiceStatsLabel,
      definition.label,
      ...(definition.voiceAliases || [])
    ].filter(Boolean).map((item) => channelNameKey(item)))];
  }

  async function refreshServerStats(guild) {
    const everyone = guild.roles.everyone;
    const clientRole = findVerifiedRole(guild);
    const ownerRole = guild.roles.cache.find((role) => role.name === ROLE.owner);
    const adminRole = guild.roles.cache.find((role) => role.name === ROLE.admin);

    const announcementOverwrites = [
      {
        id: everyone.id,
        deny: [PermissionsBitField.Flags.SendMessages],
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory]
      }
    ];
    for (const role of [clientRole, ownerRole, adminRole]) {
      if (role) {
        announcementOverwrites.push({
          id: role.id,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory],
          deny: [PermissionsBitField.Flags.SendMessages]
        });
      }
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
    for (const role of [ownerRole, adminRole]) {
      if (role) {
        statsVoiceOverwrites.push({
          id: role.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.Connect,
            PermissionsBitField.Flags.Speak
          ]
        });
      }
    }
    if (config.ownerDiscordId) {
      statsVoiceOverwrites.push({
        id: config.ownerDiscordId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.Connect,
          PermissionsBitField.Flags.Speak
        ]
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
          && serviceNameKeys.some((key) => channelNameKey(channel.name).includes(key))
        )
        .sort((left, right) =>
          (left.rawPosition ?? left.position ?? 0) - (right.rawPosition ?? right.position ?? 0)
        );
      const desiredName = statusChannelName(service, serviceIsOpen(guild.id, service));
      const current = candidates.find((channel) => channelMatchesName(channel, desiredName)) || candidates[0];

      if (current) {
        try {
          if (current.name !== desiredName) await current.setName(desiredName);
          await current.permissionOverwrites.set(statsVoiceOverwrites);
        } catch (error) {
          logger.warn(`Failed to update server stat ${service}:`, error.message);
        }
      } else {
        await ensureVoiceChannel(guild, desiredName, statsCategory, statsVoiceOverwrites);
      }
    }
  }

  function storeStatusAnnouncementPayload(guild, storeOpen) {
    const verifiedRole = findVerifiedRole(guild);
    const mention = verifiedRole ? `<@&${verifiedRole.id}>` : '';
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
      .setTitle(storeOpen ? '🟢 OPEN ORDER!' : '🔴 CLOSE ORDER!')
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

    try {
      await channel.send(storeStatusAnnouncementPayload(guild, storeOpen));
    } catch (error) {
      logger.warn('Store status announcement failed:', error.message);
    }
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
    const clientRole = await ensureRole(guild, ROLE.client, {
      color: 0x3498db,
      aliases: VERIFIED_ROLE_ALIASES
    });
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
    await ensureCategory(guild, CATEGORY.activeTicket, [
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

    for (const name of ['💬・chat', '🏷️・check-payout', '❌・report-scammer', '🧾・vouches', CHANNEL.socialMedia]) {
      await ensureTextChannel(guild, name, loungeCategory, publicChat);
    }
    await ensureTextChannel(guild, CHANNEL.giveaways, loungeCategory, publicReadOnly);
    await ensureVoiceChannel(guild, 'Room 1', loungeCategory, publicVoice);
    await ensureTextChannel(guild, CHANNEL.successTransaction, transactionCategory, transactionReadOnly);
    await ensureTextChannel(guild, '🧾・rekber-history', transactionCategory, transactionReadOnly);
    await ensureTextChannel(guild, CHANNEL.adminLog, adminCategory);
    await ensureTextChannel(guild, CHANNEL.ticketLog, adminCategory);
    await ensureTextChannel(guild, CHANNEL.ticketTranscript, adminCategory, staffOnly);
    await ensureTextChannel(guild, '💰・order-log', adminCategory);
    await ensureTextChannel(guild, '🚨・mod-log', adminCategory);

    const panels = [
      [verifyChannel, 'verify'],
      [ticketOrderChannel, 'ticket_order'],
      [ticketRekberChannel, 'ticket_rekber'],
      [ticketSupportChannel, 'ticket_support'],
      [valueUpdateChannel, 'market_value_update'],
      [itemTumbalChannel, 'market_item_tumbal_trade'],
      [robuxChannel, 'price_via_login'],
      [viaUsernameChannel, 'price_via_username'],
      [rulesChannel, 'seed_rules'],
      [howToOrderChannel, 'seed_how_to_order']
    ];
    for (const [channel, type] of panels) {
      await publishOrEditPanel(channel, type, managedPanelPayload(guild.id, type));
    }

    await interaction.editReply('Setup server selesai. Role, channel, verify, ticket, QRIS button, voice Room 1, server stats, welcome invite tracker, dan admin transcript sudah dibuat.');
  }

  return {
    checkStoreStatusAnnouncement,
    refreshServerStats,
    setupServer
  };
}

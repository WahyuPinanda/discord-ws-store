import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  PermissionFlagsBits
} from 'discord.js';
import { existsSync } from 'node:fs';
import { config } from './config/env.js';
import { CATEGORY, CHANNEL, ORDER_TICKET_SERVICES, REKBER_IMAGE_PATH, ROLE, SERVICE_DEFINITIONS, SPAM_SETTINGS, TIER_ROLES, VERIFIED_ROLE_ALIASES, VERIFY_IMAGE_PATH } from './config/constants.js';
import { createAdminController } from './controllers/admin-controller.js';
import { createInteractionController } from './controllers/interaction-controller.js';
import { createTicketController } from './controllers/ticket-controller.js';
import { keepSupabaseAwake, supabase } from './libs/database.js';
import { startHealthServer } from './libs/health-server.js';
import { formatRupiah, getStoreDateKey, getStoreHour, isStoreOpen, operatingStatusText } from './libs/store-time.js';
import { unwrapSupabase } from './libs/supabase-result.js';
import { withInteractionErrorHandling } from './middlewares/interaction-error-handler.js';
import { registerDiscordEventRoutes } from './routes/discord-event-routes.js';
import { createAntiSpamFeature } from './services/anti-spam-service.js';
import { channelMatchesName } from './services/discord-resource-service.js';
import { createGiveawayFeature } from './services/giveaway-service.js';
import { howToOrderPanelPayload, rulesPanelPayload } from './services/info-panel-service.js';
import { createInviteTrackerFeature } from './services/invite-tracker-service.js';
import { itemTumbalTradePayload, valueUpdatePayload, viaLoginPricePayload, viaUsernamePricePayload } from './services/market-panel-service.js';
import { createPanelRegistryService, isPanelTextOverrideSchemaMissing } from './services/panel-registry-service.js';
import { createServerManagementService } from './services/server-management-service.js';
import { createServiceStatusFeature } from './services/service-status-service.js';
import { createTicketCreationFeature } from './services/ticket-creation-service.js';
import { createTicketPanelFeature } from './services/ticket-panel-service.js';
import { createTransactionService } from './services/transaction-service.js';
import { createUiRefreshService } from './services/ui-refresh-service.js';

let lastPeriodicUiSnapshot = null;
let periodicUiRefreshRunning = false;
let giveawayAutoEndRunning = false;

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

let healthServer = null;
let botStarted = false;

const {
  guildUiSnapshot,
  loadServiceStatuses,
  orderTicketServiceIsAvailable,
  serviceIsOpen,
  serviceStatusIsSet,
  ticketServiceIsAvailable,
  updateServiceStatus
} = createServiceStatusFeature({
  supabase,
  definitions: SERVICE_DEFINITIONS,
  openHour: config.openHour,
  closeHour: config.closeHour,
  getDateKey: getStoreDateKey,
  getHour: getStoreHour,
  isStoreOpen
});

const {
  orderTicketService,
  ticketPanelPayload,
  ticketTypeLabel
} = createTicketPanelFeature({
  config,
  embedBase,
  operatingStatusText,
  orderTicketServices: ORDER_TICKET_SERVICES,
  rekberImagePath: REKBER_IMAGE_PATH,
  orderTicketServiceIsAvailable,
  serviceIsOpen,
  serviceStatusIsSet,
  ticketServiceIsAvailable
});

const {
  editablePanelTypes,
  loadPanelTextOverrides,
  managedPanelPayload,
  publishOrEditPanel,
  refreshPanels
} = createPanelRegistryService({
  supabase,
  client,
  unwrapSupabase,
  loadServiceStatuses,
  payloadFactories: {
    verify: () => verifyPanelPayload(),
    ticket_order: () => ticketPanelPayload('order'),
    ticket_rekber: () => ticketPanelPayload('rekber'),
    ticket_support: () => ticketPanelPayload('support'),
    market_value_update: (overrides) => valueUpdatePayload(embedBase, overrides),
    market_item_tumbal_trade: (overrides) => itemTumbalTradePayload(embedBase, overrides),
    price_via_login: (overrides) => viaLoginPricePayload(embedBase, overrides),
    price_via_username: (overrides) => viaUsernamePricePayload(embedBase, overrides),
    seed_rules: () => rulesPanelPayload(embedBase),
    seed_how_to_order: () => howToOrderPanelPayload(embedBase)
  }
});

const {
  checkStoreStatusAnnouncement,
  refreshServerStats,
  setupServer
} = createServerManagementService({
  client,
  embedBase,
  findVerifiedRole,
  memberIsOwner,
  serviceIsOpen,
  loadServiceStatuses,
  loadPanelTextOverrides,
  publishOrEditPanel,
  managedPanelPayload
});

const {
  refreshGuildUiInBackground,
  refreshPanelsInBackground
} = createUiRefreshService({
  refreshServerStats,
  refreshPanels,
  guildUiSnapshot,
  onSnapshot: (snapshot) => {
    lastPeriodicUiSnapshot = snapshot;
  }
});

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

async function refreshGuildUiIfChanged(guild) {
  await loadServiceStatuses(guild.id);
  const snapshot = guildUiSnapshot(guild.id);

  if (snapshot === lastPeriodicUiSnapshot) return false;

  lastPeriodicUiSnapshot = snapshot;
  await refreshServerStats(guild);
  await refreshPanels(guild, { reloadServiceStatuses: false });
  return true;
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

const { createTicketForMember } = createTicketCreationFeature({
  supabase,
  activeTicketCategoryName: CATEGORY.activeTicket,
  staffRoleNames,
  orderTicketService,
  ticketTypeLabel,
  ticketControlRows,
  embedBase,
  unwrapSupabase
});

const {
  claimTicket,
  createRekberTicket,
  createTicket,
  handleVerify,
  openTicketForUser
} = createTicketController({
  config,
  supabase,
  unwrapSupabase,
  embedBase,
  memberIsStaff,
  memberIsVerified,
  findVerifiedRole,
  unverifiedRoleName: ROLE.unverified,
  orderTicketService,
  orderTicketServiceIsAvailable,
  ticketServiceIsAvailable,
  serviceStatusIsSet,
  ticketTypeLabel,
  operatingStatusText,
  createTicketForMember
});

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

const {
  addManualTransaction,
  closeTicket,
  completeTicket,
  showCompleteModal,
  showCustomer
} = createTransactionService({
  supabase,
  client,
  config,
  customerRoleName: ROLE.customer,
  tierRoles: TIER_ROLES,
  successTransactionChannel: CHANNEL.successTransaction,
  ticketTranscriptChannel: CHANNEL.ticketTranscript,
  ticketLogChannel: CHANNEL.ticketLog,
  embedBase,
  formatRupiah,
  channelMatchesName,
  memberIsStaff,
  unwrapSupabase
});

const {
  handleServiceStatusCommand,
  resetPanelText,
  setPanelText
} = createAdminController({
  supabase,
  memberIsStaff,
  editablePanelTypes,
  isPanelTextOverrideSchemaMissing,
  refreshGuildUiInBackground,
  updateServiceStatus,
  serviceDefinitions: SERVICE_DEFINITIONS
});

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

const handleInteraction = withInteractionErrorHandling(createInteractionController({
  memberIsStaff,
  setupServer,
  refreshPanelsInBackground,
  addManualTransaction,
  showCustomer,
  openTicketForUser,
  setPanelText,
  resetPanelText,
  handleServiceStatusCommand,
  handleGiveawayCommand,
  handleVerify,
  createRekberTicket,
  createTicket,
  claimTicket,
  qrisReplyPayload,
  showCompleteModal,
  closeTicket,
  handleGiveawayJoin,
  completeTicket
}));

registerDiscordEventRoutes({
  client,
  handleMessageCreate,
  handleGuildMemberAdd,
  handleInviteCreate,
  handleInviteDelete,
  handleInteraction
});

client.once(Events.ClientReady, async () => {
  console.log(`${client.user.tag} online for ${config.storeName}.`);
  await keepSupabaseAwake().catch((error) => console.warn('Supabase heartbeat failed:', error.message));

  const guild = await client.guilds.fetch(config.guildId).catch(() => null);
  if (guild) {
    await loadServiceStatuses(guild.id).catch((error) => console.warn('Service status load failed:', error.message));
    await refreshInviteCache(guild).catch((error) => console.warn('Invite cache refresh failed:', error.message));
    await refreshServerStats(guild).catch((error) => console.warn('Server stats refresh failed:', error.message));
    await refreshPanels(guild).catch((error) => console.warn('Panel refresh failed:', error.message));
    lastPeriodicUiSnapshot = guildUiSnapshot(guild.id);
    await checkStoreStatusAnnouncement(guild).catch((error) => console.warn('Store status announcement check failed:', error.message));
    await endDueGiveaways().catch((error) => console.warn('Giveaway auto-end failed:', error.message));
  }

  setInterval(async () => {
    await keepSupabaseAwake().catch((error) => console.warn('Supabase heartbeat failed:', error.message));
  }, 24 * 60 * 60 * 1000);

  setInterval(async () => {
    if (periodicUiRefreshRunning) return;
    periodicUiRefreshRunning = true;

    const targetGuild = await client.guilds.fetch(config.guildId).catch(() => null);
    try {
      if (targetGuild) {
        await checkStoreStatusAnnouncement(targetGuild).catch((error) => console.warn('Store status announcement check failed:', error.message));
        await refreshGuildUiIfChanged(targetGuild).catch((error) => console.warn('UI refresh check failed:', error.message));
      }
    } finally {
      periodicUiRefreshRunning = false;
    }
  }, 60 * 1000);

  setInterval(async () => {
    if (giveawayAutoEndRunning) return;
    giveawayAutoEndRunning = true;

    try {
      await endDueGiveaways().catch((error) => console.warn('Giveaway auto-end failed:', error.message));
    } finally {
      giveawayAutoEndRunning = false;
    }
  }, 30 * 1000);
});

function shutdown(signal) {
  console.log(`Received ${signal}; shutting down Discord client.`);
  client.destroy();
  if (healthServer) {
    healthServer.close(() => process.exit(0));
  }
  setTimeout(() => process.exit(0), 10_000).unref();
}

export async function startBot() {
  if (botStarted) return client;
  botStarted = true;

  healthServer = startHealthServer(client);
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  try {
    await client.login(config.discordToken);
    return client;
  } catch (error) {
    botStarted = false;
    await new Promise((resolve) => healthServer.close(resolve));
    healthServer = null;
    throw error;
  }
}

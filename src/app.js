import {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Partials
} from 'discord.js';
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
import { createAuditLogService } from './services/audit-log-service.js';
import { createBotLifecycleService } from './services/bot-lifecycle-service.js';
import { createCorePayloadService } from './services/core-payload-service.js';
import { channelMatchesName } from './services/discord-resource-service.js';
import { createGiveawayFeature } from './services/giveaway-service.js';
import { groupPayoutPricePayload } from './services/group-payout-panel-service.js';
import { howToOrderPanelPayload, rulesPanelPayload } from './services/info-panel-service.js';
import { createInviteTrackerFeature } from './services/invite-tracker-service.js';
import { createIntegrationPermissionService } from './services/integration-permission-service.js';
import { itemTumbalTradePayload, valueUpdatePayload, viaLoginPricePayload, viaUsernamePricePayload } from './services/market-panel-service.js';
import { createMemberAccessService } from './services/member-access-service.js';
import { createPanelRegistryService, isPanelTextOverrideSchemaMissing } from './services/panel-registry-service.js';
import { createServerManagementService } from './services/server-management-service.js';
import { createServiceStatusFeature } from './services/service-status-service.js';
import { createTicketCreationFeature } from './services/ticket-creation-service.js';
import { createTicketPanelFeature } from './services/ticket-panel-service.js';
import { createTransactionService } from './services/transaction-service.js';
import { createUiRefreshService } from './services/ui-refresh-service.js';

const uiSnapshotState = { value: null };

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
  findVerifiedRole,
  memberIsOwner,
  memberIsStaff,
  memberIsVerified,
  staffRoleNames
} = createMemberAccessService({
  ownerDiscordId: config.ownerDiscordId,
  roles: ROLE,
  verifiedRoleAliases: VERIFIED_ROLE_ALIASES
});

const {
  qrisReplyPayload,
  ticketControlRows,
  verifyPanelPayload
} = createCorePayloadService({
  config,
  embedBase,
  verifyImagePath: VERIFY_IMAGE_PATH
});

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
    price_group_payout: (overrides) => groupPayoutPricePayload(embedBase, overrides),
    seed_rules: () => rulesPanelPayload(embedBase),
    seed_how_to_order: () => howToOrderPanelPayload(embedBase)
  }
});

const {
  logAdminAction,
  logModerationEvent,
  logOrderEvent,
  logTicketEvent
} = createAuditLogService({
  channelMatchesName,
  embedBase,
  channelNames: {
    admin: CHANNEL.adminLog,
    ticket: CHANNEL.ticketLog,
    order: CHANNEL.orderLog,
    moderation: CHANNEL.modLog
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
  managedPanelPayload,
  logAdminAction
});

const {
  refreshGuildUiInBackground,
  refreshPanelsInBackground
} = createUiRefreshService({
  refreshServerStats,
  refreshPanels,
  guildUiSnapshot,
  onSnapshot: (snapshot) => {
    uiSnapshotState.value = snapshot;
  }
});

function embedBase() {
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setFooter({ text: config.storeName });
}

async function refreshGuildUiIfChanged(guild) {
  await loadServiceStatuses(guild.id);
  const snapshot = guildUiSnapshot(guild.id);

  if (snapshot === uiSnapshotState.value) return false;

  uiSnapshotState.value = snapshot;
  await refreshServerStats(guild);
  await refreshPanels(guild, { reloadServiceStatuses: false });
  return true;
}

const { createTicketForMember } = createTicketCreationFeature({
  supabase,
  activeTicketCategoryName: CATEGORY.activeTicket,
  staffRoleNames,
  orderTicketService,
  ticketTypeLabel,
  ticketControlRows,
  embedBase,
  unwrapSupabase,
  logTicketEvent
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
  createTicketForMember,
  logTicketEvent
});

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
  unwrapSupabase,
  logOrderEvent,
  logTicketEvent
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
  serviceDefinitions: SERVICE_DEFINITIONS,
  logAdminAction
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
  memberIsStaff,
  logModerationEvent
});

const {
  refreshInviteCache,
  handleGuildMemberAdd: handleInviteTrackerMemberAdd,
  handleInviteCreate,
  handleInviteDelete
} = createInviteTrackerFeature({
  supabase,
  channelMatchesName,
  unverifiedRoleName: ROLE.unverified,
  welcomeChannelName: CHANNEL.welcome
});

const {
  ensureNotifyMeChannelAccess,
  handleIntegrationMemberAdd,
  handleSyncIntegrationsCommand
} = createIntegrationPermissionService({
  channelMatchesName,
  socialMediaChannelName: CHANNEL.socialMedia,
  memberIsStaff,
  memberRoleNamesToRemove: [ROLE.client, ...VERIFIED_ROLE_ALIASES, ROLE.unverified],
  logAdminAction
});

async function handleGuildMemberAdd(member) {
  await handleIntegrationMemberAdd(member);
  await handleInviteTrackerMemberAdd(member);
}

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
  handleSyncIntegrationsCommand,
  handleVerify,
  createRekberTicket,
  createTicket,
  claimTicket,
  qrisReplyPayload,
  showCompleteModal,
  closeTicket,
  handleGiveawayJoin,
  completeTicket,
  logAdminAction
}));

registerDiscordEventRoutes({
  client,
  handleMessageCreate,
  handleGuildMemberAdd,
  handleInviteCreate,
  handleInviteDelete,
  handleInteraction
});

const botLifecycle = createBotLifecycleService({
  client,
  guildId: config.guildId,
  keepSupabaseAwake,
  loadServiceStatuses,
  refreshInviteCache,
  ensureIntegrationAccess: ensureNotifyMeChannelAccess,
  refreshServerStats,
  refreshPanels,
  guildUiSnapshot,
  checkStoreStatusAnnouncement,
  refreshGuildUiIfChanged,
  endDueGiveaways,
  recordUiSnapshot: (snapshot) => {
    uiSnapshotState.value = snapshot;
  }
});

client.once(Events.ClientReady, async () => {
  console.log(`${client.user.tag} online for ${config.storeName}.`);
  await botLifecycle.initialize();
  botLifecycle.start();
});

function shutdown(signal) {
  console.log(`Received ${signal}; shutting down Discord client.`);
  botLifecycle.stop();
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

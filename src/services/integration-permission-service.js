import { PermissionFlagsBits } from 'discord.js';

const NOTIFYME_NAME = 'notifyme';

export const NOTIFYME_PUBLISH_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.MentionEveryone,
  PermissionFlagsBits.BypassSlowmode
];

const NOTIFYME_PERMISSION_OVERWRITE = {
  ViewChannel: true,
  ManageWebhooks: true,
  SendMessages: true,
  ReadMessageHistory: true,
  EmbedLinks: true,
  AttachFiles: true,
  MentionEveryone: true,
  BypassSlowmode: true
};

function normalizedName(value) {
  return String(value || '').trim().toLowerCase();
}

export function findNotifyMeRole(guild, member = null) {
  const memberRole = member?.roles?.cache?.find((role) =>
    role.tags?.botId === member.id || normalizedName(role.name) === NOTIFYME_NAME
  );
  if (memberRole) return memberRole;

  return guild.roles.cache.find((role) => normalizedName(role.name) === NOTIFYME_NAME) || null;
}

export function createIntegrationPermissionService({
  channelMatchesName,
  socialMediaChannelName,
  logger = console
}) {
  async function ensureNotifyMeChannelAccess(guild, member = null) {
    const role = findNotifyMeRole(guild, member);
    const channel = guild.channels.cache.find((item) =>
      channelMatchesName(item, socialMediaChannelName)
    );
    if (!role || !channel?.permissionOverwrites?.edit) return false;

    await channel.permissionOverwrites.edit(
      role,
      NOTIFYME_PERMISSION_OVERWRITE,
      { reason: 'Allow NotifyMe to publish social media notifications' }
    );
    return true;
  }

  async function handleIntegrationMemberAdd(member) {
    if (!member.user?.bot || normalizedName(member.user.username) !== NOTIFYME_NAME) return false;

    try {
      return await ensureNotifyMeChannelAccess(member.guild, member);
    } catch (error) {
      logger.warn('Failed to grant NotifyMe channel access:', error.message);
      return false;
    }
  }

  return { ensureNotifyMeChannelAccess, handleIntegrationMemberAdd };
}

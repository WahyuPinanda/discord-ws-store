import { MessageFlags, PermissionFlagsBits } from 'discord.js';

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
  memberIsStaff = () => false,
  memberRoleNamesToRemove = [],
  logAdminAction = async () => false,
  logger = console
}) {
  async function findNotifyMeMember(guild, role, member = null) {
    if (member?.user?.bot && normalizedName(member.user.username) === NOTIFYME_NAME) return member;

    const botId = role.tags?.botId;
    const cachedMember = (botId && guild.members?.cache?.get?.(botId))
      || guild.members?.cache?.find?.((item) =>
        item.user?.bot && normalizedName(item.user.username) === NOTIFYME_NAME
      );
    if (cachedMember) return cachedMember;
    if (!botId || !guild.members?.fetch) return null;

    return guild.members.fetch(botId).catch(() => null);
  }

  async function removeMemberRoles(member) {
    if (!member?.roles?.remove || !member.roles.cache?.values) return;

    const names = new Set(memberRoleNamesToRemove);
    const roles = [...member.roles.cache.values()].filter((role) => names.has(role.name) && role.editable !== false);
    if (!roles.length) return;

    await member.roles.remove(roles, 'Remove member-only roles from NotifyMe integration').catch((error) => {
      logger.warn('Failed to clean member-only roles from NotifyMe:', error.message);
    });
  }

  async function ensureNotifyMeChannelAccess(guild, member = null) {
    const role = findNotifyMeRole(guild, member);
    const channel = guild.channels.cache.find((item) =>
      channelMatchesName(item, socialMediaChannelName)
    );
    if (!role || !channel?.permissionOverwrites?.edit) return false;

    const notifyMeMember = await findNotifyMeMember(guild, role, member);

    await channel.permissionOverwrites.edit(
      role,
      NOTIFYME_PERMISSION_OVERWRITE,
      { reason: 'Allow NotifyMe to publish social media notifications' }
    );
    if (notifyMeMember) {
      await channel.permissionOverwrites.edit(
        notifyMeMember,
        NOTIFYME_PERMISSION_OVERWRITE,
        { reason: 'Ensure NotifyMe effective publishing permissions' }
      );
      await removeMemberRoles(notifyMeMember);
    }
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

  async function handleSyncIntegrationsCommand(interaction) {
    if (!memberIsStaff(interaction.member)) {
      await interaction.reply({
        content: 'Hanya staff yang bisa menyinkronkan integrasi bot.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const synced = await ensureNotifyMeChannelAccess(interaction.guild);
    if (!synced) {
      await interaction.editReply('NotifyMe atau channel social-media tidak ditemukan.');
      return;
    }

    await interaction.editReply('Permission NotifyMe untuk channel social-media berhasil disinkronkan.');
    await logAdminAction(interaction.guild, {
      action: 'Sync Integrations',
      actorId: interaction.user.id,
      description: 'Permission NotifyMe untuk channel social-media disinkronkan.'
    });
  }

  return {
    ensureNotifyMeChannelAccess,
    handleIntegrationMemberAdd,
    handleSyncIntegrationsCommand
  };
}

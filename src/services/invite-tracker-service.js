const inviteCache = new Map();

export function createInviteTrackerFeature({
  channelMatchesName,
  unverifiedRoleName,
  welcomeChannelName,
  logger = console
}) {
  async function refreshInviteCache(guild) {
    const invites = await guild.invites.fetch().catch((error) => {
      console.warn(`Invite cache refresh failed for ${guild.name}:`, error.message);
      return null;
    });

    if (!invites) return null;

    inviteCache.set(
      guild.id,
      new Map(invites.map((invite) => [
        invite.code,
        {
          uses: invite.uses || 0,
          inviterId: invite.inviterId,
          inviterTag: invite.inviter?.tag || invite.inviter?.username || 'Unknown'
        }
      ]))
    );

    return invites;
  }

  async function detectUsedInvite(guild) {
    const previous = inviteCache.get(guild.id) || new Map();
    const invites = await guild.invites.fetch().catch((error) => {
      console.warn(`Invite detect failed for ${guild.name}:`, error.message);
      return null;
    });

    if (!invites) return null;

    let usedInvite = null;
    for (const invite of invites.values()) {
      const oldUses = previous.get(invite.code)?.uses || 0;
      const newUses = invite.uses || 0;
      if (newUses > oldUses) {
        usedInvite = invite;
        break;
      }
    }

    inviteCache.set(
      guild.id,
      new Map(invites.map((invite) => [
        invite.code,
        {
          uses: invite.uses || 0,
          inviterId: invite.inviterId,
          inviterTag: invite.inviter?.tag || invite.inviter?.username || 'Unknown'
        }
      ]))
    );

    return usedInvite;
  }

  async function sendWelcomeInviteLog(member, invite) {
    const channel = member.guild.channels.cache.find((item) => channelMatchesName(item, welcomeChannelName));
    if (!channel) return;

    const invitedBy = invite?.inviter ? `<@${invite.inviter.id}>` : 'Unknown';
    const uses = invite?.uses || 0;

    await channel.send({
      content: `<@${member.id}> has been invited by ${invitedBy} and has now ${uses} invite${uses === 1 ? '' : 's'}.`
    }).catch((error) => logger.warn('Failed to send welcome invite log:', error.message));
  }

  async function handleGuildMemberAdd(member) {
    const role = member.guild.roles.cache.find((item) => item.name === unverifiedRoleName);
    if (role) {
      await member.roles.add(role).catch((error) => logger.warn('Failed to add unverified role:', error.message));
    }

    const usedInvite = await detectUsedInvite(member.guild);
    await sendWelcomeInviteLog(member, usedInvite);
  }

  async function handleInviteCreate(invite) {
    if (invite.guild) await refreshInviteCache(invite.guild);
  }

  async function handleInviteDelete(invite) {
    if (invite.guild) await refreshInviteCache(invite.guild);
  }

  return {
    refreshInviteCache,
    handleGuildMemberAdd,
    handleInviteCreate,
    handleInviteDelete
  };
}

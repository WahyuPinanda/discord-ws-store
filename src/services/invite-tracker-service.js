function inviteSnapshot(invites) {
  return new Map(invites.map((invite) => [
    invite.code,
    {
      uses: invite.uses || 0,
      inviterId: invite.inviterId,
      inviterTag: invite.inviter?.tag || invite.inviter?.username || 'Unknown'
    }
  ]));
}

function inviterUseTotals(invites) {
  const totals = new Map();
  for (const invite of invites.values()) {
    if (!invite.inviterId) continue;
    totals.set(invite.inviterId, (totals.get(invite.inviterId) || 0) + (invite.uses || 0));
  }
  return totals;
}

function inviteStatsSchemaMissing(error) {
  const message = error?.message || '';
  return error?.code === 'PGRST202'
    || error?.code === '42P01'
    || message.includes('sync_invite_count')
    || message.includes('increment_invite_count')
    || message.includes('invite_stats');
}

export function createInviteTrackerFeature({
  supabase,
  channelMatchesName,
  unverifiedRoleName,
  welcomeChannelName,
  logger = console
}) {
  const inviteCache = new Map();
  let inviteStatsAvailable = Boolean(supabase);
  let schemaWarningShown = false;

  function warnMissingSchema() {
    if (schemaWarningShown) return;
    logger.warn('Invite totals are using the Discord fallback. Run the latest Supabase schema to persist totals across deleted links and bot restarts.');
    schemaWarningShown = true;
  }

  async function syncInviteTotals(guildId, invites) {
    const totals = inviterUseTotals(invites);
    if (!inviteStatsAvailable) return totals;

    for (const [inviterId, observedTotal] of totals) {
      const { error } = await supabase.rpc('sync_invite_count', {
        p_guild_id: guildId,
        p_inviter_id: inviterId,
        p_observed_total: observedTotal
      });
      if (!error) continue;

      if (inviteStatsSchemaMissing(error)) {
        inviteStatsAvailable = false;
        warnMissingSchema();
        break;
      }
      logger.warn(`Failed to sync invite total for ${inviterId}:`, error.message);
    }

    return totals;
  }

  async function incrementInviteTotal(guildId, inviterId, fallbackTotal) {
    if (!inviterId || !inviteStatsAvailable) return fallbackTotal;

    const { data, error } = await supabase.rpc('increment_invite_count', {
      p_guild_id: guildId,
      p_inviter_id: inviterId
    });
    if (error) {
      if (inviteStatsSchemaMissing(error)) {
        inviteStatsAvailable = false;
        warnMissingSchema();
      } else {
        logger.warn(`Failed to increment invite total for ${inviterId}:`, error.message);
      }
      return fallbackTotal;
    }

    const total = Number(data);
    return Number.isSafeInteger(total) && total >= 0 ? total : fallbackTotal;
  }

  async function refreshInviteCache(guild) {
    const invites = await guild.invites.fetch().catch((error) => {
      logger.warn(`Invite cache refresh failed for ${guild.name}:`, error.message);
      return null;
    });

    if (!invites) return null;

    inviteCache.set(guild.id, inviteSnapshot(invites));
    await syncInviteTotals(guild.id, invites);
    return invites;
  }

  async function detectUsedInvite(guild) {
    const previous = inviteCache.get(guild.id);
    const invites = await guild.invites.fetch().catch((error) => {
      logger.warn(`Invite detect failed for ${guild.name}:`, error.message);
      return null;
    });

    if (!invites) return null;

    const totals = inviterUseTotals(invites);
    inviteCache.set(guild.id, inviteSnapshot(invites));

    if (!previous) {
      await syncInviteTotals(guild.id, invites);
      return null;
    }

    let usedInvite = null;
    for (const invite of invites.values()) {
      const oldUses = previous.get(invite.code)?.uses || 0;
      if ((invite.uses || 0) > oldUses) {
        usedInvite = invite;
        break;
      }
    }
    if (!usedInvite) return null;

    const observedTotal = totals.get(usedInvite.inviterId) || usedInvite.uses || 0;
    const totalInvites = await incrementInviteTotal(guild.id, usedInvite.inviterId, observedTotal);
    return { invite: usedInvite, totalInvites };
  }

  async function sendWelcomeInviteLog(member, detection) {
    const channel = member.guild.channels.cache.find((item) => channelMatchesName(item, welcomeChannelName));
    if (!channel) return;

    const invite = detection?.invite;
    if (!invite?.inviter) {
      await channel.send({
        content: `<@${member.id}> joined, but the invite used could not be detected.`
      }).catch((error) => logger.warn('Failed to send welcome invite log:', error.message));
      return;
    }

    const invitedBy = `<@${invite.inviter.id}>`;
    const totalInvites = detection?.totalInvites || 0;

    await channel.send({
      content: `<@${member.id}> has been invited by ${invitedBy}. ${invitedBy} now has ${totalInvites} total invite${totalInvites === 1 ? '' : 's'}.`
    }).catch((error) => logger.warn('Failed to send welcome invite log:', error.message));
  }

  async function handleGuildMemberAdd(member) {
    const role = member.guild.roles.cache.find((item) => item.name === unverifiedRoleName);
    if (role) {
      await member.roles.add(role).catch((error) => logger.warn('Failed to add unverified role:', error.message));
    }

    const detection = await detectUsedInvite(member.guild);
    await sendWelcomeInviteLog(member, detection);
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

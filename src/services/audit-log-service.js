const MAX_FIELD_NAME_LENGTH = 256;
const MAX_FIELD_VALUE_LENGTH = 1024;
const MAX_DESCRIPTION_LENGTH = 4096;

function truncate(value, maxLength) {
  const text = String(value ?? '-');
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function normalizeFields(fields = []) {
  return fields
    .filter((field) => field?.name && field?.value !== undefined)
    .slice(0, 25)
    .map((field) => ({
      name: truncate(field.name, MAX_FIELD_NAME_LENGTH),
      value: truncate(field.value, MAX_FIELD_VALUE_LENGTH),
      inline: Boolean(field.inline)
    }));
}

export function createAuditLogService({
  channelMatchesName,
  embedBase,
  channelNames,
  logger = console
}) {
  async function sendAuditLog(guild, channelName, payload) {
    try {
      const channel = guild?.channels?.cache?.find((item) => channelMatchesName(item, channelName));
      if (!channel?.send) {
        logger.warn(`Audit log channel not found: ${channelName}`);
        return false;
      }

      const embed = embedBase()
        .setColor(payload.color ?? 0x95a5a6)
        .setTitle(truncate(payload.title || 'Audit Log', MAX_FIELD_NAME_LENGTH))
        .setTimestamp(payload.timestamp ? new Date(payload.timestamp) : new Date());
      if (payload.description) {
        embed.setDescription(truncate(payload.description, MAX_DESCRIPTION_LENGTH));
      }
      const fields = normalizeFields(payload.fields);
      if (fields.length) embed.addFields(fields);

      await channel.send({ embeds: [embed] });
      return true;
    } catch (error) {
      logger.warn(`Failed to send audit log to ${channelName}:`, error.message);
      return false;
    }
  }

  function logAdminAction(guild, {
    action,
    actorId,
    description,
    fields = []
  }) {
    return sendAuditLog(guild, channelNames.admin, {
      color: 0xf1c40f,
      title: '📋 Admin Action',
      description,
      fields: [
        { name: 'Action', value: action, inline: true },
        { name: 'Actor', value: actorId ? `<@${actorId}>` : 'System', inline: true },
        ...fields
      ]
    });
  }

  function logTicketEvent(guild, {
    event,
    ticketId,
    channelId,
    openerId,
    actorId,
    type,
    fields = []
  }) {
    return sendAuditLog(guild, channelNames.ticket, {
      color: 0x3498db,
      title: `🎫 ${event}`,
      fields: [
        { name: 'Ticket', value: ticketId ? `#${ticketId}` : '-', inline: true },
        { name: 'Type', value: type || '-', inline: true },
        { name: 'Channel', value: channelId ? `<#${channelId}>` : '-', inline: true },
        { name: 'Opener', value: openerId ? `<@${openerId}>` : '-', inline: true },
        { name: 'Actor', value: actorId ? `<@${actorId}>` : 'System', inline: true },
        ...fields
      ]
    });
  }

  function logOrderEvent(guild, {
    transactionId,
    ticketId,
    buyerId,
    handledBy,
    product,
    amount,
    payment,
    totalSpent,
    tier,
    source
  }) {
    return sendAuditLog(guild, channelNames.order, {
      color: 0x2ecc71,
      title: '💰 Order Recorded',
      fields: [
        { name: 'Transaction', value: transactionId ? `WS-${String(transactionId).padStart(5, '0')}` : '-', inline: true },
        { name: 'Source', value: source || 'Ticket', inline: true },
        { name: 'Ticket', value: ticketId ? `#${ticketId}` : '-', inline: true },
        { name: 'Buyer', value: buyerId ? `<@${buyerId}>` : '-', inline: true },
        { name: 'Handled by', value: handledBy ? `<@${handledBy}>` : '-', inline: true },
        { name: 'Product', value: product || '-', inline: false },
        { name: 'Amount', value: amount || '-', inline: true },
        { name: 'Payment', value: payment || '-', inline: true },
        { name: 'Customer Total', value: totalSpent || '-', inline: true },
        { name: 'Tier', value: tier || 'Customer', inline: true }
      ]
    });
  }

  function logModerationEvent(guild, {
    action,
    userId,
    channelId,
    reason,
    deletedMessages = 0,
    outcome
  }) {
    return sendAuditLog(guild, channelNames.moderation, {
      color: 0xe74c3c,
      title: '🚨 Moderation Action',
      fields: [
        { name: 'Action', value: action, inline: true },
        { name: 'Member', value: userId ? `<@${userId}>` : '-', inline: true },
        { name: 'Channel', value: channelId ? `<#${channelId}>` : '-', inline: true },
        { name: 'Reason', value: reason || '-', inline: false },
        { name: 'Messages Removed', value: String(deletedMessages), inline: true },
        { name: 'Outcome', value: outcome || 'Completed', inline: true }
      ]
    });
  }

  return {
    logAdminAction,
    logModerationEvent,
    logOrderEvent,
    logTicketEvent
  };
}

export function createTransactionNotificationService({
  successTransactionChannel,
  rekberHistoryChannel,
  embedBase,
  formatRupiah,
  channelMatchesName,
  logger = console
}) {
  function destinationDefinitions(ticketType) {
    return [
      {
        channelName: successTransactionChannel,
        title: '✅ TRANSACTION SUCCESS',
        description: 'Order berhasil diselesaikan dan tercatat otomatis.'
      },
      ticketType === 'rekber' ? {
        channelName: rekberHistoryChannel,
        title: '🤝 REKBER SUCCESS',
        description: 'Transaksi rekber berhasil diselesaikan dan tercatat otomatis.'
      } : null
    ].filter(Boolean);
  }

  function transactionEmbed(transaction, buyerId, totalSpent, tier, destination) {
    return embedBase()
      .setTitle(destination.title)
      .setDescription(destination.description)
      .addFields(
        { name: 'Buyer', value: `<@${buyerId}>`, inline: true },
        { name: 'Product', value: transaction.product, inline: true },
        { name: 'Nominal', value: formatRupiah(transaction.amount), inline: true },
        { name: 'Payment', value: transaction.payment_method, inline: true },
        { name: 'Handled by', value: transaction.handled_by ? `<@${transaction.handled_by}>` : '-', inline: true },
        { name: 'Customer Total', value: formatRupiah(totalSpent), inline: true },
        { name: 'Tier', value: tier?.name || 'Customer', inline: true }
      )
      .setTimestamp(new Date(transaction.created_at));
  }

  async function postTransaction(guild, transaction, buyerId, totalSpent, tier, ticketType = null) {
    const results = [];
    for (const destination of destinationDefinitions(ticketType)) {
      const channel = guild.channels.cache.find((item) => channelMatchesName(item, destination.channelName));
      if (!channel?.send) {
        logger.warn(`Transaction destination channel not found: ${destination.channelName}`);
        results.push(false);
        continue;
      }

      try {
        await channel.send({
          embeds: [transactionEmbed(transaction, buyerId, totalSpent, tier, destination)]
        });
        results.push(true);
      } catch (error) {
        logger.warn(`Failed to publish transaction to ${destination.channelName}:`, error.message);
        results.push(false);
      }
    }
    return results;
  }

  return { postTransaction };
}

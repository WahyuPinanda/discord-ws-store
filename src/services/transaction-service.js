import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { createTranscriptService } from './transcript-service.js';

export function createTransactionService({
  supabase,
  client,
  config,
  customerRoleName,
  tierRoles,
  successTransactionChannel,
  ticketTranscriptChannel,
  ticketLogChannel,
  embedBase,
  formatRupiah,
  channelMatchesName,
  memberIsStaff,
  unwrapSupabase,
  logOrderEvent = async () => false,
  logTicketEvent = async () => false,
  logger = console
}) {
  const ticketCompletionLocks = new Set();
  const customerUpdateLocks = new Map();
  const { buildTranscript, sendTranscriptLog } = createTranscriptService({
    config,
    embedBase,
    channelMatchesName,
    ticketTranscriptChannel,
    ticketLogChannel
  });

  function getTier(totalSpent) {
    return tierRoles.find((tier) => totalSpent >= tier.min) || null;
  }

  async function showCompleteModal(interaction) {
    if (!memberIsStaff(interaction.member)) {
      await interaction.reply({ content: 'Hanya staff yang bisa menyelesaikan order.', flags: MessageFlags.Ephemeral });
      return;
    }

    const ticket = unwrapSupabase(await supabase
      .from('tickets')
      .select('*')
      .eq('channel_id', interaction.channelId)
      .maybeSingle(), 'Failed to load ticket completion form');

    if (!ticket) {
      await interaction.reply({ content: 'Data ticket tidak ditemukan.', flags: MessageFlags.Ephemeral });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`ticket:complete-modal:${ticket.id}`)
      .setTitle('Selesaikan Order')
      .addComponents(
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

  async function updateCustomerAndRolesUnlocked(guild, buyerId, buyerTag, amount) {
    let totalSpent = 0;
    let tier = null;
    let saved = false;

    for (let attempt = 0; attempt < 5 && !saved; attempt += 1) {
      const oldCustomer = unwrapSupabase(await supabase
        .from('customers')
        .select('*')
        .eq('discord_user_id', buyerId)
        .maybeSingle(), 'Failed to load customer total');
      const previousTotal = Number(oldCustomer?.total_spent || 0);
      totalSpent = previousTotal + Number(amount || 0);
      tier = getTier(totalSpent);
      const customer = {
        discord_user_id: buyerId,
        username: buyerTag,
        total_spent: totalSpent,
        tier: tier?.name || null
      };

      if (!oldCustomer) {
        const { error } = await supabase.from('customers').insert(customer);
        if (!error) {
          saved = true;
        } else if (error.code !== '23505') {
          throw error;
        }
        continue;
      }

      const updated = unwrapSupabase(await supabase
        .from('customers')
        .update(customer)
        .eq('discord_user_id', buyerId)
        .eq('total_spent', previousTotal)
        .select('discord_user_id')
        .maybeSingle(), 'Failed to update customer total');
      saved = Boolean(updated);
    }

    if (!saved) {
      throw new Error(`Customer total update conflicted repeatedly for ${buyerId}`);
    }

    const member = await guild.members.fetch(buyerId).catch(() => null);
    if (member) {
      const customerRole = guild.roles.cache.find((role) => role.name === customerRoleName);
      if (customerRole) await member.roles.add(customerRole).catch(() => null);

      const tierRoleIds = tierRoles
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

  async function updateCustomerAndRoles(guild, buyerId, buyerTag, amount) {
    const previous = customerUpdateLocks.get(buyerId) || Promise.resolve();
    const update = previous
      .catch(() => null)
      .then(() => updateCustomerAndRolesUnlocked(guild, buyerId, buyerTag, amount));
    customerUpdateLocks.set(buyerId, update);

    try {
      return await update;
    } finally {
      if (customerUpdateLocks.get(buyerId) === update) customerUpdateLocks.delete(buyerId);
    }
  }

  async function sendInvoiceDm({ user, transaction, totalSpent, tier }) {
    await user.send({
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
    }).catch(() => null);
  }

  async function postTransaction(guild, transaction, buyerId, totalSpent, tier) {
    const channel = guild.channels.cache.find((item) => channelMatchesName(item, successTransactionChannel));
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

    unwrapSupabase(await supabase
      .from('tickets')
      .update({ status: options.status || 'closed', closed_at: new Date().toISOString() })
      .eq('id', ticket.id), 'Failed to close ticket');

    await channel.send('Ticket akan ditutup dalam 8 detik.');
    setTimeout(() => channel.delete('Ticket closed by WS Store bot').catch(() => null), 8000);
    return transcript;
  }

  async function completeTicketUnlocked(interaction, ticketId) {
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
    const ticket = unwrapSupabase(await supabase
      .from('tickets')
      .select('*')
      .eq('id', ticketId)
      .maybeSingle(), 'Failed to load ticket completion');

    if (!ticket) {
      await interaction.editReply('Ticket tidak ditemukan.');
      return;
    }
    if (ticket.status === 'completed' || ticket.status === 'closed') {
      await interaction.editReply('Ticket ini sudah selesai atau sudah ditutup. Transaksi tidak dicatat ulang.');
      return;
    }

    const buyer = await client.users.fetch(ticket.opener_id);
    const transaction = unwrapSupabase(await supabase
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
      .single(), 'Failed to save ticket transaction');

    try {
      unwrapSupabase(await supabase
        .from('tickets')
        .update({ status: 'completed', total_amount: amount })
        .eq('id', ticket.id), 'Failed to mark ticket completed');
    } catch (error) {
      const rollback = await supabase.from('transactions').delete().eq('id', transaction.id);
      if (rollback.error) logger.error('Failed to roll back incomplete transaction:', rollback.error.message);
      throw error;
    }

    const { totalSpent, tier } = await updateCustomerAndRoles(
      interaction.guild,
      ticket.opener_id,
      buyer.tag,
      amount
    );
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
    unwrapSupabase(await supabase
      .from('tickets')
      .update({ status: 'completed', closed_at: new Date().toISOString() })
      .eq('id', ticket.id), 'Failed to finalize completed ticket');

    await Promise.all([
      logOrderEvent(interaction.guild, {
        transactionId: transaction.id,
        ticketId: ticket.id,
        buyerId: ticket.opener_id,
        handledBy: interaction.user.id,
        product: transaction.product,
        amount: formatRupiah(transaction.amount),
        payment: transaction.payment_method,
        totalSpent: formatRupiah(totalSpent),
        tier: tier?.name || 'Customer',
        source: 'Ticket'
      }),
      logTicketEvent(interaction.guild, {
        event: 'Ticket Completed',
        ticketId: ticket.id,
        channelId: interaction.channelId,
        openerId: ticket.opener_id,
        actorId: interaction.user.id,
        type: ticket.type
      })
    ]);

    await interaction.editReply('Order selesai, invoice DM terkirim jika DM pembeli terbuka, dan ticket akan ditutup.');
    await interaction.channel.send('Ticket akan ditutup dalam 8 detik.');
    setTimeout(() => interaction.channel.delete('Order completed by WS Store bot').catch(() => null), 8000);
  }

  async function completeTicket(interaction) {
    const ticketId = interaction.customId.split(':').at(-1);
    if (ticketCompletionLocks.has(ticketId)) {
      await interaction.reply({
        content: 'Penyelesaian ticket ini sedang diproses. Mohon tunggu.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    ticketCompletionLocks.add(ticketId);
    try {
      await completeTicketUnlocked(interaction, ticketId);
    } finally {
      ticketCompletionLocks.delete(ticketId);
    }
  }

  async function closeTicket(interaction) {
    if (!memberIsStaff(interaction.member)) {
      await interaction.reply({ content: 'Hanya staff yang bisa close ticket.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const ticket = unwrapSupabase(await supabase
      .from('tickets')
      .select('*')
      .eq('channel_id', interaction.channelId)
      .maybeSingle(), 'Failed to load ticket for closing');

    if (!ticket) {
      await interaction.editReply('Ticket tidak ditemukan di database.');
      return;
    }

    await closeTicketChannel(interaction.channel, ticket, interaction.user.id);
    await interaction.editReply('Ticket ditutup dan transcript dikirim.');
    await logTicketEvent(interaction.guild, {
      event: 'Ticket Closed',
      ticketId: ticket.id,
      channelId: interaction.channelId,
      openerId: ticket.opener_id,
      actorId: interaction.user.id,
      type: ticket.type
    });
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

    const transaction = unwrapSupabase(await supabase
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
      .single(), 'Failed to save manual transaction');

    const { totalSpent, tier } = await updateCustomerAndRoles(interaction.guild, buyer.id, buyer.tag, amount);
    await postTransaction(interaction.guild, transaction, buyer.id, totalSpent, tier);
    await sendInvoiceDm({ user: buyer, transaction, totalSpent, tier });
    await interaction.editReply(`Transaksi manual berhasil. Total ${buyer.tag}: ${formatRupiah(totalSpent)} (${tier?.name || 'Customer'}).`);
    await logOrderEvent(interaction.guild, {
      transactionId: transaction.id,
      buyerId: buyer.id,
      handledBy: interaction.user.id,
      product: transaction.product,
      amount: formatRupiah(transaction.amount),
      payment: transaction.payment_method,
      totalSpent: formatRupiah(totalSpent),
      tier: tier?.name || 'Customer',
      source: 'Manual Command'
    });
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

    const data = unwrapSupabase(await supabase
      .from('customers')
      .select('*')
      .eq('discord_user_id', user.id)
      .maybeSingle(), 'Failed to load customer profile');

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

  return {
    addManualTransaction,
    closeTicket,
    completeTicket,
    showCompleteModal,
    showCustomer
  };
}

import { ChannelType, PermissionsBitField } from 'discord.js';

export function createTicketCreationFeature({
  supabase,
  activeTicketCategoryName,
  staffRoleNames,
  orderTicketService,
  ticketTypeLabel,
  ticketControlRows,
  embedBase,
  unwrapSupabase,
  logger = console
}) {
  const creationLocks = new Map();

  function creationKey(interaction, type, openerId) {
    return `${interaction.guildId}:${openerId}:${type}`;
  }

  async function createTicketForMemberUnlocked(interaction, type, openerMember, options) {
    const {
      additionalMembers = [],
      bypassStoreHours = false,
      openedByStaff = false,
      rekberDetails = null,
      service = null
    } = options;
    const openerUser = openerMember.user;
    const selectedService = type === 'order' ? orderTicketService(service) : null;

    const { data: existing, error: existingError } = await supabase
      .from('tickets')
      .select('*')
      .eq('guild_id', interaction.guildId)
      .eq('opener_id', openerUser.id)
      .eq('type', type)
      .in('status', ['open', 'claimed'])
      .maybeSingle();

    if (existingError) throw existingError;
    if (existing?.channel_id) return { existingChannelId: existing.channel_id };

    const { data: ticket, error: insertError } = await supabase
      .from('tickets')
      .insert({
        type,
        guild_id: interaction.guildId,
        opener_id: openerUser.id,
        opener_tag: openerUser.tag
      })
      .select('*')
      .single();

    if (insertError) throw insertError;

    let channel = null;
    try {
      const activeCategory = interaction.guild.channels.cache.find(
        (item) => item.type === ChannelType.GuildCategory && item.name === activeTicketCategoryName
      );
      if (!activeCategory) {
        throw new Error(`Ticket category not found: ${activeTicketCategoryName}`);
      }
      const participantMembers = [...new Map(
        [openerMember, ...additionalMembers].map((member) => [member.id, member])
      ).values()];
      const participantIds = participantMembers.map((member) => member.id);
      const overwrites = [
        { id: interaction.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        ...participantMembers.map((member) => ({
          id: member.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.AttachFiles
          ]
        }))
      ];

      for (const roleName of staffRoleNames()) {
        const role = interaction.guild.roles.cache.find((item) => item.name === roleName);
        if (role) {
          overwrites.push({
            id: role.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory,
              PermissionsBitField.Flags.AttachFiles
            ]
          });
        }
      }

      channel = await interaction.guild.channels.create({
        name: `ticket-${ticket.id}`,
        type: ChannelType.GuildText,
        parent: activeCategory,
        topic: `${ticketTypeLabel(type)}${selectedService ? ` | service:${selectedService.label}` : ''} | opener:${openerUser.id} | ticket:${ticket.id}`,
        permissionOverwrites: overwrites
      });

      const { error: channelUpdateError } = await supabase
        .from('tickets')
        .update({ channel_id: channel.id })
        .eq('id', ticket.id);
      if (channelUpdateError) throw channelUpdateError;

      await channel.send({
        content: participantIds.map((id) => `<@${id}>`).join(' '),
        allowedMentions: { users: participantIds },
        embeds: [
          embedBase()
            .setTitle('🎟️ Ticket Created')
            .setDescription([
              `Hello <@${openerUser.id}>! Terima kasih telah membuka ticket.`,
              openedByStaff ? `Ticket ini dibukakan oleh staff <@${interaction.user.id}>.` : null,
              bypassStoreHours ? 'Catatan: ticket ini dibuka oleh staff di luar jam operasional.' : null,
              selectedService ? `Layanan dipilih: **${selectedService.emoji} ${selectedService.label}**` : null,
              '',
              type === 'order'
                ? [
                  '**Form order:**',
                  `Layanan: ${selectedService ? `${selectedService.emoji} ${selectedService.label}` : '-'}`,
                  'Produk:',
                  'Jumlah:',
                  'Username Roblox:',
                  selectedService?.service === 'via-login' ? 'USN + Password:' : null,
                  'Metode pembayaran:',
                  'Catatan:'
                ].filter(Boolean).join('\n')
                : type === 'rekber'
                  ? rekberDetails
                    ? [
                      '**Data rekber:**',
                      `Pembeli: <@${rekberDetails.buyerId}> (\`${rekberDetails.buyerUsername}\`)`,
                      `Penjual: <@${rekberDetails.sellerId}> (\`${rekberDetails.sellerUsername}\`)`,
                      `Jumlah transaksi: **${rekberDetails.transactionAmount}**`,
                      'Barang transaksi:',
                      'Bukti kesepakatan:'
                    ].join('\n')
                    : '**Form rekber:**\nBuyer/Seller:\nBarang transaksi:\nNominal:\nPihak lawan:\nBukti kesepakatan:'
                  : '**Form support:**\nMasalah:\nOrder ID jika ada:\nBukti screenshot:\nPenjelasan:',
              '',
              'Silakan isi form di atas dan tunggu admin menerima ticket.'
            ].filter(Boolean).join('\n'))
        ],
        components: ticketControlRows(type)
      });

      return { channelId: channel.id };
    } catch (error) {
      if (channel) {
        await channel.delete('Rolling back failed ticket creation').catch(() => null);
      }
      const cleanupResult = await supabase
        .from('tickets')
        .update({ status: 'closed', closed_at: new Date().toISOString() })
        .eq('id', ticket.id);
      try {
        unwrapSupabase(cleanupResult, 'Failed to clean up ticket creation');
      } catch (cleanupError) {
        logger.error(cleanupError.message);
      }
      throw error;
    }
  }

  async function createTicketForMember(interaction, type, openerMember, options = {}) {
    const key = creationKey(interaction, type, openerMember.id);
    const running = creationLocks.get(key);
    if (running) {
      const result = await running;
      return result.existingChannelId
        ? result
        : { existingChannelId: result.channelId };
    }

    const creation = createTicketForMemberUnlocked(interaction, type, openerMember, options);
    creationLocks.set(key, creation);

    try {
      return await creation;
    } finally {
      creationLocks.delete(key);
    }
  }

  return { createTicketForMember };
}

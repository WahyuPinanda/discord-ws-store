import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';

const REKBER_MODAL_ID = 'ticket:rekber-modal';

function rekberModal() {
  return new ModalBuilder()
    .setCustomId(REKBER_MODAL_ID)
    .setTitle('Form Ticket Rekber')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('rekber:buyer')
          .setLabel('Username Discord Pembeli (Cth: keii123)')
          .setPlaceholder('keii123')
          .setStyle(TextInputStyle.Short)
          .setMinLength(2)
          .setMaxLength(32)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('rekber:seller')
          .setLabel('Username Discord Penjual (Cth: keii123)')
          .setPlaceholder('keii123')
          .setStyle(TextInputStyle.Short)
          .setMinLength(2)
          .setMaxLength(32)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('rekber:amount')
          .setLabel('Jumlah Transaksi (Rp / Robux)')
          .setPlaceholder('Contoh: Rp150.000 atau 1.000 Robux')
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(100)
          .setRequired(true)
      )
    );
}

function usernameKey(value) {
  return value.trim().replace(/^@/, '').toLowerCase();
}

async function findGuildMemberByUsername(guild, value) {
  const rawValue = value.trim();
  const idMatch = rawValue.match(/^(?:<@!?)?(\d{17,20})>?$/);
  if (idMatch) return guild.members.fetch(idMatch[1]).catch(() => null);

  const username = usernameKey(rawValue);
  const exactMatch = (member) => member.user.username.toLowerCase() === username;
  const cachedMember = guild.members.cache.find(exactMatch);
  if (cachedMember) return cachedMember;

  const fetchedMembers = await guild.members.fetch({ query: rawValue.replace(/^@/, ''), limit: 100 });
  return fetchedMembers.find(exactMatch) || null;
}

export function createTicketController({
  config,
  supabase,
  unwrapSupabase,
  embedBase,
  memberIsStaff,
  memberIsVerified,
  findVerifiedRole,
  unverifiedRoleName,
  orderTicketService,
  orderTicketServiceIsAvailable,
  ticketServiceIsAvailable,
  serviceStatusIsSet,
  ticketTypeLabel,
  operatingStatusText,
  createTicketForMember
}) {
  async function handleVerify(interaction) {
    const member = interaction.member;
    const verifiedRole = findVerifiedRole(interaction.guild);
    const unverifiedRole = interaction.guild.roles.cache.find((role) => role.name === unverifiedRoleName);

    if (!verifiedRole) {
      await interaction.reply({
        content: 'Role verifikasi belum tersedia. Silakan hubungi admin.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await member.roles.add(verifiedRole);
    if (unverifiedRole) await member.roles.remove(unverifiedRole);
    await interaction.reply({
      content: 'Verifikasi berhasil. Selamat datang di WS Store Official!',
      flags: MessageFlags.Ephemeral
    });
  }

  async function createTicket(interaction, type, service = null) {
    if (type === 'order' && service && !orderTicketService(service)) {
      await interaction.reply({
        content: 'Layanan order tidak dikenali. Silakan refresh panel ticket atau hubungi staff.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    if (!memberIsStaff(interaction.member) && !memberIsVerified(interaction.member)) {
      await interaction.reply({
        content: 'Kamu harus verify terlebih dahulu sebelum membuka ticket.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (type === 'rekber') {
      await interaction.showModal(rekberModal());
      return;
    }

    const availabilityKey = type === 'order' && service ? service : type;
    const isAvailable = type === 'order' && service
      ? orderTicketServiceIsAvailable(interaction.guildId, service)
      : ticketServiceIsAvailable(interaction.guildId, availabilityKey);
    const statusKey = type === 'order' && service && !ticketServiceIsAvailable(interaction.guildId, 'order')
      ? 'order'
      : availabilityKey;

    if (type !== 'rekber' && !isAvailable) {
      const selectedService = type === 'order' && service ? orderTicketService(service) : null;
      await interaction.reply({
        content: statusKey === 'order'
          ? 'Ticket Order sedang closed. Silakan tunggu admin membuka kembali.'
          : selectedService
            ? `${selectedService.label} sedang closed sesuai server stats. Silakan pilih layanan yang hijau atau tunggu admin membuka kembali.`
            : serviceStatusIsSet(interaction.guildId, statusKey)
              ? `${ticketTypeLabel(type)} sedang closed. Silakan cek status server atau tunggu admin membuka kembali.`
              : `Store sedang closed. ${operatingStatusText()}`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await createTicketForMember(interaction, type, interaction.member, { service });
    if (result.existingChannelId) {
      await interaction.editReply(`Kamu masih punya ticket aktif: <#${result.existingChannelId}>`);
      return;
    }
    await interaction.editReply(`Ticket berhasil dibuat: <#${result.channelId}>`);
  }

  async function createRekberTicket(interaction) {
    if (!memberIsStaff(interaction.member) && !memberIsVerified(interaction.member)) {
      await interaction.reply({
        content: 'Kamu harus verify terlebih dahulu sebelum membuka ticket.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const buyerInput = interaction.fields.getTextInputValue('rekber:buyer');
    const sellerInput = interaction.fields.getTextInputValue('rekber:seller');
    const transactionAmount = interaction.fields.getTextInputValue('rekber:amount').trim();

    if (!usernameKey(buyerInput) || !usernameKey(sellerInput) || !transactionAmount) {
      await interaction.reply({
        content: 'Semua data Rekber wajib diisi dengan benar.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const [buyerMember, sellerMember] = await Promise.all([
      findGuildMemberByUsername(interaction.guild, buyerInput),
      findGuildMemberByUsername(interaction.guild, sellerInput)
    ]);
    const missingUsernames = [
      buyerMember ? null : `pembeli \`${buyerInput.trim()}\``,
      sellerMember ? null : `penjual \`${sellerInput.trim()}\``
    ].filter(Boolean);

    if (missingUsernames.length) {
      await interaction.editReply(`Member ${missingUsernames.join(' dan ')} tidak ditemukan di server. Pastikan memakai username Discord, bukan display name.`);
      return;
    }
    if (buyerMember.id === sellerMember.id) {
      await interaction.editReply('Username pembeli dan penjual harus berbeda.');
      return;
    }
    if (!memberIsStaff(interaction.member) && ![buyerMember.id, sellerMember.id].includes(interaction.user.id)) {
      await interaction.editReply('Kamu harus menjadi pembeli atau penjual dalam transaksi ini.');
      return;
    }

    const result = await createTicketForMember(interaction, 'rekber', interaction.member, {
      additionalMembers: [buyerMember, sellerMember],
      rekberDetails: {
        buyerId: buyerMember.id,
        buyerUsername: buyerMember.user.username,
        sellerId: sellerMember.id,
        sellerUsername: sellerMember.user.username,
        transactionAmount
      }
    });
    if (result.existingChannelId) {
      await interaction.editReply(`Kamu masih punya ticket Rekber aktif: <#${result.existingChannelId}>`);
      return;
    }

    await interaction.editReply(`Ticket Rekber berhasil dibuat: <#${result.channelId}>. Pembeli dan penjual sudah ditambahkan.`);
  }

  async function openTicketForUser(interaction) {
    if (!memberIsStaff(interaction.member)) {
      await interaction.reply({
        content: 'Hanya staff yang bisa membuka ticket untuk member lain.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const targetUser = interaction.options.getUser('user', true);
    const type = interaction.options.getString('type', true);
    const service = type === 'order' ? interaction.options.getString('service') : null;
    const selectedService = type === 'order' ? orderTicketService(service) : null;
    const openerMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    if (type === 'order' && service && !selectedService) {
      await interaction.reply({
        content: 'Layanan order tidak dikenali. Pilih service yang tersedia di command.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    if (!openerMember) {
      await interaction.reply({ content: 'Member tidak ditemukan di server ini.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await createTicketForMember(interaction, type, openerMember, {
      bypassStoreHours: true,
      openedByStaff: true,
      service
    });
    if (result.existingChannelId) {
      await interaction.editReply(`<@${targetUser.id}> masih punya ticket aktif: <#${result.existingChannelId}>`);
      return;
    }

    const serviceLabel = selectedService ? ` (${selectedService.label})` : '';
    await interaction.editReply(`Ticket ${ticketTypeLabel(type)}${serviceLabel} untuk <@${targetUser.id}> berhasil dibuat: <#${result.channelId}>`);
  }

  async function claimTicket(interaction) {
    if (!memberIsStaff(interaction.member)) {
      await interaction.reply({ content: 'Hanya staff yang bisa claim ticket.', flags: MessageFlags.Ephemeral });
      return;
    }

    const ticket = unwrapSupabase(await supabase
      .from('tickets')
      .select('*')
      .eq('channel_id', interaction.channelId)
      .maybeSingle(), 'Failed to load ticket for claim');
    if (!ticket) {
      await interaction.reply({ content: 'Data ticket tidak ditemukan di Supabase.', flags: MessageFlags.Ephemeral });
      return;
    }

    unwrapSupabase(await supabase
      .from('tickets')
      .update({ claimed_by: interaction.user.id, status: 'claimed' })
      .eq('id', ticket.id), 'Failed to claim ticket');
    await interaction.reply({
      embeds: [
        embedBase()
          .setColor(0x2ecc71)
          .setTitle('🎯 Ticket Claimed')
          .setDescription(`Ticket ini sudah diclaim oleh <@${interaction.user.id}>.`)
          .addFields({
            name: 'Claimed at',
            value: new Date().toLocaleString('id-ID', { timeZone: config.timezone })
          })
      ]
    });
  }

  return { claimTicket, createRekberTicket, createTicket, handleVerify, openTicketForUser };
}

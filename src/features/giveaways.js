import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  time,
  TimestampStyles
} from 'discord.js';

export const GIVEAWAY_ENTRY_ROLES = [
  { role: '💎 Customer 50Jt+', entries: 12 },
  { role: '💠 Customer 20Jt+', entries: 8 },
  { role: '🔷 Customer 10Jt+', entries: 6 },
  { role: '🔹 Customer 5Jt+', entries: 4 },
  { role: '⭐ Customer 1Jt+', entries: 2 },
  { role: '✅ Client', entries: 1 }
];

function parseDurationMs(value) {
  const match = String(value || '').trim().toLowerCase().match(/^(\d+)\s*(m|h|d)$/);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers = {
    m: 60_000,
    h: 60 * 60_000,
    d: 24 * 60 * 60_000
  };

  return amount * multipliers[unit];
}

function giveawayEntriesForMember(member) {
  for (const rule of GIVEAWAY_ENTRY_ROLES) {
    if (member.roles.cache.some((role) => role.name === rule.role)) return rule.entries;
  }

  return 0;
}

function giveawayJoinRow(giveawayId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway:join:${giveawayId}`)
      .setLabel('Ikut Giveaway')
      .setEmoji('🎉')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled)
  );
}

function pickWeightedWinners(entries, winnersCount) {
  const pool = [];
  for (const entry of entries) {
    for (let index = 0; index < entry.entries; index += 1) pool.push(entry.user_id);
  }

  const winners = [];
  while (pool.length && winners.length < winnersCount) {
    const pickedId = pool[Math.floor(Math.random() * pool.length)];
    const pickedEntry = entries.find((entry) => entry.user_id === pickedId);
    winners.push(pickedEntry);

    for (let index = pool.length - 1; index >= 0; index -= 1) {
      if (pool[index] === pickedId) pool.splice(index, 1);
    }
  }

  return winners;
}

export function createGiveawayFeature({
  client,
  supabase,
  embedBase,
  memberIsStaff,
  channelMatchesName,
  giveawayChannelName
}) {
  function giveawayRulesText(guild) {
    return GIVEAWAY_ENTRY_ROLES
      .map((rule) => {
        const role = guild.roles.cache.find((item) => item.name === rule.role);
        return `• ${role ? `<@&${role.id}>` : rule.role} = ${rule.entries} ticket`;
      })
      .join('\n');
  }

  async function giveawayParticipantCount(giveawayId) {
    const { count } = await supabase
      .from('giveaway_entries')
      .select('user_id', { count: 'exact', head: true })
      .eq('giveaway_id', giveawayId);

    return count || 0;
  }

  function giveawayPayload(guild, giveaway, participantCount, winners = []) {
    const ended = giveaway.status === 'ended';
    const endsAt = new Date(giveaway.ends_at);
    const winnerText = winners.length ? winners.map((winner) => `<@${winner.user_id}>`).join(', ') : 'Belum diundi';

    return {
      embeds: [
        embedBase()
          .setTitle(giveaway.prize)
          .setDescription([
            `• Giveaway ID: ${giveaway.id}`,
            `• Hosted by: <@${giveaway.host_id}>`,
            `• Ended at: ${time(endsAt, TimestampStyles.ShortDateTime)} (${time(endsAt, TimestampStyles.RelativeTime)})`,
            `• Winners: ${giveaway.winners_count}`,
            '',
            `• Participants: ${participantCount}`,
            '',
            '**Roles with entries:**',
            giveawayRulesText(guild),
            '',
            ended
              ? `⏰ Giveaway sudah selesai. Winner: ${winnerText}`
              : 'Klik tombol di bawah untuk ikut giveaway.'
          ].join('\n'))
      ],
      components: [giveawayJoinRow(giveaway.id, ended)]
    };
  }

  async function refreshGiveawayMessage(guild, giveawayId) {
    const { data: giveaway } = await supabase
      .from('giveaways')
      .select('*')
      .eq('id', giveawayId)
      .maybeSingle();

    if (!giveaway?.message_id || !giveaway.channel_id) return;

    const participantCount = await giveawayParticipantCount(giveaway.id);
    const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
    const message = await channel?.messages.fetch(giveaway.message_id).catch(() => null);
    if (!message) return;

    await message.edit(giveawayPayload(guild, giveaway, participantCount)).catch(() => null);
  }

  async function endGiveaway(guild, giveawayId, endedBy = null) {
    const { data: giveaway } = await supabase
      .from('giveaways')
      .select('*')
      .eq('id', giveawayId)
      .maybeSingle();

    if (!giveaway || giveaway.status === 'ended') return { giveaway, winners: [] };

    const { data: entries } = await supabase
      .from('giveaway_entries')
      .select('*')
      .eq('giveaway_id', giveaway.id);

    const winners = pickWeightedWinners(entries || [], giveaway.winners_count);
    const winnerIds = winners.map((winner) => winner.user_id);

    const { data: endedGiveaway } = await supabase
      .from('giveaways')
      .update({
        status: 'ended',
        ended_at: new Date().toISOString(),
        ended_by: endedBy,
        winner_ids: winnerIds
      })
      .eq('id', giveaway.id)
      .select('*')
      .single();

    const participantCount = entries?.length || 0;
    const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
    const message = await channel?.messages.fetch(giveaway.message_id).catch(() => null);

    if (message) {
      await message.edit(giveawayPayload(guild, endedGiveaway, participantCount, winners)).catch(() => null);
    }

    if (channel) {
      const winnerText = winners.length ? winners.map((winner) => `<@${winner.user_id}>`).join(', ') : 'Tidak ada winner karena belum ada peserta valid.';
      await channel.send(`🎉 Giveaway **${giveaway.prize}** selesai. Winner: ${winnerText}`).catch(() => null);
    }

    return { giveaway: endedGiveaway, winners };
  }

  async function createGiveaway(interaction) {
    if (!memberIsStaff(interaction.member)) {
      await interaction.reply({ content: 'Hanya admin atau owner yang bisa membuat giveaway.', flags: MessageFlags.Ephemeral });
      return;
    }

    const prize = interaction.options.getString('prize', true);
    const durationInput = interaction.options.getString('duration', true);
    const winnersCount = interaction.options.getInteger('winners') || 1;
    const durationMs = parseDurationMs(durationInput);

    if (!durationMs) {
      await interaction.reply({ content: 'Durasi tidak valid. Contoh: 30m, 4h, 1d.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channel = interaction.guild.channels.cache.find((item) => channelMatchesName(item, giveawayChannelName)) || interaction.channel;
    const endsAt = new Date(Date.now() + durationMs);

    const { data: giveaway, error } = await supabase
      .from('giveaways')
      .insert({
        guild_id: interaction.guildId,
        channel_id: channel.id,
        host_id: interaction.user.id,
        prize,
        winners_count: winnersCount,
        ends_at: endsAt.toISOString(),
        status: 'active'
      })
      .select('*')
      .single();

    if (error) throw error;

    const message = await channel.send(giveawayPayload(interaction.guild, giveaway, 0));

    await supabase
      .from('giveaways')
      .update({ message_id: message.id })
      .eq('id', giveaway.id);

    await interaction.editReply(`Giveaway dibuat di <#${channel.id}>.`);
  }

  async function handleGiveawayJoin(interaction, giveawayId) {
    const entries = giveawayEntriesForMember(interaction.member);

    if (!entries) {
      await interaction.reply({
        content: 'Kamu harus verify terlebih dahulu dan minimal punya role Client untuk ikut giveaway.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const { data: giveaway } = await supabase
      .from('giveaways')
      .select('*')
      .eq('id', giveawayId)
      .maybeSingle();

    if (!giveaway || giveaway.status !== 'active' || new Date(giveaway.ends_at).getTime() <= Date.now()) {
      await interaction.reply({ content: 'Giveaway ini sudah selesai.', flags: MessageFlags.Ephemeral });
      if (giveaway?.status === 'active') await endGiveaway(interaction.guild, giveaway.id);
      return;
    }

    await supabase
      .from('giveaway_entries')
      .upsert({
        giveaway_id: giveaway.id,
        user_id: interaction.user.id,
        username: interaction.user.tag,
        entries
      }, { onConflict: 'giveaway_id,user_id' });

    await refreshGiveawayMessage(interaction.guild, giveaway.id);
    await interaction.reply({
      content: `Kamu berhasil ikut giveaway dengan ${entries} ticket entry.`,
      flags: MessageFlags.Ephemeral
    });
  }

  async function handleGiveawayCommand(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'create') {
      await createGiveaway(interaction);
      return;
    }

    if (!memberIsStaff(interaction.member)) {
      await interaction.reply({ content: 'Hanya admin atau owner yang bisa mengatur giveaway.', flags: MessageFlags.Ephemeral });
      return;
    }

    const giveawayId = interaction.options.getInteger('id', true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (subcommand === 'end') {
      await endGiveaway(interaction.guild, giveawayId, interaction.user.id);
      await interaction.editReply('Giveaway sudah diakhiri.');
      return;
    }

    if (subcommand === 'reroll') {
      const { data: giveaway } = await supabase
        .from('giveaways')
        .select('*')
        .eq('id', giveawayId)
        .maybeSingle();

      if (!giveaway) {
        await interaction.editReply('Giveaway tidak ditemukan.');
        return;
      }

      await supabase
        .from('giveaways')
        .update({ status: 'active', winner_ids: [], ended_at: null, ended_by: null })
        .eq('id', giveaway.id);

      await endGiveaway(interaction.guild, giveaway.id, interaction.user.id);
      await interaction.editReply('Winner giveaway sudah di-reroll.');
    }
  }

  async function endDueGiveaways() {
    const { data: giveaways, error } = await supabase
      .from('giveaways')
      .select('*')
      .eq('status', 'active')
      .lte('ends_at', new Date().toISOString());

    if (error) {
      console.warn('Failed to load due giveaways:', error.message);
      return;
    }

    for (const giveaway of giveaways || []) {
      const guild = await client.guilds.fetch(giveaway.guild_id).catch(() => null);
      if (guild) await endGiveaway(guild, giveaway.id).catch((itemError) => console.warn('Failed to end giveaway:', itemError.message));
    }
  }

  return {
    handleGiveawayCommand,
    handleGiveawayJoin,
    endDueGiveaways
  };
}

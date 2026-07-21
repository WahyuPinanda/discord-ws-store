import { MessageFlags } from 'discord.js';
import {
  createGiveawayPresentationService,
  giveawayEntriesForMember,
  parseGiveawayDurationMs,
  pickWeightedWinners
} from './giveaway-presentation-service.js';

let giveawaySchemaWarningShown = false;

function isGiveawaySchemaMissing(error) {
  const message = error?.message || '';
  return error?.code === 'PGRST205'
    || message.includes("Could not find the table 'public.giveaways'")
    || message.includes("Could not find the table 'public.giveaway_entries'")
    || message.includes('schema cache');
}

function missingGiveawaySchemaMessage() {
  return 'Tabel giveaway belum ada di Supabase. Jalankan isi file supabase/schema.sql di SQL Editor Supabase, lalu coba lagi.';
}

function warnMissingGiveawaySchemaOnce(error, logger) {
  if (giveawaySchemaWarningShown) return;
  giveawaySchemaWarningShown = true;
  logger.warn(`${missingGiveawaySchemaMessage()} Detail: ${error.message}`);
}

export function createGiveawayFeature({
  client,
  supabase,
  embedBase,
  memberIsStaff,
  channelMatchesName,
  giveawayChannelName,
  logger = console
}) {
  const endingGiveaways = new Set();
  const { payload: giveawayPayload } = createGiveawayPresentationService({ embedBase });

  async function giveawayParticipantCount(giveawayId) {
    const { count, error } = await supabase
      .from('giveaway_entries')
      .select('user_id', { count: 'exact', head: true })
      .eq('giveaway_id', giveawayId);

    if (error) {
      if (isGiveawaySchemaMissing(error)) warnMissingGiveawaySchemaOnce(error, logger);
      else logger.warn('Failed to count giveaway participants:', error.message);
      return 0;
    }

    return count || 0;
  }

  async function refreshGiveawayMessage(guild, giveawayId) {
    const { data: giveaway, error } = await supabase
      .from('giveaways')
      .select('*')
      .eq('id', giveawayId)
      .maybeSingle();

    if (error) {
      if (isGiveawaySchemaMissing(error)) warnMissingGiveawaySchemaOnce(error, logger);
      else logger.warn('Failed to load giveaway message:', error.message);
      return;
    }

    if (!giveaway?.message_id || !giveaway.channel_id) return;

    const participantCount = await giveawayParticipantCount(giveaway.id);
    const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
    const message = await channel?.messages.fetch(giveaway.message_id).catch(() => null);
    if (!message) return;

    await message.edit(giveawayPayload(guild, giveaway, participantCount)).catch(() => null);
  }

  async function endGiveawayUnlocked(guild, giveawayId, endedBy = null) {
    const { data: giveaway, error: giveawayError } = await supabase
      .from('giveaways')
      .select('*')
      .eq('id', giveawayId)
      .maybeSingle();

    if (giveawayError) {
      if (isGiveawaySchemaMissing(giveawayError)) {
        warnMissingGiveawaySchemaOnce(giveawayError, logger);
        return { giveaway: null, winners: [], schemaMissing: true };
      }
      throw giveawayError;
    }

    if (!giveaway || giveaway.status === 'ended') return { giveaway, winners: [] };

    const { data: entries, error: entriesError } = await supabase
      .from('giveaway_entries')
      .select('*')
      .eq('giveaway_id', giveaway.id);

    if (entriesError) {
      if (isGiveawaySchemaMissing(entriesError)) {
        warnMissingGiveawaySchemaOnce(entriesError, logger);
        return { giveaway, winners: [], schemaMissing: true };
      }
      throw entriesError;
    }

    const winners = pickWeightedWinners(entries || [], giveaway.winners_count);
    const winnerIds = winners.map((winner) => winner.user_id);

    const { data: endedGiveaway, error: updateError } = await supabase
      .from('giveaways')
      .update({
        status: 'ended',
        ended_at: new Date().toISOString(),
        ended_by: endedBy,
        winner_ids: winnerIds
      })
      .eq('id', giveaway.id)
      .eq('status', 'active')
      .select('*')
      .maybeSingle();

    if (updateError) throw updateError;
    if (!endedGiveaway) return { giveaway, winners: [] };

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

  async function endGiveaway(guild, giveawayId, endedBy = null) {
    if (endingGiveaways.has(giveawayId)) return { giveaway: null, winners: [], inProgress: true };
    endingGiveaways.add(giveawayId);
    try {
      return await endGiveawayUnlocked(guild, giveawayId, endedBy);
    } finally {
      endingGiveaways.delete(giveawayId);
    }
  }

  async function rollBackGiveawayCreation(giveawayId, endedBy, context) {
    const { error } = await supabase
      .from('giveaways')
      .update({ status: 'ended', ended_at: new Date().toISOString(), ended_by: endedBy })
      .eq('id', giveawayId);
    if (error) logger.error(`Failed to roll back giveaway ${context}:`, error.message);
  }

  async function createGiveaway(interaction) {
    if (!memberIsStaff(interaction.member)) {
      await interaction.reply({ content: 'Hanya admin atau owner yang bisa membuat giveaway.', flags: MessageFlags.Ephemeral });
      return;
    }

    const prize = interaction.options.getString('prize', true);
    const durationInput = interaction.options.getString('duration', true);
    const winnersCount = interaction.options.getInteger('winners') || 1;
    const durationMs = parseGiveawayDurationMs(durationInput);

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

    if (error) {
      if (isGiveawaySchemaMissing(error)) {
        warnMissingGiveawaySchemaOnce(error, logger);
        await interaction.editReply(missingGiveawaySchemaMessage());
        return;
      }
      throw error;
    }

    let message;
    try {
      message = await channel.send(giveawayPayload(interaction.guild, giveaway, 0));
    } catch (sendError) {
      await rollBackGiveawayCreation(giveaway.id, interaction.user.id, 'after Discord send failure');
      throw sendError;
    }

    const { error: messageUpdateError } = await supabase
      .from('giveaways')
      .update({ message_id: message.id })
      .eq('id', giveaway.id);

    if (messageUpdateError) {
      if (message.delete) await message.delete().catch(() => null);
      await rollBackGiveawayCreation(giveaway.id, interaction.user.id, 'without a saved message');
      throw messageUpdateError;
    }

    await interaction.editReply(`Giveaway dibuat di <#${channel.id}>.`);
  }

  async function handleGiveawayJoin(interaction, giveawayId) {
    const entries = giveawayEntriesForMember(interaction.member);

    if (!entries) {
      await interaction.reply({
        content: 'Kamu harus verify terlebih dahulu dan minimal punya role Verif untuk ikut giveaway.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { data: giveaway, error } = await supabase
      .from('giveaways')
      .select('*')
      .eq('id', giveawayId)
      .maybeSingle();

    if (error) {
      if (isGiveawaySchemaMissing(error)) {
        warnMissingGiveawaySchemaOnce(error, logger);
        await interaction.editReply(missingGiveawaySchemaMessage());
        return;
      }
      throw error;
    }

    if (!giveaway || giveaway.status !== 'active' || new Date(giveaway.ends_at).getTime() <= Date.now()) {
      await interaction.editReply('Giveaway ini sudah selesai.');
      if (giveaway?.status === 'active') await endGiveaway(interaction.guild, giveaway.id);
      return;
    }

    const { error: entryError } = await supabase
      .from('giveaway_entries')
      .upsert({
        giveaway_id: giveaway.id,
        user_id: interaction.user.id,
        username: interaction.user.tag,
        entries
      }, { onConflict: 'giveaway_id,user_id' });

    if (entryError) {
      if (isGiveawaySchemaMissing(entryError)) {
        warnMissingGiveawaySchemaOnce(entryError, logger);
        await interaction.editReply(missingGiveawaySchemaMessage());
        return;
      }
      throw entryError;
    }

    await refreshGiveawayMessage(interaction.guild, giveaway.id);
    await interaction.editReply(`Kamu berhasil ikut giveaway dengan ${entries} ticket entry.`);
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
      const result = await endGiveaway(interaction.guild, giveawayId, interaction.user.id);
      if (result.inProgress) {
        await interaction.editReply('Giveaway ini sedang diproses. Silakan tunggu sebentar.');
        return;
      }
      if (result.schemaMissing) {
        await interaction.editReply(missingGiveawaySchemaMessage());
        return;
      }
      if (!result.giveaway) {
        await interaction.editReply('Giveaway tidak ditemukan.');
        return;
      }
      await interaction.editReply('Giveaway sudah diakhiri.');
      return;
    }

    if (subcommand === 'reroll') {
      const { data: giveaway, error } = await supabase
        .from('giveaways')
        .select('*')
        .eq('id', giveawayId)
        .maybeSingle();

      if (error) {
        if (isGiveawaySchemaMissing(error)) {
          warnMissingGiveawaySchemaOnce(error, logger);
          await interaction.editReply(missingGiveawaySchemaMessage());
          return;
        }
        throw error;
      }

      if (!giveaway) {
        await interaction.editReply('Giveaway tidak ditemukan.');
        return;
      }

      const { error: resetError } = await supabase
        .from('giveaways')
        .update({ status: 'active', winner_ids: [], ended_at: null, ended_by: null })
        .eq('id', giveaway.id);

      if (resetError) throw resetError;

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
      if (isGiveawaySchemaMissing(error)) {
        warnMissingGiveawaySchemaOnce(error, logger);
      } else {
        logger.warn('Failed to load due giveaways:', error.message);
      }
      return;
    }

    for (const giveaway of giveaways || []) {
      const guild = await client.guilds.fetch(giveaway.guild_id).catch(() => null);
      if (guild) await endGiveaway(guild, giveaway.id).catch((itemError) => logger.warn('Failed to end giveaway:', itemError.message));
    }
  }

  return {
    handleGiveawayCommand,
    handleGiveawayJoin,
    endDueGiveaways
  };
}

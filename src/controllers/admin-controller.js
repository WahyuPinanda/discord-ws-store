import { MessageFlags } from 'discord.js';

export function createAdminController({
  supabase,
  memberIsStaff,
  editablePanelTypes,
  isPanelTextOverrideSchemaMissing,
  refreshGuildUiInBackground,
  updateServiceStatus,
  serviceDefinitions,
  logAdminAction = async () => false
}) {
  async function setPanelText(interaction) {
    if (!memberIsStaff(interaction.member)) {
      await interaction.reply({ content: 'Hanya staff yang bisa edit teks panel.', flags: MessageFlags.Ephemeral });
      return;
    }

    const type = interaction.options.getString('panel', true);
    const title = interaction.options.getString('title') || null;
    const description = interaction.options.getString('description') || null;
    if (!editablePanelTypes().has(type)) {
      await interaction.reply({ content: 'Panel ini tidak bisa diedit lewat command.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (!title && !description) {
      await interaction.reply({
        content: 'Isi minimal salah satu: title atau description.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { error } = await supabase.from('panel_text_overrides').upsert({
      guild_id: interaction.guildId,
      type,
      title,
      description,
      updated_by: interaction.user.id
    }, { onConflict: 'guild_id,type' });
    if (error) {
      if (isPanelTextOverrideSchemaMissing(error)) {
        await interaction.editReply('Table `panel_text_overrides` belum ada. Jalankan schema Supabase terbaru dulu, lalu coba lagi.');
        return;
      }
      throw error;
    }

    await interaction.editReply('Teks panel berhasil diupdate. Panel sedang direfresh di background.');
    refreshGuildUiInBackground(interaction.guild, 'Panel text');
    await logAdminAction(interaction.guild, {
      action: 'Update Panel Text',
      actorId: interaction.user.id,
      fields: [
        { name: 'Panel', value: type, inline: true },
        { name: 'Updated', value: [title ? 'title' : null, description ? 'description' : null].filter(Boolean).join(', '), inline: true }
      ]
    });
  }

  async function resetPanelText(interaction) {
    if (!memberIsStaff(interaction.member)) {
      await interaction.reply({ content: 'Hanya staff yang bisa reset teks panel.', flags: MessageFlags.Ephemeral });
      return;
    }

    const type = interaction.options.getString('panel', true);
    if (!editablePanelTypes().has(type)) {
      await interaction.reply({ content: 'Panel ini tidak bisa direset lewat command.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { error } = await supabase
      .from('panel_text_overrides')
      .delete()
      .eq('guild_id', interaction.guildId)
      .eq('type', type);
    if (error) {
      if (isPanelTextOverrideSchemaMissing(error)) {
        await interaction.editReply('Table `panel_text_overrides` belum ada. Jalankan schema Supabase terbaru dulu, lalu coba lagi.');
        return;
      }
      throw error;
    }

    await interaction.editReply('Teks panel sudah dikembalikan ke default. Panel sedang direfresh di background.');
    refreshGuildUiInBackground(interaction.guild, 'Panel text');
    await logAdminAction(interaction.guild, {
      action: 'Reset Panel Text',
      actorId: interaction.user.id,
      fields: [{ name: 'Panel', value: type, inline: true }]
    });
  }

  async function handleServiceStatusCommand(interaction, isOpen) {
    if (!memberIsStaff(interaction.member)) {
      await interaction.reply({
        content: 'Hanya admin atau owner yang bisa mengubah status service.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const service = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (service === 'order') {
      await updateServiceStatus(interaction.guild, service, isOpen, interaction.user.id);
      await interaction.editReply(`Ticket Order sekarang ${isOpen ? 'OPEN 🟢' : 'CLOSED 🔴'}. Tombol layanan tetap mengikuti server stats masing-masing dan sedang diperbarui di background.`);
      refreshGuildUiInBackground(interaction.guild, 'Service status');
      await logAdminAction(interaction.guild, {
        action: 'Update Service Status',
        actorId: interaction.user.id,
        fields: [
          { name: 'Service', value: 'Ticket Order', inline: true },
          { name: 'Status', value: isOpen ? 'OPEN' : 'CLOSED', inline: true }
        ]
      });
      return;
    }
    if (service === 'rekber') {
      await updateServiceStatus(interaction.guild, service, true, interaction.user.id);
      await interaction.editReply('Ticket rekber dibuat selalu OPEN. Proses tetap dibantu selagi admin / middleman sedang online.');
      refreshGuildUiInBackground(interaction.guild, 'Service status');
      await logAdminAction(interaction.guild, {
        action: 'Update Service Status',
        actorId: interaction.user.id,
        fields: [
          { name: 'Service', value: 'Ticket Rekber', inline: true },
          { name: 'Status', value: 'OPEN (always available)', inline: true }
        ]
      });
      return;
    }

    await updateServiceStatus(interaction.guild, service, isOpen, interaction.user.id);
    const label = serviceDefinitions[service].statsLabel;
    await interaction.editReply(`${label} sekarang ${isOpen ? 'OPEN 🟢' : 'CLOSED 🔴'}. Server stats dan tombol ticket sedang diperbarui di background.`);
    refreshGuildUiInBackground(interaction.guild, 'Service status');
    await logAdminAction(interaction.guild, {
      action: 'Update Service Status',
      actorId: interaction.user.id,
      fields: [
        { name: 'Service', value: label, inline: true },
        { name: 'Status', value: isOpen ? 'OPEN' : 'CLOSED', inline: true }
      ]
    });
  }

  return { handleServiceStatusCommand, resetPanelText, setPanelText };
}

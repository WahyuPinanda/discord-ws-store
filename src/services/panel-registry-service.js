const EDITABLE_PANEL_TYPES = new Set([
  'market_value_update',
  'market_item_tumbal_trade',
  'price_via_login',
  'price_via_username',
  'price_group_payout'
]);

function panelTextOverrideKey(guildId, type) {
  return `${guildId}:${type}`;
}

export function isPanelTextOverrideSchemaMissing(error) {
  const message = error?.message || '';
  return error?.code === 'PGRST205'
    || message.includes("Could not find the table 'public.panel_text_overrides'")
    || message.includes('schema cache');
}

export function createPanelRegistryService({
  supabase,
  client,
  unwrapSupabase,
  loadServiceStatuses,
  payloadFactories,
  logger = console
}) {
  const overrides = new Map();
  let schemaWarningShown = false;

  function panelTextOverride(guildId, type) {
    return overrides.get(panelTextOverrideKey(guildId, type)) || {};
  }

  async function loadPanelTextOverrides(guildId) {
    const { data, error } = await supabase
      .from('panel_text_overrides')
      .select('type,title,description')
      .eq('guild_id', guildId);

    if (error) {
      if (isPanelTextOverrideSchemaMissing(error)) {
        if (!schemaWarningShown) {
          logger.warn('panel_text_overrides table is missing. Run the latest Supabase schema to enable editable panel text.');
          schemaWarningShown = true;
        }
        return false;
      }

      logger.warn('Failed to load panel text overrides:', error.message);
      return false;
    }

    for (const key of overrides.keys()) {
      if (key.startsWith(`${guildId}:`)) overrides.delete(key);
    }
    for (const row of data || []) {
      overrides.set(panelTextOverrideKey(guildId, row.type), {
        title: row.title || undefined,
        description: row.description || undefined
      });
    }
    return true;
  }

  async function upsertPanel(type, message) {
    unwrapSupabase(await supabase.from('ticket_panels').upsert({
      guild_id: message.guildId,
      channel_id: message.channelId,
      message_id: message.id,
      type
    }, { onConflict: 'guild_id,type' }), 'Failed to save panel location');
  }

  async function publishOrEditPanel(channel, type, payload) {
    const data = unwrapSupabase(await supabase
      .from('ticket_panels')
      .select('*')
      .eq('guild_id', channel.guildId)
      .eq('type', type)
      .maybeSingle(), 'Failed to load existing panel');

    if (data?.channel_id && data?.message_id) {
      let oldChannel = null;
      let oldMessage = null;
      try {
        oldChannel = await client.channels.fetch(data.channel_id);
        oldMessage = await oldChannel.messages.fetch(data.message_id);
      } catch (error) {
        const missingDiscordResource = error.code === 10003 || error.code === 10008;
        if (!missingDiscordResource) throw error;
      }

      if (oldMessage && data.channel_id === channel.id) {
        const edited = await oldMessage.edit(payload);
        await upsertPanel(type, edited);
        return edited;
      }

      if (oldMessage && data.channel_id !== channel.id) {
        await oldMessage.delete().catch(() => null);
      }
    }

    const message = await channel.send(payload);
    await upsertPanel(type, message);
    return message;
  }

  function managedPanelPayload(guildId, type) {
    return payloadFactories[type]?.(panelTextOverride(guildId, type), guildId);
  }

  function editablePanelTypes() {
    return EDITABLE_PANEL_TYPES;
  }

  async function refreshPanels(guild, options = {}) {
    if (options.reloadServiceStatuses !== false) await loadServiceStatuses(guild.id);
    await loadPanelTextOverrides(guild.id);

    const panels = unwrapSupabase(await supabase
      .from('ticket_panels')
      .select('*')
      .eq('guild_id', guild.id), 'Failed to load managed panels');

    for (const panel of panels || []) {
      const payload = managedPanelPayload(guild.id, panel.type);
      if (!payload) continue;

      try {
        const channel = await client.channels.fetch(panel.channel_id);
        const message = await channel.messages.fetch(panel.message_id);
        await message.edit(payload);
      } catch (error) {
        logger.warn(`Failed to refresh panel ${panel.type}:`, error.message);
      }
    }
  }

  return {
    editablePanelTypes,
    loadPanelTextOverrides,
    managedPanelPayload,
    publishOrEditPanel,
    refreshPanels
  };
}

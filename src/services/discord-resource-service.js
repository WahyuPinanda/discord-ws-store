import { ChannelType } from 'discord.js';

export function channelNameKey(name) {
  return String(name)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f\ufe0e\ufe0f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

export function channelMatchesName(channel, name) {
  return channel.name === name || channelNameKey(channel.name) === channelNameKey(name);
}

function findManagedChannel(guild, type, name, parent) {
  const matches = guild.channels.cache.filter(
    (channel) => channel.type === type && channelMatchesName(channel, name)
  );

  if (!matches.size) return null;
  if (parent) return matches.find((channel) => channel.parentId === parent.id) || null;
  return matches.first();
}

export async function ensureRole(guild, name, options = {}) {
  const existing = guild.roles.cache.find((role) => role.name === name);
  if (existing) return existing;

  const aliasMatch = options.aliases
    ?.map((alias) => guild.roles.cache.find((role) => role.name === alias))
    .find(Boolean);
  if (aliasMatch) {
    await aliasMatch.setName(name);
    return aliasMatch;
  }

  return guild.roles.create({
    name,
    color: options.color || 0x95a5a6,
    hoist: Boolean(options.hoist),
    mentionable: Boolean(options.mentionable),
    permissions: options.permissions || []
  });
}

export async function ensureCategory(guild, name, permissionOverwrites = []) {
  const existing = guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildCategory && channelMatchesName(channel, name)
  );
  if (existing) {
    if (existing.name !== name) await existing.setName(name);
    if (permissionOverwrites.length) await existing.permissionOverwrites.set(permissionOverwrites);
    return existing;
  }

  return guild.channels.create({ name, type: ChannelType.GuildCategory, permissionOverwrites });
}

export async function ensureTextChannel(guild, name, parent, permissionOverwrites = []) {
  const existing = findManagedChannel(guild, ChannelType.GuildText, name, parent);
  if (existing) {
    if (existing.name !== name) await existing.setName(name);
    if (permissionOverwrites.length) await existing.permissionOverwrites.set(permissionOverwrites);
    return existing;
  }

  return guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent,
    permissionOverwrites
  });
}

export async function ensureAnnouncementChannel(guild, name, parent, permissionOverwrites = []) {
  const existingAnnouncement = findManagedChannel(guild, ChannelType.GuildAnnouncement, name, parent);
  if (existingAnnouncement) {
    if (existingAnnouncement.name !== name) await existingAnnouncement.setName(name);
    if (permissionOverwrites.length) await existingAnnouncement.permissionOverwrites.set(permissionOverwrites);
    return existingAnnouncement;
  }

  const existingText = findManagedChannel(guild, ChannelType.GuildText, name, parent);
  if (existingText) {
    try {
      const converted = await existingText.setType(ChannelType.GuildAnnouncement);
      if (converted.name !== name) await converted.setName(name);
      if (permissionOverwrites.length) await converted.permissionOverwrites.set(permissionOverwrites);
      return converted;
    } catch {
      // Keep the existing text channel and create a dedicated announcement channel.
    }
  }

  return guild.channels.create({
    name,
    type: ChannelType.GuildAnnouncement,
    parent,
    permissionOverwrites
  });
}

export async function ensureVoiceChannel(guild, name, parent, permissionOverwrites = []) {
  const existing = findManagedChannel(guild, ChannelType.GuildVoice, name, parent);
  if (existing) {
    if (existing.name !== name) await existing.setName(name);
    if (permissionOverwrites.length) await existing.permissionOverwrites.set(permissionOverwrites);
    return existing;
  }

  return guild.channels.create({
    name,
    type: ChannelType.GuildVoice,
    parent,
    permissionOverwrites
  });
}

import { ChannelType, PermissionsBitField } from 'discord.js';

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

async function reconcileRole(role, name, options) {
  const changes = {};

  if (role.name !== name) changes.name = name;
  if (options.syncColor && Object.hasOwn(options, 'color') && role.color !== options.color) {
    changes.color = options.color;
  }
  if (Object.hasOwn(options, 'hoist') && role.hoist !== Boolean(options.hoist)) {
    changes.hoist = Boolean(options.hoist);
  }
  if (Object.hasOwn(options, 'mentionable') && role.mentionable !== Boolean(options.mentionable)) {
    changes.mentionable = Boolean(options.mentionable);
  }
  if (Object.hasOwn(options, 'permissions')) {
    const expectedPermissions = new PermissionsBitField(role.permissions)
      .add(options.permissions || []);
    if (role.permissions.bitfield !== expectedPermissions.bitfield) {
      changes.permissions = expectedPermissions;
    }
  }

  return Object.keys(changes).length ? role.edit(changes) : role;
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
  if (existing) return reconcileRole(existing, name, options);

  const aliasMatch = options.aliases
    ?.map((alias) => guild.roles.cache.find((role) => role.name === alias))
    .find(Boolean);
  if (aliasMatch) {
    return reconcileRole(aliasMatch, name, options);
  }

  return guild.roles.create({
    name,
    color: options.color || 0x95a5a6,
    hoist: Boolean(options.hoist),
    mentionable: Boolean(options.mentionable),
    permissions: options.permissions || []
  });
}

export async function ensureBotDisplayRole(guild, name, ownerRole, options = {}) {
  const botMember = guild.members.me || await guild.members.fetchMe();
  const botManagedRole = botMember.roles.highest;

  if (botManagedRole.position <= ownerRole.position) {
    throw new Error(`Move the ${botManagedRole.name} role above ${ownerRole.name} before running setup.`);
  }

  const displayRole = await ensureRole(guild, name, { ...options, hoist: true });
  if (!botMember.roles.cache.has(displayRole.id)) {
    await botMember.roles.add(displayRole);
  }

  const isCorrectlyPositioned = displayRole.position > ownerRole.position
    && displayRole.position < botManagedRole.position;
  if (!isCorrectlyPositioned) {
    try {
      await displayRole.setPosition(ownerRole.position);
    } catch (error) {
      throw new Error(`Failed to position ${name} above ${ownerRole.name}: ${error.message}`, { cause: error });
    }
  }

  return displayRole;
}

export async function ensureRoleStackAbove(anchorRole, orderedRoles) {
  const currentOrder = [...orderedRoles].sort((left, right) => right.position - left.position);
  const alreadyOrdered = orderedRoles.every((role) => role.position > anchorRole.position)
    && currentOrder.every((role, index) => role.id === orderedRoles[index].id);
  if (alreadyOrdered) return orderedRoles;

  for (const role of orderedRoles) {
    try {
      await role.setPosition(anchorRole.position);
    } catch (error) {
      throw new Error(`Failed to position ${role.name} above ${anchorRole.name}: ${error.message}`, { cause: error });
    }
  }
  return orderedRoles;
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

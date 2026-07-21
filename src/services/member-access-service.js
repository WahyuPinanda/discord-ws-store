import { PermissionFlagsBits } from 'discord.js';

export function createMemberAccessService({
  ownerDiscordId,
  roles,
  verifiedRoleAliases = []
}) {
  const verifiedRoleNames = new Set([roles.client, ...verifiedRoleAliases]);
  const staffRoles = [roles.owner, roles.admin, roles.middleman];

  function findRoleByNames(guild, names) {
    const roleNames = names instanceof Set ? names : new Set(names);
    return guild.roles.cache.find((role) => roleNames.has(role.name));
  }

  function findVerifiedRole(guild) {
    return findRoleByNames(guild, verifiedRoleNames);
  }

  function memberIsVerified(member) {
    return member.roles.cache.some((role) => verifiedRoleNames.has(role.name));
  }

  function memberIsStaff(member) {
    return member.permissions.has(PermissionFlagsBits.Administrator)
      || staffRoles.some((roleName) => member.roles.cache.some((role) => role.name === roleName));
  }

  function memberIsOwner(member, userId) {
    return userId === ownerDiscordId
      || member.roles.cache.some((role) => role.name === roles.owner);
  }

  function staffRoleNames() {
    return [...staffRoles];
  }

  return {
    findVerifiedRole,
    memberIsOwner,
    memberIsStaff,
    memberIsVerified,
    staffRoleNames
  };
}

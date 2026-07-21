export function createBoosterRoleService({
  boosterRoleName,
  logger = console
}) {
  function findBoosterRole(guild) {
    return guild.roles.cache.find((role) => role.name === boosterRoleName) || null;
  }

  async function syncBoosterRoleForMember(member) {
    const boosterRole = findBoosterRole(member.guild);
    if (!boosterRole) {
      logger.warn(`Booster role not found: ${boosterRoleName}`);
      return false;
    }

    const isBoosting = Boolean(member.premiumSince);
    const hasBoosterRole = member.roles.cache.has(boosterRole.id);

    if (isBoosting && !hasBoosterRole) {
      await member.roles.add(boosterRole);
      return true;
    }

    if (!isBoosting && hasBoosterRole) {
      await member.roles.remove(boosterRole);
      return true;
    }

    return false;
  }

  async function handleGuildMemberUpdate(oldMember, newMember) {
    if (Boolean(oldMember.premiumSince) === Boolean(newMember.premiumSince)) return false;
    return syncBoosterRoleForMember(newMember);
  }

  return {
    handleGuildMemberUpdate,
    syncBoosterRoleForMember
  };
}

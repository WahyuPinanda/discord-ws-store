export function createCustomerService({
  supabase,
  customerRoleName,
  tierRoles,
  unwrapSupabase,
  logger = console
}) {
  const updateLocks = new Map();

  function getTier(totalSpent) {
    return tierRoles.reduce((best, tier) => {
      if (totalSpent < tier.min) return best;
      return !best || tier.min > best.min ? tier : best;
    }, null);
  }

  async function saveCustomerTotal(buyerId, buyerTag, amount) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const oldCustomer = unwrapSupabase(await supabase
        .from('customers')
        .select('*')
        .eq('discord_user_id', buyerId)
        .maybeSingle(), 'Failed to load customer total');
      const previousTotal = Number(oldCustomer?.total_spent || 0);
      const totalSpent = previousTotal + Number(amount || 0);
      const tier = getTier(totalSpent);
      const customer = {
        discord_user_id: buyerId,
        username: buyerTag,
        total_spent: totalSpent,
        tier: tier?.name || null
      };

      if (!oldCustomer) {
        const { error } = await supabase.from('customers').insert(customer);
        if (!error) return { totalSpent, tier };
        if (error.code !== '23505') throw error;
        continue;
      }

      const updated = unwrapSupabase(await supabase
        .from('customers')
        .update(customer)
        .eq('discord_user_id', buyerId)
        .eq('total_spent', previousTotal)
        .select('discord_user_id')
        .maybeSingle(), 'Failed to update customer total');
      if (updated) return { totalSpent, tier };
    }

    throw new Error(`Customer total update conflicted repeatedly for ${buyerId}`);
  }

  async function syncMemberRoles(guild, buyerId, tier) {
    const member = await guild.members.fetch(buyerId).catch(() => null);
    if (!member) return;

    try {
      const customerRole = guild.roles.cache.find((role) => role.name === customerRoleName);
      if (customerRole) await member.roles.add(customerRole);

      const tierRoleIds = tierRoles
        .flatMap((item) => [item.name, ...(item.aliases || [])])
        .map((roleName) => guild.roles.cache.find((role) => role.name === roleName)?.id)
        .filter(Boolean);

      if (tierRoleIds.length) await member.roles.remove(tierRoleIds);
      if (tier) {
        const tierRole = guild.roles.cache.find((role) => role.name === tier.name);
        if (tierRole) await member.roles.add(tierRole);
      }
    } catch (error) {
      logger.warn(`Customer role sync failed for ${buyerId}:`, error.message);
    }
  }

  async function updateCustomerAndRolesUnlocked(guild, buyerId, buyerTag, amount) {
    const result = await saveCustomerTotal(buyerId, buyerTag, amount);
    await syncMemberRoles(guild, buyerId, result.tier);
    return result;
  }

  async function updateCustomerAndRoles(guild, buyerId, buyerTag, amount) {
    const previous = updateLocks.get(buyerId) || Promise.resolve();
    const update = previous
      .catch(() => null)
      .then(() => updateCustomerAndRolesUnlocked(guild, buyerId, buyerTag, amount));
    updateLocks.set(buyerId, update);

    try {
      return await update;
    } finally {
      if (updateLocks.get(buyerId) === update) updateLocks.delete(buyerId);
    }
  }

  return { getTier, updateCustomerAndRoles };
}

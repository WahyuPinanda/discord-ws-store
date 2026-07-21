export function createCustomerService({
  supabase,
  customerRoleName,
  tierRoles,
  unwrapSupabase,
  logger = console
}) {
  const updateLocks = new Map();

  function roleNameKey(value) {
    return String(value || '')
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function findRole(guild, names) {
    const expectedNames = new Set(names.map(roleNameKey));
    return guild.roles.cache.find((role) => expectedNames.has(roleNameKey(role.name))) || null;
  }

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
    if (!member) {
      const error = `Member ${buyerId} tidak ditemukan di server`;
      logger.warn(`Customer role sync failed for ${buyerId}:`, error);
      return { ok: false, error };
    }

    try {
      await guild.roles.fetch?.().catch((error) => {
        logger.warn('Failed to refresh Discord roles before customer sync:', error.message);
      });

      const customerRole = findRole(guild, [customerRoleName, 'Customer']);
      if (!customerRole) throw new Error(`Role ${customerRoleName} tidak ditemukan`);
      if (customerRole.editable === false) {
        throw new Error(`Role ${customerRole.name} berada di atas role bot atau dikelola integrasi`);
      }
      await member.roles.add(customerRole, 'WS Store transaction recorded');

      const tierRoleIds = tierRoles
        .map((item) => findRole(guild, [item.name, ...(item.aliases || [])]))
        .filter((role) => role && member.roles.cache?.has?.(role.id))
        .map((role) => role.id);

      if (tierRoleIds.length) await member.roles.remove(tierRoleIds);
      if (tier) {
        const tierRole = findRole(guild, [tier.name, ...(tier.aliases || [])]);
        if (!tierRole) throw new Error(`Role tier ${tier.name} tidak ditemukan`);
        if (tierRole.editable === false) {
          throw new Error(`Role tier ${tierRole.name} berada di atas role bot atau dikelola integrasi`);
        }
        await member.roles.add(tierRole, 'WS Store customer tier updated');
      }
      return { ok: true, error: null };
    } catch (error) {
      logger.warn(`Customer role sync failed for ${buyerId}:`, error.message);
      return { ok: false, error: error.message };
    }
  }

  async function updateCustomerAndRolesUnlocked(guild, buyerId, buyerTag, amount) {
    const result = await saveCustomerTotal(buyerId, buyerTag, amount);
    const roleSync = await syncMemberRoles(guild, buyerId, result.tier);
    return { ...result, roleSync };
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

  async function syncCustomerRoles(guild, buyerId, totalSpent) {
    return syncMemberRoles(guild, buyerId, getTier(Number(totalSpent || 0)));
  }

  return { getTier, syncCustomerRoles, updateCustomerAndRoles };
}

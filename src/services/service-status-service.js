function serviceCacheKey(guildId, service) {
  return `${guildId}:${service}`;
}

export function normalizeServiceName(service) {
  return service === 'via_login' ? 'via-login'
    : service === 'via_username' ? 'via-username'
      : service === 'group_payout' ? 'group-payout'
        : service === 'gift_gamepass' ? 'gift-gamepass'
          : service;
}

export function manualOverrideIsActive({
  updatedAt,
  date = new Date(),
  openHour,
  closeHour,
  getDateKey,
  getHour
}) {
  if (!updatedAt) return false;

  const updatedDate = new Date(updatedAt);
  if (Number.isNaN(updatedDate.getTime())) return false;

  const updatedDateKey = getDateKey(updatedDate);
  const currentDateKey = getDateKey(date);
  const yesterdayDateKey = getDateKey(new Date(date.getTime() - 24 * 60 * 60 * 1000));
  const updatedHour = getHour(updatedDate);
  const currentHour = getHour(date);

  if (currentHour >= openHour && currentHour < closeHour) {
    return updatedDateKey === currentDateKey && updatedHour >= openHour;
  }

  if (currentHour >= closeHour) {
    return updatedDateKey === currentDateKey && updatedHour >= closeHour;
  }

  return (updatedDateKey === yesterdayDateKey && updatedHour >= closeHour)
    || (updatedDateKey === currentDateKey && updatedHour < openHour);
}

export function createServiceStatusFeature({
  supabase,
  definitions,
  openHour,
  closeHour,
  getDateKey,
  getHour,
  isStoreOpen
}) {
  const cache = new Map();
  const loadedGuilds = new Set();

  function serviceIsOpen(guildId, service) {
    const normalized = normalizeServiceName(service);
    return cache.get(serviceCacheKey(guildId, normalized))?.isOpen ?? loadedGuilds.has(guildId);
  }

  function serviceStatusIsSet(guildId, service, date = new Date()) {
    const normalized = normalizeServiceName(service);
    const cached = cache.get(serviceCacheKey(guildId, normalized));
    return manualOverrideIsActive({
      updatedAt: cached?.updatedAt,
      date,
      openHour,
      closeHour,
      getDateKey,
      getHour
    });
  }

  function ticketServiceIsAvailable(guildId, type, date = new Date()) {
    if (type === 'rekber') return true;
    if (serviceStatusIsSet(guildId, type, date)) return serviceIsOpen(guildId, type);
    return isStoreOpen(date);
  }

  function orderTicketServiceIsAvailable(guildId, service, date = new Date()) {
    const orderOverrideIsActive = serviceStatusIsSet(guildId, 'order', date);
    const serviceOverrideIsActive = serviceStatusIsSet(guildId, service, date);

    // An explicit order close is the master switch for every order service.
    if (orderOverrideIsActive && !serviceIsOpen(guildId, 'order')) return false;

    // Opening one service manually must work outside normal operating hours.
    if (serviceOverrideIsActive) return serviceIsOpen(guildId, service);

    return ticketServiceIsAvailable(guildId, 'order', date)
      && serviceIsOpen(guildId, service);
  }

  function guildUiSnapshot(guildId, date = new Date()) {
    const serviceStates = Object.keys(definitions)
      .sort()
      .map((service) => {
        const cached = cache.get(serviceCacheKey(guildId, service));
        return [
          service,
          serviceStatusIsSet(guildId, service, date),
          serviceIsOpen(guildId, service),
          cached?.updatedAt || ''
        ].join(':');
      });

    return JSON.stringify({
      storeOpen: isStoreOpen(date),
      serviceStates
    });
  }

  async function loadServiceStatuses(guildId) {
    const { data, error } = await supabase
      .from('service_statuses')
      .select('service,is_open,updated_at')
      .eq('guild_id', guildId);

    if (error) {
      console.warn('Failed to load service statuses:', error.message);
      return false;
    }

    for (const key of cache.keys()) {
      if (key.startsWith(`${guildId}:`)) cache.delete(key);
    }

    for (const row of data || []) {
      const service = normalizeServiceName(row.service);
      cache.set(serviceCacheKey(guildId, service), {
        isOpen: Boolean(row.is_open),
        updatedAt: row.updated_at
      });
    }

    loadedGuilds.add(guildId);
    return true;
  }

  async function updateServiceStatus(guild, service, isOpen, updatedBy) {
    const normalized = normalizeServiceName(service);

    if (!definitions[normalized]) {
      throw new Error(`Unknown service: ${service}`);
    }

    const updatedAt = new Date().toISOString();
    const { error } = await supabase
      .from('service_statuses')
      .upsert({
        guild_id: guild.id,
        service: normalized,
        is_open: isOpen,
        updated_by: updatedBy,
        updated_at: updatedAt
      }, { onConflict: 'guild_id,service' });

    if (error) throw error;

    loadedGuilds.add(guild.id);
    cache.set(serviceCacheKey(guild.id, normalized), { isOpen, updatedAt });
  }

  return {
    guildUiSnapshot,
    loadServiceStatuses,
    orderTicketServiceIsAvailable,
    serviceIsOpen,
    serviceStatusIsSet,
    ticketServiceIsAvailable,
    updateServiceStatus
  };
}

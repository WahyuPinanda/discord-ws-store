const spamState = new Map();
let lastSpamStateCleanupAt = 0;

function pruneSpamTimestamps(timestamps, windowMs, now = Date.now()) {
  return timestamps.filter((timestamp) => now - timestamp <= windowMs);
}

function getSpamBucket(message, settings) {
  const key = `${message.guildId}:${message.author.id}`;
  const now = Date.now();
  const existing = spamState.get(key) || {
    timestamps: [],
    warnedAt: 0,
    lastActionAt: 0
  };

  existing.timestamps = pruneSpamTimestamps(existing.timestamps, settings.windowMs, now);
  existing.timestamps.push(now);
  spamState.set(key, existing);

  return existing;
}

function cleanupSpamState(settings, now = Date.now()) {
  if (now - lastSpamStateCleanupAt < settings.warningExpiresMs) return;
  lastSpamStateCleanupAt = now;

  for (const [key, bucket] of spamState) {
    const lastTimestamp = bucket.timestamps.at(-1) || 0;
    const lastActivity = Math.max(lastTimestamp, bucket.warnedAt, bucket.lastActionAt);
    if (now - lastActivity > settings.warningExpiresMs) spamState.delete(key);
  }
}

async function deleteRecentSpamMessages(message, settings) {
  if (!message.channel?.messages?.fetch) return 0;

  const since = Date.now() - settings.cleanupWindowMs;
  const fetched = await message.channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!fetched) return 0;

  const spamMessages = fetched.filter((item) =>
    item.author.id === message.author.id
    && item.createdTimestamp >= since
    && item.deletable
  );

  if (!spamMessages.size) return 0;

  if (message.channel.bulkDelete) {
    await message.channel.bulkDelete(spamMessages, true).catch(async () => {
      await Promise.all([...spamMessages.values()].map((item) => item.delete().catch(() => null)));
    });
    return spamMessages.size;
  }

  await Promise.all([...spamMessages.values()].map((item) => item.delete().catch(() => null)));
  return spamMessages.size;
}

async function sendSpamNotice(message, description) {
  const warning = await message.channel.send({
    content: `<@${message.author.id}> ${description}`
  }).catch(() => null);

  if (warning) {
    setTimeout(() => warning.delete().catch(() => null), 12_000).unref();
  }
}

async function timeoutForSpam(message, settings, reason, logModerationEvent) {
  const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);

  const deletedMessages = await deleteRecentSpamMessages(message, settings);
  let outcome = 'Messages removed; timeout unavailable';

  if (member?.moderatable) {
    try {
      await member.timeout(settings.timeoutMs, reason);
      const timeoutMinutes = Math.max(1, Math.ceil(settings.timeoutMs / 60_000));
      outcome = `Timed out for ${timeoutMinutes} minute(s)`;
      await sendSpamNotice(message, `kamu terkena timeout ${timeoutMinutes} menit karena spam. Alasan: ${reason}`);
    } catch {
      outcome = 'Messages removed; timeout failed';
      await sendSpamNotice(message, 'spam terdeteksi dan pesan sudah dihapus, tetapi bot gagal memberi timeout.');
    }
  } else {
    await sendSpamNotice(message, 'spam terdeteksi dan pesan sudah dihapus, tetapi bot tidak bisa memberi timeout pada role kamu.');
  }

  await logModerationEvent(message.guild, {
    action: 'Spam Timeout',
    userId: message.author.id,
    channelId: message.channelId || message.channel?.id,
    reason,
    deletedMessages,
    outcome
  });
}

export function createAntiSpamFeature({
  settings,
  memberIsStaff,
  logModerationEvent = async () => false
}) {
  async function handleMessageCreate(message) {
    if (!message.guild || message.author.bot || !message.member) return;
    if (memberIsStaff(message.member)) return;

    const now = Date.now();
    cleanupSpamState(settings, now);
    const bucket = getSpamBucket(message, settings);
    const rapidCount = pruneSpamTimestamps(bucket.timestamps, settings.rapidWindowMs, now).length;
    const normalCount = bucket.timestamps.length;
    const hasActiveWarning = bucket.warnedAt && now - bucket.warnedAt <= settings.warningExpiresMs;
    const actionCooldown = now - bucket.lastActionAt < 5_000;

    if (actionCooldown) return;

    if (rapidCount >= settings.rapidMaxMessages) {
      bucket.lastActionAt = now;
      bucket.timestamps = [];
      await timeoutForSpam(message, settings, 'spam terlalu cepat', logModerationEvent);
      return;
    }

    if (normalCount < settings.maxMessages) return;

    bucket.lastActionAt = now;
    bucket.timestamps = [];

    if (hasActiveWarning) {
      await timeoutForSpam(message, settings, 'mengulang spam setelah peringatan', logModerationEvent);
      bucket.warnedAt = 0;
      return;
    }

    bucket.warnedAt = now;
    const deletedMessages = await deleteRecentSpamMessages(message, settings);
    await sendSpamNotice(message, 'jangan spam. Ini peringatan pertama. Jika mengulang, kamu akan terkena timeout 5 menit.');
    await logModerationEvent(message.guild, {
      action: 'Spam Warning',
      userId: message.author.id,
      channelId: message.channelId || message.channel?.id,
      reason: 'Batas pesan dalam waktu singkat terlampaui',
      deletedMessages,
      outcome: 'First warning issued'
    });
  }

  return { handleMessageCreate };
}

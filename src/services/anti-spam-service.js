const spamState = new Map();

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

async function deleteRecentSpamMessages(message, settings) {
  if (!message.channel?.messages?.fetch) return;

  const since = Date.now() - settings.cleanupWindowMs;
  const fetched = await message.channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!fetched) return;

  const spamMessages = fetched.filter((item) =>
    item.author.id === message.author.id
    && item.createdTimestamp >= since
    && item.deletable
  );

  if (!spamMessages.size) return;

  if (message.channel.bulkDelete) {
    await message.channel.bulkDelete(spamMessages, true).catch(async () => {
      await Promise.all([...spamMessages.values()].map((item) => item.delete().catch(() => null)));
    });
    return;
  }

  await Promise.all([...spamMessages.values()].map((item) => item.delete().catch(() => null)));
}

async function sendSpamNotice(message, description) {
  const warning = await message.channel.send({
    content: `<@${message.author.id}> ${description}`
  }).catch(() => null);

  if (warning) {
    setTimeout(() => warning.delete().catch(() => null), 12_000).unref();
  }
}

async function timeoutForSpam(message, settings, reason) {
  const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);

  await deleteRecentSpamMessages(message, settings);

  if (member?.moderatable) {
    await member.timeout(settings.timeoutMs, reason).catch(() => null);
    await sendSpamNotice(message, `kamu terkena timeout 5 menit karena spam. Alasan: ${reason}`);
    return;
  }

  await sendSpamNotice(message, 'spam terdeteksi dan pesan sudah dihapus, tetapi bot tidak bisa memberi timeout pada role kamu.');
}

export function createAntiSpamFeature({ settings, memberIsStaff }) {
  async function handleMessageCreate(message) {
    if (!message.guild || message.author.bot || !message.member) return;
    if (memberIsStaff(message.member)) return;

    const now = Date.now();
    const bucket = getSpamBucket(message, settings);
    const rapidCount = pruneSpamTimestamps(bucket.timestamps, settings.rapidWindowMs, now).length;
    const normalCount = bucket.timestamps.length;
    const hasActiveWarning = bucket.warnedAt && now - bucket.warnedAt <= settings.warningExpiresMs;
    const actionCooldown = now - bucket.lastActionAt < 5_000;

    if (actionCooldown) return;

    if (rapidCount >= settings.rapidMaxMessages) {
      bucket.lastActionAt = now;
      bucket.timestamps = [];
      await timeoutForSpam(message, settings, 'spam terlalu cepat');
      return;
    }

    if (normalCount < settings.maxMessages) return;

    bucket.lastActionAt = now;
    bucket.timestamps = [];

    if (hasActiveWarning) {
      await timeoutForSpam(message, settings, 'mengulang spam setelah peringatan');
      bucket.warnedAt = 0;
      return;
    }

    bucket.warnedAt = now;
    await deleteRecentSpamMessages(message, settings);
    await sendSpamNotice(message, 'jangan spam. Ini peringatan pertama. Jika mengulang, kamu akan terkena timeout 5 menit.');
  }

  return { handleMessageCreate };
}

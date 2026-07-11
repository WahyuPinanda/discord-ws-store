import { AttachmentBuilder } from 'discord.js';

export function createTranscriptService({
  config,
  embedBase,
  channelMatchesName,
  ticketTranscriptChannel,
  ticketLogChannel
}) {
  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  async function buildTranscript(channel, ticket) {
    const messages = [];
    let before;

    while (true) {
      const batch = await channel.messages.fetch({ limit: 100, before });
      if (!batch.size) break;
      messages.push(...batch.values());
      before = batch.last().id;
    }
    messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    const rows = messages.map((message) => {
      const attachments = [...message.attachments.values()]
        .map((item) => `<a href="${escapeHtml(item.url)}">${escapeHtml(item.name || item.url)}</a>`)
        .join('<br>');
      const embeds = message.embeds
        .map((embed) => `<div class="embed"><strong>${escapeHtml(embed.title || 'Embed')}</strong><br>${escapeHtml(embed.description || '')}</div>`)
        .join('');

      return `
        <article class="message">
          <img src="${escapeHtml(message.author.displayAvatarURL())}" alt="" />
          <div>
            <div><strong>${escapeHtml(message.author.tag)}</strong> <span>${new Date(message.createdTimestamp).toLocaleString('id-ID', { timeZone: config.timezone })}</span></div>
            <p>${escapeHtml(message.content).replaceAll('\n', '<br>')}</p>
            ${attachments ? `<div class="attachments">${attachments}</div>` : ''}
            ${embeds}
          </div>
        </article>`;
    }).join('\n');

    const html = `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <title>Ticket ${ticket.id} Transcript</title>
  <style>
    body { background:#111318; color:#e8e8ea; font-family:Arial,sans-serif; margin:0; padding:24px; }
    header { border-bottom:1px solid #343842; margin-bottom:20px; padding-bottom:16px; }
    .message { display:flex; gap:12px; border-bottom:1px solid #252a33; padding:14px 0; }
    img { width:42px; height:42px; border-radius:50%; }
    p { margin:8px 0; white-space:normal; }
    span { color:#9ca3af; font-size:12px; margin-left:8px; }
    .embed { border-left:4px solid #2ecc71; background:#20232b; padding:10px; margin-top:8px; border-radius:6px; }
    a { color:#61a8ff; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(config.storeName)} - Ticket #${ticket.id}</h1>
    <p>Type: ${escapeHtml(ticket.type)} | Opener: ${escapeHtml(ticket.opener_tag || ticket.opener_id)}</p>
  </header>
  ${rows}
</body>
</html>`;

    return { html, fileName: `ticket-${ticket.id}-transcript.html` };
  }

  async function sendTranscriptLog(guild, ticket, transcript, closedBy) {
    const channel = guild.channels.cache.find((item) => channelMatchesName(item, ticketTranscriptChannel))
      || guild.channels.cache.find((item) => channelMatchesName(item, ticketLogChannel));
    if (!channel) return;

    await channel.send({
      embeds: [
        embedBase()
          .setTitle('🔒 Ticket Closed')
          .setDescription(`Ticket #${ticket.id} ditutup oleh <@${closedBy}>.`)
          .addFields(
            { name: 'Type', value: ticket.type, inline: true },
            { name: 'Opener', value: `<@${ticket.opener_id}>`, inline: true }
          )
      ],
      files: [new AttachmentBuilder(Buffer.from(transcript.html), { name: transcript.fileName })]
    });
  }

  return { buildTranscript, sendTranscriptLog };
}

import { config } from './config.js';

export function getStoreHour(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone,
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  const rawHour = parts.find((part) => part.type === 'hour')?.value || '0';
  return Number(rawHour) % 24;
}

export function isStoreOpen(date = new Date()) {
  const hour = getStoreHour(date);
  return hour >= config.openHour && hour < config.closeHour;
}

export function operatingStatusText(date = new Date()) {
  const status = isStoreOpen(date) ? 'OPEN' : 'CLOSED';
  return `${status} | Jam operasional ${String(config.openHour).padStart(2, '0')}:00-${String(config.closeHour).padStart(2, '0')}:00 ${config.timezoneLabel}`;
}

export function formatRupiah(value) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

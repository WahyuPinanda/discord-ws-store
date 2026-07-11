import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const nodeMajor = Number(process.versions.node.split('.')[0]);

test('application module graph loads without starting Discord or HTTP servers', {
  skip: nodeMajor < 22 ? 'Application runtime requires Node.js 22 or newer' : false
}, () => {
  const script = [
    "import('./src/app.js')",
    ".then(({ startBot }) => {",
    "  if (typeof startBot !== 'function') process.exit(2);",
    '})',
    '.catch((error) => {',
    '  console.error(error);',
    '  process.exit(1);',
    '});'
  ].join('');
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      DISCORD_TOKEN: 'test-token',
      DISCORD_CLIENT_ID: 'test-client',
      DISCORD_GUILD_ID: 'test-guild',
      OWNER_DISCORD_ID: 'test-owner',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SECRET_KEY: 'test-secret',
      STORE_TIMEZONE: 'Asia/Jakarta',
      STORE_OPEN_HOUR: '10',
      STORE_CLOSE_HOUR: '22'
    }
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { unwrapSupabase } from '../src/libs/supabase-result.js';

test('unwrapSupabase returns data for a successful request', () => {
  assert.deepEqual(unwrapSupabase({ data: { id: 1 }, error: null }), { id: 1 });
});

test('unwrapSupabase throws a contextual error and preserves the database code', () => {
  const databaseError = { message: 'connection lost', code: 'PGRST001' };

  assert.throws(
    () => unwrapSupabase({ data: null, error: databaseError }, 'Loading ticket failed'),
    (error) => {
      assert.match(error.message, /Loading ticket failed: connection lost/);
      assert.equal(error.code, 'PGRST001');
      assert.equal(error.cause, databaseError);
      return true;
    }
  );
});

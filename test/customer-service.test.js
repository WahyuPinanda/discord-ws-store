import assert from 'node:assert/strict';
import test from 'node:test';

import { createCustomerService } from '../src/services/customer-service.js';

function createCustomerDb() {
  let customer = null;
  return {
    get customer() {
      return customer;
    },
    from(table) {
      assert.equal(table, 'customers');
      return {
        select() {
          return {
            eq() {
              return this;
            },
            async maybeSingle() {
              return { data: customer, error: null };
            }
          };
        },
        async insert(value) {
          customer = { ...value };
          return { error: null };
        }
      };
    }
  };
}

test('customer service records the total and synchronizes customer tier roles', async () => {
  const db = createCustomerDb();
  const roleActions = [];
  const roles = [
    { id: 'customer-role', name: '🛒 Customer' },
    { id: 'loyal-role', name: 'Loyal' }
  ];
  roles.find = Array.prototype.find.bind(roles);
  const member = {
    roles: {
      cache: new Map(),
      add: async (role) => roleActions.push(['add', role.id]),
      remove: async (ids) => roleActions.push(['remove', ids])
    }
  };
  const service = createCustomerService({
    supabase: db,
    customerRoleName: '🛒 Customer',
    tierRoles: [{ min: 1_000_000, name: 'Loyal', aliases: [] }],
    unwrapSupabase: (result) => result.data,
    logger: { warn() {} }
  });
  const guild = {
    members: { fetch: async () => member },
    roles: { cache: roles, fetch: async () => roles }
  };

  const result = await service.updateCustomerAndRoles(guild, 'buyer-1', 'buyer', 1_500_000);

  assert.equal(result.totalSpent, 1_500_000);
  assert.equal(result.tier.name, 'Loyal');
  assert.equal(db.customer.total_spent, 1_500_000);
  assert.deepEqual(roleActions, [
    ['add', 'customer-role'],
    ['add', 'loyal-role']
  ]);
  assert.equal(result.roleSync.ok, true);
});

test('customer role sync reports an unmanageable role instead of hiding the failure', async () => {
  const warnings = [];
  const roles = [{ id: 'customer-role', name: 'Customer', editable: false }];
  roles.find = Array.prototype.find.bind(roles);
  const service = createCustomerService({
    supabase: {},
    customerRoleName: 'Customer',
    tierRoles: [],
    unwrapSupabase: (result) => result.data,
    logger: { warn: (...args) => warnings.push(args.join(' ')) }
  });
  const guild = {
    members: {
      fetch: async () => ({ roles: { cache: new Map(), add: async () => assert.fail('role must not be added') } })
    },
    roles: { cache: roles, fetch: async () => roles }
  };

  const result = await service.syncCustomerRoles(guild, 'buyer-2', 255_000);

  assert.equal(result.ok, false);
  assert.match(result.error, /di atas role bot|integrasi/);
  assert.equal(warnings.length > 0, true);
});

test('customer tier selection always chooses the highest matching threshold', () => {
  const service = createCustomerService({
    supabase: {},
    customerRoleName: 'Customer',
    tierRoles: [
      { min: 1_000_000, name: 'Loyal' },
      { min: 50_000_000, name: 'Royal' },
      { min: 20_000_000, name: 'Diamond' }
    ],
    unwrapSupabase: () => null
  });

  assert.equal(service.getTier(55_000_000).name, 'Royal');
  assert.equal(service.getTier(25_000_000).name, 'Diamond');
  assert.equal(service.getTier(500_000), null);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { generateProfile, validateProfile, publicAccount, creatorHandlers } = require('../src/instagram-creator.cjs');
function fixture(overrides = {}) {
  const store = { data: { accounts: [], proxies: [{ id: 'proxy' }] }, save() {} };
  const secretValues = new Map();
  const safeStorage = {
    async encryptStringAsync(value) { const token = randomUUID(); secretValues.set(token, value); return Buffer.from(token); },
    async decryptStringAsync(value) { return { result: secretValues.get(value.toString()) }; }
  };
  const handlers = creatorHandlers({ getStore: () => store, safeStorage, ensureFingerprint: account => { account.fingerprint ||= { stable: true }; }, ensureClosed() {}, clearPrepared() {}, snapshot: () => ({ accounts: store.data.accounts.map(publicAccount) }), openSignup: async () => {}, ...overrides });
  const input = { ...generateProfile('Clara Exemplo'), email: 'clara@example.com', key: randomUUID(), niche: 'Pessoal', proxyId: 'proxy' };
  return { store, handlers, input };
}
test('suggestions validate, normalize accents and always contain mixed password groups', () => {
  for (let i = 0; i < 80; i++) {
    const profile = generateProfile('Júlia Conceição'); validateProfile(profile);
    assert.match(profile.handle, /^julia\.conceicaopxx[1-9][0-9]$/);
    for (const pattern of [/[A-Z]/, /[a-z]/, /[0-9]/, /[!@#$%&*]/]) assert.match(profile.password, pattern);
    assert.equal(profile.password.length, 18);
  }
  assert.throws(() => validateProfile({ ...generateProfile(), handle: 'a..b' }), /Use um @/);
  assert.throws(() => validateProfile({ ...generateProfile(), email: 'invalid' }), /e-mail/);
});
test('suggestions use first and last names and completed ages from 18 through 29', () => {
  assert.match(generateProfile('Marina Almeida Costa').handle, /^marina\.costapxx[1-9][0-9]$/);
  const longName = generateProfile('NomeCompridoDemais SobrenomeCompridoDemais');
  assert.equal(longName.handle.length, 30);
  validateProfile(longName);
  for (const now of [new Date(2026, 0, 1), new Date(2026, 11, 31), new Date(2028, 1, 29)]) {
    for (let i = 0; i < 300; i++) {
      const profile = generateProfile('', now);
      assert.match(profile.handle, /^[a-z]+\.[a-z]+pxx[1-9][0-9]$/);
      const [, firstSurname, lastSurname] = profile.fullName.split(' ');
      assert.notEqual(firstSurname, lastSurname);
      validateProfile(profile, now);
      const { year, month, day } = profile.birthDate;
      const birthday = new Date(now.getFullYear(), month - 1, day);
      const age = now.getFullYear() - year - Number(birthday > now);
      assert.ok(age >= 18 && age <= 29);
    }
  }
  const now = new Date(2026, 10, 16);
  const profile = generateProfile('', now);
  const check = birthDate => validateProfile({ ...profile, birthDate }, now);
  check({ year: 2008, month: 11, day: 16 });
  check({ year: 1996, month: 11, day: 17 });
  assert.throws(() => check({ year: 2008, month: 11, day: 17 }), /18 e 29/);
  assert.throws(() => check({ year: 1996, month: 11, day: 16 }), /18 e 29/);
  assert.throws(() => check({ year: 2001, month: 2, day: 29 }), /Data de nascimento inválida/);
});
test('draft retries are idempotent, private fields stay encrypted and the stable session is retained', async () => {
  const { store, handlers, input } = fixture();
  const first = await handlers.saveInstagramDraft(input);
  const next = await handlers.saveInstagramDraft(input);
  assert.equal(first.accountId, next.accountId); assert.equal(store.data.accounts.length, 1);
  assert.equal(store.data.accounts[0].browserProfile, 'account');
  assert.equal(store.data.accounts[0].postingConnection, 'direct');
  assert.ok(!JSON.stringify(store.data).includes(input.password)); assert.ok(!JSON.stringify(store.data).includes(input.email));
  assert.ok(!JSON.stringify(first.state).includes('creatorSecret'));
  const restored = await handlers.loadInstagramDraft(first.accountId);
  assert.equal(restored.password, input.password); assert.equal(restored.email, input.email);
  const fp = store.data.accounts[0].fingerprint;
  await handlers.saveInstagramDraft({ ...input, id: first.accountId, name: 'Apelido' });
  assert.equal(store.data.accounts[0].fingerprint, fp);
  await assert.rejects(handlers.saveInstagramDraft({ ...input, key: randomUUID() }), /já está cadastrado/);
});
test('completion requires opening and explicit manual confirmation; connection failures preserve draft', async () => {
  const { store, handlers, input } = fixture();
  const { accountId: id } = await handlers.saveInstagramDraft(input);
  assert.throws(() => handlers.completeInstagramDraft({ id, confirmed: true }), /Abra o cadastro/);
  await handlers.openInstagramSignup(id);
  assert.equal(store.data.accounts[0].registration.status, 'awaiting');
  assert.throws(() => handlers.completeInstagramDraft({ id, confirmed: false }), /confirme/);
  handlers.completeInstagramDraft({ id, confirmed: true });
  assert.equal(store.data.accounts[0].registration.status, 'completed');
  await assert.rejects(handlers.saveInstagramDraft({ ...input, id }), /concluído/);
  const failed = fixture({ openSignup: async () => { throw new Error('offline'); } });
  const result = await failed.handlers.saveInstagramDraft(failed.input);
  await assert.rejects(failed.handlers.openInstagramSignup(result.accountId), /offline/);
  assert.equal(failed.store.data.accounts[0].registration.status, 'draft');
});
test('encryption and proxy errors do not create partial accounts', async () => {
  const failed = fixture({ safeStorage: { encryptStringAsync: async () => { throw new Error('vault unavailable'); } } });
  await assert.rejects(failed.handlers.saveInstagramDraft(failed.input), /vault unavailable/);
  assert.equal(failed.store.data.accounts.length, 0);
  const { handlers, input, store } = fixture();
  await assert.rejects(handlers.saveInstagramDraft({ ...input, proxyId: 'missing' }), /Proxy não encontrado/);
  assert.equal(store.data.accounts.length, 0);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const domain = require('../src/domain.cjs');
const { Store } = require('../src/store.cjs');
const { parseProxyLine } = require('../src/ui/proxy-format.js');
test('colar proxy separa dados, preserva dois-pontos na senha e aceita conexão sem autenticação', () => {
  assert.deepEqual(parseProxyLine(' 192.0.2.10:50100:usuario:senha:extra '), { host: '192.0.2.10', port: 50100, username: 'usuario', password: 'senha:extra' });
  assert.deepEqual(parseProxyLine('proxy.example:8080'), { host: 'proxy.example', port: 8080, username: '', password: '' });
  for (const value of ['host:0:user:secret', 'host:65536:user:secret', 'host:80:user', 'host:80:user:', 'http://host:80', 'host:80:u:p\nhost:81:u:p']) {
    assert.throws(() => parseProxyLine(value));
  }
});
const accounts = [{ id: 'one' }];
const validCampaign = { name: 'Futebol', targetType: 'hashtag', target: '#futebol', comments: 'Uma frase\nOutra frase', accountIds: ['one'], waitMin: 10, waitMax: 30, watchSeconds: 8, skipPercent: 0, sessionLimit: 10, hourlyLimit: 5, likePercent: 35, favoritePercent: 20 };
test('campanha normaliza hashtag, preserva frases e rejeita contas ausentes', () => {
  const c = domain.campaign(validCampaign, accounts);
  assert.equal(c.target, 'futebol'); assert.equal(c.comments.length, 2); assert.equal(c.targetSwitchMin, 15); assert.equal(c.targetSwitchMax, 20);
  assert.throws(() => domain.campaign({ ...validCampaign, accountIds: ['missing'] }, accounts), /conta/);
  assert.throws(() => domain.campaign({ ...validCampaign, waitMax: 1 }, accounts), /Espera máxima/);
  assert.deepEqual(domain.campaign({ ...validCampaign, target: '#futebol, esportes\nbrasileirão' }, accounts).targets, ['futebol', 'esportes', 'brasileirão']);
  const interval = domain.campaign({ ...validCampaign, target: '#futebol, esportes', targetSwitchMin: 4, targetSwitchMax: 9 }, accounts);
  assert.equal(interval.targetSwitchMin, 4); assert.equal(interval.targetSwitchMax, 9);
  assert.throws(() => domain.campaign({ ...validCampaign, targetSwitchMin: 8, targetSwitchMax: 4 }, accounts), /Troca máxima/);
  assert.throws(() => domain.campaign({ ...validCampaign, target: 'hashtag-inválida' }, accounts), /hashtag/);
  assert.throws(() => domain.campaign(validCampaign, [{ id: 'one', platform: 'instagram' }]), /TikTok/);
});
test('busca aceita uma palavra ou frase completa', () => {
  const search = domain.campaign({ ...validCampaign, targetType: 'search', target: '  melhores momentos do Neymar  ' }, accounts);
  assert.equal(search.target, 'melhores momentos do Neymar');
  assert.deepEqual(search.targets, ['melhores momentos do Neymar']);
  const multiple = domain.campaign({ ...validCampaign, targetType: 'search', target: 'zangi\nconhecer pessoas\nzangi', targetSwitchMin: 15, targetSwitchMax: 20 }, accounts);
  assert.deepEqual(multiple.targets, ['zangi', 'conhecer pessoas']);
  assert.equal(multiple.targetSwitchMin, 15); assert.equal(multiple.targetSwitchMax, 20);
});
test('modo Para você automatiza comentários e mantém porcentagens independentes', () => {
  const assisted = domain.campaign({ ...validCampaign, targetType: 'foryou', target: '', like: true, favorite: true, likePercent: 72, favoritePercent: 18 }, accounts);
  assert.equal(assisted.target, 'Para você');
  assert.equal(assisted.like, true);
  assert.equal(assisted.favorite, true);
  assert.equal(assisted.likePercent, 72);
  assert.equal(assisted.favoritePercent, 18);
  assert.throws(() => domain.campaign({ ...validCampaign, targetType: 'foryou', target: '', accountIds: ['one', 'two'] }, [{ id: 'one' }, { id: 'two' }]), /uma conta/);
});
test('proxy rejeita credenciais na URL e autenticação SOCKS não suportada', () => {
  const valid = { name: 'Local', protocol: 'http', host: '127.0.0.1', port: 8080 };
  assert.equal(domain.proxy(valid).port, 8080);
  assert.throws(() => domain.proxy({ ...valid, host: 'user:pass@proxy.test' }), /somente/);
  assert.throws(() => domain.proxy({ ...valid, protocol: 'socks5', username: 'u', password: 'p' }), /SOCKS5/);
  assert.throws(() => domain.proxy({ ...valid, port: 0 }), /Porta/);
});
test('conta exige referência a proxy existente', () => {
  assert.throws(() => domain.account({ name: 'Conta', proxyId: 'missing' }, []), /Proxy/);
  assert.equal(domain.account({ name: 'Conta' }, []).platform, 'tiktok');
  assert.equal(domain.account({ name: 'Instagram', platform: 'instagram' }, []).platform, 'instagram');
  assert.equal(domain.account({ name: 'Conta X', platform: 'x' }, []).platform, 'x');
  assert.throws(() => domain.campaign(validCampaign, [{ id: 'one', platform: 'x' }]), /TikTok/);
  assert.throws(() => domain.account({ name: 'Conta', platform: 'other' }, []), /Plataforma/);
});
test('dados persistem e arquivo corrompido não é silenciosamente substituído', () => {
  const scratch = path.join(__dirname, '..', '.smoke');
  fs.mkdirSync(scratch, { recursive: true });
  const dir = fs.mkdtempSync(path.join(scratch, 'unit-'));
  const store = new Store(dir); store.data.accounts.push({ id: 'one', name: 'Conta' }); store.log('Cadastro');
  assert.equal(new Store(dir).data.accounts[0].platform, 'tiktok');
  fs.writeFileSync(store.file, '{invalid'); assert.throws(() => new Store(dir));
  // Mantém o diretório temporário para inspeção em caso de falha.
});

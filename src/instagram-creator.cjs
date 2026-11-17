'use strict';
const domain = require('./domain.cjs');
const { randomInt } = require('node:crypto');

const names = [
  'Adriana', 'Alice', 'Aline', 'Alícia', 'Amanda', 'Ana', 'Andréa', 'Antonella', 'Ariane', 'Aurora',
  'Bárbara', 'Beatriz', 'Bianca', 'Brenda', 'Bruna', 'Camila', 'Carla', 'Carolina', 'Catarina', 'Cecília',
  'Clara', 'Daniela', 'Débora', 'Eduarda', 'Elisa', 'Eloá', 'Emília', 'Estela', 'Fernanda', 'Flávia',
  'Gabriela', 'Giovana', 'Heloísa', 'Helena', 'Isabela', 'Isadora', 'Jéssica', 'Joana', 'Júlia', 'Juliana',
  'Larissa', 'Laura', 'Lavínia', 'Lívia', 'Letícia', 'Lorena', 'Luana', 'Luísa', 'Luiza', 'Luna',
  'Manuela', 'Marcela', 'Mariana', 'Marina', 'Maya', 'Melissa', 'Natália', 'Nicole', 'Olívia', 'Paula',
  'Priscila', 'Rafaela', 'Raquel', 'Rebeca', 'Renata', 'Sabrina', 'Sara', 'Sofia', 'Taís', 'Talita',
  'Tatiana', 'Valentina', 'Vanessa', 'Vitória', 'Yasmin'
];
const surnames = [
  'Almeida', 'Alves', 'Andrade', 'Azevedo', 'Barbosa', 'Batista', 'Campos', 'Cardoso', 'Carvalho', 'Castro',
  'Coelho', 'Correia', 'Costa', 'Cunha', 'Dias', 'Duarte', 'Ferreira', 'Figueiredo', 'Freitas', 'Gomes',
  'Lima', 'Lopes', 'Machado', 'Marques', 'Martins', 'Medeiros', 'Mendes', 'Miranda', 'Monteiro', 'Moreira',
  'Moura', 'Nascimento', 'Neves', 'Nunes', 'Oliveira', 'Pereira', 'Pinto', 'Ramos', 'Ribeiro', 'Rocha',
  'Rodrigues', 'Santana', 'Santos', 'Silva', 'Soares', 'Souza', 'Teixeira', 'Vieira'
];

function ageAt({ year, month, day }, now) {
  const birthdayPending = month > now.getMonth() + 1 || (month === now.getMonth() + 1 && day > now.getDate());
  return now.getFullYear() - year - Number(birthdayPending);
}

function generateProfile(name = '', now = new Date()) {
  let fullName = String(name).trim().slice(0, 80);
  if (!fullName) {
    const firstSurname = randomInt(surnames.length);
    const lastSurname = (firstSurname + randomInt(1, surnames.length)) % surnames.length;
    fullName = `${names[randomInt(names.length)]} ${surnames[firstSurname]} ${surnames[lastSurname]}`;
  }
  const parts = fullName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const firstName = (parts[0] || 'perfil').slice(0, 13);
  const suffix = `pxx${randomInt(10, 100)}`;
  const surnameBudget = 30 - firstName.length - 1 - suffix.length;
  const surname = (parts.length > 1 ? parts[parts.length - 1] : surnames[randomInt(surnames.length)].toLowerCase()).slice(0, surnameBudget);
  const handle = `${firstName}.${surname}${suffix}`;
  const groups = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%&*'];
  const all = groups.join('');
  const chars = groups.map(group => group[randomInt(group.length)]);
  while (chars.length < 18) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) { const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  // Choose a completed age, accounting for birthdays still ahead this year.
  const age = randomInt(18, 30);
  const month = randomInt(1, 13);
  const day = randomInt(1, new Date(2001, month, 0).getDate() + 1);
  const birthdayPending = month > now.getMonth() + 1 || (month === now.getMonth() + 1 && day > now.getDate());
  const year = now.getFullYear() - age - Number(birthdayPending);
  const birthDate = { year, month, day };
  return { fullName, handle, password: chars.join(''), birthDate };
}

function validateProfile(input, now = new Date()) {
  const fullName = String(input.fullName || '').trim();
  if (!fullName || fullName.length > 80) throw new Error('Preencha o nome do perfil com até 80 caracteres.');
  const handle = String(input.handle || '').trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_](?:[a-z0-9._]{0,28}[a-z0-9_])?$/.test(handle) || handle.includes('..')) throw new Error('Use um @ de até 30 caracteres, com letras, números, ponto ou sublinhado.');
  const password = String(input.password || '');
  if (password.length < 8 || password.length > 128) throw new Error('Use uma senha entre 8 e 128 caracteres.');
  const email = String(input.email || '').trim();
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error('Informe um e-mail válido.');
  const niche = String(input.niche || 'Pessoal');
  if (!['Pessoal', 'Lifestyle', 'Beleza', 'Moda', 'Viagens', 'Negócios'].includes(niche)) throw new Error('Escolha um nicho válido.');
  const birthDate = input.birthDate;
  if (!birthDate || !Number.isInteger(birthDate.year) || !Number.isInteger(birthDate.month) || !Number.isInteger(birthDate.day)) throw new Error('Informe a data de nascimento.');
  const date = new Date(birthDate.year, birthDate.month - 1, birthDate.day);
  if (date.getFullYear() !== birthDate.year || date.getMonth() + 1 !== birthDate.month || date.getDate() !== birthDate.day) throw new Error('Data de nascimento inválida.');
  const age = ageAt(birthDate, now);
  if (age < 18 || age > 29) throw new Error('A idade deve ser entre 18 e 29 anos.');
  return { fullName, handle, password, email, niche, birthDate };
}

function publicAccount(account) {
  const { creatorSecret, ...visible } = account;
  return visible;
}

function creatorHandlers({ getStore, safeStorage, ensureFingerprint, ensureClosed, clearPrepared, snapshot, openSignup }) {
  let saving = false;
  const find = id => {
    const account = getStore().data.accounts.find(item => item.id === id && item.platform === 'instagram' && item.registration);
    if (!account) throw new Error('Rascunho não encontrado.');
    return account;
  };
  return {
    generateInstagramProfile: input => generateProfile(input?.name),
    saveInstagramDraft: async input => {
      if (saving) throw new Error('Aguarde o salvamento do rascunho.');
      saving = true;
      try {
        const store = getStore();
        const profile = validateProfile(input);
        if (!/^[a-f0-9-]{36}$/i.test(input.key || '')) throw new Error('Identificador de rascunho inválido.');
        const previous = input.id ? find(input.id) : store.data.accounts.find(item => item.registration?.key === input.key);
        if (previous?.registration.status === 'completed') throw new Error('Este cadastro já foi concluído. Inicie outro perfil.');
        if (store.data.accounts.some(item => item.id !== previous?.id && item.platform === 'instagram' && item.handle?.toLowerCase() === profile.handle)) throw new Error('Este @ já está cadastrado no aplicativo.');
        const account = domain.account({ platform: 'instagram', name: input.name || profile.fullName, handle: profile.handle, proxyId: input.proxyId, postingConnection: 'direct' }, store.data.proxies);
        const encrypted = (await safeStorage.encryptStringAsync(JSON.stringify(profile))).toString('base64');
        // Recheck after encryption: a proxy may have been removed in the meantime.
        if (previous && !store.data.accounts.includes(previous)) throw new Error('Este rascunho foi excluído. Inicie outro perfil.');
        if (previous?.registration.status === 'completed') throw new Error('Este cadastro já foi concluído.');
        if (account.proxyId && !store.data.proxies.some(proxy => proxy.id === account.proxyId)) throw new Error('Proxy não encontrado.');
        if (previous && previous.proxyId !== account.proxyId) { ensureClosed(previous); clearPrepared(previous.id); }
        const target = previous || account;
        Object.assign(target, { name: account.name, handle: account.handle, proxyId: account.proxyId, browserProfile: previous?.browserProfile || 'account', creatorSecret: encrypted,
          registration: { key: input.key, status: previous?.registration.status || 'draft', niche: profile.niche, updatedAt: new Date().toISOString() } });
        ensureFingerprint(target);
        if (!previous) store.data.accounts.push(target);
        store.save();
        return { accountId: target.id, state: snapshot() };
      } finally { saving = false; }
    },
    loadInstagramDraft: async id => {
      const account = find(id);
      const decrypted = await safeStorage.decryptStringAsync(Buffer.from(account.creatorSecret, 'base64'));
      return { ...JSON.parse(decrypted.result), id, key: account.registration.key, name: account.name, proxyId: account.proxyId || '', status: account.registration.status };
    },
    openInstagramSignup: async id => {
      const account = find(id);
      if (account.registration.status === 'completed') throw new Error('Este cadastro já foi concluído.');
      await openSignup(id);
      account.registration.status = 'awaiting';
      getStore().save();
      return snapshot();
    },
    completeInstagramDraft: input => {
      const account = find(input.id);
      if (input.confirmed !== true || account.registration.status !== 'awaiting') throw new Error('Abra o cadastro e confirme que concluiu a criação no Instagram.');
      account.registration.status = 'completed';
      account.registration.completedAt = new Date().toISOString();
      getStore().save();
      return snapshot();
    }
  };
}
module.exports = { generateProfile, validateProfile, publicAccount, creatorHandlers };

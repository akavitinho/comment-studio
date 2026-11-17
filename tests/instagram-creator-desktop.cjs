// Run the creator flow with the app's normal IPC bridge and isolated smoke data.
// The regular desktop suite also runs this flow before the broader regression checks.
process.argv.push('--smoke');
const assert = require('node:assert/strict');
const { BrowserWindow } = require('electron');
const { fillSignup, isInstagramSignup } = require('../src/instagram-signup-fill.cjs');

async function testSignupFields() {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await window.loadURL('data:text/html,' + encodeURIComponent(`
      <input name="emailOrPhone" type="tel">
      <input name="fullName">
      <input name="username" value="nome.escolhido">
      <input name="password" type="password">
      <input name="confirmPassword" aria-label="Confirmar senha" type="password">
    `));
    const profile = { email: 'teste@example.com', fullName: 'Perfil Teste', handle: 'perfil.testepxx', password: 'fixture-password', birthDate: { month: 11, day: 16, year: 2000 } };
    const execute = code => window.webContents.executeJavaScript(code);
    const runFill = origin => execute(`((location) => (${fillSignup.toString()})(${JSON.stringify(profile)}, '^/accounts/emailsignup/', Date.now() + 5000))({origin: ${JSON.stringify(origin)}, pathname: '/accounts/emailsignup/'})`);
    const values = () => execute(`Array.from(document.querySelectorAll('input, select'), field => field.value)`);
    assert.equal(isInstagramSignup('https://www.instagram.com/accounts/emailsignup/'), true);
    assert.equal(isInstagramSignup('https://example.com/?next=instagram.com/accounts/emailsignup/'), false);
    await runFill('https://example.com');
    assert.deepEqual(await values(), ['', '', 'nome.escolhido', '', '']);
    await runFill('https://www.instagram.com');
    assert.deepEqual(await values(), [profile.email, profile.fullName, 'nome.escolhido', profile.password, '']);
    await execute(`document.body.insertAdjacentHTML('beforeend', '<select name="birthday_month"><option value="1">Janeiro</option><option value="11">Novembro</option></select><label>Dia<select><option value="1">1</option><option value="16">16</option></select></label><select aria-label="Ano"><option value="2001">2001</option><option value="2000">2000</option></select>'); void 0`);
    for (let i = 0; i < 20; i++) {
      if ((await values()).at(-1) === '2000') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.deepEqual((await values()).slice(-3), ['11', '16', '2000']);
    await execute(`
      document.querySelectorAll('select').forEach(select => select.remove());
      document.body.insertAdjacentHTML('beforeend',
        '<div><div>Nome de usuário</div><div><input type="search" id="opaque"><span>Verifique a disponibilidade</span></div></div>' +
        '<div><button aria-expanded="false">Dia</button><button aria-expanded="false">Mês</button><button aria-expanded="false">Ano</button></div>');
      const options = [['15', '16'], ['Outubro', 'Novembro'], ['2001', '2000']];
      const username = document.getElementById('opaque');
      username.addEventListener('input', () => setTimeout(() => { username.value = ''; }, 75), { once: true });
      document.querySelectorAll('button').forEach((button, index) => {
        button.addEventListener('click', () => {
          button.setAttribute('aria-expanded', 'true');
          const list = document.createElement('div');
          list.setAttribute('role', 'listbox');
          document.body.append(list);
          setTimeout(() => options[index].forEach(label => {
            const option = document.createElement('div');
            option.setAttribute('role', 'option');
            option.textContent = label;
            option.addEventListener('click', () => {
              button.textContent = label;
              button.setAttribute('aria-expanded', 'false');
              list.remove();
            });
            list.append(option);
          }), 150);
        });
      });
      void 0
    `);
    const selectedDates = () => execute(`Array.from(document.querySelectorAll('button'), button => button.textContent)`);
    for (let i = 0; i < 40; i++) {
      if ((await selectedDates()).at(-1) === '2000') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.deepEqual(await selectedDates(), ['16', 'Novembro', '2000']);
    assert.equal(await execute(`document.getElementById('opaque').value`), profile.handle);
  } finally {
    window.destroy();
  }
}

require('./desktop.cjs').run = async context => {
  const contents = context.mainWindow.webContents;
  for (let i = 0; i < 100; i++) {
    if (await contents.executeJavaScript('document.body.dataset.ready === "true"')) {
      await testSignupFields();
      await require('./instagram-creator-proxy-ui.cjs').run(context);
      await require('./instagram-creator-ui.cjs').run(context);
      console.log('Instagram creator: IPC, protected storage, resume, completion and responsive layouts passed.');
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Interface não inicializada.');
};
require('../src/main.cjs');

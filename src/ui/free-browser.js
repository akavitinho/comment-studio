const address = document.querySelector('#address');
const status = document.querySelector('#status');
const tabs = document.querySelector('#tabs');
document.querySelector('#new-tab').addEventListener('click', () => window.freeBrowser.newTab());
document.querySelector('#bar').addEventListener('submit', event => { event.preventDefault(); status.textContent = ''; window.freeBrowser.navigate(address.value); });
for (const action of ['back', 'forward', 'reload', 'home']) document.querySelector(`#${action}`).addEventListener('click', () => window.freeBrowser[action]());
window.freeBrowser.onState(state => {
  tabs.replaceChildren();
  for (const tab of state.tabs || []) {
    const item = document.createElement('div'); item.className = `browser-tab${tab.active ? ' active' : ''}`;
    const select = document.createElement('button'); select.type = 'button'; select.className = 'browser-tab-select'; select.textContent = tab.label; select.title = tab.label;
    select.setAttribute('role', 'tab'); select.setAttribute('aria-selected', String(tab.active)); select.addEventListener('click', () => window.freeBrowser.selectTab(tab.id));
    const close = document.createElement('button'); close.type = 'button'; close.className = 'browser-tab-close'; close.textContent = '×'; close.setAttribute('aria-label', `Fechar aba ${tab.label}`); close.title = 'Fechar aba (Ctrl+W)';
    close.addEventListener('click', () => window.freeBrowser.closeTab(tab.id));
    item.append(select, close); tabs.append(item);
  }
  if (document.activeElement !== address) address.value = state.url || '';
  document.querySelector('#back').disabled = !state.back;
  document.querySelector('#forward').disabled = !state.forward;
  status.textContent = state.message || '';
});
window.freeBrowser.onFocusAddress(() => { address.focus(); address.select(); });

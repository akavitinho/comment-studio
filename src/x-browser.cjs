const input = require('./background-input.cjs');
const { xPage } = require('./x-page-controls.cjs');
const { searchURL } = require('./x-domain.cjs');
const { manualError } = require('./x-errors.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function bounded(fn, ms = 15000) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(fn), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('O X não respondeu no prazo. Confira a janela.')), ms); })]); }
  finally { clearTimeout(timer); }
}
class XBrowser {
  constructor({ getWindow, openAccount }) { this.getWindow = getWindow; this.openAccount = openAccount; this.drafts = new Map(); }
  win(id) { const win = this.getWindow(id); if (!win || win.isDestroyed()) throw new Error('A janela do X foi fechada. Abra a conta e continue.'); return win; }
  async page(id, operation, args) {
    const win = this.win(id);
    if (!/^https:\/\/x\.com\//.test(win.webContents.getURL())) throw new Error('Abra o X na janela desta conta.');
    return bounded(() => win.webContents.executeJavaScript(`(${xPage.toString()})(${JSON.stringify(operation)}, ${JSON.stringify(args || {})})`));
  }
  async read(id) {
    const result = await this.page(id, 'inspect');
    if (result.attention) throw manualError(result.attention);
    if (!result.handle) throw new Error('Não foi possível confirmar a identidade da sessão do X. Confira o login.');
    return result;
  }
  async control(id, operation, args) {
    // Allow scroll/layout to reach Chromium's input compositor before using coordinates.
    await this.page(id, operation, args);
    await sleep(180);
    return this.page(id, operation, args);
  }
  async poll(fn, accept, ms = 12000) {
    const end = Date.now() + ms;
    do { const result = await fn(); if (accept(result)) return result; await sleep(300); } while (Date.now() < end);
    throw new Error('Controle ou confirmação do X não encontrado. Confira a janela.');
  }
  async search(id, tag, order, targetType = 'hashtag') {
    await this.openAccount(id);
    const win = this.win(id), url = searchURL(tag, order, targetType);
    await bounded(() => win.loadURL(url), 30000);
    if (targetType === 'foryou') {
      await this.ready(id, r => r.url === url);
      if (!(await this.read(id)).feedSelected) {
        const point = await this.poll(() => this.control(id, 'feedTab'), Boolean);
        await input.click(win, point);
      }
      return this.ready(id, r => r.url === url && r.feedSelected && r.recognized);
    }
    return this.ready(id, r => r.recognized && r.url === url);
  }
  async ready(id, accept) {
    // loadURL finishes before X hydrates its account navigation. Missing identity
    // during that interval is loading, not evidence that the saved login expired.
    return this.poll(async () => {
      const state = await this.page(id, 'inspect');
      if (state.attention) throw manualError(state.attention);
      return state;
    }, state => Boolean(state.handle) && accept(state));
  }
  async more(id) { await this.page(id, 'scroll'); await sleep(700); return this.read(id); }
  async inspectPost(id, post) {
    await this.clearOwnedDraft(id);
    const current = this.win(id).webContents.getURL();
    if (current === post.url) {
      const state = await this.read(id);
      if (state.posts.some(p => p.id === post.id)) return state;
    }
    await bounded(() => this.win(id).loadURL(post.url), 30000);
    return this.ready(id, r => r.posts.some(p => p.id === post.id));
  }
  async prepare(id, post, action, text) {
    const before = await this.read(id);
    const target = before.posts.find(p => p.id === post.id);
    if (!target) throw new Error('O post alvo não está mais disponível.');
    const editorArgs = { id: post.id, author: target.author, parentText: target.text };
    if (action === 'like' && target.liked) return { skipped: true };
    if (action === 'reply') {
      const openEditor = await this.page(id, 'editor', editorArgs);
      if (!openEditor?.point) {
        const point = await this.control(id, 'point', { id: post.id, action });
        if (!point) throw new Error('Controle de interação indisponível neste post.');
        await input.click(this.win(id), point);
      }
      const editor = await this.editorStep(id, editorArgs, 'reconhecer o editor', () => this.poll(() => this.page(id, 'editor', editorArgs), r => r?.point));
      const owned = this.drafts.get(id);
      if (editor.text && !(owned?.postId === post.id && owned.text === text && editor.text === text)) throw manualError('O editor contém um rascunho. Revise-o manualmente antes de continuar.');
      const settled = await this.control(id, 'editor', editorArgs);
      await input.click(this.win(id), settled?.point);
      await this.editorStep(id, editorArgs, 'focar o editor', async () => {
        try { return await this.poll(() => this.page(id, 'editor', editorArgs), r => r?.focused, 1200); }
        catch { if (await this.page(id, 'focusEditor', editorArgs)) return true; return this.poll(() => this.page(id, 'editor', editorArgs), r => r?.focused); }
      });
      if (!editor.text) { this.drafts.set(id, { postId: post.id, text, editorArgs }); await input.insertText(this.win(id), text); }
      await this.editorStep(id, editorArgs, 'validar o texto e o botão de resposta', () => this.poll(() => this.page(id, 'send', { ...editorArgs, text }), Boolean));
    } else {
      const point = await this.control(id, 'point', { id: post.id, action });
      if (!point) throw new Error('Controle de interação indisponível neste post.');
    }
    return { beforeIds: before.posts.map(p => p.id), handle: before.handle, editorArgs };
  }
  async editorStep(id, args, stage, operation) {
    try { return await operation(); }
    catch (error) {
      if (error.code === 'X_MANUAL') throw error;
      let details = '';
      const state = await this.page(id, 'inspect');
      if (state.attention) throw manualError(state.attention);
      try { const d = await this.page(id, 'diagnoseEditor', args); details = ` [diálogos=${d.dialogs}; alvo=${d.matched}; editores=${d.editors}/${d.totalEditors}; clicável=${d.point}; foco=${d.focused}; caracteres=${d.draftLength}]`; } catch {}
      throw new Error(`Falha ao ${stage}.${details}`);
    }
  }
  async clearOwnedDraft(id) {
    const draft = this.drafts.get(id);
    if (!draft) return;
    const details = await this.page(id, 'diagnoseEditor', draft.editorArgs);
    if (!details.totalEditors) { this.drafts.delete(id); return; }
    const editor = await this.page(id, 'editor', draft.editorArgs);
    if (!editor || (editor.text && editor.text !== draft.text)) throw manualError('O rascunho foi alterado ou não pertence ao post esperado. Revise-o manualmente.');
    if (editor.text) {
      if (!await this.page(id, 'selectOwnedDraft', { ...draft.editorArgs, text: draft.text })) throw manualError('Não foi possível selecionar o rascunho criado pelo aplicativo.');
      await input.pressKey(this.win(id), 'Backspace', 8);
      await this.poll(() => this.page(id, 'editor', draft.editorArgs), r => r && !r.text);
    }
    this.drafts.delete(id);
  }
  async send(id, post, action, text, prepared, dispatch) {
    // Re-resolve after pause/limits; do not keep stale screen coordinates.
    const state = action === 'reply' ? await this.page(id, 'inspect') : await this.read(id);
    if (state.attention) throw manualError(state.attention);
    if ((state.handle && state.handle !== prepared.handle) || (action === 'like' && !state.handle)) throw manualError('A identidade da sessão mudou.');
    if (action === 'like' && state.posts.find(p => p.id === post.id)?.liked) return 'skipped';
    const point = await this.control(id, action === 'like' ? 'point' : 'send', { ...prepared.editorArgs, id: post.id, action, text });
    if (!point) throw new Error('O controle mudou antes do envio.');
    // Synchronous durable intent and capacity reservation immediately before dispatch.
    if (!dispatch()) return 'cancelled';
    const sentAt = Date.now();
    await input.click(this.win(id), point);
    await this.poll(async () => { const r = await this.page(id, 'inspect'); if (r.attention) throw manualError(r.attention); return r; }, r => action === 'like'
      ? r.posts.some(p => p.id === post.id && p.liked)
      : !r.dialogOpen && r.posts.some(p => !prepared.beforeIds.includes(p.id) && Date.parse(p.at) >= sentAt - 5000 && p.author.toLowerCase() === prepared.handle.toLowerCase() && p.text === text));
    if (action === 'reply') this.drafts.delete(id);
    return 'confirmed';
  }
}
module.exports = { XBrowser, bounded };

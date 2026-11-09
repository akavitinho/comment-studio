function manualError(message) { return Object.assign(new Error(message), { code: 'X_MANUAL' }); }
function needsManual(error) {
  return error?.code === 'X_MANUAL' || /faça login|login necess[aá]rio|captcha|desafio|verifica[çc][aã]o na janela|restringiu|restri[çc][aã]o|suspens|rascunho|identidade.*mudou|janela.*fechada|abra o x na janela/i.test(error?.message || '');
}
module.exports = { manualError, needsManual };

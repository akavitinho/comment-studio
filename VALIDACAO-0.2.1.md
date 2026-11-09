# Validação da versão 0.2.1 — 28/10/2026

## Implementado

- Identidade consultada novamente na navegação global da janela; nenhuma identidade reaproveitada de outra janela. Autor, comentários e recomendações são excluídos. Cadastro usado quando não há uma identificação inequívoca.
- Identificadores numéricos não equivalem automaticamente ao @. Alias aceito somente com endereço canônico do mesmo vídeo atualmente aberto, no mesmo domínio.
- Editor e botões procurados no contexto do vídeo visível. Abertura da aba Comentários com duas esperas de 15 segundos. Comentários explicitamente desativados têm tratamento separado.
- Três falhas consecutivas colocam a conta em atenção; Continuar retenta o vídeo pendente. As primeiras falhas ficam numa fila de recuperação e não são marcadas como concluídas. No Para você, a recuperação pode reabrir o endereço exato do vídeo pendente e depois voltar à página principal; não abre o perfil do autor.
- Recuperação mantém fila, hashtag ativa, contador de troca, frase e decisão de descarte. Percentual configurado de 10% preservado, sem alterar os cadastros ou o formato das campanhas.
- Vídeo conferido depois dos pontos de pausa e antes do envio; identidade conferida novamente antes de publicar. Tentativas só são registradas quando o clique de envio está pronto; depois de acionado, um resultado incerto fica registrado sem repetir o clique.
- Painel mostra motivo de atenção, vídeo pendente, Continuar por conta e versão em execução.

## Executado e aprovado

`node --test --test-reporter=spec tests/*.test.cjs`: **56 testes aprovados, zero falhas**.

Inclui regressões de identidade com as funções de produção executadas em VM e objetos DOM de teste, Metrópoles/G1, vídeo próprio, fallback, aliases numéricos, duas janelas, troca de login, três falhas no editor, duas esperas de 15 segundos, recuperação da fila e da hashtag, sorteio único, pausa com mudança de vídeo e envio incerto sem segundo clique. Essas simulações não comprovam os seletores do TikTok atual.

Verificação de sintaxe aprovada em automation.cjs, page-controls.cjs, main.cjs, preload.cjs, ui/app.js e nos testes de desktop/DOM.

## Pendente — não declarar aprovado

- `npm run test:dom`: suíte criada para executar seletores de produção sobre HTML renderizado no Electron. Inclui aba de recomendações aberta, editor lento, aviso de comentários desativados e resultados sem hashtag na legenda. Não houve resultado válido desta execução.
- `npm run test:desktop`: inclui a suíte de DOM e verificações do painel, versão e atenção por conta. Não foi concluído nesta entrega.
- TikTok real: não foi verificada a identificação nem a abertura do editor com a versão nova. Nenhum comentário, curtida ou favorito foi publicado durante esta validação.

A execução do Electron no terminal restrito encerrou sem produzir resultado. A tentativa posterior de reiniciar o teste com diretório explícito foi bloqueada porque a revisão automática atingiu o limite de uso. O navegador integrado também estava desabilitado nas configurações do ambiente.

## Conferência após reiniciar

1. Fechar o aplicativo antigo e abrir `iniciar.cmd`. Confirmar **Versão 0.2.1** na lateral.
2. Conferir o @ cadastrado da conta. Usar **Verificar acesso**, que abre o editor sem enviar comentário, curtida ou favorito.
3. Conferir no histórico a identidade, sua origem e a indicação de vídeo próprio. Metrópoles/G1 não devem ser próprios quando a sessão/cadastro for de outra conta.
4. Se o editor não abrir, guardar o motivo exibido. A validação dos seletores reais permanece necessária antes de considerar o problema resolvido em produção.

Fila e sorteio sobrevivem à recuperação e a Pausar/Continuar enquanto a campanha permanece aberta. Parar ou fechar o aplicativo encerra a fila em memória; os registros de envio persistem. O fallback depende de cadastro correto e não resolve aliases numéricos sem evidência.

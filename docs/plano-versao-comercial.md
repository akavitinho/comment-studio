# Plano da versão comercial — Comment Studio

Data: 28/10/2026. Status: planejamento; implementação ainda não iniciada.

## Decisão recomendada

Aproveitar a interface, os cadastros, as sessões e os testes existentes. Separar e migrar gradualmente um núcleo relevante de execução para Rust, com licenças controladas pelo Supabase. O objetivo é aumentar o esforço de adulteração e controlar assinaturas, sem prometer impedir todo crack.

Definir agora o escopo de Instagram e X, preparar a arquitetura para essas plataformas e implementar suas novas funções depois da prova do motor com licença. Começar por uma plataforma e uma função. A ordem entre Instagram e X depende da função desejada e da viabilidade da integração; essa escolha permanece pendente.

Esclarecimento do usuário: a expansão desejada é de automações para Instagram e X. As ações, os alvos e a equivalência com as campanhas atuais do TikTok ainda precisam ser confirmados. Publicação agendada e gestão de comentários recebidos são possibilidades, não requisitos escolhidos.

## Ponto de partida verificado

- Aplicativo Windows em Electron, versão 0.2.5.
- A suíte local executada nesta conversa passou em 76 testes, sem falhas ou testes ignorados. Isso não comprova funcionamento atual contra os serviços reais nem segurança da futura versão.
- O motor em `src/automation.cjs` mistura estados de execução, filas e operações do navegador. Essa separação é o principal trabalho da migração.
- Instagram e X já possuem cadastro, sessão e navegação; as campanhas atuais são específicas do TikTok.
- Os dados ficam em `.local`, junto ao aplicativo. A distribuição instalada exige um caminho estável de dados e uma migração testada.
- Licenciamento, distribuição comercial e atualização automática ainda precisam ser construídos.

## Arquitetura proposta

| Componente | Responsabilidade |
| --- | --- |
| Interface Electron | Configurações, contas, comandos do usuário, progresso e histórico |
| Núcleo Rust | Estado das tarefas, fila, limites compartilhados, pausas, recuperação e validação de autorizações |
| Adaptador por plataforma | Autenticação e operações específicas da plataforma, retornando resultados ao núcleo |
| Supabase Auth e Postgres | Identidade do cliente, assinatura, ativações, direitos de uso e auditoria |
| Supabase Edge Functions | Ativar dispositivos, renovar autorizações, processar eventos de pagamento verificados e liberar downloads |
| Distribuição | Pacotes oficiais, manifesto de versões, verificação de autenticidade e atualização |

O núcleo deve executar trabalho indispensável, além de verificar a licença. A lógica de controle equivalente em JavaScript pode servir de referência durante o desenvolvimento, mas não será incluída como alternativa sem proteção na distribuição comercial.

Cada integração declara suas capacidades. Uma operação ausente em uma plataforma deve ser indicada como indisponível, sem presumir que as três redes oferecem as mesmas funções. A comunicação deve transportar comandos e resultados estruturados, sem um mecanismo genérico de executar código recebido do servidor.

Scripts executados no navegador e componentes públicos como FFmpeg e yt-dlp não serão tratados como segredos exclusivos do produto. Módulos compilados também podem ser analisados e modificados; o benefício precisa ser avaliado na versão distribuída.

## Etapa 0 — Definir a primeira entrega e preservar a referência

Trabalho:

- Preservar uma referência recuperável do código atual e manter dados reais fora dos pacotes e repositórios.
- Registrar os fluxos que devem continuar funcionando e usar dados fictícios nos testes.
- Identificar uma primeira função desejada para Instagram e uma para X; verificar autenticação, permissões, limites, custos e suporte da API antes de prometer essas funções.
- Para as automações solicitadas, definir por plataforma: gatilho de início, contas participantes, alvos, ações, condições de parada e confirmação de resultados. Confirmar se o usuário pretende reproduzir o fluxo de campanhas atual do TikTok ou outro fluxo.
- Adotar como hipótese inicial uma licença por cliente, com limite configurável de dispositivos e transferência recuperável. A política comercial definitiva ainda será escolhida.

Critério para avançar: primeira entrega delimitada, referência preservada e comportamentos essenciais documentados. A ausência de definição das novas funções não impede o trabalho na base atual.

## Etapa 1 — Separar o motor da integração existente

Trabalho:

- Extrair o controle de estado e da fila para uma interface interna clara, inicialmente mantendo o comportamento atual.
- Isolar as operações específicas do TikTok em um adaptador.
- Definir eventos como tarefa iniciada, resultado confirmado, resultado incerto, pausa e necessidade de atenção.
- Preservar o registro de tentativas para que uma falha ou retomada não repita automaticamente uma ação de resultado incerto.
- Preparar identificação de plataforma e capacidades, sem implementar funções novas nesta etapa.

Critério para avançar: regressões locais aprovadas e os cenários de múltiplas contas, pausa, retomada, interrupção e recuperação preservados. Esta etapa cria a fronteira que será migrada para Rust.

## Etapa 2 — Provar o núcleo compilado

Trabalho:

- Preparar compilação e carregamento de um módulo Rust no Electron para o Windows inicialmente suportado.
- Migrar uma fatia relevante do controle de tarefas, suficiente para demonstrar fila, pausa, retomada e conclusão.
- Exigir uma autorização assinada de teste dentro do núcleo e verificar sua validade nas operações relevantes. As chaves de teste não podem servir à produção.
- Comparar os resultados do núcleo novo com cenários determinísticos da implementação de referência.
- Manter a integração com o navegador fora da migração inicial.

Critério para avançar: o núcleo realiza trabalho real, recusa autorizações inválidas e preserva os resultados dos cenários selecionados. Medir esforço, dificuldades de integração e estabilidade antes de ampliar a migração e estimar o restante.

## Etapa 3 — Integrar as licenças reais no Supabase

Trabalho:

- Criar ambiente de desenvolvimento separado da produção, com migrações versionadas.
- Modelar clientes, licenças, ativações, permissões de uso e registros de eventos. Chaves de ativação devem ser aleatórias, guardadas como hash e protegidas contra tentativas excessivas.
- Implementar ativação e transferência de dispositivos com operações atômicas, evitando ultrapassar limites com pedidos simultâneos.
- Emitir autorizações assinadas com cliente, dispositivo, permissões, prazo e versão do formato. Manter a chave privada somente no servidor e prever rotação.
- Renovar a autorização periodicamente. Expiração deve impedir novas tarefas em um ponto seguro, preservando o resultado das ações já em confirmação.
- Definir tolerância a indisponibilidade. Uma revogação só será efetiva localmente após a próxima verificação ou o vencimento da autorização vigente.
- Restringir permissões do banco: o cliente não pode alterar assinatura, vencimento ou limite de dispositivos. Credenciais administrativas nunca são distribuídas no app.
- Permitir emissão e revogação administrativas para o piloto. Integrar cobrança depois da escolha do provedor, verificando autenticidade, duplicação e ordem dos eventos de pagamento.

Critério para avançar: ativação legítima funciona; outro cliente não lê nem altera a licença; excesso de dispositivos é recusado; expiração, revogação, reinstalação e falha de rede têm comportamentos conhecidos. Nenhuma credencial de produção aparece no pacote ou nos logs.

## Etapa 4 — Completar a migração e preparar a distribuição

Trabalho:

- Ampliar a parte migrada somente após a prova anterior, mantendo os testes de comportamento.
- Mover dados para um diretório estável do usuário e testar migração, backup e recuperação das sessões e configurações existentes.
- Gerar instalador e módulos nativos para as arquiteturas de Windows declaradas como suportadas.
- Habilitar integridade ASAR e carregamento apenas do pacote verificado. Avaliar os demais fuses sem remover recursos usados legitimamente pelo aplicativo.
- Assinar os binários e validar a autenticidade das atualizações antes de instalá-las. Links temporários de download não substituem a assinatura dos arquivos.
- Manter versões de teste e estáveis separadas. Instalar atualizações em momento seguro, sem interromper uma ação em confirmação.
- Preparar recuperação de atualização defeituosa compatível com o formato dos dados. Uma versão antiga não deve ser aplicada cegamente sobre dados incompatíveis.

Critério para avançar: instalação em computador limpo, atualização preservando dados, recuperação testada e nenhuma cópia alternativa do motor sem licença presente no pacote comercial.

## Etapa 5 — Piloto e avaliação da proteção

Trabalho:

- Usar um pequeno grupo de computadores e clientes de teste, com combinações distintas de instalação e conexão.
- Testar assinatura ativa e vencida, queda do serviço, suspensão do computador, troca de dispositivo e tentativas de ativação simultâneas.
- Testar adulteração de arquivos, substituição do módulo, remoção da tela de ativação, reutilização de autorização vencida e mudanças no relógio local.
- Verificar bloqueios indevidos, travamentos, recuperação e registros suficientes para diagnosticar falhas sem capturar segredos.
- Executar os testes de interface e de integração necessários e uma validação real controlada dos fluxos que serão vendidos.

Critério para lançamento: nenhum defeito crítico conhecido nos fluxos selecionados, recuperação demonstrada e limitações documentadas. Passar nesses testes não comprova invulnerabilidade; uma revisão independente poderá avaliar riscos que os testes internos não cobrem.

## Etapa 6 — Adicionar Instagram e X

As novas funções entram depois de validada a combinação núcleo + licença. A implementação pode começar no ambiente de desenvolvimento enquanto o piloto estabiliza, desde que permaneça isolada da versão entregue aos clientes.

Para cada plataforma:

1. Escolher um primeiro fluxo de automação, com ações e alvos confirmados pelo usuário. Reutilizar os controles gerais de campanha quando fizer sentido, preservando as regras e capacidades de cada plataforma.
2. Validar se existe uma integração oficial adequada e quais acessos e custos ela exige.
3. Implementar seu adaptador e reutilizar fila, licença, histórico e atualização.
4. Testar conta desconectada, permissão insuficiente, limite de chamadas e resultado incerto.
5. Liberar primeiro em versão de teste e só depois incorporar à versão estável.

Se a função for agendamento, decidir explicitamente se o computador precisa permanecer ligado. Execução com o computador desligado exige um executor no servidor e muda a arquitetura e os custos; não pode depender de uma Edge Function esperando continuamente.

O fato de haver uma sessão aberta no navegador não comprova disponibilidade de uma operação via API. Os detalhes de Instagram ainda precisam ser verificados quando a função for definida; as páginas oficiais tentadas nesta pesquisa não ficaram acessíveis. A API de criação de posts do X foi consultada, mas permissões e custos do caso escolhido ainda serão avaliados.

## Dependências e decisões externas

- Projeto Supabase e configuração segura do ambiente de implantação; não enviar chaves administrativas pelo chat.
- Canal de envio de e-mails de autenticação e recuperação.
- Provedor de cobrança e regras de renovação, cancelamento e reembolso.
- Assinatura de código e local de distribuição das versões.
- Funções prioritárias de Instagram e X, contas de teste e acessos necessários.

O código local, os testes e as migrações podem ser preparados antes dessas configurações. A implantação e o teste integrado dependem dos respectivos serviços estarem disponíveis.

## Primeiro marco e estimativa

Primeiro marco: uma tarefa de teste executada pelo núcleo Rust dentro do Electron, com pausa/retomada e licença emitida pelo Supabase, recusando uma autorização inválida. Usar operações simuladas para validar a arquitetura sem publicar nas plataformas.

Reestimar o trabalho ao atingir esse marco. A meta discutida de obter uma primeira versão de teste em poucos dias é provisória; não equivale ao prazo da versão comercial validada. Medir os obstáculos reais antes de fixar uma data de lançamento.

## Referências técnicas

- [Supabase Auth](https://supabase.com/docs/guides/auth)
- [Permissões e RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Chaves de API do Supabase](https://supabase.com/docs/guides/getting-started/api-keys)
- [Downloads privados](https://supabase.com/docs/guides/storage/serving/downloads)
- [Limites de Edge Functions](https://supabase.com/docs/guides/functions/limits)
- [Preparação de produção no Supabase](https://supabase.com/docs/guides/deployment/going-into-prod)
- [Integridade ASAR no Electron](https://www.electronjs.org/docs/latest/tutorial/asar-integrity)
- [Electron Fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)
- [Módulos Rust com NAPI-RS](https://github.com/napi-rs/napi-rs)
- [Criação de posts na API do X](https://docs.x.com/x-api/posts/create-post)

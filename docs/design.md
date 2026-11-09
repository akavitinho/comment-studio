# Direção visual

Aplicativo Windows para configurar campanhas e acompanhar contas. Nome provisório: Comment Studio.

Referência de processo: skill frontend-design, lida diretamente no repositório oficial: https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md. Não instalada globalmente.

## Plano antes da implementação

Paleta: grafite #202936 na navegação; papel frio #F5F7FA no fundo; branco #FFFFFF nas áreas de edição; tinta #243247 no texto; azul #315FA8 nas ações; cinza #657185 no texto auxiliar. Verde discreto fica reservado a estados realmente confirmados.

Tipografia: Segoe UI Variable/Segoe UI, presente no Windows; títulos com peso 600, corpo de 14px, rótulos de 13px e números tabulares. Títulos e campos alinhados à esquerda.

Composição: navegação lateral estável, formulário principal com seções separadas por espaço e divisores, resumo lateral da campanha. Contas usam linhas, proxies usam registros compactos. Em 1050px, resumo abaixo; em 760px, navegação horizontal; em 560px, campos em uma coluna. O CSS também suporta uma prévia de 390px.

```
Navegação | Campanha                         Configuração local
          | Onde encontrar os vídeos        Resumo
          | Comentários                     Contas selecionadas
          | Contas                          Alvo
          | Intervalos e permanência        Frases
          | Interações                      Estado real
          | Salvar configuração
```

## Revisão do plano

Uma grade de métricas e cartões seria redundante nesta primeira entrega: não existe execução para medir. O foco fica no formulário e no resumo dos dados inseridos. Retirados gradientes, brilho, indicadores de operação fictícios e slogans. O detalhe visual fica na navegação e no alinhamento das informações, com foco de teclado visível e mensagens úteis nos estados vazios.

## Verificação

Capturar as telas real e compacta do Electron; conferir rolagem, corte de campos, foco, contraste e mensagens. Diferenciar cadastro, janela aberta e autenticação verificada. Esta versão não confirma login e não envia comentários.

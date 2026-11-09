# Página de confirmação de idade

Site estático pronto para publicar na Vercel, sem instalação de dependências.

## Configurar o destino

Edite `script.js` e coloque a URL completa da campanha em `DESTINO_MAIOR_DE_IDADE`. Sem ela, o botão “Sim” abre a página provisória `continuar.html`.

## Publicar na Vercel

Importe o repositório na Vercel e escolha `pressel-18` como **Root Directory**. Use **Other** como framework, sem comando de build. A pasta de saída fica vazia ou com o valor padrão. Também é possível executar `vercel` dentro desta pasta com a CLI autenticada.

O botão “Não” leva a uma página local de acesso restrito. Esta é uma confirmação declarada pelo visitante, não uma verificação de identidade ou idade.

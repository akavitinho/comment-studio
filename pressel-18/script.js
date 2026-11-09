// Substitua pela URL de destino da sua campanha quando ela estiver definida.
const DESTINO_MAIOR_DE_IDADE = "";

const yesLink = document.getElementById("yes-link");
if (yesLink && DESTINO_MAIOR_DE_IDADE) {
  yesLink.href = DESTINO_MAIOR_DE_IDADE;
}

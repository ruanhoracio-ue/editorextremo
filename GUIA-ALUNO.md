# 🎬 Editu — Guia de Instalação (para alunos)

Bem-vindo(a)! Este guia mostra, **passo a passo**, como abrir o Editu no seu
computador. Você só precisa fazer a instalação **uma vez**. Depois, é só um
duplo clique para começar a editar.

> ⏱️ **Tempo estimado:** ~15 minutos na primeira vez (a maior parte é só esperar).

---

## ✅ O que você vai precisar

- Um computador **Windows** ou **Mac**
- Conexão com a internet (só na primeira vez)
- Cerca de **5 GB livres** no disco

---

## Passo 1 — Instalar o Docker Desktop (só uma vez)

O Docker é o "motor" que faz o Editu funcionar. É um programa gratuito.

1. Acesse: **https://www.docker.com/products/docker-desktop/**
2. Clique em **Download** e escolha a versão do seu sistema:
   - **Windows** → "Download for Windows"
   - **Mac** → escolha **Apple Chip** (Mac mais novos, M1/M2/M3) ou **Intel Chip** (Mac mais antigos).
     *Se não souber qual: menu 🍎 → "Sobre este Mac" → veja se aparece "Apple" ou "Intel".*
3. Abra o arquivo baixado e siga a instalação normalmente (Avançar → Avançar → Concluir).
4. **Abra o Docker Desktop** depois de instalar. Se pedir para reiniciar o
   computador ou aceitar os termos, aceite.
5. Espere até o ícone da baleia 🐳 (no canto da tela) ficar **parado/verde**.
   Isso significa que o Docker está pronto.

> 💡 No **Windows**, na primeira vez o Docker pode pedir para instalar um
> componente chamado **WSL 2**. Se aparecer uma janela pedindo isso, aceite e
> siga as instruções na tela (pode precisar reiniciar o PC uma vez).

---

## Passo 2 — Baixar a pasta do Editu

Você vai receber a pasta do **Editu** (por link/pen drive/zip).

1. Se veio compactada (`.zip`), **descompacte** em um lugar fácil, como a
   Área de Trabalho.
2. Abra a pasta. Dentro dela você verá os atalhos:
   - **`Editu`** → abre o app
   - **`Parar-Editu`** → desliga o app

---

## Passo 3 — Abrir o Editu 🚀

Com o **Docker Desktop aberto**:

- **Windows:** dê dois cliques em **`Editu.bat`**
- **Mac:** dê dois cliques em **`Editu.command`**

Vai abrir uma janela preta escrevendo umas coisas — **isso é normal**, é só o
app se preparando.

> ⚠️ **A PRIMEIRA vez demora alguns minutos** (ele monta tudo). Nas próximas
> vezes abre em segundos. Pode deixar rodando e ir tomar um café ☕.

Quando terminar, o **navegador abre sozinho** no endereço:

**👉 http://localhost:3000**

Pronto! É só usar o Editu normalmente. 🎉

---

## Passo 4 — Quando terminar de editar

Para desligar o app e liberar o computador:

- **Windows:** dê dois cliques em **`Parar-Editu.bat`**
- **Mac:** dê dois cliques em **`Parar-Editu.command`**

*(Se preferir, também pode simplesmente fechar o Docker Desktop.)*

---

## ❓ Deu algum problema?

| O que aconteceu | O que fazer |
|---|---|
| A página abriu com erro logo de cara | Aguarde **~30 segundos** e **atualize** a página (F5). Na primeira vez o app ainda está "aquecendo". |
| O navegador não abriu sozinho | Abra o navegador e digite: **http://localhost:3000** |
| Disse que o **Docker não iniciou** | Abra o **Docker Desktop**, espere a baleia 🐳 ficar verde, e rode o atalho **Editu** de novo. |
| No Mac apareceu "não pode ser aberto por ser de um desenvolvedor não identificado" | Clique com o **botão direito** no `Editu.command` → **Abrir** → **Abrir**. (Só na primeira vez.) |
| A transcrição/edição está **demorando** | É normal em vídeos maiores — o computador está processando com IA. Vídeos curtos são bem mais rápidos. |
| Nada funcionou | Tire um **print da janela preta** com a mensagem de erro e envie para o suporte. |

---

## 📝 Observações

- O Editu roda **100% no seu computador**. Seus vídeos **não vão para a internet**.
- Você só precisa de internet na **primeira** vez (para o Docker baixar o necessário).
- Para um bom desempenho, o ideal é um computador com **8 GB de RAM** ou mais.

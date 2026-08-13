# 🎬 EditorExtremo — Guia de Instalação (para alunos)

Bem-vindo(a)! Este guia mostra, **passo a passo**, como abrir o EditorExtremo no seu
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

O Docker é o "motor" que faz o EditorExtremo funcionar. É um programa gratuito.

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

## Passo 2 — Baixar a pasta do EditorExtremo

Você vai receber a pasta do **EditorExtremo** (por link/pen drive/zip).

1. Se veio compactada (`.zip`), **descompacte** em um lugar fácil, como a
   Área de Trabalho.
2. Abra a pasta. Dentro dela você verá os atalhos:
   - **`EditorExtremo`** → abre o app
   - **`Parar-EditorExtremo`** → desliga o app

---

## Passo 3 — Abrir o EditorExtremo 🚀

Com o **Docker Desktop aberto**:

- **Windows:** dê dois cliques em **`EditorExtremo.bat`**
- **Mac:** dê dois cliques em **`EditorExtremo.command`**

> 🍎 **Mac — só na PRIMEIRA vez:** o macOS pode mostrar um aviso de segurança
> dizendo que *"não foi possível verificar se o item está livre de malware"*.
> **Isso é normal** (o app é gratuito e roda só no seu computador) — **não clique
> em "Mover para o Lixo".** Faça assim:
>
> **Jeito 1 (mais fácil):** clique no `EditorExtremo.command` com o **botão direito**
> (ou segure **Control** e clique) → **Abrir** → no aviso, clique **Abrir**.
>
> **Jeito 2 (se aparecer só "Mover para o Lixo / OK"):** clique **OK** → abra
> **Ajustes do Sistema → Privacidade e Segurança** → role até o fim e clique em
> **"Abrir Mesmo Assim"** (ao lado da mensagem sobre o EditorExtremo) → volte e dê dois
> cliques no `EditorExtremo.command` de novo → **Abrir**.
>
> Depois dessa primeira vez, abre normal com 2 cliques. 👍

Vai abrir uma janela preta escrevendo umas coisas — **isso é normal**, é só o
app se preparando.

> ⚠️ **A PRIMEIRA vez demora alguns minutos** (ele monta tudo). Nas próximas
> vezes abre em segundos. Pode deixar rodando e ir tomar um café ☕.

Quando terminar, o **navegador abre sozinho** no endereço:

**👉 http://localhost:3000**

Pronto! É só usar o EditorExtremo normalmente. 🎉

---

## Passo 4 — Quando terminar de editar

Para desligar o app e liberar o computador:

- **Windows:** dê dois cliques em **`Parar-EditorExtremo.bat`**
- **Mac:** dê dois cliques em **`Parar-EditorExtremo.command`**

*(Se preferir, também pode simplesmente fechar o Docker Desktop.)*

---

## ❓ Deu algum problema?

| O que aconteceu | O que fazer |
|---|---|
| A página abriu com erro logo de cara | Aguarde **~30 segundos** e **atualize** a página (F5). Na primeira vez o app ainda está "aquecendo". |
| O navegador não abriu sozinho | Abra o navegador e digite: **http://localhost:3000** |
| Disse que o **Docker não iniciou** | Abra o **Docker Desktop**, espere a baleia 🐳 ficar verde, e rode o atalho **EditorExtremo** de novo. |
| Apareceu **"Não consegui baixar os componentes"**, ou erros com **"deadline exceeded"** / **"failed to solve"** | É a internet. Na primeira vez o EditorExtremo precisa baixar algumas peças. **Espere um pouco e rode o atalho de novo** — o que já baixou fica salvo e ele continua de onde parou. Em rede de empresa ou faculdade o download costuma ser bloqueado: tente pelo **Wi-Fi de casa** ou pela **internet do celular**. |
| No Mac apareceu aviso de segurança ("não foi possível verificar…" ou "desenvolvedor não identificado") | **Não** clique em "Mover para o Lixo". Botão **direito** no `EditorExtremo.command` → **Abrir** → **Abrir**. Se só aparecer "Lixo/OK": **OK** → **Ajustes do Sistema → Privacidade e Segurança** → **"Abrir Mesmo Assim"**. (Só na primeira vez.) |
| A transcrição/edição está **demorando** | É normal em vídeos maiores — o computador está processando com IA. Vídeos curtos são bem mais rápidos. |
| Nada funcionou | Tire um **print da janela preta** com a mensagem de erro e envie para o suporte. |

---

## 📝 Observações

- O EditorExtremo roda **100% no seu computador**. Seus vídeos **não vão para a internet**.
- Você só precisa de internet na **primeira** vez (para o Docker baixar o necessário).
- Para um bom desempenho, o ideal é um computador com **8 GB de RAM** ou mais.

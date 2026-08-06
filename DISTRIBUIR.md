# 📦 Como distribuir o Editu para os alunos (guia do instrutor)

Este documento é para **você** (que vai preparar o pacote). Os alunos usam o
[`GUIA-ALUNO.md`](GUIA-ALUNO.md).

A ideia: você gera **uma pasta ZIP** com o projeto e entrega para os alunos.
Cada aluno instala o Docker Desktop uma vez e usa os atalhos `Editu`.

---

## 1. Baixar a versão mais recente

```bash
git clone https://github.com/ruanhoracio-ue/editorextremo.git
cd editorextremo
git checkout claude/oi-galp9x
```

## 2. (Importante no Mac) Garantir a permissão de execução dos atalhos

Ao enviar código pela API do GitHub, a permissão de "executável" dos atalhos
`.command` do Mac pode se perder. Rode isto **uma vez** (em Mac ou Linux)
antes de zipar, para o duplo clique funcionar no Mac dos alunos:

```bash
chmod +x Editu.command Parar-Editu.command
```

> No Windows os atalhos são `.bat` e não precisam desse passo.

## 3. Gerar o ZIP para os alunos

Envie **apenas os arquivos do projeto** — não inclua `node_modules`, `.next`,
`venv` nem `storage` (são pesados e desnecessários; o Docker monta tudo).

```bash
zip -r Editu-alunos.zip . \
  -x '*/node_modules/*' -x '*/.next/*' -x '*/venv/*' \
  -x '*/storage/*' -x '*/.git/*'
```

Isso gera `Editu-alunos.zip`. É esse arquivo que você manda para a turma
(link, Drive, WeTransfer, pen drive...).

## 4. O que o aluno faz

1. Instala o **Docker Desktop** (uma vez) — link e passos no `GUIA-ALUNO.md`.
2. Descompacta o ZIP.
3. Dá dois cliques em **`Editu`** (`.bat` no Windows, `.command` no Mac).
4. O app abre em `http://localhost:3000`.

---

## Dúvidas comuns (instrutor)

- **Quanto pesa?** O ZIP é pequeno (código). O peso real (~alguns GB) é
  baixado pelo Docker na primeira execução, na máquina do aluno.
- **Precisa de internet?** Só na primeira vez de cada aluno (o Docker baixa as
  imagens e o modelo de IA). Depois roda offline.
- **Requisitos da máquina do aluno?** Ideal 8 GB de RAM. Vídeos curtos rodam
  bem; vídeos longos demoram mais (processamento por IA, sem placa de vídeo).
- **Como atualizo o app depois?** Refaça os passos 1–3 e reenvie o ZIP. No
  computador do aluno, o atalho `Editu` já roda `docker compose up --build`,
  então ele pega a versão nova automaticamente ao abrir.
- **Custo?** Zero de servidor — roda 100% na máquina do aluno.

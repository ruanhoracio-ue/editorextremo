#!/bin/bash
# ==========================================================
#  EDITOREXTREMO — Atalho para abrir o app (Mac)
#  Dê dois cliques neste arquivo para começar a editar.
# ==========================================================
cd "$(dirname "$0")"

echo "🎬  Iniciando o EditorExtremo..."
echo

# 1) Garante que o Docker Desktop está rodando
if ! docker info >/dev/null 2>&1; then
  echo "🐳  Abrindo o Docker Desktop (aguarde alguns segundos)..."
  open -a Docker 2>/dev/null
  for i in $(seq 1 60); do
    docker info >/dev/null 2>&1 && break
    sleep 2
  done
fi

if ! docker info >/dev/null 2>&1; then
  echo
  echo "❌  O Docker Desktop não iniciou."
  echo "    Abra o Docker Desktop manualmente e rode este atalho de novo."
  read -p "Pressione ENTER para fechar."
  exit 1
fi

# 2) Limpa restos de execuções anteriores (evita "container name already in use").
#    NÃO perde nada: os vídeos e o modelo de IA ficam em volumes nomeados do Docker.
#    Os nomes "editu-*" são da versão antiga do app: quem já rodou aquela versão
#    ainda tem esses containers segurando as portas 3000/8000, e sem removê-los
#    aqui o aluno veria "porta em uso" sem entender o motivo.
docker rm -f editorextremo-backend editorextremo-frontend editu-backend editu-frontend >/dev/null 2>&1

# 3) Confere se as portas 3000 e 8000 estão livres — se outro programa estiver
#    usando, mostramos uma mensagem clara em vez do erro técnico do Docker.
for PORT in 3000 8000; do
  if lsof -iTCP:$PORT -sTCP:LISTEN -n -P >/dev/null 2>&1; then
    echo
    echo "❌  A porta $PORT já está sendo usada por outro programa neste computador."
    echo "    O EditorExtremo precisa das portas 3000 e 8000 livres."
    echo
    echo "    ➜  Feche o outro programa que está usando a porta $PORT"
    echo "       (ou simplesmente reinicie o computador) e rode este atalho de novo."
    echo
    read -p "Pressione ENTER para fechar."
    exit 1
  fi
done

# 4) Baixa o app (e as atualizações). As imagens vêm PRONTAS do Docker Hub:
#    esta máquina só baixa, não monta nada — era o montar que travava antes.
#    Se o download falhar mas o app já estiver baixado de uma vez anterior,
#    seguimos com o que existe: sem internet o aluno ainda consegue trabalhar.
echo "⚙️   Buscando o app... (a PRIMEIRA vez demora alguns minutos — nas próximas é rápido)"

BAIXOU=0
for TENTATIVA in 1 2 3; do
  [ "$TENTATIVA" -gt 1 ] && echo "    ⬇️   Tentativa $TENTATIVA de 3..."
  if docker compose pull; then BAIXOU=1; break; fi
  sleep 8
done

if [ "$BAIXOU" -ne 1 ]; then
  JA_TEM=1
  for IMG in $(docker compose config --images 2>/dev/null); do
    docker image inspect "$IMG" >/dev/null 2>&1 || JA_TEM=0
  done
  if [ "$JA_TEM" -eq 1 ]; then
    echo
    echo "⚠️   Não consegui verificar se há versão nova (internet fora do ar?)."
    echo "    Sem problema: abrindo a versão que já está neste computador."
    echo
  else
    echo
    echo "❌  Não consegui baixar o EditorExtremo."
    echo "    Isso quase sempre é a conexão com a internet."
    echo
    echo "    ➜  Confira se a internet está funcionando"
    echo "    ➜  Se estiver em rede de empresa/universidade, tente por outra rede"
    echo "       (o Wi-Fi de casa ou a internet do celular costumam resolver)"
    echo "    ➜  Depois é só rodar este atalho de novo — o que já baixou não baixa outra vez"
    echo
    read -p "Pressione ENTER para fechar."
    exit 1
  fi
fi

# 5) Sobe o app. Uma segunda tentativa cobre falhas passageiras.
echo "🔧  Iniciando..."
if ! docker compose up -d --remove-orphans; then
  echo
  echo "⚠️   Primeira tentativa falhou. Tentando de novo em 10 segundos..."
  sleep 10
  if ! docker compose up -d --remove-orphans; then
    echo
    echo "❌  Não consegui iniciar o EditorExtremo."
    echo "    Tire um print desta tela e envie para o suporte."
    echo
    read -p "Pressione ENTER para fechar."
    exit 1
  fi
fi

# 6) Abre no navegador
echo "✅  Tudo pronto! Abrindo o EditorExtremo no navegador..."
sleep 3
open http://localhost:3000

echo
echo "👉  Se o navegador não abrir sozinho, acesse:  http://localhost:3000"
echo "    (Se a página aparecer com erro logo de cara, aguarde ~30s e atualize.)"
sleep 3

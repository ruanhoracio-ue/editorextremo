#!/bin/bash
# ==========================================================
#  EDITU — Atalho para abrir o app (Mac)
#  Dê dois cliques neste arquivo para começar a editar.
# ==========================================================
cd "$(dirname "$0")"

echo "🎬  Iniciando o Editu..."
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
docker rm -f editu-backend editu-frontend >/dev/null 2>&1

# 3) Confere se as portas 3000 e 8000 estão livres — se outro programa estiver
#    usando, mostramos uma mensagem clara em vez do erro técnico do Docker.
for PORT in 3000 8000; do
  if lsof -iTCP:$PORT -sTCP:LISTEN -n -P >/dev/null 2>&1; then
    echo
    echo "❌  A porta $PORT já está sendo usada por outro programa neste computador."
    echo "    O Editu precisa das portas 3000 e 8000 livres."
    echo
    echo "    ➜  Feche o outro programa que está usando a porta $PORT"
    echo "       (ou simplesmente reinicie o computador) e rode este atalho de novo."
    echo
    read -p "Pressione ENTER para fechar."
    exit 1
  fi
done

# 4) Baixa as peças-base ANTES de montar o app.
#    O Docker responde que está pronto (docker info) antes da rede dele estar de
#    fato funcionando, e o build tem um limite curto de tempo: se a internet
#    estiver lenta nesse momento, ele morre com "context deadline exceeded".
#    Baixando aqui, com tentativas, o build só começa quando as peças já existem.
echo "⚙️   Preparando o app... (a PRIMEIRA vez demora alguns minutos — nas próximas é rápido)"

for IMG in python:3.11-slim node:20-slim; do
  docker image inspect "$IMG" >/dev/null 2>&1 && continue
  BAIXOU=0
  for TENTATIVA in 1 2 3; do
    echo "    ⬇️   Baixando componentes ($IMG) — tentativa $TENTATIVA de 3..."
    if docker pull "$IMG" >/dev/null 2>&1; then BAIXOU=1; break; fi
    sleep 8
  done
  if [ "$BAIXOU" -ne 1 ]; then
    echo
    echo "❌  Não consegui baixar os componentes que o Editu precisa."
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
done

# 5) Monta e sobe o app. Uma segunda tentativa cobre falhas passageiras de rede.
echo "🔧  Montando o app..."
if ! docker compose up -d --build --remove-orphans; then
  echo
  echo "⚠️   Primeira tentativa falhou. Tentando de novo em 10 segundos..."
  sleep 10
  if ! docker compose up -d --build --remove-orphans; then
    echo
    echo "❌  Não consegui iniciar o Editu."
    echo "    Se apareceu 'deadline exceeded' ou 'failed to solve' acima, foi a internet:"
    echo "    espere um pouco e rode este atalho de novo (o que já baixou fica salvo)."
    echo
    echo "    Se o erro for outro, tire um print desta tela e envie para o suporte."
    echo
    read -p "Pressione ENTER para fechar."
    exit 1
  fi
fi

# 6) Abre no navegador
echo "✅  Tudo pronto! Abrindo o Editu no navegador..."
sleep 3
open http://localhost:3000

echo
echo "👉  Se o navegador não abrir sozinho, acesse:  http://localhost:3000"
echo "    (Se a página aparecer com erro logo de cara, aguarde ~30s e atualize.)"
sleep 3

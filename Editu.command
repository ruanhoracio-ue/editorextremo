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

# 2) Sobe o app (na PRIMEIRA vez baixa/monta tudo e pode levar alguns minutos)
echo "⚙️   Preparando o app... (a PRIMEIRA vez demora alguns minutos — nas próximas é rápido)"
docker compose up -d --build || {
  echo "❌  Algo deu errado ao iniciar. Tire um print desta tela e envie para o suporte."
  read -p "Pressione ENTER para fechar."
  exit 1
}

# 3) Abre no navegador
echo "✅  Tudo pronto! Abrindo o Editu no navegador..."
sleep 3
open http://localhost:3000

echo
echo "👉  Se o navegador não abrir sozinho, acesse:  http://localhost:3000"
echo "    (Se a página aparecer com erro logo de cara, aguarde ~30s e atualize.)"
sleep 3

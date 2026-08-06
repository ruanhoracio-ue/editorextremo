#!/bin/bash
# EDITU — Parar o app (Mac). Dê dois cliques para desligar.
cd "$(dirname "$0")"
echo "🛑  Parando o Editu..."
docker compose down
echo "✅  Editu parado. Pode fechar esta janela."
sleep 2

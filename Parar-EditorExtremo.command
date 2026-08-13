#!/bin/bash
# EDITOREXTREMO — Parar o app (Mac). Dê dois cliques para desligar.
cd "$(dirname "$0")"
echo "🛑  Parando o EditorExtremo..."
docker compose down
echo "✅  EditorExtremo parado. Pode fechar esta janela."
sleep 2

#!/bin/bash
# ==========================================================
#  EDITOREXTREMO — Publicar as imagens no Docker Hub
#
#  Use isto DEPOIS de mexer no app, para que os alunos recebam
#  a versão nova sem precisar de um zip novo.
#
#  Uso:  ./publicar-imagens.command SEU_USUARIO_DOCKERHUB
#        (na primeira vez rode antes:  docker login)
#
#  ESTE ARQUIVO NÃO VAI NO PACOTE DOS ALUNOS.
# ==========================================================
set -e
cd "$(dirname "$0")"

USUARIO="$1"
if [ -z "$USUARIO" ]; then
  # Se já publicamos antes, reaproveita o usuário que está no compose
  USUARIO=$(grep -o 'image: [^/]*/editorextremo-backend' docker-compose.yml 2>/dev/null | head -1 | sed 's|image: ||; s|/editorextremo-backend||')
fi
if [ -z "$USUARIO" ] || [ "$USUARIO" = "SEU_USUARIO_DOCKERHUB" ]; then
  echo "❌  Faltou o seu usuário do Docker Hub."
  echo "    Uso:  ./publicar-imagens.command SEU_USUARIO"
  exit 1
fi

echo "🚀  Publicando o EditorExtremo como '$USUARIO'"
echo

if ! docker info >/dev/null 2>&1; then
  echo "🐳  Abrindo o Docker Desktop..."
  open -a Docker 2>/dev/null || true
  for i in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 2; done
fi
docker info >/dev/null 2>&1 || { echo "❌  Docker Desktop não iniciou."; exit 1; }

if ! docker system info 2>/dev/null | grep -q "Username:"; then
  echo "❌  Você não está logado no Docker Hub."
  echo "    Rode primeiro:   docker login"
  exit 1
fi

# Builder multi-plataforma: sem isso as imagens saem só para o processador deste
# Mac (ARM) e não abrem nos PCs Windows/Intel dos alunos.
if ! docker buildx inspect editorextremo-builder >/dev/null 2>&1; then
  echo "🔧  Preparando o construtor multi-plataforma (só na primeira vez)..."
  docker buildx create --name editorextremo-builder --use >/dev/null
else
  docker buildx use editorextremo-builder
fi
docker buildx inspect --bootstrap >/dev/null

PLATAFORMAS="linux/amd64,linux/arm64"

for SERVICO in backend frontend; do
  echo
  echo "📦  Montando e enviando o $SERVICO (Windows/Intel + Mac Apple Silicon)..."
  echo "    Isso demora na primeira vez. Nas próximas, só o que mudou é reenviado."
  docker buildx build \
    --platform "$PLATAFORMAS" \
    --tag "$USUARIO/editorextremo-$SERVICO:latest" \
    --push \
    "./$SERVICO"
done

# Aponta o compose dos alunos para as imagens publicadas
if grep -q "SEU_USUARIO_DOCKERHUB" docker-compose.yml; then
  sed -i '' "s|SEU_USUARIO_DOCKERHUB|$USUARIO|g" docker-compose.yml
  echo
  echo "✏️   docker-compose.yml atualizado com o seu usuário."
fi

echo
echo "✅  Pronto! Publicado como:"
echo "      $USUARIO/editorextremo-backend:latest"
echo "      $USUARIO/editorextremo-frontend:latest"
echo
echo "👉  Os alunos recebem esta versão na próxima vez que abrirem o atalho."
echo "    Só é preciso mandar zip novo se você mexer nos atalhos, no"
echo "    docker-compose.yml ou nos guias — o app em si atualiza sozinho."

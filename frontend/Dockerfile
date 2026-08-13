# EditorExtremo — Frontend (Next.js)
FROM node:20-slim

WORKDIR /app

# Instala dependências primeiro (cache de build)
COPY package.json package-lock.json ./
RUN npm ci

# Código da aplicação
COPY . .

# O navegador do aluno acessa o backend em localhost:8000 (porta publicada pelo Docker).
# Esse valor é embutido no build do Next.js.
ENV NEXT_PUBLIC_API_URL=http://localhost:8000

RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start"]

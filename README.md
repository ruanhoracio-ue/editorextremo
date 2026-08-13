# EditorExtremo — App de Edição Automática de Vídeo

Web app que automatiza a edição de vídeos curtos (Reels/Shorts/depoimentos).

## 🎬 Para alunos / uso simples (Docker)

Se você só quer **usar** o app (sem instalar Node, Python e FFmpeg na mão),
use a versão empacotada em Docker — funciona em **Windows e Mac** com duplo
clique. Passo a passo completo para leigos em **[`GUIA-ALUNO.md`](GUIA-ALUNO.md)**.

Resumo: instale o **Docker Desktop** (uma vez) e depois abra o atalho
`EditorExtremo.command` (Mac) ou `EditorExtremo.bat` (Windows). O app abre em
`http://localhost:3000`. Para desligar, use `Parar-EditorExtremo`.

**Vai distribuir para uma turma?** Veja **[`DISTRIBUIR.md`](DISTRIBUIR.md)**
(como gerar o ZIP e entregar aos alunos).

O restante desta página é o setup **manual/desenvolvimento**.

## Requisitos do Sistema

- **Node.js** 18+ (instalado: v24)
- **Python** 3.9+ (instalado: 3.9.6)
- **FFmpeg** — `brew install ffmpeg`

## Setup Rápido

### 1. Instalar FFmpeg (se não tiver)
```bash
brew install ffmpeg
```

### 2. Backend (FastAPI)
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 3. Frontend (Next.js)
```bash
cd frontend
npm install
npm run dev
```

O frontend roda em `http://localhost:3000` e o backend em `http://localhost:8000`.

## Como Funciona

### Etapa 1 — Limpeza Automática
1. Upload do vídeo cru
2. Transcrição automática do áudio (faster-whisper)
3. Detecção e remoção de silêncios, pausas, hesitações
4. Color grade profissional automático
5. Vídeo "limpo" gerado

### Etapa 2 — Estilo (Opcional)
- Layout: tela cheia ou split screen
- Legendas: nenhuma, básica ou animada
- Zoom in/out automático
- Trilha sonora por IA (futuro)
- Renderização final via Remotion

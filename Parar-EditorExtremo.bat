@echo off
REM EDITOREXTREMO - Parar o app (Windows). De dois cliques para desligar.
cd /d "%~dp0"
echo  Parando o EditorExtremo...
docker compose down
echo  EditorExtremo parado. Pode fechar esta janela.
timeout /t 3 >nul

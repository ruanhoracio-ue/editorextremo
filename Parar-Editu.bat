@echo off
REM EDITU - Parar o app (Windows). De dois cliques para desligar.
cd /d "%~dp0"
echo  Parando o Editu...
docker compose down
echo  Editu parado. Pode fechar esta janela.
timeout /t 3 >nul

@echo off
REM ==========================================================
REM  EDITU - Atalho para abrir o app (Windows)
REM  De dois cliques neste arquivo para comecar a editar.
REM ==========================================================
cd /d "%~dp0"
chcp 65001 >nul

echo.
echo  Iniciando o Editu...
echo.

REM 1) Garante que o Docker Desktop esta rodando
docker info >nul 2>&1
if not errorlevel 1 goto ready

echo  Abrindo o Docker Desktop (aguarde alguns segundos)...
start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" 2>nul

set /a tentativas=0
:waitloop
timeout /t 3 >nul
docker info >nul 2>&1
if not errorlevel 1 goto ready
set /a tentativas+=1
if %tentativas% lss 30 goto waitloop

echo.
echo  [ERRO] O Docker Desktop nao iniciou.
echo         Abra o Docker Desktop manualmente e rode este atalho de novo.
pause
exit /b 1

:ready
REM 2) Sobe o app (na PRIMEIRA vez baixa/monta tudo e pode levar alguns minutos)
echo  Preparando o app... (a PRIMEIRA vez demora alguns minutos - nas proximas e rapido)
docker compose up -d --build
if errorlevel 1 (
  echo.
  echo  [ERRO] Algo deu errado ao iniciar. Tire um print desta tela e envie para o suporte.
  pause
  exit /b 1
)

REM 3) Abre no navegador
echo  Tudo pronto! Abrindo o Editu no navegador...
timeout /t 3 >nul
start "" http://localhost:3000

echo.
echo  Se o navegador nao abrir sozinho, acesse:  http://localhost:3000
echo  (Se a pagina aparecer com erro logo de cara, aguarde ~30s e atualize.)
timeout /t 4 >nul

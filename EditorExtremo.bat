@echo off
REM ==========================================================
REM  EDITOREXTREMO - Atalho para abrir o app (Windows)
REM  De dois cliques neste arquivo para comecar a editar.
REM ==========================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"
chcp 65001 >nul

echo.
echo  Iniciando o EditorExtremo...
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
REM 2) Limpa restos de execucoes anteriores (evita "container name already in use").
REM    NAO perde nada: videos e modelo de IA ficam em volumes nomeados do Docker.
REM    Os nomes "editu-*" sao da versao antiga do app: quem ja rodou aquela versao
REM    ainda tem esses containers segurando as portas 3000/8000.
docker rm -f editorextremo-backend editorextremo-frontend editu-backend editu-frontend >nul 2>&1

REM 3) Confere se as portas 3000 e 8000 estao livres (mensagem clara em vez do erro do Docker)
set "PORTA="
netstat -ano | findstr LISTENING | findstr /C:":3000 " >nul 2>&1 && set "PORTA=3000"
netstat -ano | findstr LISTENING | findstr /C:":8000 " >nul 2>&1 && set "PORTA=8000"
if defined PORTA (
  echo.
  echo  [ERRO] A porta %PORTA% ja esta sendo usada por outro programa neste computador.
  echo         O EditorExtremo precisa das portas 3000 e 8000 livres.
  echo.
  echo         ^> Feche o outro programa que usa a porta %PORTA%
  echo           ^(ou reinicie o computador^) e rode este atalho de novo.
  echo.
  pause
  exit /b 1
)

REM 4) Baixa as pecas-base ANTES de montar o app.
REM    O Docker responde que esta pronto antes da rede dele estar funcionando, e o
REM    build tem um limite curto de tempo: com internet lenta ele morre com
REM    "context deadline exceeded". Baixando aqui, com tentativas, o build so
REM    comeca quando as pecas ja existem.
echo  Preparando o app... (a PRIMEIRA vez demora alguns minutos - nas proximas e rapido)

for %%I in (python:3.11-slim node:20-slim) do (
  docker image inspect %%I >nul 2>&1
  if errorlevel 1 (
    set BAIXOU=0
    for %%T in (1 2 3) do (
      if "!BAIXOU!"=="0" (
        echo     Baixando componentes ^(%%I^) - tentativa %%T de 3...
        docker pull %%I >nul 2>&1
        if not errorlevel 1 set BAIXOU=1
        if "!BAIXOU!"=="0" timeout /t 8 >nul
      )
    )
    if "!BAIXOU!"=="0" (
      echo.
      echo  [ERRO] Nao consegui baixar os componentes que o EditorExtremo precisa.
      echo         Isso quase sempre e a conexao com a internet.
      echo.
      echo         ^> Confira se a internet esta funcionando
      echo         ^> Se estiver em rede de empresa/faculdade, tente outra rede
      echo           ^(o Wi-Fi de casa ou a internet do celular costumam resolver^)
      echo         ^> Depois rode este atalho de novo - o que ja baixou nao baixa outra vez
      echo.
      pause
      exit /b 1
    )
  )
)

REM 5) Monta e sobe o app. Uma segunda tentativa cobre falhas passageiras de rede.
echo  Montando o app...
docker compose up -d --build --remove-orphans
if errorlevel 1 (
  echo.
  echo  Primeira tentativa falhou. Tentando de novo em 10 segundos...
  timeout /t 10 >nul
  docker compose up -d --build --remove-orphans
  if errorlevel 1 (
    echo.
    echo  [ERRO] Nao consegui iniciar o EditorExtremo.
    echo         Se apareceu "deadline exceeded" ou "failed to solve" acima, foi a
    echo         internet: espere um pouco e rode este atalho de novo
    echo         ^(o que ja baixou fica salvo^).
    echo.
    echo         Se o erro for outro, tire um print desta tela e envie para o suporte.
    echo.
    pause
    exit /b 1
  )
)

REM 6) Abre no navegador
echo  Tudo pronto! Abrindo o EditorExtremo no navegador...
timeout /t 3 >nul
start "" http://localhost:3000

echo.
echo  Se o navegador nao abrir sozinho, acesse:  http://localhost:3000
echo  (Se a pagina aparecer com erro logo de cara, aguarde ~30s e atualize.)
timeout /t 4 >nul

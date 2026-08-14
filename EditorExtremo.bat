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

REM 4) Baixa o app (e as atualizacoes). As imagens vem PRONTAS do Docker Hub:
REM    esta maquina so baixa, nao monta nada - era o montar que travava antes.
REM    Se o download falhar mas o app ja estiver baixado, seguimos com o que existe.
echo  Buscando o app... (a PRIMEIRA vez demora alguns minutos - nas proximas e rapido)

set BAIXOU=0
for %%T in (1 2 3) do (
  if "!BAIXOU!"=="0" (
    if not "%%T"=="1" echo     Tentativa %%T de 3...
    docker compose pull
    if not errorlevel 1 set BAIXOU=1
    if "!BAIXOU!"=="0" timeout /t 8 >nul
  )
)

if "!BAIXOU!"=="0" (
  set JA_TEM=1
  for /f "delims=" %%I in ('docker compose config --images 2^>nul') do (
    docker image inspect %%I >nul 2>&1
    if errorlevel 1 set JA_TEM=0
  )
  if "!JA_TEM!"=="1" (
    echo.
    echo  Nao consegui verificar se ha versao nova ^(internet fora do ar?^).
    echo  Sem problema: abrindo a versao que ja esta neste computador.
    echo.
  ) else (
    echo.
    echo  [ERRO] Nao consegui baixar o EditorExtremo.
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

REM 5) Sobe o app. Uma segunda tentativa cobre falhas passageiras.
echo  Iniciando...
docker compose up -d --remove-orphans
if errorlevel 1 (
  echo.
  echo  Primeira tentativa falhou. Tentando de novo em 10 segundos...
  timeout /t 10 >nul
  docker compose up -d --remove-orphans
  if errorlevel 1 (
    echo.
    echo  [ERRO] Nao consegui iniciar o EditorExtremo.
    echo         Tire um print desta tela e envie para o suporte.
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

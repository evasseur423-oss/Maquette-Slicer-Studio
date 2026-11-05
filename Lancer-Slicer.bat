@echo off
title Maquette Slicer Studio
cd /d "%~dp0"

echo ========================================================
echo        MAQUETTE SLICER STUDIO - DEMARRAGE
echo ========================================================
echo Chargement de l'environnement Electron...

call npm start

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Une erreur est survenue lors du lancement de Maquette Slicer Studio.
    echo Tentative avec npx electron .
    call npx electron .
    pause
)

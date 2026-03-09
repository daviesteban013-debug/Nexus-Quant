#!/usr/bin/env bash
# Salir inmediatamente si ocurre un error
set -o errexit

echo "Construyendo el Frontend (React)..."
cd frontend
npm install
npm run build
cd ..

echo "Instalando dependencias del Backend (Python)..."
pip install -r requirements.txt
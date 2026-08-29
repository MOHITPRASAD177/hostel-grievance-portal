#!/usr/bin/env bash
set -e
echo "==================================================="
echo "  HostelGrievance Portal - Launcher (Linux/macOS)"
echo "==================================================="
cd "$(dirname "$0")/../.."
echo "[1/3] Checking dependencies..."
npm install
echo "[2/3] Initializing SQLite database..."
npm run db:init
echo "[3/3] Starting backend server and frontend client..."
npm run dev:all

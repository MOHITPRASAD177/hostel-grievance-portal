#!/usr/bin/env bash
set -e
echo "==================================================="
echo "  HostelGrievance - Verification Runner (Linux/macOS)"
echo "==================================================="
cd "$(dirname "$0")/../.."
echo "[1/2] Running automated Vitest test suite (23 tests)..."
npx vitest run
echo "[2/2] Running TypeScript static analysis check..."
npm run typecheck
echo "Verification complete: 100% Passing."

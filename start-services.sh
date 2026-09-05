#!/bin/bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"

echo "============================================="
echo " Starting Vaani backend..."
echo " Server URL: http://localhost:8080"
echo "============================================="

cd "$BACKEND_DIR"
mvn spring-boot:run

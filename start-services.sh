#!/bin/bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"

# Locate Java binary
JAVA_BIN=""
if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ]; then
    JAVA_BIN="$JAVA_HOME/bin/java"
elif [ -x "/Applications/PyCharm.app/Contents/jbr/Contents/Home/bin/java" ]; then
    JAVA_BIN="/Applications/PyCharm.app/Contents/jbr/Contents/Home/bin/java"
elif command -v java >/dev/null 2>&1; then
    JAVA_BIN="$(command -v java)"
else
    echo "Error: No Java runtime found. Please install Java 21+ or set JAVA_HOME."
    exit 1
fi

echo "============================================="
echo " Starting Vaani AI Platform..."
echo " Java: $JAVA_BIN"
echo " Server URL: http://localhost:8080"
echo " Login Page: http://localhost:8080/login"
echo "============================================="

cd "$REPO_ROOT"
exec "$JAVA_BIN" -cp "$BACKEND_DIR/target/classes:$BACKEND_DIR/target/extracted_libs/*" com.vaani.VaaniApplication

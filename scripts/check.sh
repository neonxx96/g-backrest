#!/usr/bin/env bash
# ==============================================================================
# SignalScript Quality Gate Check (scripts/check.sh)
# Linux & Docker Container equivalent of scripts/check.ps1
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

SKIP_BUILD=0
BACKEND_ONLY=0

for arg in "$@"; do
    case "$arg" in
        --skip-build) SKIP_BUILD=1 ;;
        --backend-only) BACKEND_ONLY=1 ;;
        *) ;;
    esac
done

export TEMP="${PROJECT_ROOT}/.pytest-temp"
export TMP="${PROJECT_ROOT}/.pytest-temp"
mkdir -p "${TEMP}"

echo "=========================================================="
echo "🚀 SignalScript Verification Gate (Linux/Container)"
echo "=========================================================="

# 1. Python Unit Tests (pytest backend/tests)
echo -e "\n[1/4] Running Python unit tests (pytest backend/tests)..."
if command -v pytest >/dev/null 2>&1; then
    pytest backend/tests
elif [ -f "${PROJECT_ROOT}/.venv/bin/pytest" ]; then
    "${PROJECT_ROOT}/.venv/bin/pytest" backend/tests
elif command -v python3 >/dev/null 2>&1; then
    python3 -m pytest backend/tests
else
    python -m pytest backend/tests
fi
echo "✅ [PASS] Python unit tests passed."

if [ "$BACKEND_ONLY" -eq 1 ]; then
    echo -e "\n=========================================================="
    echo "🎉 BACKEND QUALITY CHECKS PASSED. READY TO COMMIT."
    echo "=========================================================="
    exit 0
fi

# 2. Frontend layout recovery tests (node --test)
if command -v node >/dev/null 2>&1; then
    echo -e "\n[2/4] Checking frontend layout recovery (node --test)..."
    node --test \
        "${PROJECT_ROOT}/frontend/src/components/docking/layoutRecovery.test.js" \
        "${PROJECT_ROOT}/frontend/src/services/marketTruth.test.js"
    echo "✅ [PASS] Frontend layout recovery tests passed."
else
    echo -e "\n[2/4] Node.js not detected in runtime, skipping frontend unit tests."
fi

# 3. Frontend Production Build Check
if [ "$SKIP_BUILD" -eq 0 ]; then
    if command -v npm >/dev/null 2>&1; then
        echo -e "\n[3/4] Checking Frontend production build (npm run build)..."
        (cd "${PROJECT_ROOT}/frontend" && npm run build)
        echo "✅ [PASS] Frontend build succeeded."
    else
        echo -e "\n[3/4] npm not detected in runtime, skipping frontend build check."
    fi
else
    echo -e "\n[3/4] Skipping Frontend build (--skip-build specified)."
fi

# 4. Critical Component Smoke Test
echo -e "\n[4/4] Checking critical components smoke test if backend is listening..."
if curl -s -f http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
    if command -v python3 >/dev/null 2>&1; then
        python3 "${PROJECT_ROOT}/scripts/smoke_critical_parts.py"
    else
        python "${PROJECT_ROOT}/scripts/smoke_critical_parts.py"
    fi
    echo "✅ [PASS] All critical components verified."
else
    echo "ℹ️ Backend is not currently listening on :8000, skipping live HTTP smoke test."
fi

echo -e "\n=========================================================="
echo "🎉 ALL QUALITY CHECKS PASSED. READY TO COMMIT."
echo "=========================================================="
exit 0

#!/usr/bin/env bash
# ==============================================================================
# Bicycle Calibration & Road Course Measurement Application
# Unified Runner, Quality Gate Checker, and Service Orchestrator
# ==============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${ROOT_DIR}"

# ANSI Colors
BOLD="\033[1m"
GREEN="\033[0;32m"
RED="\033[0;31m"
YELLOW="\033[0;33m"
BLUE="\033[0;34m"
CYAN="\033[0;36m"
DIM="\033[2m"
RESET="\033[0m"

POSTGRES_PORT="${POSTGRES_PORT:-5433}"
PYTHON_BIN="backend/.venv/bin/python"
PYTEST_BIN="backend/.venv/bin/pytest"
ALEMBIC_BIN="backend/.venv/bin/alembic"
UVICORN_BIN="backend/.venv/bin/uvicorn"

log_info() {
    echo -e "${BLUE}${BOLD}[INFO]${RESET} $1"
}

log_success() {
    echo -e "${GREEN}${BOLD}[PASS]${RESET} $1"
}

log_warn() {
    echo -e "${YELLOW}${BOLD}[WARN]${RESET} $1"
}

log_error() {
    echo -e "${RED}${BOLD}[FAIL]${RESET} $1"
}

log_header() {
    echo -e "\n${CYAN}${BOLD}=== $1 ===${RESET}"
}

# ------------------------------------------------------------------------------
# 1. Environment Initialization
# ------------------------------------------------------------------------------
ensure_env_file() {
    if [[ ! -f ".env" ]]; then
        if [[ -f ".env.example" ]]; then
            log_warn "No .env file found. Creating .env from .env.example..."
            cp .env.example .env
            log_success "Created .env with default development settings."
        else
            log_error "Neither .env nor .env.example found."
            exit 1
        fi
    fi
}

# Load .env variables if present
ensure_env_file
if [[ -f ".env" ]]; then
    # Export non-comment lines
    set -a
    # shellcheck disable=SC1091
    source <(grep -v '^#' .env | grep -v '^$')
    set +a
fi

# ------------------------------------------------------------------------------
# 2. Database Health & Container Auto-Start
# ------------------------------------------------------------------------------
is_postgres_ready() {
    "${PYTHON_BIN}" -c "
import socket, sys
s = socket.socket()
s.settimeout(1.0)
try:
    s.connect(('127.0.0.1', int('${POSTGRES_PORT}')))
    s.close()
    sys.exit(0)
except Exception:
    sys.exit(1)
" 2>/dev/null
}

ensure_postgres() {
    if is_postgres_ready; then
        log_info "PostgreSQL is reachable on 127.0.0.1:${POSTGRES_PORT}."
        ensure_test_database
        return 0
    fi

    log_warn "PostgreSQL not detected on 127.0.0.1:${POSTGRES_PORT}. Starting container via docker compose..."
    docker compose up -d postgres

    log_info "Waiting for PostgreSQL container to become ready..."
    local attempts=0
    local max_attempts=30
    while ! is_postgres_ready; do
        attempts=$((attempts + 1))
        if [[ ${attempts} -ge ${max_attempts} ]]; then
            log_error "PostgreSQL did not become available on port ${POSTGRES_PORT} after ${max_attempts}s."
            exit 1
        fi
        sleep 1
    done

    log_success "PostgreSQL container is online on port ${POSTGRES_PORT}."
    ensure_test_database
}

ensure_test_database() {
    # Check if calibration_test database exists; if not, create it
    if docker compose ps -q postgres &>/dev/null; then
        docker compose exec -T postgres psql -U "${POSTGRES_USER:-calibration_user}" -d postgres -tc \
            "SELECT 1 FROM pg_database WHERE datname = 'calibration_test'" 2>/dev/null | grep -q 1 || \
            docker compose exec -T postgres psql -U "${POSTGRES_USER:-calibration_user}" -d postgres -c \
            "CREATE DATABASE calibration_test;" &>/dev/null || true
    fi
}

# ------------------------------------------------------------------------------
# 3. Migrations Helper
# ------------------------------------------------------------------------------
run_migrations() {
    log_header "Applying Database Migrations"
    ensure_postgres
    PYTHONPATH=backend "${ALEMBIC_BIN}" -c backend/alembic.ini upgrade head
    if [[ -n "${TEST_DATABASE_URL:-}" ]]; then
        DATABASE_URL="${TEST_DATABASE_URL}" PYTHONPATH=backend "${ALEMBIC_BIN}" -c backend/alembic.ini upgrade head
    fi
    log_success "Database migrations up to date."
}

# ------------------------------------------------------------------------------
# 4. Comprehensive Check Suite (Quality Gates)
# ------------------------------------------------------------------------------
run_checks() {
    local include_e2e=false
    if [[ "${1:-}" == "--e2e" ]] || [[ "${2:-}" == "--e2e" ]]; then
        include_e2e=true
    fi

    echo -e "${BOLD}${CYAN}"
    echo "======================================================================"
    echo "  BICYCLE CALIBRATION: FULL SYSTEM VERIFICATION SUITE"
    echo "======================================================================"
    echo -e "${RESET}"

    local start_total
    start_total="$(date +%s)"

    declare -a GATES=()
    declare -a TIMINGS=()
    declare -a STATUSES=()

    run_gate() {
        local name="$1"
        shift
        log_header "Gate: ${name}"
        local t0
        t0="$(date +%s)"
        if "$@"; then
            local t1
            t1="$(date +%s)"
            local dt=$((t1 - t0))
            log_success "${name} passed in ${dt}s"
            GATES+=("${name}")
            TIMINGS+=("${dt}s")
            STATUSES+=("${GREEN}PASS${RESET}")
        else
            local t1
            t1="$(date +%s)"
            local dt=$((t1 - t0))
            log_error "${name} failed after ${dt}s"
            GATES+=("${name}")
            TIMINGS+=("${dt}s")
            STATUSES+=("${RED}FAIL${RESET}")
            print_summary "${start_total}"
            exit 1
        fi
    }

    print_summary() {
        local start_time="$1"
        local end_time
        end_time="$(date +%s)"
        local total_sec=$((end_time - start_time))

        echo -e "\n${BOLD}${CYAN}----------------------------------------------------------------------${RESET}"
        echo -e "${BOLD}VERIFICATION SUMMARY RESULTS${RESET}"
        echo -e "${BOLD}${CYAN}----------------------------------------------------------------------${RESET}"
        printf "%-40s %-12s %-10s\n" "Quality Gate" "Duration" "Status"
        echo "----------------------------------------------------------------------"
        for i in "${!GATES[@]}"; do
            printf "%-40s %-12s %b\n" "${GATES[$i]}" "${TIMINGS[$i]}" "${STATUSES[$i]}"
        done
        echo -e "${CYAN}----------------------------------------------------------------------${RESET}"
        echo -e "${BOLD}Total Duration:${RESET} ${total_sec}s\n"
    }

    # Gate 1: PostgreSQL Health & DB Check
    run_gate "1. Database Connectivity & Readiness" ensure_postgres

    # Gate 2: Database Migrations State
    run_gate "2. Database Schema (Alembic Head)" bash -c "PYTHONPATH=backend ${ALEMBIC_BIN} -c backend/alembic.ini current"

    # Gate 3: Backend Python Pytest Suite (152+ tests)
    run_gate "3. Backend Pytest Suite (Unit/Integration)" bash -c "PYTHONPATH=backend ${PYTEST_BIN} backend/tests/ -q"

    # Gate 4: Frontend TypeScript Compilation Check
    run_gate "4. Frontend TypeScript Check (tsc)" npx tsc --noEmit

    # Gate 5: Frontend ESLint Static Analysis
    run_gate "5. Frontend Linter (ESLint)" npm run lint

    # Gate 6: Frontend Vitest Suite (217+ tests)
    run_gate "6. Frontend Vitest Suite" npm run test -- --run

    # Gate 7: Frontend Production Bundle Build
    run_gate "7. Production Vite Build" npm run build

    # Gate 8: Playwright End-to-End Suite (if --e2e requested)
    if [[ "${include_e2e}" == true ]]; then
        run_gate "8. Playwright E2E Browser Suite" npm run test:e2e
    else
        log_info "Skipping Playwright E2E browser suite (run with './run.sh check --e2e' to include)."
    fi

    print_summary "${start_total}"
    log_success "All system quality gates passed successfully!"
}

# ------------------------------------------------------------------------------
# 5. Full Stack Development Runner (FastAPI + Vite)
# ------------------------------------------------------------------------------
run_dev() {
    log_header "Starting Local Development Stack"
    ensure_postgres
    run_migrations

    log_info "Starting FastAPI Backend and Vite Frontend in development mode..."
    echo -e "${DIM}Backend API:  http://127.0.0.1:8000/api/v1"
    echo -e "Frontend UI:  http://localhost:5173"
    echo -e "Press Ctrl+C to stop all services.${RESET}\n"

    # Trap to cleanly terminate background child processes
    trap 'cleanup_dev' SIGINT SIGTERM EXIT

    local BACKEND_PID=""
    local FRONTEND_PID=""

    cleanup_dev() {
        trap - SIGINT SIGTERM EXIT
        echo -e "\n${YELLOW}[SHUTDOWN] Stopping development services...${RESET}"
        if [[ -n "${BACKEND_PID}" ]] && kill -0 "${BACKEND_PID}" 2>/dev/null; then
            kill "${BACKEND_PID}" 2>/dev/null || true
        fi
        if [[ -n "${FRONTEND_PID}" ]] && kill -0 "${FRONTEND_PID}" 2>/dev/null; then
            kill "${FRONTEND_PID}" 2>/dev/null || true
        fi
        wait 2>/dev/null || true
        log_success "All services stopped cleanly."
        exit 0
    }

    # Start FastAPI Backend
    PYTHONPATH=backend "${UVICORN_BIN}" app.main:app --host 127.0.0.1 --port 8000 --reload &
    BACKEND_PID=$!

    # Start Vite Frontend
    npm run dev &
    FRONTEND_PID=$!

    # Wait for either process to terminate
    wait -n "${BACKEND_PID}" "${FRONTEND_PID}"
}

# ------------------------------------------------------------------------------
# 6. Usage & CLI Dispatcher
# ------------------------------------------------------------------------------
usage() {
    echo -e "${BOLD}Usage:${RESET} ./run.sh <command> [options]"
    echo ""
    echo -e "${BOLD}Commands:${RESET}"
    echo -e "  ${CYAN}check [--e2e]${RESET}     Run all system quality gates (tests, types, lint, build)."
    echo -e "                      Add ${YELLOW}--e2e${RESET} to include full Playwright browser tests."
    echo -e "  ${CYAN}dev${RESET}               Start full local stack (Postgres + Backend + Frontend)."
    echo -e "  ${CYAN}test:backend${RESET}      Run backend pytest suite."
    echo -e "  ${CYAN}test:frontend${RESET}     Run frontend Vitest suite."
    echo -e "  ${CYAN}test:e2e${RESET}          Run Playwright E2E browser tests."
    echo -e "  ${CYAN}db:up${RESET}             Start PostgreSQL docker container."
    echo -e "  ${CYAN}db:migrate${RESET}        Apply latest Alembic database migrations."
    echo -e "  ${CYAN}admin:create [opts]${RESET} Seed or elevate administrative account via CLI."
    echo -e "  ${CYAN}help${RESET}              Display this help menu."
    echo ""
}

COMMAND="${1:-}"

case "${COMMAND}" in
    check)
        shift
        run_checks "$@"
        ;;
    dev)
        run_dev
        ;;
    test:backend)
        ensure_postgres
        shift
        if [[ $# -eq 0 ]]; then
            PYTHONPATH=backend "${PYTEST_BIN}" backend/tests/
        else
            PYTHONPATH=backend "${PYTEST_BIN}" "$@"
        fi
        ;;
    test:frontend)
        shift
        npm run test -- "$@"
        ;;
    test:e2e)
        ensure_postgres
        shift
        npm run test:e2e -- "$@"
        ;;
    db:up)
        ensure_postgres
        ;;
    db:migrate)
        run_migrations
        ;;
    admin:create)
        ensure_postgres
        run_migrations
        shift
        PYTHONPATH=backend "${PYTHON_BIN}" backend/scripts/create_admin.py "$@"
        ;;
    help|--help|-h|"")
        usage
        ;;
    *)
        log_error "Unknown command: ${COMMAND}"
        usage
        exit 1
        ;;
esac

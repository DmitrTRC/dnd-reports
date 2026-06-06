#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# make_report.sh — обёртка над generate_report.py
#
# Использование:
#     ./make_report.sh <path/to/month_data.json>
#
# Что делает:
#   1. Запускает generate_report.py с автоподставленными аргументами
#      (--logo, --config, --constants) из корня проекта.
#   2. PDF получает имя по входному JSON (заменяется расширение).
#   3. При удачной генерации:
#         - PDF  -> ./REPORTS/
#         - JSON -> ./REPORTS_SRC_JSON/
# -----------------------------------------------------------------------------

set -euo pipefail

# --- директория, где лежит этот скрипт (= корень проекта) ---------------------
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- константные пути ---------------------------------------------------------
SCRIPT="${PROJECT_ROOT}/generate_report.py"
LOGO="${PROJECT_ROOT}/emblem_transparent.png"
CONFIG="${PROJECT_ROOT}/config.json"
CONSTANTS="${PROJECT_ROOT}/report_constants.json"
REPORTS_DIR="${PROJECT_ROOT}/REPORTS"
SRC_JSON_DIR="${PROJECT_ROOT}/REPORTS_SRC_JSON"

# --- интерпретатор (предпочитаем venv, если он есть) --------------------------
if [[ -x "${PROJECT_ROOT}/.venv/bin/python" ]]; then
    PYTHON="${PROJECT_ROOT}/.venv/bin/python"
else
    PYTHON="$(command -v python3 || command -v python)"
fi

# --- проверка аргумента -------------------------------------------------------
if [[ $# -ne 1 ]]; then
    echo "Usage: $(basename "$0") <month_data.json>" >&2
    exit 1
fi

INPUT_JSON="$1"

# --- валидация входных файлов -------------------------------------------------
for f in "$INPUT_JSON" "$SCRIPT" "$LOGO" "$CONFIG" "$CONSTANTS"; do
    if [[ ! -f "$f" ]]; then
        echo "ERROR: file not found: $f" >&2
        exit 2
    fi
done

mkdir -p "$REPORTS_DIR" "$SRC_JSON_DIR"

# --- имена выходных файлов ----------------------------------------------------
INPUT_BASENAME="$(basename "$INPUT_JSON")"
PDF_BASENAME="${INPUT_BASENAME%.json}.pdf"
TMP_PDF="${PROJECT_ROOT}/${PDF_BASENAME}"
FINAL_PDF="${REPORTS_DIR}/${PDF_BASENAME}"
FINAL_JSON="${SRC_JSON_DIR}/${INPUT_BASENAME}"

echo ">>> Generating report from: ${INPUT_JSON}"
echo ">>> PDF will be: ${FINAL_PDF}"

# --- запуск генератора --------------------------------------------------------
"$PYTHON" "$SCRIPT" \
    --input     "$INPUT_JSON" \
    --logo      "$LOGO" \
    --config    "$CONFIG" \
    --constants "$CONSTANTS" \
    --output    "$TMP_PDF"

# --- перемещение результатов -------------------------------------------------
mv -f "$TMP_PDF"     "$FINAL_PDF"
mv -f "$INPUT_JSON"  "$FINAL_JSON"

echo ">>> OK"
echo "    PDF:  ${FINAL_PDF}"
echo "    JSON: ${FINAL_JSON}"

#!/usr/bin/env bash
# download_models.sh — TrueFace worker model setup
# Called at Docker build time (bakes models into image) or at container start
# to download to a mounted volume.
set -euo pipefail

MODELS_DIR="${MODELS_DIR:-/models}"
INSIGHTFACE_MODEL_ROOT="${INSIGHTFACE_MODEL_ROOT:-${MODELS_DIR}/insightface}"
INSWAPPER_MODEL_PATH="${INSWAPPER_MODEL_PATH:-${MODELS_DIR}/inswapper_128.onnx}"
GFPGAN_MODEL_PATH="${GFPGAN_MODEL_PATH:-${MODELS_DIR}/GFPGANv1.4.pth}"
BISENET_MODEL_PATH="${BISENET_MODEL_PATH:-${MODELS_DIR}/bisenet_face_parsing.onnx}"

# Known SHA-256 for GFPGANv1.4.pth (official TencentARC release v1.3.0)
GFPGAN_SHA256="e2cd4703ab14f4d01fd1383a8a8b266f9a5833dacee8e6a79d3bf21a1b6be4ad"

mkdir -p "${MODELS_DIR}" "${INSIGHTFACE_MODEL_ROOT}"

# ---------------------------------------------------------------------------
# Helper: download a file if the URL env var is non-empty
# ---------------------------------------------------------------------------
download_if_url_is_set() {
    local url="$1"
    local destination="$2"
    local label="$3"

    if [ -z "${url}" ]; then
        echo "[skip]  ${label}: URL not set — skipping download"
        return 0
    fi

    if [ -s "${destination}" ]; then
        echo "[skip]  ${label}: already exists at ${destination}"
        return 0
    fi

    echo "[fetch] ${label} → ${destination}"
    if ! curl -L --fail --retry 3 --retry-delay 2 --progress-bar \
              --output "${destination}" "${url}"; then
        echo "[ERROR] Failed to download ${label} from ${url}" >&2
        rm -f "${destination}"
        exit 1
    fi
    echo "[ok]    ${label} downloaded ($(du -sh "${destination}" | cut -f1))"
}

# ---------------------------------------------------------------------------
# Helper: verify SHA-256 of a file
# ---------------------------------------------------------------------------
verify_sha256() {
    local file="$1"
    local expected="$2"
    local label="$3"

    if [ ! -f "${file}" ]; then
        # File not present — skip verification (operator may supply at runtime)
        return 0
    fi

    echo "[verify] ${label} SHA-256..."
    if command -v sha256sum >/dev/null 2>&1; then
        actual=$(sha256sum "${file}" | awk '{print $1}')
    elif command -v shasum >/dev/null 2>&1; then
        actual=$(shasum -a 256 "${file}" | awk '{print $1}')
    else
        echo "[warn]   No sha256sum/shasum available — skipping verification"
        return 0
    fi

    if [ "${actual}" != "${expected}" ]; then
        echo "[ERROR] ${label} checksum mismatch!" >&2
        echo "        expected: ${expected}" >&2
        echo "        actual:   ${actual}" >&2
        rm -f "${file}"
        exit 1
    fi
    echo "[ok]    ${label} checksum verified"
}

# ---------------------------------------------------------------------------
# InSwapper — required. Operator MUST provide INSWAPPER_MODEL_URL or mount the
# file into the container at INSWAPPER_MODEL_PATH before the worker starts.
# ---------------------------------------------------------------------------
if [ -z "${INSWAPPER_MODEL_URL:-}" ] && [ ! -s "${INSWAPPER_MODEL_PATH}" ]; then
    echo ""
    echo "[warn]  INSWAPPER_MODEL_URL is not set and ${INSWAPPER_MODEL_PATH} does not exist."
    echo "        Set INSWAPPER_MODEL_URL at build time or mount the model file before starting."
    echo "        The worker will fail to load until this model is available."
    echo ""
else
    download_if_url_is_set \
        "${INSWAPPER_MODEL_URL:-}" \
        "${INSWAPPER_MODEL_PATH}" \
        "InsightFace InSwapper model"
fi

# ---------------------------------------------------------------------------
# GFPGAN v1.4 — mandatory for Tier 1 quality. Downloaded by default.
# Official URL: https://github.com/TencentARC/GFPGAN/releases/download/v1.3.0/GFPGANv1.4.pth
# ---------------------------------------------------------------------------
GFPGAN_URL="${GFPGAN_MODEL_URL:-https://github.com/TencentARC/GFPGAN/releases/download/v1.3.0/GFPGANv1.4.pth}"
download_if_url_is_set \
    "${GFPGAN_URL}" \
    "${GFPGAN_MODEL_PATH}" \
    "GFPGAN v1.4 restorer"
verify_sha256 "${GFPGAN_MODEL_PATH}" "${GFPGAN_SHA256}" "GFPGANv1.4.pth"

# ---------------------------------------------------------------------------
# BiSeNet face parser — optional but strongly recommended for mask quality.
# Supply BISENET_MODEL_URL or mount the ONNX at BISENET_MODEL_PATH.
# Falls back to ellipse mask if absent.
# ---------------------------------------------------------------------------
download_if_url_is_set \
    "${BISENET_MODEL_URL:-}" \
    "${BISENET_MODEL_PATH}" \
    "BiSeNet face parser (ONNX)"

# ---------------------------------------------------------------------------
# InsightFace buffalo_l — downloaded automatically by InsightFace at runtime
# if INSIGHTFACE_MODEL_ROOT is writable. For air-gapped/locked images, pre-bake
# the pack by running: python3 -c "from insightface.app import FaceAnalysis;
# FaceAnalysis(name='buffalo_l', root='${INSIGHTFACE_MODEL_ROOT}').prepare(ctx_id=-1)"
# ---------------------------------------------------------------------------
if [ ! -d "${INSIGHTFACE_MODEL_ROOT}/models/buffalo_l" ]; then
    echo ""
    echo "[info]  InsightFace buffalo_l pack not found at ${INSIGHTFACE_MODEL_ROOT}/models/buffalo_l"
    echo "        It will be downloaded automatically at first startup if network is available."
    echo "        For air-gapped images, pre-bake it during the Docker build step."
    echo ""
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "======================================================================"
echo " TrueFace model setup complete"
echo "======================================================================"
echo ""
echo " Required at startup:"
echo "   INSWAPPER_MODEL_PATH = ${INSWAPPER_MODEL_PATH}"
echo "     present: $([ -s "${INSWAPPER_MODEL_PATH}" ] && echo YES || echo NO)"
echo ""
echo " Restoration (Tier 1 quality):"
echo "   GFPGAN_MODEL_PATH    = ${GFPGAN_MODEL_PATH}"
echo "     present: $([ -s "${GFPGAN_MODEL_PATH}" ] && echo YES || echo NO)"
echo ""
echo " Face parsing (pixel-accurate masks):"
echo "   BISENET_MODEL_PATH   = ${BISENET_MODEL_PATH}"
echo "     present: $([ -s "${BISENET_MODEL_PATH}" ] && echo YES || echo "NO (ellipse fallback active)")"
echo ""
echo " InsightFace detector/recognition:"
echo "   INSIGHTFACE_MODEL_ROOT = ${INSIGHTFACE_MODEL_ROOT}"
echo "     buffalo_l present: $([ -d "${INSIGHTFACE_MODEL_ROOT}/models/buffalo_l" ] && echo YES || echo "NO (auto-download on first run)")"
echo ""

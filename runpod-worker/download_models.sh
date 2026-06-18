#!/usr/bin/env bash
set -euo pipefail

MODEL_DIR="${MODEL_DIR:-/models}"
INSIGHTFACE_MODEL_ROOT="${INSIGHTFACE_MODEL_ROOT:-${MODEL_DIR}/insightface}"
INSWAPPER_MODEL_PATH="${INSWAPPER_MODEL_PATH:-${MODEL_DIR}/inswapper_128.onnx}"
GFPGAN_MODEL_PATH="${GFPGAN_MODEL_PATH:-${MODEL_DIR}/GFPGANv1.4.pth}"

mkdir -p "${MODEL_DIR}" "${INSIGHTFACE_MODEL_ROOT}"

download_if_url_is_set() {
  local url="$1"
  local destination="$2"
  local label="$3"

  if [ -z "${url}" ]; then
    echo "Skipping ${label}: URL env var is empty"
    return 0
  fi

  if [ -s "${destination}" ]; then
    echo "${label} already exists at ${destination}"
    return 0
  fi

  echo "Downloading ${label} to ${destination}"
  curl -L --fail --retry 3 --output "${destination}" "${url}"
}

download_if_url_is_set "${INSWAPPER_MODEL_URL:-}" "${INSWAPPER_MODEL_PATH}" "InsightFace InSwapper model"
download_if_url_is_set "${GFPGAN_MODEL_URL:-}" "${GFPGAN_MODEL_PATH}" "GFPGAN model"

cat <<EOF

Model setup complete.

Required:
- INSWAPPER_MODEL_PATH=${INSWAPPER_MODEL_PATH}
- INSIGHTFACE_MODEL_ROOT=${INSIGHTFACE_MODEL_ROOT}

Optional:
- GFPGAN_MODEL_PATH=${GFPGAN_MODEL_PATH}

InsightFace will download its detector/recognition pack into INSIGHTFACE_MODEL_ROOT
at runtime when network access is available. For locked production images, pre-bake
the buffalo_l model pack into that directory.
EOF

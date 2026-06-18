FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 python3.11-dev python3-pip \
    libgl1 libglib2.0-0 libgomp1 ffmpeg curl git \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf python3.11 /usr/bin/python3 \
    && ln -sf python3 /usr/bin/python

WORKDIR /app

# Install Python deps (torch first — it's large)
RUN pip install torch==2.2.2 torchvision==0.17.2 --index-url https://download.pytorch.org/whl/cu124

COPY requirements.txt .
RUN pip install -r requirements.txt

# Copy worker code
COPY trueface_worker trueface_worker
COPY worker.py worker.py
COPY download_models.sh download_models.sh
RUN chmod +x download_models.sh

# Build-time model download (set ARGs via --build-arg)
ARG INSWAPPER_MODEL_URL=""
ARG GFPGAN_MODEL_URL="https://github.com/TencentARC/GFPGAN/releases/download/v1.3.0/GFPGANv1.4.pth"
ARG BISENET_MODEL_URL=""
ARG MODELS_DIR="/models"
ENV MODELS_DIR=${MODELS_DIR}
RUN INSWAPPER_MODEL_URL=${INSWAPPER_MODEL_URL} \
    GFPGAN_MODEL_URL=${GFPGAN_MODEL_URL} \
    BISENET_MODEL_URL=${BISENET_MODEL_URL} \
    MODELS_DIR=${MODELS_DIR} \
    ./download_models.sh

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "worker:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--loop", "uvloop"]

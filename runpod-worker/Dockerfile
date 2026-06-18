FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8000

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        ffmpeg \
        git \
        libglib2.0-0 \
        libgl1 \
        python3 \
        python3-pip \
        python3-venv \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements.txt
RUN python3 -m pip install --upgrade pip \
    && python3 -m pip install -r requirements.txt

COPY requirements-restoration.txt requirements-restoration.txt
RUN if [ "${INSTALL_RESTORATION:-false}" = "true" ]; then \
        python3 -m pip install -r requirements-restoration.txt; \
    fi

COPY trueface_worker trueface_worker
COPY worker.py worker.py
COPY download_models.sh download_models.sh

RUN chmod +x download_models.sh

EXPOSE 8000

CMD ["uvicorn", "worker:app", "--host", "0.0.0.0", "--port", "8000"]

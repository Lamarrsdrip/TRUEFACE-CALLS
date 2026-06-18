# TrueFace RunPod Worker

This folder contains the versioned GPU worker for TrueFace Calls cloud face replacement. Before this folder was added, the deployed RunPod worker was not present in the GitHub repo, so Emergent could not reproduce or update it.

## What This Worker Does

- Accepts `POST /process-frame` with a live camera frame and approved face profile images.
- Detects the live target face with InsightFace.
- Builds one stable identity embedding from all supplied reference images.
- Keeps the target face locked across frames to avoid identity switching.
- Runs the configured ONNX face-swap model on GPU when CUDA is available.
- Applies a feathered face mask, LAB color matching, optional GFPGAN restoration, detail sharpening, and temporal smoothing.
- Returns a processed image data URL plus latency and quality metrics.

## Endpoints

`GET /health`

Returns model load status, ONNX providers, device, model paths, and capabilities.

`POST /process-frame`

Required JSON:

```json
{
  "frame": "data:image/jpeg;base64,...",
  "faceProfileId": "face-profile-id",
  "faceProfileImages": [
    { "role": "FRONT", "image": "data:image/jpeg;base64,...", "qualityScore": 100 },
    { "role": "LEFT", "image": "data:image/jpeg;base64,...", "qualityScore": 85 },
    { "role": "RIGHT", "image": "data:image/jpeg;base64,...", "qualityScore": 85 }
  ],
  "qualityMode": "standard",
  "qualityHints": {
    "preserveDetail": true,
    "temporalStability": true,
    "targetMaxLongEdge": 1280
  },
  "roomId": "room-id"
}
```

If `TRUEFACE_WORKER_API_KEY` is set, call the endpoint with:

```bash
Authorization: Bearer $TRUEFACE_WORKER_API_KEY
```

## Environment Variables

Required for real GPU inference:

```bash
TRUEFACE_WORKER_API_KEY=
INSIGHTFACE_MODEL_ROOT=/models/insightface
INSWAPPER_MODEL_PATH=/models/inswapper_128.onnx
```

Recommended:

```bash
FACE_DET_SIZE=640
TRUEFACE_OUTPUT_MIME=image/webp
TRUEFACE_RESTORATION=gfpgan
GFPGAN_MODEL_PATH=/models/GFPGANv1.4.pth
GFPGAN_WEIGHT=0.45
TRUEFACE_MAX_TRACKED_SESSIONS=96
```

Model download URLs can be provided at image build/runtime:

```bash
INSWAPPER_MODEL_URL=
GFPGAN_MODEL_URL=
```

## Build And Run

```bash
docker build -t trueface-runpod-worker ./runpod-worker
docker run --gpus all -p 8000:8000 \
  -e TRUEFACE_WORKER_API_KEY=replace-me \
  -e INSWAPPER_MODEL_PATH=/models/inswapper_128.onnx \
  -v /path/to/models:/models \
  trueface-runpod-worker
```

Health check:

```bash
curl http://127.0.0.1:8000/health
```

## Realism Notes

This worker is a real GPU pipeline, but the final realism ceiling depends heavily on the model:

- `inswapper_128.onnx` is fast and common, but it is 128px face generation internally. It can still look soft or sticker-like on close-up HD video.
- For TikTok/FaceTime-level output, the recommended production stack is a higher-resolution 256/512+ identity-preserving swapper, face parsing segmentation, GFPGAN/CodeFormer/GPEN restoration, optical-flow-aware temporal smoothing, and eventually streaming GPU transport instead of per-frame HTTPS.
- This worker reports `faceParsing: unavailable` unless a segmentation model is added. The current fallback uses landmark/ellipse masking with feathering.

Do not call the product photorealistic until RunPod visual tests prove it with multiple identities, lighting conditions, head angles, and mobile devices.

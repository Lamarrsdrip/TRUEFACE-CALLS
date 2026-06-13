from __future__ import annotations

import hashlib
import hmac
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from gridfs import GridFS

from ..entitlements import current_entitlement
from ..security import current_user
from ..serializers import iso, json_safe, utc_now

router = APIRouter(prefix="/api", tags=["faces"])


def _quality(body: dict) -> dict:
    width, height = int(body.get("width", 0)), int(body.get("height", 0))
    face_count = int(body.get("faceCount", body.get("faces", 0)))
    sharpness = float(body.get("sharpness", body.get("blurScore", 0)))
    brightness = float(body.get("brightness", 0))
    coverage = float(body.get("faceCoverage", 0))
    checks = {
        "resolution": width >= 512 and height >= 512,
        "singleFace": face_count == 1,
        "sharpness": sharpness >= 0.45,
        "lighting": 0.2 <= brightness <= 0.9,
        "faceCoverage": 0.18 <= coverage <= 0.8,
    }
    score = round(sum(20 for passed in checks.values() if passed))
    return {"score": score, "passed": all(checks.values()), "checks": checks}


def _readiness(images: list[dict]) -> tuple[int, str]:
    average = sum(int(image.get("qualityScore", 0)) for image in images) / max(
        len(images), 1
    )
    roles = len({image.get("role") for image in images})
    score = min(100, round(average * 0.75 + min(15, (len(images) - 1) * 4) + min(10, (roles - 1) * 3)))
    label = "EXCELLENT" if score >= 90 else "GOOD" if score >= 75 else "FAIR" if score >= 55 else "POOR"
    return score, label


@router.post("/faces/quality-check")
def quality_check(body: dict, _user: dict = Depends(current_user)) -> dict:
    return _quality(body)


@router.post("/faces/upload-url")
def upload_url(
    body: dict, request: Request, user: dict = Depends(current_user)
) -> dict:
    content_type = str(body.get("contentType", ""))
    size = int(body.get("sizeBytes", 0))
    if content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=422, detail="Unsupported image type")
    if size <= 0 or size > 10_000_000:
        raise HTTPException(status_code=422, detail="Image must be under 10 MB")
    object_key = f"faces/{user['id']}/{uuid.uuid4()}"
    token = request.app.state.sign_upload(object_key)
    return {
        "objectKey": object_key,
        "url": f"/api/uploads/{object_key}?token={token}",
        "headers": {"content-type": content_type},
    }


@router.put("/uploads/{object_key:path}")
async def upload_private(object_key: str, token: str, request: Request) -> dict:
    if not request.app.state.verify_upload(object_key, token):
        raise HTTPException(status_code=403, detail="Upload token is invalid")
    payload = await request.body()
    if len(payload) > 10_000_000:
        raise HTTPException(status_code=413, detail="Upload is too large")
    fs = GridFS(request.app.state.db, collection="uploads")
    existing = request.app.state.db.uploads.files.find_one({"filename": object_key})
    if existing:
        fs.delete(existing["_id"])
    fs.put(
        payload,
        filename=object_key,
        contentType=request.headers.get("content-type", "application/octet-stream"),
        metadata={"private": True, "uploadedAt": utc_now()},
    )
    return {"uploaded": True}


@router.get("/private-files/{object_key:path}")
def private_file(
    object_key: str,
    token: str,
    request: Request,
) -> Response:
    if not request.app.state.verify_download(object_key, token):
        raise HTTPException(status_code=403, detail="Download token is invalid")
    fs = GridFS(request.app.state.db, collection="uploads")
    item = fs.find_one({"filename": object_key})
    if not item:
        raise HTTPException(status_code=404, detail="Private file not found")
    return Response(content=item.read(), media_type=item.content_type)


@router.post("/faces")
def create_face(
    body: dict, request: Request, user: dict = Depends(current_user)
) -> dict:
    db = request.app.state.db
    plan, _subscription = current_entitlement(db, user["id"])
    if db.face_profiles.count_documents({"userId": user["id"], "deletedAt": None}) >= plan[
        "maxFaceProfiles"
    ]:
        raise HTTPException(status_code=403, detail="Face profile limit reached")
    images_input = body.get("images") or []
    if not images_input or len(images_input) > plan["maxImagesPerProfile"]:
        raise HTTPException(status_code=403, detail="Image count exceeds your plan")
    consent = body.get("consent") or {}
    if not all(
        consent.get(key) is True
        for key in [
            "ownsOrHasPermission",
            "consentsToFaceUse",
            "acceptsFaceTerms",
        ]
    ):
        raise HTTPException(status_code=422, detail="All consent confirmations are required")
    images = []
    now = utc_now()
    profile_id = str(uuid.uuid4())
    for source in images_input:
        quality = source.get("quality") or {}
        normalized = (
            quality
            if "score" in quality
            else _quality(quality)
        )
        if not normalized.get("passed"):
            raise HTTPException(status_code=422, detail="Every face image must pass quality checks")
        image = {
            "id": str(uuid.uuid4()),
            "faceProfileId": profile_id,
            "objectKey": source["objectKey"],
            "role": source["role"],
            "mimeType": source["mimeType"],
            "sizeBytes": int(source["sizeBytes"]),
            "width": int(source["width"]),
            "height": int(source["height"]),
            "qualityScore": int(normalized["score"]),
            "qualitySignals": normalized,
            "createdAt": now,
            "updatedAt": now,
        }
        images.append(image)
    if not any(image["role"] == "FRONT" for image in images):
        raise HTTPException(status_code=422, detail="A front-facing image is required")
    readiness_score, readiness_label = _readiness(images)
    primary = next(image for image in images if image["role"] == "FRONT")
    profile = {
        "id": profile_id,
        "userId": user["id"],
        "name": str(body.get("name", "")).strip()[:80],
        "objectKey": primary["objectKey"],
        "thumbnailKey": None,
        "mimeType": primary["mimeType"],
        "sizeBytes": primary["sizeBytes"],
        "width": primary["width"],
        "height": primary["height"],
        "qualityScore": primary["qualityScore"],
        "qualitySignals": primary["qualitySignals"],
        "moderationStatus": "PENDING",
        "active": True,
        "readinessScore": readiness_score,
        "readinessLabel": readiness_label,
        "consentRevokedAt": None,
        "deletedAt": None,
        "createdAt": now,
        "updatedAt": now,
    }
    db.face_profiles.insert_one(profile)
    db.face_profile_images.insert_many(images)
    db.consent_logs.insert_one(
        {
            "id": str(uuid.uuid4()),
            "userId": user["id"],
            "faceProfileId": profile_id,
            **consent,
            "privacyVersion": "2026-06-11",
            "acceptedAt": now,
            "revokedAt": None,
        }
    )
    return json_safe({k: v for k, v in profile.items() if k != "_id"})


def _signed_download(request: Request, object_key: str) -> str:
    expires = int((utc_now() + timedelta(minutes=10)).timestamp())
    token = request.app.state.sign_download(object_key, expires)
    return f"/api/private-files/{object_key}?token={token}"


@router.get("/faces")
def list_faces(request: Request, user: dict = Depends(current_user)) -> list[dict]:
    db = request.app.state.db
    result = []
    for profile in db.face_profiles.find(
        {"userId": user["id"], "deletedAt": None}
    ).sort("createdAt", -1):
        images = list(
            db.face_profile_images.find(
                {"faceProfileId": profile["id"]}, {"_id": 0}
            )
        )
        result.append(
            {
                **json_safe({k: v for k, v in profile.items() if k != "_id"}),
                "images": json_safe(images),
                "previewUrl": _signed_download(request, profile["objectKey"]),
            }
        )
    return result


@router.post("/faces/{profile_id}/activate")
def activate_face(
    profile_id: str, request: Request, user: dict = Depends(current_user)
) -> dict:
    profile = request.app.state.db.face_profiles.find_one(
        {
            "id": profile_id,
            "userId": user["id"],
            "active": True,
            "moderationStatus": "APPROVED",
            "consentRevokedAt": None,
            "deletedAt": None,
        }
    )
    if not profile:
        raise HTTPException(status_code=403, detail="Face profile is not approved and active")
    return {"faceImageUrl": _signed_download(request, profile["objectKey"])}


@router.post("/faces/{profile_id}/revoke")
def revoke_face(
    profile_id: str, request: Request, user: dict = Depends(current_user)
) -> dict:
    now = utc_now()
    result = request.app.state.db.face_profiles.update_one(
        {"id": profile_id, "userId": user["id"], "deletedAt": None},
        {"$set": {"active": False, "consentRevokedAt": now, "updatedAt": now}},
    )
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Face profile not found")
    request.app.state.db.consent_logs.update_many(
        {"faceProfileId": profile_id, "revokedAt": None},
        {"$set": {"revokedAt": now}},
    )
    return {"revoked": True}


@router.post("/faces/{profile_id}/status")
def face_status(
    profile_id: str,
    body: dict,
    request: Request,
    user: dict = Depends(current_user),
) -> dict:
    result = request.app.state.db.face_profiles.update_one(
        {"id": profile_id, "userId": user["id"], "deletedAt": None},
        {"$set": {"active": bool(body.get("active")), "updatedAt": utc_now()}},
    )
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Face profile not found")
    return {"active": bool(body.get("active"))}


@router.delete("/faces/{profile_id}")
def delete_face(
    profile_id: str, request: Request, user: dict = Depends(current_user)
) -> dict:
    db = request.app.state.db
    profile = db.face_profiles.find_one(
        {"id": profile_id, "userId": user["id"], "deletedAt": None}
    )
    if not profile:
        raise HTTPException(status_code=404, detail="Face profile not found")
    images = list(db.face_profile_images.find({"faceProfileId": profile_id}))
    try:
        fs = GridFS(db, collection="uploads")
        for image in images:
            item = db.uploads.files.find_one({"filename": image["objectKey"]})
            if item:
                fs.delete(item["_id"])
    except Exception:
        pass
    now = utc_now()
    db.face_profiles.update_one(
        {"id": profile_id},
        {"$set": {"active": False, "deletedAt": now, "updatedAt": now}},
    )
    db.face_profile_images.delete_many({"faceProfileId": profile_id})
    db.consent_logs.update_many(
        {"faceProfileId": profile_id, "revokedAt": None},
        {"$set": {"revokedAt": now}},
    )
    return {"deleted": True}

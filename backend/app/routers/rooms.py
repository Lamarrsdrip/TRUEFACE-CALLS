from __future__ import annotations

import hashlib
import json
import secrets
import time
import uuid
from datetime import timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request

from ..entitlements import current_entitlement
from ..errors import api_error
from ..invites import InviteSigner
from ..routers.providers import provider_values
from ..security import PASSWORDS, current_user
from ..serializers import as_utc, iso, json_safe, utc_now

router = APIRouter(prefix="/api", tags=["rooms"])


def _urls(request: Request, room: dict) -> tuple[str, str]:
    expires_at = room["expiresAt"]
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    token = InviteSigner(request.app.state.settings.auth_secret).sign(
        room["id"], room["inviteVersion"], int(expires_at.timestamp())
    )
    invite = f"{request.app.state.settings.app_url}/call/{room['slug']}?invite={token}"
    return invite, f"{invite}&host=1"


def _participant_payload(db, participant: dict) -> dict:
    user = (
        db.users.find_one({"id": participant.get("userId")})
        if participant.get("userId")
        else None
    )
    return {
        **json_safe({k: v for k, v in participant.items() if k != "_id"}),
        "user": (
            {"displayName": user["displayName"], "email": user["email"]}
            if user
            else None
        ),
    }


def _room_payload(request: Request, room: dict, user_id: str | None = None) -> dict:
    db = request.app.state.db
    invite, host = _urls(request, room)
    host_user = db.users.find_one({"id": room["hostId"]})
    history = db.call_history.find_one({"roomId": room["id"]}, {"_id": 0})
    count = db.call_participants.count_documents({"roomId": room["id"]})
    return {
        **json_safe({k: v for k, v in room.items() if k not in {"_id", "passwordHash"}}),
        "inviteUrl": invite,
        "hostUrl": host if user_id == room["hostId"] else None,
        "isHost": user_id == room["hostId"] if user_id else False,
        "host": {
            "displayName": host_user["displayName"],
            "email": host_user["email"],
        },
        "history": json_safe(history),
        "_count": {"participants": count},
    }


def _assert_invite(request: Request, room: dict, token: str) -> None:
    InviteSigner(request.app.state.settings.auth_secret).verify(
        token, room["id"], room["inviteVersion"]
    )


def _require_livekit(request: Request) -> dict[str, str]:
    config = provider_values(request, "livekit")
    missing = [
        label
        for key, label in (
            ("url", "URL"),
            ("apiKey", "API key"),
            ("apiSecret", "API secret"),
        )
        if not config.get(key)
    ]
    if missing:
        raise api_error(
            503,
            "LIVEKIT_NOT_CONFIGURED",
            "LiveKit URL, API key, and API secret must be configured in Admin > Providers.",
        )
    return config


def _require_room_available(db, room: dict | None) -> dict:
    if not room:
        raise api_error(404, "ROOM_NOT_FOUND", "Call room not found")
    expires_at = as_utc(room["expiresAt"])
    if room.get("status") in {"ENDED", "EXPIRED"} or expires_at <= utc_now():
        if room.get("status") != "EXPIRED":
            db.call_rooms.update_one(
                {"id": room["id"]},
                {"$set": {"status": "EXPIRED", "updatedAt": utc_now()}},
            )
            room["status"] = "EXPIRED"
        raise api_error(410, "CALL_EXPIRED", "This call link has expired")
    return room


@router.post("/rooms")
def create_room(
    body: dict, request: Request, user: dict = Depends(current_user)
) -> dict:
    if user.get("roomCreationDisabled"):
        raise HTTPException(status_code=403, detail="Room creation is disabled")
    _require_livekit(request)
    title = str(body.get("title", "")).strip()
    if not title or len(title) > 120:
        raise HTTPException(status_code=422, detail="Call title is required")
    plan, _subscription = current_entitlement(request.app.state.db, user["id"])
    try:
        max_participants = int(body.get("maxParticipants", 2))
    except (TypeError, ValueError) as error:
        raise HTTPException(
            status_code=422, detail="Participant limit is invalid"
        ) from error
    if max_participants < 2 or max_participants > plan["maxParticipants"]:
        raise HTTPException(status_code=403, detail="Participant limit exceeds your plan")
    expires_minutes = max(5, min(int(body.get("expiresInMinutes", 1440)), 43200))
    now = utc_now()
    password = body.get("password")
    room = {
        "id": str(uuid.uuid4()),
        "hostId": user["id"],
        "slug": secrets.token_urlsafe(9),
        "title": title,
        "status": "OPEN",
        "inviteVersion": 1,
        "passwordHash": PASSWORDS.hash(str(password)) if password else None,
        "waitingRoom": bool(body.get("waitingRoom", True)),
        "allowGuests": bool(body.get("allowGuests", True)),
        "maxParticipants": max_participants,
        "expiresAt": now + timedelta(minutes=expires_minutes),
        "startedAt": None,
        "endedAt": None,
        "createdAt": now,
        "updatedAt": now,
    }
    request.app.state.db.call_rooms.insert_one(room)
    request.app.state.db.call_participants.insert_one(
        {
            "id": str(uuid.uuid4()),
            "roomId": room["id"],
            "userId": user["id"],
            "guestName": None,
            "role": "HOST",
            "state": "APPROVED",
            "aiDisclosure": False,
            "joinedAt": None,
            "leftAt": None,
            "createdAt": now,
            "updatedAt": now,
        }
    )
    request.app.state.db.call_events.insert_one(
        {
            "id": str(uuid.uuid4()),
            "roomId": room["id"],
            "actorId": user["id"],
            "type": "ROOM_CREATED",
            "createdAt": now,
        }
    )
    invite, host = _urls(request, room)
    return {
        "room": json_safe({k: v for k, v in room.items() if k != "_id"}),
        "inviteUrl": invite,
        "hostUrl": host,
    }


@router.get("/rooms/{slug}")
def resolve_room(slug: str, invite: str, request: Request) -> dict:
    room = _require_room_available(
        request.app.state.db,
        request.app.state.db.call_rooms.find_one({"slug": slug}),
    )
    _assert_invite(request, room, invite)
    return {
        "id": room["id"],
        "slug": room["slug"],
        "title": room["title"],
        "status": room["status"],
        "waitingRoom": room["waitingRoom"],
        "allowGuests": room["allowGuests"],
        "maxParticipants": room["maxParticipants"],
        "participantCount": request.app.state.db.call_participants.count_documents(
            {"roomId": room["id"], "state": {"$in": ["APPROVED", "JOINED"]}}
        ),
        "passwordRequired": bool(room.get("passwordHash")),
        "expiresAt": iso(room["expiresAt"]),
        "inviteUrl": _urls(request, room)[0],
    }


@router.post("/rooms/{room_id}/join-request")
def guest_join(room_id: str, body: dict, request: Request) -> dict:
    db = request.app.state.db
    room = db.call_rooms.find_one({"id": room_id})
    room = _require_room_available(db, room)
    if not room["allowGuests"]:
        raise api_error(403, "GUEST_ACCESS_DISABLED", "Guest access is not allowed")
    _assert_invite(request, room, str(body.get("inviteToken", "")))
    _assert_password(room, body.get("password"))
    if db.call_participants.count_documents(
        {"roomId": room_id, "state": {"$in": ["APPROVED", "JOINED"]}}
    ) >= room["maxParticipants"]:
        raise HTTPException(status_code=409, detail="Room is full")
    guest_token = secrets.token_urlsafe(32)
    now = utc_now()
    participant = {
        "id": str(uuid.uuid4()),
        "roomId": room_id,
        "userId": None,
        "guestName": str(body.get("guestName", "")).strip()[:80],
        "guestTokenHash": hashlib.sha256(guest_token.encode()).hexdigest(),
        "role": "PARTICIPANT",
        "state": "WAITING" if room["waitingRoom"] else "APPROVED",
        "aiDisclosure": False,
        "createdAt": now,
        "updatedAt": now,
    }
    if not participant["guestName"]:
        raise HTTPException(status_code=422, detail="Guest name is required")
    db.call_participants.insert_one(participant)
    return {
        "participantId": participant["id"],
        "guestToken": guest_token,
        "state": participant["state"],
    }


@router.post("/rooms/{room_id}/join-user")
def user_join(
    room_id: str,
    body: dict,
    request: Request,
    user: dict = Depends(current_user),
) -> dict:
    db = request.app.state.db
    room = _require_room_available(db, db.call_rooms.find_one({"id": room_id}))
    _assert_invite(request, room, str(body.get("inviteToken", "")))
    _assert_password(room, body.get("password"))
    _assert_not_blocked(db, room["hostId"], user["id"])
    participant = db.call_participants.find_one({"roomId": room_id, "userId": user["id"]})
    state = "APPROVED" if room["hostId"] == user["id"] or not room["waitingRoom"] else "WAITING"
    now = utc_now()
    if (
        state == "APPROVED"
        and (not participant or participant.get("state") not in {"APPROVED", "JOINED"})
        and db.call_participants.count_documents(
            {"roomId": room_id, "state": {"$in": ["APPROVED", "JOINED"]}}
        )
        >= room["maxParticipants"]
    ):
        raise HTTPException(status_code=409, detail="Room is full")
    if participant:
        db.call_participants.update_one(
            {"id": participant["id"]}, {"$set": {"state": state, "updatedAt": now}}
        )
    else:
        participant = {
            "id": str(uuid.uuid4()),
            "roomId": room_id,
            "userId": user["id"],
            "role": "HOST" if room["hostId"] == user["id"] else "PARTICIPANT",
            "state": state,
            "aiDisclosure": False,
            "createdAt": now,
            "updatedAt": now,
        }
        db.call_participants.insert_one(participant)
    return {"participantId": participant["id"], "state": state}


@router.get("/rooms/{room_id}/waiting")
def waiting_room(
    room_id: str, request: Request, user: dict = Depends(current_user)
) -> list[dict]:
    room = request.app.state.db.call_rooms.find_one({"id": room_id, "hostId": user["id"]})
    if not room:
        raise HTTPException(status_code=403, detail="Only the host can manage waiting participants")
    records = request.app.state.db.call_participants.find(
        {"roomId": room_id, "state": {"$in": ["WAITING", "APPROVED", "JOINED"]}}
    ).sort("createdAt", 1)
    return [_participant_payload(request.app.state.db, item) for item in records]


@router.post("/rooms/{room_id}/{decision}/{participant_id}")
def decide_participant(
    room_id: str,
    decision: str,
    participant_id: str,
    request: Request,
    user: dict = Depends(current_user),
) -> dict:
    room = request.app.state.db.call_rooms.find_one({"id": room_id, "hostId": user["id"]})
    if not room:
        raise HTTPException(status_code=403, detail="Only the host can manage participants")
    participant = request.app.state.db.call_participants.find_one(
        {"id": participant_id, "roomId": room_id}
    )
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")
    if decision not in {"approve", "reject"}:
        raise HTTPException(status_code=404, detail="Unknown participant decision")
    if (
        decision == "approve"
        and participant["state"] not in {"APPROVED", "JOINED"}
        and request.app.state.db.call_participants.count_documents(
            {"roomId": room_id, "state": {"$in": ["APPROVED", "JOINED"]}}
        )
        >= room["maxParticipants"]
    ):
        raise HTTPException(status_code=409, detail="Room is full")
    state = "APPROVED" if decision == "approve" else "REJECTED"
    request.app.state.db.call_participants.update_one(
        {"id": participant_id}, {"$set": {"state": state, "updatedAt": utc_now()}}
    )
    return {"id": participant_id, "state": state}


def _livekit_token(request: Request, room: dict, participant: dict, identity: str) -> dict:
    config = _require_livekit(request)
    now = int(time.time())
    try:
        token = jwt.encode(
            {
                "iss": config["apiKey"],
                "sub": identity,
                "name": participant.get("guestName") or identity,
                "nbf": now - 5,
                "exp": now + 3600,
                "video": {
                    "roomJoin": True,
                    "room": room["id"],
                    "canPublish": True,
                    "canSubscribe": True,
                },
                "metadata": json.dumps(
                    {
                        "role": participant["role"],
                        "aiFaceActive": False,
                        "disclosureRequired": True,
                    },
                    separators=(",", ":"),
                ),
            },
            config["apiSecret"],
            algorithm="HS256",
        )
    except Exception as error:
        raise api_error(
            502,
            "TOKEN_GENERATION_FAILED",
            "LiveKit token generation failed. Recheck the API key and API secret.",
        ) from error
    return {"token": token, "url": config["url"], "identity": identity}


@router.post("/rooms/{room_id}/token")
def user_token(
    room_id: str, request: Request, user: dict = Depends(current_user)
) -> dict:
    db = request.app.state.db
    room = _require_room_available(db, db.call_rooms.find_one({"id": room_id}))
    _assert_not_blocked(db, room["hostId"], user["id"])
    participant = db.call_participants.find_one(
        {"roomId": room_id, "userId": user["id"], "state": {"$in": ["APPROVED", "JOINED"]}}
    )
    if not participant:
        raise api_error(
            403,
            "PARTICIPANT_NOT_APPROVED",
            "Participant is not approved to join this call",
        )
    token_payload = _livekit_token(
        request, room, participant, f"user-{user['id']}"
    )
    now = utc_now()
    db.call_participants.update_one(
        {"id": participant["id"]},
        {"$set": {"state": "JOINED", "joinedAt": participant.get("joinedAt") or now, "updatedAt": now}},
    )
    if not room.get("startedAt"):
        db.call_rooms.update_one(
            {"id": room_id}, {"$set": {"status": "ACTIVE", "startedAt": now, "updatedAt": now}}
        )
    return token_payload


@router.post("/rooms/{room_id}/guest-token")
def guest_token(room_id: str, body: dict, request: Request) -> dict:
    db = request.app.state.db
    participant = db.call_participants.find_one(
        {
            "id": body.get("participantId"),
            "roomId": room_id,
            "state": {"$in": ["APPROVED", "JOINED"]},
            "guestTokenHash": hashlib.sha256(
                str(body.get("guestToken", "")).encode()
            ).hexdigest(),
        }
    )
    room = _require_room_available(db, db.call_rooms.find_one({"id": room_id}))
    if not participant:
        raise api_error(
            403,
            "PARTICIPANT_NOT_APPROVED",
            "Guest is not approved to join this call",
        )
    token_payload = _livekit_token(
        request, room, participant, f"guest-{participant['id']}"
    )
    now = utc_now()
    db.call_participants.update_one(
        {"id": participant["id"]},
        {"$set": {"state": "JOINED", "joinedAt": participant.get("joinedAt") or now, "updatedAt": now}},
    )
    if not room.get("startedAt"):
        db.call_rooms.update_one(
            {"id": room_id},
            {
                "$set": {
                    "status": "ACTIVE",
                    "startedAt": now,
                    "updatedAt": now,
                }
            },
        )
    return token_payload


@router.post("/rooms/{room_id}/end")
def end_room(
    room_id: str, request: Request, user: dict = Depends(current_user)
) -> dict:
    db = request.app.state.db
    room = db.call_rooms.find_one({"id": room_id, "hostId": user["id"]})
    if not room:
        raise HTTPException(status_code=403, detail="Only the host can end this room")
    now = utc_now()
    db.call_rooms.update_one(
        {"id": room_id}, {"$set": {"status": "ENDED", "endedAt": now, "updatedAt": now}}
    )
    db.call_history.update_one(
        {"roomId": room_id},
        {
            "$setOnInsert": {
                "id": str(uuid.uuid4()),
                "roomId": room_id,
                "startedAt": room.get("startedAt") or room["createdAt"],
                "endedAt": now,
                "participantCount": db.call_participants.count_documents({"roomId": room_id}),
                "aiMilliseconds": sum(
                    item.get("billableMilliseconds", 0)
                    for item in db.usage_minutes.find({"roomId": room_id, "mode": "AI_FACE"})
                ),
                "terminationReason": "HOST_ENDED",
                "createdAt": now,
            }
        },
        upsert=True,
    )
    return {"ended": True}


@router.get("/calls/rooms")
def user_rooms(request: Request, user: dict = Depends(current_user)) -> list[dict]:
    db = request.app.state.db
    room_ids = [
        item["roomId"]
        for item in db.call_participants.find({"userId": user["id"]}, {"roomId": 1})
    ]
    rooms = db.call_rooms.find(
        {"$or": [{"hostId": user["id"]}, {"id": {"$in": room_ids}}]}
    ).sort("createdAt", -1)
    return [_room_payload(request, room, user["id"]) for room in rooms]


@router.get("/calls/history")
def call_history(request: Request, user: dict = Depends(current_user)) -> list[dict]:
    return user_rooms(request, user)


def _assert_password(room: dict, provided) -> None:
    if not room.get("passwordHash"):
        return
    try:
        valid = bool(provided) and PASSWORDS.verify(
            room["passwordHash"], str(provided)
        )
    except Exception:
        valid = False
    if not valid:
        raise api_error(
            403,
            "ROOM_PASSWORD_INCORRECT",
            "Room password is incorrect",
        )


def _assert_not_blocked(db, host_id: str, participant_user_id: str) -> None:
    if host_id == participant_user_id:
        return
    blocked = db.blocked_users.find_one(
        {
            "$or": [
                {"blockerId": host_id, "blockedId": participant_user_id},
                {"blockerId": participant_user_id, "blockedId": host_id},
            ]
        }
    )
    if blocked:
        raise api_error(
            403,
            "USER_BLOCKED",
            "This call is unavailable because one of the users is blocked",
        )

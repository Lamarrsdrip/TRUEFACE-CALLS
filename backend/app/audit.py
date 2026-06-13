from __future__ import annotations

import uuid

from .serializers import utc_now


def audit(
    db,
    action: str,
    target_type: str,
    actor_user_id: str | None = None,
    actor_admin_id: str | None = None,
    target_id: str | None = None,
    before: dict | None = None,
    after: dict | None = None,
) -> None:
    db.audit_logs.insert_one(
        {
            "id": str(uuid.uuid4()),
            "actorUserId": actor_user_id,
            "actorAdminId": actor_admin_id,
            "action": action,
            "targetType": target_type,
            "targetId": target_id,
            "beforeRedacted": before,
            "afterRedacted": after,
            "requestId": str(uuid.uuid4()),
            "createdAt": utc_now(),
        }
    )

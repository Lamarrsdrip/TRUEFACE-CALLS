from __future__ import annotations

from gridfs import GridFS


def purge_face_profile_data(db, profile: dict) -> None:
    images = list(
        db.face_profile_images.find({"faceProfileId": profile["id"]})
    )
    object_keys = {
        str(image.get("objectKey", ""))
        for image in images
        if image.get("objectKey")
    }
    if profile.get("objectKey"):
        object_keys.add(str(profile["objectKey"]))

    fs = GridFS(db, collection="uploads")
    for object_key in object_keys:
        item = db.uploads.files.find_one({"filename": object_key})
        if item:
            fs.delete(item["_id"])

    db.face_profile_images.delete_many({"faceProfileId": profile["id"]})

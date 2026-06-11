# Face Profile System

Every profile requires ownership/permission, face-use consent, and acceptance
of the face terms. Consent records include policy versions, timestamp, hashed
network context, and user agent.

A profile supports plan-limited private images with roles:

- front
- left angle
- right angle
- alternate lighting
- alternate expression

Each image is analyzed for resolution, exactly one detected face, sharpness,
lighting, and face coverage before upload is accepted. A front image is
mandatory. Profile readiness combines average image quality, angle diversity,
and image count into Poor, Fair, Good, or Excellent.

Objects are never public. The app uses short-lived signed S3 URLs. Deletion
removes every object, revokes active consent, marks the profile deleted, and
preserves only the minimum audit record.

Current browser processing activates the front image. The additional images
improve readiness and prepare the data contract for a future consented
multi-view GPU model; they are not presented as completed model training.

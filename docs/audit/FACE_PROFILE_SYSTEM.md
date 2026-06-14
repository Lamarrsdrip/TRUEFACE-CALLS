# Face Profile System

Every profile requires three explicit confirmations: ownership/permission,
consent to face use, and acceptance of face terms.

Plans limit profiles and images. Images support front, side, lighting and
expression roles. The browser checks one clear face, resolution, sharpness,
lighting and face coverage. A front image is mandatory and the profile gets a
Poor/Fair/Good/Excellent readiness score.

Security controls:

- uploads are private, MIME-bound, signed for 15 minutes and single-use
- profile creation verifies the object exists and belongs to the user
- one upload cannot be reused across profiles
- downloads use short-lived signed URLs and `nosniff`
- moderation approval is required before activation
- deletion removes GridFS bytes, image metadata and active consent
- account deletion immediately purges biometric files

Quality analysis is a browser precheck and can be tampered with. Administrator
moderation remains the trusted review boundary. Additional photos are not
currently used to train a model; they prepare the profile for a future
consented multi-view GPU adapter.

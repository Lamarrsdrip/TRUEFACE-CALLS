export function assertFaceProfileCanActivate(profile: {
  moderationStatus: string;
  deletedAt: Date | null;
  consentRevokedAt: Date | null;
  consent: {
    ownsOrHasPermission: boolean;
    consentsToFaceUse: boolean;
    acceptsFaceTerms: boolean;
  } | null;
}): void {
  if (profile.deletedAt) {
    throw new Error("Face profile has been deleted");
  }
  if (profile.moderationStatus !== "APPROVED") {
    throw new Error("Face profile must be approved before activation");
  }
  if (
    profile.consentRevokedAt ||
    !profile.consent ||
    !profile.consent.ownsOrHasPermission ||
    !profile.consent.consentsToFaceUse ||
    !profile.consent.acceptsFaceTerms
  ) {
    throw new Error("Active face consent is required");
  }
}

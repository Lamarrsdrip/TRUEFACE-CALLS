export interface JoinButtonState {
  busy: boolean;
  allowGuests: boolean;
  isHostIntent: boolean;
  guestName: string;
}

export function isJoinButtonDisabled(input: JoinButtonState) {
  if (input.busy) return true;
  if (input.isHostIntent) return false;
  return input.allowGuests && !input.guestName.trim();
}

export function shouldShowGuestNameField(input: {
  allowGuests: boolean;
  isHostIntent: boolean;
}) {
  return input.allowGuests && !input.isHostIntent;
}

export function getJoinButtonLabel(input: {
  isHostIntent: boolean;
  busy: boolean;
}) {
  if (input.busy) return "Connecting";
  return input.isHostIntent ? "Enter host room" : "Ask to join";
}

export function shouldShowHostControls(input: { localRole: string | null }) {
  return input.localRole === "HOST";
}

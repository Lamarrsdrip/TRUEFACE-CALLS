export type ProcessingMode = "browser" | "cloud" | "hybrid";

export function processingStatus(
  mode: ProcessingMode,
  cloudRealtimeAvailable: boolean,
  cloudPhotorealistic = false,
) {
  if (mode === "cloud") {
    return cloudRealtimeAvailable
      ? {
          label: "Cloud AI face swap",
          available: true,
          photorealistic: cloudPhotorealistic,
        }
      : {
          label: "Unavailable / provider not configured",
          available: false,
          photorealistic: false,
        };
  }
  return {
    label: "Local enhanced face mask",
    available: true,
    photorealistic: false,
  };
}

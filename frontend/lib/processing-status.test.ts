import { describe, expect, it } from "vitest";
import { processingStatus } from "./processing-status";

describe("processing status labels", () => {
  it("describes browser processing without promising photorealistic swap", () => {
    expect(processingStatus("browser", true)).toEqual({
      label: "Local enhanced face mask",
      available: true,
      photorealistic: false,
    });
  });

  it("only describes cloud face swap as available when capability is verified", () => {
    expect(processingStatus("cloud", false).label).toBe(
      "Unavailable / provider not configured",
    );
    expect(processingStatus("cloud", true).label).toBe("Cloud AI face swap");
  });
});

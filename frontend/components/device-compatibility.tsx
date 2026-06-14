"use client";

import { Cpu, LoaderCircle, Smartphone } from "lucide-react";
import { useState } from "react";
import { inspectDevice, type DeviceRating } from "../lib/device-capabilities";

const recommendations = [
  {
    plan: "Basic",
    phones:
      "iPhone XR/XS or newer, iPhone SE (2nd gen)+, Galaxy S10+, Pixel 4+, Snapdragon 855 or Dimensity 1000+.",
    quality: "Expected: 480p-720p local enhanced mask for testing and casual use.",
  },
  {
    plan: "Standard",
    phones:
      "iPhone 12+, Galaxy S21+, Pixel 6+, Snapdragon 865/870/888 or 7 Gen 1+.",
    quality: "Expected: smoother 720p with better tracking and local blending.",
  },
  {
    plan: "Pro",
    phones:
      "iPhone 14 Pro/15/16+, Galaxy S23/S24/S25, Pixel 8/9, Snapdragon 8 Gen 2/3/Elite+.",
    quality: "Expected: best available realtime FPS and stability.",
  },
];

export function DeviceCompatibility() {
  const [rating, setRating] = useState<DeviceRating | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function runCheck(camera: boolean) {
    setBusy(true);
    try {
      const result = await inspectDevice(camera);
      setRating(result.rating);
      setWarnings(result.warnings);
    } catch (error) {
      setWarnings([
        error instanceof Error
          ? error.message
          : "The camera capability check could not run.",
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="device-guide">
      <div className="device-guide-heading">
        <Smartphone />
        <div>
          <h2>Recommended phones for best video quality</h2>
          <p>These are practical recommendations, not hard device blocks.</p>
        </div>
      </div>
      <div className="device-guide-grid">
        {recommendations.map((item) => (
          <article key={item.plan}>
            <strong>{item.plan}</strong>
            <p>{item.phones}</p>
            <small>{item.quality}</small>
          </article>
        ))}
      </div>
      <div className="device-check">
        <Cpu />
        <div>
          <strong>{rating ? `Device result: ${rating}` : "Check this device"}</strong>
          <p>
            Tests browser graphics, CPU hints and short FPS. Camera resolution is
            checked only when you approve camera access.
          </p>
          {warnings.map((warning) => <small key={warning}>{warning}</small>)}
        </div>
        <button
          className="button button-secondary"
          onClick={() => void runCheck(false)}
          disabled={busy}
        >
          {busy ? <LoaderCircle className="spin" /> : null} Quick check
        </button>
        <button
          className="button button-ghost"
          onClick={() => void runCheck(true)}
          disabled={busy}
        >
          Include camera
        </button>
      </div>
    </section>
  );
}

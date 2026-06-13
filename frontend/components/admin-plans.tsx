"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { useApiResource } from "../hooks/use-api-resource";
import { apiFetch, jsonBody } from "../lib/api";
import { ErrorState, LoadingState, PageHeader, StatusBadge } from "./ui";

interface PlanRecord {
  id: string;
  key: string;
  name: string;
  description: string;
  priceMonthlyMinor: number;
  monthlyCredits: number;
  maxFaceProfiles: number;
  maxImagesPerProfile: number;
  maxParticipants: number;
  maxCallMinutes: number;
  maxGroupCalls: number;
  allowedQualities: Array<"LOW" | "STANDARD" | "HD">;
  watermarkRequired: boolean;
  creditTopupsAllowed: boolean;
  creditResetDays: number;
  groupCalls: boolean;
  voiceEffects: boolean;
  cloudGpu: boolean;
  enabled: boolean;
}

export function AdminPlans() {
  const plans = useApiResource<PlanRecord[]>("/admin/plans");
  const [message, setMessage] = useState<string | null>(null);

  async function save(event: React.FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await apiFetch(`/admin/plans/${id}`, {
      method: "PUT",
      ...jsonBody({
        name: String(form.get("name")),
        description: String(form.get("description")),
        priceMonthlyMinor: Math.round(Number(form.get("price")) * 100),
        monthlyCredits: Math.round(Number(form.get("credits")) * 1000),
        maxFaceProfiles: Number(form.get("faces")),
        maxImagesPerProfile: Number(form.get("imagesPerFace")),
        maxParticipants: Number(form.get("participants")),
        maxCallMinutes: Number(form.get("callMinutes")),
        maxGroupCalls: Number(form.get("groupCallsLimit")),
        allowedQualities: ["LOW", "STANDARD", "HD"].filter(
          (quality) => form.get(`quality-${quality}`) === "on",
        ),
        watermarkRequired: form.get("watermarkRequired") === "on",
        creditTopupsAllowed: form.get("creditTopupsAllowed") === "on",
        creditResetDays: Number(form.get("creditResetDays")),
        groupCalls: form.get("groupCalls") === "on",
        voiceEffects: form.get("voiceEffects") === "on",
        cloudGpu: form.get("cloudGpu") === "on",
        enabled: form.get("enabled") === "on",
      }),
    });
    setMessage("Plan pricing and entitlements saved.");
    await plans.refresh();
  }

  return (
    <>
      <PageHeader
        title="Plans and limits"
        description="Configure pricing, included credits, profile caps, quality features, and group access."
      />
      {message ? <div className="notice notice-info">{message}</div> : null}
      {plans.loading ? <LoadingState /> : null}
      {plans.error ? <ErrorState message={plans.error} /> : null}
      <div className="admin-plan-grid">
        {plans.data?.map((plan) => (
          <form
            className="panel admin-plan-card"
            key={plan.id}
            onSubmit={(event) => void save(event, plan.id)}
          >
            <div className="flex items-center justify-between">
              <StatusBadge tone={plan.enabled ? "success" : "neutral"}>
                {plan.key}
              </StatusBadge>
              <label className="toggle-label">
                <input
                  name="enabled"
                  type="checkbox"
                  defaultChecked={plan.enabled}
                />{" "}
                Enabled
              </label>
            </div>
            <div className="field">
              <label>Name</label>
              <input name="name" defaultValue={plan.name} required />
            </div>
            <div className="field">
              <label>Description</label>
              <textarea
                name="description"
                defaultValue={plan.description}
                required
              />
            </div>
            <div className="form-two">
              <div className="field">
                <label>Monthly price</label>
                <input
                  name="price"
                  type="number"
                  step="0.01"
                  defaultValue={plan.priceMonthlyMinor / 100}
                />
              </div>
              <div className="field">
                <label>Included credits</label>
                <input
                  name="credits"
                  type="number"
                  step="0.001"
                  defaultValue={plan.monthlyCredits / 1000}
                />
              </div>
              <div className="field">
                <label>Face profiles</label>
                <input
                  name="faces"
                  type="number"
                  defaultValue={plan.maxFaceProfiles}
                />
              </div>
              <div className="field">
                <label>Participants</label>
                <input
                  name="participants"
                  type="number"
                  defaultValue={plan.maxParticipants}
                />
              </div>
              <div className="field">
                <label>Images per profile</label>
                <input
                  name="imagesPerFace"
                  type="number"
                  min="1"
                  defaultValue={plan.maxImagesPerProfile}
                />
              </div>
              <div className="field">
                <label>Max call minutes</label>
                <input
                  name="callMinutes"
                  type="number"
                  min="1"
                  defaultValue={plan.maxCallMinutes}
                />
              </div>
              <div className="field">
                <label>Monthly group calls</label>
                <input
                  name="groupCallsLimit"
                  type="number"
                  min="0"
                  defaultValue={plan.maxGroupCalls}
                />
              </div>
              <div className="field">
                <label>Credit reset days</label>
                <input
                  name="creditResetDays"
                  type="number"
                  min="1"
                  defaultValue={plan.creditResetDays}
                />
              </div>
            </div>
            <div className="admin-checkboxes">
              {(["LOW", "STANDARD", "HD"] as const).map((quality) => (
                <label key={quality}>
                  <input
                    name={`quality-${quality}`}
                    type="checkbox"
                    defaultChecked={plan.allowedQualities.includes(quality)}
                  />{" "}
                  {quality} quality
                </label>
              ))}
              <label>
                <input
                  name="groupCalls"
                  type="checkbox"
                  defaultChecked={plan.groupCalls}
                />{" "}
                Group calls
              </label>
              <label>
                <input
                  name="voiceEffects"
                  type="checkbox"
                  defaultChecked={plan.voiceEffects}
                />{" "}
                Voice effects
              </label>
              <label>
                <input
                  name="cloudGpu"
                  type="checkbox"
                  defaultChecked={plan.cloudGpu}
                />{" "}
                Cloud GPU
              </label>
              <label>
                <input
                  name="watermarkRequired"
                  type="checkbox"
                  defaultChecked={plan.watermarkRequired}
                />{" "}
                AI watermark
              </label>
              <label>
                <input
                  name="creditTopupsAllowed"
                  type="checkbox"
                  defaultChecked={plan.creditTopupsAllowed}
                />{" "}
                Credit top-ups
              </label>
            </div>
            <button className="button button-primary">
              <Save size={16} /> Save plan
            </button>
          </form>
        ))}
      </div>
    </>
  );
}

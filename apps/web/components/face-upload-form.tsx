"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ImagePlus,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { apiFetch, jsonBody } from "../lib/api";
import {
  analyzeFaceImage,
  type FaceQualityAnalysis,
} from "../lib/face-quality";

interface QualityResponse {
  score: number;
  passed: boolean;
  checks: Record<string, boolean>;
}

export function FaceUploadForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<FaceQualityAnalysis | null>(null);
  const [quality, setQuality] = useState<QualityResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState([false, false, false]);
  const valid = Boolean(file && quality?.passed && consent.every(Boolean));

  const checks = useMemo(
    () =>
      quality
        ? [
            ["Good resolution", quality.checks.resolution],
            ["One visible face", quality.checks.singleFace],
            ["Image is sharp", quality.checks.sharpness],
            ["Lighting is usable", quality.checks.lighting],
            ["Face is centered", quality.checks.faceCoverage],
          ]
        : [],
    [quality],
  );

  async function chooseFile(next: File | undefined) {
    if (!next) return;
    setBusy(true);
    setError(null);
    setFile(next);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(next));
    try {
      const nextAnalysis = await analyzeFaceImage(next);
      setAnalysis(nextAnalysis);
      setQuality(
        await apiFetch<QualityResponse>("/faces/quality-check", {
          method: "POST",
          ...jsonBody(nextAnalysis),
        }),
      );
    } catch (value) {
      setQuality(null);
      setError(
        value instanceof Error
          ? value.message
          : "Image quality analysis failed",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || !file || !analysis) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const upload = await apiFetch<{
        objectKey: string;
        url: string;
        headers: Record<string, string>;
      }>("/faces/upload-url", {
        method: "POST",
        ...jsonBody({
          contentType: file.type,
          sizeBytes: file.size,
        }),
      });
      const uploadResponse = await fetch(upload.url, {
        method: "PUT",
        headers: upload.headers,
        body: file,
      });
      if (!uploadResponse.ok) {
        throw new Error("Private image upload failed");
      }
      await apiFetch("/faces", {
        method: "POST",
        ...jsonBody({
          name: form.get("name"),
          objectKey: upload.objectKey,
          mimeType: file.type,
          sizeBytes: file.size,
          width: analysis.width,
          height: analysis.height,
          quality: analysis,
          consent: {
            ownsOrHasPermission: true,
            consentsToFaceUse: true,
            acceptsFaceTerms: true,
            termsVersion: "2026-06-11",
          },
        }),
      });
      router.push("/faces");
      router.refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Profile save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="face-upload-layout" onSubmit={submit}>
      <section className="panel">
        <div className="upload-preview">
          {preview ? (
            // User-selected local object URL is intentionally rendered directly.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Selected face preview" />
          ) : (
            <div>
              <ImagePlus size={34} />
              <strong>Choose a clear face photo</strong>
              <span>JPEG, PNG, or WebP up to 10 MB</span>
            </div>
          )}
          <label className="button button-secondary">
            {preview ? "Choose another" : "Choose photo"}
            <input
              hidden
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => void chooseFile(event.target.files?.[0])}
            />
          </label>
        </div>
      </section>
      <section className="panel form-grid">
        <div>
          <h2 className="text-xl font-semibold">Quality and consent</h2>
          <p className="mt-1 text-sm text-slate-500">
            Your image remains private and is used only for the profile you
            create.
          </p>
        </div>
        {busy && !quality ? (
          <div className="state-message !min-h-24">
            <LoaderCircle className="spin" size={20} />
            Running on-device face quality checks
          </div>
        ) : null}
        {error ? <div className="notice notice-danger">{error}</div> : null}
        {quality ? (
          <div className="quality-list">
            <div className="quality-score">
              <span>Quality score</span>
              <b>{quality.score}/100</b>
            </div>
            {checks.map(([label, passed]) => (
              <div key={String(label)}>
                {passed ? (
                  <CheckCircle2 size={17} />
                ) : (
                  <AlertTriangle size={17} />
                )}
                <span>{label}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="name">Profile name</label>
          <input id="name" name="name" placeholder="My call profile" required />
        </div>
        {[
          "I confirm this image is mine or I have permission to use it.",
          "I consent to using this image for AI face mode in my calls.",
          "I accept the Face Usage Terms and Privacy Policy.",
        ].map((label, index) => (
          <label className="checkbox-row" key={label}>
            <input
              type="checkbox"
              checked={consent[index]}
              onChange={(event) =>
                setConsent((current) =>
                  current.map((value, itemIndex) =>
                    itemIndex === index ? event.target.checked : value,
                  ),
                )
              }
            />
            <span>{label}</span>
          </label>
        ))}
        <div className="notice notice-info">
          <ShieldCheck size={18} />
          Deleting this profile removes the private object and revokes all
          active consent records.
        </div>
        <button className="button button-primary" disabled={!valid || busy}>
          {busy ? <LoaderCircle className="spin" size={17} /> : null}
          Save face profile
        </button>
      </section>
    </form>
  );
}

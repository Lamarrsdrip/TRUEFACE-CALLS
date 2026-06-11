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
  const [images, setImages] = useState<
    Array<{
      file: File;
      preview: string;
      role: "FRONT" | "LEFT" | "RIGHT" | "LIGHTING" | "EXPRESSION";
      analysis: FaceQualityAnalysis;
      quality: QualityResponse;
    }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState([false, false, false]);
  const valid = Boolean(
    images.length &&
    images.some((image) => image.role === "FRONT") &&
    images.every((image) => image.quality.passed) &&
    consent.every(Boolean),
  );

  const checks = useMemo(
    () =>
      images[0]?.quality
        ? [
            ["Good resolution", images[0].quality.checks.resolution],
            ["One visible face", images[0].quality.checks.singleFace],
            ["Image is sharp", images[0].quality.checks.sharpness],
            ["Lighting is usable", images[0].quality.checks.lighting],
            ["Face is centered", images[0].quality.checks.faceCoverage],
          ]
        : [],
    [images],
  );

  async function chooseFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      images.forEach((image) => URL.revokeObjectURL(image.preview));
      const roleOrder = [
        "FRONT",
        "LEFT",
        "RIGHT",
        "LIGHTING",
        "EXPRESSION",
      ] as const;
      const selected = await Promise.all(
        Array.from(files)
          .slice(0, 10)
          .map(async (file, index) => {
            const analysis = await analyzeFaceImage(file);
            const quality = await apiFetch<QualityResponse>(
              "/faces/quality-check",
              {
                method: "POST",
                ...jsonBody(analysis),
              },
            );
            return {
              file,
              preview: URL.createObjectURL(file),
              role: roleOrder[Math.min(index, roleOrder.length - 1)]!,
              analysis,
              quality,
            };
          }),
      );
      setImages(selected);
    } catch (value) {
      setImages([]);
      setError(
        value instanceof Error
          ? value.message
          : "Image quality analysis failed",
      );
    } finally {
      setBusy(false);
    }
  }

  function setRole(
    index: number,
    role: "FRONT" | "LEFT" | "RIGHT" | "LIGHTING" | "EXPRESSION",
  ) {
    setImages((current) =>
      current.map((image, itemIndex) =>
        itemIndex === index ? { ...image, role } : image,
      ),
    );
  }

  async function uploadImage(image: (typeof images)[number]) {
    const upload = await apiFetch<{
      objectKey: string;
      url: string;
      headers: Record<string, string>;
    }>("/faces/upload-url", {
      method: "POST",
      ...jsonBody({
        contentType: image.file.type,
        sizeBytes: image.file.size,
      }),
    });
    const response = await fetch(upload.url, {
      method: "PUT",
      headers: upload.headers,
      body: image.file,
    });
    if (!response.ok) throw new Error("Private image upload failed");
    return {
      objectKey: upload.objectKey,
      role: image.role,
      mimeType: image.file.type,
      sizeBytes: image.file.size,
      width: image.analysis.width,
      height: image.analysis.height,
      quality: image.analysis,
    };
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const uploaded = await Promise.all(images.map(uploadImage));
      const primary =
        uploaded.find((image) => image.role === "FRONT") ?? uploaded[0]!;
      await apiFetch("/faces", {
        method: "POST",
        ...jsonBody({
          name: form.get("name"),
          objectKey: primary.objectKey,
          mimeType: primary.mimeType,
          sizeBytes: primary.sizeBytes,
          width: primary.width,
          height: primary.height,
          quality: primary.quality,
          images: uploaded,
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
          {images.length ? (
            <div className="face-upload-gallery">
              {images.map((image, index) => (
                <div key={`${image.file.name}-${index}`}>
                  {/* User-selected local object URL. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.preview} alt={`${image.role} preview`} />
                  <select
                    value={image.role}
                    onChange={(event) =>
                      setRole(index, event.target.value as typeof image.role)
                    }
                  >
                    <option value="FRONT">Front</option>
                    <option value="LEFT">Left angle</option>
                    <option value="RIGHT">Right angle</option>
                    <option value="LIGHTING">Different lighting</option>
                    <option value="EXPRESSION">Expression</option>
                  </select>
                  <span>{image.quality.score}/100</span>
                </div>
              ))}
            </div>
          ) : (
            <div>
              <ImagePlus size={34} />
              <strong>Choose clear face photos</strong>
              <span>Upload 3-5 angles for stronger replacement quality</span>
            </div>
          )}
          <label className="button button-secondary">
            {images.length ? "Replace selection" : "Choose photos"}
            <input
              hidden
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => void chooseFiles(event.target.files)}
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
        {busy && !images.length ? (
          <div className="state-message !min-h-24">
            <LoaderCircle className="spin" size={20} />
            Running on-device face quality checks
          </div>
        ) : null}
        {error ? <div className="notice notice-danger">{error}</div> : null}
        {images.length ? (
          <div className="quality-list">
            <div className="quality-score">
              <span>Front image score</span>
              <b>{images[0]?.quality.score}/100</b>
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
        <div className="notice notice-info">
          Upload a front-facing photo, slight left and right angles, neutral or
          smiling expressions, and good lighting. Bad images are rejected
          instead of silently lowering profile quality.
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

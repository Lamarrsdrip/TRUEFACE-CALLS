"use client";

import {
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useChat,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import {
  ConnectionQuality,
  LocalAudioTrack,
  LocalVideoTrack,
  RoomEvent,
  Track,
  type TrackPublishOptions,
} from "livekit-client";
import {
  Camera,
  CameraOff,
  CheckCircle2,
  Copy,
  LoaderCircle,
  MessageCircle,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  ShieldCheck,
  Sparkles,
  Users,
  Waves,
  Wifi,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiFetch, jsonBody } from "../lib/api";
import { BrowserFaceSession } from "../lib/browser-face-session";
import { CloudFaceSession, cloudFrameProfile } from "../lib/cloud-face-session";
import {
  BrowserVoiceSession,
  browserVoiceSupport,
  type VoicePreference,
} from "../lib/browser-voice-session";
import { processingStatus } from "../lib/processing-status";
import { replacePublishedTrack } from "../lib/media-engine";
import {
  getJoinButtonLabel,
  isJoinButtonDisabled,
  shouldShowGuestNameField,
  shouldShowHostControls,
} from "../lib/call-room-policy";
import { creditsFromMilli } from "../lib/format";

interface RoomInfo {
  id: string;
  title: string;
  waitingRoom: boolean;
  allowGuests: boolean;
  passwordRequired: boolean;
  participantCount: number;
  inviteUrl: string;
  hostUrl: string;
}

interface JoinCredentials {
  url: string;
  token: string;
}

interface FaceProfile {
  id: string;
  name: string;
  moderationStatus: string;
}

interface WaitingParticipant {
  id: string;
  guestName: string | null;
  createdAt: string;
  user: { displayName: string | null; avatarUrl: string | null } | null;
}

interface AccountSession {
  voicePreference: VoicePreference;
  faceFeaturesDisabled: boolean;
  voiceFeaturesDisabled: boolean;
  entitlements: {
    voiceEffects: boolean;
    allowedQualities: string[];
  };
}

interface FaceProcessingSession {
  stop(): void;
}

function processedVideoPublishOptions(
  quality: "low" | "standard" | "hd",
  name: string,
): TrackPublishOptions {
  const profile = cloudFrameProfile(quality);
  return {
    source: Track.Source.Camera,
    name,
    stream: "trueface-camera",
    simulcast: false,
    degradationPreference: "maintain-resolution",
    videoEncoding: {
      maxBitrate: {
        low: 1_200_000,
        standard: 2_500_000,
        hd: 4_500_000,
      }[quality],
      maxFramerate: profile.outputFps,
    },
  };
}

export function CallRoomClient({ slug }: { slug: string }) {
  const search = useSearchParams();
  const router = useRouter();
  const invite = search.get("invite") ?? "";
  const hostIntent = search.get("host") === "1";
  const previewRef = useRef<HTMLVideoElement>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);
  const attemptedHostJoin = useRef(false);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [credentials, setCredentials] = useState<JoinCredentials | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [cameraOn, setCameraOn] = useState(true);
  const [microphoneOn, setMicrophoneOn] = useState(true);
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionFailure, setConnectionFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!invite) {
      setError("This call link is missing its signed invite.");
      setBusy(false);
      return;
    }
    apiFetch<RoomInfo>(`/rooms/${slug}?invite=${encodeURIComponent(invite)}`)
      .then(setRoom)
      .catch((value) =>
        setError(value instanceof Error ? value.message : "Call link failed"),
      )
      .finally(() => setBusy(false));
  }, [invite, slug]);

  useEffect(() => {
    if (!room || credentials) return;
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        previewStreamRef.current = stream;
        if (previewRef.current) {
          previewRef.current.srcObject = stream;
        }
      })
      .catch(() =>
        setError("Camera and microphone permission is required for preflight."),
      );
    return () => {
      previewStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [room, credentials]);

  async function join() {
    if (!room) return;
    setBusy(true);
    setError(null);
    try {
      let authenticated = false;
      try {
        await apiFetch("/auth/session");
        authenticated = true;
      } catch {
        authenticated = false;
      }

      if (authenticated) {
        try {
          setCredentials(
            await apiFetch<JoinCredentials>(`/rooms/${room.id}/token`, {
              method: "POST",
              ...jsonBody({}),
            }),
          );
          return;
        } catch (tokenError) {
          if (hostIntent) {
            throw new Error(
              tokenError instanceof Error
                ? `Host access failed: ${tokenError.message}`
                : "Host access requires the signed-in room creator",
            );
          }
          const participant = await apiFetch<{ state: string }>(
            `/rooms/${room.id}/join-user`,
            {
              method: "POST",
              ...jsonBody({
                inviteToken: invite,
                password: password || undefined,
              }),
            },
          );
          if (participant.state === "WAITING") {
            setWaiting(true);
          }
          await pollAuthenticatedToken(room.id);
          return;
        }
      }

      if (hostIntent) {
        throw new Error("Sign in as the room creator to enter as host.");
      }

      const guest = await apiFetch<{
        participantId: string;
        guestToken: string;
        state: string;
      }>(`/rooms/${room.id}/join-request`, {
        method: "POST",
        ...jsonBody({
          inviteToken: invite,
          guestName: name,
          password: password || undefined,
        }),
      });
      if (guest.state === "WAITING") setWaiting(true);
      await pollGuestToken(room.id, guest.participantId, guest.guestToken);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Could not join call");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!room || !hostIntent || credentials || waiting) return;
    if (attemptedHostJoin.current) return;
    attemptedHostJoin.current = true;
    void join();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, hostIntent, credentials, waiting]);

  async function pollAuthenticatedToken(roomId: string) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        setCredentials(
          await apiFetch<JoinCredentials>(`/rooms/${roomId}/token`, {
            method: "POST",
            ...jsonBody({}),
          }),
        );
        return;
      } catch (value) {
        if (value instanceof ApiError && value.status !== 403 && value.status !== 409) {
          throw value;
        }
        await delay(2_500);
      }
    }
    throw new Error("Host approval timed out");
  }

  async function pollGuestToken(
    roomId: string,
    participantId: string,
    guestToken: string,
  ) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        setCredentials(
          await apiFetch<JoinCredentials>(`/rooms/${roomId}/guest-token`, {
            method: "POST",
            ...jsonBody({ participantId, guestToken }),
          }),
        );
        return;
      } catch (value) {
        if (value instanceof ApiError && value.status !== 403 && value.status !== 409) {
          throw value;
        }
        await delay(2_500);
      }
    }
    throw new Error("Host approval timed out");
  }

  if (busy && !room) {
    return (
      <div className="call-loading">
        <LoaderCircle className="spin" />
        Opening secure call
      </div>
    );
  }

  if (error && !room) {
    return (
      <div className="call-loading">
        <ShieldCheck size={30} />
        <h1>Call unavailable</h1>
        <p>{error}</p>
        <button
          className="button button-secondary"
          onClick={() => router.push("/")}
        >
          Return home
        </button>
      </div>
    );
  }

  if (connectionFailure && room) {
    return (
      <div className="call-loading">
        <ShieldCheck size={30} />
        <h1>Call connection failed</h1>
        <p>{connectionFailure}</p>
        <button className="button button-secondary" onClick={() => router.push("/calls")}>
          Return to calls
        </button>
      </div>
    );
  }

  if (credentials && room) {
    previewStreamRef.current?.getTracks().forEach((track) => track.stop());
    return (
      <LiveKitRoom
        token={credentials.token}
        serverUrl={credentials.url}
        connect
        audio={microphoneOn}
        video={cameraOn}
        className="call-root"
        onError={(value) =>
          setConnectionFailure(
            value instanceof Error
              ? `LiveKit connection failed: ${value.message}`
              : "LiveKit connection failed.",
          )
        }
        onDisconnected={() => router.push("/calls")}
      >
        <RoomExperience roomInfo={room} />
        <RoomAudioRenderer />
      </LiveKitRoom>
    );
  }

  return (
    <main className="preflight-page">
      <div className="preflight-card">
        <div className="preflight-copy">
          <ShieldCheck size={22} />
          <div>
            <h1>{room?.title}</h1>
            <p>
              {waiting
                ? "The host will let you in when they are ready."
                : "Check your camera and microphone before joining."}
            </p>
          </div>
        </div>
        <div className="preflight-video">
          <video ref={previewRef} autoPlay muted playsInline />
          <div className="preflight-controls">
            <button
              className={
                microphoneOn ? "round-control active" : "round-control"
              }
              onClick={() => {
                const next = !microphoneOn;
                setMicrophoneOn(next);
                previewStreamRef.current
                  ?.getAudioTracks()
                  .forEach((track) => (track.enabled = next));
              }}
            >
              {microphoneOn ? <Mic /> : <MicOff />}
            </button>
            <button
              className={cameraOn ? "round-control active" : "round-control"}
              onClick={() => {
                const next = !cameraOn;
                setCameraOn(next);
                previewStreamRef.current
                  ?.getVideoTracks()
                  .forEach((track) => (track.enabled = next));
              }}
            >
              {cameraOn ? <Camera /> : <CameraOff />}
            </button>
          </div>
        </div>
        {!waiting ? (
          <div className="form-grid">
            {shouldShowGuestNameField({
              allowGuests: Boolean(room?.allowGuests),
              isHostIntent: hostIntent,
            }) ? (
              <div className="field">
                <label htmlFor="guestName">Your name</label>
                <input
                  id="guestName"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Visible to the host"
                />
              </div>
            ) : null}
            {room?.passwordRequired ? (
              <div className="field">
                <label htmlFor="roomPassword">Room password</label>
                <input
                  id="roomPassword"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
            ) : null}
            <div className="preflight-policy">
              <p>
                <CheckCircle2 /> Camera and microphone stay under your control.
              </p>
              <p>
                <CheckCircle2 /> Local face masking is optional and visibly disclosed.
              </p>
              <p>
                <CheckCircle2 /> The host may need to approve your entry.
              </p>
            </div>
            {error ? <div className="notice notice-danger">{error}</div> : null}
            <button
              className="button button-primary"
              onClick={join}
              disabled={isJoinButtonDisabled({
                busy,
                allowGuests: Boolean(room?.allowGuests),
                isHostIntent: hostIntent,
                guestName: name,
              })}
            >
              {busy ? <LoaderCircle className="spin" size={17} /> : null}
              {getJoinButtonLabel({ isHostIntent: hostIntent, busy })}
            </button>
          </div>
        ) : (
          <div className="waiting-state">
            <LoaderCircle className="spin" size={26} />
            <strong>Waiting for host approval</strong>
            <span>You can keep this tab open.</span>
          </div>
        )}
      </div>
    </main>
  );
}

function RoomExperience({ roomInfo }: { roomInfo: RoomInfo }) {
  const room = useRoomContext();
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  const { chatMessages, send } = useChat();
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState("");
  const [mic, setMic] = useState(true);
  const [camera, setCamera] = useState(true);
  const [screen, setScreen] = useState(false);
  const [aiActive, setAiActive] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [trackingState, setTrackingState] = useState<
    "tracking" | "degraded" | "paused"
  >("tracking");
  const [faces, setFaces] = useState<FaceProfile[]>([]);
  const [selectedFace, setSelectedFace] = useState("");
  const [wallet, setWallet] = useState(0);
  const [accountAiAvailable, setAccountAiAvailable] = useState(false);
  const [accountVoiceAvailable, setAccountVoiceAvailable] = useState(false);
  const [voicePreference, setVoicePreference] =
    useState<VoicePreference>("ORIGINAL");
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [processingLabel, setProcessingLabel] = useState(
    processingStatus("browser", false).label,
  );
  const [quality, setQuality] = useState<"low" | "standard" | "hd">(
    typeof window !== "undefined" && window.innerWidth < 700
      ? "low"
      : "standard",
  );
  const [network, setNetwork] = useState("good");
  const [error, setError] = useState<string | null>(null);
  const [waitingParticipants, setWaitingParticipants] = useState<
    WaitingParticipant[]
  >([]);
  const [hostMessage, setHostMessage] = useState<string | null>(null);
  const aiSession = useRef<FaceProcessingSession | null>(null);
  const rawTrack = useRef<LocalVideoTrack | null>(null);
  const processedTrack = useRef<LocalVideoTrack | null>(null);
  const voiceSession = useRef<BrowserVoiceSession | null>(null);
  const rawAudioTrack = useRef<LocalAudioTrack | null>(null);
  const processedAudioTrack = useRef<LocalAudioTrack | null>(null);
  const meter = useRef({
    reservationId: "",
    remaining: 0,
    rate: 0,
    interval: 0 as ReturnType<typeof setInterval> | number,
    window: 0,
    settling: false,
  });
  const voiceMeter = useRef({
    reservationId: "",
    remaining: 0,
    rate: 0,
    interval: 0 as ReturnType<typeof setInterval> | number,
    window: 0,
    settling: false,
  });

  useEffect(() => {
    void apiFetch<AccountSession>("/auth/session")
      .then((account) =>
        Promise.all([
          apiFetch<FaceProfile[]>("/faces"),
          apiFetch<{ availableMilliCredits: number }>("/credits/wallet"),
          Promise.resolve(account),
        ]),
      )
      .then(([profiles, creditWallet, account]) => {
        const approved = profiles.filter(
          (profile) => profile.moderationStatus === "APPROVED",
        );
        setFaces(approved);
        setSelectedFace(approved[0]?.id ?? "");
        setWallet(creditWallet.availableMilliCredits);
        setAccountAiAvailable(!account.faceFeaturesDisabled);
        setAccountVoiceAvailable(
          !account.voiceFeaturesDisabled && account.entitlements.voiceEffects,
        );
        setVoicePreference(account.voicePreference);
      })
      .catch(() => {
        setAccountAiAvailable(false);
        setAccountVoiceAvailable(false);
      });
  }, []);

  useEffect(() => {
    const listener = (
      qualityValue: ConnectionQuality,
      participant: { identity: string },
    ) => {
      if (participant.identity === room.localParticipant.identity) {
        setNetwork(String(qualityValue).toLowerCase());
      }
    };
    room.on(RoomEvent.ConnectionQualityChanged, listener);
    return () => {
      room.off(RoomEvent.ConnectionQualityChanged, listener);
    };
  }, [room]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && (aiActive || voiceActive)) {
        setError(
          "Background tabs may pause camera or audio processing on mobile. Keep TrueFace visible for stable effects.",
        );
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    const batteryNavigator = navigator as Navigator & {
      getBattery?: () => Promise<{ level: number; charging: boolean }>;
    };
    void batteryNavigator.getBattery?.().then((battery) => {
      if (battery.level <= 0.15 && !battery.charging) {
        setError(
          "Low battery may reduce frame rate or trigger thermal throttling. Use Basic quality or connect a charger.",
        );
      }
    });
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [aiActive, voiceActive]);

  const metadata = parseParticipantMetadata(room.localParticipant.metadata);
  const isHost = shouldShowHostControls({
    localRole: typeof metadata.role === "string" ? metadata.role : null,
  });

  const refreshWaiting = useCallback(async () => {
    if (!isHost) return;
    setWaitingParticipants(
      await apiFetch<WaitingParticipant[]>(`/rooms/${roomInfo.id}/waiting`),
    );
  }, [isHost, roomInfo.id]);

  useEffect(() => {
    if (!isHost) return;
    void refreshWaiting();
    const interval = setInterval(() => void refreshWaiting(), 4_000);
    return () => clearInterval(interval);
  }, [isHost, refreshWaiting]);

  const disableAi = useCallback(async () => {
    if (
      !aiActive &&
      !processedTrack.current &&
      !rawTrack.current &&
      !meter.current.reservationId
    ) {
      return;
    }
    if (meter.current.interval) {
      clearInterval(meter.current.interval);
    }
    if (processedTrack.current) {
      await room.localParticipant.unpublishTrack(processedTrack.current, true);
      processedTrack.current = null;
    }
    aiSession.current?.stop();
    aiSession.current = null;
    await room.localParticipant.setMetadata(
      JSON.stringify({
        ...parseParticipantMetadata(room.localParticipant.metadata),
        aiFaceActive: false,
      }),
    );
    setAiActive(false);
    const currentCamera = room.localParticipant.getTrackPublication(
      Track.Source.Camera,
    )?.track;
    if (rawTrack.current && currentCamera !== rawTrack.current) {
      await room.localParticipant.publishTrack(rawTrack.current, {
        source: Track.Source.Camera,
      });
    }
    if (meter.current.reservationId) {
      const released = await apiFetch<{ amountMilli: number }>(
        "/credits/meter/release",
        {
          method: "POST",
          ...jsonBody({
            roomId: roomInfo.id,
            reservationId: meter.current.reservationId,
            idempotencyKey: `release:${roomInfo.id}:${Date.now()}`,
          }),
        },
      );
      setWallet((value) => value + Math.max(0, released.amountMilli));
    }
    rawTrack.current = null;
    meter.current = {
      reservationId: "",
      remaining: 0,
      rate: 0,
      interval: 0,
      window: 0,
      settling: false,
    };
  }, [aiActive, room, roomInfo.id]);

  const disableVoice = useCallback(async () => {
    if (
      !voiceActive &&
      !processedAudioTrack.current &&
      !rawAudioTrack.current &&
      !voiceMeter.current.reservationId
    ) {
      return;
    }
    if (voiceMeter.current.interval) clearInterval(voiceMeter.current.interval);
    if (processedAudioTrack.current) {
      await room.localParticipant.unpublishTrack(
        processedAudioTrack.current,
        true,
      );
      processedAudioTrack.current = null;
    }
    await voiceSession.current?.stop();
    voiceSession.current = null;
    const currentMicrophone = room.localParticipant.getTrackPublication(
      Track.Source.Microphone,
    )?.track;
    if (rawAudioTrack.current && currentMicrophone !== rawAudioTrack.current) {
      await room.localParticipant.publishTrack(rawAudioTrack.current, {
        source: Track.Source.Microphone,
      });
    }
    rawAudioTrack.current = null;
    if (voiceMeter.current.reservationId) {
      const released = await apiFetch<{ amountMilli: number }>(
        "/credits/meter/release",
        {
          method: "POST",
          ...jsonBody({
            reservationId: voiceMeter.current.reservationId,
            idempotencyKey: `voice-release:${roomInfo.id}:${Date.now()}`,
          }),
        },
      );
      setWallet((value) => value + Math.max(0, released.amountMilli));
    }
    voiceMeter.current = {
      reservationId: "",
      remaining: 0,
      rate: 0,
      interval: 0,
      window: 0,
      settling: false,
    };
    await room.localParticipant.setMetadata(
      JSON.stringify({
        ...parseParticipantMetadata(room.localParticipant.metadata),
        voiceEffectActive: false,
      }),
    );
    setVoiceActive(false);
  }, [room, roomInfo.id, voiceActive]);

  useEffect(() => {
    const releaseOnExit = () => {
      void disableAi();
      void disableVoice();
    };
    room.on(RoomEvent.Disconnected, releaseOnExit);
    window.addEventListener("pagehide", releaseOnExit);
    return () => {
      room.off(RoomEvent.Disconnected, releaseOnExit);
      window.removeEventListener("pagehide", releaseOnExit);
    };
  }, [disableAi, disableVoice, room]);

  useEffect(
    () => () => {
      aiSession.current?.stop();
      void voiceSession.current?.stop();
      if (meter.current.interval) clearInterval(meter.current.interval);
      if (voiceMeter.current.interval) clearInterval(voiceMeter.current.interval);
    },
    [],
  );

  async function enableAi() {
    if (!selectedFace) {
      setError("Choose an approved face profile first.");
      return;
    }
    setAiBusy(true);
    setError(null);
    try {
      const reserved = await reserveAiCredits();
      meter.current.reservationId = reserved.id;
      meter.current.remaining = reserved.reservationRemainingMilli;
      meter.current.rate = reserved.milliCreditsPerMinute;
      setWallet((value) => value - reserved.reservationMilli);

      const activation = await apiFetch<{
        faceImageUrl: string;
        processingMode: "browser" | "cloud";
        cloudAvailable: boolean;
        cloudPhotorealistic?: boolean;
        fallbackReason?: string | null;
      }>(
        `/faces/${selectedFace}/activate`,
        { method: "POST", ...jsonBody({}) },
      );
      const modeStatus = processingStatus(
        activation.processingMode,
        activation.cloudAvailable,
        activation.cloudPhotorealistic === true,
      );
      setProcessingLabel(modeStatus.label);
      const publication = room.localParticipant.getTrackPublication(
        Track.Source.Camera,
      );
      const localTrack = publication?.track;
      if (!(localTrack instanceof LocalVideoTrack)) {
        throw new Error("Camera track is unavailable");
      }
      rawTrack.current = localTrack;
      const sourceTrack = localTrack.mediaStreamTrack;
      let session: FaceProcessingSession;
      let mediaTrack: MediaStreamTrack;
      let activeMode = activation.processingMode;
      let cloudSession: CloudFaceSession | null = null;
      let cloudFallbackStarted = false;
      const browserSession = () =>
        new BrowserFaceSession({
          sourceTrack,
          faceImageUrl: activation.faceImageUrl,
          quality,
          onTrackingState: setTrackingState,
          onFrameTime: (frameTime) => {
            if (frameTime > 80 && quality !== "low") setQuality("low");
          },
          onBackend: (backend) => {
            const suffix =
              backend === "webgpu"
                ? "WebGPU"
                : backend === "webgl"
                  ? "WebGL"
                  : "Canvas 2D";
            setProcessingLabel(`Local enhanced face mask · ${suffix}`);
          },
        });
      const switchRunningCloudToLocal = async (reason: string) => {
        if (
          cloudFallbackStarted ||
          !cloudSession ||
          aiSession.current !== cloudSession
        ) {
          return;
        }
        cloudFallbackStarted = true;
        try {
          const localSession = browserSession();
          const localMediaTrack = await localSession.start();
          const localProcessedTrack = new LocalVideoTrack(localMediaTrack);
          if (processedTrack.current) {
            await room.localParticipant.unpublishTrack(
              processedTrack.current,
              true,
            );
          }
          await room.localParticipant.publishTrack(
            localProcessedTrack,
            processedVideoPublishOptions(quality, "local-face-mask-fallback"),
          );
          cloudSession.stop();
          aiSession.current = localSession;
          processedTrack.current = localProcessedTrack;
          setProcessingLabel(processingStatus("browser", false).label);
          setTrackingState("tracking");
          setError(
            `${reason}. Cloud processing stopped; local enhanced face mask is active.`,
          );
        } catch (fallbackError) {
          setError(
            fallbackError instanceof Error
              ? `${fallbackError.message}. AI mode was stopped.`
              : "Cloud and local face processing are unavailable.",
          );
          await disableAi();
        }
      };
      if (activation.processingMode === "cloud") {
        cloudSession = new CloudFaceSession({
          sourceTrack,
          faceProfileId: selectedFace,
          roomId: roomInfo.id,
          quality,
          onTrackingState: setTrackingState,
          onFrameTime: (frameTime) => {
            if (frameTime > 1_500) {
              setError(
                "Cloud processing latency is high. Local mode may be smoother on this connection.",
              );
            }
          },
          onProviderFailure: (reason) => {
            void switchRunningCloudToLocal(reason);
          },
        });
        try {
          mediaTrack = await cloudSession.start();
          session = cloudSession;
        } catch (cloudError) {
          cloudSession.stop();
          activeMode = "browser";
          const localSession = browserSession();
          mediaTrack = await localSession.start();
          session = localSession;
          setProcessingLabel(processingStatus("browser", false).label);
          setError(
            `${
              cloudError instanceof Error
                ? cloudError.message
                : "Cloud face processing is unavailable"
            }. Local enhanced face mask is active instead.`,
          );
        }
      } else {
        const localSession = browserSession();
        mediaTrack = await localSession.start();
        session = localSession;
        if (activation.fallbackReason) {
          setError(
            `${activation.fallbackReason}. Local enhanced face mask is active.`,
          );
        }
      }
      const nextProcessed = new LocalVideoTrack(mediaTrack);
      try {
        await replacePublishedTrack({
          async unpublishOriginal() {
            await room.localParticipant.unpublishTrack(localTrack, false);
          },
          async publishProcessed() {
            await room.localParticipant.publishTrack(
              nextProcessed,
              processedVideoPublishOptions(
                quality,
                activeMode === "cloud"
                  ? "cloud-ai-face-swap"
                  : "local-face-mask",
              ),
            );
          },
          async restoreOriginal() {
            await room.localParticipant.publishTrack(localTrack, {
              source: Track.Source.Camera,
            });
          },
        });
      } catch (publishError) {
        session.stop();
        throw publishError;
      }
      aiSession.current = session;
      processedTrack.current = nextProcessed;
      await room.localParticipant.setMetadata(
        JSON.stringify({
          ...parseParticipantMetadata(room.localParticipant.metadata),
          aiFaceActive: true,
          disclosureVersion: "2026-06-11",
        }),
      );
      setAiActive(true);

      meter.current.interval = setInterval(() => {
        void settleAiWindow();
      }, 15_000);
    } catch (value) {
      try {
        await disableAi();
      } catch {
        // Preserve the original activation error.
      }
      setError(
        value instanceof Error
          ? `${value.message}. AI mode was stopped and the normal camera was restored.`
          : "Local face mask activation failed",
      );
    } finally {
      setAiBusy(false);
    }
  }

  async function reserveAiCredits() {
    return apiFetch<{
      id: string;
      reservationMilli: number;
      reservationRemainingMilli: number;
      milliCreditsPerMinute: number;
    }>("/credits/meter/reserve", {
      method: "POST",
      ...jsonBody({
        roomId: roomInfo.id,
        mode: "AI_FACE",
        quality: quality.toUpperCase(),
        idempotencyKey: `reserve:${roomInfo.id}:${Date.now()}`,
      }),
    });
  }

  async function settleAiWindow() {
    if (meter.current.settling || !meter.current.reservationId) return;
    meter.current.settling = true;
    try {
      const expectedCharge = Math.ceil((15_000 * meter.current.rate) / 60_000);
      if (meter.current.remaining < expectedCharge) {
        const released = await apiFetch<{ amountMilli: number }>(
          "/credits/meter/release",
          {
            method: "POST",
            ...jsonBody({
              reservationId: meter.current.reservationId,
              idempotencyKey: `release:${roomInfo.id}:${Date.now()}`,
            }),
          },
        );
        setWallet((value) => value + Math.max(0, released.amountMilli));
        const next = await reserveAiCredits();
        meter.current.reservationId = next.id;
        meter.current.remaining = next.reservationRemainingMilli;
        meter.current.rate = next.milliCreditsPerMinute;
        setWallet((value) => value - next.reservationMilli);
      }
      const currentWindow = meter.current.window++;
      const usage = await apiFetch<{ milliCreditsCharged: number }>(
        "/credits/meter/settle",
        {
          method: "POST",
          ...jsonBody({
            reservationId: meter.current.reservationId,
            meteringWindow: `${roomInfo.id}:${room.localParticipant.identity}:${currentWindow}:${Date.now()}`,
            billableMilliseconds: 15_000,
          }),
        },
      );
      meter.current.remaining -= usage.milliCreditsCharged;
    } catch (value) {
      setError(value instanceof Error ? value.message : "AI metering stopped");
      await disableAi();
    } finally {
      meter.current.settling = false;
    }
  }

  async function toggleMic() {
    if (voiceActive) {
      setError("Turn off the voice changer before changing the raw microphone state.");
      return;
    }
    const next = !mic;
    await room.localParticipant.setMicrophoneEnabled(next);
    setMic(next);
  }

  async function enableVoice() {
    if (voicePreference === "ORIGINAL") {
      setError("Choose the male or female browser tone first.");
      return;
    }
    const support = browserVoiceSupport();
    if (!support.supported) {
      setError(support.reason);
      return;
    }
    setVoiceBusy(true);
    setError(null);
    try {
      const reserved = await reserveVoiceCredits();
      voiceMeter.current.reservationId = reserved.id;
      voiceMeter.current.remaining = reserved.reservationRemainingMilli;
      voiceMeter.current.rate = reserved.milliCreditsPerMinute;
      setWallet((value) => value - reserved.reservationMilli);
      const publication = room.localParticipant.getTrackPublication(
        Track.Source.Microphone,
      );
      const localTrack = publication?.track;
      if (!(localTrack instanceof LocalAudioTrack)) {
        throw new Error("Microphone track is unavailable");
      }
      rawAudioTrack.current = localTrack;
      const session = new BrowserVoiceSession(
        localTrack.mediaStreamTrack,
        voicePreference,
      );
      const browserTrack = await session.start();
      const transformed = new LocalAudioTrack(browserTrack);
      try {
        await replacePublishedTrack({
          async unpublishOriginal() {
            await room.localParticipant.unpublishTrack(localTrack, false);
          },
          async publishProcessed() {
            await room.localParticipant.publishTrack(transformed, {
              source: Track.Source.Microphone,
              name: "browser-voice-tone",
            });
          },
          async restoreOriginal() {
            await room.localParticipant.publishTrack(localTrack, {
              source: Track.Source.Microphone,
            });
          },
        });
      } catch (publishError) {
        await session.stop();
        throw publishError;
      }
      voiceSession.current = session;
      processedAudioTrack.current = transformed;
      await room.localParticipant.setMetadata(
        JSON.stringify({
          ...parseParticipantMetadata(room.localParticipant.metadata),
          voiceEffectActive: true,
          voiceEffectType: voicePreference,
        }),
      );
      setVoiceActive(true);
      voiceMeter.current.interval = setInterval(() => {
        void settleVoiceWindow();
      }, 15_000);
    } catch (value) {
      try {
        await disableVoice();
      } catch {
        // Preserve the original processing error.
      }
      setError(
        value instanceof Error
          ? `${value.message}. The original microphone was restored.`
          : "Browser voice processing failed",
      );
    } finally {
      setVoiceBusy(false);
    }
  }

  async function reserveVoiceCredits() {
    return apiFetch<{
      id: string;
      reservationMilli: number;
      reservationRemainingMilli: number;
      milliCreditsPerMinute: number;
    }>("/credits/meter/reserve", {
      method: "POST",
      ...jsonBody({
        roomId: roomInfo.id,
        mode: "VOICE_EFFECT",
        quality: quality.toUpperCase(),
        idempotencyKey: `voice-reserve:${roomInfo.id}:${Date.now()}`,
      }),
    });
  }

  async function settleVoiceWindow() {
    if (voiceMeter.current.settling || !voiceMeter.current.reservationId) return;
    voiceMeter.current.settling = true;
    try {
      const expectedCharge = Math.ceil(
        (15_000 * voiceMeter.current.rate) / 60_000,
      );
      if (voiceMeter.current.remaining < expectedCharge) {
        const released = await apiFetch<{ amountMilli: number }>(
          "/credits/meter/release",
          {
            method: "POST",
            ...jsonBody({
              reservationId: voiceMeter.current.reservationId,
              idempotencyKey: `voice-release:${roomInfo.id}:${Date.now()}`,
            }),
          },
        );
        setWallet((value) => value + Math.max(0, released.amountMilli));
        const next = await reserveVoiceCredits();
        voiceMeter.current.reservationId = next.id;
        voiceMeter.current.remaining = next.reservationRemainingMilli;
        voiceMeter.current.rate = next.milliCreditsPerMinute;
        setWallet((value) => value - next.reservationMilli);
      }
      const currentWindow = voiceMeter.current.window++;
      const usage = await apiFetch<{ milliCreditsCharged: number }>(
        "/credits/meter/settle",
        {
          method: "POST",
          ...jsonBody({
            reservationId: voiceMeter.current.reservationId,
            meteringWindow: `voice:${roomInfo.id}:${room.localParticipant.identity}:${currentWindow}:${Date.now()}`,
            billableMilliseconds: 15_000,
          }),
        },
      );
      voiceMeter.current.remaining -= usage.milliCreditsCharged;
    } catch (value) {
      setError(value instanceof Error ? value.message : "Voice metering stopped");
      await disableVoice();
    } finally {
      voiceMeter.current.settling = false;
    }
  }

  async function toggleCamera() {
    if (aiActive) {
      setError("Turn off the local face mask before changing the raw camera state.");
      return;
    }
    const next = !camera;
    await room.localParticipant.setCameraEnabled(next);
    setCamera(next);
  }

  async function toggleScreen() {
    const next = !screen;
    await room.localParticipant.setScreenShareEnabled(next);
    setScreen(next);
  }

  async function endCall() {
    if (!isHost) {
      await disableAi();
      await disableVoice();
      room.disconnect();
      return;
    }
    try {
      await disableAi();
      await disableVoice();
      await apiFetch(`/rooms/${roomInfo.id}/end`, {
        method: "POST",
        ...jsonBody({}),
      });
    } catch {
      room.disconnect();
    }
  }

  async function decideWaiting(participantId: string, approve: boolean) {
    setHostMessage(null);
    await apiFetch(
      `/rooms/${roomInfo.id}/${approve ? "approve" : "reject"}/${participantId}`,
      {
        method: "POST",
        ...jsonBody({}),
      },
    );
    setHostMessage(approve ? "Participant admitted." : "Request rejected.");
    await refreshWaiting();
  }

  async function copyInvite() {
    await navigator.clipboard.writeText(roomInfo.inviteUrl);
    setHostMessage("Invite link copied.");
  }

  async function submitChat(event: React.FormEvent) {
    event.preventDefault();
    if (!chatText.trim()) return;
    await send(chatText.trim());
    setChatText("");
  }

  return (
    <div className="call-experience">
      <header className="call-topbar">
        <div>
          <ShieldCheck size={18} />
          <strong>{roomInfo.title}</strong>
        </div>
        <div className="call-statuses">
          {aiActive ? (
            <span className="ai-active">
              <Sparkles size={14} /> {processingLabel} · {trackingState}
            </span>
          ) : null}
          {voiceActive ? (
            <span className="ai-active">
              <Waves size={14} /> Browser voice tone active
            </span>
          ) : null}
          <span>
            <Wifi size={15} /> {network}
          </span>
          {accountAiAvailable ? (
            <span>{creditsFromMilli(wallet)} credits</span>
          ) : (
            <span>Guest</span>
          )}
          <span>
            <Users size={15} /> {room.numParticipants}
          </span>
        </div>
      </header>
      {isHost ? (
        <section className="call-host-panel">
          <div>
            <strong>Host controls</strong>
            <span>
              {waitingParticipants.length} waiting · {room.numParticipants} in
              room
            </span>
          </div>
          <button
            className="button button-secondary button-sm"
            onClick={copyInvite}
          >
            <Copy size={14} /> Copy invite
          </button>
          {waitingParticipants.length ? (
            <div className="waiting-list">
              {waitingParticipants.map((participant) => (
                <div key={participant.id}>
                  <span>
                    {participant.user?.displayName ??
                      participant.guestName ??
                      "Guest"}
                  </span>
                  <button
                    className="button button-primary button-sm"
                    onClick={() => void decideWaiting(participant.id, true)}
                  >
                    Admit
                  </button>
                  <button
                    className="button button-danger button-sm"
                    onClick={() => void decideWaiting(participant.id, false)}
                  >
                    Reject
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {hostMessage ? <small>{hostMessage}</small> : null}
        </section>
      ) : null}
      <div className={chatOpen ? "call-stage chat-visible" : "call-stage"}>
        <div className="participant-grid">
          {tracks.map((track) => (
            <ParticipantTile
              key={track.participant.identity}
              trackRef={track}
            />
          ))}
        </div>
        {chatOpen ? (
          <aside className="call-chat">
            <div className="call-chat-header">
              <strong>In-call chat</strong>
              <button
                className="icon-button"
                onClick={() => setChatOpen(false)}
              >
                <X size={17} />
              </button>
            </div>
            <div className="call-chat-messages">
              {chatMessages.map((message) => (
                <div key={`${message.timestamp}-${message.message}`}>
                  <strong>{message.from?.name ?? "Participant"}</strong>
                  <p>{message.message}</p>
                </div>
              ))}
            </div>
            <form className="call-chat-form" onSubmit={submitChat}>
              <input
                value={chatText}
                onChange={(event) => setChatText(event.target.value)}
                placeholder="Type a message"
              />
              <button className="button button-primary">Send</button>
            </form>
          </aside>
        ) : null}
      </div>
      {error ? <div className="call-error">{error}</div> : null}
      <footer className="call-controls">
        <button className="call-control" onClick={() => void toggleMic()}>
          {mic ? <Mic /> : <MicOff />}
          <span>Mic</span>
        </button>
        <button className="call-control" onClick={() => void toggleCamera()}>
          {camera ? <Camera /> : <CameraOff />}
          <span>Camera</span>
        </button>
        <button className="call-control" onClick={() => void toggleScreen()}>
          <MonitorUp />
          <span>Share</span>
        </button>
        <button
          className={chatOpen ? "call-control active" : "call-control"}
          onClick={() => setChatOpen((value) => !value)}
        >
          <MessageCircle />
          <span>Chat</span>
        </button>
        {accountAiAvailable ? <div className="ai-control">
          <select
            aria-label="Face profile"
            value={selectedFace}
            onChange={(event) => setSelectedFace(event.target.value)}
            disabled={aiActive}
          >
            <option value="">Choose face</option>
            {faces.map((face) => (
              <option value={face.id} key={face.id}>
                {face.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Local mask quality"
            value={quality}
            onChange={(event) =>
              setQuality(event.target.value as "low" | "standard" | "hd")
            }
            disabled={aiActive}
          >
            <option value="low">Basic 360p</option>
            <option value="standard">Standard 480p</option>
            <option value="hd">Pro 720p</option>
          </select>
          <button
            className={aiActive ? "call-control ai enabled" : "call-control ai"}
            onClick={() => void (aiActive ? disableAi() : enableAi())}
            disabled={aiBusy}
          >
            {aiBusy ? <LoaderCircle className="spin" /> : <Sparkles />}
            <span>{aiActive ? "Mask on" : "Face mask"}</span>
          </button>
        </div> : null}
        {accountVoiceAvailable ? (
          <div className="ai-control">
            <select
              aria-label="Voice tone"
              value={voicePreference}
              onChange={(event) =>
                setVoicePreference(event.target.value as VoicePreference)
              }
              disabled={voiceActive}
            >
              <option value="ORIGINAL">Original voice</option>
              <option value="MALE_TONE">Male tone</option>
              <option value="FEMALE_TONE">Female tone</option>
            </select>
            <button
              className={voiceActive ? "call-control ai enabled" : "call-control ai"}
              onClick={() =>
                void (voiceActive ? disableVoice() : enableVoice())
              }
              disabled={voiceBusy}
            >
              {voiceBusy ? <LoaderCircle className="spin" /> : <Waves />}
              <span>{voiceActive ? "Voice on" : "Voice tone"}</span>
            </button>
          </div>
        ) : null}
        <button className="call-control end" onClick={() => void endCall()}>
          <PhoneOff />
          <span>{isHost ? "End" : "Leave"}</span>
        </button>
      </footer>
    </div>
  );
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseParticipantMetadata(value: string | undefined) {
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

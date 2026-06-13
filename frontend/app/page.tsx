import Link from "next/link";
import {
  CheckCircle2,
  Eye,
  LockKeyhole,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Video,
} from "lucide-react";
import { MarketingNav } from "../components/marketing-nav";

export default function LandingPage() {
  return (
    <div className="landing">
      <section className="hero">
        <MarketingNav dark />
        <div className="hero-grid">
          <div className="hero-copy">
            <h1>Be present, on your terms.</h1>
            <p>
              Secure browser video calls with consent-first AI face controls,
              clear disclosure, and no raw camera publication while AI mode is
              active.
            </p>
            <div className="hero-actions">
              <Link href="/signup" className="button button-primary">
                <Video size={18} />
                Start a call
              </Link>
              <Link href="/pricing" className="button hero-secondary">
                See pricing
              </Link>
            </div>
            <div className="hero-proof">
              <span>
                <ShieldCheck size={18} /> Secure by design
              </span>
              <span>
                <CheckCircle2 size={18} /> Consent required
              </span>
              <span>
                <SlidersHorizontal size={18} /> You stay in control
              </span>
            </div>
          </div>
          <div className="hero-call" aria-label="Product call room preview">
            <div className="hero-call-top">
              <span className="ai-active">
                <Sparkles size={14} /> AI Face Active
              </span>
              <span>
                <LockKeyhole size={13} /> Secure call
              </span>
            </div>
            <div className="hero-video-grid">
              <div className="hero-video-main">
                <div className="portrait portrait-one">AM</div>
                <span>Ava</span>
              </div>
              <div className="hero-video-rail">
                <div className="portrait portrait-two">RP</div>
                <div className="portrait portrait-three">MC</div>
                <div className="portrait portrait-four">JL</div>
              </div>
            </div>
            <div className="hero-call-notice">
              <ShieldCheck size={15} />
              Everyone in this call can see that AI face mode is active.
            </div>
          </div>
        </div>
      </section>

      <section className="trust-strip" aria-label="Platform strengths">
        <span>Browser-native</span>
        <span>Mobile-first</span>
        <span>LiveKit WebRTC</span>
        <span>Private face storage</span>
        <span>Transparent billing</span>
      </section>

      <section className="product-section" id="product">
        <div className="section-heading">
          <h2>A real call platform, with a safer AI layer.</h2>
          <p>
            The ordinary call remains familiar. AI processing is optional,
            metered, reversible, and visible to every participant.
          </p>
        </div>
        <div className="feature-rail">
          <article>
            <div className="feature-icon">
              <Video />
            </div>
            <h3>Normal call links</h3>
            <p>
              Create expiring invite links, approve a waiting room, and let
              guests join from Safari or Chrome without installing an app.
            </p>
          </article>
          <article>
            <div className="feature-icon">
              <Eye />
            </div>
            <h3>Visible AI disclosure</h3>
            <p>
              Synthetic face use is persistently signaled through the call
              interface and participant metadata. It cannot be hidden locally.
            </p>
          </article>
          <article>
            <div className="feature-icon">
              <LockKeyhole />
            </div>
            <h3>Private by default</h3>
            <p>
              Browser-local processing launches first. Uploaded face images
              remain private, signed, encrypted, and deletable on request.
            </p>
          </article>
        </div>
      </section>

      <section className="workflow-section">
        <div className="workflow-copy">
          <h2>From camera to call, without publishing the raw track.</h2>
          <p>
            When AI mode starts, TrueFace removes the camera publication,
            processes frames locally, and publishes only the canvas-generated
            track. Tracking failure pauses AI instead of quietly exposing raw
            video.
          </p>
          <Link href="/security" className="button button-secondary">
            Read the security model
          </Link>
        </div>
        <ol className="workflow-list">
          <li>
            <b>01</b>
            <span>
              <strong>Confirm permission</strong>
              Ownership, consent, and face terms are required.
            </span>
          </li>
          <li>
            <b>02</b>
            <span>
              <strong>Run device preflight</strong>
              Quality automatically fits the phone, browser, and frame budget.
            </span>
          </li>
          <li>
            <b>03</b>
            <span>
              <strong>Publish processed video</strong>
              MediaPipe tracking and WebGL composition stay modular.
            </span>
          </li>
        </ol>
      </section>

      <section className="landing-cta">
        <div>
          <h2>Start with trial credits. Keep every call accountable.</h2>
          <p>
            One face profile, a short AI call, clear usage rates, and abuse
            reporting from day one.
          </p>
        </div>
        <Link href="/signup" className="button button-primary">
          Create your account
        </Link>
      </section>

      <footer className="landing-footer">
        <MarketingNav />
        <div>
          <span>© 2026 TrueFace Calls</span>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/report-abuse">Report abuse</Link>
        </div>
      </footer>
    </div>
  );
}

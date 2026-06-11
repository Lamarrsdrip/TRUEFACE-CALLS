import Link from "next/link";
import { MarketingNav } from "../../components/marketing-nav";

export default function HelpPage() {
  return (
    <div className="legal-page">
      <MarketingNav />
      <main>
        <h1>Help center</h1>
        <p className="legal-lead">
          Practical answers for joining calls, face profiles, billing, and
          privacy controls.
        </p>
        <div className="help-grid">
          <article>
            <h2>Join a call</h2>
            <p>
              Open the secure invite, allow camera and microphone access, enter
              the optional room password, then wait for host approval.
            </p>
          </article>
          <article>
            <h2>Face profile approval</h2>
            <p>
              Use a clear, front-facing image with good lighting. The profile
              must pass quality checks and moderation before AI activation.
            </p>
          </article>
          <article>
            <h2>Credits</h2>
            <p>
              AI, voice effects, HD, and cloud GPU modes add to the per-minute
              rate. Base calling can remain available when AI credits run out.
            </p>
          </article>
          <article>
            <h2>Safety</h2>
            <p>
              Use the in-product report flow for suspected misuse. You can also
              block a user and revoke or delete your face data.
            </p>
          </article>
        </div>
        <Link href="/report-abuse" className="button button-secondary">
          Report abuse
        </Link>
      </main>
    </div>
  );
}

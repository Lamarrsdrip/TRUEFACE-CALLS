import { MarketingNav } from "../../components/marketing-nav";

export default function SecurityPage() {
  return (
    <div className="legal-page">
      <MarketingNav />
      <main>
        <h1>Security and responsible AI</h1>
        <p className="legal-lead">
          TrueFace Calls is designed as a communication tool with accountable,
          disclosed synthetic media, not an impersonation or deception product.
        </p>
        <section>
          <h2>Face consent</h2>
          <p>
            Every face profile requires ownership or permission confirmation,
            explicit consent to use the image in calls, and acceptance of the
            current face usage terms. Consent can be revoked and the profile can
            be deleted.
          </p>
        </section>
        <section>
          <h2>Media publication</h2>
          <p>
            Browser AI mode removes the raw camera publication before publishing
            the processed track. If processing or tracking fails, AI output
            pauses. Restoring raw video requires an explicit user action.
          </p>
        </section>
        <section>
          <h2>Data protection</h2>
          <p>
            Face objects are stored privately behind short-lived signed URLs.
            Provider credentials use AES-256-GCM encryption with a deployment
            master key. Passwords use Argon2id and sessions rotate.
          </p>
        </section>
        <section>
          <h2>Abuse response</h2>
          <p>
            Participants can report abuse and block users. Admins receive
            moderation queues, audit trails, payment history, and face profile
            decisions with reason codes.
          </p>
        </section>
      </main>
    </div>
  );
}

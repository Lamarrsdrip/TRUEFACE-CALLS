import { MarketingNav } from "../../components/marketing-nav";

export default function PrivacyPage() {
  return (
    <div className="legal-page">
      <MarketingNav />
      <main>
        <h1>Privacy policy</h1>
        <p className="legal-lead">Effective June 11, 2026.</p>
        <section>
          <h2>Data we process</h2>
          <p>
            We process account details, consent records, call metadata, credit
            usage, private face profile objects, security logs, and abuse
            reports. Browser-local AI frames are not uploaded by the local
            processing engine.
          </p>
        </section>
        <section>
          <h2>Retention and deletion</h2>
          <p>
            You can revoke face consent or delete a profile from privacy
            settings. Deletion removes originals and derivatives from configured
            object storage and marks related consent records revoked.
          </p>
        </section>
        <section>
          <h2>Service providers</h2>
          <p>
            We use configured infrastructure providers for hosting, PostgreSQL,
            Redis, LiveKit transport, object storage, email, payments, and
            monitoring. Current providers are visible in product disclosures.
          </p>
        </section>
      </main>
    </div>
  );
}

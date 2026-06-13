import { MarketingNav } from "../../components/marketing-nav";

export default function TermsPage() {
  return (
    <div className="legal-page">
      <MarketingNav />
      <main>
        <h1>Terms of service and face usage</h1>
        <p className="legal-lead">Effective June 11, 2026.</p>
        <section>
          <h2>Authorized use only</h2>
          <p>
            You may upload and use only face images you own or have permission
            to use. You may not use the service for impersonation, fraud,
            harassment, evasion, non-consensual sexual content, or misleading
            identity claims.
          </p>
        </section>
        <section>
          <h2>Visible synthetic media</h2>
          <p>
            AI face mode includes participant-visible disclosure. You may not
            attempt to remove, obscure, or misrepresent that disclosure.
          </p>
        </section>
        <section>
          <h2>Billing</h2>
          <p>
            Subscription access and usage credits are separate. Rates are shown
            before AI activation. Provider-confirmed payments and immutable
            usage records determine account balances.
          </p>
        </section>
      </main>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { MarketingNav } from "../../components/marketing-nav";

export default function JoinPage() {
  const router = useRouter();
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("link") ?? "");
    try {
      const url = new URL(value);
      router.push(`${url.pathname}${url.search}`);
    } catch {
      router.push(value.startsWith("/") ? value : `/call/${value}`);
    }
  }
  return (
    <div className="legal-page">
      <MarketingNav />
      <main>
        <h1>Join a call</h1>
        <p className="legal-lead">
          Paste the secure invite URL from your host.
        </p>
        <form className="form-card form-grid" onSubmit={submit}>
          <div className="field">
            <label htmlFor="link">Call invite</label>
            <input
              id="link"
              name="link"
              placeholder="https://…/call/…?invite=…"
              required
            />
          </div>
          <button className="button button-primary">Open call preflight</button>
        </form>
      </main>
    </div>
  );
}

import Link from "next/link";
import { Brand } from "./brand";

export function MarketingNav({ dark = false }: { dark?: boolean }) {
  return (
    <header className={`marketing-nav ${dark ? "marketing-nav-dark" : ""}`}>
      <Brand />
      <nav aria-label="Primary navigation" className="marketing-links">
        <Link href="/#product">Product</Link>
        <Link href="/pricing">Pricing</Link>
        <Link href="/security">Security</Link>
        <Link href="/help">Resources</Link>
      </nav>
      <div className="marketing-actions">
        <Link href="/login" className="button button-ghost">
          Sign in
        </Link>
        <Link href="/signup" className="button button-primary">
          Start a call
        </Link>
      </div>
    </header>
  );
}

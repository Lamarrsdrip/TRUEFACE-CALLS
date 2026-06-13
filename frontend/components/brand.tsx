import Link from "next/link";
import { ShieldCheck } from "lucide-react";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="brand" aria-label="TrueFace Calls home">
      <span className="brand-mark">
        <ShieldCheck aria-hidden="true" size={compact ? 19 : 22} />
      </span>
      <span className={compact ? "text-sm font-semibold" : "font-semibold"}>
        TrueFace Calls
      </span>
    </Link>
  );
}

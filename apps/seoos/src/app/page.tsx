import Link from "next/link";
import { isSeoosEnabled } from "@/src/lib/flags";

export default function Home() {
  const enabled = isSeoosEnabled();
  return (
    <main className="wrap">
      <h1>SEOOS</h1>
      <p className="muted">
        SEO Operations System — internal SEO operations and structured
        intelligence packages for MTOS.
      </p>
      {enabled ? (
        <div className="panel">
          <p>
            First vertical slice: submit an SEO Intelligence request and get an
            immutable package back.
          </p>
          <p>
            <Link href="/requests">→ Requests</Link>
          </p>
        </div>
      ) : (
        <div className="panel">
          <span className="badge">SEOOS disabled</span>
          <p className="muted">Set SEOOS_ENABLED=true to enable.</p>
        </div>
      )}
    </main>
  );
}

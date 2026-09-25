import Link from "next/link";
import { WatchlistView } from "@/components/watchlist/WatchlistView";

export const metadata = { title: "Watchlist · Seismograph" };

export default function WatchlistPage() {
  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "22px 22px 60px" }}>
      <Link href="/" style={{ color: "var(--text-dim)", fontSize: 12 }}>← back to the globe</Link>
      <div style={{ marginTop: 18 }}>
        <WatchlistView />
      </div>
    </main>
  );
}

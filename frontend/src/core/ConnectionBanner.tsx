/**
 * ConnectionBanner — a persistent, unmissable warning when the app can't reach
 * the server (offline, server down, timeout). Without it, a failed data load
 * renders as an empty screen that looks exactly like "all your data is gone."
 *
 * It reacts to the browser's online/offline events AND to network failures
 * surfaced by the api.ts axios interceptor (`trc:offline` / `trc:online`).
 */
import { useEffect, useState } from "react";
import { WifiOff, RefreshCw } from "lucide-react";

export default function ConnectionBanner() {
  const [offline, setOffline] = useState<boolean>(typeof navigator !== "undefined" && !navigator.onLine);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    window.addEventListener("trc:offline", goOffline);
    window.addEventListener("trc:online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("trc:offline", goOffline);
      window.removeEventListener("trc:online", goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div style={styles.bar} role="alert">
      <WifiOff size={16} style={{ flexShrink: 0 }} />
      <span style={styles.text}>
        <strong>Connection problem.</strong> The app can&apos;t reach the server, so anything on screen may be
        incomplete or out of date — <strong>this does not mean data is missing</strong>. Check your internet, then reload.
      </span>
      <button style={styles.btn} onClick={() => window.location.reload()}>
        <RefreshCw size={13} /> Reload
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    position: "sticky", top: 0, zIndex: 2000,
    display: "flex", alignItems: "center", gap: 10,
    background: "#c62828", color: "#fff",
    padding: "10px 16px", fontSize: 13.5, lineHeight: 1.4,
    boxShadow: "0 2px 8px rgba(0,0,0,.2)",
  },
  text: { flex: 1 },
  btn: {
    flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5,
    background: "rgba(255,255,255,.18)", color: "#fff",
    border: "1px solid rgba(255,255,255,.5)", borderRadius: 6,
    padding: "6px 12px", cursor: "pointer", fontWeight: 700, fontSize: 12.5,
  },
};

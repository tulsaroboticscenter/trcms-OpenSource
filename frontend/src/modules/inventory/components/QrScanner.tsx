/**
 * QrScanner — a modal that opens the device camera and scans a QR / barcode,
 * calling onScan(text) with the decoded value. Reusable across inventory
 * lookup, checkout, and audit flows.
 */
import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { X, Camera } from "lucide-react";

const REGION_ID = "qr-scan-region";

export default function QrScanner({ onScan, onClose }: {
  onScan: (text: string) => void;
  onClose: () => void;
}) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState("");
  const handledRef = useRef(false);

  useEffect(() => {
    const scanner = new Html5Qrcode(REGION_ID, { verbose: false });
    scannerRef.current = scanner;
    let cancelled = false;

    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decodedText) => {
          if (handledRef.current) return;
          handledRef.current = true;
          onScan(decodedText.trim());
          stop();
        },
        () => { /* per-frame decode failure — ignore */ }
      )
      .catch((e) => {
        if (!cancelled) {
          setError(
            "Unable to start the camera. Grant camera permission and use a secure (https/localhost) connection. " +
            (e?.message ? `(${e.message})` : "")
          );
        }
      });

    function stop() {
      const s = scannerRef.current;
      if (s) {
        s.stop().then(() => s.clear()).catch(() => {});
        scannerRef.current = null;
      }
    }

    return () => { cancelled = true; stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={(e) => e.stopPropagation()}>
        <div style={st.header}>
          <span style={st.title}><Camera size={16} /> Scan a tag</span>
          <button style={st.closeBtn} onClick={onClose}><X size={18} /></button>
        </div>
        <div id={REGION_ID} style={st.region} />
        {error
          ? <p style={st.error}>{error}</p>
          : <p style={st.hint}>Point the camera at an item's QR code.</p>}
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100, padding: 16 },
  modal: { background: "#fff", borderRadius: 12, width: 340, maxWidth: "95vw", overflow: "hidden" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid #e2e8f0" },
  title: { display: "flex", alignItems: "center", gap: 8, fontWeight: 700, color: "#1a3a5c", fontSize: 15 },
  closeBtn: { background: "none", border: "none", cursor: "pointer", color: "#888", display: "flex", padding: 4 },
  region: { width: "100%", minHeight: 260, background: "#000" },
  hint: { fontSize: 12, color: "#888", textAlign: "center", padding: "10px 14px", margin: 0 },
  error: { fontSize: 12, color: "#c62828", padding: "10px 14px", margin: 0, lineHeight: 1.5 },
};

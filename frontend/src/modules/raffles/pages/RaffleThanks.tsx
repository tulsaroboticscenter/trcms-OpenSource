/** Public landing after a raffle purchase returns from the payment provider. */
import { useLocation } from "react-router-dom";
import { CheckCircle, XCircle } from "lucide-react";

export default function RaffleThanks() {
  const { pathname } = useLocation();
  const canceled = pathname.includes("canceled");
  return (
    <div style={s.page}>
      <div style={s.card}>
        {canceled ? (
          <>
            <XCircle size={56} color="#c62828" style={{ margin: "0 auto 12px" }} />
            <h1 style={s.h1}>Payment canceled</h1>
            <p style={s.p}>No worries — nothing was charged. You can scan the code again to try, or buy your tickets at the booth.</p>
          </>
        ) : (
          <>
            <CheckCircle size={56} color="#2e7d32" style={{ margin: "0 auto 12px" }} />
            <h1 style={s.h1}>Thank you — you're entered!</h1>
            <p style={s.p}>We've emailed your ticket numbers. Good luck in the drawing, and thanks for supporting the Tulsa Robotics Center!</p>
          </>
        )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#f0f4f8", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "48px 14px" },
  card: { background: "#fff", borderRadius: 14, padding: "32px 26px", maxWidth: 440, width: "100%", textAlign: "center", boxShadow: "0 8px 32px rgba(0,0,0,0.08)" },
  h1: { fontSize: 22, color: "#1a3a5c", margin: "0 0 10px" },
  p: { fontSize: 15, color: "#445", lineHeight: 1.6, margin: 0 },
};

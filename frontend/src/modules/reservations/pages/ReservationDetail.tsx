import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../../core/AuthContext";
import { useGoBack } from "../../../core/useGoBack";
import { reservationsApi, fmtRange, STATUS_META, RESERVATION_COLOR, resourceColor, PURPOSES, type Reservation } from "../api";
import { CalendarClock, ArrowLeft, Pencil, DoorOpen, Wrench, AlertTriangle, Ban } from "lucide-react";

const purposeLabel = (p: string) => PURPOSES.find((x) => x.value === p)?.label ?? p;

/** Read-only detail view for a single reservation. Edit/Cancel appear only when
 *  the viewer is allowed to act (mirrors the backend rules in ReservationsController). */
export default function ReservationDetail() {
  const navigate = useNavigate();
  const goBack = useGoBack("/reservations");
  const { id } = useParams();
  const { user, canWrite } = useAuth();
  const canApprove = canWrite("reservations.approve");
  const canManage = canWrite("reservations.manage");

  const [r, setR] = useState<Reservation | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    if (!id) return;
    reservationsApi.get(parseInt(id))
      .then(setR)
      .catch(() => setErr("This reservation could not be found, or you don't have access to it."));
  }
  useEffect(load, [id]);

  if (err) return (
    <div style={st.wrap}>
      <button style={st.back} onClick={goBack}><ArrowLeft size={15} /> Back to calendar</button>
      <div style={st.err}>{err}</div>
    </div>
  );
  if (!r) return <div style={st.wrap}><p style={st.muted}>Loading…</p></div>;

  const privileged = canApprove || canManage;
  const isOwner = user?.id === r.member_id;
  // Backend: editable by an approver/manager, or by the owner while still pending.
  const canEdit = privileged || (isOwner && r.status === "pending");
  // Backend: cancellable by an approver/manager or the owner, while still active.
  const canCancel = (privileged || isOwner) && r.status !== "cancelled" && r.status !== "denied";
  const sm = STATUS_META[r.status];

  async function cancel() {
    if (!r || !window.confirm("Cancel this reservation?")) return;
    setBusy(true);
    try { const upd = await reservationsApi.cancel(r.id); setR(upd); }
    catch { setErr("Could not cancel this reservation."); }
    finally { setBusy(false); }
  }

  return (
    <div style={st.wrap}>
      <button style={st.back} onClick={goBack}><ArrowLeft size={15} /> Back to calendar</button>

      <div style={st.titleRow}>
        <div style={{ ...st.kindIcon, background: resourceColor(r.resource_id) + "18", color: resourceColor(r.resource_id) }}>
          {r.resource_kind === "equipment" ? <Wrench size={22} /> : <DoorOpen size={22} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={st.heading}>{r.resource_name}</h1>
          <div style={st.sub}>{fmtRange(r.start_at, r.end_at)}</div>
        </div>
        <span style={{ ...st.badge, color: sm.color, background: sm.color + "22" }}>{sm.label}</span>
      </div>

      <dl style={st.dl}>
        <Field label="Requested by" value={r.member_name ?? `Member #${r.member_id}`} />
        <Field label="Purpose" value={`${purposeLabel(r.purpose)}${r.team_label ? ` · ${r.team_label}` : ""}`} />
        {r.event_name && (
          <div style={st.field}>
            <dt style={st.dt}>For event</dt>
            <dd style={st.dd}>
              <button style={st.link} onClick={() => r.event_id && navigate(`/events/${r.event_id}`)}>
                <CalendarClock size={13} style={{ verticalAlign: -2 }} /> {r.event_name}
              </button>
            </dd>
          </div>
        )}
        {r.usage_details && <Field label="Usage details" value={r.usage_details} />}
        {r.special_considerations && (
          <div style={st.field}>
            <dt style={st.dt}>Special considerations</dt>
            <dd style={{ ...st.dd, ...st.special }}><AlertTriangle size={13} style={{ verticalAlign: -2 }} /> {r.special_considerations}</dd>
          </div>
        )}
        {!!r.conflicts && (
          <div style={st.field}>
            <dt style={st.dt}>Conflicts</dt>
            <dd style={{ ...st.dd, color: "#c62828", fontWeight: 600 }}>
              <AlertTriangle size={13} style={{ verticalAlign: -2 }} /> Overlaps {r.conflicts} approved reservation{r.conflicts > 1 ? "s" : ""} on this resource
            </dd>
          </div>
        )}
        {(r.reviewed_by_name || r.review_note) && (
          <Field label={r.status === "denied" ? "Denied by" : "Reviewed by"}
                 value={`${r.reviewed_by_name ?? "—"}${r.review_note ? ` · “${r.review_note}”` : ""}`} />
        )}
      </dl>

      <div style={st.actions}>
        {canEdit && <button style={st.editBtn} onClick={() => navigate(`/reservations/${r.id}/edit`)}><Pencil size={15} /> Edit Reservation</button>}
        {canCancel && <button disabled={busy} style={st.cancelBtn} onClick={cancel}><Ban size={15} /> Cancel Reservation</button>}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={st.field}>
      <dt style={st.dt}>{label}</dt>
      <dd style={st.dd}>{value}</dd>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 640 },
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#667", cursor: "pointer", fontSize: 13, marginBottom: 10, padding: 0 },
  titleRow: { display: "flex", alignItems: "center", gap: 14, marginBottom: 20 },
  kindIcon: { width: 48, height: 48, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  heading: { margin: 0, fontSize: 23, fontWeight: 700, color: "#1a3a5c" },
  sub: { fontSize: 14, color: "#445", fontWeight: 600, marginTop: 3 },
  badge: { padding: "4px 12px", borderRadius: 12, fontSize: 12, fontWeight: 700, flexShrink: 0 },
  dl: { display: "flex", flexDirection: "column", gap: 0, margin: 0, border: "1px solid #e7ebf0", borderRadius: 8, overflow: "hidden" },
  field: { display: "flex", borderBottom: "1px solid #eef2f6" },
  dt: { width: 190, flexShrink: 0, padding: "12px 14px", background: "#faf7fc", fontSize: 13, fontWeight: 600, color: "#556", margin: 0 },
  dd: { flex: 1, padding: "12px 14px", fontSize: 14, color: "#223", margin: 0 },
  special: { color: "#b26a00" },
  link: { background: "none", border: "none", padding: 0, color: RESERVATION_COLOR, fontWeight: 600, cursor: "pointer", fontSize: 14 },
  actions: { display: "flex", gap: 10, marginTop: 20 },
  editBtn: { display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", background: RESERVATION_COLOR, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 14 },
  cancelBtn: { display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", background: "#fff", color: "#c62828", border: "1px solid #f0c5c5", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  err: { background: "#fdeaea", color: "#c62828", border: "1px solid #f3c0c0", borderRadius: 6, padding: "12px 16px", fontSize: 14 },
  muted: { color: "#888", textAlign: "center", padding: "2rem" },
};

import { Link, useLocation } from "react-router-dom";

const TABS = [
  { to: "/camp", label: "Setup" },
  { to: "/camp/registrations", label: "Registrations" },
  { to: "/camp/staffing", label: "Staffing" },
  { to: "/camp/staff", label: "Staff Planning" },
  { to: "/camp/contacts", label: "Contacts" },
  { to: "/camp/resources", label: "Resources" },
  { to: "/camp/special-notes", label: "Special Notes" },
  { to: "/camp/reports", label: "Reports" },
];

export default function CampTabs() {
  const { pathname } = useLocation();
  return (
    <div style={st.bar}>
      {TABS.map((t) => {
        const active = pathname === t.to;
        return (
          <Link key={t.to} to={t.to} style={{ ...st.tab, ...(active ? st.active : {}) }}>{t.label}</Link>
        );
      })}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  bar: { display: "flex", gap: 4, borderBottom: "2px solid #e2e8f0", marginBottom: 16 },
  tab: { padding: "8px 16px", fontSize: 14, fontWeight: 600, color: "#667", textDecoration: "none", borderBottom: "2px solid transparent", marginBottom: -2 },
  active: { color: "#1a3a5c", borderBottomColor: "#1a3a5c" },
};

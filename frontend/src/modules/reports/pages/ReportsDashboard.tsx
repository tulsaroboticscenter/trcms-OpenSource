import { useNavigate } from "react-router-dom";
import { Users, UsersRound, CreditCard, Clock, Upload, ChevronRight, TrendingUp, ShieldCheck, PieChart, LayoutGrid, Activity, FileText, UserX, GraduationCap, HeartPulse, Building2, Award } from "lucide-react";

const REPORTS = [
  {
    id: "trends",
    title: "Trends & Analytics",
    description: "Track any program metric over time — membership growth, retention, certifications, funding, inventory value, and more. Pick a metric, grain, and date range to see the trend.",
    icon: TrendingUp,
    color: "#1565c0",
    path: "/reports/trends",
    tags: ["Trends", "Time-Series", "Growth", "Analytics"],
  },
  {
    id: "builder",
    title: "Report Builder",
    description: "Design your own custom reports — pick a dataset, choose fields, add filters and grouping, preview, and export to PDF or CSV. Save reports to run again. You only see data you're allowed to.",
    icon: FileText,
    color: "#6a1b9a",
    path: "/reports/builder",
    tags: ["Custom", "Builder", "PDF", "CSV"],
  },
  {
    id: "retention",
    title: "Retention",
    description: "Cohort retention triangle — what share of each season's newcomers keep coming back, year over year. The core health metric for the program.",
    icon: LayoutGrid,
    color: "#2e7d32",
    path: "/reports/retention",
    tags: ["Retention", "Cohorts", "Growth", "Health"],
  },
  {
    id: "active-members",
    title: "Active Members",
    description: "Headcount of your current active roster with demographic charts — gender, race/ethnicity, age, and program. Built for the business plan.",
    icon: PieChart,
    color: "#00838f",
    path: "/reports/active-members",
    tags: ["Headcount", "Demographics", "Business Plan"],
  },
  {
    id: "certifications-by-member",
    title: "Certifications by Member",
    description: "Every active member and the certifications they've completed, with dates. Filter by member type or show only those with (or without) certifications. Exports to CSV.",
    icon: GraduationCap,
    color: "#6a1b9a",
    path: "/reports/certifications-by-member",
    tags: ["Certifications", "Training", "Members"],
  },
  {
    id: "youth-by-grade",
    title: "Youth by Grade",
    description: "Active youth grouped by school grade for the current season — 9th–12th shown as Freshman, Sophomore, Junior, and Senior. Grade is figured from each youth's graduation year. Exports to CSV.",
    icon: GraduationCap,
    color: "#e65100",
    path: "/reports/youth-by-grade",
    tags: ["Youth", "Grade", "Roster"],
  },
  {
    id: "certification-holders",
    title: "Certification Holders",
    description: "Pick one or more certifications and list every active member who has earned them. Group the results by team or by FDP membership. Requires all selected (or any). PDF and CSV.",
    icon: Award,
    color: "#8e24aa",
    path: "/reports/certification-holders",
    tags: ["Certifications", "Teams", "FDP"],
  },
  {
    id: "member-directory",
    title: "Member Directory",
    description: "All active members with contact info, guardian details, and team assignments. Filterable by member type.",
    icon: Users,
    color: "#1a3a5c",
    path: "/reports/member-directory",
    tags: ["Members", "Contact Info", "Teams"],
  },
  {
    id: "team-list",
    title: "Team Roster Lists",
    description: "Per-team member rosters for a season, including roles and FIRST registration status.",
    icon: UsersRound,
    color: "#6a1b9a",
    path: "/reports/team-list",
    tags: ["Teams", "Rosters", "FIRST"],
  },
  {
    id: "enrollment-status",
    title: "Enrollment & Payment Status",
    description: "Current enrollment year status — who has paid, payment overrides, T&C completion, and shirt sizes.",
    icon: CreditCard,
    color: "#2e7d32",
    path: "/reports/enrollment-status",
    tags: ["Enrollment", "Payments", "T&C"],
  },
  {
    id: "special-notes",
    title: "Special Notes",
    description: "Youth in a program with their medical, allergy, and accommodation notes, general special notes, and photo-release status — the member-side version of the camp Special Notes list. Filter by program. Requires medical access.",
    icon: HeartPulse,
    color: "#c62828",
    path: "/reports/special-notes",
    tags: ["Medical", "Allergies", "Accommodations", "By Program"],
  },
  {
    id: "employer-matching",
    title: "Employer Matching & Grants",
    description: "Parents, mentors, and volunteers grouped by employer, showing who offers donation matching, volunteer grants (“Dollars for Doers”), or grants TRC can apply for — your warm list for corporate giving. Requires the View Employer Info permission.",
    icon: Building2,
    color: "#00796b",
    path: "/reports/employer-matching",
    tags: ["Fundraising", "Matching Gifts", "Grants", "Corporate"],
  },
  {
    id: "not-attending",
    title: "Not Attending",
    description: "Active members who haven't checked in during a chosen period — with last-seen date and contact info — so you can follow up with “we've been missing you” outreach.",
    icon: UserX,
    color: "#c62828",
    path: "/reports/not-attending",
    tags: ["Re-engagement", "Attendance", "Follow-up"],
  },
  {
    id: "attendance",
    title: "Attendance Summary",
    description: "Check-in counts and total hours by member for any date range.",
    icon: Clock,
    color: "#e65100",
    path: "/reports/attendance",
    tags: ["Attendance", "Hours", "Check-In"],
  },
  {
    id: "activity-impact",
    title: "Activity Impact",
    description: "Total participation and community/volunteer hours, broken down by area and member type, for any date range.",
    icon: TrendingUp,
    color: "#ff8f00",
    path: "/reports/activity-impact",
    tags: ["Time", "Impact", "Volunteer Hours"],
  },
  {
    id: "usage",
    title: "User Activity",
    description: "Who's using TRCMS and how much — power users ranked by time in the system, page views, sessions, and most-visited pages (admin only).",
    icon: Activity,
    color: "#00838f",
    path: "/reports/usage",
    tags: ["Usage", "Adoption", "Power Users", "Admin"],
  },
  {
    id: "report-access",
    title: "Report Access",
    description: "Control what each role can do in the Report Builder, per dataset — capability, row scope, and how sensitive a field they can see. Overrides the built-in role presets (admin only).",
    icon: ShieldCheck,
    color: "#455a64",
    path: "/reports/report-access",
    tags: ["Reports", "Access", "Roles", "Admin"],
  },
  {
    id: "permissions",
    title: "Permissions Report",
    description: "Every member's effective roles and per-module access level (admin only). Useful for auditing who can see and do what.",
    icon: ShieldCheck,
    color: "#6a1b9a",
    path: "/reports/permissions",
    tags: ["Permissions", "Roles", "Access", "Admin"],
  },
  {
    id: "classroom-email-readiness",
    title: "Classroom Email Readiness",
    description: "Pre-check for the Google Classroom integration: which active youth & mentors can be matched to Classroom students by email, and who needs an email added or fixed first.",
    icon: GraduationCap,
    color: "#00838f",
    path: "/reports/classroom-email-readiness",
    tags: ["Google Classroom", "Certifications", "Email", "Admin"],
  },
];

const TOOLS = [
  {
    id: "import",
    title: "Import Members from CSV",
    description: "Bulk-add members using a CSV file. Download the template first to ensure correct column formatting.",
    icon: Upload,
    color: "#1565c0",
    path: "/members/import",
  },
];

export default function ReportsDashboard() {
  const navigate = useNavigate();
  return (
    <div>
      <div style={styles.pageHeader}>
        <h1 style={styles.heading}>Reports</h1>
        <p style={styles.sub}>Generate canned reports and export data as CSV. Use the import tool for bulk member loading.</p>
      </div>

      <h2 style={styles.sectionHeading}>Canned Reports</h2>
      <div style={styles.grid}>
        {REPORTS.map((r) => {
          const Icon = r.icon;
          return (
            <div key={r.id} style={styles.card} onClick={() => navigate(r.path)}
              onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.1)")}
              onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.06)")}
            >
              <div style={{ ...styles.cardIcon, color: r.color }}>
                <Icon size={28} />
              </div>
              <div style={styles.cardBody}>
                <div style={styles.cardTitle}>{r.title}</div>
                <div style={styles.cardDesc}>{r.description}</div>
                <div style={styles.tagRow}>
                  {r.tags.map((t) => (
                    <span key={t} style={styles.tag}>{t}</span>
                  ))}
                </div>
              </div>
              <ChevronRight size={18} color="#ccc" style={{ flexShrink: 0, alignSelf: "center" }} />
            </div>
          );
        })}
      </div>

      <h2 style={{ ...styles.sectionHeading, marginTop: 28 }}>Data Tools</h2>
      <div style={styles.grid}>
        {TOOLS.map((t) => {
          const Icon = t.icon;
          return (
            <div key={t.id} style={styles.card} onClick={() => navigate(t.path)}
              onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.1)")}
              onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.06)")}
            >
              <div style={{ ...styles.cardIcon, color: t.color }}>
                <Icon size={28} />
              </div>
              <div style={styles.cardBody}>
                <div style={styles.cardTitle}>{t.title}</div>
                <div style={styles.cardDesc}>{t.description}</div>
              </div>
              <ChevronRight size={18} color="#ccc" style={{ flexShrink: 0, alignSelf: "center" }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pageHeader: { marginBottom: 24 },
  heading: { margin: 0, fontSize: 26, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "4px 0 0", fontSize: 13, color: "#888" },
  sectionHeading: { fontSize: 13, fontWeight: 700, color: "#888", textTransform: "uppercase" as const, letterSpacing: 0.5, margin: "0 0 12px" },
  grid: { display: "flex", flexDirection: "column", gap: 10 },
  card: { display: "flex", alignItems: "flex-start", gap: 16, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.25rem", cursor: "pointer", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", transition: "box-shadow 0.15s" },
  cardIcon: { flexShrink: 0, marginTop: 2 },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: 700, color: "#1a3a5c", marginBottom: 4 },
  cardDesc: { fontSize: 13, color: "#666", lineHeight: 1.6, marginBottom: 8 },
  tagRow: { display: "flex", gap: 6, flexWrap: "wrap" },
  tag: { padding: "2px 8px", background: "#f0f4f8", color: "#555", borderRadius: 6, fontSize: 11, fontWeight: 600 },
};

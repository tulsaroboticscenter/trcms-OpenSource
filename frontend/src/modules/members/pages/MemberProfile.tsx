import { useState, useEffect } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../../core/AuthContext";
import { api } from "../../../core/api";
import { membersApi } from "../api";
import { hofApi } from "../../halloffame/api";
import { familiesApi, type FamilyMemberRecord } from "../../families/api";
import MedicalForm from "../../enrollment/components/MedicalForm";
import { FdpPanel } from "../../fdp";
import { GRADE_OPTIONS, gradeFromGradYear, gradYearFromGrade, gradeLabel } from "../../../core/grade";
import { usePanelLayout } from "../hooks/usePanelLayout";
import DraggablePanel from "../components/DraggablePanel";
import MemberEnrollments from "../../enrollment/pages/MemberEnrollments";
import CollegePrepPanel from "../../scholarships/components/CollegePrepPanel";
import MemberTeamsPanel from "../../teams/components/MemberTeamsPanel";
import { YouthRolePanel, AdultRolePanel } from "../../roles";
import { SeasonParticipationPanel } from "../../seasons";
import MyUpcomingEventsPanel from "../../events/components/MyUpcomingEventsPanel";
import MemberCheckinsPanel from "../components/MemberCheckinsPanel";
import ReflectionsPanel from "../components/ReflectionsPanel";
import SpotlightControlPanel from "../components/SpotlightControlPanel";
import SpotlightMemberPanel, { useSpotlightMe } from "../components/SpotlightMemberPanel";
import { MyActivitiesPanel } from "../../planning";
import { MemberCertificationsPanel } from "../../certifications";
import MentorTCPanel from "../../enrollment/components/MentorTCPanel";
import MentorProgramsPanel from "../components/MentorProgramsPanel";
import { OnboardingPanel } from "../../onboarding";
import NightPreferencePanel from "../components/NightPreferencePanel";
import { nightPrefsApi, type MemberNightPrefs } from "../../../core/nightPrefsApi";
import { FamilyPanel } from "../../families";
import { MessageHistoryPanel, CommunicationPreferencesPanel } from "../../communications";
import PhotoUpload from "../../../core/components/PhotoUpload";
import WelcomeEmailModal from "../components/WelcomeEmailModal";
import ComplianceExemptBadge from "../components/ComplianceExemptBadge";
import SystemRolesPanel from "../components/SystemRolesPanel";
import { formatDate, ageFromBirthday } from "../../../core/dateUtils";
import PhoneInput from "../../../core/components/PhoneInput";
import {
  Edit2, ArrowLeft, User, Phone, Mail, MapPin, Shield,
  AlertTriangle, ClipboardList, UsersRound, Star, Trophy, Users, FileText, Bell, RefreshCw,
  Archive, ArchiveRestore, UserPlus, CalendarDays, EyeOff, Settings, ListChecks, GraduationCap, Copy, Check, Sparkles, Hand,
  UserMinus, UserCheck, HeartPulse, ClipboardCheck, Building2,
} from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";
import TwoFactorPanel from "../../../core/TwoFactorPanel";
import { twoFactorApi } from "../../../core/twoFactorApi";
import { useIsMobile } from "../../../core/useIsMobile";
import SocialLinksPanel from "../../social/SocialLinksPanel";

interface Member {
  id: number;
  member_number: string;
  username: string;
  member_type: string;
  private_sections?: string[];
  is_junior_mentor?: boolean;
  first_name: string;
  middle_name?: string;
  last_name: string;
  birthday?: string;
  graduation_year?: number;
  grade?: number | null;          // derived server-side from graduation_year
  grade_label?: string | null;
  school?: string;
  shirt_size?: string | null;
  robotics_experience_years: number;
  // Employer & matching-gift info (adults). Redacted server-side unless self / view_employer.
  employer_name?: string | null;
  employer_job_title?: string | null;
  employer_matches_donations?: string | null;  // yes | no | unsure
  employer_volunteer_grants?: string | null;
  employer_offers_grants?: string | null;
  employer_program_info?: string | null;
  employer_matching_help?: boolean;
  employer_notes?: string | null;
  employer_hidden?: boolean;
  email?: string;
  alt_email1?: string;
  alt_email1_enabled?: boolean;
  alt_email2?: string;
  alt_email2_enabled?: boolean;
  phone?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  address_hidden?: boolean;
  contact_hidden?: boolean;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  emergency_contact_relationship?: string;
  emergency_contact2_name?: string;
  emergency_contact2_phone?: string;
  emergency_contact2_relationship?: string;
  guardian1_name?: string;
  guardian1_phone?: string;
  guardian1_email?: string;
  guardian2_name?: string;
  guardian2_phone?: string;
  guardian2_email?: string;
  special_notes?: string;
  photo_url?: string;
  sex?: string;
  race?: string;
  free_reduced_lunch_eligible?: boolean;
  youth_tc_agreed: boolean;
  parent_tc_agreed: boolean;
  date_joined?: string;
  is_active: boolean;
  is_archived?: boolean;
  is_alumni?: boolean;
  is_compliance_exempt?: boolean;
  exemption_status?: { exempt: boolean; explicit_flag: boolean; role_based: boolean; reason?: string };
}

// All possible panel IDs in the default order.
// The hook will load the user's saved order and fall back to this.
const DEFAULT_PANEL_ORDER = [
  "spotlight", "spotlight_control", "contact", "personal", "employer", "emergency", "guardian", "notes",
  "system_roles", "reflections", "my_events", "my_activities", "checkins", "certifications", "fdp", "enrollments", "teams", "ylc", "compliance", "onboarding", "mentor_tc", "seasons", "night_prefs", "family", "communications", "privacy",
];

// Friendly labels for the employer yes/no/unsure fields.
const OFFER_LABEL: Record<string, string> = { yes: "Yes", no: "No", unsure: "Not sure" };
const SHIRT_SIZES = ["YXS", "YS", "YM", "YL", "YXL", "AS", "AM", "AL", "AXL", "A2XL", "A3XL"];

// Panes a member may hide from other members on their own profile.
const HIDEABLE_PANES: { key: string; label: string }[] = [
  { key: "contact", label: "Contact Information" },
  { key: "personal", label: "Personal Information" },
  { key: "emergency", label: "Emergency Contact" },
  { key: "guardian", label: "Parent / Guardian" },
  { key: "teams", label: "Teams" },
  { key: "seasons", label: "FIRST Game Participation" },
  { key: "ylc", label: "Youth Leadership (YLC)" },
  { key: "family", label: "Family" },
  { key: "my_events", label: "My Upcoming Events" },
];

export default function MemberProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const goBack = useGoBack("/members");
  const isMobile = useIsMobile();
  const { user, isAdmin, hasRole, canWrite, canRead } = useAuth();
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<Member>>({});
  const [saving, setSaving] = useState(false);
  const [showWelcomeEmail, setShowWelcomeEmail] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  const [showPromote, setShowPromote] = useState(false);
  const [actionMsg, setActionMsg] = useState("");

  // Drag-and-drop state
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  // Global pane placement (Main / Side / Account Info), set by admins.
  const [placement, setPlacement] = useState<Record<string, string>>({});
  const [view, setView] = useState<"profile" | "account" | "email" | "collegePrep" | "medical">("profile");

  const location = useLocation();
  // Read a one-time "success" flash from router state, then clear it from the
  // history entry so a page refresh doesn't re-show it. Auto-hides after a few s.
  const [flash, setFlash] = useState("");
  useEffect(() => {
    const s = (location.state as { success?: string })?.success;
    if (!s) return;
    setFlash(s);
    window.history.replaceState({}, "");
    const t = setTimeout(() => setFlash(""), 5000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const successMsg = actionMsg || flash;
  const memberId = parseInt(id!);
  const isSelf = user?.id === memberId;
  // A guardian is a privileged viewer of their own youth (medical, edit, private
  // sections). Declared before canSeePrivate, which uses it. Set from /members/me/children.
  const [myYouthIds, setMyYouthIds] = useState<number[]>([]);
  const isMyYouth = !isSelf && myYouthIds.includes(memberId);
  // Editing own vs. other members' records is controlled by separate permissions.
  const canEdit = isSelf ? canWrite("members.edit_own") : canWrite("members.edit_others");
  // A youth's own parent/guardian is a privileged viewer of that youth — like a mentor —
  // so they see all their child's profile sections (including any the youth marked private
  // to other members) and the Account Info tab. Privacy is meant to hide panes from
  // unrelated members, not from a youth's own parent. isMyYouth comes from /members/me/children.
  const canSeePrivate = isSelf || isAdmin || isMyYouth || hasRole("Admin", "System Administrator", "Mentor");
  const canSeeMemberNumber = isAdmin || hasRole("Admin", "System Administrator", "Mentor") || isSelf;
  // Only an explicitly-assigned System Administrator may un-archive.
  const isSysAdmin = !!user?.roles?.includes("System Administrator");

  // Spotlight state is owned here (not inside the panel) so the profile can drop the
  // whole pane when no spotlight is running — must be declared before panelDefs uses it.
  const spotlight = useSpotlightMe();

  // Season the grade is calculated against. The season is global, so the logged-in
  // user's enrollment year is the right one even when viewing someone else.
  const seasonYear = user?.enrollment_status?.enrollment_year ?? new Date().getFullYear();
  const toGrade = (gy: number) => gradeFromGradYear(gy, seasonYear);
  const toGradYear = (g: number) => gradYearFromGrade(g, seasonYear);

  // Adults already in this member's family, used to tell whether a guardian listed on
  // the profile has a real member record yet. Without this the Parent/Guardian pane
  // offers "Create Parent Profile" even for parents who are already members.
  const [familyAdults, setFamilyAdults] = useState<FamilyMemberRecord[]>([]);
  useEffect(() => {
    familiesApi.getMemberFamily(memberId)
      .then((f) => setFamilyAdults((f?.members ?? []).filter((m) => m.member_type !== "youth")))
      .catch(() => setFamilyAdults([]));
  }, [memberId]);

  /**
   * Match a guardian (free text on the youth's record) to an existing member.
   * Email is the reliable key; fall back to a normalised full-name comparison for
   * guardians recorded before emails were collected. Returns undefined when the
   * guardian has no member record — that's when offering to create one is right.
   */
  const guardianMember = (name?: string | null, email?: string | null) => {
    const e = (email ?? "").trim().toLowerCase();
    if (e) {
      const byEmail = familyAdults.find((m) => (m.email ?? "").trim().toLowerCase() === e);
      if (byEmail) return byEmail;
    }
    const n = (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    if (!n) return undefined;
    return familyAdults.find((m) => `${m.first_name} ${m.last_name}`.trim().toLowerCase().replace(/\s+/g, " ") === n);
  };

  const { order: panelOrder, setOrder: setPanelOrder } = usePanelLayout(DEFAULT_PANEL_ORDER);

  useEffect(() => {
    membersApi.get(memberId)
      .then(setMember)
      .catch(() => setError("Member not found or access denied."))
      .finally(() => setLoading(false));
  }, [memberId]);

  // FLL meeting-night preference (staff-visible). 403 for non-staff → stays null,
  // so the panel simply doesn't show.
  const [nightPrefs, setNightPrefs] = useState<MemberNightPrefs | null>(null);
  useEffect(() => {
    nightPrefsApi.forMember(memberId).then(setNightPrefs).catch(() => setNightPrefs(null));
  }, [memberId]);

  useEffect(() => {
    if (isSelf) return;
    membersApi.myChildren().then((ks) => setMyYouthIds(ks.map((k) => k.id))).catch(() => {});
  }, [isSelf]);

  useEffect(() => {
    api.get("/api/v1/admin/profile-layout")
      .then(({ data }) => setPlacement(data.placement ?? {}))
      .catch(() => { /* fall back to all-main on error */ });
  }, []);

  function startEdit() {
    if (!member) return;
    setEditData({
      username: member.username,
      first_name: member.first_name, middle_name: member.middle_name, last_name: member.last_name,
      birthday: member.birthday, graduation_year: member.graduation_year,
      date_joined: member.date_joined,
      email: member.email,
      alt_email1: member.alt_email1, alt_email1_enabled: member.alt_email1_enabled,
      alt_email2: member.alt_email2, alt_email2_enabled: member.alt_email2_enabled,
      phone: member.phone, school: member.school, shirt_size: member.shirt_size,
      address_line1: member.address_line1, address_line2: member.address_line2,
      city: member.city, state: member.state, zip_code: member.zip_code,
      emergency_contact_name: member.emergency_contact_name,
      emergency_contact_phone: member.emergency_contact_phone,
      emergency_contact_relationship: member.emergency_contact_relationship,
      emergency_contact2_name: member.emergency_contact2_name,
      emergency_contact2_phone: member.emergency_contact2_phone,
      emergency_contact2_relationship: member.emergency_contact2_relationship,
      guardian1_name: member.guardian1_name, guardian1_phone: member.guardian1_phone,
      guardian1_email: member.guardian1_email, guardian2_name: member.guardian2_name,
      guardian2_phone: member.guardian2_phone, guardian2_email: member.guardian2_email,
      special_notes: member.special_notes, sex: member.sex, race: member.race,
      free_reduced_lunch_eligible: member.free_reduced_lunch_eligible,
      is_junior_mentor: member.is_junior_mentor,
      employer_name: member.employer_name, employer_job_title: member.employer_job_title,
      employer_matches_donations: member.employer_matches_donations,
      employer_volunteer_grants: member.employer_volunteer_grants,
      employer_offers_grants: member.employer_offers_grants,
      employer_program_info: member.employer_program_info,
      employer_matching_help: member.employer_matching_help,
      employer_notes: member.employer_notes,
    });
    setEditing(true);
  }

  async function saveEdit() {
    setSaving(true);
    try {
      const updated = await membersApi.update(memberId, editData);
      setMember(updated);
      setEditing(false);
    } catch (e: any) { alert(e?.response?.data?.detail || "Failed to save changes. Please try again."); }
    finally { setSaving(false); }
  }

  function ed(field: keyof Member, value: string) {
    setEditData((d) => ({ ...d, [field]: value }));
  }

  // Create a Parent member profile pre-filled from a guardian's details.
  function createParentFrom(name?: string, phone?: string, email?: string) {
    const parts = (name ?? "").trim().split(/\s+/);
    const first_name = parts[0] ?? "";
    const last_name = parts.slice(1).join(" ");
    navigate("/members/add", {
      state: {
        prefill: {
          member_type: "parent",
          first_name,
          last_name,
          phone: phone ?? "",
          email: email ?? "",
        },
        // Link the new parent into a family with this youth (tagged Parent / Child).
        parentLink: member ? { childId: member.id, lastName: member.last_name } : undefined,
      },
    });
  }

  async function handleArchive() {
    if (!member) return;
    if (!confirm(
      `Archive ${member.first_name} ${member.last_name}?\n\n` +
      "Archived members are hidden from reports, team lists, and check-ins. " +
      "Only a System Administrator can un-archive them."
    )) return;
    try {
      await membersApi.archive(memberId);
      setMember({ ...member, is_archived: true });
      setEditing(false);
      setActionMsg("Member archived. They will no longer appear in reports, team lists, or check-ins.");
      setTimeout(() => setActionMsg(""), 5000);
    } catch { alert("Failed to archive member. Please try again."); }
  }

  async function handleToggleActive() {
    if (!member) return;
    const next = !member.is_active;
    if (!next && !confirm(
      `Mark ${member.first_name} ${member.last_name} as Inactive?\n\n` +
      "They stay in the system and searchable, but won't be counted in the active-member " +
      "headcount. You can switch them back to Active anytime."
    )) return;
    try {
      await membersApi.setActive(memberId, next);
      setMember({ ...member, is_active: next });
      setActionMsg(next ? "Member marked Active." : "Member marked Inactive.");
      setTimeout(() => setActionMsg(""), 5000);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      alert(detail ?? "Failed to update active status.");
    }
  }

  async function handleGraduateToHoF() {
    if (!member) return;
    if (!confirm(
      `Create a Hall of Fame page for ${member.first_name} ${member.last_name}?\n\n` +
      "Their teams, leadership positions, awards, high school, and years in the program will be " +
      "pre-filled from their record. The page starts as a hidden draft — you can edit it and publish when ready."
    )) return;
    try {
      const hof = await hofApi.createFromMember(memberId);
      navigate(`/hall-of-fame/${hof.id}/edit`);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      alert(detail ?? "Failed to create the Hall of Fame page.");
    }
  }

  async function handleUnarchive() {
    if (!member) return;
    try {
      await membersApi.unarchive(memberId);
      setMember({ ...member, is_archived: false });
      setActionMsg("Member un-archived and restored to active use.");
      setTimeout(() => setActionMsg(""), 5000);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      alert(detail ?? "Failed to un-archive member.");
    }
  }

  async function handleToggleAlumni() {
    if (!member) return;
    const next = !member.is_alumni;
    try {
      await membersApi.update(memberId, { is_alumni: next });
      setMember({ ...member, is_alumni: next });
      setActionMsg(next ? "Marked as alumni." : "Alumni status removed.");
      setTimeout(() => setActionMsg(""), 4000);
    } catch {
      alert("Failed to update alumni status.");
    }
  }

  async function handleResetTC() {
    if (!member) return;
    const name = [member.first_name, member.last_name].filter(Boolean).join(" ");
    if (!confirm(`Reset ${name}'s TRC Terms & Conditions for this season?\n\nThey will be required to agree again the next time they log in.`)) return;
    try {
      await api.post(`/api/v1/enrollment/${memberId}/reset-tc`);
      setActionMsg(`Terms & Conditions reset for ${name}. They'll be prompted to agree on next login.`);
      setTimeout(() => setActionMsg(""), 6000);
      membersApi.get(memberId).then(setMember).catch(() => {});
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      alert(detail ?? "Failed to reset Terms & Conditions.");
    }
  }

  // Drag handlers
  function handleDragStart(id: string) { setDragging(id); }
  function handleDragOver(e: React.DragEvent, id: string) { e.preventDefault(); setDragOver(id); }
  function handleDragEnd() { setDragging(null); setDragOver(null); }
  function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    if (!dragging || dragging === targetId) { handleDragEnd(); return; }
    const next = [...panelOrder];
    const from = next.indexOf(dragging);
    const to = next.indexOf(targetId);
    if (from === -1 || to === -1) { handleDragEnd(); return; }
    next.splice(from, 1);
    next.splice(to, 0, dragging);
    setPanelOrder(next);
    handleDragEnd();
  }

  if (loading) return <div style={styles.center}>Loading…</div>;
  if (error || !member) return <div style={styles.center}>{error || "Member not found."}</div>;

  // T&C warning: only applies to youth members.
  // Mentors use MentorTCPanel for their annual T&C; parents/volunteers have no T&C requirement.
  // For youth, check the enrollment-based T&C status if we have it (from auth/me),
  // otherwise fall back to the member-level fields (which may be stale).
  const isYouth = member.member_type === "youth";
  const enrollmentTCok = isSelf
    ? (user?.enrollment_status?.tc_ok ?? null)   // logged-in user viewing own profile
    : null;                                        // admin viewing another's profile
  // Only show the warning when we can confirm T&C is actually incomplete.
  // Don't show if enrollmentTCok is null (can't tell) or true (already signed).
  const tcWarning = isYouth && enrollmentTCok === false;
  const fullName = [member.first_name, member.middle_name, member.last_name].filter(Boolean).join(" ");

  // ── Panel definitions ────────────────────────────────────────────────────
  // Each panel is keyed by its ID. Only panels whose `show` is true get rendered.
  // The `span` flag makes the panel span both grid columns (full width).

  const panelDefs: Record<string, {
    title: React.ReactNode; icon: React.ReactNode;
    show: boolean; span?: boolean; content: React.ReactNode;
  }> = {
    contact: {
      title: "Contact Information", icon: <Phone size={14} />,
      show: true,
      content: editing ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <EditRow label="First Name" value={editData.first_name ?? ""} onChange={(v) => ed("first_name", v)} />
            <EditRow label="Last Name" value={editData.last_name ?? ""} onChange={(v) => ed("last_name", v)} />
          </div>
          <EditRow label="Middle Name" value={editData.middle_name ?? ""} onChange={(v) => ed("middle_name", v)} />
          {canWrite("members.edit_others") && (
            <EditRow label="Username (login)" value={editData.username ?? ""} onChange={(v) => ed("username", v)} />
          )}
          <EditRow label="Email" value={editData.email ?? ""} onChange={(v) => ed("email", v)} type="email" />
          <AltEmailEdit label="Alternate Email 1" email={editData.alt_email1 ?? ""} enabled={!!editData.alt_email1_enabled}
            onEmail={(v) => ed("alt_email1", v)} onToggle={(b) => setEditData((d) => ({ ...d, alt_email1_enabled: b }))} />
          <AltEmailEdit label="Alternate Email 2" email={editData.alt_email2 ?? ""} enabled={!!editData.alt_email2_enabled}
            onEmail={(v) => ed("alt_email2", v)} onToggle={(b) => setEditData((d) => ({ ...d, alt_email2_enabled: b }))} />
          <div style={{ marginBottom: 8 }}><label style={styles.editLabel}>Phone</label><PhoneInput style={styles.editInput} value={editData.phone ?? ""} onChange={(v) => ed("phone", v)} /></div>
          <EditRow label="Address" value={editData.address_line1 ?? ""} onChange={(v) => ed("address_line1", v)} />
          <EditRow label="Address 2" value={editData.address_line2 ?? ""} onChange={(v) => ed("address_line2", v)} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8 }}>
            <EditRow label="City" value={editData.city ?? ""} onChange={(v) => ed("city", v)} />
            <EditRow label="State" value={editData.state ?? ""} onChange={(v) => ed("state", v)} />
            <EditRow label="ZIP" value={editData.zip_code ?? ""} onChange={(v) => ed("zip_code", v)} />
          </div>
        </>
      ) : (
        <>
          {member.contact_hidden && (
            <InfoRow icon={<Mail size={13} />} label="Contact" value="Hidden — only staff can view members' email and phone" />
          )}
          <InfoRow icon={<Mail size={13} />} label="Email" value={member.email} copy={member.email} />
          {member.alt_email1 && <InfoRow icon={<Mail size={13} />} label="Alt Email 1" value={member.alt_email1 + (member.alt_email1_enabled ? " (receives email)" : " (off)")} />}
          {member.alt_email2 && <InfoRow icon={<Mail size={13} />} label="Alt Email 2" value={member.alt_email2 + (member.alt_email2_enabled ? " (receives email)" : " (off)")} />}
          <InfoRow icon={<Phone size={13} />} label="Phone" value={member.phone} />
          {member.address_line1 && (
            <InfoRow icon={<MapPin size={13} />} label="Address"
              value={[member.address_line1, member.address_line2,
                member.city && `${member.city}, ${member.state} ${member.zip_code}`]
                .filter(Boolean).join(" · ")}
              copy={[member.address_line1, member.address_line2,
                member.city && `${member.city}, ${member.state} ${member.zip_code}`]
                .filter(Boolean).join("\n")} />
          )}
          {member.address_hidden && (
            <InfoRow icon={<MapPin size={13} />} label="Address" value="Hidden — you don't have permission to view addresses" />
          )}
        </>
      ),
    },

    personal: {
      title: "Personal Information", icon: <User size={14} />,
      show: true,
      content: editing ? (
        <>
          <EditRow label="Birthday" type="date" value={editData.birthday?.split("T")[0] ?? ""} onChange={(v) => ed("birthday", v)} />
          {isAdmin && (
            <EditRow label="Date Joined" type="date" value={editData.date_joined?.split("T")[0] ?? ""} onChange={(v) => ed("date_joined", v)} />
          )}
          {member.member_type === "youth" && (
            <>
              {/* Grade and graduation year are two views of one value — editing either
                  updates the other. Only graduation_year is stored, which is what makes
                  the grade advance by itself every season. */}
              <div style={{ marginBottom: 8 }}>
                <label style={styles.editLabel}>Grade</label>
                <select
                  style={styles.editInput}
                  value={editData.graduation_year ? String(toGrade(editData.graduation_year)) : ""}
                  onChange={(e) => setEditData((d) => ({
                    ...d,
                    graduation_year: e.target.value === "" ? undefined : toGradYear(parseInt(e.target.value)),
                  }))}
                >
                  <option value="">— not set —</option>
                  {GRADE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <EditRow label="Graduation Year" value={String(editData.graduation_year ?? "")}
                onChange={(v) => setEditData(d => ({ ...d, graduation_year: v ? parseInt(v) : undefined }))} />
              {editData.graduation_year != null && (
                <p style={styles.gradeHint}>
                  Class of {editData.graduation_year} — {gradeLabel(toGrade(editData.graduation_year))} this season.
                  Changing either field updates the other.
                </p>
              )}
            </>
          )}
          <EditRow label="School" value={editData.school ?? ""} onChange={(v) => ed("school", v)} />
          <div style={{ marginBottom: 8 }}>
            <label style={styles.editLabel}>Shirt Size</label>
            <select style={styles.editInput} value={editData.shirt_size ?? ""} onChange={(e) => ed("shirt_size", e.target.value)}>
              <option value="">—</option>
              {SHIRT_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {isAdmin && (
            <>
              <div style={{ marginBottom: 8 }}>
                <label style={styles.editLabel}>Sex</label>
                <select style={styles.editInput} value={editData.sex ?? ""} onChange={(e) => ed("sex", e.target.value)}>
                  <option value="">Prefer not to say</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Non-binary">Non-binary</option>
                  <option value="Other">Other / Self-describe</option>
                </select>
              </div>
              <div style={{ marginBottom: 8 }}>
                <label style={styles.editLabel}>Race / Ethnicity</label>
                <select style={styles.editInput} value={editData.race ?? ""} onChange={(e) => ed("race", e.target.value)}>
                  <option value="">Prefer not to say</option>
                  <option value="American Indian or Alaska Native">American Indian or Alaska Native</option>
                  <option value="Asian">Asian</option>
                  <option value="Black or African American">Black or African American</option>
                  <option value="Hispanic or Latino">Hispanic or Latino</option>
                  <option value="Native Hawaiian or Pacific Islander">Native Hawaiian or Pacific Islander</option>
                  <option value="White">White</option>
                  <option value="Two or more races">Two or more races</option>
                  <option value="Other">Other / Self-describe</option>
                </select>
              </div>
              <label style={styles.checkLabel}>
                <input type="checkbox"
                  checked={editData.free_reduced_lunch_eligible ?? false}
                  onChange={(e) => setEditData(d => ({ ...d, free_reduced_lunch_eligible: e.target.checked }))} />
                Eligible for free/reduced lunch
              </label>
              {(member.member_type === "youth" || member.member_type === "mentor") && (
                <label style={styles.checkLabel}>
                  <input type="checkbox"
                    checked={editData.is_junior_mentor ?? false}
                    onChange={(e) => setEditData(d => ({ ...d, is_junior_mentor: e.target.checked }))} />
                  Junior Mentor (scored as a group in certifications)
                </label>
              )}
            </>
          )}
        </>
      ) : (
        <>
          {member.birthday && <InfoRow label="Birthday" value={formatDate(member.birthday)} />}
          {member.birthday && ageFromBirthday(member.birthday) !== null && <InfoRow label="Age" value={`${ageFromBirthday(member.birthday)} years`} />}
          {member.member_type === "youth" && member.graduation_year != null && (
            <InfoRow label="Grade" value={member.grade_label ?? gradeLabel(toGrade(member.graduation_year)) ?? "—"} />
          )}
          {member.graduation_year && <InfoRow label="Grad Year" value={String(member.graduation_year)} />}
          {member.school && <InfoRow label="School" value={member.school} />}
          <InfoRow label="Shirt Size" value={member.shirt_size || "—"} />
          <InfoRow label="FIRST Exp." value={`${member.robotics_experience_years} year(s)`} />
          {canRead("members.demographics") && member.sex && <InfoRow label="Sex" value={member.sex} />}
          {canRead("members.demographics") && member.race && <InfoRow label="Race / Ethnicity" value={member.race} />}
          {canRead("members.demographics") && member.free_reduced_lunch_eligible != null &&
            <InfoRow label="Free/Reduced Lunch" value={member.free_reduced_lunch_eligible ? "Eligible" : "Not eligible"} />}
          {member.is_junior_mentor && <InfoRow label="Junior Mentor" value="Yes (scored as a group)" />}
        </>
      ),
    },

    // Employer & matching gifts — adults only. Fundraising-facing: does the member's
    // employer offer donation matching, volunteer grants, or grants TRC can apply for?
    employer: {
      title: "Employer & Matching Gifts", icon: <Building2 size={14} />,
      show: member.member_type !== "youth" && (isSelf || isAdmin || canRead("members.view_employer")),
      content: editing ? (
        <>
          <p style={{ fontSize: 12, color: "#889", lineHeight: 1.5, margin: "0 0 10px" }}>
            Many employers match donations or give “Dollars for Doers” volunteer grants. Telling us here can turn into funding for TRC.
          </p>
          <EditRow label="Employer" value={editData.employer_name ?? ""} onChange={(v) => ed("employer_name", v)} />
          <EditRow label="Job Title" value={editData.employer_job_title ?? ""} onChange={(v) => ed("employer_job_title", v)} />
          {([
            ["employer_matches_donations", "Matches employee donations?"],
            ["employer_volunteer_grants", "Offers volunteer grants (Dollars for Doers)?"],
            ["employer_offers_grants", "Offers grants nonprofits can apply for?"],
          ] as const).map(([field, label]) => (
            <div key={field} style={{ marginBottom: 8 }}>
              <label style={styles.editLabel}>{label}</label>
              <select style={styles.editInput} value={(editData[field] as string) ?? ""} onChange={(e) => ed(field, e.target.value)}>
                <option value="">— not sure —</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
                <option value="unsure">Not sure</option>
              </select>
            </div>
          ))}
          <div style={{ marginBottom: 8 }}>
            <label style={styles.editLabel}>Program details / matching portal link</label>
            <textarea style={{ ...styles.editInput, minHeight: 48 }} value={editData.employer_program_info ?? ""}
              onChange={(e) => ed("employer_program_info", e.target.value)} placeholder="e.g. a Benevity/YourCause link, or the HR/community-giving contact" />
          </div>
          <label style={styles.checkLabel}>
            <input type="checkbox" checked={editData.employer_matching_help ?? false}
              onChange={(e) => setEditData((d) => ({ ...d, employer_matching_help: e.target.checked }))} />
            I'm willing to help set up a match or grant
          </label>
          <div style={{ marginBottom: 8 }}>
            <label style={styles.editLabel}>Notes</label>
            <textarea style={{ ...styles.editInput, minHeight: 48 }} value={editData.employer_notes ?? ""}
              onChange={(e) => ed("employer_notes", e.target.value)} />
          </div>
        </>
      ) : (
        <>
          {member.employer_name ? (
            <>
              <InfoRow label="Employer" value={member.employer_name} />
              {member.employer_job_title && <InfoRow label="Job Title" value={member.employer_job_title} />}
              <InfoRow label="Matches donations" value={OFFER_LABEL[member.employer_matches_donations ?? ""] ?? "—"} />
              <InfoRow label="Volunteer grants" value={OFFER_LABEL[member.employer_volunteer_grants ?? ""] ?? "—"} />
              <InfoRow label="Offers grants" value={OFFER_LABEL[member.employer_offers_grants ?? ""] ?? "—"} />
              {member.employer_program_info && <InfoRow label="Program / link" value={member.employer_program_info} />}
              {member.employer_matching_help && <InfoRow label="Willing to help" value="Yes" />}
              {member.employer_notes && <InfoRow label="Notes" value={member.employer_notes} />}
            </>
          ) : (
            <p style={{ fontSize: 12, color: "#889", lineHeight: 1.5, margin: 0 }}>
              No employer info yet.{isSelf ? " Edit your profile to add whether your employer offers donation matching or volunteer grants — it can become funding for TRC." : ""}
            </p>
          )}
        </>
      ),
    },

    emergency: {
      title: "Emergency Contact", icon: <Shield size={14} />,
      show: canSeePrivate,
      content: editing ? (
        <>
          <EditRow label="Name" value={editData.emergency_contact_name ?? ""} onChange={(v) => ed("emergency_contact_name", v)} />
          <div style={{ marginBottom: 8 }}><label style={styles.editLabel}>Phone</label><PhoneInput style={styles.editInput} value={editData.emergency_contact_phone ?? ""} onChange={(v) => ed("emergency_contact_phone", v)} /></div>
          <EditRow label="Relationship" value={editData.emergency_contact_relationship ?? ""} onChange={(v) => ed("emergency_contact_relationship", v)} />
          <div style={{ borderTop: "1px solid #eef2f6", margin: "10px 0 8px", paddingTop: 8, fontSize: 11, fontWeight: 700, color: "#99a", textTransform: "uppercase", letterSpacing: 0.4 }}>Second contact</div>
          <EditRow label="Name" value={editData.emergency_contact2_name ?? ""} onChange={(v) => ed("emergency_contact2_name", v)} />
          <div style={{ marginBottom: 8 }}><label style={styles.editLabel}>Phone</label><PhoneInput style={styles.editInput} value={editData.emergency_contact2_phone ?? ""} onChange={(v) => ed("emergency_contact2_phone", v)} /></div>
          <EditRow label="Relationship" value={editData.emergency_contact2_relationship ?? ""} onChange={(v) => ed("emergency_contact2_relationship", v)} />
        </>
      ) : (
        <>
          <InfoRow label="Name" value={member.emergency_contact_name} />
          <InfoRow label="Phone" value={member.emergency_contact_phone} />
          <InfoRow label="Relationship" value={member.emergency_contact_relationship} />
          {(member.emergency_contact2_name || member.emergency_contact2_phone) && <>
            <InfoRow label="2nd Name" value={member.emergency_contact2_name} />
            <InfoRow label="2nd Phone" value={member.emergency_contact2_phone} />
            <InfoRow label="2nd Relationship" value={member.emergency_contact2_relationship} />
          </>}
        </>
      ),
    },

    guardian: {
      title: "Parent / Guardian", icon: <User size={14} />,
      show: canSeePrivate && (member.member_type === "youth" || !!member.guardian1_name),
      content: editing ? (
        <>
          <p style={styles.sectionNote}>Guardian 1</p>
          <EditRow label="Name" value={editData.guardian1_name ?? ""} onChange={(v) => ed("guardian1_name", v)} />
          <div style={{ marginBottom: 8 }}><label style={styles.editLabel}>Phone</label><PhoneInput style={styles.editInput} value={editData.guardian1_phone ?? ""} onChange={(v) => ed("guardian1_phone", v)} /></div>
          <EditRow label="Email" value={editData.guardian1_email ?? ""} onChange={(v) => ed("guardian1_email", v)} />
          <p style={{ ...styles.sectionNote, marginTop: 12 }}>Guardian 2 (optional)</p>
          <EditRow label="Name" value={editData.guardian2_name ?? ""} onChange={(v) => ed("guardian2_name", v)} />
          <div style={{ marginBottom: 8 }}><label style={styles.editLabel}>Phone</label><PhoneInput style={styles.editInput} value={editData.guardian2_phone ?? ""} onChange={(v) => ed("guardian2_phone", v)} /></div>
          <EditRow label="Email" value={editData.guardian2_email ?? ""} onChange={(v) => ed("guardian2_email", v)} />
        </>
      ) : (
        <>
          {[
            { name: member.guardian1_name, phone: member.guardian1_phone, email: member.guardian1_email, first: true },
            { name: member.guardian2_name, phone: member.guardian2_phone, email: member.guardian2_email, first: false },
          ].filter((g) => g.name).map((g, gi) => {
            const existing = guardianMember(g.name, g.email);
            return (
              <div key={gi} style={g.first ? styles.guardianBlock : { ...styles.guardianBlock, marginTop: 12 }}>
                <div style={styles.guardianName}>{g.name}</div>
                <InfoRow icon={<Phone size={13} />} label="" value={g.phone} />
                <InfoRow icon={<Mail size={13} />} label="" value={g.email} />
                {existing ? (
                  // Already a member — link to them instead of offering to create a duplicate.
                  <button style={styles.viewParentBtn} onClick={() => navigate(`/members/${existing.member_id}`)}>
                    <User size={12} /> View {existing.first_name}'s profile
                  </button>
                ) : isAdmin && (
                  <button style={styles.createParentBtn}
                    onClick={() => createParentFrom(g.name, g.phone, g.email)}>
                    <UserPlus size={12} /> Create Parent Profile
                  </button>
                )}
              </div>
            );
          })}
        </>
      ),
    },

    notes: {
      title: "Notes", icon: <ClipboardList size={14} />,
      show: canSeePrivate && (!!member.special_notes || editing),
      content: editing ? (
        <textarea style={styles.textarea} value={editData.special_notes ?? ""}
          onChange={(e) => ed("special_notes", e.target.value)} />
      ) : (
        <p style={styles.notes}>{member.special_notes}</p>
      ),
    },

    my_events: {
      title: "My Upcoming Events", icon: <CalendarDays size={14} />,
      show: canSeePrivate, span: true,
      content: <MyUpcomingEventsPanel memberId={memberId} />,
    },

    my_activities: {
      title: "My Assigned Tasks", icon: <ListChecks size={14} />,
      show: canSeePrivate, span: true,
      content: <MyActivitiesPanel memberId={memberId} />,
    },

    checkins: {
      title: "Check-Ins", icon: <CalendarDays size={14} />,
      show: canSeePrivate, span: true,
      content: <MemberCheckinsPanel memberId={memberId} />,
    },

    certifications: {
      title: "Certifications", icon: <Trophy size={14} />,
      show: member.member_type === "youth" || member.member_type === "mentor",
      span: true,
      content: <MemberCertificationsPanel memberId={memberId} />,
    },

    enrollments: {
      title: "Enrollments", icon: <ClipboardList size={14} />,
      show: canSeePrivate, span: true,
      content: <MemberEnrollments memberId={memberId} embedded />,
    },

    teams: {
      title: "Teams", icon: <UsersRound size={14} />,
      show: canSeePrivate, span: true,
      content: <MemberTeamsPanel memberId={memberId} />,
    },

    system_roles: {
      title: "System Permissions", icon: <Shield size={14} />,
      show: canRead("members.system_permissions"),
      content: <SystemRolesPanel memberId={memberId} />,
    },

    ylc: {
      title: "Youth Leadership Council (YLC)", icon: <Star size={14} />,
      show: canSeePrivate && member.member_type === "youth",
      content: <YouthRolePanel memberId={memberId} />,
    },

    compliance: {
      // YPT / background-check tracking applies to adults (mentors, parents,
      // volunteers) and to youth who have turned 18 — anyone who may need to be
      // FIRST-compliant. Programs Supported stays mentor-only.
      title: <>TRC Compliance &amp; Expertise</>, icon: <Shield size={14} />,
      show: (() => {
        const t = member.member_type;
        if (t === "mentor" || t === "parent" || t === "volunteer") return true;
        if (t === "youth" && member.birthday) {
          const age = Math.floor((Date.now() - new Date(member.birthday).getTime()) / 31557600000);
          return age >= 18;
        }
        return false;
      })(),
      content: (
        <>
          <AdultRolePanel memberId={memberId} />
          {member.member_type === "mentor" && (
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #eef0f4" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#1a3a5c", marginBottom: 8 }}>Programs Supported</div>
              <MentorProgramsPanel memberId={memberId} canEdit={canWrite("members.edit_others")} />
            </div>
          )}
        </>
      ),
    },

    onboarding: {
      // The joining checklist. Same audience as the compliance pane (adults and 18+
      // youth), since that is who YPT and the background check apply to. Members see
      // their own; onboarding.view/manage covers everyone else.
      title: "Getting Started at TRC", icon: <ClipboardCheck size={14} />,
      show: (() => {
        if (!(isSelf || canRead("onboarding.view") || canWrite("onboarding.manage"))) return false;
        const t = member.member_type;
        if (t === "mentor" || t === "parent" || t === "volunteer") return true;
        if (t === "youth" && member.birthday) {
          const age = Math.floor((Date.now() - new Date(member.birthday).getTime()) / 31557600000);
          return age >= 18;
        }
        return false;
      })(),
      content: <OnboardingPanel memberId={memberId} />,
    },

    mentor_tc: {
      title: "Annual T&C Agreement", icon: <FileText size={14} />,
      show: canSeePrivate && member.member_type === "mentor",
      content: <MentorTCPanel memberId={memberId} />,
    },

    seasons: {
      title: <>FIRST Game Participation &amp; Experience</>, icon: <Trophy size={14} />,
      show: canSeePrivate && (member.member_type === "youth" || member.member_type === "mentor"),
      span: true,
      content: <SeasonParticipationPanel memberId={memberId} />,
    },

    night_prefs: {
      title: "Meeting Night Preference", icon: <CalendarDays size={14} />,
      show: member.member_type === "youth" && !!nightPrefs && (nightPrefs.items.length > 0 || nightPrefs.is_fll),
      content: nightPrefs ? <NightPreferencePanel data={nightPrefs} /> : null,
    },

    family: {
      title: "Family", icon: <Users size={14} />,
      show: canSeePrivate, span: true,
      content: <FamilyPanel memberId={memberId} />,
    },

    communications: {
      title: "System Email History", icon: <Mail size={14} />,
      show: true, span: true,
      content: (
        <MessageHistoryPanel
          recipientType="member"
          recipientId={memberId}
          recipientName={fullName}
          recipientEmail={member.email}
          showCompose={false}
        />
      ),
    },

    comm_prefs: {
      title: "Communication Preferences", icon: <Bell size={14} />,
      show: canSeePrivate,
      content: <CommunicationPreferencesPanel memberId={memberId} />,
    },

    spotlight: {
      title: "Who's It?", icon: <Hand size={14} />,
      // Only while a spotlight is actually live on a meeting they're checked into —
      // gating on the state here (not just inside the panel) so an inactive spotlight
      // leaves no empty titled card behind.
      show: isSelf && spotlight.state.active, span: true,
      content: <SpotlightMemberPanel state={spotlight.state} reload={spotlight.reload} />,
    },

    spotlight_control: {
      title: "Meeting Spotlight", icon: <Sparkles size={14} />,
      show: isSelf && canWrite("spotlight.manage"), span: true,
      content: <SpotlightControlPanel />,
    },

    fdp: {
      title: "FIRST Development Program", icon: <GraduationCap size={14} />,
      // Youth only. The panel itself returns null when there's nothing to show and
      // the viewer couldn't act on it anyway.
      show: member.member_type === "youth" && (isSelf || isMyYouth || canRead("fdp.manage")),
      content: <FdpPanel memberId={memberId} />,
    },

    reflections: {
      title: "My Reflections", icon: <Sparkles size={14} />,
      // Private by design: the member themselves (gated on members.own_reflections so the
      // pane can be turned off per role in Role Management), or an admin holding
      // members.view_reflections (read-only — the backend blocks anyone else).
      show: (isSelf && canRead("members.own_reflections")) || canRead("members.view_reflections"), span: true,
      content: <ReflectionsPanel memberId={memberId} />,
    },

    privacy: {
      title: "Profile Privacy", icon: <EyeOff size={14} />,
      show: isSelf, span: true,
      content: (
        <ProfilePrivacyPanel
          initial={member.private_sections ?? []}
          onChange={(next) => setMember((m) => m ? { ...m, private_sections: next } : m)}
        />
      ),
    },
  };

  // Ordered + filtered list of visible panels
  const privateSections = member.private_sections ?? [];
  const visiblePanels = panelOrder
    // A panel shows if its own condition is met AND the viewer's role permits
    // that profile section (configurable in Role Management → Profile Sections).
    // Keys not in the catalog (e.g. system_roles) default to visible.
    .filter((pid) => panelDefs[pid]?.show && canRead(`profile.${pid}`))
    // Per-user privacy: the owner can hide panes from other members. Owner,
    // admins, and mentors (canSeePrivate) always see them.
    .filter((pid) => canSeePrivate || !privateSections.includes(pid))
    .map((pid) => ({ id: pid, ...panelDefs[pid] }));

  // Split panels into placement zones (default "main" when unconfigured).
  const zoneOf = (id: string) => placement[id] ?? "main";
  const mainPanels = visiblePanels.filter((p) => zoneOf(p.id) === "main");
  const sidePanels = visiblePanels.filter((p) => zoneOf(p.id) === "side");
  const accountPanels = visiblePanels.filter((p) => zoneOf(p.id) === "account");
  const hasAccountTab = accountPanels.length > 0;
  const emailPanels = visiblePanels.filter((p) => zoneOf(p.id) === "email");
  const hasEmailTab = emailPanels.length > 0;
  // College/Vo-Tech Prep tab: youth up to age 21 (disappears at 21). If no
  // birthday is on file we still show it — they're a youth and we can't confirm
  // they've aged out.
  const collegePrepAge = member.birthday ? ageFromBirthday(member.birthday) : null;
  const showCollegePrep = member.member_type === "youth" && (collegePrepAge === null || collegePrepAge < 21);
  // Don't get stuck on a tab that isn't available for this member.
  // Medical tab. Reading is deliberately tight: the member themselves, a guardian of
  // this youth, or staff holding members.view_medical (Admin/System Administrator).
  // Mentors are not granted that key — they complete their own form but don't see
  // anyone else's. Writing follows the same rule the API enforces: an adult on their
  // own form, a guardian on their youth's, or a member editor.
  const canSeeMedical = isSelf || isMyYouth || canRead("members.view_medical");
  const canEditMedical = (isSelf && member.member_type !== "youth") || isMyYouth || canWrite("members.edit_others");

  const activeView = view === "medical" && canSeeMedical ? "medical"
    : view === "collegePrep" && showCollegePrep ? "collegePrep"
    : view === "account" && hasAccountTab ? "account"
    : view === "email" && hasEmailTab ? "email"
    : "profile";

  type PanelView = { id: string; title: React.ReactNode; icon?: React.ReactNode; span?: boolean; content: React.ReactNode };

  // Renders a non-draggable card (used in edit mode).
  const StaticCard = (panel: PanelView) => (
    <div key={panel.id} style={{
      background: "#fff", borderRadius: 10, padding: "1.25rem", border: "1px solid #e2e8f0",
      ...(panel.span ? { gridColumn: "1 / -1" } : {}),
    }}>
      <h3 style={styles.staticTitle}>
        {panel.icon && <span style={{ marginRight: 6, opacity: 0.7 }}>{panel.icon}</span>}
        {panel.title}
      </h3>
      {panel.content}
    </div>
  );

  // Renders a panel: drag-to-reorder when viewing, static when editing.
  // `allowSpan` is false in the narrow side column (no two-column grid there).
  const renderPanel = (panel: PanelView, allowSpan = true) => {
    if (editing) return StaticCard(panel);
    return (
      <DraggablePanel
        key={panel.id}
        id={panel.id}
        title={panel.title}
        icon={panel.icon}
        dragging={dragging}
        dragOver={dragOver}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragEnd={handleDragEnd}
        style={allowSpan && panel.span ? { gridColumn: "1 / -1" } : {}}
      >
        {panel.content}
      </DraggablePanel>
    );
  };

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <button onClick={goBack} style={styles.backBtn}>
          <ArrowLeft size={14} /> Back to Members
        </button>
        {!canEdit && isMyYouth && !editing && (
          <button onClick={() => navigate(`/members/youth/${memberId}`)} style={styles.editBtn}>
            <Edit2 size={14} /> Edit Profile
          </button>
        )}
        {canEdit && !editing && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button onClick={startEdit} style={styles.editBtn}>
              <Edit2 size={14} /> Edit Profile
            </button>
            {canWrite("members.edit_others") && (
              <button onClick={() => setShowWelcomeEmail(true)} style={styles.welcomeEmailBtn}>
                <Mail size={14} /> Send Welcome Email
              </button>
            )}
            {/* #171: compose an email to this member from their record (like Visitors). */}
            {hasRole("Mentor", "Admin", "System Administrator") && (
              <button onClick={() => navigate(`/communications/compose?type=member&id=${memberId}`)} style={styles.welcomeEmailBtn}>
                <Mail size={14} /> Compose Email
              </button>
            )}
            {canWrite("members.edit_others") && (
              <button onClick={() => setShowConvert(true)} style={styles.convertBtn}>
                <RefreshCw size={14} /> Convert Role
              </button>
            )}
            {canWrite("members.system_permissions") && member.member_type === "youth" && member.is_junior_mentor && (
              <button onClick={() => setShowPromote(true)} style={styles.promoteBtn}>
                <Star size={14} /> Promote to Mentor
              </button>
            )}
            {canWrite("hof.manage") && member.member_type === "youth" && (
              <button onClick={handleGraduateToHoF} style={styles.hofBtn}>
                <Trophy size={14} /> Graduate to Hall of Fame
              </button>
            )}
            {isAdmin && (
              <button onClick={handleResetTC} style={styles.resetTcBtn}>
                <FileText size={14} /> Reset T&amp;C
              </button>
            )}
          </div>
        )}
        {editing && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flex: 1, justifyContent: "flex-end" }}>
            {/* Active / Inactive toggle — light status, freely reversible by admins */}
            {canWrite("members.edit_others") && !member.is_archived && (
              <button onClick={handleToggleActive}
                style={member.is_active ? styles.archiveBtn : styles.reactivateBtn}
                title={member.is_active ? "Mark inactive — excluded from the active-member count, but kept in the system" : "Restore to active"}>
                {member.is_active ? <><UserMinus size={14} /> Mark Inactive</> : <><UserCheck size={14} /> Mark Active</>}
              </button>
            )}
            {/* Archive / Unarchive — admin-only, left of the Cancel/Save group */}
            {isAdmin && (
              <button onClick={handleToggleAlumni}
                style={member.is_alumni ? styles.alumniOnBtn : styles.alumniOffBtn}
                title="Alumni is a permanent designation that stays even if their role changes">
                <GraduationCap size={14} /> {member.is_alumni ? "Remove Alumni" : "Mark Alumni"}
              </button>
            )}
            {canWrite("members.archive") && !member.is_archived && (
              <button onClick={handleArchive} style={styles.archiveBtn} title="Hide from reports, team lists, and check-ins">
                <Archive size={14} /> Archive Member
              </button>
            )}
            {member.is_archived && (
              isSysAdmin ? (
                <button onClick={handleUnarchive} style={styles.unarchiveBtn}>
                  <ArchiveRestore size={14} /> Un-Archive
                </button>
              ) : (
                <span style={styles.unarchiveNote}>
                  <Archive size={13} /> Archived — only a System Administrator can un-archive
                </span>
              )
            )}
            <div style={{ flex: 1 }} />
            <button onClick={() => setEditing(false)} style={styles.cancelBtn}>Cancel</button>
            <button onClick={saveEdit} style={styles.saveBtn} disabled={saving}>
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        )}
      </div>

      {/* T&C Warning — youth only, and only when we can confirm it's incomplete */}
      {tcWarning && canSeePrivate && (
        <div style={styles.tcWarning}>
          <AlertTriangle size={16} />
          <span>
            <strong>T&amp;C Incomplete:</strong>{" "}
            The Terms &amp; Conditions for the current enrollment year have not been
            fully signed. Both the member and a parent/guardian must sign before
            this youth member can check in to events.{" "}
            See the <strong>Enrollments</strong> panel below to complete the T&amp;C.
          </span>
        </div>
      )}

      {/* Profile hero */}
      <div style={styles.profileCard}>
        <div style={styles.avatarSection}>
          <PhotoUpload
            currentUrl={member.photo_url}
            initials={`${member.first_name[0]}${member.last_name[0]}`}
            size={80}
            disabled={!canEdit}
            onUploaded={async (url) => {
              await membersApi.update(memberId, { photo_url: url });
              setMember({ ...member, photo_url: url });
            }}
          />
          <div>
            <h1 style={styles.name}>{fullName}</h1>
            <div style={styles.badges}>
              <span style={{ ...styles.badge, background: TYPE_COLORS[member.member_type] ?? "#555" }}>
                {member.member_type}
              </span>
              {member.is_alumni && (
                <span style={{ ...styles.badge, background: "#b8860b", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <GraduationCap size={11} /> Alumni
                </span>
              )}
              {!member.is_active && <span style={{ ...styles.badge, background: "#c62828" }}>Inactive</span>}
              {member.is_archived && (
                <span style={{ ...styles.badge, background: "#6b7280", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Archive size={11} /> Archived
                </span>
              )}
              {/* T&C Signed badge — only for youth, only when we can confirm it */}
              {isYouth && enrollmentTCok === true &&
                <span style={{ ...styles.badge, background: "#2e7d32" }}>T&amp;C Signed</span>}
            </div>
            {canSeeMemberNumber && <div style={styles.memberNum}>Member #{member.member_number}</div>}
            {canSeeMemberNumber && member.username && (
              <div style={styles.subInfo}>Username: {member.username}</div>
            )}
            {member.date_joined && (
              <div style={styles.subInfo}>Joined: {formatDate(member.date_joined)}</div>
            )}
            <div style={{ marginTop: 6 }}>
              <ComplianceExemptBadge
                memberId={memberId}
                isComplianceExempt={member.is_compliance_exempt}
                exemptionStatus={member.exemption_status}
                onChanged={(flag, status) => setMember(prev => prev ? { ...prev, is_compliance_exempt: flag, exemption_status: status } : prev)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* View tabs — shown when there's an Account Info / Email page and/or the College Prep tab */}
      {(hasAccountTab || hasEmailTab || showCollegePrep || canSeeMedical) && (
        <div style={styles.viewTabs}>
          <button
            style={{ ...styles.viewTab, ...(activeView === "profile" ? styles.viewTabActive : {}) }}
            onClick={() => setView("profile")}
          >
            <User size={14} /> Profile
          </button>
          {showCollegePrep && (
            <button
              style={{ ...styles.viewTab, ...(activeView === "collegePrep" ? styles.viewTabActive : {}) }}
              onClick={() => setView("collegePrep")}
            >
              <GraduationCap size={14} /> College/Vo-Tech Prep
            </button>
          )}
          {canSeeMedical && (
            <button
              style={{ ...styles.viewTab, ...(activeView === "medical" ? styles.viewTabActive : {}) }}
              onClick={() => setView("medical")}
            >
              <HeartPulse size={14} /> Medical
            </button>
          )}
          {hasEmailTab && (
            <button
              style={{ ...styles.viewTab, ...(activeView === "email" ? styles.viewTabActive : {}) }}
              onClick={() => setView("email")}
            >
              <Mail size={14} /> Email
            </button>
          )}
          {hasAccountTab && (
            <button
              style={{ ...styles.viewTab, ...(activeView === "account" ? styles.viewTabActive : {}) }}
              onClick={() => setView("account")}
            >
              <Settings size={14} /> Account Info
            </button>
          )}
        </div>
      )}

      {activeView === "medical" ? (
        /* Medical Consent & Emergency Information — the form parents complete at
           registration, and that mentors complete for themselves. The season is
           global, so the logged-in user's enrollment year is the right one here. */
        <div style={{ background: "#fff", borderRadius: 10, padding: "1.25rem", border: "1px solid #e2e8f0" }}>
          <h3 style={styles.staticTitle}>
            <span style={{ marginRight: 6, opacity: 0.7 }}><HeartPulse size={15} /></span>
            Medical Consent &amp; Emergency Information
          </h3>
          <MedicalForm
            memberId={memberId}
            year={user?.enrollment_status?.enrollment_year ?? new Date().getFullYear()}
            embedded
            readOnly={!canEditMedical}
          />
        </div>
      ) : activeView === "collegePrep" ? (
        <CollegePrepPanel memberId={memberId} />
      ) : activeView === "account" ? (
        /* ── Account Info page — drag-to-reorder ── */
        <>
          {/* Parents can't edit these panels inline, but they CAN edit the same
              details on their youth-edit page — surface that path here so it's
              discoverable from this tab (not just the header). */}
          {isMyYouth && !canEdit && (
            <div style={styles.parentEditHint}>
              <span>To update your youth's contact, guardian, or emergency details, use their edit page.</span>
              <button onClick={() => navigate(`/members/youth/${memberId}`)} style={styles.editBtn}>
                <Edit2 size={14} /> Edit these details
              </button>
            </div>
          )}
          <div style={{ ...styles.panelGrid, ...(isMobile ? styles.panelGridMobile : {}) }}>
            {accountPanels.map((panel) => renderPanel(panel))}
          </div>
        </>
      ) : activeView === "email" ? (
        /* ── Email page: the System Email History pane(s) ── */
        <div style={{ ...styles.panelGrid, ...(isMobile ? styles.panelGridMobile : {}) }}>
          {emailPanels.map((panel) => renderPanel(panel))}
        </div>
      ) : (
        /* ── Profile view: main grid (+ optional side panel) ── */
        <>
          {!editing && (mainPanels.length > 0 || sidePanels.length > 0) && (
            <p style={styles.dragHint}>
              💡 Drag panels by the ⠿ handle to rearrange. Your layout is saved automatically.
            </p>
          )}
          <div style={{ ...styles.zoneRow, ...(isMobile ? { flexDirection: "column" } : {}) }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...styles.panelGrid, ...(isMobile ? styles.panelGridMobile : {}) }}>
                {mainPanels.map((panel) => renderPanel(panel))}
              </div>
              {/* TRC social links (#59) — org-wide; self-hides when none configured */}
              <div style={{ marginTop: 12 }}><SocialLinksPanel variant="panel" /></div>
            </div>

            {sidePanels.length > 0 && (
              <aside style={{ ...styles.sideColumn, ...(isMobile ? { width: "100%" } : {}) }}>
                {/* Side column is single-width — no spanning */}
                {sidePanels.map((panel) => renderPanel(panel, false))}
              </aside>
            )}
          </div>
        </>
      )}

      {successMsg && <div style={styles.successMsg}>{successMsg}</div>}

      {showWelcomeEmail && member && (
        <WelcomeEmailModal
          memberId={memberId}
          memberName={`${member.first_name} ${member.last_name}`}
          memberType={member.member_type}
          onClose={() => setShowWelcomeEmail(false)}
        />
      )}

      {showConvert && member && (
        <ConvertRoleModal
          member={member}
          onClose={() => setShowConvert(false)}
          onConverted={(newType) => {
            setMember(prev => prev ? { ...prev, member_type: newType } : prev);
            setShowConvert(false);
            setActionMsg(`${fullName} has been converted to ${TYPE_LABELS[newType] ?? newType}. Their access now matches the new role.`);
            setTimeout(() => setActionMsg(""), 8000);
          }}
        />
      )}

      {showPromote && member && (
        <PromoteMentorModal
          member={member}
          onClose={() => setShowPromote(false)}
          onPromoted={() => {
            setMember(prev => prev ? { ...prev, member_type: "mentor", is_junior_mentor: false } : prev);
            setShowPromote(false);
            setActionMsg(`${fullName} has been promoted to Mentor. They'll need to complete the annual T&C and FIRST compliance (YPT + background check).`);
            setTimeout(() => setActionMsg(""), 8000);
          }}
        />
      )}

      {isSelf && <TwoFactorPanel />}
      {!isSelf && isAdmin && (
        <div style={{ marginTop: 16, textAlign: "right" }}>
          <button
            onClick={async () => {
              if (!confirm(`Reset two-factor authentication for ${fullName}? They'll be able to sign in without a code and can set it up again.`)) return;
              try { await twoFactorApi.reset(memberId); setActionMsg("Two-factor authentication reset for this member."); setTimeout(() => setActionMsg(""), 5000); }
              catch { alert("Could not reset two-factor."); }
            }}
            style={{ padding: "7px 14px", background: "#fff", color: "#b45309", border: "1px solid #f0c896", borderRadius: 6, fontSize: 12.5, cursor: "pointer" }}
          >
            Reset 2FA
          </button>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function ProfilePrivacyPanel({ initial, onChange }: { initial: string[]; onChange: (next: string[]) => void }) {
  const [hidden, setHidden] = useState<string[]>(initial);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  async function toggle(key: string, makeVisible: boolean) {
    const next = makeVisible ? hidden.filter((k) => k !== key) : Array.from(new Set([...hidden, key]));
    setHidden(next);
    setSavingKey(key);
    try {
      await api.patch("/api/v1/auth/me/preferences", { private_sections: next });
      onChange(next);
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div>
      <p style={privacyStyles.intro}>
        Choose which sections other members can see on your profile. Admins and mentors can always see everything.
      </p>
      <div style={privacyStyles.list}>
        {HIDEABLE_PANES.map((p) => {
          const visible = !hidden.includes(p.key);
          return (
            <div key={p.key} style={privacyStyles.row}>
              <span style={privacyStyles.label}>{p.label}</span>
              <label style={{ ...privacyStyles.toggle, color: visible ? "#2e7d32" : "#c62828" }}>
                <input type="checkbox" checked={visible} disabled={savingKey === p.key}
                  onChange={(e) => toggle(p.key, e.target.checked)} />
                {visible ? "Visible to members" : "Hidden from members"}
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const privacyStyles: Record<string, React.CSSProperties> = {
  intro: { fontSize: 13, color: "#666", margin: "0 0 12px", lineHeight: 1.5 },
  list: { display: "flex", flexDirection: "column", gap: 6 },
  row: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "#f8fafc", border: "1px solid #eef1f5", borderRadius: 7 },
  label: { fontSize: 13, fontWeight: 600, color: "#1a3a5c" },
  toggle: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" },
};

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      title={copied ? "Copied!" : "Copy"}
      onClick={() => navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {})}
      style={{ background: "none", border: "none", cursor: "pointer", color: "#aaa", display: "inline-flex", alignItems: "center", padding: 2, flexShrink: 0 }}
    >
      {copied ? <Check size={13} color="#2e7d32" /> : <Copy size={13} />}
    </button>
  );
}
function InfoRow({ label, value, icon, copy }: { label: string; value?: string | null; icon?: React.ReactNode; copy?: string | null }) {
  if (!value) return null;
  return (
    <div style={styles.infoRow}>
      {icon && <span style={{ color: "#aaa", flexShrink: 0 }}>{icon}</span>}
      {label && <span style={styles.infoLabel}>{label}</span>}
      <span style={styles.infoValue}>{value}</span>
      {copy && <CopyBtn text={copy} />}
    </div>
  );
}

function EditRow({ label, value, onChange, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; type?: string;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <label style={styles.editLabel}>{label}</label>
      <input type={type} style={styles.editInput} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function AltEmailEdit({ label, email, enabled, onEmail, onToggle }: {
  label: string; email: string; enabled: boolean; onEmail: (v: string) => void; onToggle: (b: boolean) => void;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <label style={styles.editLabel}>{label}</label>
      <input type="email" style={styles.editInput} value={email} placeholder="name@example.com" onChange={(e) => onEmail(e.target.value)} />
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#555", marginTop: 4, cursor: "pointer" }}>
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} /> Also send emails to this address
      </label>
    </div>
  );
}

const TYPE_COLORS: Record<string, string> = {
  youth: "#1565c0", mentor: "#2e7d32", parent: "#e65100", volunteer: "#6a1b9a",
};

// ── Styles ──────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 960, margin: "0 auto" },
  center: { textAlign: "center", padding: "3rem", color: "#888" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 },
  backBtn: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0 },
  editBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  welcomeEmailBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  convertBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#6a1b9a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  promoteBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  hofBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#b8860b", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  resetTcBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#fff", color: "#c62828", border: "1px solid #ef9a9a", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  cancelBtn: { padding: "8px 16px", border: "1px solid #ccc", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 13 },
  saveBtn: { padding: "8px 20px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  archiveBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", border: "1px solid #d1763a", background: "#fff", color: "#b45309", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  alumniOffBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", border: "1px solid #b8860b", background: "#fff", color: "#8a5a00", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  alumniOnBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", border: "1px solid #b8860b", background: "#b8860b", color: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  unarchiveBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#6b7280", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  reactivateBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", border: "1px solid #2e7d32", background: "#fff", color: "#2e7d32", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  unarchiveNote: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#6b7280", fontStyle: "italic" },
  tcWarning: { display: "flex", alignItems: "center", gap: 10, background: "#fff8e1", border: "1px solid #ffc107", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#795548" },
  profileCard: { background: "#fff", borderRadius: 12, padding: "1.5rem", marginBottom: 12, border: "1px solid #e2e8f0" },
  avatarSection: { display: "flex", alignItems: "center", gap: 20 },
  name: { margin: "0 0 6px", fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  badges: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 },
  badge: { padding: "2px 10px", borderRadius: 12, color: "#fff", fontSize: 11, fontWeight: 600, textTransform: "capitalize" as const },
  memberNum: { fontSize: 13, color: "#666", fontWeight: 600 },
  subInfo: { fontSize: 12, color: "#888", marginTop: 2 },
  dragHint: { fontSize: 12, color: "#aaa", margin: "0 0 10px", textAlign: "right" as const },
  parentEditHint: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" as const, justifyContent: "space-between", padding: "10px 14px", marginBottom: 12, background: "#eef4fb", border: "1px solid #cfe0f3", borderRadius: 8, fontSize: 13, color: "#1a3a5c" },
  panelGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "start" },
  panelGridMobile: { gridTemplateColumns: "1fr" },
  zoneRow: { display: "flex", gap: 12, alignItems: "flex-start" },
  sideColumn: { width: 300, flexShrink: 0, display: "flex", flexDirection: "column", gap: 12 },
  viewTabs: { display: "flex", gap: 6, marginBottom: 14, borderBottom: "1px solid #e2e8f0" },
  viewTab: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "none", border: "none", borderBottom: "2px solid transparent", marginBottom: -1, color: "#888", cursor: "pointer", fontSize: 13, fontWeight: 600 },
  // Use the full `borderBottom` shorthand here (not the `borderBottomColor` longhand): the
  // base .viewTab sets `borderBottom`, and mixing shorthand + longhand makes React fail to
  // reset the color when a tab goes inactive, leaving the previously-selected tab's bar dark.
  viewTabActive: { color: "#1a3a5c", borderBottom: "2px solid #1a3a5c" },
  staticTitle: { margin: "0 0 12px", fontSize: 12, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase" as const, letterSpacing: 0.5, display: "flex", alignItems: "center", borderBottom: "1px solid #f0f4f8", paddingBottom: 8 },
  infoRow: { display: "flex", alignItems: "baseline", gap: 6, marginBottom: 6, fontSize: 13 },
  infoLabel: { color: "#888", minWidth: 90, fontSize: 12 },
  infoValue: { color: "#222", flex: 1 },
  guardianBlock: { paddingLeft: 0 },
  guardianName: { fontWeight: 600, fontSize: 14, color: "#1a3a5c", marginBottom: 4 },
  createParentBtn: { display: "inline-flex", alignItems: "center", gap: 5, marginTop: 8, padding: "5px 11px", background: "#eef0fb", color: "#3949ab", border: "1px solid #c5cae9", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 },
  viewParentBtn: { display: "inline-flex", alignItems: "center", gap: 5, marginTop: 8, padding: "5px 10px", border: "1px solid #cdd7e3", background: "#fff", borderRadius: 6, fontSize: 11.5, fontWeight: 600, color: "#4a5b6d", cursor: "pointer" },
  notes: { fontSize: 13, color: "#444", margin: 0, lineHeight: 1.6 },
  sectionNote: { margin: "0 0 6px", fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase" as const },
  checkLabel: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginTop: 6, cursor: "pointer" },
  editLabel: { display: "block", fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 3 },
  gradeHint: { fontSize: 11.5, color: "#7a8899", margin: "-2px 0 10px", lineHeight: 1.45 },
  editInput: { width: "100%", padding: "7px 9px", border: "1px solid #ccc", borderRadius: 5, fontSize: 13, boxSizing: "border-box" as const },
  textarea: { width: "100%", minHeight: 80, padding: "8px 10px", border: "1px solid #ccc", borderRadius: 5, fontSize: 13, resize: "vertical" as const, boxSizing: "border-box" as const },
  successMsg: { position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 2000, background: "#e8f5e9", border: "1px solid #66bb6a", borderRadius: 8, padding: "12px 20px", color: "#1b5e20", fontSize: 14, fontWeight: 600, boxShadow: "0 6px 24px rgba(0,0,0,0.18)", maxWidth: "90vw" },
};

// ── PromoteMentorModal ────────────────────────────────────────────────────────

function PromoteMentorModal({ member, onClose, onPromoted }: {
  member: { id: number; first_name: string; last_name: string };
  onClose: () => void;
  onPromoted: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  async function doPromote() {
    if (!confirmed) { setError("Please check the confirmation box before promoting."); return; }
    setSaving(true); setError("");
    try {
      await membersApi.promoteToMentor(member.id);
      onPromoted();
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Promotion failed. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div style={cm.overlay} onClick={onClose}>
      <div style={cm.modal} onClick={e => e.stopPropagation()}>
        <h2 style={cm.title}><Star size={18} /> Promote to Mentor</h2>
        <p style={cm.intro}>
          Promote <strong>{member.first_name} {member.last_name}</strong> from{" "}
          <span style={{ ...cm.typePill, background: "#1565c0" }}>Junior Mentor</span> to a full{" "}
          <span style={{ ...cm.typePill, background: "#2e7d32" }}>Mentor</span>.
        </p>
        <div style={{ ...cm.optionDesc, marginBottom: 14, lineHeight: 1.6 }}>
          This will:
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            <li>Change their member type from Youth to Mentor and clear the Junior Mentor flag.</li>
            <li>Move them from the youth certification pool to the mentor pool.</li>
            <li>Require the annual mentor Terms &amp; Conditions (prompted at next login).</li>
            <li>Require FIRST compliance — Youth Protection Training (YPT) and a background check — which will show as outstanding until completed.</li>
          </ul>
        </div>
        <label style={{ ...cm.option, cursor: "pointer", marginBottom: 12 }}>
          <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} style={{ accentColor: "#2e7d32" }} />
          <span style={{ fontSize: 13 }}>I confirm this Junior Mentor should become a full Mentor.</span>
        </label>
        {error && <div style={cm.error}>{error}</div>}
        <div style={cm.actions}>
          <button style={cm.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={{ ...cm.convertBtn, background: "#2e7d32" }} onClick={doPromote} disabled={saving}>
            {saving ? "Promoting…" : "Promote to Mentor"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ConvertRoleModal ──────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  mentor:    "Mentor",
  parent:    "Parent / Guardian",
  volunteer: "Volunteer",
  youth:     "Youth Member",
};

const TYPE_DESCRIPTIONS: Record<string, string> = {
  mentor:    "Can lead teams, manage events, and access mentor-level features. Requires annual T&C and FIRST compliance.",
  parent:    "Guardian-level access. Can view their youth member's profile and attend events.",
  volunteer: "Event volunteer access. Can check in to events without full enrollment requirements.",
  youth:     "A youth participant. Use this to fix someone entered as an adult by mistake. Their permissions switch to Youth Member; afterwards, complete their youth details (birthday, grade, guardian, T&C) on the profile.",
};

function ConvertRoleModal({
  member,
  onClose,
  onConverted,
}: {
  member: { id: number; first_name: string; last_name: string; member_type: string };
  onClose: () => void;
  onConverted: (newType: string) => void;
}) {
  const currentType = member.member_type;
  const options = Object.keys(TYPE_LABELS).filter(t => t !== currentType);
  const [selected, setSelected] = useState(options[0] ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  async function doConvert() {
    if (!confirmed) { setError("Please check the confirmation box before converting."); return; }
    setSaving(true);
    setError("");
    try {
      await membersApi.convertType(member.id, selected);
      onConverted(selected);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail ?? "Conversion failed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={cm.overlay} onClick={onClose}>
      <div style={cm.modal} onClick={e => e.stopPropagation()}>
        <h2 style={cm.title}><RefreshCw size={18} /> Convert Member Role</h2>
        <p style={cm.intro}>
          Converting <strong>{member.first_name} {member.last_name}</strong> from{" "}
          <span style={{ ...cm.typePill, background: "#6a1b9a" }}>{TYPE_LABELS[currentType] ?? currentType}</span>
          {" "}to a new role.
        </p>

        <div style={cm.fieldLabel}>New Role</div>
        <div style={cm.optionList}>
          {options.map(t => (
            <label key={t} style={{ ...cm.option, ...(selected === t ? cm.optionSelected : {}) }}>
              <input
                type="radio"
                name="new_type"
                value={t}
                checked={selected === t}
                onChange={() => setSelected(t)}
                style={{ accentColor: "#6a1b9a" }}
              />
              <div>
                <div style={cm.optionTitle}>{TYPE_LABELS[t]}</div>
                <div style={cm.optionDesc}>{TYPE_DESCRIPTIONS[t]}</div>
              </div>
            </label>
          ))}
        </div>

        <div style={cm.warningBox}>
          <strong>⚠ Note:</strong> This changes the member's access level immediately.
          Panels and compliance requirements shown on their profile will update to match their new role.
          Existing enrollments and check-in history are preserved.
        </div>

        <label style={cm.confirmRow}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={e => setConfirmed(e.target.checked)}
            style={{ accentColor: "#6a1b9a" }}
          />
          I understand this will change {member.first_name}'s role from{" "}
          <strong>{TYPE_LABELS[currentType] ?? currentType}</strong> to{" "}
          <strong>{TYPE_LABELS[selected] ?? selected}</strong>.
        </label>

        {error && <p style={cm.error}>{error}</p>}

        <div style={cm.actions}>
          <button style={cm.cancelBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button style={cm.convertBtn} onClick={doConvert} disabled={saving || !selected}>
            {saving ? "Converting…" : `Convert to ${TYPE_LABELS[selected] ?? selected}`}
          </button>
        </div>
      </div>
    </div>
  );
}

const cm: Record<string, React.CSSProperties> = {
  overlay:      { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
  modal:        { background: "#fff", borderRadius: 14, padding: "28px 32px", width: "100%", maxWidth: 520, boxShadow: "0 8px 40px rgba(0,0,0,0.18)" },
  title:        { display: "flex", alignItems: "center", gap: 10, fontSize: 20, fontWeight: 800, color: "#1a3a5c", margin: "0 0 14px" },
  intro:        { fontSize: 14, color: "#444", margin: "0 0 18px", lineHeight: 1.6 },
  typePill:     { display: "inline-block", color: "#fff", borderRadius: 6, padding: "2px 10px", fontSize: 12, fontWeight: 700, textTransform: "capitalize" as const },
  fieldLabel:   { fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 8 },
  optionList:   { display: "flex", flexDirection: "column" as const, gap: 8, marginBottom: 18 },
  option:       { display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px", border: "2px solid #e2e8f0", borderRadius: 9, cursor: "pointer" },
  optionSelected:{ borderColor: "#6a1b9a", background: "#faf0ff" },
  optionTitle:  { fontWeight: 700, fontSize: 14, color: "#1a3a5c" },
  optionDesc:   { fontSize: 12, color: "#666", marginTop: 2, lineHeight: 1.5 },
  warningBox:   { background: "#fff8e1", border: "1px solid #ffd54f", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#795548", marginBottom: 16, lineHeight: 1.6 },
  confirmRow:   { display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, color: "#444", cursor: "pointer", marginBottom: 18, lineHeight: 1.6 },
  error:        { color: "#c62828", fontSize: 13, margin: "0 0 12px" },
  actions:      { display: "flex", justifyContent: "flex-end" as const, gap: 10 },
  cancelBtn:    { padding: "9px 20px", border: "1px solid #ccc", borderRadius: 7, background: "#fff", cursor: "pointer", fontSize: 14 },
  convertBtn:   { padding: "9px 22px", background: "#6a1b9a", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 700, fontSize: 14 },
};



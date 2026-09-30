import { api } from "../../core/api";

export const rolesApi = {
  // Config
  getYLCRoles: () => api.get("/api/v1/roles/config/ylc-roles").then(r => r.data as string[]),
  getExpertise: () => api.get("/api/v1/roles/config/expertise").then(r => r.data as string[]),

  // YLC
  listYLC: (term?: string) =>
    api.get("/api/v1/roles/ylc", { params: term ? { term } : {} }).then(r => r.data as YouthRoleRecord[]),
  listYLCTerms: () => api.get("/api/v1/roles/ylc/terms").then(r => r.data as string[]),
  getYouthRole: (memberId: number) =>
    api.get(`/api/v1/roles/youth/${memberId}`).then(r => r.data as YouthRoleRecord),
  updateYouthRole: (memberId: number, data: Partial<YouthRoleRecord>) =>
    api.put(`/api/v1/roles/youth/${memberId}`, data).then(r => r.data as YouthRoleRecord),
  addYLCTerm: (memberId: number, data: { term?: string; role?: string; notes?: string }) =>
    api.post(`/api/v1/roles/youth/${memberId}/ylc-terms`, data).then(r => r.data as YouthRoleRecord),
  deleteYLCTerm: (recordId: number) =>
    api.delete(`/api/v1/roles/ylc-terms/${recordId}`).then(r => r.data),

  // Youth compliance dashboard
  listYouthCompliance: (compliantOnly?: boolean) =>
    api.get("/api/v1/roles/youth-compliance", {
      params: compliantOnly != null ? { compliant_only: compliantOnly } : {}
    }).then(r => r.data as { season: string; youth: YouthComplianceRecord[] }),

  // Adult / Mentor
  listAdults: (compliantOnly?: boolean) =>
    api.get("/api/v1/roles/adults", {
      params: compliantOnly != null ? { compliant_only: compliantOnly } : {}
    }).then(r => r.data as AdultRoleRecord[]),
  getAdultRole: (memberId: number) =>
    api.get(`/api/v1/roles/adult/${memberId}`).then(r => r.data as AdultRoleRecord),
  updateAdultRole: (
    memberId: number,
    // dates accept null to explicitly clear a stored/erroneous value (#82)
    data: Partial<Omit<AdultRoleRecord, "ypt_date" | "background_check_date" | "first_date" | "consent_release_date" | "role_specific_date">> &
      { ypt_date?: string | null; background_check_date?: string | null; first_date?: string | null; consent_release_date?: string | null; role_specific_date?: string | null },
  ) =>
    api.put(`/api/v1/roles/adult/${memberId}`, data).then(r => r.data as AdultRoleRecord),
  deleteComplianceRecord: (memberId: number, recordId: number) =>
    api.delete(`/api/v1/roles/adult/${memberId}/compliance-record/${recordId}`).then(r => r.data),

  // Compliance item configuration (labels / applies / gates check-in)
  complianceItems: () =>
    api.get("/api/v1/roles/compliance/items").then(r => r.data as { items: ComplianceItem[]; can_edit: boolean }),
  saveComplianceItems: (items: ComplianceItem[]) =>
    api.put("/api/v1/roles/compliance/items", { items }).then(r => r.data as { items: ComplianceItem[] }),
};

export interface ComplianceItem {
  key: string;
  label: string;
  short: string;
  enabled: boolean;
  gates_checkin: boolean;
}

export interface YLCTermRecord {
  id: number;
  term?: string | null;
  role: string;
  notes?: string | null;
}

export interface YouthRoleRecord {
  member_id: number;
  first_name: string;
  last_name: string;
  photo_url?: string;
  ylc_member: boolean;
  ylc_role?: string;
  ylc_term?: string;
  ylc_history?: YLCTermRecord[];
}

export interface YouthComplianceRecord {
  member_id: number;
  first_name: string;
  last_name: string;
  photo_url?: string;
  enrolled: boolean;
  trc_tc: boolean;
  first_registered: boolean;
  first_tc: boolean;
  on_team: boolean;
  is_compliant: boolean;
}

export interface AdultRoleRecord {
  member_id: number;
  first_name: string;
  last_name: string;
  photo_url?: string;
  ypt_complete: boolean;
  ypt_date?: string;
  background_check_complete: boolean;
  background_check_date?: string;
  first_complete: boolean;
  first_date?: string;
  consent_release_complete?: boolean;
  consent_release_date?: string;
  role_specific_complete?: boolean;
  role_specific_date?: string;
  trc_tc: boolean;
  trc_tc_date?: string;
  role?: string;
  areas_of_expertise: string[];
  service_years: number;
  on_hold: boolean;
  on_hold_note?: string;
  is_compliant: boolean;
  member_type?: string | null;
  requires_ypt?: boolean;   // #182 — a "TRC Volunteer" held to mentor-level YPT compliance
}

import { api } from "../../core/api";

export const familiesApi = {
  list: () =>
    api.get("/api/v1/families/").then(r => r.data as Family[]),

  getMemberFamily: (memberId: number) =>
    api.get(`/api/v1/families/member/${memberId}`)
       .then(r => r.data as Family | null),

  create: (data: { family_name?: string; member_ids: number[] }) =>
    api.post("/api/v1/families/", data).then(r => r.data as Family),

  update: (familyId: number, data: { family_name?: string }) =>
    api.patch(`/api/v1/families/${familyId}`, data).then(r => r.data as Family),

  addMember: (familyId: number, data: { member_id: number; relationship_label?: string; is_primary_contact?: boolean }) =>
    api.post(`/api/v1/families/${familyId}/members`, data).then(r => r.data as Family),

  updateMember: (familyId: number, memberId: number, data: { relationship_label?: string; is_primary_contact?: boolean }) =>
    api.patch(`/api/v1/families/${familyId}/members/${memberId}`, data).then(r => r.data as Family),

  removeMember: (familyId: number, memberId: number) =>
    api.delete(`/api/v1/families/${familyId}/members/${memberId}`).then(r => r.data),

  deleteFamily: (familyId: number) =>
    api.delete(`/api/v1/families/${familyId}`).then(r => r.data),
};

export interface FamilyMemberRecord {
  family_member_id: number;
  member_id: number;
  member_number: string;
  first_name: string;
  last_name: string;
  member_type: string;
  photo_url?: string;
  email?: string;
  phone?: string;
  relationship_label?: string;
  is_primary_contact: boolean;
  is_active: boolean;
}

export interface Family {
  id: number;
  family_name?: string;
  created_at: string;
  members: FamilyMemberRecord[];
}

// Common relationship labels for the dropdown
export const RELATIONSHIP_LABELS = [
  "Parent", "Guardian", "Stepparent", "Foster Parent",
  "Child", "Stepchild",
  "Sibling", "Half-sibling", "Stepsibling",
  "Spouse / Partner",
  "Grandparent", "Grandchild",
  "Other",
];

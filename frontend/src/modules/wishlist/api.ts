import { api } from "../../core/api";

export const PRIORITIES = [
  { value: "urgent", label: "Urgent", color: "#c62828" },
  { value: "high",   label: "High",   color: "#e65100" },
  { value: "normal", label: "Normal", color: "#1565c0" },
  { value: "low",    label: "Low",    color: "#6b7280" },
];
export const STATUSES = [
  { value: "open",      label: "Open",      color: "#1565c0" },
  { value: "fulfilled", label: "Fulfilled", color: "#2e7d32" },
  { value: "archived",  label: "Archived",  color: "#6b7280" },
];

export interface WishItem {
  id: number;
  scope: "trc" | "team";
  team_season_id: number | null;
  team_label: string | null;
  name: string;
  description: string | null;
  url: string | null;
  price: number | null;
  quantity: number;
  priority: "low" | "normal" | "high" | "urgent";
  is_asset: boolean;
  status: "open" | "fulfilled" | "archived";
  fulfilled_qty: number;
  remaining_qty: number;
  donation_count: number;
  needs_thanks: boolean;
  fulfilled_date: string | null;
  fulfilled_amount: number | null;
  donor_member_id: number | null;
  donor_sponsor_id: number | null;
  donor_name: string | null;
  donor_display: string | null;
  fulfilled_notes: string | null;
  linked_inv_item_id: number | null;
  linked_asset_name: string | null;
  linked_asset_tag: string | null;
  requested_by_id: number | null;
  requested_by_name: string | null;
}

export interface FulfillPayload {
  donor_member_id?: number | null;
  donor_sponsor_id?: number | null;
  donor_name?: string | null;
  quantity?: number | null;
  amount?: number | null;
  date?: string | null;
  notes?: string | null;
  thanked?: boolean;
  create_asset?: boolean;
  asset_type?: "asset_tagged" | "asset_nontagged";
}

export interface WishDonation {
  id: number;
  wish_id: number;
  quantity: number;
  amount: number | null;
  donor_display: string | null;
  donor_member_id: number | null;
  donor_sponsor_id: number | null;
  fulfilled_date: string | null;
  notes: string | null;
  thanked: boolean;
  thanked_date: string | null;
  thanked_by_name: string | null;
}

export const wishlistApi = {
  list: (params?: Record<string, string>) =>
    api.get("/api/v1/wishlist", { params }).then((r) => r.data as WishItem[]),
  create: (data: Record<string, unknown>) =>
    api.post("/api/v1/wishlist", data).then((r) => r.data as WishItem),
  update: (id: number, data: Record<string, unknown>) =>
    api.patch(`/api/v1/wishlist/${id}`, data).then((r) => r.data as WishItem),
  remove: (id: number) => api.delete(`/api/v1/wishlist/${id}`).then((r) => r.data),
  fulfill: (id: number, data: FulfillPayload) =>
    api.post(`/api/v1/wishlist/${id}/fulfill`, data).then((r) => r.data as WishItem),
  donations: (id: number) =>
    api.get(`/api/v1/wishlist/${id}/donations`).then((r) => r.data as WishDonation[]),
  updateDonation: (donationId: number, data: { thanked?: boolean; quantity?: number; amount?: number | null; donor_name?: string; fulfilled_date?: string | null; notes?: string | null }) =>
    api.patch(`/api/v1/wishlist/donations/${donationId}`, data).then((r) => r.data as WishItem),
  deleteDonation: (donationId: number) =>
    api.delete(`/api/v1/wishlist/donations/${donationId}`).then((r) => r.data as WishItem),
  // shared helpers
  teams: () =>
    api.get("/api/v1/teams/").then((r) =>
      (r.data as { team_number: string; current_season?: { id: number; season: string; team_name?: string } }[])
        .filter((t) => t.current_season?.id)
        .map((t) => ({
          id: t.current_season!.id,
          label: `#${t.team_number} ${t.current_season!.team_name ?? ""} · ${t.current_season!.season}`,
        }))),
  searchMembers: (q: string) =>
    api.get("/api/v1/members/", { params: { search: q } })
      .then((r) => (r.data as { members: { id: number; first_name: string; last_name: string }[] }).members),
  sponsors: () =>
    api.get("/api/v1/sponsors/").then((r) => r.data as { id: number; name: string }[]),
};

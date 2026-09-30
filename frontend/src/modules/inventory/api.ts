import { api } from "../../core/api";

export type ItemType = "asset_tagged" | "asset_nontagged" | "part" | "consumable" | "battery";

export const ITEM_TYPE_LABELS: Record<string, string> = {
  asset_tagged: "Asset (Tagged)",
  asset_nontagged: "Asset (Non-Tagged)",
  part: "Part",
  consumable: "Consumable",
  battery: "Battery",
};

export interface AssetCategory { id: number; name: string; sort_order: number; item_count: number; }

export interface CatalogCategory {
  id: number;
  name: string;
  parent_id?: number | null;
  icon_name: string;
  color: string;
  display_order: number;
  item_count: number;
  children: CatalogCategory[];
}

export interface CatalogVendor {
  vendor_id: number | null;
  vendor_name: string;
  item_count: number;
}

export interface InvHolding {
  id: number;
  location_id: number | null;
  team_season_id: number | null;
  kind: "location" | "team" | "unassigned";
  label: string;
  quantity: number;
  rack?: string | null;
  shelf?: string | null;
  bin?: string | null;
}

export interface LocationContentsRow {
  item_id: number;
  name: string;
  part_number?: string | null;
  item_type: string;
  unit_of_measure?: string | null;
  location_id: number;
  location_name: string;
  rack?: string | null;
  shelf?: string | null;
  bin?: string | null;
  quantity: number | null;
}

export interface InvKitComponent {
  id: number;
  component_item_id: number;
  name: string;
  part_number?: string | null;
  unit_of_measure?: string | null;
  quantity: number;
}

export interface InvItemSource {
  id: number;
  vendor_id: number;
  vendor_name: string;
  vendor_part_number?: string | null;
  price?: number | null;
  url?: string | null;
  is_preferred: boolean;
  notes?: string | null;
}

export interface InvItem {
  id: number;
  item_type: ItemType;
  name: string;
  holdings?: InvHolding[];
  sources?: InvItemSource[];
  is_kit?: boolean;
  kit_components?: InvKitComponent[];
  category?: string;
  subcategory?: string;
  category_id?: number | null;
  category_name?: string;
  asset_category_id?: number | null;
  asset_category_name?: string | null;
  is_donated?: boolean;
  donor_member_id?: number | null;
  donor_member_name?: string | null;
  donor_sponsor_id?: number | null;
  donor_sponsor_name?: string | null;
  donor_name?: string | null;
  donation_date?: string | null;
  donor_display?: string | null;
  description?: string;
  part_number?: string;
  asset_tag?: string;
  serial_number?: string;
  url?: string;
  vendor_id?: number;
  vendor_name?: string;
  location_id?: number;
  location_path?: string;
  location_spot?: { rack?: string | null; shelf?: string | null; bin?: string | null } | null;
  assigned_team_season_id?: number;
  assigned_team?: string;
  unit_of_measure?: string;
  package_quantity?: number;
  current_quantity?: number;
  minimum_stock_level?: number;
  reorder_flag?: boolean;
  low_stock?: boolean;
  open_repairs?: number;
  is_discontinued?: boolean;
  cost?: number;
  purchase_date?: string;
  warranty_info?: string;
  maintenance_schedule?: string;
  status?: string;
  battery_type?: string;
  retirement_date?: string;
  tags?: string[];
  notes?: string;
  color?: string | null;
  length?: string | null;
  pitch?: string | null;
  pattern?: string | null;
  inner_diameter?: string | null;
  outer_diameter?: string | null;
  measurement_system?: "metric" | "imperial" | "na";
  movements?: Movement[];
  photos?: ItemPhoto[];
}

export interface ItemPhoto {
  id: number;
  url: string;
  caption?: string | null;
  display_order: number;
}

export interface Movement {
  id: number;
  movement_type: string;
  quantity?: number;
  reason?: string;
  notes?: string;
  actor?: string;
  created_at?: string;
}

export interface Vendor {
  id: number;
  name: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  url?: string;
  account_number?: string;
  notes?: string;
  is_active: boolean;
}

export interface InvLocation {
  id: number;
  name: string;
  kind: string;
  parent_id?: number;
  path?: string;
  notes?: string;
}

export interface InventorySummary {
  total_items: number;
  low_stock: number;
  tagged_assets: number;
  estimated_valuation: number;
  by_type: Record<string, number>;
}

export const inventoryApi = {
  summary: () => api.get("/api/v1/inventory/summary").then(r => r.data as InventorySummary),
  categoryNames: () => api.get("/api/v1/inventory/category-names").then(r => r.data as string[]),

  // Catalog taxonomy (browse categories → subcategories)
  listCategories: () => api.get("/api/v1/inventory/categories").then(r => r.data as CatalogCategory[]),
  listAssetCategories: () => api.get("/api/v1/inventory/asset-categories").then(r => r.data as AssetCategory[]),
  createAssetCategory: (name: string) => api.post("/api/v1/inventory/asset-categories", { name }).then(r => r.data as AssetCategory),
  updateAssetCategory: (id: number, data: { name?: string; sort_order?: number }) => api.patch(`/api/v1/inventory/asset-categories/${id}`, data).then(r => r.data),
  deleteAssetCategory: (id: number) => api.delete(`/api/v1/inventory/asset-categories/${id}`).then(r => r.data),
  // Donor pickers
  searchDonorMembers: (q: string) =>
    api.get("/api/v1/members/", { params: { search: q, is_active: true, limit: 15 } })
      .then(r => (r.data.members ?? r.data ?? []) as { id: number; first_name: string; last_name: string; member_type: string }[]),
  listSponsors: () => api.get("/api/v1/sponsors/").then(r => (r.data.sponsors ?? r.data ?? []) as { id: number; name: string }[]),
  createCategory: (data: Record<string, unknown>) =>
    api.post("/api/v1/inventory/categories", data).then(r => r.data),
  updateCategory: (id: number, data: Record<string, unknown>) =>
    api.patch(`/api/v1/inventory/categories/${id}`, data).then(r => r.data),
  deleteCategory: (id: number) =>
    api.delete(`/api/v1/inventory/categories/${id}`).then(r => r.data),
  categoryVendors: (id: number) =>
    api.get(`/api/v1/inventory/categories/${id}/vendors`).then(r => r.data as CatalogVendor[]),

  listItems: (params?: Record<string, string | number | boolean>) =>
    api.get("/api/v1/inventory/items", { params }).then(r => r.data as { total: number; items: InvItem[] }),
  getItem: (id: number) => api.get(`/api/v1/inventory/items/${id}`).then(r => r.data as InvItem),
  getByTag: (tag: string) => api.get(`/api/v1/inventory/items/by-tag/${encodeURIComponent(tag)}`).then(r => r.data as InvItem),
  getByPartNumber: (partNumber: string) => api.get("/api/v1/inventory/items/lookup", { params: { part_number: partNumber } }).then(r => r.data as InvItem),
  createItem: (data: Record<string, unknown>) => api.post("/api/v1/inventory/items", data).then(r => r.data as InvItem),
  createItemsBulk: (data: Record<string, unknown>) =>
    api.post("/api/v1/inventory/items/bulk", data).then(r => r.data as { created: number; items: InvItem[] }),
  updateItem: (id: number, data: Record<string, unknown>) => api.patch(`/api/v1/inventory/items/${id}`, data).then(r => r.data as InvItem),
  moveItem: (id: number, data: Record<string, unknown>) => api.post(`/api/v1/inventory/items/${id}/move`, data).then(r => r.data as InvItem),
  transferStock: (id: number, data: Record<string, unknown>) => api.post(`/api/v1/inventory/items/${id}/transfer`, data).then(r => r.data as { ok: boolean; holdings: InvHolding[] }),
  setLocationBin: (id: number, data: { location_id: number; rack?: string | null; shelf?: string | null; bin?: string | null }) =>
    api.put(`/api/v1/inventory/items/${id}/location-bin`, data).then(r => r.data as { ok: boolean; holdings: InvHolding[] }),
  locationContents: (locationId: number) =>
    api.get(`/api/v1/inventory/locations/${locationId}/contents`).then(r => r.data as { location: { id: number; name: string }; items: LocationContentsRow[] }),
  setKitComponents: (id: number, components: { component_item_id: number; quantity: number }[]) =>
    api.put(`/api/v1/inventory/items/${id}/kit-components`, { components }).then(r => r.data as { ok: boolean; kit_components: InvKitComponent[] }),
  setItemSources: (id: number, sources: Partial<InvItemSource>[]) =>
    api.put(`/api/v1/inventory/items/${id}/sources`, { sources }).then(r => r.data as { ok: boolean; sources: InvItemSource[] }),
  // Photos: upload a file to /uploads/photo, then attach its URL to the item.
  uploadPhoto: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post("/api/v1/uploads/photo", fd).then(r => r.data as { url: string; filename: string; name: string });
  },
  addItemPhotos: (id: number, photos: { url: string; caption?: string | null }[]) =>
    api.post(`/api/v1/inventory/items/${id}/photos`, { photos }).then(r => r.data as ItemPhoto[]),
  updateItemPhoto: (photoId: number, caption: string | null) =>
    api.patch(`/api/v1/inventory/photos/${photoId}`, { caption }).then(r => r.data as ItemPhoto[]),
  deleteItemPhoto: (photoId: number) =>
    api.delete(`/api/v1/inventory/photos/${photoId}`).then(r => r.data as ItemPhoto[]),
  reorderItemPhotos: (id: number, order: number[]) =>
    api.put(`/api/v1/inventory/items/${id}/photos/order`, { order }).then(r => r.data as ItemPhoto[]),
  retireItem: (id: number) => api.delete(`/api/v1/inventory/items/${id}`).then(r => r.data),
  reactivateItem: (id: number) => api.post(`/api/v1/inventory/items/${id}/reactivate`).then(r => r.data as InvItem),
  deleteItem: (id: number) => api.delete(`/api/v1/inventory/items/${id}/permanent`).then(r => r.data),
  importItems: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post("/api/v1/inventory/items/import", fd).then(r => r.data as { ok: boolean; created: number; updated: number; errors: string[] });
  },
  backfillCategoryLinks: () =>
    api.post("/api/v1/inventory/categories/backfill").then(r => r.data as { ok: boolean; examined: number; linked: number }),
  mergeTeamClones: () =>
    api.post("/api/v1/inventory/items/merge-team-clones").then(r => r.data as { ok: boolean; examined: number; merged: number; converted: number }),

  listVendors: (includeInactive = false) =>
    api.get("/api/v1/inventory/vendors", { params: { include_inactive: includeInactive } }).then(r => r.data as Vendor[]),
  createVendor: (data: Record<string, unknown>) => api.post("/api/v1/inventory/vendors", data).then(r => r.data),
  updateVendor: (id: number, data: Record<string, unknown>) => api.patch(`/api/v1/inventory/vendors/${id}`, data).then(r => r.data),
  toggleVendor: (id: number) => api.patch(`/api/v1/inventory/vendors/${id}/toggle`).then(r => r.data),
  deleteVendor: (id: number) => api.delete(`/api/v1/inventory/vendors/${id}`).then(r => r.data),

  listLocations: () => api.get("/api/v1/inventory/locations").then(r => r.data as InvLocation[]),
  createLocation: (data: Record<string, unknown>) => api.post("/api/v1/inventory/locations", data).then(r => r.data),
  updateLocation: (id: number, data: Record<string, unknown>) => api.patch(`/api/v1/inventory/locations/${id}`, data).then(r => r.data),
  deleteLocation: (id: number) => api.delete(`/api/v1/inventory/locations/${id}`).then(r => r.data),

  // ── Budgets ──
  getTeamBudget: (teamSeasonId: number) =>
    api.get(`/api/v1/inventory/teams/${teamSeasonId}/budget`).then(r => r.data as TeamBudget),
  createBudgetCategory: (teamSeasonId: number, data: Record<string, unknown>) =>
    api.post(`/api/v1/inventory/teams/${teamSeasonId}/budget`, data).then(r => r.data),
  setCarryover: (teamSeasonId: number, carryover_amount: number) =>
    api.put(`/api/v1/inventory/teams/${teamSeasonId}/carryover`, { carryover_amount }).then(r => r.data),
  updateBudgetCategory: (categoryId: number, data: Record<string, unknown>) =>
    api.patch(`/api/v1/inventory/budget/${categoryId}`, data).then(r => r.data),
  deleteBudgetCategory: (categoryId: number) =>
    api.delete(`/api/v1/inventory/budget/${categoryId}`).then(r => r.data),
  // Ad-hoc team expenses (#98)
  createAdhocExpense: (teamSeasonId: number, data: Record<string, unknown>) =>
    api.post(`/api/v1/inventory/teams/${teamSeasonId}/adhoc-expenses`, data).then(r => r.data),
  deleteAdhocExpense: (expenseId: number) =>
    api.delete(`/api/v1/inventory/adhoc-expenses/${expenseId}`).then(r => r.data),
  addDonation: (categoryId: number, data: Record<string, unknown>) =>
    api.post(`/api/v1/inventory/budget/${categoryId}/donations`, data).then(r => r.data),
  updateDonation: (donationId: number, data: Record<string, unknown>) =>
    api.patch(`/api/v1/inventory/donations/${donationId}`, data).then(r => r.data),
  deleteDonation: (donationId: number) =>
    api.delete(`/api/v1/inventory/donations/${donationId}`).then(r => r.data),

  // ── BOMs ──
  listBoms: (params?: Record<string, string | number>) =>
    api.get("/api/v1/inventory/boms", { params }).then(r => r.data as Bom[]),
  getBom: (id: number) => api.get(`/api/v1/inventory/boms/${id}`).then(r => r.data as Bom),
  createBom: (data: Record<string, unknown>) => api.post("/api/v1/inventory/boms", data).then(r => r.data as Bom),
  updateBom: (id: number, data: Record<string, unknown>) => api.patch(`/api/v1/inventory/boms/${id}`, data).then(r => r.data as Bom),
  deleteBomPermanent: (id: number) => api.delete(`/api/v1/inventory/boms/${id}/permanent`).then(r => r.data),
  cancelBom: (id: number) => api.delete(`/api/v1/inventory/boms/${id}`).then(r => r.data),
  addBomLine: (id: number, data: Record<string, unknown>) => api.post(`/api/v1/inventory/boms/${id}/lines`, data).then(r => r.data as BomLine),
  updateBomLine: (id: number, lineId: number, data: Record<string, unknown>) => api.patch(`/api/v1/inventory/boms/${id}/lines/${lineId}`, data).then(r => r.data as BomLine),
  deleteBomLine: (id: number, lineId: number) => api.delete(`/api/v1/inventory/boms/${id}/lines/${lineId}`).then(r => r.data),
  bomReady: (id: number) => api.post(`/api/v1/inventory/boms/${id}/ready`).then(r => r.data as Bom),
  bomRecall: (id: number) => api.post(`/api/v1/inventory/boms/${id}/recall`).then(r => r.data as Bom),
  bomReject: (id: number, reason?: string) => api.post(`/api/v1/inventory/boms/${id}/reject`, { reason: reason ?? "" }).then(r => r.data as Bom),
  bomOrder: (id: number) => api.post(`/api/v1/inventory/boms/${id}/order`).then(r => r.data as Bom),

  listShippingAddresses: () => api.get("/api/v1/inventory/shipping-addresses").then(r => r.data as ShippingAddress[]),
  addShippingAddress: (name: string, address: string) => api.post("/api/v1/inventory/shipping-addresses", { name, address }).then(r => r.data as ShippingAddress[]),
  updateShippingAddress: (index: number, name: string, address: string) => api.put(`/api/v1/inventory/shipping-addresses/${index}`, { name, address }).then(r => r.data as ShippingAddress[]),
  deleteShippingAddress: (index: number) => api.delete(`/api/v1/inventory/shipping-addresses/${index}`).then(r => r.data as ShippingAddress[]),

  // ── Purchase Orders ──
  listPos: (params?: Record<string, string>) =>
    api.get("/api/v1/inventory/pos", { params }).then(r => r.data as PurchaseOrder[]),
  getPo: (id: number) => api.get(`/api/v1/inventory/pos/${id}`).then(r => r.data as PurchaseOrder),
  createPo: (data: Record<string, unknown>) => api.post("/api/v1/inventory/pos", data).then(r => r.data as PurchaseOrder),
  updatePo: (id: number, data: Record<string, unknown>) => api.patch(`/api/v1/inventory/pos/${id}`, data).then(r => r.data as PurchaseOrder),
  chargePoFees: (id: number, opts?: { shipping?: number | null; tax?: number | null; allocations?: { budget_category_id: number; shipping_amount: number; tax_amount: number }[] }) =>
    api.post(`/api/v1/inventory/pos/${id}/fees`, opts ?? {}).then(r => r.data as PurchaseOrder),
  clearPoFees: (id: number) => api.delete(`/api/v1/inventory/pos/${id}/fees`).then(r => r.data as PurchaseOrder),
  submitPo: (id: number) => api.post(`/api/v1/inventory/pos/${id}/submit`).then(r => r.data as PurchaseOrder),
  cancelPo: (id: number) => api.post(`/api/v1/inventory/pos/${id}/cancel`).then(r => r.data),
  deletePoPermanent: (id: number) => api.delete(`/api/v1/inventory/pos/${id}/permanent`).then(r => r.data as { ok: boolean; boms_detached: number }),
  removeBomFromPo: (id: number, bomId: number) => api.delete(`/api/v1/inventory/pos/${id}/boms/${bomId}`).then(r => r.data),
  receiveLine: (lineId: number, data: Record<string, unknown>) =>
    api.post(`/api/v1/inventory/bom-lines/${lineId}/receive`, data).then(r => r.data),
  receiveSplit: (lineId: number, data: Record<string, unknown>) =>
    api.post(`/api/v1/inventory/bom-lines/${lineId}/receive-split`, data).then(r => r.data),
  receiveAll: (poId: number) =>
    api.post(`/api/v1/inventory/pos/${poId}/receive-all`).then(r => r.data as { ok: boolean; lines_received: number }),
  quickbooksUrl: (id: number) => `${api.defaults.baseURL}/api/v1/inventory/pos/${id}/quickbooks.csv`,

  // ── Checkouts ──
  listCheckouts: (params?: Record<string, string | number | boolean>) =>
    api.get("/api/v1/inventory/checkouts", { params }).then(r => r.data as Checkout[]),
  createCheckout: (data: Record<string, unknown>) => api.post("/api/v1/inventory/checkouts", data).then(r => r.data as Checkout),
  updateCheckout: (id: number, data: Record<string, unknown>) => api.patch(`/api/v1/inventory/checkouts/${id}`, data).then(r => r.data as Checkout),
  approveCheckout: (id: number) => api.post(`/api/v1/inventory/checkouts/${id}/approve`).then(r => r.data as Checkout),
  returnCheckout: (id: number, data: Record<string, unknown>) => api.post(`/api/v1/inventory/checkouts/${id}/return`, data).then(r => r.data as Checkout),
  cancelCheckout: (id: number) => api.post(`/api/v1/inventory/checkouts/${id}/cancel`).then(r => r.data),
  // Equipment the signed-in member currently holds (self-service).
  myCheckouts: () => api.get("/api/v1/inventory/my-checkouts").then(r => r.data as Checkout[]),
  requestExtension: (id: number, data: { requested_date: string; note?: string }) =>
    api.post(`/api/v1/inventory/checkouts/${id}/request-extension`, data).then(r => r.data as Checkout),
  decideExtension: (id: number, decision: "approve" | "deny") =>
    api.post(`/api/v1/inventory/checkouts/${id}/extension/${decision}`).then(r => r.data as Checkout),

  // ── Battery tests ──
  listBatteryTests: (itemId: number) =>
    api.get(`/api/v1/inventory/items/${itemId}/battery-tests`).then(r => r.data as BatteryTest[]),
  addBatteryTest: (itemId: number, data: Record<string, unknown>) =>
    api.post(`/api/v1/inventory/items/${itemId}/battery-tests`, data).then(r => r.data),

  // ── Reports + rollover ──
  reportsOverview: () => api.get("/api/v1/inventory/reports/overview").then(r => r.data as ReportsOverview),
  reportsSpend: (groupBy: string) => api.get("/api/v1/inventory/reports/spend", { params: { group_by: groupBy } }).then(r => r.data as SpendReport),
  reportsLowStock: () => api.get("/api/v1/inventory/reports/low-stock").then(r => r.data as LowStockRow[]),
  reportsOpenPos: () => api.get("/api/v1/inventory/reports/open-pos").then(r => r.data as OpenPoRow[]),
  reportsBackorders: () => api.get("/api/v1/inventory/reports/backorders").then(r => r.data as BackorderRow[]),
  rolloverPreview: (season: string) => api.get("/api/v1/inventory/season-rollover/preview", { params: { season } }).then(r => r.data as RolloverResult),
  runRollover: (season: string) => api.post(`/api/v1/inventory/season-rollover?season=${encodeURIComponent(season)}`).then(r => r.data as RolloverResult),
};

export interface ReportsOverview {
  total_items: number; low_stock: number; tagged_assets: number; estimated_valuation: number;
  open_pos: number; outstanding_checkouts: number; overdue_checkouts: number; total_spend: number;
}
export interface SpendReport { group_by: string; rows: { label: string; amount: number }[]; total: number; }
export interface LowStockRow { id: number; name: string; category?: string; current_quantity?: number; minimum_stock_level?: number; unit_of_measure?: string; vendor_name?: string; }
export interface OpenPoRow { id: number; po_number?: string; vendor_name?: string; status: string; line_count: number; received_lines: number; order_date?: string; }
export interface BackorderRow { line_id: number; bom_id: number; description?: string; vendor_name?: string; ordered_quantity?: number; received_quantity?: number; }
export interface RolloverResult { season: string; boms?: number; pos?: number; boms_archived?: number; pos_archived?: number; total_spend: number; note?: string; }

export const CHECKOUT_TYPE_LABELS: Record<string, string> = {
  individual: "Individual", team: "Team", event: "Event", long_term: "Long-term Loan",
};

export interface Checkout {
  id: number;
  item_id: number | null;
  item_name?: string;
  is_custom_item?: boolean;
  asset_tag?: string;
  checkout_type: string;
  quantity?: number;
  status: string;
  overdue: boolean;
  holder?: string;
  member_id?: number;
  team_season_id?: number;
  event_id?: number;
  checkout_date?: string;
  expected_return_date?: string;
  returned_date?: string;
  condition_out?: string;
  condition_in?: string;
  damage_report?: string;
  notes?: string;
  requested_by?: string;
  approved_by?: string;
  extension_pending?: boolean;
  extension_requested_date?: string | null;
  extension_requested_by?: string | null;
  extension_requested_at?: string | null;
  extension_note?: string | null;
}

export interface BatteryTest {
  id: number;
  test_date?: string;
  resistance_beak?: number;
  resistance_gobilda?: number;
  result?: string;
  notes?: string;
  tested_by?: string;
}

export interface ShippingAddress { name: string; address: string; }

/** Combined value stored on the BOM and shown when placing the order: "Name — Address". */
export function formatShipTo(a: ShippingAddress): string {
  return a.name ? `${a.name} — ${a.address}` : a.address;
}

export const PO_STATUS_LABELS: Record<string, string> = {
  pending: "Pending", ordered: "Ordered", partially_received: "Partially Received",
  complete: "Complete", cancelled: "Cancelled",
};
export const PO_STATUS_COLORS: Record<string, string> = {
  pending: "#888", ordered: "#1565c0", partially_received: "#6a1b9a",
  complete: "#2e7d32", cancelled: "#c62828",
};

export interface POLine {
  id: number;
  description?: string;
  part_number?: string;
  quantity_required?: number;
  ordered_quantity?: number;
  expected_price?: number;
  actual_purchase_price?: number;
  url?: string | null;
  received_quantity?: number;
  damaged_quantity?: number;
  missing_quantity?: number;
  is_received?: boolean;
  destination_type?: string;
  destination_team_season_id?: number;
  receiving_budget_category_id?: number;
  budget_category_id?: number;
  item_id?: number;
}

export interface POBom {
  id: number;
  name?: string;
  status: string;
  team?: string;
  team_season_id: number;
  needed_by?: string | null;
  needed_by_date?: string | null;
  lines: POLine[];
}

export interface PurchaseOrder {
  id: number;
  po_number?: string;
  vendor_id?: number;
  vendor_name?: string;
  status: string;
  payment_method?: string;
  invoice_url?: string;
  shipping?: number;
  tax?: number;
  order_date?: string;
  order_number?: string;
  confirmation_number?: string;
  shipment_address?: string;
  expected_delivery_date?: string;
  tracking_number?: string;
  notes?: string;
  created_by?: string;
  created_at?: string;
  bom_count: number;
  line_count: number;
  received_lines: number;
  estimated_total: number;
  boms?: POBom[];
  fees?: POFees;
}

export interface POFeeCategory {
  budget_category_id: number;
  category_name: string;
  team: string | null;
  subtotal: number;
  proposed_shipping: number;
  proposed_tax: number;
  charged_shipping: number | null;
  charged_tax: number | null;
}
export interface POFees {
  shipping: number;
  tax: number;
  grand_subtotal: number;
  unassigned_subtotal: number;
  categories: POFeeCategory[];
  charged: boolean;
  charged_at: string | null;
}

export interface Donation {
  id: number;
  budget_category_id?: number;
  name: string;
  expected_amount?: number;
  received_amount?: number;
  received_date?: string | null;
  restricted_amount?: number | null;
  notes?: string;
  event_id?: number | null;
  member_id?: number | null;
  event_name?: string | null;
  event_expected?: number | null;
  is_tbd?: boolean;
  grant_id?: number | null;
  is_grant?: boolean;
  is_awarded?: boolean;
  grant_outcome?: string | null;
  is_declined?: boolean;
  sponsor_id?: number | null;
  is_sponsor?: boolean;
  is_sponsor_received?: boolean;
}

export interface BudgetCategoryRec {
  id: number;
  name: string;
  budgeted_amount?: number;
  actual_amount?: number;
  pending_amount?: number;
  is_fundraising: boolean;
  fundraising_goal?: number;
  fundraising_raised?: number;
  fundraising_expected?: number | null;
  donations?: Donation[];
  notes?: string;
  remaining?: number;
  adhoc_amount?: number;
  // Sub-category (sub-system) support. parent_id null = top-level.
  parent_id?: number | null;
  has_children?: boolean;
  own_actual?: number;
  child_budget_total?: number | null;
  unallocated?: number | null;
}

export interface AdhocExpense {
  id: number;
  budget_category_id: number | null;
  category_name?: string | null;
  vendor?: string | null;
  description: string;
  amount?: number;
  purchaser_id: number | null;
  purchaser_name?: string | null;
  expense_date?: string | null;
  notes?: string | null;
  created_at?: string;
}

export interface TeamBudget {
  team_season_id: number;
  carryover?: number;
  categories: BudgetCategoryRec[];
  adhoc_expenses?: AdhocExpense[];
  totals: { carryover?: number; budgeted: number; actual: number; adhoc?: number; pending: number; fundraising_goal: number; fundraising_raised: number; fundraising_expected?: number; fundraising_raised_restricted?: number; fundraising_expected_restricted?: number };
}

export const BOM_STATUS_LABELS: Record<string, string> = {
  draft: "Draft", ready_to_order: "Pending", ordered: "Ordered",
  partially_received: "Partially Received", received: "Received",
  rejected: "Rejected", cancelled: "Cancelled",
};

export const BOM_STATUS_COLORS: Record<string, string> = {
  draft: "#888", ready_to_order: "#e65100", ordered: "#1565c0",
  partially_received: "#6a1b9a", received: "#2e7d32",
  rejected: "#b45309", cancelled: "#c62828",
};

export interface BomLine {
  id: number;
  item_id?: number;
  part_number?: string;
  description?: string;
  url?: string;
  package_quantity?: number;
  quantity_required?: number;
  order_quantity?: number;
  expected_price?: number;
  budget_category_id?: number;
  expected_total?: number;
  actual_purchase_price?: number;
  ordered_quantity?: number;
  actual_total?: number;
  backorder_flag?: boolean;
  notes?: string;
}

export interface Bom {
  id: number;
  team_season_id: number;
  team?: string;
  vendor_id?: number;
  vendor_name?: string;
  budget_category_id?: number;
  po_id?: number;
  name?: string;
  display_name?: string;
  needed_by?: string | null;
  needed_by_date?: string | null;
  status: string;
  version: number;
  is_locked: boolean;
  created_by?: string;
  created_by_id?: number;
  submitted_by?: string;
  order_number?: string;
  confirmation_number?: string;
  shipping?: number;
  tax?: number;
  shipment_address?: string;
  expected_delivery_date?: string;
  tracking_number?: string;
  order_date?: string;
  ordered_flag?: boolean;
  backorder_flag?: boolean;
  invoice_url?: string;
  notes?: string;
  expected_total?: number;
  actual_total?: number;
  created_at?: string;
  lines?: BomLine[];
}

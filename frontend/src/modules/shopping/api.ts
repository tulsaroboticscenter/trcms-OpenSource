import { api } from "../../core/api";

export interface ShoppingStore { id: number; name: string; is_active: boolean; display_order: number; }
export interface ShoppingCategory {
  id: number; name: string; destination: string; color: string; icon_name: string;
  display_order: number; is_active: boolean;
}
export interface ShoppingStaple {
  id: number; name: string; default_category_id?: number; default_store_id?: number;
  default_unit?: string; default_quantity?: number;
}
export interface ShoppingItem {
  id: number; name: string; quantity?: number; unit?: string;
  category_id?: number; category_name?: string; category_color?: string;
  store_id?: number; store_name?: string;
  priority?: string; needed_by?: string | null; notes?: string; url?: string; photo_url?: string;
  est_price?: number;
  requested_by?: string; requested_by_id?: number;
  claimed_by?: string; claimed_by_id?: number;
  status: string;
  purchased_by?: string; actual_amount?: number;
  created_at?: string;
  claimed_at?: string | null;
  purchased_at?: string | null;
  times_bought?: number;
  entries?: PurchaseEntry[];
}

export interface PurchaseEntry {
  id: number;
  purchased_by?: string | null;
  purchased_at?: string | null;
  quantity?: number | null;
  unit?: string | null;
  store_name?: string | null;
}

export const shoppingApi = {
  listStores: () => api.get("/api/v1/shopping/stores").then(r => r.data as ShoppingStore[]),
  listCategories: () => api.get("/api/v1/shopping/categories").then(r => r.data as ShoppingCategory[]),
  listStaples: () => api.get("/api/v1/shopping/staples").then(r => r.data as ShoppingStaple[]),

  listItems: (params?: Record<string, string | number | boolean>) =>
    api.get("/api/v1/shopping/items", { params }).then(r => r.data as ShoppingItem[]),
  history: (params?: Record<string, string>) =>
    api.get("/api/v1/shopping/items/history", { params }).then(r => r.data as ShoppingItem[]),
  addItem: (data: Record<string, unknown>) =>
    api.post("/api/v1/shopping/items", data).then(r => r.data as ShoppingItem),
  updateItem: (id: number, data: Record<string, unknown>) =>
    api.patch(`/api/v1/shopping/items/${id}`, data).then(r => r.data as ShoppingItem),
  claim: (id: number) => api.post(`/api/v1/shopping/items/${id}/claim`).then(r => r.data as ShoppingItem),
  unclaim: (id: number) => api.post(`/api/v1/shopping/items/${id}/unclaim`).then(r => r.data as ShoppingItem),
  gotIt: (id: number) => api.post(`/api/v1/shopping/items/${id}/got-it`).then(r => r.data as ShoppingItem),
  reopen: (id: number) => api.post(`/api/v1/shopping/items/${id}/reopen`).then(r => r.data as ShoppingItem),
  deleteItem: (id: number) => api.delete(`/api/v1/shopping/items/${id}`).then(r => r.data),
};

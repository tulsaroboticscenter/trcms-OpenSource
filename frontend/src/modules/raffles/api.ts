import { api } from "../../core/api";

export interface RaffleStats { tickets_sold: number; tickets_pending: number; revenue: number; buyers: number; }
export interface Raffle {
  id: number;
  name: string;
  prize_description: string | null;
  ticket_price: number | null;
  fine_print: string | null;
  sales_open_at: string | null;
  sales_close_at: string | null;
  draw_date: string | null;
  status: "draft" | "open" | "closed" | "drawn" | "archived";
  public_slug: string;
  event_id: number | null;
  winner_ticket_id: number | null;
  winner_drawn_at: string | null;
  created_at: string;
  stats?: RaffleStats;
}
export interface RaffleOrder {
  id: number; buyer_name: string; buyer_email: string | null; buyer_phone: string | null;
  quantity: number; amount: number | null; sale_channel: string; payment_status: string;
  payment_method: string | null; created_at: string; paid_at: string | null;
}
export interface RaffleTicket { ticket_number: number; is_winner: boolean; buyer_name: string; buyer_email: string | null; buyer_phone: string | null; }
export interface RaffleWinner { ticket_number: number; buyer_name: string; buyer_email: string | null; buyer_phone: string | null; }
export interface PublicRaffle { name: string; prize_description: string | null; ticket_price: number | null; fine_print: string | null; draw_date: string | null; status: string; sale_open: boolean; }

export interface QuestionnairePayload {
  interested_program?: boolean; interested_volunteer?: boolean; interested_sponsor?: boolean; stay_in_touch?: boolean;
}

export const rafflesApi = {
  list: () => api.get("/api/v1/raffles").then((r) => r.data as Raffle[]),
  get: (id: number) => api.get(`/api/v1/raffles/${id}`).then((r) => r.data as Raffle),
  create: (data: Partial<Raffle>) => api.post("/api/v1/raffles", data).then((r) => r.data as Raffle),
  update: (id: number, data: Partial<Raffle>) => api.patch(`/api/v1/raffles/${id}`, data).then((r) => r.data as Raffle),
  remove: (id: number) => api.delete(`/api/v1/raffles/${id}`).then((r) => r.data),
  orders: (id: number) => api.get(`/api/v1/raffles/${id}/orders`).then((r) => r.data as RaffleOrder[]),
  tickets: (id: number) => api.get(`/api/v1/raffles/${id}/tickets`).then((r) => r.data as { raffle: { id: number; name: string; prize_description: string | null; draw_date: string | null }; tickets: RaffleTicket[] }),
  boothSale: (id: number, data: { buyer_name: string; quantity: number; payment_method?: string; buyer_email?: string; buyer_phone?: string } & QuestionnairePayload) =>
    api.post(`/api/v1/raffles/${id}/booth-sale`, data).then((r) => r.data as { order_id: number; ticket_numbers: number[]; amount: number }),
  draw: (id: number, redraw = false) => api.post(`/api/v1/raffles/${id}/draw`, { redraw }).then((r) => r.data as RaffleWinner),

  // Public (no auth)
  publicGet: (slug: string) => api.get(`/api/v1/public/raffle/${slug}`).then((r) => r.data as PublicRaffle),
  publicPurchase: (slug: string, data: { buyer_name: string; buyer_email: string; buyer_phone?: string; quantity: number; provider?: string } & QuestionnairePayload) =>
    api.post(`/api/v1/public/raffle/${slug}/purchase`, data).then((r) => r.data as { order_id: number; redirect_url: string }),
};

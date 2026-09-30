import { api } from "../../core/api";

export interface FinancePreview {
  headers: string[];
  sample_rows: Record<string, string>[];
  row_count: number;
  guessed: { segment: string | null; account: string | null; income: string | null; expense: string | null; amount: string | null };
}

export interface ColumnMap {
  segment: string;
  account?: string;
  income?: string;
  expense?: string;
  amount?: string;
}

export interface FinanceImport {
  id: number;
  filename: string | null;
  label: string | null;
  as_of_date: string | null;
  period_start: string | null;
  period_end: string | null;
  segment_kind: string | null;
  created_at: string;
  created_by_name: string | null;
  line_count: number;
  total_income: number;
  total_expense: number;
  total_net: number;
}

export interface FinanceSegment {
  segment_label: string;
  income: number;
  expense: number;
  net: number;
  team_season_id: number | null;
  scope: "team" | "org" | "ignore";
  suggested_team_season_id: number | null;
}

export interface TeamOption { team_season_id: number; label: string; }

export interface SegmentsResponse { import_id: number; teams: TeamOption[]; segments: FinanceSegment[]; }

export interface TeamFinanceRow {
  team_season_id: number; team_name: string; season: string;
  income: number; expense: number; net: number; labels: string[];
}
export interface ByTeamResponse {
  import_id: number;
  teams: TeamFinanceRow[];
  org: { income: number; expense: number; net: number; labels: string[] } | null;
  unmapped: { segment_label: string; income: number; expense: number; net: number }[];
}

export interface SegmentMapEntry { segment_label: string; team_season_id: number | null; scope: "team" | "org" | "ignore"; }

export const financeApi = {
  preview: (file: File) => {
    const fd = new FormData(); fd.append("file", file);
    return api.post("/api/v1/finance/preview", fd).then((r) => r.data as FinancePreview);
  },
  createImport: (file: File, meta: { label?: string; as_of_date?: string; period_start?: string; period_end?: string; segment_kind?: string; notes?: string }, columnMap: ColumnMap) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("column_map", JSON.stringify(columnMap));
    Object.entries(meta).forEach(([k, v]) => { if (v) fd.append(k, v); });
    return api.post("/api/v1/finance/imports", fd).then((r) => r.data as { ok: boolean; import_id: number; lines: number; segments: number });
  },
  listImports: () => api.get("/api/v1/finance/imports").then((r) => r.data as FinanceImport[]),
  deleteImport: (id: number) => api.delete(`/api/v1/finance/imports/${id}`).then((r) => r.data),
  segments: (importId?: number) =>
    api.get("/api/v1/finance/segments", { params: importId ? { import_id: importId } : {} }).then((r) => r.data as SegmentsResponse),
  setSegmentMap: (maps: SegmentMapEntry[]) =>
    api.put("/api/v1/finance/segments", { maps }).then((r) => r.data as { ok: boolean; updated: number }),
  byTeam: (importId?: number) =>
    api.get("/api/v1/finance/by-team", { params: importId ? { import_id: importId } : {} }).then((r) => r.data as ByTeamResponse),
};

export const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

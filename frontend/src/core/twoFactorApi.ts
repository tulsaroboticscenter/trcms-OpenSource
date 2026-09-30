import { api } from "./api";

export interface TwoFactorStatus { feature_enabled: boolean; enabled: boolean; }

export const twoFactorApi = {
  status: () => api.get("/api/v1/auth/2fa/status").then((r) => r.data as TwoFactorStatus),
  setup: () => api.post("/api/v1/auth/2fa/setup").then((r) => r.data as { secret: string; otpauth_uri: string }),
  enable: (code: string) => api.post("/api/v1/auth/2fa/enable", { code }).then((r) => r.data as { ok: boolean; backup_codes: string[] }),
  disable: (opts: { code?: string; password?: string }) => api.post("/api/v1/auth/2fa/disable", opts).then((r) => r.data),
  reset: (memberId: number) => api.post(`/api/v1/members/${memberId}/2fa/reset`).then((r) => r.data),
};

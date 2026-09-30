/**
 * Core API client — shared by all modules.
 * Import this instead of creating your own axios instance.
 */
import axios from "axios";

// Relative base: the app calls the same origin it is served from
// (PHP backend on :8090 in dev, the site domain behind Plesk in prod).
export const api = axios.create({
  baseURL: "",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("trc_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => {
    // A response arrived — we can reach the server. Clear any "offline" state.
    window.dispatchEvent(new Event("trc:online"));
    // Sliding session: the server hands back a renewed token while the user is active,
    // so an active session never expires. Store it for subsequent requests.
    const fresh = r.headers?.["x-refresh-token"];
    if (typeof fresh === "string" && fresh && localStorage.getItem("trc_token")) {
      localStorage.setItem("trc_token", fresh);
    }
    return r;
  },
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("trc_token");
      window.location.href = "/login";
    }
    // No `response` means the request never reached the server (offline, server
    // down, DNS/TLS failure, or a timeout). This is the case that must NOT be
    // mistaken for "no data" — signal it so the app can warn instead of showing
    // an empty screen. `ERR_CANCELED` is a deliberate abort, not a failure.
    else if (!err.response && err.code !== "ERR_CANCELED") {
      window.dispatchEvent(new Event("trc:offline"));
    }
    return Promise.reject(err);
  }
);

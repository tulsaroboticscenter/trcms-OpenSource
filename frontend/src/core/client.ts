import axios from "axios";

// Relative base: same origin the app is served from (see core/api.ts).
export const api = axios.create({
  baseURL: "",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("trc_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("trc_token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

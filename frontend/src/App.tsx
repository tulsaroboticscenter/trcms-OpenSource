import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./core/AuthContext";
import { HelpProvider } from "./modules/help/HelpContext";
import { TourProvider } from "./modules/help/TourContext";
import Layout from "./core/Layout";
import Login from "./core/Login";
import ForgotPassword from "./core/ForgotPassword";
import ForgotUsername from "./core/ForgotUsername";
import ResetPassword from "./core/ResetPassword";
import Dashboard from "./core/Dashboard";
import ChangePassword from "./core/ChangePassword";
import Setup from "./core/Setup";
import TCGate from "./core/TCGate";
import SiteMap from "./core/SiteMap";
import { allRoutes } from "./moduleRegistry";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, authLoading, isAdmin } = useAuth();
  const location = useLocation();
  // Still validating a stored token — wait rather than bouncing to /login,
  // which would discard the deep-linked URL before auth even resolves.
  if (authLoading) return <div style={{ padding: 40, color: "#888" }}>Loading…</div>;
  // Remember where the user was headed so login can send them back there.
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  // Force password change before the user can go anywhere else
  if (user.force_password_change) return <Navigate to="/change-password" replace />;
  // First-run setup: a freshly installed system routes the admin to the wizard
  // until they finish it. Established installs report setup_complete !== false.
  if (isAdmin && user.setup_complete === false && location.pathname !== "/setup") {
    return <Navigate to="/setup" replace />;
  }
  // Must agree to TRC Terms & Conditions before using the system.
  const es = user.enrollment_status;
  if (es?.requires_tc && es?.tc_ok === false) return <TCGate />;
  return <Layout>{children}</Layout>;
}

function AppRoutes() {
  const { user, kioskLanding, logout, isModuleEnabled, isAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Hidden logout for unattended kiosk/station devices: Ctrl-O ("O" for out).
  // Only active for kiosk accounts, so it never hijacks Ctrl-O for normal users.
  useEffect(() => {
    if (!user?.is_kiosk) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === "o" || e.key === "O")) {
        e.preventDefault();
        logout();
        navigate("/login", { replace: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [user?.is_kiosk, logout, navigate]);

  // Station/kiosk accounts go straight to their function page, never the dashboard.
  const home = kioskLanding ?? "/";
  // After login, return the user to the page they originally requested (captured
  // by ProtectedRoute). Stations always go to their function page instead.
  const from = (location.state as { from?: string } | null)?.from;
  const postLogin = kioskLanding ?? from ?? "/";
  return (
    <Routes>
      {/* Auth */}
      <Route path="/login" element={user ? <Navigate to={postLogin} replace /> : <Login />} />

      {/* Public self-service account recovery */}
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/forgot-username" element={<ForgotUsername />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* Change password — accessible without Layout (shown full-screen when forced) */}
      <Route
        path="/change-password"
        element={user ? <ChangePassword /> : <Navigate to="/login" replace />}
      />

      {/* First-run setup wizard — full-screen, admins only (after CLI bootstrap). */}
      <Route
        path="/setup"
        element={user ? (isAdmin ? <Setup /> : <Navigate to="/" replace />) : <Navigate to="/login" replace />}
      />

      {/* Dashboard — stations are redirected to their function page instead */}
      <Route
        path="/"
        element={
          kioskLanding
            ? <Navigate to={kioskLanding} replace />
            : <ProtectedRoute><Dashboard /></ProtectedRoute>
        }
      />

      {/* Unknown paths: stations fall back to their function page, others to the dashboard */}
      {/* (catch-all defined below also uses `home`) */}

      {/* Site map / feature index — hidden from nav, reachable by URL + command palette */}
      <Route path="/site-map" element={<ProtectedRoute><SiteMap /></ProtectedRoute>} />

      {/* Module routes — public routes skip the ProtectedRoute wrapper.
          Routes for org-disabled modules are dropped entirely (public ones too,
          so a disabled module's embedded form stops working), falling through to
          the catch-all below. Core modules are never disabled, so their public
          routes (e.g. the employer form) always register. */}
      {allRoutes.map(({ path, element: Page, ...rest }) => {
        const isPublic = (rest as { public?: boolean }).public === true;
        const moduleId = (rest as { moduleId?: string }).moduleId;
        if (moduleId && !isModuleEnabled(moduleId)) return null;
        return (
          <Route
            key={path}
            path={path}
            element={isPublic ? <Page /> : <ProtectedRoute><Page /></ProtectedRoute>}
          />
        );
      })}

      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <HelpProvider>
          <TourProvider>
            <AppRoutes />
          </TourProvider>
        </HelpProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

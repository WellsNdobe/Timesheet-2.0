import { useEffect, useState } from "react";
import { AuthExperience, type AuthResponse } from "./auth/AuthExperience";
import { Dashboard } from "./components/Dashboard";
import { AccessStatePage } from "./pages/AccessStatePage";
import { useThemePreference } from "./theme";

type Session = Pick<AuthResponse, "accessToken" | "user">;
const sessionKey = "tempoledger.session";
const readSession = (): Session | null => { try { return JSON.parse(sessionStorage.getItem(sessionKey) ?? "null") as Session | null; } catch { return null; } };

export default function App() {
  const [path, setPath] = useState(`${window.location.pathname}${window.location.search}`);
  const [session, setSession] = useState<Session | null | undefined>(() => readSession() ?? undefined);
  useThemePreference();
  useEffect(() => { const handlePopState = () => setPath(`${window.location.pathname}${window.location.search}`); window.addEventListener("popstate", handlePopState); return () => window.removeEventListener("popstate", handlePopState); }, []);
  useEffect(() => {
    const pathname = path.split("?")[0]; if (session !== undefined || pathname === "/login" || pathname === "/signup") return;
    void (async () => { try { const refreshResponse = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" }); if (!refreshResponse.ok) throw new Error("refresh_failed"); const { accessToken } = await refreshResponse.json() as { accessToken: string }; const meResponse = await fetch("/api/auth/me", { headers: { Authorization: `Bearer ${accessToken}` } }); if (!meResponse.ok) throw new Error("me_failed"); const { user } = await meResponse.json() as { user: Session["user"] }; const next = { accessToken, user }; sessionStorage.setItem(sessionKey, JSON.stringify(next)); setSession(next); } catch { sessionStorage.removeItem(sessionKey); setSession(null); } })();
  }, [path, session]);
  const navigate = (nextPath: string) => { window.history.pushState({}, "", nextPath); const url = new URL(nextPath, window.location.origin); setPath(`${url.pathname}${url.search}`); };
  const authenticated = (result: AuthResponse) => { const next = { accessToken: result.accessToken, user: result.user }; sessionStorage.setItem(sessionKey, JSON.stringify(next)); setSession(next); navigate("/"); };
  const pathname = path.split("?")[0];
  if (pathname === "/signup" || pathname === "/login" || session === null) return <AuthExperience mode={pathname === "/signup" ? "signup" : "login"} onAuthenticated={authenticated} />;
  if (session === undefined) return <AccessStatePage title="Restoring your session" message="Checking your secure sign-in..." />;
  return <Dashboard accessToken={session.accessToken} userEmail={session.user.email} path={path} onNavigate={navigate} />;
}

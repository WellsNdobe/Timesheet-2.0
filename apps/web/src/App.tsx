import { useEffect, useState } from "react";
import { AuthExperience } from "./auth/AuthExperience";
import { Dashboard } from "./components/Dashboard";
import { useThemePreference } from "./theme";

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  useThemePreference();

  useEffect(() => {
    const handlePopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  if (path === "/signup" || path === "/login") {
    return <AuthExperience mode={path === "/signup" ? "signup" : "login"} onAuthenticated={() => { window.history.pushState({}, "", "/"); setPath("/"); }} />;
  }

  return <Dashboard />;
}

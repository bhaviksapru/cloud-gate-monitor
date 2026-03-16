import { useState, useEffect } from "react";
import { getAccessToken, redirectToLogin, handleCallback, logout } from "./auth";
import Dashboard from "./components/Dashboard";

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (window.location.pathname === "/callback") {
        try { await handleCallback(); } catch (e) { setError(String(e)); }
        setReady(true);
        return;
      }
      // FIX: was calling isAuthenticated() which returns false the moment the
      // 1-hour access token expires, even when a valid 7-day refresh token
      // exists — triggering a full Cognito redirect on every page load after
      // the first hour. getAccessToken() transparently refreshes the token
      // when expired and only returns null when there is truly no valid session.
      const token = await getAccessToken();
      if (!token) { await redirectToLogin(); return; }
      setReady(true);
    })();
  }, []);

  if (error) return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", gap:12 }}>
      <p style={{ color:"#e05c6b" }}>{error}</p>
      <button onClick={() => redirectToLogin()} style={btnStyle}>Retry login</button>
    </div>
  );

  if (!ready) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", color:"#4a4e6a" }}>
      Authenticating…
    </div>
  );

  return <Dashboard onLogout={logout} />;
}

const btnStyle: React.CSSProperties = {
  padding:"8px 20px", background:"#5b6af0", color:"#fff",
  border:"none", borderRadius:6, cursor:"pointer", fontSize:13,
};

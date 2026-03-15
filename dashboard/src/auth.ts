const COGNITO_DOMAIN = __COGNITO_DOMAIN__;
const CLIENT_ID      = __COGNITO_CLIENT_ID__;
const REDIRECT_URI   = `${window.location.origin}/callback`;

interface Tokens {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  expires_in: number;
  stored_at: number;
}

function save(t: Tokens)  { sessionStorage.setItem("cgm_tokens", JSON.stringify(t)); }
function load(): Tokens | null {
  try { return JSON.parse(sessionStorage.getItem("cgm_tokens") ?? "null"); }
  catch { return null; }
}
function clear() { sessionStorage.removeItem("cgm_tokens"); sessionStorage.removeItem("cgm_verifier"); sessionStorage.removeItem("cgm_state"); }
function expired(t: Tokens) { return Date.now() > t.stored_at + (t.expires_in - 60) * 1000; }

function rand(n: number) {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(n))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function challenge(v: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export async function redirectToLogin() {
  const verifier = rand(64);
  const state    = rand(16);
  sessionStorage.setItem("cgm_verifier", verifier);
  sessionStorage.setItem("cgm_state", state);

  window.location.href = `${COGNITO_DOMAIN}/oauth2/authorize?${new URLSearchParams({
    response_type: "code", client_id: CLIENT_ID, redirect_uri: REDIRECT_URI,
    scope: "openid email profile",
    code_challenge: await challenge(verifier),
    code_challenge_method: "S256",
    state,
  })}`;
}

export async function handleCallback(): Promise<void> {
  const url      = new URL(window.location.href);
  const code     = url.searchParams.get("code");
  const state    = url.searchParams.get("state");
  const verifier = sessionStorage.getItem("cgm_verifier");

  if (!code)                                    throw new Error("No code in callback");
  if (state !== sessionStorage.getItem("cgm_state")) throw new Error("State mismatch");
  if (!verifier)                                throw new Error("No PKCE verifier");

  const resp = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: CLIENT_ID, code, redirect_uri: REDIRECT_URI, code_verifier: verifier }),
  });
  if (!resp.ok) throw new Error(await resp.text());
  save({ ...await resp.json(), stored_at: Date.now() });
  window.history.replaceState({}, "", "/");
}

export async function getAccessToken(): Promise<string | null> {
  let t = load();
  if (!t) return null;
  if (expired(t)) {
    if (!t.refresh_token) { clear(); return null; }
    const resp = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token: t.refresh_token }),
    });
    if (!resp.ok) { clear(); return null; }
    t = { ...await resp.json(), refresh_token: t.refresh_token, stored_at: Date.now() };
    save(t);
  }
  return t.access_token;
}

export function isAuthenticated() { const t = load(); return !!t?.access_token && !expired(t); }

export function logout() {
  clear();
  window.location.href = `${COGNITO_DOMAIN}/logout?${new URLSearchParams({ client_id: CLIENT_ID, logout_uri: window.location.origin })}`;
}

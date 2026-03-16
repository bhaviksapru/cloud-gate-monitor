import { getAccessToken, redirectToLogin } from "./auth";

const API  = __API_BASE_URL__;
const CF   = __CF_DOMAIN__;

async function get<T>(path: string): Promise<T> {
  const token = await getAccessToken();
  if (!token) { await redirectToLogin(); throw new Error("Not authenticated"); }

  const resp = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (resp.status === 401) { await redirectToLogin(); throw new Error("Session expired"); }
  if (!resp.ok) throw new Error(`API ${resp.status}`);
  return resp.json() as Promise<T>;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface Clip {
  key: string; camera: string; date: string; time: string;
  timestamp: number; sizeBytes?: number; presignedUrl: string;
}

export interface ClipsResponse {
  clips: Clip[]; nextToken?: string;
}

export interface Stream { camera: string; liveUrl: string; }
export interface StreamsResponse { streams: Stream[]; }

export interface LockEvent {
  lockId: number; recordType: number; recordLabel: string;
  success: boolean; username: string | null;
  isoDate: string; serverDate: number; batteryLevel: number | null;
}

export interface EventsResponse { events: LockEvent[]; date: string; lastKey?: string; }

export interface Summary {
  date: string; totalToday: number; failedToday: number; successToday: number;
  lastEvent: LockEvent | null;
}

// ── Endpoints ────────────────────────────────────────────────────────────────

export const api = {
  clips: (camera?: string, date?: string, nextToken?: string) => {
    const p = new URLSearchParams();
    if (camera)    p.set("camera", camera);
    if (date)      p.set("date", date);
    if (nextToken) p.set("nextToken", nextToken);
    const qs = p.toString();
    return get<ClipsResponse>(`/clips${qs ? `?${qs}` : ""}`);
  },

  liveStreams: () => get<StreamsResponse>("/clips/live"),

  events: (date?: string, lastKey?: string) => {
    const p = new URLSearchParams();
    if (date)    p.set("date", date);
    if (lastKey) p.set("lastKey", lastKey);
    const qs = p.toString();
    return get<EventsResponse>(`/events${qs ? `?${qs}` : ""}`);
  },

  summary: () => get<Summary>("/events/summary"),

  liveUrl: (camera: string) => `https://${CF}/live/${camera}/stream.m3u8`,
};

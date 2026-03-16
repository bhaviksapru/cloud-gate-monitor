import { useState, useEffect, useCallback } from "react";
import { api, type LockEvent } from "../api";

function fmt(iso: string) {
  return new Date(iso).toLocaleTimeString("en-CA", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, timeZone: "America/Toronto",
  });
}

const s: Record<string, React.CSSProperties> = {
  root:       { display:"flex", flexDirection:"column", gap:10, height:"100%", overflow:"hidden" },
  toolbar:    { display:"flex", alignItems:"center", gap:8, flexShrink:0 },
  datePicker: { flex:1, background:"#0d0f14", border:"1px solid #1e2130", borderRadius:6, color:"#e2e4e9", fontSize:13, padding:"5px 10px", outline:"none" },
  refreshBtn: { background:"#0d0f14", border:"1px solid #1e2130", borderRadius:6, color:"#8b8fa8", fontSize:16, padding:"4px 10px", cursor:"pointer" },
  chips:      { display:"flex", gap:6, flexShrink:0 },
  chip:       { fontSize:11, padding:"2px 8px", borderRadius:4, background:"#1e2130", color:"#8b8fa8" },
  list:       { flex:1, overflowY:"auto" as const, scrollbarWidth:"thin" as const },
  row:        { display:"flex", alignItems:"center", gap:10, padding:"8px 6px", borderRadius:6, marginBottom:2 },
  icon:       { width:20, height:20, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, flexShrink:0 },
  body:       { flex:1, display:"flex", flexDirection:"column", gap:1, minWidth:0 },
  name:       { fontSize:13, color:"#c8cad6", whiteSpace:"nowrap" as const, overflow:"hidden" as const, textOverflow:"ellipsis" as const },
  user:       { fontSize:11, color:"#4a4e6a" },
  time:       { fontSize:11, color:"#4a4e6a", fontVariantNumeric:"tabular-nums" as const, flexShrink:0 },
  state:      { textAlign:"center" as const, padding:32, color:"#4a4e6a", fontSize:13 },
};

function Row({ e }: { e: LockEvent }) {
  const ok = e.success;
  return (
    <div style={s.row}>
      <div style={{ ...s.icon, background: ok ? "rgba(52,211,153,0.15)" : "rgba(224,92,107,0.15)", color: ok ? "#34d399" : "#e05c6b" }}>
        {ok ? "✓" : "✕"}
      </div>
      <div style={s.body}>
        <span style={s.name}>{e.recordLabel}</span>
        {e.username && <span style={s.user}>{e.username}</span>}
      </div>
      <span style={s.time}>{fmt(e.isoDate)}</span>
    </div>
  );
}

export default function EventFeed() {
  const [events, setEvents]   = useState<LockEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [date, setDate]       = useState(() => new Date().toISOString().slice(0, 10));
  const [tick, setTick]       = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setEvents((await api.events(date)).events); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [date, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 30 s when showing today
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (date !== today) return;
    const t = setInterval(() => setTick(n => n + 1), 30_000);
    return () => clearInterval(t);
  }, [date]);

  const failed  = events.filter(e => !e.success).length;
  const success = events.length - failed;

  return (
    <div style={s.root}>
      <div style={s.toolbar}>
        <input type="date" style={s.datePicker} value={date}
          max={new Date().toISOString().slice(0, 10)}
          onChange={e => setDate(e.target.value)} />
        <button style={s.refreshBtn} onClick={() => setTick(n => n + 1)} disabled={loading}>↻</button>
      </div>

      {!loading && events.length > 0 && (
        <div style={s.chips}>
          <span style={s.chip}>{events.length} total</span>
          <span style={{ ...s.chip, background:"rgba(52,211,153,0.1)",  color:"#34d399" }}>{success} ok</span>
          <span style={{ ...s.chip, background:"rgba(224,92,107,0.1)", color:"#e05c6b" }}>{failed} failed</span>
        </div>
      )}

      {loading && <div style={s.state}>Loading…</div>}
      {error   && <div style={{ ...s.state, color:"#e05c6b" }}>{error}</div>}
      {!loading && !error && events.length === 0 && <div style={s.state}>No events for {date}</div>}

      {!loading && events.length > 0 && (
        <div style={s.list}>
          {events.map((e, i) => <Row key={`${e.serverDate}-${i}`} e={e} />)}
        </div>
      )}
    </div>
  );
}

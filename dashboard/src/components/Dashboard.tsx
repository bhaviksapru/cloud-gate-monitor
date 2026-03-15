import { useState, useEffect } from "react";
import { api, type Summary, type Stream } from "../api";
import HlsPlayer from "./HlsPlayer";
import EventFeed from "./EventFeed";
import ClipBrowser from "./ClipBrowser";

type Tab = "live" | "clips" | "events";

const s: Record<string, React.CSSProperties> = {
  shell:    { display:"flex", flexDirection:"column", height:"100vh", overflow:"hidden" },
  topbar:   { display:"flex", alignItems:"center", gap:16, padding:"0 16px", height:52, background:"#0a0c11", borderBottom:"1px solid #1e2130", flexShrink:0 },
  title:    { fontSize:14, fontWeight:600, color:"#c8cad6", letterSpacing:"0.02em" },
  stats:    { display:"flex", gap:8, marginLeft:"auto" },
  chip:     { display:"flex", flexDirection:"column", alignItems:"center", padding:"4px 12px", background:"#0d0f14", border:"1px solid #1e2130", borderRadius:6, minWidth:72 },
  chipVal:  { fontSize:16, fontWeight:600, color:"#e2e4e9", fontVariantNumeric:"tabular-nums" },
  chipLbl:  { fontSize:10, color:"#4a4e6a", textTransform:"uppercase" as const, letterSpacing:"0.04em", whiteSpace:"nowrap" as const },
  logout:   { background:"none", border:"1px solid #1e2130", borderRadius:6, color:"#4a4e6a", fontSize:12, padding:"5px 12px", cursor:"pointer" },
  tabs:     { display:"flex", gap:2, padding:"0 16px", background:"#0a0c11", borderBottom:"1px solid #1e2130", flexShrink:0 },
  tab:      { display:"flex", alignItems:"center", gap:6, padding:"10px 16px", background:"none", border:"none", borderBottom:"2px solid transparent", color:"#4a4e6a", fontSize:13, fontWeight:500, cursor:"pointer", marginBottom:-1 },
  tabActive:{ color:"#e2e4e9", borderBottomColor:"#5b6af0" },
  content:  { flex:1, overflow:"hidden", padding:16 },
  liveGrid: { display:"grid", gridTemplateColumns:"1fr 340px", gap:16, height:"100%", overflow:"hidden" },
  side:     { display:"flex", flexDirection:"column", gap:10, overflow:"hidden", background:"#0a0c11", border:"1px solid #1e2130", borderRadius:10, padding:12 },
  section:  { fontSize:12, fontWeight:500, color:"#4a4e6a", textTransform:"uppercase" as const, letterSpacing:"0.06em", flexShrink:0 },
  full:     { display:"flex", flexDirection:"column", gap:12, height:"100%", overflow:"hidden" },
};

export default function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab]         = useState<Tab>("live");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [streams, setStreams]  = useState<Stream[]>([]);

  useEffect(() => {
    api.liveStreams().then(r => setStreams(r.streams)).catch(() => {});
    api.summary().then(setSummary).catch(() => {});
    const t = setInterval(() => api.summary().then(setSummary).catch(() => {}), 60_000);
    return () => clearInterval(t);
  }, []);

  const failedStyle = summary?.failedToday
    ? { ...s.chip, border:"1px solid rgba(224,92,107,0.4)", background:"rgba(224,92,107,0.06)" }
    : s.chip;

  return (
    <div style={s.shell}>
      <header style={s.topbar}>
        <span style={{ fontSize:18 }}>🔐</span>
        <span style={s.title}>cloud-gate-monitor</span>
        <div style={s.stats}>
          <div style={s.chip}>
            <span style={s.chipVal}>{summary?.totalToday ?? "—"}</span>
            <span style={s.chipLbl}>events today</span>
          </div>
          <div style={failedStyle}>
            <span style={{ ...s.chipVal, color: summary?.failedToday ? "#e05c6b" : "#34d399" }}>
              {summary?.failedToday ?? "—"}
            </span>
            <span style={s.chipLbl}>failed</span>
          </div>
          <div style={s.chip}>
            <span style={s.chipVal}>{streams.length}</span>
            <span style={s.chipLbl}>cameras</span>
          </div>
        </div>
        <button style={s.logout} onClick={onLogout}>Sign out</button>
      </header>

      <nav style={s.tabs}>
        {(["live","clips","events"] as Tab[]).map(id => (
          <button key={id} style={tab === id ? { ...s.tab, ...s.tabActive } : s.tab} onClick={() => setTab(id)}>
            {id === "live" ? "● Live" : id === "clips" ? "⬡ Clips" : "≡ Events"}
          </button>
        ))}
      </nav>

      <main style={s.content}>
        {tab === "live" && (
          <div style={s.liveGrid}>
            <div style={{ display:"flex", flexDirection:"column", gap:10, overflow:"hidden" }}>
              <span style={s.section}>Live streams</span>
              <HlsPlayer streams={streams} />
            </div>
            <div style={s.side}>
              <span style={s.section}>Today's events</span>
              <EventFeed />
            </div>
          </div>
        )}
        {tab === "clips"  && <div style={s.full}><span style={s.section}>Recorded clips — 7 day retention</span><ClipBrowser /></div>}
        {tab === "events" && <div style={s.full}><span style={s.section}>Lock event history</span><EventFeed /></div>}
      </main>
    </div>
  );
}

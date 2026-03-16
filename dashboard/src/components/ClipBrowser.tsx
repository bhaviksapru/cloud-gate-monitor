import { useState, useEffect, useRef, useCallback } from "react";
import { api, type Clip, type Stream } from "../api";

const PRESIGN_TTL_MS = 13 * 60 * 1000; // re-fetch 2 min before 15-min TTL expires

const s: Record<string, React.CSSProperties> = {
  root:      { display:"flex", flexDirection:"column", gap:14, height:"100%", overflow:"hidden" },
  filters:   { display:"flex", gap:10, alignItems:"center", flexShrink:0, flexWrap:"wrap" as const },
  label:     { fontSize:11, color:"#4a4e6a", textTransform:"uppercase" as const, letterSpacing:"0.05em" },
  input:     { background:"#0d0f14", border:"1px solid #1e2130", borderRadius:6, color:"#e2e4e9", fontSize:13, padding:"5px 10px", outline:"none" },
  player:    { border:"1px solid #1e2130", borderRadius:8, overflow:"hidden", background:"#0a0c11", flexShrink:0 },
  playerHdr: { display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 12px", fontSize:12, color:"#8b8fa8", background:"#0d0f14", borderBottom:"1px solid #1e2130", gap:8 },
  closeBtn:  { background:"none", border:"none", color:"#4a4e6a", cursor:"pointer", fontSize:14, padding:"0 4px" },
  dlBtn:     { background:"none", border:"1px solid #1e2130", borderRadius:4, color:"#5b6af0", cursor:"pointer", fontSize:11, padding:"2px 8px", textDecoration:"none" as const, display:"inline-flex", alignItems:"center", gap:4 },
  video:     { width:"100%", display:"block", background:"#000" },
  grid:      { flex:1, overflowY:"auto" as const, display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(160px, 1fr))", gap:10, alignContent:"start", scrollbarWidth:"thin" as const },
  card:      { background:"#0d0f14", border:"1px solid #1e2130", borderRadius:8, overflow:"hidden", cursor:"pointer" },
  cardActive:{ border:"1px solid #5b6af0" },
  thumb:     { position:"relative" as const, aspectRatio:"16/9", background:"#08090d", overflow:"hidden" },
  thumbVid:  { width:"100%", height:"100%", objectFit:"cover" as const, opacity:0.8 },
  meta:      { padding:"6px 8px", display:"flex", flexDirection:"column", gap:2 },
  cam:       { fontSize:11, fontWeight:500, color:"#8b8fa8", textTransform:"uppercase" as const, letterSpacing:"0.04em" },
  time:      { fontSize:12, color:"#c8cad6", fontVariantNumeric:"tabular-nums" as const },
  size:      { fontSize:11, color:"#3a3e54" },
  more:      { background:"#0d0f14", border:"1px solid #1e2130", borderRadius:6, color:"#5b6af0", padding:"8px 20px", fontSize:13, cursor:"pointer", width:"100%", flexShrink:0 },
  state:     { textAlign:"center" as const, padding:32, color:"#4a4e6a", fontSize:13 },
  stale:     { fontSize:11, color:"#4a4e6a", fontStyle:"italic" as const },
};

function ClipCard({ clip, selected, onSelect }: { clip: Clip; selected: boolean; onSelect: (c: Clip) => void }) {
  return (
    <div style={selected ? { ...s.card, ...s.cardActive } : s.card} onClick={() => onSelect(clip)}>
      <div style={s.thumb}>
        <video src={`${clip.presignedUrl}#t=0.5`} style={s.thumbVid} muted preload="metadata" />
        <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,0.3)", opacity:0, transition:"opacity 0.15s" }}
          onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={e => (e.currentTarget.style.opacity = "0")}>
          <span style={{ fontSize:20, color:"#fff" }}>▶</span>
        </div>
      </div>
      <div style={s.meta}>
        <span style={s.cam}>{clip.camera}</span>
        <span style={s.time}>{clip.time}</span>
        {clip.sizeBytes && <span style={s.size}>{(clip.sizeBytes / 1048576).toFixed(1)} MB</span>}
      </div>
    </div>
  );
}

function InlinePlayer({ clip, onClose }: { clip: Clip; onClose: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { ref.current?.play().catch(() => {}); }, [clip]);

  function handleDownload(e: React.MouseEvent) {
    e.preventDefault();
    const a = document.createElement("a");
    a.href = clip.presignedUrl;
    a.download = `${clip.camera}_${clip.date}_${clip.time.replace(/:/g, "-")}.mp4`;
    a.click();
  }

  return (
    <div style={s.player}>
      <div style={s.playerHdr}>
        <span style={{ flex:1 }}>{clip.camera} — {clip.date} {clip.time}</span>
        {clip.sizeBytes && <span style={s.stale}>{(clip.sizeBytes / 1048576).toFixed(1)} MB</span>}
        <a style={s.dlBtn} href={clip.presignedUrl} onClick={handleDownload} title="Download clip">
          ↓ Download
        </a>
        <button style={s.closeBtn} onClick={onClose}>✕</button>
      </div>
      <video ref={ref} src={clip.presignedUrl} style={s.video} controls autoPlay playsInline />
    </div>
  );
}

interface Props { streams: Stream[] }

export default function ClipBrowser({ streams }: Props) {
  const [clips, setClips]         = useState<Clip[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [camera, setCamera]       = useState("");
  const [date, setDate]           = useState(() => new Date().toISOString().slice(0, 10));
  const [nextToken, setNextToken] = useState<string | undefined>();
  const [selected, setSelected]   = useState<Clip | null>(null);
  const fetchedAtRef              = useRef<number>(0);

  // Camera list sourced from live streams (passed in from Dashboard),
  // NOT derived from clip results — so dropdown is always populated.
  const cameraNames = streams.map(st => st.camera);

  const fetchClips = useCallback(async (cam: string, dt: string) => {
    setLoading(true); setError(null); setClips([]); setNextToken(undefined); setSelected(null);
    try {
      const r = await api.clips(cam || undefined, dt);
      setClips(r.clips);
      setNextToken(r.nextToken);
      fetchedAtRef.current = Date.now();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchClips(camera, date); }, [camera, date, fetchClips]);

  // Re-fetch presigned URLs before they expire (checked every minute).
  // Skips when tab is hidden to avoid wasted API calls.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - fetchedAtRef.current >= PRESIGN_TTL_MS) {
        fetchClips(camera, date);
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [camera, date, fetchClips]);

  async function loadMore() {
    if (!nextToken) return;
    try {
      const r = await api.clips(camera || undefined, date, nextToken);
      setClips(prev => [...prev, ...r.clips]);
      setNextToken(r.nextToken);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div style={s.root}>
      <div style={s.filters}>
        <span style={s.label}>Camera</span>
        <select style={s.input} value={camera} onChange={e => setCamera(e.target.value)}>
          <option value="">All cameras</option>
          {cameraNames.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <span style={s.label}>Date</span>
        <input type="date" style={s.input} value={date}
          max={new Date().toISOString().slice(0, 10)}
          onChange={e => setDate(e.target.value)} />
        <button
          style={{ ...s.more, width:"auto", padding:"5px 14px", fontSize:12 }}
          onClick={() => fetchClips(camera, date)}
          disabled={loading}>
          ↻ Refresh
        </button>
      </div>

      {selected && <InlinePlayer clip={selected} onClose={() => setSelected(null)} />}

      {loading && <div style={s.state}>Loading clips…</div>}
      {error   && <div style={{ ...s.state, color:"#e05c6b" }}>{error}</div>}
      {!loading && !error && clips.length === 0 && (
        <div style={s.state}>No clips for {date}{camera ? ` · ${camera}` : ""}</div>
      )}

      {!loading && clips.length > 0 && (
        <>
          <div style={s.grid}>
            {clips.map(c => (
              <ClipCard key={c.key} clip={c} selected={selected?.key === c.key} onSelect={setSelected} />
            ))}
          </div>
          {nextToken && <button style={s.more} onClick={loadMore}>Load more</button>}
        </>
      )}
    </div>
  );
}

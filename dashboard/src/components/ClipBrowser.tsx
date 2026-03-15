import { useState, useEffect, useRef } from "react";
import { api, type Clip } from "../api";

const s: Record<string, React.CSSProperties> = {
  root:      { display:"flex", flexDirection:"column", gap:14, height:"100%", overflow:"hidden" },
  filters:   { display:"flex", gap:10, alignItems:"center", flexShrink:0 },
  label:     { fontSize:11, color:"#4a4e6a", textTransform:"uppercase" as const, letterSpacing:"0.05em" },
  input:     { background:"#0d0f14", border:"1px solid #1e2130", borderRadius:6, color:"#e2e4e9", fontSize:13, padding:"5px 10px", outline:"none" },
  player:    { border:"1px solid #1e2130", borderRadius:8, overflow:"hidden", background:"#0a0c11", flexShrink:0 },
  playerHdr: { display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 12px", fontSize:12, color:"#8b8fa8", background:"#0d0f14", borderBottom:"1px solid #1e2130" },
  closeBtn:  { background:"none", border:"none", color:"#4a4e6a", cursor:"pointer", fontSize:14, padding:"0 4px" },
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
  return (
    <div style={s.player}>
      <div style={s.playerHdr}>
        <span>{clip.camera} — {clip.date} {clip.time}</span>
        <button style={s.closeBtn} onClick={onClose}>✕</button>
      </div>
      <video ref={ref} src={clip.presignedUrl} style={s.video} controls autoPlay playsInline />
    </div>
  );
}

export default function ClipBrowser() {
  const [clips, setClips]         = useState<Clip[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [camera, setCamera]       = useState("");
  const [date, setDate]           = useState(() => new Date().toISOString().slice(0, 10));
  const [nextToken, setNextToken] = useState<string | undefined>();
  const [selected, setSelected]   = useState<Clip | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setClips([]); setNextToken(undefined);
    api.clips(camera || undefined, date)
      .then(r => { if (!cancelled) { setClips(r.clips); setNextToken(r.nextToken); } })
      .catch(e => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [camera, date]);

  const cameras = [...new Set(clips.map(c => c.camera))];

  async function loadMore() {
    if (!nextToken) return;
    const r = await api.clips(camera || undefined, date, nextToken);
    setClips(prev => [...prev, ...r.clips]);
    setNextToken(r.nextToken);
  }

  return (
    <div style={s.root}>
      <div style={s.filters}>
        <span style={s.label}>Camera</span>
        <select style={s.input} value={camera} onChange={e => setCamera(e.target.value)}>
          <option value="">All</option>
          {cameras.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <span style={s.label}>Date</span>
        <input type="date" style={s.input} value={date}
          max={new Date().toISOString().slice(0, 10)}
          onChange={e => setDate(e.target.value)} />
      </div>

      {selected && <InlinePlayer clip={selected} onClose={() => setSelected(null)} />}

      {loading && <div style={s.state}>Loading clips…</div>}
      {error   && <div style={{ ...s.state, color:"#e05c6b" }}>{error}</div>}
      {!loading && !error && clips.length === 0 && <div style={s.state}>No clips for {date}</div>}

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

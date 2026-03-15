import { useEffect, useRef, useState } from "react";
import type { Stream } from "../api";

type Status = "connecting" | "live" | "error";

const s: Record<string, React.CSSProperties> = {
  grid:    { display:"grid", gap:12, gridTemplateColumns:"repeat(auto-fit, minmax(320px, 1fr))", alignContent:"start" },
  wrap:    { background:"#0a0c11", borderRadius:8, overflow:"hidden", border:"1px solid #1e2130", display:"flex", flexDirection:"column" },
  header:  { display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 12px", background:"#0d0f14", borderBottom:"1px solid #1e2130" },
  label:   { fontSize:12, fontWeight:500, color:"#8b8fa8", textTransform:"uppercase" as const, letterSpacing:"0.05em" },
  video:   { width:"100%", aspectRatio:"16/9", display:"block", background:"#000" },
  empty:   { display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:6, padding:48, border:"1px dashed #1e2130", borderRadius:8, color:"#4a4e6a", fontSize:14 },
};

function badge(status: Status) {
  const map: Record<Status, { label: string; color: string; bg: string }> = {
    connecting: { label: "Connecting…", color: "#5b6af0", bg: "rgba(91,106,240,0.12)" },
    live:       { label: "● LIVE",      color: "#34d399", bg: "rgba(52,211,153,0.12)"  },
    error:      { label: "Offline",     color: "#e05c6b", bg: "rgba(224,92,107,0.12)"  },
  };
  const { label, color, bg } = map[status];
  return <span style={{ fontSize:11, fontWeight:500, padding:"2px 8px", borderRadius:4, color, background:bg }}>{label}</span>;
}

function Player({ stream }: { stream: Stream }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<Status>("connecting");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Safari has native HLS
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = stream.liveUrl;
      video.addEventListener("loadedmetadata", () => setStatus("live"), { once: true });
      video.addEventListener("error", () => setStatus("error"), { once: true });
      video.play().catch(() => {});
      return () => { video.src = ""; };
    }

    // Chrome / Firefox → hls.js (dynamic import keeps bundle small)
    let destroyed = false;
    import("hls.js").then(({ default: Hls }) => {
      if (destroyed || !Hls.isSupported()) { setStatus("error"); return; }
      const hls = new Hls({ liveSyncDurationCount: 3, lowLatencyMode: true, backBufferLength: 30 });
      hls.loadSource(stream.liveUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => { setStatus("live"); video.play().catch(() => {}); });
      hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) { setStatus("error"); hls.destroy(); } });
      (video as HTMLVideoElement & { _hls?: typeof hls })._hls = hls;
    });

    return () => {
      destroyed = true;
      const h = (video as HTMLVideoElement & { _hls?: { destroy: () => void } })._hls;
      h?.destroy();
    };
  }, [stream.liveUrl]);

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <span style={s.label}>{stream.camera}</span>
        {badge(status)}
      </div>
      <video ref={videoRef} style={s.video} muted playsInline autoPlay controls />
    </div>
  );
}

export default function HlsPlayer({ streams }: { streams: Stream[] }) {
  if (!streams.length) {
    return (
      <div style={s.empty}>
        <span>No live streams</span>
        <span style={{ fontSize:12, color:"#2e3148" }}>Check that Pi services are running</span>
      </div>
    );
  }
  return (
    <div style={s.grid}>
      {streams.map(s => <Player key={s.camera} stream={s} />)}
    </div>
  );
}

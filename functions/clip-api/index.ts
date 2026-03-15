import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3             = new S3Client({});
const BUCKET         = process.env.VIDEO_BUCKET!;
const CF_DOMAIN      = process.env.CLOUDFRONT_DOMAIN!;
const PRESIGN_TTL    = 900; // 15 min

interface Clip {
  key: string;
  camera: string;
  date: string;
  time: string;
  timestamp: number;
  sizeBytes?: number;
  presignedUrl: string;
}

function parseKey(key: string): Omit<Clip, "presignedUrl"> | null {
  const m = key.match(/^clips\/([^/]+)\/(\d{4})\/(\d{2})\/(\d{2})\/(\d{2})-(\d{2})-(\d{2})\.mp4$/);
  if (!m) return null;
  const [, camera, y, mo, d, h, min, s] = m;
  return {
    key,
    camera,
    date: `${y}-${mo}-${d}`,
    time: `${h}:${min}:${s}`,
    timestamp: new Date(`${y}-${mo}-${d}T${h}:${min}:${s}Z`).getTime(),
  };
}

async function listClips(query: Record<string, string>) {
  const { camera, date, limit = "50", nextToken } = query;

  let prefix = "clips/";
  if (camera) {
    prefix += `${camera}/`;
    if (date) {
      const [y, m, d] = date.split("-");
      prefix += `${y}/${m}/${d}/`;
    }
  }

  const { Contents = [], NextContinuationToken, IsTruncated } =
    await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      MaxKeys: Math.min(parseInt(limit), 200),
      ContinuationToken: nextToken,
    }));

  const clips = await Promise.all(
    Contents.filter(o => o.Key?.endsWith(".mp4")).map(async o => {
      const meta = parseKey(o.Key!);
      if (!meta) return null;
      const presignedUrl = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: BUCKET, Key: o.Key! }),
        { expiresIn: PRESIGN_TTL }
      );
      return { ...meta, sizeBytes: o.Size, presignedUrl } satisfies Clip;
    })
  );

  return {
    clips: clips.filter(Boolean).sort((a, b) => b!.timestamp - a!.timestamp),
    nextToken: IsTruncated ? NextContinuationToken : undefined,
  };
}

async function listLive(query: Record<string, string>) {
  const { camera } = query;
  const prefix = camera ? `live/${camera}/` : "live/";

  const { CommonPrefixes = [] } = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: prefix,
    Delimiter: "/",
  }));

  const cameras = camera
    ? [camera]
    : CommonPrefixes.map(p => p.Prefix?.replace("live/", "").replace("/", "")).filter(Boolean) as string[];

  return {
    streams: cameras.map(cam => ({
      camera: cam,
      liveUrl: `https://${CF_DOMAIN}/live/${cam}/stream.m3u8`,
    })),
  };
}

export const handler = async (event: { rawPath?: string; queryStringParameters?: Record<string, string> }) => {
  try {
    const path  = event.rawPath ?? "/clips";
    const query = event.queryStringParameters ?? {};
    const body  = path.startsWith("/clips/live") ? await listLive(query) : await listClips(query);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify(body),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: "Internal error" }) };
  }
};

import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3          = new S3Client({});
const BUCKET      = process.env.VIDEO_BUCKET!;
const CF_DOMAIN   = process.env.CLOUDFRONT_DOMAIN!;
const PRESIGN_TTL = 900; // 15 min

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

async function presign(key: string): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn: PRESIGN_TTL }
  );
}

async function listClips(query: Record<string, string>) {
  const { camera, date, limit = "50", nextToken } = query;

  // FIX: Previously date was only applied when camera was also set, silently
  // dropping the date filter for "All cameras" queries. Now we build the most
  // specific S3 prefix possible from whatever filters are provided.

  if (date && !camera) {
    // Date-only across all cameras: path is clips/{camera}/{y}/{m}/{d}/ so we
    // can't express this with a single prefix. Enumerate cameras first, then
    // fan out a parallel request per camera for the specific date.
    const { CommonPrefixes = [] } = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET, Prefix: "clips/", Delimiter: "/",
    }));
    const cameraNames = CommonPrefixes
      .map(p => p.Prefix?.replace("clips/", "").replace("/", ""))
      .filter(Boolean) as string[];

    if (cameraNames.length === 0) return { clips: [], nextToken: undefined };

    const [y, m, d] = date.split("-");
    const allObjects = (
      await Promise.all(
        cameraNames.map(cam =>
          s3.send(new ListObjectsV2Command({
            Bucket: BUCKET,
            Prefix: `clips/${cam}/${y}/${m}/${d}/`,
            MaxKeys: Math.min(parseInt(limit), 200),
          })).then(r => r.Contents ?? [])
        )
      )
    ).flat();

    const clips = await Promise.all(
      allObjects.filter(o => o.Key?.endsWith(".mp4")).map(async o => {
        const meta = parseKey(o.Key!);
        if (!meta) return null;
        return { ...meta, sizeBytes: o.Size, presignedUrl: await presign(o.Key!) } satisfies Clip;
      })
    );

    return {
      clips: clips.filter(Boolean).sort((a, b) => b!.timestamp - a!.timestamp),
      nextToken: undefined, // cross-camera date queries don't paginate via ContinuationToken
    };
  }

  // Camera set, date optional — or no filters at all
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
      return { ...meta, sizeBytes: o.Size, presignedUrl: await presign(o.Key!) } satisfies Clip;
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
    Bucket: BUCKET, Prefix: prefix, Delimiter: "/",
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

export const handler = async (event: {
  rawPath?: string;
  queryStringParameters?: Record<string, string>;
}) => {
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

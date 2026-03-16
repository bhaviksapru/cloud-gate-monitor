import { DynamoDBClient, PutItemCommand, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { SSMClient, GetParametersCommand } from "@aws-sdk/client-ssm";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { createHmac } from "crypto";

const ddb = new DynamoDBClient({});
const ssm = new SSMClient({});
// FIX: was hardcoded to "us-east-1" — stack deploys to ca-central-1 and SMS
// sandbox state is per-region, so alerts were silently failing if the sandbox
// was not also configured in us-east-1.
const sns = new SNSClient({ region: "ca-central-1" });

const TABLE          = process.env.TABLE_NAME!;
const DASHBOARD_URL  = process.env.DASHBOARD_URL!;

// TTLock recordType values that represent a failed attempt
const FAILED_TYPES = new Set([1, 6, 9, 12, 47, 55]);

interface TTLockEvent {
  lockId?: number;
  recordType?: number;
  success?: number;
  serverDate?: number;
  username?: string;
  electricQuantity?: number;
}

interface Config {
  threshold: number;
  windowMinutes: number;
  phone: string;
  secret: string;
}

async function loadConfig(): Promise<Config> {
  const { Parameters = [] } = await ssm.send(new GetParametersCommand({
    Names: [
      process.env.THRESHOLD_PARAM!,
      process.env.WINDOW_PARAM!,
      process.env.PHONE_PARAM!,
      process.env.SECRET_PARAM!,
    ],
    WithDecryption: true,
  }));
  const m = Object.fromEntries(Parameters.map(p => [p.Name!, p.Value!]));
  return {
    threshold:     parseInt(m[process.env.THRESHOLD_PARAM!] ?? "1"),
    windowMinutes: parseInt(m[process.env.WINDOW_PARAM!]    ?? "60"),
    phone:         m[process.env.PHONE_PARAM!],
    secret:        m[process.env.SECRET_PARAM!],
  };
}

function verifySignature(body: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(body, "utf8").digest("hex");
  const provided  = signature.replace(/^sha256=/, "");
  if (expected.length !== provided.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  return diff === 0;
}

async function storeEvent(event: TTLockEvent, nowMs: number): Promise<void> {
  const ts     = String(event.serverDate ?? nowMs);
  // FIX: lockId was stored as { N: lockId } which throws a DynamoDB
  // ValidationException when lockId is "unknown" (non-numeric string).
  // The event was silently dropped because the outer catch returns 200.
  // Stored as { S } here to be consistent with pk/sk which already use it
  // as a string, and to safely handle any non-numeric fallback value.
  const lockId = String(event.lockId ?? "unknown");
  const date   = new Date(parseInt(ts)).toISOString().slice(0, 10);
  const time   = new Date(parseInt(ts)).toISOString().slice(11, 19);
  const ttl    = Math.floor(nowMs / 1000) + 7 * 86400;

  await ddb.send(new PutItemCommand({
    TableName: TABLE,
    Item: {
      pk:         { S: `LOCK#${lockId}` },
      sk:         { S: `EVENT#${ts}` },
      gsi1pk:     { S: `DATE#${date}` },
      gsi1sk:     { S: `TIME#${time}#LOCK#${lockId}` },
      lockId:     { S: lockId },
      recordType: { N: String(event.recordType ?? 0) },
      success:    { N: String(event.success ?? 0) },
      username:   { S: event.username ?? "" },
      serverDate: { N: ts },
      rawEvent:   { S: JSON.stringify(event) },
      ttl:        { N: String(ttl) },
    },
  }));
}

async function checkCounter(lockId: string, nowMs: number, windowMinutes: number, threshold: number): Promise<{ count: number; shouldAlert: boolean }> {
  const windowDurationMs = windowMinutes * 60 * 1000;

  const { Item } = await ddb.send(new GetItemCommand({
    TableName: TABLE,
    Key: { pk: { S: `LOCK#${lockId}` }, sk: { S: "FAILED_CTR" } },
  }));

  let count = 1;
  let newWindowStart = nowMs;
  if (Item) {
    const existingWindowStart = parseInt(Item.windowStart?.N ?? "0");
    const existingCount       = parseInt(Item.count?.N ?? "0");
    const windowStillActive   = (nowMs - existingWindowStart) <= windowDurationMs;
    if (windowStillActive) {
      count          = existingCount + 1;
      newWindowStart = existingWindowStart;
    }
  }

  const ttl = Math.floor(nowMs / 1000) + windowMinutes * 90;
  await ddb.send(new UpdateItemCommand({
    TableName: TABLE,
    Key: { pk: { S: `LOCK#${lockId}` }, sk: { S: "FAILED_CTR" } },
    UpdateExpression: "SET #c = :c, windowStart = :ws, lastAttempt = :la, #ttl = :ttl",
    ExpressionAttributeNames: { "#c": "count", "#ttl": "ttl" },
    ExpressionAttributeValues: {
      ":c":   { N: String(count) },
      ":ws":  { N: String(newWindowStart) },
      ":la":  { N: String(nowMs) },
      ":ttl": { N: String(ttl) },
    },
  }));

  return { count, shouldAlert: count >= threshold };
}

async function sendSms(phone: string, lockId: string, count: number, threshold: number, ts: number): Promise<void> {
  const time = new Date(ts).toLocaleString("en-CA", {
    timeZone: "America/Toronto",
    dateStyle: "short",
    timeStyle: "short",
  });

  await sns.send(new PublishCommand({
    PhoneNumber: phone,
    Message: `GATE ALERT\nLock #${lockId}: ${count}/${threshold} failed attempt${count > 1 ? "s" : ""}.\nTime: ${time} ET\nView: ${DASHBOARD_URL}/?view=events`,
    MessageAttributes: {
      "AWS.SNS.SMS.SMSType":  { DataType: "String", StringValue: "Transactional" },
      "AWS.SNS.SMS.SenderID": { DataType: "String", StringValue: "GATE" },
    },
  }));
}

export const handler = async (event: { body?: string; headers?: Record<string, string> }) => {
  const nowMs = Date.now();

  try {
    const body      = event.body ?? "";
    const signature = event.headers?.["x-ttlock-signature"] ?? event.headers?.["X-TTLock-Signature"] ?? "";
    const config    = await loadConfig();

    if (!verifySignature(body, signature, config.secret)) {
      return { statusCode: 401, body: JSON.stringify({ error: "Invalid signature" }) };
    }

    const payload: TTLockEvent = JSON.parse(body);
    const lockId = String(payload.lockId ?? "unknown");

    await storeEvent(payload, nowMs);

    const isFailed = payload.success === 0 && FAILED_TYPES.has(payload.recordType ?? -1);
    if (isFailed) {
      const { count, shouldAlert } = await checkCounter(lockId, nowMs, config.windowMinutes, config.threshold);
      if (shouldAlert) {
        await sendSms(config.phone, lockId, count, config.threshold, payload.serverDate ?? nowMs);
      }
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  }
};

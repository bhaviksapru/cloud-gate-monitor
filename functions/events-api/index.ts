import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const ddb   = new DynamoDBClient({});
const TABLE = process.env.TABLE_NAME!;

const RECORD_LABELS: Record<number, string> = {
  1: "Bluetooth unlock",  2: "App lock",          3: "Auto lock",
  4: "Auto unlock",       5: "Unlock inside",      6: "Keyboard unlock",
  7: "IC card unlock",    8: "Fingerprint unlock",  9: "Wristband unlock",
  12: "Remote unlock",   44: "Homekit unlock",     47: "Fingerprint failed",
  55: "Face recognition failed",
};

async function byDate(date: string, limit: number, lastKey?: string) {
  const { Items = [], LastEvaluatedKey } = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: "gsi1",
    KeyConditionExpression: "gsi1pk = :pk AND begins_with(gsi1sk, :p)",
    ExpressionAttributeValues: {
      ":pk": { S: `DATE#${date}` },
      ":p":  { S: "TIME#" },
    },
    Limit: limit,
    ScanIndexForward: false,
    ExclusiveStartKey: lastKey
      ? JSON.parse(Buffer.from(lastKey, "base64url").toString())
      : undefined,
  }));

  return {
    events: Items.map(item => {
      const d = unmarshall(item);
      return {
        lockId:      d.lockId,
        recordType:  d.recordType,
        recordLabel: RECORD_LABELS[d.recordType as number] ?? `Type ${d.recordType}`,
        success:     d.success === 1,
        username:    d.username || null,
        isoDate:     new Date(d.serverDate as number).toISOString(),
        serverDate:  d.serverDate,
        batteryLevel: d.rawEvent ? (JSON.parse(d.rawEvent as string)).electricQuantity ?? null : null,
      };
    }),
    date,
    lastKey: LastEvaluatedKey
      ? Buffer.from(JSON.stringify(LastEvaluatedKey)).toString("base64url")
      : undefined,
  };
}

async function summary() {
  const date   = new Date().toISOString().slice(0, 10);
  const result = await byDate(date, 500);
  return {
    date,
    totalToday:   result.events.length,
    failedToday:  result.events.filter(e => !e.success).length,
    successToday: result.events.filter(e => e.success).length,
    lastEvent:    result.events[0] ?? null,
  };
}

export const handler = async (event: { rawPath?: string; queryStringParameters?: Record<string, string> }) => {
  try {
    const path  = event.rawPath ?? "/events";
    const q     = event.queryStringParameters ?? {};
    const limit = Math.min(parseInt(q.limit ?? "100"), 500);

    const body = path === "/events/summary"
      ? await summary()
      : await byDate(q.date ?? new Date().toISOString().slice(0, 10), limit, q.lastKey);

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

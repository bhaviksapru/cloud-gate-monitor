import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const ddb    = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE  = process.env.EVENTS_TABLE!; // cgm-events

// recordType → human-readable label (matches TTLock spec)
const RECORD_LABELS: Record<number, string> = {
  1: "Bluetooth unlock", 2: "App lock", 3: "Auto lock", 4: "Auto unlock",
  5: "Lock manually", 6: "Keyboard unlock", 7: "IC card unlock",
  8: "Remote unlock", 9: "Keyboard password error", 10: "IC card error",
  11: "Fingerprint unlock", 12: "Remote unlock via app",
  44: "Fingerprint error", 45: "Door open alarm", 46: "Door long open alarm",
  47: "Keyboard lock-out", 55: "Face recognition failed",
};

function recordLabel(type: number): string {
  return RECORD_LABELS[type] ?? `Record type ${type}`;
}

// ─── /events ────────────────────────────────────────────────────────────────
async function queryEvents(query: Record<string, string>) {
  const date    = query.date ?? new Date().toISOString().slice(0, 10); // default today
  const lastKey = query.lastKey ? JSON.parse(decodeURIComponent(query.lastKey)) : undefined;

  const result = await ddb.send(new QueryCommand({
    TableName:              TABLE,
    IndexName:              "gsi1",
    KeyConditionExpression: "gsi1pk = :pk",
    ExpressionAttributeValues: { ":pk": `DATE#${date}` },
    ScanIndexForward:       false,   // newest first
    Limit:                  100,
    ExclusiveStartKey:      lastKey,
  }));

  const events = (result.Items ?? []).map(item => ({
    lockId:       item.lockId,
    recordType:   item.recordType,
    recordLabel:  recordLabel(item.recordType),
    success:      item.success ?? item.recordType === 1,
    username:     item.username ?? null,
    isoDate:      item.isoDate,
    serverDate:   item.serverDate,
    batteryLevel: item.batteryLevel ?? null,
  }));

  return {
    events,
    date,
    lastKey: result.LastEvaluatedKey
      ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey))
      : undefined,
  };
}

// ─── /events/summary ────────────────────────────────────────────────────────
async function querySummary() {
  const today = new Date().toISOString().slice(0, 10);

  const result = await ddb.send(new QueryCommand({
    TableName:              TABLE,
    IndexName:              "gsi1",
    KeyConditionExpression: "gsi1pk = :pk",
    ExpressionAttributeValues: { ":pk": `DATE#${today}` },
    ScanIndexForward:       false,
    Limit:                  500, // enough for a day's events; avoids full scan
  }));

  const items = result.Items ?? [];
  const failTypes = new Set([9, 10, 44, 47, 55]); // failure record types
  const failed  = items.filter(i => failTypes.has(i.recordType) || i.success === false).length;
  const success = items.length - failed;

  const lastItem = items[0] ?? null;
  const lastEvent = lastItem ? {
    lockId:      lastItem.lockId,
    recordType:  lastItem.recordType,
    recordLabel: recordLabel(lastItem.recordType),
    success:     lastItem.success ?? true,
    username:    lastItem.username ?? null,
    isoDate:     lastItem.isoDate,
    serverDate:  lastItem.serverDate,
    batteryLevel: lastItem.batteryLevel ?? null,
  } : null;

  return {
    date:         today,
    totalToday:   items.length,
    failedToday:  failed,
    successToday: success,
    lastEvent,
  };
}

// ─── Handler ─────────────────────────────────────────────────────────────────
export const handler = async (event: {
  rawPath?: string;
  queryStringParameters?: Record<string, string>;
}) => {
  try {
    const path  = event.rawPath ?? "/events";
    const query = event.queryStringParameters ?? {};

    const body = path.startsWith("/events/summary")
      ? await querySummary()
      : await queryEvents(query);

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

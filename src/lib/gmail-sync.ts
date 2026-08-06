import "server-only";
import type { gmail_v1 } from "googleapis";
import { getGmailClient } from "@/lib/gmail-client";
import { storeBilag } from "@/lib/bilag-store";

const TIME_BUDGET_MS = 45_000;

function headerValue(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string,
): string | undefined {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? undefined;
}

function flattenParts(
  part: gmail_v1.Schema$MessagePart | undefined,
  acc: gmail_v1.Schema$MessagePart[] = [],
): gmail_v1.Schema$MessagePart[] {
  if (!part) return acc;
  acc.push(part);
  for (const child of part.parts ?? []) {
    flattenParts(child, acc);
  }
  return acc;
}

function decodeBase64Url(data: string): Uint8Array<ArrayBuffer> {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(Buffer.from(normalized, "base64")) as Uint8Array<ArrayBuffer>;
}

async function processMessage(gmail: gmail_v1.Gmail, messageId: string) {
  const msgRes = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });
  const msg = msgRes.data;
  const payload = msg.payload;
  if (!payload) return { skipped: false, attachments: 0 };

  const allParts = flattenParts(payload);
  const emailMessageId = headerValue(payload.headers, "Message-Id") ?? messageId;
  const senderEmail = headerValue(payload.headers, "From") ?? "ukendt";
  const subject = headerValue(payload.headers, "Subject") ?? "";
  const receivedAt = msg.internalDate ? new Date(Number(msg.internalDate)) : new Date();
  const snippet = msg.snippet ?? null;

  const attachments = [];
  for (const part of allParts) {
    if (part.filename && part.body?.attachmentId) {
      const attRes = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId,
        id: part.body.attachmentId,
      });
      if (!attRes.data.data) continue;

      attachments.push({
        filename: part.filename,
        contentType: part.mimeType ?? "application/octet-stream",
        data: decodeBase64Url(attRes.data.data),
      });
    }
  }

  return storeBilag({
    emailMessageId,
    emailThreadId: msg.threadId ?? messageId,
    receivedAt,
    senderEmail,
    subject,
    snippet,
    attachments,
  });
}

export type SyncBilagResult = {
  processed: number;
  created: number;
  skipped: number;
  attachments: number;
  pagesFetched: number;
  nextPageToken: string | null;
};

export async function syncBilagFromGmail(options: {
  days: number;
  limit: number;
  pageToken?: string;
}): Promise<SyncBilagResult> {
  const recipient = process.env.GMAIL_IMPERSONATE_EMAIL;
  if (!recipient) {
    throw new Error("GMAIL_IMPERSONATE_EMAIL er ikke konfigureret.");
  }

  const gmail = getGmailClient();
  const startedAt = Date.now();

  let pageToken = options.pageToken;
  let processed = 0;
  let created = 0;
  let skipped = 0;
  let attachmentsTotal = 0;
  let pagesFetched = 0;
  let nextPageToken: string | null = null;

  while (true) {
    const listRes = await gmail.users.messages.list({
      userId: "me",
      q: `to:${recipient} newer_than:${options.days}d`,
      maxResults: options.limit,
      pageToken,
    });
    pagesFetched += 1;

    const messages = listRes.data.messages ?? [];
    for (const message of messages) {
      if (!message.id) continue;
      const result = await processMessage(gmail, message.id);
      processed += 1;
      if (result.skipped) {
        skipped += 1;
      } else {
        created += 1;
      }
      attachmentsTotal += result.attachments;
    }

    nextPageToken = listRes.data.nextPageToken ?? null;
    if (!nextPageToken) break;
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    pageToken = nextPageToken;
  }

  return {
    processed,
    created,
    skipped,
    attachments: attachmentsTotal,
    pagesFetched,
    nextPageToken,
  };
}

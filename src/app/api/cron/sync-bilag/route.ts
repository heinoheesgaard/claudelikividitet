import { NextRequest, NextResponse } from "next/server";
import type { gmail_v1 } from "googleapis";
import { getGmailClient } from "@/lib/gmail-client";
import { storeBilag } from "@/lib/bilag-store";

export const maxDuration = 60;

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

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET er ikke konfigureret." }, { status: 500 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Ikke autoriseret." }, { status: 401 });
  }

  const recipient = process.env.GMAIL_IMPERSONATE_EMAIL;
  if (!recipient) {
    return NextResponse.json(
      { error: "GMAIL_IMPERSONATE_EMAIL er ikke konfigureret." },
      { status: 500 },
    );
  }

  const days = Number(request.nextUrl.searchParams.get("days") ?? "3") || 3;
  const pageToken = request.nextUrl.searchParams.get("pageToken") ?? undefined;

  try {
    const gmail = getGmailClient();

    const listRes = await gmail.users.messages.list({
      userId: "me",
      q: `to:${recipient} newer_than:${days}d`,
      maxResults: 100,
      pageToken,
    });

    const messages = listRes.data.messages ?? [];
    let created = 0;
    let skipped = 0;
    let attachmentsTotal = 0;

    for (const message of messages) {
      if (!message.id) continue;

      const msgRes = await gmail.users.messages.get({
        userId: "me",
        id: message.id,
        format: "full",
      });
      const msg = msgRes.data;
      const payload = msg.payload;
      if (!payload) continue;

      const allParts = flattenParts(payload);
      const emailMessageId = headerValue(payload.headers, "Message-Id") ?? message.id;
      const senderEmail = headerValue(payload.headers, "From") ?? "ukendt";
      const subject = headerValue(payload.headers, "Subject") ?? "";
      const receivedAt = msg.internalDate ? new Date(Number(msg.internalDate)) : new Date();
      const snippet = msg.snippet ?? null;

      const attachments = [];
      for (const part of allParts) {
        if (part.filename && part.body?.attachmentId) {
          const attRes = await gmail.users.messages.attachments.get({
            userId: "me",
            messageId: message.id,
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

      const result = await storeBilag({
        emailMessageId,
        emailThreadId: msg.threadId ?? message.id,
        receivedAt,
        senderEmail,
        subject,
        snippet,
        attachments,
      });

      if (result.skipped) {
        skipped += 1;
      } else {
        created += 1;
      }
      attachmentsTotal += result.attachments;
    }

    return NextResponse.json({
      ok: true,
      processed: messages.length,
      created,
      skipped,
      attachments: attachmentsTotal,
      nextPageToken: listRes.data.nextPageToken ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("sync-bilag failed", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

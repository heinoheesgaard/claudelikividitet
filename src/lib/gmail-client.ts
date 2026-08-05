import "server-only";
import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

export function getGmailClient() {
  const clientEmail = process.env.GMAIL_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = process.env.GMAIL_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  const impersonatedUser = process.env.GMAIL_IMPERSONATE_EMAIL?.trim();

  if (!clientEmail || !privateKey || !impersonatedUser) {
    throw new Error(
      "GMAIL_SERVICE_ACCOUNT_EMAIL, GMAIL_SERVICE_ACCOUNT_PRIVATE_KEY eller GMAIL_IMPERSONATE_EMAIL er ikke konfigureret.",
    );
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: SCOPES,
    subject: impersonatedUser,
  });

  return google.gmail({ version: "v1", auth });
}

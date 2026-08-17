import "server-only";
import { put, get, del } from "@vercel/blob";

// Attachments are private financial documents (receipts, invoices) — never
// meant to be reachable by a bare URL. Private access means reading always
// requires going through our own authenticated routes, which fetch
// server-side using the project's Vercel OIDC credentials (BLOB_STORE_ID +
// the system-provided VERCEL_OIDC_TOKEN — no token to manage or leak).
export async function uploadAttachmentToBlob(
  filename: string,
  data: Uint8Array,
  contentType: string,
): Promise<string> {
  const blob = await put(`bilag-attachments/${filename}`, Buffer.from(data), {
    access: "private",
    contentType,
    addRandomSuffix: true,
  });
  return blob.pathname;
}

export async function readAttachmentFromBlob(pathname: string): Promise<Buffer> {
  const result = await get(pathname, { access: "private" });
  if (!result?.stream) {
    throw new Error(`Vedhæftning ikke fundet i blob-lager: ${pathname}`);
  }
  const chunks: Buffer[] = [];
  const reader = result.stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export async function deleteAttachmentFromBlob(pathname: string): Promise<void> {
  await del(pathname);
}

// New attachments are stored in Blob (blobPathname set, data null).
// Attachments created before this migration still have their bytes in
// Postgres (blobPathname null, data set) — read either transparently so
// nothing already stored needs to move before this ships.
export async function resolveAttachmentBytes(attachment: {
  data: Uint8Array | Buffer | null;
  blobPathname: string | null;
}): Promise<Buffer> {
  if (attachment.blobPathname) {
    return readAttachmentFromBlob(attachment.blobPathname);
  }
  if (attachment.data) {
    return Buffer.from(attachment.data);
  }
  throw new Error("Vedhæftningen har hverken data i databasen eller en blob-sti.");
}

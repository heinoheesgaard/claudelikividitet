import type { NextConfig } from "next";

// tesseract.js resolves its Node worker script at runtime via a dynamic
// path lookup that Vercel's file tracer can't follow statically, so the
// file gets silently dropped from the deployed function bundle unless we
// force-include it here for every route that can reach OCR (directly, or
// via storeBilag -> guessInvoiceDetails).
const tesseractIncludes = ["./node_modules/tesseract.js/**/*"];

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/bilag/guess-backfill": tesseractIncludes,
    "/api/bilag/\\[id\\]/raw-text": tesseractIncludes,
    "/api/bilag/inbound": tesseractIncludes,
    "/api/bilag/sync": tesseractIncludes,
    "/api/cron/sync-bilag": tesseractIncludes,
  },
};

export default nextConfig;

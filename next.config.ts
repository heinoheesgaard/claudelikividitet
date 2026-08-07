import type { NextConfig } from "next";

// tesseract.js resolves its Node worker script — and, from inside that
// worker thread, the separate tesseract.js-core (WASM engine) and
// wasm-feature-detect packages — at runtime via dynamic path lookups that
// Vercel's file tracer can't follow statically. Without this, those files
// get silently dropped from the deployed function bundle: the worker
// thread's own `require()` then fails inside its isolated context without
// surfacing an error to the main thread, which just looks like OCR hanging
// forever. Force-include them for every route that can reach OCR (directly,
// or via storeBilag -> guessInvoiceDetails).
const tesseractIncludes = [
  "./node_modules/tesseract.js/**/*",
  "./node_modules/tesseract.js-core/**/*",
  "./node_modules/wasm-feature-detect/**/*",
];

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

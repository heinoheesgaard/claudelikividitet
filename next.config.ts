import type { NextConfig } from "next";

// tesseract.js resolves its Node worker script — and, from inside that
// worker thread, the separate tesseract.js-core (WASM engine) and
// wasm-feature-detect packages — at runtime via dynamic path lookups that
// Vercel's file tracer can't follow statically. Without this, those files
// get silently dropped from the deployed function bundle: the worker
// thread's own `require()` then fails inside its isolated context without
// surfacing an error to the main thread, which just looks like OCR hanging
// forever. Force-include them for every route that can reach OCR (directly,
// or via storeBilag -> guessInvoiceDetails). Also includes the bundled
// Danish/English traineddata (src/lib/tessdata) — without it tesseract.js
// falls back to downloading language data from jsdelivr's CDN on every
// cold serverless invocation, which is what was actually causing OCR to
// hang until its own timeout on every single call in production.
// Now that tesseract.js is excluded from bundling (serverExternalPackages,
// below) it's required via a plain, real require() at runtime — which means
// every package IT requires must also exist as real files on disk, not just
// tesseract.js itself. bmp-js was the first case found in production:
// tesseract.js's own image-format handling requires it lazily/conditionally,
// which static tracing can't always follow (the same class of gap that
// affected tesseract.js-core and wasm-feature-detect). Rather than keep
// discovering these one deploy at a time, this is the full transitive
// closure of tesseract.js's own package.json dependencies, computed by
// walking each dependency's package.json recursively.
const tesseractIncludes = [
  "./node_modules/tesseract.js/**/*",
  "./node_modules/tesseract.js-core/**/*",
  "./node_modules/wasm-feature-detect/**/*",
  "./node_modules/bmp-js/**/*",
  "./node_modules/idb-keyval/**/*",
  "./node_modules/is-url/**/*",
  "./node_modules/node-fetch/**/*",
  "./node_modules/opencollective-postinstall/**/*",
  "./node_modules/regenerator-runtime/**/*",
  "./node_modules/zlibjs/**/*",
  "./node_modules/data-uri-to-buffer/**/*",
  "./node_modules/fetch-blob/**/*",
  "./node_modules/formdata-polyfill/**/*",
  "./node_modules/node-domexception/**/*",
  "./node_modules/web-streams-polyfill/**/*",
  "./src/lib/tessdata/**/*",
];

// Route keys previously listed each OCR-capable route individually, including
// the dynamic "/api/bilag/[id]/raw-text" with its brackets escaped for glob
// matching. Despite that route's own local build output (.next/.../route.js.nft.json)
// correctly listing every required file, production kept failing to find
// tesseract.js's worker script specifically on that route — while sibling
// routes using plain string keys (no dynamic segment) worked. Rather than
// keep guessing at what's different about how Vercel's own build pipeline
// matches a bracket-containing key, apply the include list to every route
// with a single global key, removing route-key matching as a variable
// entirely.
const nextConfig: NextConfig = {
  // Next bundles server-side dependencies into each route's compiled output
  // by default, unless the package is Node-specific enough to be on Next's
  // own opt-out list (sharp, pg and prisma are — which is why those needed
  // zero extra config). tesseract.js isn't on that list, so it was being
  // compiled through Next's bundler, which its own docs point to as a source
  // of exactly this kind of breakage for packages that do Node-specific
  // things like spawning worker_threads from an on-disk script path.
  // Excluding it from bundling makes it load via a plain, real require() at
  // runtime against the actual node_modules files instead — the same path
  // tesseract.js's worker-script loading was written to expect.
  serverExternalPackages: ["tesseract.js", "tesseract.js-core", "wasm-feature-detect"],
  outputFileTracingIncludes: {
    "/*": tesseractIncludes,
  },
};

export default nextConfig;

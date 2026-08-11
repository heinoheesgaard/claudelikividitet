import "server-only";
import path from "node:path";
import { extractText } from "unpdf";
import type { Worker as TesseractWorker } from "tesseract.js";

// tesseract.js's Node worker setup does `worker.onerror = handler` to be
// notified if the spawned worker_thread fails to start (e.g. a missing
// module inside it). That's the browser Worker API's convention; Node's
// worker_threads.Worker is a plain EventEmitter and simply ignores a bare
// `.onerror` property assignment — confirmed directly: a worker that fails
// to load never fires it, so tesseract.js's own createWorker() promise never
// rejects and just hangs forever. In production this meant ANY worker
// startup failure (not just slowness) was indistinguishable from a slow
// cold start — both looked like "stuck loading" until our own external
// timeout fired. Patch Worker.prototype once so `.onerror = fn` actually
// forwards to the real `.on('error', fn)`, giving tesseract.js the prompt,
// real rejection it was always supposed to get.
let workerThreadsPatched = false;
async function patchWorkerThreadsOnError() {
  if (workerThreadsPatched) return;
  workerThreadsPatched = true;
  const { Worker } = await import("node:worker_threads");
  if (!Object.getOwnPropertyDescriptor(Worker.prototype, "onerror")) {
    Object.defineProperty(Worker.prototype, "onerror", {
      configurable: true,
      set(this: InstanceType<typeof Worker>, handler: (error: Error) => void) {
        this.on("error", handler);
      },
    });
  }
}

// A classic Danish invoice's totals section reads, in this order:
//   Beløb ekskl. moms (subtotal)  ->  Moms 25% (VAT, almost always a flat
//   25% rate in Denmark)  ->  I alt / Total / At betale (grand total incl.
//   VAT — this is the only figure that will ever show up on a bank
//   statement, so it's the only one worth guessing).
// Foreign invoices (e.g. SaaS subscriptions billed in EUR/USD) use their own
// wording — "Amount due", "Total" — which is why both Danish and English
// labels are included here.
// Strongest-first: labels that specifically mean "this is the final,
// payable amount" beat generic ones like bare "total", which also shows up
// in "Total moms" or "Subtotal" headings.
const STRONG_LABELS = [
  "i alt at betale",
  "beløb at betale",
  "at betale",
  "betalingsbeløb",
  "til betaling",
  "i alt",
  "totalbeløb",
  "total beløb",
  "samlet beløb",
  "grand total",
  "amount due",
  "total amount",
  "total",
];
const WEAK_LABELS = ["beløb", "sum"];
const DATE_RE = /\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})\b/g;

// Matches a money amount in either Danish (1.234,56) or international
// (1,234.56 / 22.50) notation, with group 2 flagging a trailing "%" so
// callers can exclude VAT rates written the same way ("25,00 %"). Whole-krone
// invoices sometimes drop the decimals entirely ("9.600" instead of
// "9.600,00"), so a thousands-grouped number is matched even with no
// decimal part — but a bare number needs a decimal (".xx"/",xx") to count,
// so unrelated IDs (CVR numbers, account numbers, postal codes) aren't
// mistaken for amounts. The trailing lookahead rejects a match immediately
// followed by another separator + 4 digits, since that's a date written
// like "31.07.2026" ("31.07" alone would otherwise look like a valid
// 2-decimal amount), not a price.
const LINE_AMOUNT_RE = /(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?|\d{1,3}[.,]\d{2})(?![.,]\d{4})(\s*%)?/g;

function parseAmount(raw: string): number {
  // A trailing separator followed by exactly 2 digits is the decimal point
  // — everything before it, including any other separators, is thousands
  // grouping to strip. Without that trailing 2-digit group (e.g. "9.600"),
  // there's no decimal part at all: every separator is thousands grouping.
  // Handles "1.234,56" (Danish), "1,234.56" (international), "22.50" and
  // whole-krone "9.600" (nine thousand six hundred) alike.
  if (/[.,]\d{2}$/.test(raw)) {
    const lastSepIndex = Math.max(raw.lastIndexOf(","), raw.lastIndexOf("."));
    const integerPart = raw.slice(0, lastSepIndex).replace(/[.,]/g, "");
    const decimalPart = raw.slice(lastSepIndex + 1);
    return Number(`${integerPart}.${decimalPart}`);
  }
  return Number(raw.replace(/[.,]/g, ""));
}

function detectCurrency(context: string): string | null {
  const lower = context.toLowerCase();
  if (lower.includes("€") || /\beur\b/.test(lower)) return "EUR";
  if (lower.includes("$") || /\busd\b/.test(lower)) return "USD";
  if (lower.includes("£") || /\bgbp\b/.test(lower)) return "GBP";
  if (lower.includes("kr") || /\bdkk\b/.test(lower)) return "DKK";
  return null;
}

type AmountMatch = { amount: number; currency: string | null };

function extractLineAmounts(line: string): AmountMatch[] {
  const results: AmountMatch[] = [];
  for (const m of line.matchAll(LINE_AMOUNT_RE)) {
    if (m[2]) continue; // a percentage, e.g. a VAT rate — not a money amount
    const amount = parseAmount(m[1]);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const idx = m.index ?? 0;
    const context = line.slice(Math.max(0, idx - 6), idx + m[0].length + 6);
    results.push({ amount, currency: detectCurrency(context) });
  }
  return results;
}

// A line that is *only* a money amount (with an optional currency marker),
// nothing else — e.g. "7.830,00" or "DKK 1.449,00" on its own line.
function isAmountOnlyLine(line: string): boolean {
  return /^(?:dkk|kr\.?|eur|usd|gbp|[$€£])?\s*\d{1,3}(?:[.,]\d{3})*[.,]\d{2}\s*(?:dkk|kr\.?|eur|usd|gbp|[$€£])?$/i.test(
    line.trim(),
  );
}

// A line that is *only* a label, ending in a colon, with no amount of its
// own — e.g. "Subtotal :" or "Total DKK :". Deliberately narrow (must end in
// ":") so it doesn't also catch unrelated dotted-leader metadata lines like
// "Fakturanr. ..............." or stray value lines like ": Jesper Hansen".
function isLabelOnlyLine(line: string): boolean {
  const t = line.trim();
  return t.length > 0 && /:\s*$/.test(t) && extractLineAmounts(t).length === 0;
}

function findLabeledAmounts(text: string, labels: string[]): AmountMatch[] {
  // \b boundaries stop "total" from matching inside "subtotal", or "beløb"
  // inside "nettobeløb".
  const labelPattern = new RegExp(
    `\\b(${labels.map((l) => l.replace(/\s+/g, "\\s+")).join("|")})\\b`,
    "i",
  );

  const lines = text.split("\n");
  const matches: AmountMatch[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const labelMatch = labelPattern.exec(line);
    if (!labelMatch) continue;

    // Only check right around this specific label — a table header row can
    // legitimately list "Moms" and "MomsBeløb" as *other* columns next to
    // "Total beløb", and that shouldn't disqualify the total column.
    // "(inkl. moms)" / "incl. VAT" next to the label is actually a good
    // sign — it confirms this total already includes VAT — so only a
    // pre-VAT qualifier ("ekskl. moms", "excluding tax", bare "moms" with
    // no "inkl"/"incl" nearby) should disqualify a match.
    const localStart = Math.max(0, labelMatch.index - 10);
    const localEnd = labelMatch.index + labelMatch[0].length + 15;
    const localContext = line.slice(localStart, localEnd).toLowerCase();
    const mentionsMoms = localContext.includes("moms") || /\bvat\b/.test(localContext);
    const confirmsInclVat = /\bink(l)?\.?\s*(moms|vat)|\binc(l)?\.?\s*(moms|vat)/.test(localContext);
    const isPreVat =
      /eks(kl)?\.?\s*moms|excl(uding)?\.?\s*(vat|tax)|ex\.?\s*tax|before\s*tax/.test(localContext);
    if (isPreVat || (mentionsMoms && !confirmsInclVat)) {
      continue;
    }

    // Same-line form: "I alt   1.250,00" or "Amount due   €22.50".
    const afterLabel = line.slice(labelMatch.index + labelMatch[0].length);
    const sameLineAmounts = extractLineAmounts(afterLabel);
    if (sameLineAmounts.length > 0) {
      matches.push(sameLineAmounts[sameLineAmounts.length - 1]);
      continue;
    }

    // Stacked label/value blocks: several bare labels are listed one per
    // line ("Subtotal :" / "25,00% moms :" / "Total DKK :"), immediately
    // followed by the same number of bare amount lines in the same order
    // ("7.830,00" / "1.957,50" / "9.787,50") — pair them up by position,
    // since the *n*th label always corresponds to the *n*th value here, not
    // necessarily the line right after it.
    if (isLabelOnlyLine(line)) {
      let blockStart = i;
      while (blockStart > 0 && isLabelOnlyLine(lines[blockStart - 1])) blockStart--;
      let blockEnd = i;
      while (blockEnd + 1 < lines.length && isLabelOnlyLine(lines[blockEnd + 1])) blockEnd++;

      const positionInBlock = i - blockStart;
      const valueLines: string[] = [];
      for (let j = blockEnd + 1; j < lines.length && isAmountOnlyLine(lines[j]); j++) {
        valueLines.push(lines[j]);
      }

      if (valueLines.length === blockEnd - blockStart + 1 && positionInBlock < valueLines.length) {
        const paired = extractLineAmounts(valueLines[positionInBlock]);
        if (paired.length > 0) {
          matches.push(paired[paired.length - 1]);
          continue;
        }
      }
    }

    // Table form: the label is a column header ("Vare beløb  Moms  ...
    // Total beløb") with no number of its own — the values sit on the row
    // below, in the same left-to-right column order, so "Total beløb"
    // being the last header means its value is the last amount on that row.
    for (let j = i + 1; j <= Math.min(i + 2, lines.length - 1); j++) {
      const rowAmounts = extractLineAmounts(lines[j]);
      if (rowAmounts.length > 0) {
        matches.push(rowAmounts[rowAmounts.length - 1]);
        break;
      }
    }
  }

  return matches;
}

// A Danish invoice's VAT math is a strong, layout-independent signal: the
// grand total always equals subtotal + VAT, and VAT is (almost always) a
// flat 25% of the subtotal. Scanning for three numbers anywhere in the
// document that satisfy both relationships finds the total reliably even
// when labels are missing, worded unexpectedly, or scattered around the
// page in an order the text-based heuristics below can't follow — this
// isn't tied to any particular label, wording, or layout at all.
function findArithmeticTotal(text: string): AmountMatch | null {
  const amounts = extractLineAmounts(text);
  const values = [...new Set(amounts.map((m) => m.amount))];

  let best: number | null = null;
  for (const subtotal of values) {
    if (subtotal < 1) continue; // avoid trivial matches around zero
    const expectedVat = subtotal * 0.25;
    const tolerance = Math.max(0.5, subtotal * 0.01);
    const vat = values.find((v) => Math.abs(v - expectedVat) <= tolerance);
    if (vat === undefined) continue;
    const total = values.find((v) => Math.abs(v - (subtotal + vat)) <= 0.5);
    if (total === undefined) continue;
    if (best === null || total > best) best = total;
  }

  if (best === null) return null;
  const currency = amounts.find((m) => m.amount === best)?.currency ?? null;
  return { amount: best, currency };
}

// Dates ("31.07.2026", "17-08-26") use the same punctuation as thousands
// groupings, so a fragment like "31.07" can otherwise be misread as a
// 2-decimal amount. Blanking out recognizable dates first — before any
// amount matching runs — is far more reliable than trying to reject those
// fragments after the fact with lookaheads, since a rejected match can
// still cause the regex to backtrack into a *different* wrong reading of
// the same digits (e.g. "31.07.2026" → rejected "31.07" → backtracks into
// "07.202" being misread as a thousands-grouped amount).
const DATE_MASK_RE = /\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})\b/g;

function maskDates(text: string): string {
  return text.replace(DATE_MASK_RE, (match, day: string, month: string) => {
    const d = Number(day);
    const m = Number(month);
    if (d < 1 || d > 31 || m < 1 || m > 12) return match;
    return " ".repeat(match.length);
  });
}

function guessAmountFromText(rawText: string): AmountMatch | null {
  const text = maskDates(rawText);

  // Try the VAT-math check first — when it finds a valid subtotal/VAT/total
  // triple, that's more trustworthy than pattern-matching label text, since
  // it doesn't depend on any particular wording or layout.
  const arithmetic = findArithmeticTotal(text);
  if (arithmetic) {
    return arithmetic;
  }

  // The final total is usually the last "strong" label mentioned in reading
  // order (it comes after any subtotal/VAT lines), not necessarily the
  // largest number on the page.
  const strong = findLabeledAmounts(text, STRONG_LABELS);
  if (strong.length > 0) {
    return strong[strong.length - 1];
  }

  const weak = findLabeledAmounts(text, WEAK_LABELS);
  if (weak.length > 0) {
    return weak.reduce((max, m) => (m.amount > max.amount ? m : max));
  }

  const any = extractLineAmounts(text).filter((m) => m.currency !== null);
  if (any.length > 0) {
    return any.reduce((max, m) => (m.amount > max.amount ? m : max));
  }

  return null;
}

function guessVendorFromText(text: string): string | null {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length >= 2 && l.length <= 60);

  for (const line of lines.slice(0, 8)) {
    const isMostlyDigits = (line.match(/\d/g)?.length ?? 0) > line.length / 2;
    const looksLikeDate = /\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(line);
    if (!isMostlyDigits && !looksLikeDate) {
      return line;
    }
  }
  return null;
}

function guessDateFromText(text: string): Date | null {
  const matches = [...text.matchAll(DATE_RE)];
  for (const m of matches) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    if (day < 1 || day > 31 || month < 1 || month > 12) continue;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(date.getTime())) continue;
    if (date.getTime() > Date.now()) continue;
    return date;
  }
  return null;
}

type GuessedDetails = {
  guessedAmount: number | null;
  guessedCurrency: string | null;
  guessedVendor: string | null;
  guessedInvoiceDate: Date | null;
};

const EMPTY_GUESS: GuessedDetails = {
  guessedAmount: null,
  guessedCurrency: null,
  guessedVendor: null,
  guessedInvoiceDate: null,
};

function buildGuessFromText(text: string): GuessedDetails {
  const amountMatch = guessAmountFromText(text);
  return {
    // No currency symbol found near the number almost always means it's a
    // plain Danish invoice (kr is often implied, not spelled out in every
    // table cell) — default to DKK rather than leaving it unknown.
    guessedAmount: amountMatch?.amount ?? null,
    guessedCurrency: amountMatch ? amountMatch.currency ?? "DKK" : null,
    guessedVendor: guessVendorFromText(text),
    guessedInvoiceDate: guessDateFromText(text),
  };
}

// Reused across calls (and across warm serverless invocations) so we only
// pay Tesseract's startup + language-download cost once per instance,
// instead of once per receipt photo. Loaded dynamically so a bundling or
// startup failure in this optional dependency can never break PDF-only
// guessing, which doesn't need it at all.
let ocrWorkerPromise: Promise<TesseractWorker> | null = null;

// Without an explicit langPath, tesseract.js downloads the Danish/English
// traineddata from jsdelivr's CDN on every cold start — and since every
// serverless invocation can be a fresh container with nothing cached, that
// network fetch was happening on every single OCR call. In production this
// was consistently hanging until our own OCR_TIMEOUT_MS cut it off, which is
// why "OCR timed out after 20000 ms" showed up on every attempt rather than
// just cold starts. Pointing langPath at the bundled copy (kept in sync with
// next.config.ts's tessdata tracing include) reads the trained data straight
// off disk instead. cacheMethod "none" skips tesseract.js's own attempt to
// write a copy back to that same read-only directory afterwards.
const TESSDATA_PATH = path.join(process.cwd(), "src", "lib", "tessdata");

// If worker creation itself never settles (e.g. worker_threads misbehaving in
// this specific serverless environment), the module-level cache below would
// otherwise hold a permanently-broken pending promise for the rest of this
// container's lifetime — every later request on the same warm instance would
// silently inherit the same stuck worker instead of getting a fresh attempt.
// Race it against its own timeout and reset the cache on either a timeout or
// a real rejection so the next call starts clean.
//
// Production logs showed worker creation alone — spawning a worker_thread
// and instantiating a several-MB WASM engine off Vercel's deployment
// filesystem on a cold container — taking longer than the 15s this used to
// be, on an image that finished in ~1s once the same code ran locally. That
// gap points at cold-start I/O being much slower on Vercel than on local
// disk, not a genuine hang, so this is raised to give a cold worker real
// room to finish rather than always cutting it off before we find out.
// Batch callers (gmail-sync, guess-backfill) are unaffected: their own
// tighter per-item timeout around the whole OCR call still applies on top
// of this and will cut in first.
const WORKER_INIT_TIMEOUT_MS = 40_000;

function getOcrWorker(): Promise<TesseractWorker> {
  if (!ocrWorkerPromise) {
    console.log("[ocr] creating tesseract worker, langPath =", TESSDATA_PATH);
    const startedAt = Date.now();
    const created = patchWorkerThreadsOnError()
      .then(() => import("tesseract.js"))
      .then(({ createWorker }) =>
        createWorker("dan+eng", undefined, {
          langPath: TESSDATA_PATH,
          gzip: true,
          cacheMethod: "none",
        }),
      );

    ocrWorkerPromise = new Promise<TesseractWorker>((resolve, reject) => {
      const timer = setTimeout(() => {
        console.error(`[ocr] worker creation did not settle within ${WORKER_INIT_TIMEOUT_MS}ms`);
        ocrWorkerPromise = null;
        reject(new Error("OCR worker creation timed out"));
      }, WORKER_INIT_TIMEOUT_MS);

      created.then(
        (worker) => {
          clearTimeout(timer);
          console.log(`[ocr] worker ready after ${Date.now() - startedAt}ms`);
          resolve(worker);
        },
        (error) => {
          clearTimeout(timer);
          console.error("[ocr] worker creation failed", error);
          ocrWorkerPromise = null;
          reject(error);
        },
      );
    });
  }
  return ocrWorkerPromise;
}

// Phone photos routinely come in at 3000-4000px on the long side — Tesseract's
// recognition time scales with pixel count, so feeding it a full-resolution
// photo can take far longer than our OCR_TIMEOUT_MS even once the CDN-fetch
// hang (fixed above) is gone. Downscaling to a resolution that's still easily
// readable keeps recognition fast and consistent regardless of the source
// photo's size. Greyscale + normalize also helps Tesseract on photos with
// uneven lighting/shadows, which a scanned/exported PDF never has to deal
// with. Falls back to the original bytes if preprocessing itself fails (e.g.
// a corrupt or unsupported image), so OCR still gets a chance to run.
async function preprocessImageForOcr(data: Uint8Array): Promise<Buffer> {
  const startedAt = Date.now();
  try {
    const sharp = (await import("sharp")).default;
    const result = await sharp(Buffer.from(data))
      .rotate()
      .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .greyscale()
      .normalize()
      .png()
      .toBuffer();
    console.log(
      `[ocr] preprocessed image in ${Date.now() - startedAt}ms (${data.length} -> ${result.length} bytes)`,
    );
    return result;
  } catch (error) {
    console.error("[ocr] image preprocessing failed, using original bytes", error);
    return Buffer.from(data);
  }
}

async function ocrImageText(data: Uint8Array): Promise<string> {
  console.log(`[ocr] starting recognition, input ${data.length} bytes`);
  const worker = await getOcrWorker();
  const image = await preprocessImageForOcr(data);
  const startedAt = Date.now();
  const {
    data: { text },
  } = await worker.recognize(image);
  console.log(`[ocr] recognize() finished in ${Date.now() - startedAt}ms, ${text.length} chars`);
  return text;
}

// A cold worker paying Tesseract's one-off language-data download can take
// a long time, and callers (a serverless request, a batch loop) have their
// own time budgets to respect — cap how long any single OCR call is allowed
// to block so it can never eat an entire request by itself. Batch callers
// (gmail-sync, guess-backfill) use this tighter budget since they process
// several bilag per request and need to leave room for the rest of the page.
const OCR_TIMEOUT_MS = 20_000;

// The raw-text diagnostic handles exactly one image per request with no
// other work competing for the route's 60s maxDuration, so it can afford to
// actually wait out a slow cold worker instead of cutting it off at the same
// tight budget batch callers need — the whole point of raising this is to
// find out how long a cold start really takes instead of guessing.
const DIAGNOSTIC_OCR_TIMEOUT_MS = 50_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i;

// Diagnostic helper: returns the raw text Julia extracts before any
// amount/vendor/date guessing runs on it, so a specific invoice's layout can
// be inspected directly instead of guessing blind from a screenshot.
export async function extractRawText(
  attachments: { filename: string; contentType: string; data: Uint8Array<ArrayBuffer> }[],
): Promise<{ source: "pdf" | "image" | "none"; filename: string | null; text: string }> {
  const pdf = attachments.find(
    (a) => a.contentType === "application/pdf" || a.filename.toLowerCase().endsWith(".pdf"),
  );
  if (pdf) {
    const { text } = await extractText(pdf.data.slice(), { mergePages: true });
    return { source: "pdf", filename: pdf.filename, text };
  }

  const image = attachments.find(
    (a) => a.contentType.startsWith("image/") || IMAGE_EXTENSIONS.test(a.filename),
  );
  if (image) {
    const text = await withTimeout(ocrImageText(image.data), DIAGNOSTIC_OCR_TIMEOUT_MS);
    if (text === null) {
      return {
        source: "image",
        filename: image.filename,
        text: `[OCR timed out efter ${DIAGNOSTIC_OCR_TIMEOUT_MS / 1000}s]`,
      };
    }
    return { source: "image", filename: image.filename, text };
  }

  return { source: "none", filename: null, text: "" };
}

export async function guessInvoiceDetails(
  attachments: { filename: string; contentType: string; data: Uint8Array<ArrayBuffer> }[],
): Promise<GuessedDetails> {
  const pdf = attachments.find(
    (a) => a.contentType === "application/pdf" || a.filename.toLowerCase().endsWith(".pdf"),
  );
  if (pdf) {
    try {
      // extractText detaches/transfers the underlying buffer it's given, so
      // hand it an independent copy — the original bytes still need to be
      // written to the database unmodified after this runs.
      const { text } = await extractText(pdf.data.slice(), { mergePages: true });
      return buildGuessFromText(text);
    } catch (error) {
      console.error("Could not extract invoice details from PDF", error);
      return EMPTY_GUESS;
    }
  }

  const image = attachments.find(
    (a) => a.contentType.startsWith("image/") || IMAGE_EXTENSIONS.test(a.filename),
  );
  if (image) {
    try {
      const text = await withTimeout(ocrImageText(image.data), OCR_TIMEOUT_MS);
      if (text === null) {
        console.error("OCR timed out after", OCR_TIMEOUT_MS, "ms");
        return EMPTY_GUESS;
      }
      return buildGuessFromText(text);
    } catch (error) {
      console.error("Could not OCR invoice image", error);
      return EMPTY_GUESS;
    }
  }

  return EMPTY_GUESS;
}

"use client";

import { useRef, useState } from "react";
import { formatDKK, formatDate } from "@/lib/format";
import { parseRawBankCsvText, parseRawBankXlsxRows } from "@/lib/bank-export-parser";

type MatchAttachment = {
  id: string;
  filename: string;
};

type MatchCandidate = {
  bilagId: string;
  subject: string;
  senderEmail: string;
  receivedAt: string;
  guessedInvoiceDate: string | null;
  guessedAmount: number | null;
  guessedCurrency: string | null;
  status: string;
  score: number;
  attachments: MatchAttachment[];
};

type MatchResult = {
  bilagNumber: string;
  date: string;
  text: string;
  amount: number;
  matches: MatchCandidate[];
};

type ParsedRow = {
  bilagNumber: string;
  date: string;
  text: string;
  amount: number;
};

type UnmatchedBilag = {
  bilagId: string;
  subject: string;
  senderEmail: string;
  receivedAt: string;
  guessedInvoiceDate: string | null;
  guessedAmount: number | null;
  guessedCurrency: string | null;
  attachments: MatchAttachment[];
};

type Phase = "upload" | "review" | "done";

export default function BilagAfstemningPage() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<MatchResult[] | null>(null);
  const [unmatchedBilag, setUnmatchedBilag] = useState<UnmatchedBilag[] | null>(null);
  const [ignoreSelection, setIgnoreSelection] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmedSummary, setConfirmedSummary] = useState<{
    afstemt: number;
    ignoreret: number;
  } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Per-row "is this the right bilag for this posting?" answer — defaults to
  // Ja since Julia's matches are usually right, but every single pair needs
  // an explicit thumbs up before it counts as confirmed.
  const [rowDecisions, setRowDecisions] = useState<Record<string, boolean>>({});

  function reset() {
    setFileName(null);
    setParseError(null);
    setResults(null);
    setUnmatchedBilag(null);
    setIgnoreSelection(new Set());
    setConfirmError(null);
    setConfirmedSummary(null);
    setRowDecisions({});
  }

  async function handleFile(file: File) {
    setParseError(null);
    setResults(null);
    setUnmatchedBilag(null);
    setIgnoreSelection(new Set());
    setConfirmError(null);
    setConfirmedSummary(null);
    setRowDecisions({});
    setFileName(file.name);
    setLoading(true);
    try {
      let rows: ParsedRow[];

      if (file.name.toLowerCase().endsWith(".csv")) {
        // Raw bank export: no header, semicolon-delimited (Dato;Tekst;Beløb;Valuta[;info]).
        const text = await file.text();
        rows = parseRawBankCsvText(text);
        if (rows.length === 0) {
          setParseError(
            "Kunne ikke læse posteringer fra CSV-filen. Forventet format: dato;tekst;beløb;valuta pr. linje, semikolon-adskilt, ingen overskriftsrække.",
          );
          setLoading(false);
          return;
        }
      } else {
        const XLSX = await import("xlsx");
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });

        const headerIdx = raw.findIndex(
          (r) => Array.isArray(r) && r.some((c) => String(c).trim() === "Bilag"),
        );

        if (headerIdx !== -1) {
          // e-conomic kontoudskrift — has a real "Bilag" column.
          const header = raw[headerIdx].map((c) => String(c).trim());
          const bilagCol = header.indexOf("Bilag");
          const dateCol = header.indexOf("Dato");
          const textCol = header.indexOf("Tekst");
          const amountCol = header.indexOf("Beløb (DKK)");

          rows = [];
          for (let i = headerIdx + 1; i < raw.length; i++) {
            const r = raw[i];
            if (!Array.isArray(r) || r[bilagCol] == null || r[bilagCol] === "") continue;
            const rawDate = r[dateCol];
            const date = rawDate instanceof Date ? rawDate : new Date(String(rawDate));
            if (Number.isNaN(date.getTime())) continue;
            rows.push({
              bilagNumber: String(r[bilagCol]),
              date: date.toISOString().slice(0, 10),
              text: String(r[textCol] ?? ""),
              amount: Number(r[amountCol] ?? 0),
            });
          }
        } else {
          // No "Bilag" column — try the raw bank export layout instead
          // (Dato | Tekst | Beløb | Valuta, no header row at all).
          rows = parseRawBankXlsxRows(raw);
        }

        if (rows.length === 0) {
          setParseError(
            "Kunne ikke genkende filens format — hverken en e-conomic kontoudskrift (med en 'Bilag'-kolonne) eller et rå bankudtræk (dato, tekst og beløb i de tre første kolonner).",
          );
          setLoading(false);
          return;
        }
      }

      const res = await fetch("/api/bilag/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setParseError(body.error ?? "Afstemning fejlede.");
        setLoading(false);
        return;
      }
      const body = await res.json();
      const matchResults: MatchResult[] = body.results;
      setResults(matchResults);
      setRowDecisions(
        Object.fromEntries(
          matchResults.filter((r) => r.matches.length > 0).map((r) => [r.bilagNumber, true]),
        ),
      );
      const unmatched: UnmatchedBilag[] = body.unmatchedBilag ?? [];
      setUnmatchedBilag(unmatched);
      // Pre-select all of them for archiving — the point of this list is
      // "these didn't match anything in the period", so defaulting to
      // "ignore all of them" matches the stated workflow. Anything worth
      // keeping around a bit longer can just be unchecked before confirming.
      setIgnoreSelection(new Set(unmatched.map((b) => b.bilagId)));
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Kunne ikke læse filen.");
    }
    setLoading(false);
  }

  const [zipping, setZipping] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);

  async function downloadZip(bilagIds: string[]) {
    if (bilagIds.length === 0) return;
    setZipping(true);
    setZipError(null);
    try {
      const res = await fetch("/api/bilag/zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bilagIds }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setZipError(body.error ?? "Kunne ikke downloade bilag.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "bilag.zip";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setZipError("Der skete en fejl under download.");
    }
    setZipping(false);
  }

  function toggleIgnore(bilagId: string) {
    setIgnoreSelection((prev) => {
      const next = new Set(prev);
      if (next.has(bilagId)) {
        next.delete(bilagId);
      } else {
        next.add(bilagId);
      }
      return next;
    });
  }

  async function confirmReconciliation(matchedBilagIds: string[]) {
    setConfirming(true);
    setConfirmError(null);
    try {
      const res = await fetch("/api/bilag/reconcile-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchedBilagIds,
          ignoredBilagIds: [...ignoreSelection],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setConfirmError(body.error ?? "Kunne ikke bekræfte afstemningen.");
        return;
      }
      const body = await res.json();
      setConfirmedSummary({ afstemt: body.afstemt, ignoreret: body.ignoreret });
    } catch {
      setConfirmError("Der skete en fejl under bekræftelse.");
    }
    setConfirming(false);
  }

  function setRowDecision(bilagNumber: string, decision: boolean) {
    setRowDecisions((prev) => ({ ...prev, [bilagNumber]: decision }));
  }

  const notFound = results?.filter((r) => r.matches.length === 0) ?? [];
  const found = results?.filter((r) => r.matches.length > 0) ?? [];
  const confirmedRows = found.filter((r) => rowDecisions[r.bilagNumber] !== false);
  const rejectedCount = found.length - confirmedRows.length;
  const bestMatchBilagIds = [...new Set(confirmedRows.map((r) => r.matches[0].bilagId))];
  const sortedResults = [...(results ?? [])].sort((a, b) => a.date.localeCompare(b.date));

  const phase: Phase = confirmedSummary ? "done" : results ? "review" : "upload";

  const periodLabel = (() => {
    if (!results || results.length === 0) return null;
    const dates = results.map((r) => r.date).sort();
    const from = formatDate(dates[0]);
    const to = formatDate(dates[dates.length - 1]);
    return from === to ? from : `${from} – ${to}`;
  })();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Bilagsafstemning</h1>
        <p className="text-slate-500 mt-1">
          Upload jeres bankposteringer for en periode, og Julia finder automatisk hvilke der
          allerede har et bilag — og rydder op i resten.
        </p>
      </div>

      <Stepper phase={phase} />

      {phase === "upload" && (
        <UploadZone
          fileName={fileName}
          loading={loading}
          error={parseError}
          dragOver={dragOver}
          onDragOver={setDragOver}
          onFile={handleFile}
          inputRef={fileInputRef}
        />
      )}

      {phase !== "upload" && (
        <div className="flex items-center justify-between">
          {periodLabel && (
            <p className="text-sm text-slate-500">
              Periode: <span className="font-medium text-slate-700">{periodLabel}</span>
              {fileName && <span className="text-slate-400"> · {fileName}</span>}
            </p>
          )}
          {phase === "review" && (
            <button onClick={reset} className="text-sm text-slate-500 hover:underline">
              🔄 Start forfra med en ny fil
            </button>
          )}
        </div>
      )}

      {results && phase !== "done" && (
        <>
          <SummaryCards
            foundCount={found.length}
            notFoundCount={notFound.length}
            unmatchedCount={unmatchedBilag?.length ?? 0}
          />

          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-slate-200">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Gennemgå posteringer ({sortedResults.length})
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Sorteret efter dato · venstre er banken, højre er bilaget Julia fandt (hvis nogen).
                  {rejectedCount > 0 && (
                    <span className="text-red-600"> · {rejectedCount} markeret forkert.</span>
                  )}
                </p>
              </div>
              <button
                onClick={() => downloadZip(bestMatchBilagIds)}
                disabled={zipping || bestMatchBilagIds.length === 0}
                className="bg-slate-900 text-white rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 whitespace-nowrap"
              >
                {zipping ? "Pakker…" : `📦 ZIP (${bestMatchBilagIds.length})`}
              </button>
            </div>
            {zipError && <p className="text-sm text-red-600 px-4 pt-3">{zipError}</p>}
            <div className="overflow-x-auto">
              <table className="w-full text-sm table-fixed">
                <colgroup>
                  <col className="w-[10%]" />
                  <col className="w-[24%]" />
                  <col className="w-[12%]" />
                  <col className="w-[24%]" />
                  <col className="w-[12%]" />
                  <col className="w-[10%]" />
                  <col className="w-[8%]" />
                </colgroup>
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                  <tr className="text-left border-b border-slate-200">
                    <th className="py-2 pl-4 pr-3">Dato</th>
                    <th className="py-2 pr-3">Bankpostering</th>
                    <th className="py-2 pr-3 text-right">Beløb</th>
                    <th className="py-2 pr-3 border-l border-slate-200 pl-3">Bilag</th>
                    <th className="py-2 pr-3 text-right">Bilagsbeløb</th>
                    <th className="py-2 pr-3">Fil</th>
                    <th className="py-2 pr-4 text-center">OK?</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedResults.map((r) => {
                    const m = r.matches[0];
                    if (!m) {
                      return (
                        <tr key={r.bilagNumber} className="border-b border-slate-100 bg-amber-50/50">
                          <td className="py-2 pl-4 pr-3 whitespace-nowrap text-slate-500">
                            {formatDate(r.date)}
                          </td>
                          <td className="py-2 pr-3 text-slate-900 truncate" title={r.text}>
                            {r.text}
                          </td>
                          <td className="py-2 pr-3 text-right whitespace-nowrap font-medium text-slate-900">
                            {formatDKK(r.amount)}
                          </td>
                          <td
                            colSpan={4}
                            className="py-2 pr-4 pl-3 border-l border-slate-200 text-amber-700 text-xs font-medium"
                          >
                            ❌ Mangler bilag
                          </td>
                        </tr>
                      );
                    }
                    const isDKK = m.guessedCurrency === null || m.guessedCurrency === "DKK";
                    const amountMatches =
                      m.guessedAmount != null &&
                      isDKK &&
                      Math.abs(m.guessedAmount - Math.abs(r.amount)) <= 1;
                    const decision = rowDecisions[r.bilagNumber] !== false;

                    return (
                      <tr
                        key={r.bilagNumber}
                        className={`border-b border-slate-100 ${decision ? "" : "bg-red-50"}`}
                      >
                        <td className="py-2 pl-4 pr-3 whitespace-nowrap text-slate-500">
                          {formatDate(r.date)}
                        </td>
                        <td className="py-2 pr-3 text-slate-900 truncate" title={r.text}>
                          {r.text}
                        </td>
                        <td className="py-2 pr-3 text-right whitespace-nowrap font-medium text-slate-900">
                          {formatDKK(r.amount)}
                        </td>
                        <td
                          className="py-2 pr-3 pl-3 border-l border-slate-200 text-slate-900 truncate"
                          title={m.subject}
                        >
                          {m.subject}
                        </td>
                        <td
                          className={`py-2 pr-3 text-right whitespace-nowrap font-medium ${
                            amountMatches ? "text-emerald-700" : "text-slate-900"
                          }`}
                        >
                          {m.guessedAmount != null ? (
                            <>
                              {formatDKK(m.guessedAmount)}
                              {!isDKK && ` ${m.guessedCurrency}`}
                              {amountMatches && " ✓"}
                            </>
                          ) : (
                            "–"
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          {m.attachments.length > 0 ? (
                            <div className="flex flex-col gap-0.5">
                              {m.attachments.map((a) => (
                                <a
                                  key={a.id}
                                  href={`/api/bilag/attachments/${a.id}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={a.filename}
                                  className="text-blue-600 hover:underline truncate block"
                                >
                                  📎 {a.filename}
                                </a>
                              ))}
                            </div>
                          ) : (
                            <span className="text-amber-700 text-xs">ingen fil</span>
                          )}
                        </td>
                        <td className="py-2 pr-4">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => setRowDecision(r.bilagNumber, true)}
                              title="Ja, samme udgift"
                              className={`w-7 h-7 rounded-md text-sm border ${
                                decision
                                  ? "bg-emerald-600 text-white border-emerald-600"
                                  : "bg-white text-emerald-700 border-emerald-300"
                              }`}
                            >
                              ✓
                            </button>
                            <button
                              onClick={() => setRowDecision(r.bilagNumber, false)}
                              title="Nej, forkert match"
                              className={`w-7 h-7 rounded-md text-sm border ${
                                !decision
                                  ? "bg-red-600 text-white border-red-600"
                                  : "bg-white text-red-700 border-red-300"
                              }`}
                            >
                              ✕
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {unmatchedBilag && unmatchedBilag.length > 0 && (
            <section className="bg-white border border-slate-200 rounded-lg p-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
                <h2 className="text-lg font-semibold text-slate-900">
                  🗄️ Ryd op i arkivet ({unmatchedBilag.length})
                </h2>
                <div className="flex gap-3 text-xs">
                  <button
                    onClick={() =>
                      setIgnoreSelection(new Set(unmatchedBilag.map((b) => b.bilagId)))
                    }
                    className="text-slate-500 hover:underline"
                  >
                    Vælg alle
                  </button>
                  <button onClick={() => setIgnoreSelection(new Set())} className="text-slate-500 hover:underline">
                    Fravælg alle
                  </button>
                </div>
              </div>
              <p className="text-sm text-slate-500 mb-4">
                Disse ligger i arkivet med en dato i perioden, men matcher ingen af posteringerne —
                fejlsendte kvitteringer, dubletter eller lignende. De markerede arkiveres som
                &quot;Ignoreret&quot; når du bekræfter (aldrig slettet — kan altid findes igen).
                Fjern flueben på dem du hellere vil beholde til senere.
              </p>
              <div className="flex flex-col gap-2">
                {unmatchedBilag.map((b) => (
                  <label
                    key={b.bilagId}
                    className="flex items-start gap-3 border border-slate-200 rounded-md p-3 text-sm cursor-pointer hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={ignoreSelection.has(b.bilagId)}
                      onChange={() => toggleIgnore(b.bilagId)}
                      className="mt-1"
                    />
                    <div>
                      <span className="font-medium text-slate-900">{b.subject}</span>
                      <span className="text-slate-500"> fra {b.senderEmail}</span>
                      <span className="text-slate-500"> · modtaget {formatDate(b.receivedAt)}</span>
                      {b.guessedAmount != null && (
                        <span className="text-slate-500">
                          {" "}
                          · gættet beløb {formatDKK(b.guessedAmount)}
                          {b.guessedCurrency && b.guessedCurrency !== "DKK"
                            ? ` ${b.guessedCurrency}`
                            : ""}
                        </span>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </section>
          )}

          <section className="bg-white border-2 border-slate-900 rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">3. Bekræft afstemningen</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                {bestMatchBilagIds.length} bilag → <strong className="text-slate-700">Afstemt</strong>,{" "}
                {ignoreSelection.size} bilag → <strong className="text-slate-700">Ignoreret</strong>.
                Intet slettes.
                {rejectedCount > 0 && ` De ${rejectedCount} "nej"-svar rører vi ikke.`}
              </p>
              {confirmError && <p className="text-sm text-red-600 mt-1">{confirmError}</p>}
            </div>
            <button
              onClick={() => confirmReconciliation(bestMatchBilagIds)}
              disabled={confirming || bestMatchBilagIds.length === 0}
              className="bg-slate-900 text-white rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50 whitespace-nowrap"
            >
              {confirming ? "Bekræfter…" : "✓ Bekræft afstemning"}
            </button>
          </section>
        </>
      )}

      {phase === "done" && confirmedSummary && (
        <section className="bg-emerald-50 border-2 border-emerald-300 rounded-lg p-8 text-center">
          <p className="text-4xl mb-3">🎉</p>
          <h2 className="text-lg font-bold text-emerald-900 mb-2">Afstemning gennemført</h2>
          <p className="text-sm text-emerald-800">
            {confirmedSummary.afstemt} bilag er nu markeret som endelige (Afstemt), og{" "}
            {confirmedSummary.ignoreret} er arkiveret væk (Ignoreret).
          </p>
          <button
            onClick={reset}
            className="mt-5 bg-slate-900 text-white rounded-md px-4 py-2 text-sm font-medium"
          >
            Afstem en ny periode
          </button>
        </section>
      )}
    </div>
  );
}

function Stepper({ phase }: { phase: Phase }) {
  const steps: { key: Phase; label: string }[] = [
    { key: "upload", label: "1. Upload" },
    { key: "review", label: "2. Gennemgå" },
    { key: "done", label: "3. Bekræft" },
  ];
  const order: Phase[] = ["upload", "review", "done"];
  const currentIdx = order.indexOf(phase);

  return (
    <div className="flex items-center gap-2 text-sm">
      {steps.map((s, i) => {
        const isActive = i === currentIdx;
        const isDone = i < currentIdx;
        return (
          <div key={s.key} className="flex items-center gap-2">
            <span
              className={`px-3 py-1 rounded-full font-medium ${
                isActive
                  ? "bg-slate-900 text-white"
                  : isDone
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-slate-100 text-slate-400"
              }`}
            >
              {isDone ? "✓ " : ""}
              {s.label}
            </span>
            {i < steps.length - 1 && <span className="text-slate-300">→</span>}
          </div>
        );
      })}
    </div>
  );
}

function SummaryCards({
  foundCount,
  notFoundCount,
  unmatchedCount,
}: {
  foundCount: number;
  notFoundCount: number;
  unmatchedCount: number;
}) {
  const cards = [
    { emoji: "✅", label: "Fundet", value: foundCount, color: "text-emerald-700" },
    { emoji: "❌", label: "Mangler stadig", value: notFoundCount, color: "text-amber-700" },
    { emoji: "🗄️", label: "Kan ryddes op", value: unmatchedCount, color: "text-slate-500" },
  ];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {cards.map((c) => (
        <div key={c.label} className="bg-white border border-slate-200 rounded-lg p-4 text-center">
          <p className="text-2xl">{c.emoji}</p>
          <p className={`text-3xl font-bold mt-1 ${c.color}`}>{c.value}</p>
          <p className="text-sm text-slate-500">{c.label}</p>
        </div>
      ))}
    </div>
  );
}

function UploadZone({
  fileName,
  loading,
  error,
  dragOver,
  onDragOver,
  onFile,
  inputRef,
}: {
  fileName: string | null;
  loading: boolean;
  error: string | null;
  dragOver: boolean;
  onDragOver: (v: boolean) => void;
  onFile: (file: File) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <section
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver(true);
      }}
      onDragLeave={() => onDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        onDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
      onClick={() => inputRef.current?.click()}
      className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
        dragOver ? "border-slate-900 bg-slate-50" : "border-slate-300 bg-white hover:bg-slate-50"
      }`}
    >
      <p className="text-4xl mb-3">📄</p>
      <p className="text-slate-900 font-medium">Træk en fil hertil, eller klik for at vælge</p>
      <p className="text-sm text-slate-500 mt-1">
        Bankens CSV/Excel-udtræk over posteringer, eller en kontoudskrift fra e-conomic
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
        }}
        onClick={(e) => e.stopPropagation()}
        className="hidden"
      />
      {fileName && !loading && <p className="text-sm text-slate-500 mt-4">Valgt fil: {fileName}</p>}
      {loading && (
        <p className="text-sm text-slate-500 mt-4">Gennemgår jeres posteringer og bilag…</p>
      )}
      {error && (
        <p className="text-sm text-red-600 mt-4 max-w-md mx-auto" onClick={(e) => e.stopPropagation()}>
          {error}
        </p>
      )}
    </section>
  );
}

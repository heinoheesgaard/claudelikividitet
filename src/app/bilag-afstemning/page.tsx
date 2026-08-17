"use client";

import { useEffect, useRef, useState } from "react";
import { formatDKK, formatDate } from "@/lib/format";
import { parseRawBankCsvText, parseRawBankXlsxRows } from "@/lib/bank-export-parser";
import type { Bilag } from "@/lib/types";

type MatchAttachment = { id: string; filename: string };

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

type MatchedRow = {
  id: string;
  date: string;
  text: string;
  amount: number;
  match: MatchCandidate | null;
};

type UploadRow = { date: string; text: string; amount: number };

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

type DecidedPosting = {
  id: string;
  date: string;
  text: string;
  amount: number;
  status: "CONFIRMED" | "NO_BILAG_NEEDED";
  matchedBilag: {
    id: string;
    subject: string;
    guessedVendor: string | null;
    attachments: MatchAttachment[];
  } | null;
};

export default function BilagAfstemningPage() {
  const [results, setResults] = useState<MatchedRow[] | null>(null);
  const [unmatchedBilag, setUnmatchedBilag] = useState<UnmatchedBilag[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [manualSearchFor, setManualSearchFor] = useState<MatchedRow | null>(null);

  const [ignoreSelection, setIgnoreSelection] = useState<Set<string>>(new Set());
  const [ignoring, setIgnoring] = useState(false);
  const [ignoreError, setIgnoreError] = useState<string | null>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [decidedOpen, setDecidedOpen] = useState(false);
  const [decided, setDecided] = useState<DecidedPosting[] | null>(null);
  const [decidedLoading, setDecidedLoading] = useState(false);

  const [zipping, setZipping] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);

  // Loads whatever is still waiting for a decision — run on mount, not only
  // after an upload, so leaving the page and coming back later (or a week
  // later) shows exactly where things were left, with nothing to re-upload.
  async function loadPending() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/bilag/bank-postings?status=PENDING");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setLoadError(body.error ?? "Kunne ikke hente posteringer.");
        setLoading(false);
        return;
      }
      const body = await res.json();
      setResults(body.results);
      const unmatched: UnmatchedBilag[] = body.unmatchedBilag ?? [];
      setUnmatchedBilag(unmatched);
      setIgnoreSelection(new Set(unmatched.map((b) => b.bilagId)));
    } catch {
      setLoadError("Der skete en fejl under hentning.");
    }
    setLoading(false);
  }

  useEffect(() => {
    loadPending();
  }, []);

  async function loadDecided() {
    setDecidedLoading(true);
    try {
      const [confirmedRes, noNeededRes] = await Promise.all([
        fetch("/api/bilag/bank-postings?status=CONFIRMED"),
        fetch("/api/bilag/bank-postings?status=NO_BILAG_NEEDED"),
      ]);
      const confirmed = confirmedRes.ok ? (await confirmedRes.json()).postings : [];
      const noNeeded = noNeededRes.ok ? (await noNeededRes.json()).postings : [];
      setDecided([...confirmed, ...noNeeded].sort((a, b) => b.date.localeCompare(a.date)));
    } catch {
      // Best-effort — leave whatever was already shown.
    }
    setDecidedLoading(false);
  }

  function toggleDecided() {
    const next = !decidedOpen;
    setDecidedOpen(next);
    if (next && decided === null) loadDecided();
  }

  async function runAction(id: string, body: unknown): Promise<string | null> {
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/bilag/bank-postings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        return errBody.error ?? "Handlingen fejlede.";
      }
      return null;
    } catch {
      return "Der skete en fejl.";
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function confirmRow(id: string, bilagId: string) {
    const error = await runAction(id, { action: "confirm", bilagId });
    if (error) {
      setLoadError(error);
      return;
    }
    setManualSearchFor(null);
    setDecided(null);
    await loadPending();
  }

  async function rejectRow(id: string, bilagId: string) {
    const error = await runAction(id, { action: "reject", bilagId });
    if (error) {
      setLoadError(error);
      return;
    }
    await loadPending();
  }

  async function markNoBilagNeeded(id: string) {
    const error = await runAction(id, { action: "no-bilag-needed" });
    if (error) {
      setLoadError(error);
      return;
    }
    setDecided(null);
    await loadPending();
  }

  async function undoDecided(id: string) {
    const error = await runAction(id, { action: "reset" });
    if (error) {
      setLoadError(error);
      return;
    }
    setDecided((prev) => (prev ? prev.filter((d) => d.id !== id) : prev));
    await loadPending();
  }

  async function handleFile(file: File) {
    setUploadError(null);
    setUploadMessage(null);
    setUploading(true);
    try {
      let rows: UploadRow[];

      if (file.name.toLowerCase().endsWith(".csv")) {
        // Raw bank export: no header, semicolon-delimited (Dato;Tekst;Beløb;Valuta[;info]).
        const text = await file.text();
        rows = parseRawBankCsvText(text).map((r) => ({ date: r.date, text: r.text, amount: r.amount }));
        if (rows.length === 0) {
          setUploadError(
            "Kunne ikke læse posteringer fra CSV-filen. Forventet format: dato;tekst;beløb;valuta pr. linje, semikolon-adskilt, ingen overskriftsrække.",
          );
          setUploading(false);
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
          // e-conomic kontoudskrift — has a real "Bilag" column, used here only
          // to tell a real data row from a header/footer row.
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
              date: date.toISOString().slice(0, 10),
              text: String(r[textCol] ?? ""),
              amount: Number(r[amountCol] ?? 0),
            });
          }
        } else {
          // No "Bilag" column — try the raw bank export layout instead
          // (Dato | Tekst | Beløb | Valuta, no header row at all).
          rows = parseRawBankXlsxRows(raw).map((r) => ({ date: r.date, text: r.text, amount: r.amount }));
        }

        if (rows.length === 0) {
          setUploadError(
            "Kunne ikke genkende filens format — hverken en e-conomic kontoudskrift (med en 'Bilag'-kolonne) eller et rå bankudtræk (dato, tekst og beløb i de tre første kolonner).",
          );
          setUploading(false);
          return;
        }
      }

      const res = await fetch("/api/bilag/bank-postings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setUploadError(body.error ?? "Upload fejlede.");
        setUploading(false);
        return;
      }
      const body = await res.json();
      setUploadMessage(
        `${body.created} nye posteringer tilføjet` +
          (body.skipped > 0 ? ` (${body.skipped} var allerede uploadet før).` : "."),
      );
      await loadPending();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Kunne ikke læse filen.");
    }
    setUploading(false);
  }

  function toggleIgnore(bilagId: string) {
    setIgnoreSelection((prev) => {
      const next = new Set(prev);
      if (next.has(bilagId)) next.delete(bilagId);
      else next.add(bilagId);
      return next;
    });
  }

  async function archiveIgnored() {
    if (ignoreSelection.size === 0) return;
    setIgnoring(true);
    setIgnoreError(null);
    try {
      const responses = await Promise.all(
        [...ignoreSelection].map((bilagId) =>
          fetch(`/api/bilag/${bilagId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "ignore" }),
          }),
        ),
      );
      if (responses.some((r) => !r.ok)) {
        setIgnoreError("Nogle bilag kunne ikke arkiveres — prøv igen.");
      }
      await loadPending();
    } catch {
      setIgnoreError("Der skete en fejl under arkivering.");
    }
    setIgnoring(false);
  }

  async function downloadZip() {
    setZipping(true);
    setZipError(null);
    try {
      const listRes = await fetch("/api/bilag/bank-postings?status=CONFIRMED");
      const listBody = await listRes.json().catch(() => ({ postings: [] }));
      const bilagIds: string[] = (listBody.postings ?? [])
        .map((p: DecidedPosting) => p.matchedBilag?.id)
        .filter((id: string | undefined): id is string => !!id);
      if (bilagIds.length === 0) {
        setZipError("Ingen bekræftede bilag at pakke endnu.");
        setZipping(false);
        return;
      }
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

  const found = results?.filter((r) => r.match !== null) ?? [];
  const notFound = results?.filter((r) => r.match === null) ?? [];
  const sortedResults = [...(results ?? [])].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Bilagsafstemning</h1>
        <p className="text-slate-500 mt-1">
          Upload jeres bankposteringer løbende — Julia husker fremdriften, så du kan afstemme lidt ad
          gangen og altid fortsætte hvor du slap, uden at uploade forfra.
        </p>
      </div>

      <UploadPanel
        open={uploadOpen}
        onToggle={() => setUploadOpen((v) => !v)}
        uploading={uploading}
        error={uploadError}
        message={uploadMessage}
        dragOver={dragOver}
        onDragOver={setDragOver}
        onFile={handleFile}
        inputRef={fileInputRef}
      />

      {loadError && <p className="text-sm text-red-600">{loadError}</p>}

      {loading && <p className="text-sm text-slate-500">Henter posteringer…</p>}

      {!loading && results && results.length === 0 && (
        <section className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-500">
          <p className="text-3xl mb-2">🎉</p>
          <p>Ingen ventende posteringer lige nu — upload flere ovenfor når du har dem.</p>
        </section>
      )}

      {!loading && results && results.length > 0 && (
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
                  Afventer afgørelse ({sortedResults.length})
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Sorteret efter dato · venstre er banken, højre er bilaget Julia fandt (hvis nogen). Hver
                  afgørelse gemmes med det samme.
                </p>
              </div>
              <button
                onClick={downloadZip}
                disabled={zipping}
                className="bg-slate-900 text-white rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 whitespace-nowrap"
              >
                {zipping ? "Pakker…" : "📦 ZIP alle bekræftede"}
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
                    const busy = busyIds.has(r.id);
                    const m = r.match;
                    if (!m) {
                      return (
                        <tr key={r.id} className="border-b border-slate-100 bg-amber-50/50">
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
                            colSpan={3}
                            className="py-2 pr-3 pl-3 border-l border-slate-200 text-xs font-medium text-amber-700"
                          >
                            ❌ Mangler bilag
                          </td>
                          <td className="py-2 pr-4">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => setManualSearchFor(r)}
                                disabled={busy}
                                title="Søg i arkivet efter det rigtige bilag"
                                className="text-xs text-blue-600 hover:underline whitespace-nowrap disabled:opacity-50"
                              >
                                🔍 Find
                              </button>
                              <button
                                onClick={() => markNoBilagNeeded(r.id)}
                                disabled={busy}
                                title="Denne postering får aldrig et bilag (fx bankgebyr)"
                                className="text-xs text-slate-500 hover:underline whitespace-nowrap disabled:opacity-50"
                              >
                                Ingen
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    }
                    const isDKK = m.guessedCurrency === null || m.guessedCurrency === "DKK";
                    const amountMatches =
                      m.guessedAmount != null &&
                      isDKK &&
                      Math.abs(m.guessedAmount - Math.abs(r.amount)) <= 1;

                    return (
                      <tr key={r.id} className="border-b border-slate-100">
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
                              onClick={() => confirmRow(r.id, m.bilagId)}
                              disabled={busy}
                              title="Ja, samme udgift"
                              className="w-7 h-7 rounded-md text-sm border bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-50 disabled:opacity-50"
                            >
                              ✓
                            </button>
                            <button
                              onClick={() => rejectRow(r.id, m.bilagId)}
                              disabled={busy}
                              title="Nej, forkert match"
                              className="w-7 h-7 rounded-md text-sm border bg-white text-red-700 border-red-300 hover:bg-red-50 disabled:opacity-50"
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
                    onClick={() => setIgnoreSelection(new Set(unmatchedBilag.map((b) => b.bilagId)))}
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
                Disse ligger i arkivet med en dato tæt på de ventende posteringer, men matcher ingen af
                dem — fejlsendte kvitteringer, dubletter eller lignende. De markerede arkiveres som
                &quot;Ignoreret&quot; (aldrig slettet — kan altid findes igen).
              </p>
              <div className="flex flex-col gap-2 mb-4">
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
                          {b.guessedCurrency && b.guessedCurrency !== "DKK" ? ` ${b.guessedCurrency}` : ""}
                        </span>
                      )}
                    </div>
                  </label>
                ))}
              </div>
              {ignoreError && <p className="text-sm text-red-600 mb-3">{ignoreError}</p>}
              <button
                onClick={archiveIgnored}
                disabled={ignoring || ignoreSelection.size === 0}
                className="bg-slate-900 text-white rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {ignoring ? "Arkiverer…" : `Arkiver ${ignoreSelection.size} som Ignoreret`}
              </button>
            </section>
          )}
        </>
      )}

      <section className="bg-white border border-slate-200 rounded-lg">
        <button
          onClick={toggleDecided}
          className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-slate-900"
        >
          <span>✅ Nyligt afgjorte posteringer</span>
          <span className="text-slate-400">{decidedOpen ? "▲" : "▼"}</span>
        </button>
        {decidedOpen && (
          <div className="px-5 pb-5 border-t border-slate-100 pt-4">
            {decidedLoading ? (
              <p className="text-sm text-slate-500">Henter…</p>
            ) : decided && decided.length === 0 ? (
              <p className="text-sm text-slate-500">Ingen afgjorte posteringer endnu.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {decided?.map((d) => (
                  <div
                    key={d.id}
                    className="flex flex-wrap items-center justify-between gap-2 border border-slate-200 rounded-md p-3 text-sm"
                  >
                    <div>
                      <span className="text-slate-500">{formatDate(d.date)}</span>{" "}
                      <span className="font-medium text-slate-900">{d.text}</span>{" "}
                      <span className="text-slate-500">{formatDKK(d.amount)}</span>
                      {d.status === "CONFIRMED" && d.matchedBilag && (
                        <span className="text-emerald-700">
                          {" "}
                          → {d.matchedBilag.guessedVendor ?? d.matchedBilag.subject}
                        </span>
                      )}
                      {d.status === "NO_BILAG_NEEDED" && (
                        <span className="text-slate-500"> → intet bilag nødvendigt</span>
                      )}
                    </div>
                    <button
                      onClick={() => undoDecided(d.id)}
                      className="text-xs text-slate-500 hover:underline whitespace-nowrap"
                    >
                      ↩ Fortryd
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {manualSearchFor && (
        <ManualMatchModal
          row={manualSearchFor}
          onClose={() => setManualSearchFor(null)}
          onSelect={(bilagId) => confirmRow(manualSearchFor.id, bilagId)}
        />
      )}
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

function UploadPanel({
  open,
  onToggle,
  uploading,
  error,
  message,
  dragOver,
  onDragOver,
  onFile,
  inputRef,
}: {
  open: boolean;
  onToggle: () => void;
  uploading: boolean;
  error: string | null;
  message: string | null;
  dragOver: boolean;
  onDragOver: (v: boolean) => void;
  onFile: (file: File) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-slate-900"
      >
        <span>📄 Upload bankposteringer</span>
        <span className="text-slate-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-5 pb-5 border-t border-slate-100 pt-4">
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
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              dragOver ? "border-slate-900 bg-slate-50" : "border-slate-300 bg-white hover:bg-slate-50"
            }`}
          >
            <p className="text-3xl mb-2">📄</p>
            <p className="text-slate-900 font-medium">Træk en fil hertil, eller klik for at vælge</p>
            <p className="text-sm text-slate-500 mt-1">
              Bankens CSV/Excel-udtræk over posteringer, eller en kontoudskrift fra e-conomic — kan
              uploades løbende, allerede kendte posteringer springes automatisk over.
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
            {uploading && <p className="text-sm text-slate-500 mt-4">Gennemgår filen…</p>}
            {message && !uploading && <p className="text-sm text-emerald-700 mt-4">{message}</p>}
            {error && (
              <p className="text-sm text-red-600 mt-4 max-w-md mx-auto" onClick={(e) => e.stopPropagation()}>
                {error}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function ManualMatchModal({
  row,
  onClose,
  onSelect,
}: {
  row: MatchedRow;
  onClose: () => void;
  onSelect: (bilagId: string) => void;
}) {
  // The auto-matcher already covers close date+amount matches within a
  // tight window around the posting's own date — so a manual search using
  // the same two signals over roughly the same window rarely turns up
  // anything it didn't. What it can't do is search by vendor name, or reach
  // outside its own narrow date bounds, so that's what manual search
  // defaults to: the bank's own posting text as a free-text query, no
  // amount filter (a misread OCR amount would just filter out the real
  // match), and a date range wide enough to actually be a different window.
  const [query, setQuery] = useState(row.text);
  const [dateFrom, setDateFrom] = useState(addDays(row.date, -45));
  const [dateTo, setDateTo] = useState(addDays(row.date, 45));
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Bilag[] | null>(null);

  async function search() {
    setError(null);
    setLoading(true);
    setResults(null);
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (amount) params.set("amount", amount);
      const res = await fetch(`/api/bilag/search?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Søgningen fejlede.");
        setLoading(false);
        return;
      }
      setResults(await res.json());
    } catch {
      setError("Der skete en fejl under søgningen.");
    }
    setLoading(false);
  }

  useEffect(() => {
    search();
    // Only search once on open with the prefilled values — further searches
    // happen when the user explicitly clicks "Søg" again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg p-5 max-w-2xl w-full max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Find bilag manuelt</h3>
            <p className="text-sm text-slate-500 mt-0.5">
              Til posteringen &quot;{row.text}&quot;, {formatDate(row.date)},{" "}
              {formatDKK(row.amount)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-lg leading-none"
            title="Luk"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-3 mb-4">
          <label className="flex flex-col gap-1 text-xs flex-1 min-w-[200px]">
            <span className="text-slate-500">Firmanavn / tekst</span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="fx firmanavn eller del af posteringsteksten"
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-slate-500">Fra dato</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-slate-500">Til dato</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-slate-500">Beløb (DKK)</span>
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="valgfri"
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm w-28 text-slate-900"
            />
          </label>
          <button
            onClick={search}
            disabled={loading}
            className="bg-slate-900 text-white rounded-md px-4 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {loading ? "Søger…" : "Søg"}
          </button>
        </div>

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        {results && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-slate-500">{results.length} bilag fundet.</p>
            {results.length === 0 ? (
              <p className="text-sm text-slate-500">
                Ingen bilag matcher søgningen. Prøv en bredere dato- eller beløbsramme.
              </p>
            ) : (
              results.map((b) => (
                <div
                  key={b.id}
                  className="flex flex-wrap items-center justify-between gap-2 border border-slate-200 rounded-md p-3 text-sm"
                >
                  <div>
                    <span className="font-medium text-slate-900">{b.guessedVendor ?? b.subject}</span>
                    <span className="text-slate-500">
                      {" "}
                      · modtaget {formatDate(b.receivedAt)}
                      {b.guessedInvoiceDate && ` · faktura ${formatDate(b.guessedInvoiceDate)}`}
                      {b.guessedAmount != null &&
                        ` · ${formatDKK(b.guessedAmount)}${
                          b.guessedCurrency && b.guessedCurrency !== "DKK" ? ` ${b.guessedCurrency}` : ""
                        }`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {b.attachments.map((a) => (
                      <a
                        key={a.id}
                        href={`/api/bilag/attachments/${a.id}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-blue-600 hover:underline text-xs"
                      >
                        📎 {a.filename}
                      </a>
                    ))}
                    <button
                      onClick={() => onSelect(b.id)}
                      className="bg-slate-900 text-white rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap"
                    >
                      Vælg
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

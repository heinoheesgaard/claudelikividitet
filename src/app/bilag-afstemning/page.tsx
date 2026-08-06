"use client";

import { useState } from "react";
import { formatDKK, formatDate } from "@/lib/format";

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

export default function BilagAfstemningPage() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<MatchResult[] | null>(null);

  async function handleFile(file: File) {
    setParseError(null);
    setResults(null);
    setFileName(file.name);
    setLoading(true);
    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });

      const headerIdx = raw.findIndex(
        (r) => Array.isArray(r) && r.some((c) => String(c).trim() === "Bilag"),
      );
      if (headerIdx === -1) {
        setParseError(
          "Kunne ikke finde en kolonne der hedder 'Bilag' i filen. Er det en e-conomic kontoudskrift?",
        );
        setLoading(false);
        return;
      }
      const header = raw[headerIdx].map((c) => String(c).trim());
      const bilagCol = header.indexOf("Bilag");
      const dateCol = header.indexOf("Dato");
      const textCol = header.indexOf("Tekst");
      const amountCol = header.indexOf("Beløb (DKK)");

      const rows: ParsedRow[] = [];
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

      if (rows.length === 0) {
        setParseError("Fandt ingen rækker med et bilagsnummer i filen.");
        setLoading(false);
        return;
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
      setResults(body.results);
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

  const notFound = results?.filter((r) => r.matches.length === 0) ?? [];
  const found = results?.filter((r) => r.matches.length > 0) ?? [];
  const bestMatchBilagIds = [...new Set(found.map((r) => r.matches[0].bilagId))];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Bilagsafstemning</h1>
        <p className="text-slate-500 mt-1">
          Upload en kontoudskrift fra e-conomic (posteringer på bilagskontoen, f.eks. konto 9900),
          og Julia tjekker automatisk hvilke af dem der allerede ligger i Bilag-indbakken — så du
          slipper for at lede manuelt.
        </p>
      </div>

      <section className="bg-white border border-slate-200 rounded-lg p-6">
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
          className="text-sm"
        />
        {fileName && <p className="text-sm text-slate-500 mt-2">Valgt fil: {fileName}</p>}
        {loading && <p className="text-sm text-slate-500 mt-2">Afstemmer…</p>}
        {parseError && <p className="text-sm text-red-600 mt-2">{parseError}</p>}
      </section>

      {results && (
        <>
          <section className="bg-amber-400 border-2 border-amber-600 rounded-lg p-6">
            <h2 className="text-lg font-bold text-black mb-1">
              ❌ Ikke fundet i Bilag-indbakken ({notFound.length})
            </h2>
            <p className="text-sm text-black mb-4">
              Disse mangler sandsynligvis stadig — bed om kvittering igen, eller tjek om de er
              sendt til en anden adresse.
            </p>
            {notFound.length === 0 ? (
              <p className="text-sm text-black">Alle rækker blev matchet. 🎉</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-black border-b-2 border-amber-700">
                      <th className="py-2 pr-4">Bilag #</th>
                      <th className="py-2 pr-4">Dato</th>
                      <th className="py-2 pr-4">Tekst</th>
                      <th className="py-2 pr-4">Beløb</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notFound.map((r) => (
                      <tr key={r.bilagNumber} className="border-b border-amber-500 text-black">
                        <td className="py-2 pr-4 font-mono">{r.bilagNumber}</td>
                        <td className="py-2 pr-4">{formatDate(r.date)}</td>
                        <td className="py-2 pr-4">{r.text}</td>
                        <td className="py-2 pr-4">{formatDKK(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="bg-white border border-slate-200 rounded-lg p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="text-lg font-semibold text-slate-900">
                ✅ Fundet i Bilag-indbakken ({found.length})
              </h2>
              <button
                onClick={() => downloadZip(bestMatchBilagIds)}
                disabled={zipping || bestMatchBilagIds.length === 0}
                className="bg-slate-900 text-white rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              >
                {zipping ? "Pakker…" : `Download alle som ZIP (${bestMatchBilagIds.length})`}
              </button>
            </div>
            {zipError && <p className="text-sm text-red-600 mb-3">{zipError}</p>}
            <p className="text-xs text-slate-500 mb-4">
              ZIP'en indeholder de mest sandsynlige match (øverste forslag pr. række) — tjek gerne
              efter inden du sender videre til revisor.
            </p>
            <div className="flex flex-col gap-4">
              {found.map((r) => (
                <div key={r.bilagNumber} className="border border-slate-200 rounded-md p-4">
                  <div className="flex justify-between text-sm">
                    <span className="font-mono text-slate-500">Bilag #{r.bilagNumber}</span>
                    <span className="text-slate-500">{formatDate(r.date)}</span>
                  </div>
                  <p className="text-slate-900 font-medium mt-1">
                    {r.text} — {formatDKK(r.amount)}
                  </p>
                  {r.matches[0] && (
                    <div className="mt-2 text-sm text-slate-600">
                      <span className="font-medium">{r.matches[0].subject}</span> fra{" "}
                      {r.matches[0].senderEmail}
                      {r.matches[0].guessedInvoiceDate
                        ? ` (faktura ${formatDate(r.matches[0].guessedInvoiceDate)}, modtaget ${formatDate(r.matches[0].receivedAt)})`
                        : ` (modtaget ${formatDate(r.matches[0].receivedAt)})`}
                      {r.matches[0].guessedAmount != null && (
                        <span
                          className={
                            Math.abs(r.matches[0].guessedAmount - Math.abs(r.amount)) <= 1
                              ? " text-emerald-700 font-medium"
                              : " text-slate-500"
                          }
                        >
                          {" "}
                          · gættet beløb {formatDKK(r.matches[0].guessedAmount)}
                          {Math.abs(r.matches[0].guessedAmount - Math.abs(r.amount)) <= 1 &&
                            " ✓ matcher"}
                        </span>
                      )}
                      {r.matches[0].attachments.length > 0 ? (
                        <span className="ml-2 inline-flex flex-wrap gap-2">
                          {r.matches[0].attachments.map((a) => (
                            <a
                              key={a.id}
                              href={`/api/bilag/attachments/${a.id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              📎 {a.filename}
                            </a>
                          ))}
                        </span>
                      ) : (
                        <span className="ml-2 text-amber-700">(ingen vedhæftet fil)</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

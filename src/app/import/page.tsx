"use client";

import { useMemo, useState } from "react";
import Papa from "papaparse";
import useSWR from "swr";
import { fetcher } from "@/lib/format";
import { parseAmount } from "@/lib/parse-amount";
import type { BusinessArea } from "@/lib/types";

type TypeMode = "column" | "sign-positive-income" | "sign-positive-expense" | "fixed-income" | "fixed-expense";

const NONE = "__none__";

export default function ImportPage() {
  const { data: businessAreas } = useSWR<BusinessArea[]>("/api/business-areas", fetcher);

  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);

  const [dateCol, setDateCol] = useState(NONE);
  const [amountCol, setAmountCol] = useState(NONE);
  const [descriptionCol, setDescriptionCol] = useState(NONE);
  const [categoryCol, setCategoryCol] = useState(NONE);
  const [businessAreaCol, setBusinessAreaCol] = useState(NONE);
  const [typeCol, setTypeCol] = useState(NONE);

  const [typeMode, setTypeMode] = useState<TypeMode>("sign-positive-income");
  const [fallbackBusinessAreaId, setFallbackBusinessAreaId] = useState("");
  const [fallbackCategoryName, setFallbackCategoryName] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ imported: number } | { error: string } | null>(null);

  function handleFile(file: File) {
    setParseError(null);
    setResult(null);
    setFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const fields = results.meta.fields ?? [];
        if (fields.length === 0) {
          setParseError("Filen ser ikke ud til at indeholde kolonner med overskrifter.");
          return;
        }
        setHeaders(fields);
        setRows(results.data);
        setDateCol(guessColumn(fields, ["dato", "date"]) ?? NONE);
        setAmountCol(guessColumn(fields, ["beløb", "belob", "amount", "sum"]) ?? NONE);
        setDescriptionCol(
          guessColumn(fields, ["beskrivelse", "tekst", "description", "note", "memo"]) ?? NONE,
        );
        setCategoryCol(guessColumn(fields, ["kategori", "category"]) ?? NONE);
        setBusinessAreaCol(
          guessColumn(fields, ["forretningsområde", "afdeling", "område", "business area"]) ??
            NONE,
        );
        setTypeCol(guessColumn(fields, ["type"]) ?? NONE);
      },
      error: (err) => setParseError(err.message),
    });
  }

  const fallbackBusinessAreaName = businessAreas?.find(
    (b) => b.id === fallbackBusinessAreaId,
  )?.name;

  const previewRows = useMemo(() => {
    return rows.slice(0, 8).map((row) => transformRow(row));

    function transformRow(row: Record<string, string>) {
      return buildTransaction(row, {
        dateCol,
        amountCol,
        descriptionCol,
        categoryCol,
        businessAreaCol,
        typeCol,
        typeMode,
        fallbackBusinessAreaName,
        fallbackCategoryName,
      });
    }
  }, [
    rows,
    dateCol,
    amountCol,
    descriptionCol,
    categoryCol,
    businessAreaCol,
    typeCol,
    typeMode,
    fallbackBusinessAreaName,
    fallbackCategoryName,
  ]);

  const canImport = dateCol !== NONE && amountCol !== NONE && rows.length > 0;

  async function submitImport() {
    setSubmitting(true);
    setResult(null);

    const transformed = rows
      .map((row) =>
        buildTransaction(row, {
          dateCol,
          amountCol,
          descriptionCol,
          categoryCol,
          businessAreaCol,
          typeCol,
          typeMode,
          fallbackBusinessAreaName,
          fallbackCategoryName,
        }),
      )
      .filter((r): r is NonNullable<typeof r> => r !== null && r.valid);

    const res = await fetch("/api/transactions/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows: transformed.map((row) => ({
          date: row.date,
          amount: row.amount,
          type: row.type,
          description: row.description,
          categoryName: row.categoryName,
          businessAreaName: row.businessAreaName,
        })),
      }),
    });

    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setResult({ error: body.error ?? "Import fejlede." });
      return;
    }
    const body = await res.json();
    setResult({ imported: body.imported });
    setRows([]);
    setHeaders([]);
    setFileName(null);
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Importér transaktioner</h1>
        <p className="text-slate-500 mt-1">
          Upload en CSV-eksport fra din bank eller dit bogføringssystem, og map kolonnerne til
          dato, beløb m.m.
        </p>
      </div>

      <section className="bg-white border border-slate-200 rounded-lg p-6">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
          className="text-sm"
        />
        {fileName && <p className="text-sm text-slate-500 mt-2">Valgt fil: {fileName}</p>}
        {parseError && <p className="text-sm text-red-600 mt-2">{parseError}</p>}
      </section>

      {headers.length > 0 && (
        <>
          <section className="bg-white border border-slate-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Kolonne-mapning</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <ColumnSelect label="Dato *" value={dateCol} onChange={setDateCol} headers={headers} />
              <ColumnSelect
                label="Beløb *"
                value={amountCol}
                onChange={setAmountCol}
                headers={headers}
              />
              <ColumnSelect
                label="Beskrivelse"
                value={descriptionCol}
                onChange={setDescriptionCol}
                headers={headers}
              />
              <ColumnSelect
                label="Kategori"
                value={categoryCol}
                onChange={setCategoryCol}
                headers={headers}
              />
              <ColumnSelect
                label="Forretningsområde"
                value={businessAreaCol}
                onChange={setBusinessAreaCol}
                headers={headers}
              />
              <ColumnSelect label="Type" value={typeCol} onChange={setTypeCol} headers={headers} />
            </div>

            {typeCol === NONE && (
              <div className="mt-4">
                <label className="flex flex-col gap-1 text-sm max-w-sm">
                  <span className="text-slate-600">
                    Ingen type-kolonne valgt — hvordan bestemmes indtægt/udgift?
                  </span>
                  <select
                    value={typeMode}
                    onChange={(e) => setTypeMode(e.target.value as TypeMode)}
                    className="border border-slate-300 rounded-md px-3 py-2"
                  >
                    <option value="sign-positive-income">
                      Fortegn: positivt beløb = indtægt, negativt = udgift
                    </option>
                    <option value="sign-positive-expense">
                      Fortegn: positivt beløb = udgift, negativt = indtægt
                    </option>
                    <option value="fixed-expense">Alle rækker er udgifter</option>
                    <option value="fixed-income">Alle rækker er indtægter</option>
                  </select>
                </label>
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-4 mt-4">
              {businessAreaCol === NONE && (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-slate-600">
                    Fast forretningsområde for alle rækker (valgfri)
                  </span>
                  <select
                    value={fallbackBusinessAreaId}
                    onChange={(e) => setFallbackBusinessAreaId(e.target.value)}
                    className="border border-slate-300 rounded-md px-3 py-2"
                  >
                    <option value="">Ingen</option>
                    {businessAreas?.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {categoryCol === NONE && (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-slate-600">Fast kategorinavn for alle rækker (valgfri)</span>
                  <input
                    value={fallbackCategoryName}
                    onChange={(e) => setFallbackCategoryName(e.target.value)}
                    placeholder="f.eks. Bankimport"
                    className="border border-slate-300 rounded-md px-3 py-2"
                  />
                </label>
              )}
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-1">
              Forhåndsvisning ({rows.length} rækker i alt)
            </h2>
            <p className="text-sm text-slate-500 mb-4">Første 8 rækker efter mapning.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-2 pr-4">Dato</th>
                    <th className="py-2 pr-4">Beløb</th>
                    <th className="py-2 pr-4">Type</th>
                    <th className="py-2 pr-4">Kategori</th>
                    <th className="py-2 pr-4">Forretningsområde</th>
                    <th className="py-2 pr-4">Beskrivelse</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      {row && row.valid ? (
                        <>
                          <td className="py-2 pr-4">{row.date}</td>
                          <td className="py-2 pr-4">{row.amount}</td>
                          <td className="py-2 pr-4">
                            {row.type === "INCOME" ? "Indtægt" : "Udgift"}
                          </td>
                          <td className="py-2 pr-4">{row.categoryName ?? "—"}</td>
                          <td className="py-2 pr-4">{row.businessAreaName ?? "—"}</td>
                          <td className="py-2 pr-4 text-slate-500">{row.description ?? "—"}</td>
                        </>
                      ) : (
                        <td colSpan={6} className="py-2 pr-4 text-red-600">
                          Kunne ikke fortolke denne række (tjek dato/beløb-mapning).
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              onClick={submitImport}
              disabled={!canImport || submitting}
              className="mt-6 bg-slate-900 text-white rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {submitting ? "Importerer…" : `Importér ${rows.length} rækker`}
            </button>
          </section>
        </>
      )}

      {result && "imported" in result && (
        <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-4 py-3">
          {result.imported} transaktioner blev importeret.
        </p>
      )}
      {result && "error" in result && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-4 py-3">
          {result.error}
        </p>
      )}
    </div>
  );
}

function ColumnSelect({
  label,
  value,
  onChange,
  headers,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  headers: string[];
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-slate-600">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border border-slate-300 rounded-md px-3 py-2"
      >
        <option value={NONE}>(ingen kolonne)</option>
        {headers.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
    </label>
  );
}

function guessColumn(fields: string[], keywords: string[]): string | null {
  const lower = fields.map((f) => f.toLowerCase());
  for (const keyword of keywords) {
    const idx = lower.findIndex((f) => f.includes(keyword));
    if (idx !== -1) return fields[idx];
  }
  return null;
}

function normalizeTypeValue(raw: string): "INCOME" | "EXPENSE" | null {
  const v = raw.trim().toLowerCase();
  if (["indtægt", "indtaegt", "income", "indbetaling", "kredit"].some((k) => v.includes(k))) {
    return "INCOME";
  }
  if (["udgift", "expense", "udbetaling", "debet"].some((k) => v.includes(k))) {
    return "EXPENSE";
  }
  return null;
}

type BuildOptions = {
  dateCol: string;
  amountCol: string;
  descriptionCol: string;
  categoryCol: string;
  businessAreaCol: string;
  typeCol: string;
  typeMode: TypeMode;
  fallbackBusinessAreaName?: string;
  fallbackCategoryName?: string;
};

function buildTransaction(row: Record<string, string>, opts: BuildOptions) {
  if (opts.dateCol === NONE || opts.amountCol === NONE) return null;

  const rawDate = row[opts.dateCol];
  const rawAmount = row[opts.amountCol];
  const parsedAmount = parseAmount(rawAmount ?? "");
  const parsedDate = rawDate ? new Date(rawDate) : null;

  if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedAmount === null) {
    return { valid: false as const };
  }

  let type: "INCOME" | "EXPENSE";
  let amount = parsedAmount;

  if (opts.typeCol !== NONE) {
    const fromColumn = normalizeTypeValue(row[opts.typeCol] ?? "");
    type = fromColumn ?? (parsedAmount >= 0 ? "INCOME" : "EXPENSE");
    amount = Math.abs(parsedAmount);
  } else if (opts.typeMode === "fixed-income") {
    type = "INCOME";
    amount = Math.abs(parsedAmount);
  } else if (opts.typeMode === "fixed-expense") {
    type = "EXPENSE";
    amount = Math.abs(parsedAmount);
  } else if (opts.typeMode === "sign-positive-expense") {
    type = parsedAmount >= 0 ? "EXPENSE" : "INCOME";
    amount = Math.abs(parsedAmount);
  } else {
    type = parsedAmount >= 0 ? "INCOME" : "EXPENSE";
    amount = Math.abs(parsedAmount);
  }

  if (amount <= 0) return { valid: false as const };

  const description =
    opts.descriptionCol !== NONE ? row[opts.descriptionCol]?.trim() || undefined : undefined;
  const categoryName =
    opts.categoryCol !== NONE
      ? row[opts.categoryCol]?.trim() || undefined
      : opts.fallbackCategoryName || undefined;
  const businessAreaName =
    opts.businessAreaCol !== NONE
      ? row[opts.businessAreaCol]?.trim() || undefined
      : opts.fallbackBusinessAreaName || undefined;

  return {
    valid: true as const,
    date: parsedDate.toISOString().slice(0, 10),
    amount,
    type,
    description,
    categoryName,
    businessAreaName,
  };
}

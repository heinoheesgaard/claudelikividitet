"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { fetcher, formatDKK } from "@/lib/format";
import type { BusinessArea } from "@/lib/types";

type ResultatLine = { name: string; total: number };

type Resultatopgorelse = {
  scope: { businessAreaId: string | null; businessAreaName: string | null };
  incomeByCategory: ResultatLine[];
  expenseByCategory: ResultatLine[];
  totalIncome: number;
  totalExpense: number;
  profit: number;
  transactionCount: number;
};

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function monthsAgo(n: number, d: Date) {
  return new Date(d.getFullYear(), d.getMonth() - n, 1).toISOString().slice(0, 10);
}
function startOfYear(d: Date) {
  return new Date(d.getFullYear(), 0, 1).toISOString().slice(0, 10);
}
function today(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function ResultatopgorelsePage() {
  const now = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(startOfYear(now));
  const [to, setTo] = useState(today(now));
  const [businessAreaId, setBusinessAreaId] = useState("");

  const { data: businessAreas } = useSWR<BusinessArea[]>("/api/business-areas", fetcher);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (businessAreaId) params.set("businessAreaId", businessAreaId);
    return params.toString();
  }, [from, to, businessAreaId]);

  const { data, isLoading } = useSWR<Resultatopgorelse>(
    `/api/resultatopgorelse?${query}`,
    fetcher,
  );

  function applyPreset(preset: "month" | "quarter" | "year" | "all") {
    if (preset === "month") {
      setFrom(startOfMonth(now));
      setTo(today(now));
    } else if (preset === "quarter") {
      setFrom(monthsAgo(3, now));
      setTo(today(now));
    } else if (preset === "year") {
      setFrom(startOfYear(now));
      setTo(today(now));
    } else {
      setFrom("");
      setTo("");
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Resultatopgørelse</h1>
        <p className="text-slate-500 mt-1">
          Indtægter og udgifter pr. kategori — for hele virksomheden eller ét forretningsområde
          ad gangen.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-slate-600">Forretningsområde:</label>
          <select
            value={businessAreaId}
            onChange={(e) => setBusinessAreaId(e.target.value)}
            className="border border-slate-300 rounded-md px-3 py-1.5 text-sm"
          >
            <option value="">Hele virksomheden</option>
            {businessAreas?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <PresetButton onClick={() => applyPreset("month")}>Denne måned</PresetButton>
          <PresetButton onClick={() => applyPreset("quarter")}>Sidste 3 måneder</PresetButton>
          <PresetButton onClick={() => applyPreset("year")}>I år</PresetButton>
          <PresetButton onClick={() => applyPreset("all")}>Alle</PresetButton>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
          />
          <span className="text-slate-400 text-sm">til</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
          />
        </div>
      </div>

      {isLoading && <p className="text-sm text-slate-500">Indlæser…</p>}

      {data && (
        <section className="bg-white border border-slate-200 rounded-lg p-6 max-w-2xl">
          <h2 className="text-lg font-semibold text-slate-900 mb-6">
            {data.scope.businessAreaName ?? "Hele virksomheden"}
          </h2>

          <ResultatBlock
            title="Indtægter"
            lines={data.incomeByCategory}
            total={data.totalIncome}
            tone="positive"
          />

          <ResultatBlock
            title="Udgifter"
            lines={data.expenseByCategory}
            total={data.totalExpense}
            tone="negative"
          />

          <div className="flex items-center justify-between pt-4 mt-2 border-t-2 border-slate-900">
            <span className="text-base font-semibold text-slate-900">Resultat</span>
            <span
              className={`text-lg font-bold ${
                data.profit >= 0 ? "text-emerald-700" : "text-red-700"
              }`}
            >
              {formatDKK(data.profit)}
            </span>
          </div>

          {data.transactionCount === 0 && (
            <p className="text-sm text-slate-500 mt-4">Ingen transaktioner i perioden.</p>
          )}
        </section>
      )}
    </div>
  );
}

function ResultatBlock({
  title,
  lines,
  total,
  tone,
}: {
  title: string;
  lines: ResultatLine[];
  total: number;
  tone: "positive" | "negative";
}) {
  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
        {title}
      </h3>
      {lines.length === 0 ? (
        <p className="text-sm text-slate-400 pb-2">Ingen {title.toLowerCase()} i perioden.</p>
      ) : (
        <ul>
          {lines.map((line) => (
            <li
              key={line.name}
              className="flex items-center justify-between py-1.5 border-b border-slate-100 text-sm"
            >
              <span className="text-slate-700">{line.name}</span>
              <span className="text-slate-900">{formatDKK(line.total)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between pt-2 mt-1 border-t border-slate-300">
        <span className="text-sm font-semibold text-slate-900">I alt {title.toLowerCase()}</span>
        <span
          className={`text-sm font-semibold ${
            tone === "positive" ? "text-emerald-700" : "text-red-700"
          }`}
        >
          {formatDKK(total)}
        </span>
      </div>
    </div>
  );
}

function PresetButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="text-sm px-3 py-1.5 rounded-md border border-slate-300 text-slate-600 hover:bg-slate-100"
    >
      {children}
    </button>
  );
}

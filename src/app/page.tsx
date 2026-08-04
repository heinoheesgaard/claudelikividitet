"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetcher, formatDKK } from "@/lib/format";
import type { Summary } from "@/lib/types";

const PALETTE = [
  "#0f172a",
  "#2563eb",
  "#0d9488",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#059669",
  "#db2777",
  "#4b5563",
  "#ca8a04",
];

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

export default function DashboardPage() {
  const now = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(startOfMonth(now));
  const [to, setTo] = useState(today(now));

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return params.toString();
  }, [from, to]);

  const { data, isLoading } = useSWR<Summary>(`/api/summary?${query}`, fetcher);

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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
          <p className="text-slate-500 mt-1">
            Se hvor pengene bruges, og hvilke dele af virksomheden der tjener mest.
          </p>
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
        <>
          <div className="grid sm:grid-cols-3 gap-4">
            <TotalCard label="Indtægter" value={data.totals.income} tone="positive" />
            <TotalCard label="Udgifter" value={data.totals.expense} tone="negative" />
            <TotalCard
              label="Resultat"
              value={data.totals.profit}
              tone={data.totals.profit >= 0 ? "positive" : "negative"}
            />
          </div>

          <section className="bg-white border border-slate-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-1">Udgifter pr. kategori</h2>
            <p className="text-sm text-slate-500 mb-4">
              Hvor forsvinder pengene hen? Sorteret efter størrelse.
            </p>
            {data.expensesByCategory.length === 0 ? (
              <p className="text-sm text-slate-500">Ingen udgifter i perioden.</p>
            ) : (
              <div className="grid lg:grid-cols-2 gap-6 items-center">
                <div style={{ height: Math.max(180, data.expensesByCategory.length * 40) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.expensesByCategory}
                      layout="vertical"
                      margin={{ left: 8, right: 24 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                      <XAxis
                        type="number"
                        tickFormatter={(v) => formatDKK(Number(v))}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={130}
                        tick={{ fontSize: 12 }}
                      />
                      <Tooltip formatter={(v) => formatDKK(Number(v))} />
                      <Bar dataKey="total" radius={[0, 4, 4, 0]}>
                        {data.expensesByCategory.map((entry, i) => (
                          <Cell key={entry.name} fill={PALETTE[i % PALETTE.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-200">
                      <th className="py-2">Kategori</th>
                      <th className="py-2 text-right">Beløb</th>
                      <th className="py-2 text-right">Andel</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.expensesByCategory.map((cat, i) => (
                      <tr key={cat.name} className="border-b border-slate-100">
                        <td className="py-2 flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full inline-block"
                            style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
                          />
                          {cat.name}
                        </td>
                        <td className="py-2 text-right font-medium">{formatDKK(cat.total)}</td>
                        <td className="py-2 text-right text-slate-500">
                          {data.totals.expense > 0
                            ? `${Math.round((cat.total / data.totals.expense) * 100)}%`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="bg-white border border-slate-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-1">
              Indtjening pr. forretningsområde
            </h2>
            <p className="text-sm text-slate-500 mb-4">
              Hvilke dele af virksomheden er mest indtjenende? Sorteret efter resultat.
            </p>
            {data.businessAreas.length === 0 ? (
              <p className="text-sm text-slate-500">Ingen transaktioner i perioden.</p>
            ) : (
              <>
                <div className="h-72 mb-6">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.businessAreas} margin={{ left: 8, right: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis tickFormatter={(v) => formatDKK(v)} width={90} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v) => formatDKK(Number(v))} />
                      <Legend />
                      <Bar dataKey="income" name="Indtægt" fill="#0d9488" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="expense" name="Udgift" fill="#dc2626" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-200">
                      <th className="py-2">Forretningsområde</th>
                      <th className="py-2 text-right">Indtægt</th>
                      <th className="py-2 text-right">Udgift</th>
                      <th className="py-2 text-right">Resultat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.businessAreas.map((area) => (
                      <tr key={area.name} className="border-b border-slate-100">
                        <td className="py-2 font-medium text-slate-900">{area.name}</td>
                        <td className="py-2 text-right text-emerald-700">
                          {formatDKK(area.income)}
                        </td>
                        <td className="py-2 text-right text-red-700">{formatDKK(area.expense)}</td>
                        <td
                          className={`py-2 text-right font-semibold ${
                            area.profit >= 0 ? "text-emerald-700" : "text-red-700"
                          }`}
                        >
                          {formatDKK(area.profit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>
        </>
      )}
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

function TotalCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "positive" | "negative";
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-6">
      <p className="text-sm text-slate-500">{label}</p>
      <p
        className={`text-2xl font-semibold mt-1 ${
          tone === "positive" ? "text-emerald-700" : "text-red-700"
        }`}
      >
        {formatDKK(value)}
      </p>
    </div>
  );
}

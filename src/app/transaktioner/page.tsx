"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { fetcher, formatDKK, formatDate } from "@/lib/format";
import type { BusinessArea, Category, Transaction, TransactionType } from "@/lib/types";

const emptyForm = {
  id: null as string | null,
  date: new Date().toISOString().slice(0, 10),
  amount: "",
  type: "EXPENSE" as TransactionType,
  description: "",
  categoryId: "",
  businessAreaId: "",
};

export default function TransactionsPage() {
  const { data: categories } = useSWR<Category[]>("/api/categories", fetcher);
  const { data: businessAreas } = useSWR<BusinessArea[]>("/api/business-areas", fetcher);

  const [filterType, setFilterType] = useState<"ALL" | TransactionType>("ALL");
  const [filterBusinessArea, setFilterBusinessArea] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (filterType !== "ALL") params.set("type", filterType);
    if (filterBusinessArea) params.set("businessAreaId", filterBusinessArea);
    return params.toString();
  }, [filterType, filterBusinessArea]);

  const {
    data: transactions,
    mutate,
    isLoading,
  } = useSWR<Transaction[]>(`/api/transactions${query ? `?${query}` : ""}`, fetcher);

  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const categoriesForType = categories?.filter((c) => c.type === form.type) ?? [];

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!form.date || !amount || amount <= 0) {
      setError("Udfyld dato og et beløb større end 0.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const payload = {
      date: form.date,
      amount,
      type: form.type,
      description: form.description || undefined,
      categoryId: form.categoryId || null,
      businessAreaId: form.businessAreaId || null,
    };

    const res = await fetch(form.id ? `/api/transactions/${form.id}` : "/api/transactions", {
      method: form.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Kunne ikke gemme transaktionen.");
      return;
    }
    setForm(emptyForm);
    mutate();
  }

  function editTransaction(tx: Transaction) {
    setForm({
      id: tx.id,
      date: tx.date.slice(0, 10),
      amount: String(tx.amount),
      type: tx.type,
      description: tx.description ?? "",
      categoryId: tx.categoryId ?? "",
      businessAreaId: tx.businessAreaId ?? "",
    });
    setError(null);
  }

  async function deleteTransaction(id: string) {
    if (!confirm("Slet denne transaktion?")) return;
    await fetch(`/api/transactions/${id}`, { method: "DELETE" });
    mutate();
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Transaktioner</h1>
        <p className="text-slate-500 mt-1">Registrér og se dine indtægter og udgifter.</p>
      </div>

      <section className="bg-white border border-slate-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">
          {form.id ? "Redigér transaktion" : "Ny transaktion"}
        </h2>
        <form onSubmit={submitForm} className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Type</span>
            <select
              value={form.type}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  type: e.target.value as TransactionType,
                  categoryId: "",
                }))
              }
              className="border border-slate-300 rounded-md px-3 py-2"
            >
              <option value="EXPENSE">Udgift</option>
              <option value="INCOME">Indtægt</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Dato</span>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              className="border border-slate-300 rounded-md px-3 py-2"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Beløb (DKK)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              className="border border-slate-300 rounded-md px-3 py-2"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Kategori</span>
            <select
              value={form.categoryId}
              onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
              className="border border-slate-300 rounded-md px-3 py-2"
            >
              <option value="">Ingen</option>
              {categoriesForType.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Forretningsområde</span>
            <select
              value={form.businessAreaId}
              onChange={(e) => setForm((f) => ({ ...f, businessAreaId: e.target.value }))}
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

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Beskrivelse</span>
            <input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="border border-slate-300 rounded-md px-3 py-2"
              placeholder="Valgfri note"
            />
          </label>

          <div className="flex items-end gap-2 lg:col-span-3">
            <button
              type="submit"
              disabled={submitting}
              className="bg-slate-900 text-white rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {form.id ? "Gem ændringer" : "Tilføj transaktion"}
            </button>
            {form.id && (
              <button
                type="button"
                onClick={() => setForm(emptyForm)}
                className="text-sm text-slate-600 hover:text-slate-900"
              >
                Annullér
              </button>
            )}
          </div>
        </form>
        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
      </section>

      <section className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Alle transaktioner</h2>
          <div className="flex gap-2">
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as "ALL" | TransactionType)}
              className="border border-slate-300 rounded-md px-3 py-2 text-sm"
            >
              <option value="ALL">Alle typer</option>
              <option value="EXPENSE">Udgifter</option>
              <option value="INCOME">Indtægter</option>
            </select>
            <select
              value={filterBusinessArea}
              onChange={(e) => setFilterBusinessArea(e.target.value)}
              className="border border-slate-300 rounded-md px-3 py-2 text-sm"
            >
              <option value="">Alle forretningsområder</option>
              {businessAreas?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {isLoading && <p className="text-sm text-slate-500">Indlæser…</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-4">Dato</th>
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">Beløb</th>
                <th className="py-2 pr-4">Kategori</th>
                <th className="py-2 pr-4">Forretningsområde</th>
                <th className="py-2 pr-4">Beskrivelse</th>
                <th className="py-2 pr-4"></th>
              </tr>
            </thead>
            <tbody>
              {transactions?.map((tx) => (
                <tr key={tx.id} className="border-b border-slate-100">
                  <td className="py-2 pr-4 whitespace-nowrap">{formatDate(tx.date)}</td>
                  <td className="py-2 pr-4">
                    <span
                      className={
                        tx.type === "INCOME"
                          ? "text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full text-xs font-medium"
                          : "text-red-700 bg-red-50 px-2 py-0.5 rounded-full text-xs font-medium"
                      }
                    >
                      {tx.type === "INCOME" ? "Indtægt" : "Udgift"}
                    </span>
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap font-medium">
                    {formatDKK(tx.amount)}
                  </td>
                  <td className="py-2 pr-4">{tx.category?.name ?? "—"}</td>
                  <td className="py-2 pr-4">{tx.businessArea?.name ?? "—"}</td>
                  <td className="py-2 pr-4 text-slate-500">{tx.description ?? "—"}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    <button
                      onClick={() => editTransaction(tx)}
                      className="text-slate-600 hover:text-slate-900 mr-3"
                    >
                      Redigér
                    </button>
                    <button
                      onClick={() => deleteTransaction(tx.id)}
                      className="text-red-600 hover:text-red-800"
                    >
                      Slet
                    </button>
                  </td>
                </tr>
              ))}
              {transactions?.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-slate-500">
                    Ingen transaktioner endnu.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

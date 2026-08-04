"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/format";
import type { BusinessArea, Category } from "@/lib/types";

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Indstillinger</h1>
        <p className="text-slate-500 mt-1">
          Administrér kategorier og forretningsområder, som bruges til at kategorisere dine
          transaktioner.
        </p>
      </div>
      <BusinessAreasSection />
      <CategoriesSection />
    </div>
  );
}

function BusinessAreasSection() {
  const { data, mutate, isLoading } = useSWR<BusinessArea[]>("/api/business-areas", fetcher);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function addBusinessArea(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/business-areas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description: description || undefined }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Kunne ikke oprette forretningsområdet.");
      return;
    }
    setName("");
    setDescription("");
    mutate();
  }

  async function deleteBusinessArea(id: string) {
    if (!confirm("Slet dette forretningsområde? Transaktioner mister deres tilknytning.")) return;
    await fetch(`/api/business-areas/${id}`, { method: "DELETE" });
    mutate();
  }

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-6">
      <h2 className="text-lg font-semibold text-slate-900 mb-1">Forretningsområder</h2>
      <p className="text-sm text-slate-500 mb-4">
        F.eks. produktlinjer, afdelinger eller services i din virksomhed.
      </p>

      <form onSubmit={addBusinessArea} className="flex flex-wrap gap-2 mb-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Navn, f.eks. Konsulentydelser"
          className="border border-slate-300 rounded-md px-3 py-2 text-sm flex-1 min-w-[180px]"
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Beskrivelse (valgfri)"
          className="border border-slate-300 rounded-md px-3 py-2 text-sm flex-1 min-w-[180px]"
        />
        <button
          type="submit"
          disabled={submitting}
          className="bg-slate-900 text-white rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          Tilføj
        </button>
      </form>
      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {isLoading && <p className="text-sm text-slate-500">Indlæser…</p>}
      <ul className="divide-y divide-slate-100">
        {data?.map((area) => (
          <li key={area.id} className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium text-slate-900">{area.name}</p>
              {area.description && <p className="text-xs text-slate-500">{area.description}</p>}
            </div>
            <button
              onClick={() => deleteBusinessArea(area.id)}
              className="text-sm text-red-600 hover:text-red-800"
            >
              Slet
            </button>
          </li>
        ))}
        {data?.length === 0 && (
          <li className="py-2 text-sm text-slate-500">Ingen forretningsområder endnu.</li>
        )}
      </ul>
    </section>
  );
}

function CategoriesSection() {
  const { data, mutate, isLoading } = useSWR<Category[]>("/api/categories", fetcher);
  const [name, setName] = useState("");
  const [type, setType] = useState<"EXPENSE" | "INCOME">("EXPENSE");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, type }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Kunne ikke oprette kategorien.");
      return;
    }
    setName("");
    mutate();
  }

  async function deleteCategory(id: string) {
    if (!confirm("Slet denne kategori? Transaktioner mister deres tilknytning.")) return;
    await fetch(`/api/categories/${id}`, { method: "DELETE" });
    mutate();
  }

  const expenseCategories = data?.filter((c) => c.type === "EXPENSE") ?? [];
  const incomeCategories = data?.filter((c) => c.type === "INCOME") ?? [];

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-6">
      <h2 className="text-lg font-semibold text-slate-900 mb-1">Kategorier</h2>
      <p className="text-sm text-slate-500 mb-4">
        Bruges til at gruppere udgifter og indtægter, f.eks. Løn, Husleje, Salg af ydelser.
      </p>

      <form onSubmit={addCategory} className="flex flex-wrap gap-2 mb-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Navn, f.eks. Markedsføring"
          className="border border-slate-300 rounded-md px-3 py-2 text-sm flex-1 min-w-[180px]"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as "EXPENSE" | "INCOME")}
          className="border border-slate-300 rounded-md px-3 py-2 text-sm"
        >
          <option value="EXPENSE">Udgift</option>
          <option value="INCOME">Indtægt</option>
        </select>
        <button
          type="submit"
          disabled={submitting}
          className="bg-slate-900 text-white rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          Tilføj
        </button>
      </form>
      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {isLoading && <p className="text-sm text-slate-500">Indlæser…</p>}
      <div className="grid sm:grid-cols-2 gap-6">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-2">Udgiftskategorier</h3>
          <ul className="divide-y divide-slate-100">
            {expenseCategories.map((c) => (
              <CategoryRow key={c.id} category={c} onDelete={deleteCategory} />
            ))}
            {expenseCategories.length === 0 && (
              <li className="py-2 text-sm text-slate-500">Ingen endnu.</li>
            )}
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-2">Indtægtskategorier</h3>
          <ul className="divide-y divide-slate-100">
            {incomeCategories.map((c) => (
              <CategoryRow key={c.id} category={c} onDelete={deleteCategory} />
            ))}
            {incomeCategories.length === 0 && (
              <li className="py-2 text-sm text-slate-500">Ingen endnu.</li>
            )}
          </ul>
        </div>
      </div>
    </section>
  );
}

function CategoryRow({
  category,
  onDelete,
}: {
  category: Category;
  onDelete: (id: string) => void;
}) {
  return (
    <li className="flex items-center justify-between py-2">
      <span className="text-sm text-slate-900">{category.name}</span>
      <button
        onClick={() => onDelete(category.id)}
        className="text-sm text-red-600 hover:text-red-800"
      >
        Slet
      </button>
    </li>
  );
}

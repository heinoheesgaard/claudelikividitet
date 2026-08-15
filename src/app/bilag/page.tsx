"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { fetcher, formatDKK, formatDate } from "@/lib/format";
import type { Bilag, BilagStatus, BusinessArea, Category } from "@/lib/types";

const TABS: { value: BilagStatus | "ALLE"; label: string }[] = [
  { value: "MANGLER_BELOEB", label: "Mangler beløb" },
  { value: "BOGFOERT", label: "Bogført" },
  { value: "AFSTEMT", label: "Afstemt" },
  { value: "IGNORERET", label: "Ignoreret" },
  { value: "ALLE", label: "Alle" },
];

export default function BilagPage() {
  const [tab, setTab] = useState<BilagStatus | "ALLE">("MANGLER_BELOEB");
  const query = tab === "ALLE" ? "" : `?status=${tab}`;

  const { data: bilag, mutate, isLoading } = useSWR<Bilag[]>(`/api/bilag${query}`, fetcher);
  const { data: categories } = useSWR<Category[]>("/api/categories", fetcher);
  const { data: businessAreas } = useSWR<BusinessArea[]>("/api/business-areas", fetcher);

  const counts = useCounts();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Bilag</h1>
          <p className="text-slate-500 mt-1">
            Alle bilag sendt til <span className="font-mono">revisorkurt@thypisk.dk</span> — dit
            sikkerhedsnet mod bilag der forsvinder, uanset om economic kunne læse dem.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <FetchBilagButton onDone={() => mutate()} />
          <GuessBackfillButton onDone={() => mutate()} />
        </div>
      </div>

      <ArchiveSearch />

      <div className="flex gap-2 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t.value
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
            {counts && t.value !== "ALLE" && (
              <span className="ml-1.5 text-xs text-slate-400">({counts[t.value]})</span>
            )}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-sm text-slate-500">Indlæser…</p>}

      <div className="flex flex-col gap-4">
        {bilag?.map((b) => (
          <BilagRow
            key={b.id}
            bilag={b}
            categories={categories ?? []}
            businessAreas={businessAreas ?? []}
            onChanged={() => mutate()}
          />
        ))}
        {bilag?.length === 0 && (
          <p className="text-sm text-slate-500 py-8 text-center">Ingen bilag i denne visning.</p>
        )}
      </div>
    </div>
  );
}

// Finds a specific bilag regardless of status — a fresh upload/tab filter
// only shows the active queue, but a SKAT request for "a receipt from three
// years ago around this date for this amount" needs to search the whole
// archive at once, no matter whether it's since been booked, reconciled, or
// archived as ignored.
function ArchiveSearch() {
  const [open, setOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Bilag[] | null>(null);

  async function search() {
    setError(null);
    if (!dateFrom && !dateTo && !amount) {
      setError("Angiv mindst en dato eller et beløb at søge på.");
      return;
    }
    setLoading(true);
    setResults(null);
    try {
      const params = new URLSearchParams();
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

  return (
    <div className="bg-white border border-slate-200 rounded-lg">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-slate-900"
      >
        <span>🔍 Søg i hele arkivet (uanset status)</span>
        <span className="text-slate-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-5 pb-5 border-t border-slate-100 pt-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
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
                placeholder="f.eks. 1249,00"
                className="border border-slate-300 rounded-md px-2 py-1.5 text-sm w-32 text-slate-900"
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
          {error && <p className="text-sm text-red-600">{error}</p>}
          {results && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-slate-500">{results.length} bilag fundet.</p>
              {results.length === 0 ? (
                <p className="text-sm text-slate-500">Ingen bilag matcher søgningen.</p>
              ) : (
                results.map((b) => (
                  <div
                    key={b.id}
                    className="flex flex-wrap items-center justify-between gap-2 border border-slate-200 rounded-md p-3 text-sm"
                  >
                    <div>
                      <span className="font-medium text-slate-900">
                        {b.guessedVendor ?? b.subject}
                      </span>
                      <span className="text-slate-500">
                        {" "}
                        · modtaget {formatDate(b.receivedAt)}
                        {b.guessedInvoiceDate && ` · faktura ${formatDate(b.guessedInvoiceDate)}`}
                        {b.guessedAmount != null &&
                          ` · ${formatDKK(b.guessedAmount)}${
                            b.guessedCurrency && b.guessedCurrency !== "DKK"
                              ? ` ${b.guessedCurrency}`
                              : ""
                          }`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={b.status} />
                      {b.attachments.map((a) => (
                        <a
                          key={a.id}
                          href={`/api/bilag/attachments/${a.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 hover:underline text-xs"
                        >
                          📎 {a.filename}
                        </a>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FetchBilagButton({ onDone }: { onDone: () => void }) {
  const [days, setDays] = useState("14");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    setProgress("Henter…");

    let pageToken: string | undefined;
    let totalCreated = 0;
    let totalProcessed = 0;

    try {
      while (true) {
        const res = await fetch("/api/bilag/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ days: Number(days) || 14, pageToken }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? "Kunne ikke hente bilag.");
          break;
        }
        const body = await res.json();
        totalCreated += body.created;
        totalProcessed += body.processed;
        setProgress(`${totalProcessed} mails gennemgået, ${totalCreated} nye bilag fundet…`);
        onDone();

        if (!body.nextPageToken) {
          setProgress(`Færdig — ${totalProcessed} mails gennemgået, ${totalCreated} nye bilag fundet.`);
          break;
        }
        pageToken = body.nextPageToken;
      }
    } catch {
      setError("Der skete en fejl under hentning.");
    }
    setRunning(false);
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col gap-2 min-w-[260px]">
      <div className="flex items-center gap-2">
        <label className="text-xs text-slate-500 flex items-center gap-1">
          Kig
          <input
            type="number"
            min={1}
            max={400}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="border border-slate-300 rounded-md px-2 py-1 w-16 text-sm"
          />
          dage tilbage
        </label>
        <button
          onClick={run}
          disabled={running}
          className="bg-slate-900 text-white rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          {running ? "Henter…" : "Hent bilag nu"}
        </button>
      </div>
      {progress && <p className="text-xs text-slate-500">{progress}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function GuessBackfillButton({ onDone }: { onDone: () => void }) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    setProgress("Gætter…");

    let cursor: string | undefined;
    let totalUpdated = 0;
    let totalProcessed = 0;

    try {
      while (true) {
        const res = await fetch("/api/bilag/guess-backfill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cursor }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? "Kunne ikke gætte beløb.");
          break;
        }
        const body = await res.json();
        totalUpdated += body.updated;
        totalProcessed += body.processed;
        setProgress(`${totalProcessed} bilag tjekket, ${totalUpdated} gæt tilføjet…`);
        onDone();

        if (!body.nextCursor) {
          setProgress(`Færdig — ${totalProcessed} bilag tjekket, ${totalUpdated} gæt tilføjet.`);
          break;
        }
        cursor = body.nextCursor;
      }
    } catch {
      setError("Der skete en fejl under gætning.");
    }
    setRunning(false);
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col gap-2 min-w-[260px]">
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500">
          Genkør gæt af beløb/leverandør på alle ubogførte bilag
        </span>
        <button
          onClick={run}
          disabled={running}
          className="bg-slate-900 text-white rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          {running ? "Gætter…" : "Gæt beløb nu"}
        </button>
      </div>
      {progress && <p className="text-xs text-slate-500">{progress}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function useCounts() {
  const { data } = useSWR<Bilag[]>("/api/bilag", fetcher);
  return useMemo(() => {
    if (!data) return null;
    return {
      MANGLER_BELOEB: data.filter((b) => b.status === "MANGLER_BELOEB").length,
      BOGFOERT: data.filter((b) => b.status === "BOGFOERT").length,
      AFSTEMT: data.filter((b) => b.status === "AFSTEMT").length,
      IGNORERET: data.filter((b) => b.status === "IGNORERET").length,
    };
  }, [data]);
}

function BilagRow({
  bilag,
  categories,
  businessAreas,
  onChanged,
}: {
  bilag: Bilag;
  categories: Category[];
  businessAreas: BusinessArea[];
  onChanged: () => void;
}) {
  const attachmentNames: string[] = useMemo(() => {
    try {
      return JSON.parse(bilag.attachmentNames);
    } catch {
      return [];
    }
  }, [bilag.attachmentNames]);

  const guessedAmountIsDKK =
    bilag.guessedCurrency === null || bilag.guessedCurrency === "DKK";
  const [amount, setAmount] = useState(
    bilag.guessedAmount && guessedAmountIsDKK ? String(bilag.guessedAmount) : "",
  );
  const [type, setType] = useState<"EXPENSE" | "INCOME">("EXPENSE");
  const [categoryId, setCategoryId] = useState("");
  const [businessAreaId, setBusinessAreaId] = useState("");
  const [description, setDescription] = useState(bilag.guessedVendor ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const categoriesForType = categories.filter((c) => c.type === type);

  async function confirm() {
    const numericAmount = Number(amount);
    if (!numericAmount || numericAmount <= 0) {
      setError("Udfyld et beløb større end 0.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/bilag/${bilag.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "confirm",
        amount: numericAmount,
        type,
        description: description || undefined,
        categoryId: categoryId || null,
        businessAreaId: businessAreaId || null,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Kunne ikke bogføre bilaget.");
      return;
    }
    onChanged();
  }

  async function ignore() {
    await fetch(`/api/bilag/${bilag.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ignore" }),
    });
    onChanged();
  }

  async function reset() {
    await fetch(`/api/bilag/${bilag.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset" }),
    });
    onChanged();
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-sm font-medium text-slate-900">
            {bilag.guessedVendor ?? bilag.subject}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            {bilag.guessedInvoiceDate ? (
              <>
                Faktura: {formatDate(bilag.guessedInvoiceDate)} · modtaget{" "}
                {formatDate(bilag.receivedAt)}
              </>
            ) : (
              <>Modtaget {formatDate(bilag.receivedAt)}</>
            )}{" "}
            · fra {bilag.senderEmail}
            {bilag.guessedVendor && ` · "${bilag.subject}"`}
          </p>
          {bilag.attachments.length > 0 ? (
            <p className="text-xs mt-1 flex flex-wrap gap-2">
              {bilag.attachments.map((a) => (
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
              <a
                href={`/api/bilag/${bilag.id}/raw-text`}
                target="_blank"
                rel="noreferrer"
                className="text-slate-400 hover:underline"
              >
                🔍 vis rå tekst
              </a>
            </p>
          ) : (
            (attachmentNames.length > 0 || bilag.bodyText) && (
              <p className="text-xs mt-1 flex flex-wrap items-center gap-2">
                {attachmentNames.length > 0 && (
                  <span className="text-slate-400">📎 {attachmentNames.join(", ")}</span>
                )}
                {bilag.bodyText && (
                  <a
                    href={`/api/bilag/${bilag.id}/raw-text`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-slate-400 hover:underline"
                  >
                    🔍 vis rå tekst (mailtekst)
                  </a>
                )}
              </p>
            )
          )}
        </div>
        <StatusBadge status={bilag.status} />
      </div>

      {bilag.status === "MANGLER_BELOEB" && (
        <div className="flex flex-wrap items-end gap-2 pt-3 border-t border-slate-100">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-slate-500">Type</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as "EXPENSE" | "INCOME")}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
            >
              <option value="EXPENSE">Udgift</option>
              <option value="INCOME">Indtægt</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-slate-500">
              Beløb (DKK){bilag.guessedAmount != null && " · gættet, tjek det"}
            </span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={`border rounded-md px-2 py-1.5 text-sm w-28 text-slate-900 ${
                bilag.guessedAmount != null ? "border-amber-300 bg-amber-50" : "border-slate-300"
              }`}
              placeholder="0,00"
            />
            {!guessedAmountIsDKK && bilag.guessedAmount != null && (
              <span className="text-amber-700">
                Fandt {bilag.guessedAmount} {bilag.guessedCurrency} — ikke DKK, indtast selv
                DKK-beløbet
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-slate-500">Kategori</span>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
            >
              <option value="">Ingen</option>
              {categoriesForType.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-slate-500">Forretningsområde</span>
            <select
              value={businessAreaId}
              onChange={(e) => setBusinessAreaId(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
            >
              <option value="">Ingen</option>
              {businessAreas.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs flex-1 min-w-[140px]">
            <span className="text-slate-500">
              Beskrivelse{bilag.guessedVendor && " · gættet, tjek det"}
            </span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={`border rounded-md px-2 py-1.5 text-sm text-slate-900 ${
                bilag.guessedVendor ? "border-amber-300 bg-amber-50" : "border-slate-300"
              }`}
              placeholder="Leverandør / note"
            />
          </label>
          <button
            onClick={confirm}
            disabled={submitting}
            className="bg-slate-900 text-white rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            Bogfør
          </button>
          <button
            onClick={ignore}
            className="text-sm text-slate-500 hover:text-slate-800 px-2 py-1.5"
          >
            Ignorér
          </button>
        </div>
      )}
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}

      {bilag.status === "BOGFOERT" && bilag.transaction && (
        <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-sm">
          <span className="text-slate-600">
            Bogført som {bilag.transaction.type === "INCOME" ? "indtægt" : "udgift"}:{" "}
            <span className="font-medium text-slate-900">
              {formatDKK(bilag.transaction.amount)}
            </span>
            {bilag.transaction.category && ` · ${bilag.transaction.category.name}`}
            {bilag.transaction.businessArea && ` · ${bilag.transaction.businessArea.name}`}
          </span>
        </div>
      )}

      {bilag.status === "IGNORERET" && (
        <div className="pt-3 border-t border-slate-100">
          <button onClick={reset} className="text-sm text-slate-600 hover:text-slate-900">
            Fortryd (sæt tilbage til &quot;mangler beløb&quot;)
          </button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: BilagStatus }) {
  const styles: Record<BilagStatus, string> = {
    MANGLER_BELOEB: "bg-amber-50 text-amber-700",
    BOGFOERT: "bg-emerald-50 text-emerald-700",
    AFSTEMT: "bg-blue-50 text-blue-700",
    IGNORERET: "bg-slate-100 text-slate-500",
  };
  const labels: Record<BilagStatus, string> = {
    MANGLER_BELOEB: "Mangler beløb",
    BOGFOERT: "Bogført",
    AFSTEMT: "Afstemt",
    IGNORERET: "Ignoreret",
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

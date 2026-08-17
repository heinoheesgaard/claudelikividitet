"use client";

import { useEffect, useRef, useState } from "react";
import { formatDKK, formatDate } from "@/lib/format";

// The set of bilag a chat session is scoped to — handed off from wherever
// the user picked them (e.g. ArchiveSearch's "Spørg Julia" button) via
// sessionStorage, since that's simpler than round-tripping a long list of
// IDs through the URL and survives a page refresh within the same tab.
export type JuliaSelection = {
  id: string;
  label: string;
  receivedAt: string;
  amount: number | null;
  currency: string | null;
}[];

const STORAGE_KEY = "julia-selection";

type ChatMessage = { role: "user" | "assistant"; content: string };

export default function JuliaPage() {
  const [selection, setSelection] = useState<JuliaSelection | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) {
        setSelection([]);
        return;
      }
      try {
        setSelection(JSON.parse(raw));
      } catch {
        setSelection([]);
      }
    })();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || !selection || selection.length === 0 || sending) return;

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    setInput("");
    setSending(true);
    setError(null);

    try {
      const res = await fetch("/api/julia/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bilagIds: selection.map((s) => s.id),
          messages: nextMessages,
        }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Julia kunne ikke svare lige nu.");
        setMessages(nextMessages);
        setSending(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        setMessages([...nextMessages, { role: "assistant", content: full }]);
      }
    } catch {
      setError("Der skete en fejl under samtalen med Julia.");
      setMessages(nextMessages);
    }
    setSending(false);
  }

  if (selection === null) {
    return <p className="text-sm text-slate-500">Indlæser…</p>;
  }

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-8rem)]">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Julia</h1>
        <p className="text-slate-500 mt-1">
          Din AI-revisor og finansielle rådgiver. Hun kan se de valgte bilag og forklare
          sammenhænge — men bogfører aldrig noget selv, det gør du.
        </p>
      </div>

      {selection.length === 0 ? (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-4 text-sm">
          Ingen bilag valgt. Gå til{" "}
          <a href="/bilag" className="underline">
            Bilag
          </a>{" "}
          → søg i arkivet → markér de bilag du vil have Julia til at analysere, og tryk
          &quot;Spørg Julia&quot;.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-wrap gap-2">
          {selection.map((s) => (
            <span
              key={s.id}
              className="text-xs bg-slate-100 text-slate-700 rounded-full px-3 py-1"
            >
              {s.label} · {formatDate(s.receivedAt)}
              {s.amount != null &&
                ` · ${formatDKK(s.amount)}${s.currency && s.currency !== "DKK" ? ` ${s.currency}` : ""}`}
            </span>
          ))}
        </div>
      )}

      <div
        ref={scrollRef}
        className="flex-1 bg-white border border-slate-200 rounded-lg p-4 overflow-y-auto flex flex-col gap-3"
      >
        {messages.length === 0 && selection.length > 0 && (
          <p className="text-sm text-slate-400">
            Skriv et spørgsmål til Julia om de valgte bilag herunder, f.eks. &quot;Analysér
            dem og find hoved og hale i dem&quot;.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
              m.role === "user"
                ? "self-end bg-slate-900 text-white"
                : "self-start bg-slate-100 text-slate-900"
            }`}
          >
            {m.content || (sending && i === messages.length - 1 ? "…" : "")}
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={selection.length === 0 || sending}
          placeholder="Spørg Julia…"
          className="flex-1 border border-slate-300 rounded-md px-3 py-2 text-sm text-slate-900 disabled:opacity-50"
        />
        <button
          onClick={send}
          disabled={selection.length === 0 || sending || !input.trim()}
          className="bg-slate-900 text-white rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {sending ? "Svarer…" : "Send"}
        </button>
      </div>
    </div>
  );
}

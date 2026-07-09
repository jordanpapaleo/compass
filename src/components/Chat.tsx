import { Icon } from "@iconify/react";
import { useEffect, useRef, useState } from "react";
import { type ChatMsg, fetchProviders, type RoutedInfo, streamChat } from "../lib/gateway";

interface Turn {
  role: "user" | "assistant";
  content: string;
  routed?: RoutedInfo | null;
}

const MODES: Array<{ value: string; label: string }> = [
  { value: "compass/auto", label: "Auto (let Compass pick)" },
  { value: "compass/coding", label: "Force: coding" },
  { value: "compass/architecture", label: "Force: architecture" },
  { value: "compass/summarization", label: "Force: summarization" },
  { value: "claude-opus-4-8", label: "Claude Opus 4.8" },
  { value: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "ollama/qwen3:8b", label: "Local (qwen3:8b, free)" },
];

/**
 * Built-in chat — a place to actually use Compass without wiring up another
 * tool. Streams through the gateway; each answer shows where it was routed.
 */
export function Chat() {
  const [model, setModel] = useState("compass/auto");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customModes, setCustomModes] = useState<Array<{ value: string; label: string }>>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Populate the dropdown with any custom-provider models.
  useEffect(() => {
    fetchProviders()
      .then((ps) =>
        setCustomModes(
          ps
            .filter((p) => p.custom && p.models)
            .flatMap((p) =>
              (p.models ?? []).map((m) => ({ value: `${p.name}/${m}`, label: `${p.label}: ${m}` })),
            ),
        ),
      )
      .catch(() => setCustomModes([]));
  }, []);

  const scrollDown = () => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setError(null);
    setInput("");

    const history: ChatMsg[] = [
      ...turns.map((t) => ({ role: t.role, content: t.content })),
      { role: "user" as const, content: text },
    ];
    setTurns((prev) => [...prev, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setBusy(true);
    scrollDown();

    try {
      const routed = await streamChat(model, history, (delta) => {
        // Immutable update — mutating `last` is impure and double-appends
        // under React StrictMode (updaters run twice in dev).
        setTurns((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== "assistant") return prev;
          return [...prev.slice(0, -1), { ...last, content: last.content + delta }];
        });
        scrollDown();
      });
      setTurns((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== "assistant") return prev;
        return [...prev.slice(0, -1), { ...last, routed }];
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      // Drop the empty assistant bubble on failure.
      setTurns((prev) => {
        const next = [...prev];
        if (next[next.length - 1]?.content === "") next.pop();
        return next;
      });
    } finally {
      setBusy(false);
      scrollDown();
    }
  };

  return (
    <div className="card flex h-full flex-col border border-[var(--color-border)] bg-base-200">
      <div className="card-body flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex items-center gap-2">
          <Icon icon="uil:comments" className="text-xl" />
          <h2 className="text-base font-semibold">Chat</h2>
          <select
            className="select select-sm select-bordered ml-auto"
            value={model}
            aria-label="Routing mode"
            onChange={(e) => setModel(e.target.value)}
          >
            {[...MODES, ...customModes].map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          {turns.length > 0 ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setTurns([])}
              aria-label="Clear chat"
            >
              <Icon icon="uil:trash-alt" />
            </button>
          ) : null}
        </div>

        <div
          ref={scrollRef}
          className="min-h-[280px] flex-1 space-y-3 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-base-100 p-3"
        >
          {turns.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center text-sm text-[var(--color-text-muted)]">
              Ask anything. Compass routes it and shows you where it went.
            </div>
          ) : (
            turns.map((t, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: append-only chat log
                key={i}
                className={t.role === "user" ? "flex justify-end" : "flex justify-start"}
              >
                <div
                  className={
                    t.role === "user"
                      ? "max-w-[80%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-content"
                      : "max-w-[85%] rounded-lg bg-base-200 px-3 py-2 text-sm"
                  }
                >
                  <div className="whitespace-pre-wrap break-words">
                    {t.content || (busy && i === turns.length - 1 ? "…" : "")}
                  </div>
                  {t.routed ? (
                    <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                      ↳ {t.routed.provider}/{t.routed.model} · {t.routed.intent}
                    </div>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>

        {error ? <p className="text-xs text-error">{error}</p> : null}

        <div className="flex gap-2">
          <input
            className="input input-bordered input-sm flex-1"
            placeholder="Type a message…"
            value={input}
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy || !input.trim()}
            onClick={() => void send()}
          >
            {busy ? <span className="loading loading-spinner loading-xs" /> : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

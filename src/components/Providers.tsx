import { Icon } from "@iconify/react";
import { useCallback, useEffect, useState } from "react";
import { clearProviderKey, fetchProviders, type ProviderInfo, setProviderKey } from "../lib/gateway";

const LABELS: Record<string, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (GPT)",
  gemini: "Google (Gemini)",
  zai: "Z.ai (GLM)",
  ollama: "Ollama (local)",
};

const HINTS: Record<string, string> = {
  anthropic: "console.anthropic.com → API keys",
  openai: "platform.openai.com → API keys",
  gemini: "aistudio.google.com/apikey (free tier)",
  zai: "z.ai → API keys",
  ollama: "base URL, e.g. http://localhost:11434/v1",
};

/**
 * Providers — add and manage keys from the app instead of the .env file.
 * Keys are stored locally by the gateway (~/.compass/config.json, owner-only)
 * and never leave the machine.
 */
export function Providers() {
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setProviders(await fetchProviders());
    } catch {
      setProviders(null);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = async (name: string) => {
    if (!draft.trim()) return;
    setSaving(true);
    await setProviderKey(name, draft.trim()).catch(() => {});
    setDraft("");
    setEditing(null);
    setSaving(false);
    await refresh();
  };

  const remove = async (name: string) => {
    await clearProviderKey(name).catch(() => {});
    await refresh();
  };

  return (
    <div className="card border border-[var(--color-border)] bg-base-200">
      <div className="card-body">
        <h2 className="card-title text-base">
          <Icon icon="uil:cog" className="text-xl" />
          Providers
        </h2>
        <p className="text-xs text-[var(--color-text-muted)]">
          Add keys here — no more editing files. Stored locally, owner-only, never leaves your Mac.
        </p>

        {providers === null ? (
          <p className="text-sm text-[var(--color-text-muted)]">Gateway offline.</p>
        ) : (
          <ul className="mt-1 flex flex-col divide-y divide-[var(--color-border)]">
            {providers.map((p) => (
              <li key={p.name} className="flex flex-col gap-2 py-3 first:pt-1">
                <div className="flex items-center gap-3">
                  <span className="flex-1 text-sm font-medium">{LABELS[p.name] ?? p.name}</span>
                  {p.configured ? (
                    <span className="badge badge-success badge-sm gap-1">
                      <Icon icon="uil:check" /> configured
                    </span>
                  ) : (
                    <span className="badge badge-ghost badge-sm">not set</span>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => {
                      setEditing(editing === p.name ? null : p.name);
                      setDraft("");
                    }}
                  >
                    {p.configured ? "Change" : "Add"}
                  </button>
                  {p.configured ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs text-error"
                      aria-label={`Remove ${p.name}`}
                      onClick={() => remove(p.name)}
                    >
                      <Icon icon="uil:times" />
                    </button>
                  ) : null}
                </div>

                {editing === p.name ? (
                  <div className="flex flex-col gap-1">
                    <div className="flex gap-2">
                      <input
                        className="input input-bordered input-sm flex-1 font-mono"
                        type={p.field === "api_key" ? "password" : "text"}
                        placeholder={p.field === "api_key" ? "paste API key" : "base URL"}
                        value={draft}
                        autoFocus
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void save(p.name);
                          if (e.key === "Escape") setEditing(null);
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={saving || !draft.trim()}
                        onClick={() => void save(p.name)}
                      >
                        Save
                      </button>
                    </div>
                    <span className="text-xs text-[var(--color-text-muted)]">{HINTS[p.name]}</span>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

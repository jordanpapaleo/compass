import { Icon } from "@iconify/react";
import { useCallback, useEffect, useState } from "react";
import {
  addCustomProvider,
  clearProviderKey,
  fetchProviders,
  type ProviderInfo,
  removeCustomProvider,
  setProviderKey,
} from "../lib/gateway";

const BUILTIN_LABELS: Record<string, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (GPT)",
  gemini: "Google (Gemini)",
  ollama: "Ollama (local)",
};

const HINTS: Record<string, string> = {
  anthropic: "console.anthropic.com → API keys",
  openai: "platform.openai.com → API keys",
  gemini: "aistudio.google.com/apikey (free tier)",
  ollama: "base URL, e.g. http://localhost:11434/v1",
};

/**
 * Providers — manage keys for built-ins and add any OpenAI-compatible provider
 * from the UI. Keys are stored locally (~/.compass/config.json, owner-only)
 * and never leave the machine.
 */
export function Providers() {
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [showAdd, setShowAdd] = useState(false);

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

  const saveKey = async (name: string) => {
    if (!draft.trim()) return;
    await setProviderKey(name, draft.trim()).catch(() => {});
    setDraft("");
    setEditing(null);
    await refresh();
  };

  if (providers === null) {
    return (
      <div className="card border border-[var(--color-border)] bg-base-200">
        <div className="card-body">
          <h2 className="card-title text-base">
            <Icon icon="uil:cog" className="text-xl" /> Providers
          </h2>
          <p className="text-sm text-[var(--color-text-muted)]">Gateway offline.</p>
        </div>
      </div>
    );
  }

  const builtins = providers.filter((p) => !p.custom);
  const customs = providers.filter((p) => p.custom);

  return (
    <div className="card border border-[var(--color-border)] bg-base-200">
      <div className="card-body">
        <h2 className="card-title text-base">
          <Icon icon="uil:cog" className="text-xl" /> Providers
        </h2>
        <p className="text-xs text-[var(--color-text-muted)]">
          Add keys here — no more editing files. Stored locally, owner-only, never leaves your Mac.
        </p>

        <ul className="mt-1 flex flex-col divide-y divide-[var(--color-border)]">
          {builtins.map((p) => (
            <li key={p.name} className="flex flex-col gap-2 py-3 first:pt-1">
              <ProviderRow
                title={BUILTIN_LABELS[p.name] ?? p.name}
                configured={p.configured}
                onEdit={() => {
                  setEditing(editing === p.name ? null : p.name);
                  setDraft("");
                }}
                onRemove={p.configured ? () => clearProviderKey(p.name).then(refresh) : undefined}
                editLabel={p.configured ? "Change" : "Add"}
              />
              {editing === p.name ? (
                <KeyInput
                  field={p.field}
                  hint={HINTS[p.name] ?? ""}
                  value={draft}
                  onChange={setDraft}
                  onSave={() => saveKey(p.name)}
                  onCancel={() => setEditing(null)}
                />
              ) : null}
            </li>
          ))}
        </ul>

        {/* ── Custom providers ─────────────────────────────────── */}
        <div className="mt-4 border-t border-[var(--color-border)] pt-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">
              Custom providers
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-xs ml-auto"
              onClick={() => setShowAdd((v) => !v)}
            >
              <Icon icon="uil:plus" /> Add provider
            </button>
          </div>

          {customs.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1">
              {customs.map((p) => (
                <li
                  key={p.name}
                  className="flex items-center gap-2 rounded border border-[var(--color-border)] bg-base-100 px-3 py-1.5 text-sm"
                >
                  <span className="font-medium">{p.label}</span>
                  <span className="text-xs text-[var(--color-text-muted)]">
                    {p.models?.join(", ")}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs ml-auto text-error"
                    aria-label={`Remove ${p.name}`}
                    onClick={() => removeCustomProvider(p.name).then(refresh)}
                  >
                    <Icon icon="uil:times" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              None yet. Add any OpenAI-compatible provider (Groq, OpenRouter, DeepSeek, a local
              server…) — no new release needed.
            </p>
          )}

          {showAdd ? (
            <AddCustomForm
              onDone={() => {
                setShowAdd(false);
                refresh();
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ProviderRow({
  title,
  configured,
  onEdit,
  onRemove,
  editLabel,
}: {
  title: string;
  configured: boolean;
  onEdit: () => void;
  onRemove?: () => void;
  editLabel: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex-1 text-sm font-medium">{title}</span>
      {configured ? (
        <span className="badge badge-success badge-sm gap-1">
          <Icon icon="uil:check" /> configured
        </span>
      ) : (
        <span className="badge badge-ghost badge-sm">not set</span>
      )}
      <button type="button" className="btn btn-ghost btn-xs" onClick={onEdit}>
        {editLabel}
      </button>
      {onRemove ? (
        <button
          type="button"
          className="btn btn-ghost btn-xs text-error"
          aria-label="Remove"
          onClick={onRemove}
        >
          <Icon icon="uil:times" />
        </button>
      ) : null}
    </div>
  );
}

function KeyInput({
  field,
  hint,
  value,
  onChange,
  onSave,
  onCancel,
}: {
  field: "api_key" | "base_url";
  hint: string;
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <input
          className="input input-bordered input-sm flex-1 font-mono"
          type={field === "api_key" ? "password" : "text"}
          placeholder={field === "api_key" ? "paste API key" : "base URL"}
          value={value}
          // biome-ignore lint/a11y/noAutofocus: focus the field the user just opened
          autoFocus
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSave();
            if (e.key === "Escape") onCancel();
          }}
        />
        <button type="button" className="btn btn-primary btn-sm" disabled={!value.trim()} onClick={onSave}>
          Save
        </button>
      </div>
      {hint ? <span className="text-xs text-[var(--color-text-muted)]">{hint}</span> : null}
    </div>
  );
}

const TIER_KEYS = ["cheap", "balanced", "premium"] as const;

function AddCustomForm({ onDone }: { onDone: () => void }) {
  const [label, setLabel] = useState("");
  const [id, setId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState("");
  const [tiers, setTiers] = useState<{ cheap?: string; balanced?: string; premium?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const modelList = models.split(",").map((m) => m.trim()).filter(Boolean);

  const submit = async () => {
    setError(null);
    setSaving(true);
    const cleanTiers = Object.fromEntries(
      Object.entries(tiers).filter(([, v]) => v && modelList.includes(v)),
    );
    const err = await addCustomProvider({
      id: id.trim() || label.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
      label: label.trim() || id.trim(),
      base_url: baseUrl.trim(),
      api_key: apiKey.trim(),
      models: modelList,
      ...(Object.keys(cleanTiers).length ? { tiers: cleanTiers } : {}),
    });
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    onDone();
  };

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-base-100 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          className="input input-bordered input-sm"
          placeholder="Name (e.g. Groq)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <input
          className="input input-bordered input-sm font-mono"
          placeholder="id (e.g. groq) — optional"
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
      </div>
      <input
        className="input input-bordered input-sm font-mono"
        placeholder="Base URL (e.g. https://api.groq.com/openai/v1)"
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
      />
      <input
        className="input input-bordered input-sm font-mono"
        type="password"
        placeholder="API key"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
      />
      <input
        className="input input-bordered input-sm font-mono"
        placeholder="Models, comma-separated (e.g. llama-3.3-70b, mixtral)"
        value={models}
        onChange={(e) => setModels(e.target.value)}
      />

      {modelList.length > 0 ? (
        <div className="rounded border border-[var(--color-border)] p-2">
          <p className="mb-1 text-xs text-[var(--color-text-muted)]">
            Optional — assign a model to a tier so <span className="code">compass/auto</span> can
            route here automatically:
          </p>
          <div className="grid grid-cols-3 gap-2">
            {TIER_KEYS.map((tier) => (
              <label key={tier} className="flex flex-col gap-1 text-xs capitalize">
                {tier}
                <select
                  className="select select-bordered select-xs"
                  value={tiers[tier] ?? ""}
                  aria-label={`${tier} tier model`}
                  onChange={(e) => setTiers((t) => ({ ...t, [tier]: e.target.value || undefined }))}
                >
                  <option value="">—</option>
                  {modelList.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {error ? <p className="text-xs text-error">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={saving || !baseUrl.trim() || !apiKey.trim() || !models.trim()}
          onClick={submit}
        >
          Add
        </button>
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">
        Any OpenAI-compatible endpoint works. Use it from Chat or via{" "}
        <span className="code">{"<id>/<model>"}</span>.
      </p>
    </div>
  );
}

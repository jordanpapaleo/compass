import { GATEWAY_URL, type RoutableModel } from "../lib/gateway";

/**
 * Gateway subsection (Configuration card): the full model catalog as toggleable
 * chips. Every known model shows, whether or not its provider has a key —
 * models without one are greyed and labelled, so the catalog doubles as a menu
 * of what you'd get by adding that key. Turning a model off drops it from
 * auto-routing, and that choice sticks across key changes.
 */
export function GatewaySection({
  models,
  online,
  onToggle,
}: {
  models: RoutableModel[] | null;
  online: boolean;
  onToggle: (model: string, enabled: boolean) => void;
}) {
  if (!online) {
    return (
      <div className="text-sm">
        <p className="text-error">Offline — no gateway on {GATEWAY_URL}</p>
        <p className="mt-1 text-[var(--color-text-muted)]">
          Start it with <span className="code">cd gateway && npm run dev</span> or relaunch the app.
        </p>
      </div>
    );
  }

  if (!models || models.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">
        No models yet — add a provider key below to populate routing targets.
      </p>
    );
  }

  // Ready models first; the rest are aspirational until a key lands.
  const ordered = [...models].sort((a, b) => Number(b.configured) - Number(a.configured));
  const unconfigured = models.filter((m) => !m.configured).length;

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {ordered.map((m) => (
          <label
            key={`${m.provider}/${m.model}`}
            className={`flex cursor-pointer items-center gap-2 rounded-full border border-[var(--color-border)] bg-base-100 py-1 pl-2.5 pr-1.5 transition-opacity ${
              m.enabled ? (m.configured ? "" : "opacity-70") : "opacity-40"
            }`}
            title={
              m.configured
                ? `${m.provider}/${m.model}`
                : `${m.provider}/${m.model} — no key for ${m.provider} yet, so this can't be routed to`
            }
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                m.enabled ? (m.configured ? "bg-success" : "bg-warning") : "bg-base-content/30"
              }`}
            />
            <span className="font-mono text-xs">{m.model}</span>
            {!m.configured && (
              <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
                no key
              </span>
            )}
            <input
              type="checkbox"
              className="toggle toggle-primary toggle-xs"
              checked={m.enabled}
              aria-label={`${m.model}${m.configured ? "" : " (no key)"}`}
              onChange={(e) => onToggle(m.model, e.target.checked)}
            />
          </label>
        ))}
      </div>
      {unconfigured > 0 && (
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          {unconfigured} model{unconfigured === 1 ? "" : "s"} waiting on a provider key — toggle
          them now and they'll be live the moment the key lands.
        </p>
      )}
    </div>
  );
}

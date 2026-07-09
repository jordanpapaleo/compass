import { GATEWAY_URL, type RoutableModel } from "../lib/gateway";

/**
 * Gateway subsection (Configuration card): the routing-target catalog as
 * toggleable model chips. Turning a model off drops it from auto-routing.
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

  return (
    <div className="flex flex-wrap gap-1.5">
      {models.map((m) => (
        <label
          key={`${m.provider}/${m.model}`}
          className={`flex cursor-pointer items-center gap-2 rounded-full border border-[var(--color-border)] bg-base-100 py-1 pl-2.5 pr-1.5 transition-opacity ${
            m.enabled ? "" : "opacity-40"
          }`}
          title={`${m.provider}/${m.model}`}
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${m.enabled ? "bg-success" : "bg-base-content/30"}`}
          />
          <span className="font-mono text-xs">{m.model}</span>
          <input
            type="checkbox"
            className="toggle toggle-primary toggle-xs"
            checked={m.enabled}
            aria-label={m.model}
            onChange={(e) => onToggle(m.model, e.target.checked)}
          />
        </label>
      ))}
    </div>
  );
}

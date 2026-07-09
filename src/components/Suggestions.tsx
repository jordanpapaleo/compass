import { Icon } from "@iconify/react";
import { useCallback, useEffect, useState } from "react";
import { GATEWAY_URL } from "../lib/gateway";

interface InsightAction {
  type: "override";
  intent: string;
  provider: string;
  model: string;
}

interface Insight {
  id: string;
  kind: string;
  severity: "info" | "suggestion" | "warning";
  title: string;
  detail: string;
  action?: InsightAction;
  evidence: { samples: number; window: number };
}

interface OverrideEntry {
  provider: string;
  model: string;
  source: string;
  applied_at: string;
}

const SEVERITY_ICON: Record<Insight["severity"], { icon: string; cls: string }> = {
  warning: { icon: "uil:exclamation-triangle", cls: "text-warning" },
  suggestion: { icon: "uil:lightbulb-alt", cls: "text-info" },
  info: { icon: "uil:info-circle", cls: "text-[var(--color-text-muted)]" },
};

/**
 * Optimization Suggestions (Day 4) — the learning loop's surface. Insights
 * are computed live from real routing history; Apply installs an intent
 * override the router uses from the next request on.
 */
export function Suggestions() {
  const [insights, setInsights] = useState<Insight[] | null>(null);
  const [overrides, setOverrides] = useState<Record<string, OverrideEntry>>({});

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${GATEWAY_URL}/v1/insights`);
      const body = (await res.json()) as {
        insights: Insight[];
        overrides: Record<string, OverrideEntry>;
      };
      setInsights(body.insights);
      setOverrides(body.overrides);
    } catch {
      setInsights(null);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const apply = async (action: InsightAction) => {
    await fetch(`${GATEWAY_URL}/v1/overrides`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...action, source: "learned" }),
    }).catch(() => {});
    await refresh();
  };

  const remove = async (intent: string) => {
    await fetch(`${GATEWAY_URL}/v1/overrides/${intent}`, { method: "DELETE" }).catch(() => {});
    await refresh();
  };

  const overrideEntries = Object.entries(overrides);

  return (
    <div className="card border border-[var(--color-border)] bg-base-200">
      <div className="card-body">
        <h2 className="card-title text-base">
          <Icon icon="uil:brain" className="text-xl" />
          Optimization Suggestions
        </h2>

        {insights === null ? (
          <p className="text-sm text-[var(--color-text-muted)]">Gateway offline.</p>
        ) : insights.length === 0 && overrideEntries.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            Nothing yet — suggestions appear as routing history accumulates.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {insights.map((i) => {
              const sev = SEVERITY_ICON[i.severity];
              return (
                <div
                  key={i.id}
                  className="flex items-start gap-3 rounded-lg border border-[var(--color-border)] bg-base-100 p-3"
                >
                  <Icon icon={sev.icon} className={`mt-0.5 text-xl ${sev.cls}`} />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{i.title}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">{i.detail}</p>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      evidence: {i.evidence.samples} of last {i.evidence.window} requests
                    </p>
                  </div>
                  {i.action ? (
                    <button
                      type="button"
                      className="btn btn-primary btn-xs"
                      onClick={() => i.action && apply(i.action)}
                    >
                      Apply
                    </button>
                  ) : null}
                </div>
              );
            })}

            {overrideEntries.length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase text-[var(--color-text-muted)]">
                  Active learned routes
                </p>
                <ul className="flex flex-col gap-1">
                  {overrideEntries.map(([intent, o]) => (
                    <li
                      key={intent}
                      className="flex items-center justify-between rounded border border-[var(--color-border)] bg-base-100 px-3 py-1.5 text-sm"
                    >
                      <span>
                        <span className="badge badge-outline badge-sm mr-2">{intent}</span>→{" "}
                        {o.provider}/{o.model}
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        aria-label={`Remove override for ${intent}`}
                        onClick={() => remove(intent)}
                      >
                        <Icon icon="uil:times" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

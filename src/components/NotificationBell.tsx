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
  severity: "info" | "suggestion" | "warning";
  title: string;
  detail: string;
  action?: InsightAction;
}
interface OverrideEntry {
  provider: string;
  model: string;
}

const SEVERITY: Record<Insight["severity"], { icon: string; cls: string }> = {
  warning: { icon: "uil:exclamation-triangle", cls: "text-warning" },
  suggestion: { icon: "uil:lightbulb-alt", cls: "text-info" },
  info: { icon: "uil:info-circle", cls: "text-[var(--color-text-muted)]" },
};

/**
 * Notification bell (redesign) — moves Optimization Suggestions out of the main
 * flow into a header dropdown. Badge shows the suggestion count; the panel holds
 * suggestions (Apply) and active learned routes (remove).
 */
export function NotificationBell({ online }: { online: boolean }) {
  const [open, setOpen] = useState(false);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [overrides, setOverrides] = useState<Record<string, OverrideEntry>>({});

  const refresh = useCallback(async () => {
    if (!online) {
      setInsights([]);
      setOverrides({});
      return;
    }
    try {
      const res = await fetch(`${GATEWAY_URL}/v1/insights`);
      const body = (await res.json()) as {
        insights: Insight[];
        overrides: Record<string, OverrideEntry>;
      };
      setInsights(body.insights);
      setOverrides(body.overrides);
    } catch {
      setInsights([]);
      setOverrides({});
    }
  }, [online]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
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

  const count = insights.length;
  const overrideEntries = Object.entries(overrides);

  return (
    <div className="relative">
      <button
        type="button"
        className="btn btn-ghost btn-sm btn-circle"
        aria-label="Optimization suggestions"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon icon="uil:bell" className="text-lg" />
        {count > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-content">
            {count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-11 z-20 w-96 rounded-box border border-[var(--color-border)] bg-base-100 p-3 shadow-xl">
          <div className="mb-2 flex items-center gap-2">
            <Icon icon="uil:brain" className="text-lg" />
            <span className="text-sm font-semibold">Optimization Suggestions</span>
            <span className="flex-1" />
            <button
              type="button"
              className="btn btn-ghost btn-xs btn-circle"
              aria-label="Close"
              onClick={() => setOpen(false)}
            >
              <Icon icon="uil:times" />
            </button>
          </div>

          {count === 0 && overrideEntries.length === 0 ? (
            <p className="py-4 text-center text-sm text-[var(--color-text-muted)]">
              You're all caught up.
            </p>
          ) : (
            <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
              {insights.map((i) => {
                const sev = SEVERITY[i.severity];
                return (
                  <div
                    key={i.id}
                    className="flex items-start gap-2.5 rounded-lg border border-[var(--color-border)] bg-base-200 p-2.5"
                  >
                    <Icon icon={sev.icon} className={`mt-0.5 text-xl ${sev.cls}`} />
                    <div className="flex-1">
                      <p className="text-sm font-medium leading-snug">{i.title}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{i.detail}</p>
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
                <div className="mt-1 border-t border-[var(--color-border)] pt-2">
                  <p className="mb-1 text-xs font-semibold uppercase text-[var(--color-text-muted)]">
                    Active learned routes
                  </p>
                  <ul className="flex flex-col gap-1">
                    {overrideEntries.map(([intent, o]) => (
                      <li
                        key={intent}
                        className="flex items-center justify-between rounded border border-[var(--color-border)] bg-base-200 px-2.5 py-1.5 text-sm"
                      >
                        <span>
                          <span className="badge badge-outline badge-sm mr-1.5">{intent}</span>→ {o.provider}/
                          {o.model}
                        </span>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs btn-circle"
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
      ) : null}
    </div>
  );
}

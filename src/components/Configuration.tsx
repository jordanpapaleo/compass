import { Icon } from "@iconify/react";
import { useCallback, useEffect, useState } from "react";
import { fetchModels, GATEWAY_URL, type RoutableModel, setModelEnabled } from "../lib/gateway";
import { GatewaySection } from "./GatewaySection";
import { PersonalizationSection } from "./Personalization";
import { ProvidersSection } from "./Providers";

/**
 * Configuration (redesign) — one collapsible card consolidating the routing
 * setup: Gateway model targets, Providers/keys, and Personalization sliders.
 */
export function Configuration({ online }: { online: boolean }) {
  const [open, setOpen] = useState(true);
  const [models, setModels] = useState<RoutableModel[] | null>(null);
  const [temp, setTemp] = useState<number | null>(null);
  // Bumped when a model is toggled, so the Personalization preview re-runs.
  const [previewKey, setPreviewKey] = useState(0);

  const refreshModels = useCallback(async () => {
    if (!online) {
      setModels(null);
      return;
    }
    try {
      setModels(await fetchModels());
    } catch {
      setModels(null);
    }
  }, [online]);

  // Poll models + temperature so the collapsed summary stays live.
  useEffect(() => {
    if (!online) {
      setModels(null);
      setTemp(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const [ms, prefsRes] = await Promise.all([
          fetchModels(),
          fetch(`${GATEWAY_URL}/v1/preferences`).then((r) => r.json()),
        ]);
        if (cancelled) return;
        setModels(ms);
        const dc = (prefsRes as { preferences?: { deterministic_creative?: number } })?.preferences
          ?.deterministic_creative;
        setTemp(typeof dc === "number" ? Math.round(dc) / 100 : null);
      } catch {
        if (!cancelled) setModels(null);
      }
    };
    poll();
    const t = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [online]);

  const toggleModel = (model: string, enabled: boolean) => {
    // Optimistic update, then persist + refetch; nudge the live preview.
    setModels((prev) => prev?.map((m) => (m.model === model ? { ...m, enabled } : m)) ?? prev);
    setModelEnabled(model, enabled)
      .then(refreshModels)
      .then(() => setPreviewKey((k) => k + 1))
      .catch(() => {});
  };

  // The summary counts what can actually route: catalog entries whose provider
  // has a key. Unconfigured models are in the list below, not in this count.
  const ready = models?.filter((m) => m.configured) ?? [];
  const active = ready.filter((m) => m.enabled).length;
  const tempSuffix = temp !== null ? ` · temp ${temp}` : "";
  const summary = !online
    ? "gateway offline"
    : ready.length === 0
      ? `no provider keys yet${tempSuffix}`
      : `${active}/${ready.length} models${tempSuffix}`;

  return (
    <div className="card border border-[var(--color-border)] bg-base-200">
      <div className="card-body gap-0 py-4">
        <button
          type="button"
          className="flex w-full items-center gap-3 text-left"
          onClick={() => setOpen((v) => !v)}
        >
          <Icon icon="uil:cog" className="text-xl" />
          <span className="text-base font-semibold">Configuration</span>
          <span className="text-sm font-normal text-[var(--color-text-muted)]">{summary}</span>
          <span className="flex-1" />
          <Icon
            icon={open ? "uil:angle-up" : "uil:angle-down"}
            className="text-lg text-[var(--color-text-muted)]"
          />
        </button>

        {open ? (
          <>
            {/* Gateway — routable model targets */}
            <div className="mt-4">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase text-[var(--color-text-muted)]">
                <Icon icon="uil:server" /> Gateway ·{" "}
                {online ? `${active} of ${ready.length} models routable` : "offline"}
              </p>
              <GatewaySection models={models} online={online} onToggle={toggleModel} />
            </div>

            {/* Providers — keys & custom providers */}
            <div className="mt-5 border-t border-[var(--color-border)] pt-4">
              <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase text-[var(--color-text-muted)]">
                <Icon icon="uil:key-skeleton" /> Providers &amp; keys
              </p>
              <ProvidersSection onChange={refreshModels} />
            </div>

            {/* Personalization — sliders + live result */}
            <div className="mt-5 border-t border-[var(--color-border)] pt-4">
              <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase text-[var(--color-text-muted)]">
                <Icon icon="uil:sliders-v-alt" /> Personalization
              </p>
              {online ? (
                <PersonalizationSection refreshKey={previewKey} />
              ) : (
                <p className="text-sm text-[var(--color-text-muted)]">Gateway offline.</p>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

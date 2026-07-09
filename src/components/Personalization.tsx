import { Icon } from "@iconify/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { GATEWAY_URL } from "../lib/gateway";

interface Preferences {
  quality_cost: number;
  speed_accuracy: number;
  deterministic_creative: number;
  cloud_local: number;
}

interface Decision {
  intent: string;
  provider: string;
  model: string;
  rule: string;
  reason: string[];
  temperature?: number;
}

const AXES: Array<{
  key: keyof Preferences;
  left: string;
  right: string;
}> = [
  { key: "quality_cost", left: "Quality", right: "Cost" },
  { key: "speed_accuracy", left: "Speed", right: "Accuracy" },
  { key: "deterministic_creative", left: "Deterministic", right: "Creative" },
  { key: "cloud_local", left: "Cloud", right: "Local" },
];

const SAMPLE_PROMPTS: Array<{ label: string; prompt: string }> = [
  { label: "Review a PR", prompt: "Review this PR please — diff attached" },
  { label: "Commit message", prompt: "Write a commit message for these changes" },
  { label: "Implement code", prompt: "Implement a function that parses YAML" },
  { label: "Architecture", prompt: "Design the system architecture for our event pipeline" },
  { label: "Summarize", prompt: "Summarize this document, key points only" },
];

/**
 * Personalization (Day 3): preference sliders persisted in the gateway, plus
 * a live dry-run preview proving that moving a slider reroutes a request.
 */
export function Personalization() {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [sample, setSample] = useState(0);
  const [decision, setDecision] = useState<Decision | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load persisted preferences once.
  useEffect(() => {
    fetch(`${GATEWAY_URL}/v1/preferences`)
      .then((r) => r.json())
      .then((b: { preferences: Preferences }) => setPrefs(b.preferences))
      .catch(() => setPrefs(null));
  }, []);

  // Live preview: dry-run the sample prompt whenever prefs (saved) change.
  const runPreview = useCallback(async (promptIdx: number) => {
    try {
      const res = await fetch(`${GATEWAY_URL}/v1/route`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "compass/auto",
          messages: [{ role: "user", content: SAMPLE_PROMPTS[promptIdx]?.prompt ?? "" }],
        }),
      });
      const body = (await res.json()) as { decision: Decision };
      setDecision(body.decision);
    } catch {
      setDecision(null);
    }
  }, []);

  // Preview on mount and when the sample prompt changes. Slider-driven
  // refreshes happen in the save handler — /v1/route reads prefs server-side,
  // so previewing before the PUT lands would show a stale decision.
  useEffect(() => {
    void runPreview(sample);
  }, [sample, runPreview]);

  // Clear any pending debounced save on unmount.
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const onSlide = (key: keyof Preferences, value: number) => {
    if (!prefs) return;
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    // Debounced save; preview refreshes via the prefs effect after save.
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch(`${GATEWAY_URL}/v1/preferences`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      })
        .then(() => runPreview(sample))
        .catch(() => {});
    }, 250);
  };

  return (
    <div className="card border border-[var(--color-border)] bg-base-200">
      <div className="card-body">
        <h2 className="card-title text-base">
          <Icon icon="uil:sliders-v-alt" className="text-xl" />
          Personalization
        </h2>

        {prefs === null ? (
          <p className="text-sm text-[var(--color-text-muted)]">Gateway offline.</p>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            <div className="flex flex-col gap-4">
              {AXES.map((axis) => (
                <label key={axis.key} className="flex flex-col gap-1">
                  <div className="flex justify-between text-xs text-[var(--color-text-muted)]">
                    <span className={prefs[axis.key] <= 24 ? "font-bold text-primary" : ""}>
                      {axis.left}
                    </span>
                    <span className={prefs[axis.key] >= 76 ? "font-bold text-primary" : ""}>
                      {axis.right}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={prefs[axis.key]}
                    className="range range-primary range-sm"
                    aria-label={`${axis.left} versus ${axis.right}`}
                    onChange={(e) => onSlide(axis.key, Number(e.target.value))}
                  />
                </label>
              ))}
            </div>

            <div className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-base-100 p-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">
                  Live preview
                </span>
                <select
                  className="select select-xs select-bordered"
                  value={sample}
                  aria-label="Sample request"
                  onChange={(e) => setSample(Number(e.target.value))}
                >
                  {SAMPLE_PROMPTS.map((p, i) => (
                    <option key={p.label} value={i}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              {decision === null ? (
                <p className="text-sm text-[var(--color-text-muted)]">No decision yet.</p>
              ) : (
                <>
                  <p className="text-sm">
                    <span className="badge badge-outline badge-sm mr-2">{decision.intent}</span>
                    routes to{" "}
                    <span className="font-semibold">
                      {decision.provider}/{decision.model}
                    </span>
                    {decision.temperature !== undefined ? (
                      <span className="text-[var(--color-text-muted)]">
                        {" "}
                        · temp {decision.temperature}
                      </span>
                    ) : null}
                  </p>
                  <ul className="list-disc pl-4 text-xs text-[var(--color-text-muted)]">
                    {decision.reason.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

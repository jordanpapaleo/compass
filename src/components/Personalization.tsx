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
  provider: string;
  model: string;
  reason: string[];
  temperature?: number;
}

const AXES: Array<{ key: keyof Preferences; left: string; right: string }> = [
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
 * Personalization section (Configuration card): 2×2 preference sliders and a
 * live result strip showing what the current sliders route a sample request to,
 * with an expandable "Why" reasoning list.
 */
export function PersonalizationSection({ refreshKey = 0 }: { refreshKey?: number }) {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [sample, setSample] = useState(0);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [showWhy, setShowWhy] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch(`${GATEWAY_URL}/v1/preferences`)
      .then((r) => r.json())
      .then((b: { preferences: Preferences }) => setPrefs(b.preferences))
      .catch(() => setPrefs(null));
  }, []);

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

  // Re-run when the sample changes or when the parent bumps refreshKey
  // (e.g. a model was toggled on/off in the Gateway chips).
  useEffect(() => {
    void runPreview(sample);
  }, [sample, runPreview, refreshKey]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const onSlide = (key: keyof Preferences, value: number) => {
    if (!prefs) return;
    const next = { ...prefs, [key]: value };
    setPrefs(next);
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

  if (prefs === null) {
    return <p className="text-sm text-[var(--color-text-muted)]">Gateway offline.</p>;
  }

  return (
    <>
      <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {AXES.map((axis) => (
          <label key={axis.key} className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-[var(--color-text-muted)]">
              <span className={prefs[axis.key] <= 24 ? "font-bold text-primary" : ""}>{axis.left}</span>
              <span className={prefs[axis.key] >= 76 ? "font-bold text-primary" : ""}>{axis.right}</span>
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

      {/* Live result strip — the outcome of the sliders above. */}
      <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-base-100">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
          <span className="text-xs text-[var(--color-text-muted)]">A</span>
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
          <span className="text-xs text-[var(--color-text-muted)]">request</span>
          <Icon icon="uil:arrow-right" className="text-[var(--color-text-muted)]" />
          {decision ? (
            <>
              <span className="font-mono font-semibold">
                {decision.provider}/{decision.model}
              </span>
              {decision.temperature !== undefined ? (
                <span className="text-xs text-[var(--color-text-muted)]">temp {decision.temperature}</span>
              ) : null}
            </>
          ) : (
            <span className="text-xs text-[var(--color-text-muted)]">no decision</span>
          )}
          <span className="flex-1" />
          {decision && decision.reason.length ? (
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-base-content"
              onClick={() => setShowWhy((v) => !v)}
            >
              <Icon icon={showWhy ? "uil:angle-up" : "uil:angle-down"} />
              {showWhy ? "Hide reasoning" : `Why ${decision.reason.length} steps`}
            </button>
          ) : null}
        </div>
        {showWhy && decision ? (
          <ul className="list-disc border-t border-[var(--color-border)] px-3 py-2 pl-7 text-xs text-[var(--color-text-muted)]">
            {decision.reason.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </>
  );
}

import { Icon } from "@iconify/react";

/**
 * Help — setup & usage, shown from the Help menu (native) or the header
 * button. Self-contained so it works in the browser dashboard too.
 */
export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      role="presentation"
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[var(--color-border)] bg-base-100 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Setup and usage"
      >
        <div className="mb-4 flex items-center gap-2">
          <Icon icon="uil:question-circle" className="text-2xl text-primary" />
          <h2 className="text-lg font-semibold">Using Compass</h2>
          <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={onClose}>
            <Icon icon="uil:times" />
          </button>
        </div>

        <div className="space-y-4 text-sm">
          <section>
            <h3 className="font-semibold">What it is</h3>
            <p className="text-[var(--color-text-muted)]">
              A smart switchboard for AI. You ask for the work; Compass picks the model by
              intent, your preferences, and what it's learned. It runs locally between your
              tools and the AI providers — it isn't a website.
            </p>
          </section>

          <section>
            <h3 className="font-semibold">1. Add a provider key</h3>
            <p className="text-[var(--color-text-muted)]">
              Open the <b>Providers</b> panel and paste a key. Free local routing works with
              no key if you have Ollama running. Gemini has a free tier at{" "}
              <span className="code">aistudio.google.com/apikey</span>.
            </p>
          </section>

          <section>
            <h3 className="font-semibold">2. Use it — three ways</h3>
            <ul className="ml-4 list-disc space-y-1 text-[var(--color-text-muted)]">
              <li>
                <b>Right here</b> — the <b>Chat</b> panel routes through Compass. Simplest.
              </li>
              <li>
                <b>Any OpenAI-compatible tool</b> (Cursor, Aider, Continue, Zed, your own
                scripts) — point it at <span className="code">http://localhost:4000/v1</span>,
                any API key, model <span className="code">compass/auto</span>.
              </li>
              <li>
                <b>Terminal</b> — <span className="code">node examples/ask.mjs "your question"</span>
              </li>
            </ul>
          </section>

          <section>
            <h3 className="font-semibold">3. The model selector is the control</h3>
            <ul className="ml-4 list-disc space-y-1 text-[var(--color-text-muted)]">
              <li>
                <span className="code">compass/auto</span> — detect intent, route by rules +
                sliders + learned routes
              </li>
              <li>
                <span className="code">compass/&lt;intent&gt;</span> — force one, e.g.{" "}
                <span className="code">compass/pr-review</span>
              </li>
              <li>
                a real model id (<span className="code">claude-opus-5</span>,{" "}
                <span className="code">gpt-5.4</span>, <span className="code">ollama/qwen3:8b</span>)
                — go straight there
              </li>
            </ul>
          </section>

          <section>
            <h3 className="font-semibold">4. Tune & watch</h3>
            <p className="text-[var(--color-text-muted)]">
              <b>Personalization</b> sliders change routing live. <b>Suggestions</b> learns from
              your history — click Apply to make a pattern automatic. <b>Routing Log</b> shows
              every decision, why, and what it cost.
            </p>
          </section>

          <p className="text-xs text-[var(--color-text-muted)]">
            Your data (log, preferences, keys) stays on your machine under{" "}
            <span className="code">~/.compass/</span>. Full docs in the project README.
          </p>
        </div>
      </div>
    </div>
  );
}

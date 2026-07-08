import { Icon } from "@iconify/react";

/**
 * Minimal Compass shell — seeded from the Helm Tauri app skeleton.
 *
 * This is intentionally a blank canvas. The real Compass surfaces
 * (dashboard, live request view, preference sliders, explainability panel)
 * get built on top of this. See the spec + Day plans in the project notes.
 */
export default function App() {
  return (
    <div className="flex h-screen flex-col bg-base-100 text-base-content">
      <header className="flex items-center gap-3 border-b border-[var(--color-border)] px-5 py-3">
        <Icon icon="uil:compass" className="text-2xl text-primary" />
        <div>
          <h1 className="text-lg font-semibold leading-none">Compass</h1>
          <p className="text-xs text-[var(--color-text-muted)]">Personal AI routing layer</p>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center p-8">
        <div className="card w-full max-w-md border border-[var(--color-border)] bg-base-200">
          <div className="card-body items-center text-center">
            <Icon icon="uil:constructor" className="text-4xl text-[var(--color-text-muted)]" />
            <h2 className="card-title">Gateway not yet wired up</h2>
            <p className="text-sm text-[var(--color-text-muted)]">
              This is the Compass seed. Build the gateway sidecar, routing engine, and
              dashboard here — see the project spec for the Day&nbsp;1 scope.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

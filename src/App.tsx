import { Icon } from "@iconify/react";
import { useEffect, useState } from "react";

const GATEWAY_URL = "http://localhost:4000";

interface ProviderStatus {
  name: string;
  key_configured: boolean;
}

interface Health {
  status: string;
  service: string;
  providers: ProviderStatus[];
}

type GatewayState =
  | { kind: "connecting" }
  | { kind: "online"; health: Health }
  | { kind: "offline" };

/**
 * Compass shell — Day 1 surface: is the gateway sidecar up, and which
 * providers have keys? The full mission-control dashboard (routing log,
 * live requests, preference sliders) builds on top of this in Days 2–3.
 */
export default function App() {
  const [gateway, setGateway] = useState<GatewayState>({ kind: "connecting" });

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`${GATEWAY_URL}/health`);
        const health = (await res.json()) as Health;
        if (!cancelled) setGateway({ kind: "online", health });
      } catch {
        if (!cancelled) setGateway({ kind: "offline" });
      }
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="flex h-screen flex-col bg-base-100 text-base-content">
      <header className="flex items-center gap-3 border-b border-[var(--color-border)] px-5 py-3">
        <Icon icon="uil:compass" className="text-2xl text-primary" />
        <div className="flex-1">
          <h1 className="text-lg font-semibold leading-none">Compass</h1>
          <p className="text-xs text-[var(--color-text-muted)]">Personal AI routing layer</p>
        </div>
        <GatewayBadge state={gateway} />
      </header>

      <main className="flex flex-1 items-center justify-center p-8">
        <div className="card w-full max-w-md border border-[var(--color-border)] bg-base-200">
          <div className="card-body">
            <h2 className="card-title text-base">
              <Icon icon="uil:server" className="text-xl" />
              Gateway
            </h2>

            {gateway.kind === "connecting" ? (
              <p className="text-sm text-[var(--color-text-muted)]">Connecting…</p>
            ) : gateway.kind === "offline" ? (
              <div className="text-sm">
                <p className="text-error">Offline — no gateway on {GATEWAY_URL}</p>
                <p className="mt-1 text-[var(--color-text-muted)]">
                  Start it with <span className="code">cd gateway && npm run dev</span> or relaunch
                  the app.
                </p>
              </div>
            ) : (
              <ul className="mt-1 flex flex-col gap-2">
                {gateway.health.providers.map((p) => (
                  <li key={p.name} className="flex items-center justify-between text-sm">
                    <span className="capitalize">{p.name}</span>
                    {p.key_configured ? (
                      <span className="badge badge-success badge-sm gap-1">
                        <Icon icon="uil:check" /> key configured
                      </span>
                    ) : (
                      <span className="badge badge-ghost badge-sm gap-1">
                        <Icon icon="uil:key-skeleton" /> no key
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function GatewayBadge({ state }: { state: GatewayState }) {
  if (state.kind === "online") {
    return (
      <span className="badge badge-success gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full bg-current" /> gateway online
      </span>
    );
  }
  if (state.kind === "offline") {
    return (
      <span className="badge badge-error gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full bg-current" /> gateway offline
      </span>
    );
  }
  return <span className="badge badge-ghost">connecting…</span>;
}

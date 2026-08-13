import { Icon } from "@iconify/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { Chat } from "./components/Chat";
import { Configuration } from "./components/Configuration";
import { HelpModal } from "./components/HelpModal";
import { NotificationBell } from "./components/NotificationBell";
import { RoutingLog } from "./components/RoutingLog";
import { fetchHealth } from "./lib/gateway";
import { applyTheme, getTheme, type Theme } from "./lib/theme";

type GatewayState = "connecting" | "online" | "offline";

// Tauri v2 injects this; absent in the plain browser dashboard.
const IN_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export default function App() {
  const [gateway, setGateway] = useState<GatewayState>("connecting");
  const [chatOpen, setChatOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => getTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Poll gateway liveness.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        await fetchHealth();
        if (!cancelled) setGateway("online");
      } catch {
        if (!cancelled) setGateway("offline");
      }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Native menu → Help / Settings (only fires under Tauri).
  useEffect(() => {
    if (!IN_TAURI) return;
    const uns = [
      listen("show-help", () => setShowHelp(true)),
      listen("open-settings", () => setChatOpen(false)),
    ];
    return () => {
      Promise.all(uns).then((fns) => {
        for (const f of fns) f();
      });
    };
  }, []);

  const toggleGateway = async () => {
    if (!IN_TAURI) return;
    setToggling(true);
    try {
      if (gateway === "online") await invoke("gateway_stop");
      else await invoke("gateway_start");
    } catch {
      /* ignore */
    }
    setToggling(false);
  };

  const online = gateway === "online";

  return (
    <div className="flex h-screen flex-col bg-base-100 text-base-content">
      <header className="flex items-center gap-2 border-b border-[var(--color-border)] px-5 py-3">
        <Icon icon="uil:compass" className="text-2xl text-primary" />

        <span className="flex-1" />

        <button
          type="button"
          className={`btn btn-sm gap-1.5 ${chatOpen ? "btn-primary" : "btn-ghost"}`}
          aria-label="Toggle chat"
          aria-pressed={chatOpen}
          onClick={() => setChatOpen((v) => !v)}
        >
          <Icon icon="uil:comments" className="text-lg" /> Chat
        </button>

        <NotificationBell online={online} />

        <button
          type="button"
          className="btn btn-ghost btn-sm btn-circle"
          aria-label="Toggle theme"
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        >
          <Icon icon={theme === "dark" ? "uil:sun" : "uil:moon"} className="text-lg" />
        </button>

        <GatewayBadge
          state={gateway}
          interactive={IN_TAURI}
          busy={toggling}
          onClick={IN_TAURI ? () => void toggleGateway() : undefined}
        />
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="flex flex-col gap-4">
            <Configuration online={online} />
            <RoutingLog />
          </div>
        </main>

        {chatOpen ? (
          <aside className="flex w-[400px] shrink-0 flex-col border-l border-[var(--color-border)]">
            <Chat onClose={() => setChatOpen(false)} />
          </aside>
        ) : null}
      </div>

      {showHelp ? <HelpModal onClose={() => setShowHelp(false)} /> : null}
    </div>
  );
}

function GatewayBadge({
  state,
  interactive = false,
  busy = false,
  onClick,
}: {
  state: GatewayState;
  interactive?: boolean;
  busy?: boolean;
  onClick?: () => void;
}) {
  const dot =
    state === "online" ? (
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-current" />
    ) : state === "offline" ? (
      <span className="inline-block h-2 w-2 rounded-full bg-current" />
    ) : (
      <span className="loading loading-spinner loading-xs" />
    );

  const label =
    state === "online" ? "gateway online" : state === "offline" ? "gateway offline" : "connecting…";
  const tone =
    state === "online" ? "badge-success" : state === "offline" ? "badge-error" : "badge-ghost";

  if (!interactive) {
    return (
      <span className={`badge ${tone} gap-1.5`}>
        {dot} {label}
      </span>
    );
  }

  // Native app: the badge *is* the on/off switch. Click starts/stops the gateway.
  const title = state === "online" ? "Click to stop the gateway" : "Click to start the gateway";
  return (
    <button
      type="button"
      className={`badge ${tone} gap-1.5 border-0 ${busy ? "opacity-60" : "cursor-pointer hover:brightness-110"}`}
      disabled={busy || state === "connecting"}
      onClick={onClick}
      aria-label={state === "online" ? "Stop gateway" : "Start gateway"}
      title={title}
    >
      {busy ? <span className="loading loading-spinner loading-xs" /> : dot} {label}
    </button>
  );
}

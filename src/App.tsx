import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Icon } from "@iconify/react";
import { useEffect, useState } from "react";
import { Chat } from "./components/Chat";
import { Configuration } from "./components/Configuration";
import { HelpModal } from "./components/HelpModal";
import { NotificationBell } from "./components/NotificationBell";
import { RoutingLog } from "./components/RoutingLog";
import { fetchHealth } from "./lib/gateway";
import { applyTheme, getTheme, type Theme } from "./lib/theme";

type GatewayState = "connecting" | "online" | "offline";
type Tab = "chat" | "dashboard";

// Tauri v2 injects this; absent in the plain browser dashboard.
const IN_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export default function App() {
  const [gateway, setGateway] = useState<GatewayState>("connecting");
  const [tab, setTab] = useState<Tab>("dashboard");
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
      listen("open-settings", () => setTab("dashboard")),
    ];
    return () => {
      Promise.all(uns).then((fns) => fns.forEach((f) => f()));
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
      <header className="flex items-center gap-3 border-b border-[var(--color-border)] px-5 py-3">
        <Icon icon="uil:compass" className="text-2xl text-primary" />
        <div className="flex-1">
          <h1 className="text-lg font-semibold leading-none">Compass</h1>
          <p className="text-xs text-[var(--color-text-muted)]">Personal AI routing layer</p>
        </div>

        <NotificationBell online={online} />

        <button
          type="button"
          className="btn btn-ghost btn-sm btn-circle"
          aria-label="Toggle theme"
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        >
          <Icon icon={theme === "dark" ? "uil:sun" : "uil:moon"} className="text-lg" />
        </button>

        <button
          type="button"
          className="btn btn-ghost btn-sm btn-circle"
          aria-label="Help"
          onClick={() => setShowHelp(true)}
        >
          <Icon icon="uil:question-circle" className="text-lg" />
        </button>

        {IN_TAURI ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={toggling || gateway === "connecting"}
            onClick={() => void toggleGateway()}
            aria-label={online ? "Stop gateway" : "Start gateway"}
          >
            <Icon icon={online ? "uil:pause" : "uil:play"} />
            {online ? "Stop" : "Start"}
          </button>
        ) : null}

        <GatewayBadge state={gateway} />
      </header>

      <div className="border-b border-[var(--color-border)] px-5">
        <div role="tablist" className="tabs tabs-bordered">
          <button
            type="button"
            role="tab"
            className={`tab ${tab === "dashboard" ? "tab-active" : ""}`}
            onClick={() => setTab("dashboard")}
          >
            <Icon icon="uil:dashboard" className="mr-1" /> Dashboard
          </button>
          <button
            type="button"
            role="tab"
            className={`tab ${tab === "chat" ? "tab-active" : ""}`}
            onClick={() => setTab("chat")}
          >
            <Icon icon="uil:comments" className="mr-1" /> Chat
          </button>
        </div>
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto p-6">
        {tab === "dashboard" ? (
          <div className="flex flex-col gap-4">
            <Configuration online={online} />
            <RoutingLog />
          </div>
        ) : (
          <div className="h-full">
            <Chat />
          </div>
        )}
      </main>

      {showHelp ? <HelpModal onClose={() => setShowHelp(false)} /> : null}
    </div>
  );
}

function GatewayBadge({ state }: { state: GatewayState }) {
  if (state === "online") {
    return (
      <span className="badge badge-success gap-1.5">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-current" /> gateway online
      </span>
    );
  }
  if (state === "offline") {
    return (
      <span className="badge badge-error gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full bg-current" /> gateway offline
      </span>
    );
  }
  return <span className="badge badge-ghost">connecting…</span>;
}

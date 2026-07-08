import { Icon } from "@iconify/react";
import { useEffect, useState } from "react";
import { fetchRoutingLog, type RoutingLogEntry } from "../lib/gateway";

/**
 * Routing Log — persistent history of every routed request: what came in,
 * where it went, why, and what it cost. Rows expand to show the full
 * explanation trail (Compass explainability, Day 2).
 */
export function RoutingLog() {
  const [entries, setEntries] = useState<RoutingLogEntry[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const log = await fetchRoutingLog(50);
        if (!cancelled) setEntries(log);
      } catch {
        if (!cancelled) setEntries(null);
      }
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="card border border-[var(--color-border)] bg-base-200">
      <div className="card-body">
        <h2 className="card-title text-base">
          <Icon icon="uil:list-ul" className="text-xl" />
          Routing Log
          {entries !== null ? (
            <span className="badge badge-ghost badge-sm">{entries.length}</span>
          ) : null}
        </h2>

        {entries === null ? (
          <p className="text-sm text-[var(--color-text-muted)]">Gateway offline — no log.</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            No requests routed yet. Point a client at the gateway and they'll appear here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr className="text-[var(--color-text-muted)]">
                  <th>time</th>
                  <th>intent</th>
                  <th>routed to</th>
                  <th>status</th>
                  <th className="text-right">latency</th>
                  <th className="text-right">cost</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <LogRow
                    key={e.id}
                    entry={e}
                    expanded={expanded === e.id}
                    onToggle={() => setExpanded(expanded === e.id ? null : e.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function LogRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: RoutingLogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const time = new Date(entry.ts).toLocaleTimeString();
  return (
    <>
      <tr className="cursor-pointer hover:bg-base-300/40" onClick={onToggle}>
        <td className="whitespace-nowrap text-[var(--color-text-muted)]">{time}</td>
        <td>
          <span className="badge badge-outline badge-sm whitespace-nowrap">{entry.intent}</span>
        </td>
        <td className="whitespace-nowrap">
          <span className="text-[var(--color-text-muted)]">{entry.provider}/</span>
          {entry.model}
        </td>
        <td>
          {entry.status === "ok" ? (
            <span className="badge badge-success badge-sm">ok</span>
          ) : (
            <span className="badge badge-error badge-sm">error</span>
          )}
        </td>
        <td className="text-right tabular-nums">{entry.latency_ms} ms</td>
        <td className="text-right tabular-nums">
          {entry.cost_usd !== null ? `$${entry.cost_usd.toFixed(4)}` : "—"}
        </td>
        <td className="text-[var(--color-text-muted)]">
          <Icon icon={expanded ? "uil:angle-up" : "uil:angle-down"} />
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={7} className="bg-base-300/20">
            <div className="flex flex-col gap-2 p-2 text-sm">
              <div>
                <span className="font-semibold">Why:</span>
                <ul className="mt-1 list-disc pl-5 text-[var(--color-text-muted)]">
                  {entry.reason.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-[var(--color-text-muted)]">
                <span>
                  rule <span className="code">{entry.rule}</span>
                </span>
                <span>
                  tokens{" "}
                  {entry.input_tokens !== null
                    ? `${entry.input_tokens} in / ${entry.output_tokens} out`
                    : "—"}
                </span>
                {entry.git ? (
                  <span>
                    git {entry.git.branch} · {entry.git.changed_files} files (+
                    {entry.git.insertions}/-{entry.git.deletions})
                  </span>
                ) : null}
                {entry.stream ? <span>streamed</span> : null}
              </div>
              {entry.error ? <p className="text-error">{entry.error}</p> : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

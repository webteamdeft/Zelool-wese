import { useEffect } from "react";
import { Link, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { startSync } from "../lib/sync.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const url = new URL(request.url);

  const runs = await prisma.syncRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 20,
  });
  const selectedId = url.searchParams.get("run") ?? runs[0]?.id ?? null;
  const logs = selectedId
    ? await prisma.syncLog.findMany({
        where: { runId: selectedId },
        orderBy: { createdAt: "asc" },
        take: 1000,
      })
    : [];

  return { runs, logs, selectedId };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  return startSync({ admin, trigger: "manual" });
};

const TONES = { info: "neutral", warn: "warning", error: "critical" };

export default function SyncPage() {
  const { runs, logs, selectedId } = useLoaderData();
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const latest = runs[0];
  const running = latest?.status === "running";

  // While a run is in progress, refresh the page every few seconds.
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => revalidator.revalidate(), 4000);
    return () => clearInterval(timer);
    // revalidator identity changes on every render; only the running state should restart the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const starting = fetcher.state !== "idle";

  return (
    <s-page heading="Sync & logs">
      <s-button
        slot="primary-action"
        variant="primary"
        {...(starting || running ? { disabled: true } : {})}
        onClick={() => fetcher.submit({}, { method: "POST" })}
      >
        Run sync now
      </s-button>

      {fetcher.data?.alreadyRunning && (
        <s-banner tone="warning">A sync is already running.</s-banner>
      )}
      {fetcher.data?.runId && !fetcher.data?.alreadyRunning && (
        <s-banner tone="success">Sync started. This page updates automatically.</s-banner>
      )}

      <s-section heading="Runs">
        <s-paragraph>
          Scheduled runs call <code>POST /api/sync</code> with the bearer token in{" "}
          <code>SYNC_TOKEN</code>. Schedule that call with any cron service.
        </s-paragraph>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ padding: 8 }}>Started</th>
                <th style={{ padding: 8 }}>Trigger</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8 }}>Created</th>
                <th style={{ padding: 8 }}>Updated</th>
                <th style={{ padding: 8 }}>Skipped</th>
                <th style={{ padding: 8 }}>Failed</th>
                <th style={{ padding: 8 }}></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} style={{ borderTop: "1px solid #e1e3e5" }}>
                  <td style={{ padding: 8 }}>{new Date(run.startedAt).toLocaleString()}</td>
                  <td style={{ padding: 8 }}>{run.trigger}</td>
                  <td style={{ padding: 8 }}>
                    <s-badge
                      tone={
                        run.status === "completed"
                          ? "success"
                          : run.status === "running"
                            ? "info"
                            : run.status === "failed"
                              ? "critical"
                              : "warning"
                      }
                    >
                      {run.status.replace(/_/g, " ")}
                    </s-badge>
                  </td>
                  <td style={{ padding: 8 }}>{run.created}</td>
                  <td style={{ padding: 8 }}>{run.updated}</td>
                  <td style={{ padding: 8 }}>{run.skipped}</td>
                  <td style={{ padding: 8 }}>{run.failed}</td>
                  <td style={{ padding: 8 }}>
                    <Link to={`/app/sync?run=${run.id}`}>View logs</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {runs.length === 0 && <s-paragraph>No sync runs yet.</s-paragraph>}
        </div>
      </s-section>

      <s-section heading={selectedId ? "Logs for selected run" : "Logs"}>
        <div style={{ maxHeight: 520, overflowY: "auto", fontSize: 13 }}>
          {logs.map((entry) => (
            <div
              key={entry.id}
              style={{ padding: "6px 0", borderTop: "1px solid #f1f2f3", display: "flex", gap: 8 }}
            >
              <span style={{ color: "#6d7175", whiteSpace: "nowrap" }}>
                {new Date(entry.createdAt).toLocaleTimeString()}
              </span>
              <s-badge tone={TONES[entry.level] ?? "neutral"}>{entry.level}</s-badge>
              {entry.sku && <span style={{ fontFamily: "monospace" }}>{entry.sku}</span>}
              <span>{entry.message}</span>
            </div>
          ))}
          {selectedId && logs.length === 0 && <s-paragraph>No log entries.</s-paragraph>}
        </div>
      </s-section>
    </s-page>
  );
}

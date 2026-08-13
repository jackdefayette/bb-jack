import { useCallback, useEffect, useState } from "react";
import { definePluginApp, useRpc } from "@bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import type { computerUseRpcContract } from "./server.js";

interface HostStatus {
  hostId: string;
  hostName: string;
  connected: boolean;
  permissions: unknown;
  error: string | null;
}

function permission(value: unknown, key: string): boolean | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "boolean" ? candidate : null;
}

function PermissionBadge({
  label,
  value,
}: {
  label: string;
  value: boolean | null;
}) {
  return (
    <span
      className={
        value === true
          ? "rounded-full bg-emerald-500/15 px-2 py-1 text-xs text-emerald-700 dark:text-emerald-300"
          : "rounded-full bg-amber-500/15 px-2 py-1 text-xs text-amber-700 dark:text-amber-300"
      }
    >
      {label}:{" "}
      {value === true ? "Ready" : value === false ? "Required" : "Unknown"}
    </span>
  );
}

function ComputerUsePanel() {
  const rpc = useRpc<typeof computerUseRpcContract>();
  const [hosts, setHosts] = useState<HostStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await rpc.call("status", null);
      setHosts(result.hosts);
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : String(refreshError),
      );
    } finally {
      setLoading(false);
    }
  }, [rpc]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <main
      className="h-full overflow-y-auto p-6"
      aria-label="Computer Use status"
    >
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Computer Use
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Provider-independent desktop control through the open-source CUA
              Driver.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={loading}
          >
            {loading ? "Checking…" : "Refresh"}
          </Button>
        </div>

        <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm">
          Type{" "}
          <code className="rounded bg-muted px-1.5 py-0.5">/computer-use</code>{" "}
          in a four-pane Build or Agent composer to activate the inspect → act →
          verify workflow.
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {!loading && hosts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No enrolled hosts found.
          </p>
        ) : null}

        <div className="space-y-3">
          {hosts.map((host) => (
            <section
              key={host.hostId}
              className="rounded-lg border border-border bg-background p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-medium text-foreground">
                    {host.hostName}
                  </h3>
                  <p className="text-xs text-muted-foreground">{host.hostId}</p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {host.connected ? "Connected" : "Disconnected"}
                </span>
              </div>
              {host.error ? (
                <p className="mt-3 text-sm text-destructive">{host.error}</p>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <PermissionBadge
                    label="Accessibility"
                    value={permission(host.permissions, "accessibility")}
                  />
                  <PermissionBadge
                    label="Screen recording"
                    value={permission(host.permissions, "screen_recording")}
                  />
                </div>
              )}
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "computer-use",
    title: "Computer Use",
    icon: "MousePointerClick",
    path: "computer-use",
    component: ComputerUsePanel,
  });
});

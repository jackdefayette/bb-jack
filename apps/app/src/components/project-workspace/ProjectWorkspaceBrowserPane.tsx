import { useCallback, useEffect, useLayoutEffect, useMemo } from "react";
import type { BrowserFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { createBrowserFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { BrowserTabDeck } from "@/components/secondary-panel/BrowserTabDeck";
import type { UpdateBrowserTabArgs } from "@/components/secondary-panel/useThreadFileTabs";
import { dispatchBrowserViewBoundsSync } from "@/lib/browser-view-bounds-sync";
import type { ProjectWorkspaceTab } from "./ProjectWorkspaceTabsProvider";
import type { ProjectWorkspaceTabUpdate } from "./ProjectWorkspaceTabsProvider";
import { ProjectWorkspacePaneFrame } from "./ProjectWorkspacePaneFrame";

interface ProjectWorkspaceBrowserPaneProps {
  backgroundAgentState: "attention" | "running" | null;
  canShowNativeBrowserView: boolean;
  environmentId: string | null;
  isFocused: boolean;
  onToggleFocus: () => void;
  tab: ProjectWorkspaceTab;
  updateTab: (id: string, patch: ProjectWorkspaceTabUpdate) => void;
}

function readBrowserTab(tab: ProjectWorkspaceTab): BrowserFixedPanelTab | null {
  return tab.browserTab;
}

/**
 * A dedicated browser surface whose native WebContentsView remains attached
 * while the workspace changes focus. Visibility is gated separately so a
 * hidden native overlay can never cover the focused agent.
 */
export function ProjectWorkspaceBrowserPane({
  backgroundAgentState,
  canShowNativeBrowserView,
  environmentId,
  isFocused,
  onToggleFocus,
  tab,
  updateTab,
}: ProjectWorkspaceBrowserPaneProps) {
  const persistedBrowserTab = readBrowserTab(tab);
  const browserTab = useMemo(
    () =>
      persistedBrowserTab ??
      createBrowserFixedPanelTab({ environmentId, url: "" }),
    [environmentId, persistedBrowserTab],
  );

  useEffect(() => {
    if (persistedBrowserTab !== null) return;
    updateTab(tab.id, { browserTab });
  }, [browserTab, persistedBrowserTab, tab.id, updateTab]);

  const handleUpdate = useCallback(
    (args: UpdateBrowserTabArgs) => {
      if (args.tabId !== browserTab.id) return;
      updateTab(tab.id, {
        browserTab: {
          ...browserTab,
          title: args.title,
          url: args.url,
        },
      });
    },
    [browserTab, tab.id, updateTab],
  );

  useLayoutEffect(() => {
    if (!canShowNativeBrowserView) return;
    dispatchBrowserViewBoundsSync();
    const frame = window.requestAnimationFrame(dispatchBrowserViewBoundsSync);
    return () => window.cancelAnimationFrame(frame);
  }, [canShowNativeBrowserView, isFocused]);

  return (
    <ProjectWorkspacePaneFrame
      title="Browser"
      icon="Globe"
      actionLabel={isFocused ? "Restore four quadrants" : "Focus browser"}
      headerAccessory={
        backgroundAgentState ? (
          <span
            className={
              backgroundAgentState === "attention"
                ? "rounded-full bg-warning/15 px-2 py-0.5 text-2xs font-medium text-warning-foreground"
                : "rounded-full bg-accent px-2 py-0.5 text-2xs font-medium text-muted-foreground"
            }
            role="status"
          >
            {backgroundAgentState === "attention"
              ? "Agent needs attention"
              : "Agent running"}
          </span>
        ) : null
      }
      onHeaderDoubleClick={onToggleFocus}
      onToggleFocus={onToggleFocus}
    >
      <BrowserTabDeck
        browserTabs={[browserTab]}
        activeBrowserTabId={browserTab.id}
        environmentId={browserTab.environmentId}
        canShowNativeBrowserView={canShowNativeBrowserView}
        threadId={`project-workspace:${tab.id}`}
        onUpdate={handleUpdate}
      />
    </ProjectWorkspacePaneFrame>
  );
}

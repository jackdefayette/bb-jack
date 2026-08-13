import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useProjectWorkspaceTabs } from "@/components/project-workspace/ProjectWorkspaceTabsProvider";
import { PageShell } from "@/components/ui/page-shell.js";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import {
  APP_ROOT_ROUTE_PATH,
  getProjectWorkspaceRoutePath,
} from "@/lib/route-paths";

/** Redirect the app root into Jack's persistent four-pane project workspace. */
export function JacksIdeWorkspaceHome() {
  const navigate = useNavigate();
  const navigation = useSidebarNavigation();
  const { tabs, activeTabId, openTab, selectTab } = useProjectWorkspaceTabs();

  useEffect(() => {
    const existingTab =
      tabs.find((tab) => tab.id === activeTabId) ?? tabs.at(-1) ?? null;
    if (existingTab) {
      void navigate(
        getProjectWorkspaceRoutePath({
          projectId: existingTab.projectId,
          workspaceTabId: existingTab.id,
        }),
        { replace: true },
      );
      selectTab(existingTab.id);
      return;
    }

    const firstProject = navigation.data?.projects[0];
    if (!firstProject) return;
    const tab = openTab({
      projectId: firstProject.id,
      projectName: firstProject.name,
    });
    void navigate(
      getProjectWorkspaceRoutePath({
        projectId: tab.projectId,
        workspaceTabId: tab.id,
      }),
      { replace: true },
    );
    selectTab(tab.id);
  }, [
    activeTabId,
    navigate,
    navigation.data?.projects,
    openTab,
    selectTab,
    tabs,
  ]);

  const hasProjects = (navigation.data?.projects.length ?? 0) > 0;
  return (
    <PageShell contentClassName="min-h-full items-center justify-center">
      <p className="py-12 text-center text-sm text-muted-foreground">
        {navigation.isLoading || hasProjects
          ? "Opening Jack's IDE workspace…"
          : "Add a project from the sidebar to open Jack's IDE."}
      </p>
    </PageShell>
  );
}

interface JacksIdeThreadWorkspaceProps {
  projectId: string;
  threadId: string;
}

/** Redirect an ordinary project task into that project's Build quadrant. */
export function JacksIdeThreadWorkspace({
  projectId,
  threadId,
}: JacksIdeThreadWorkspaceProps) {
  const navigate = useNavigate();
  const navigation = useSidebarNavigation();
  const { tabs, activeTabId, openTab, selectTab, updateTab } =
    useProjectWorkspaceTabs();

  useEffect(() => {
    const project = navigation.data?.projects.find(
      (candidate) => candidate.id === projectId,
    );
    if (!project) {
      if (!navigation.isLoading) {
        void navigate(APP_ROOT_ROUTE_PATH, { replace: true });
      }
      return;
    }
    const existingTab =
      tabs.find(
        (tab) => tab.id === activeTabId && tab.projectId === projectId,
      ) ??
      tabs.find((tab) => tab.projectId === projectId) ??
      null;
    const tab =
      existingTab ??
      openTab({
        projectId,
        projectName: project.name,
        primaryThreadId: threadId,
      });
    if (tab.primaryThreadId !== threadId) {
      updateTab(tab.id, { primaryThreadId: threadId });
    }
    void navigate(
      getProjectWorkspaceRoutePath({
        projectId: tab.projectId,
        workspaceTabId: tab.id,
      }),
      { replace: true },
    );
    selectTab(tab.id);
  }, [
    activeTabId,
    navigate,
    navigation.data?.projects,
    navigation.isLoading,
    openTab,
    projectId,
    selectTab,
    tabs,
    threadId,
    updateTab,
  ]);

  return (
    <PageShell contentClassName="min-h-full items-center justify-center">
      <p className="py-12 text-center text-sm text-muted-foreground">
        Opening thread in Jack's IDE…
      </p>
    </PageShell>
  );
}

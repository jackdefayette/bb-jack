import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@bb/shared-ui/context-menu";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { getProjectWorkspaceRoutePath } from "@/lib/route-paths";
import { useProjectWorkspaceTabs } from "@/components/project-workspace/ProjectWorkspaceTabsProvider";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "@/components/ui/sidebar";
import { TopLevelSidebarSection } from "./TopLevelSidebarSection";
import { SidebarThreadSearchPanel } from "./SidebarThreadSearchPanel";
import type { SidebarThreadSearchPanelController } from "./sidebarThreadSearch";
import { SIDEBAR_ROW_SELECTED_STATE_CLASS } from "./sidebarRowClasses";

interface ProjectsOnlySidebarProps {
  onNavigate?: () => void;
  onNewProject?: () => void;
  threadSearch?: SidebarThreadSearchPanelController;
}

export function ProjectsOnlySidebar({
  onNavigate,
  onNewProject,
  threadSearch,
}: ProjectsOnlySidebarProps) {
  const navigate = useNavigate();
  const navigation = useSidebarNavigation();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { tabs, activeTabId, createTab, openTab, selectTab } =
    useProjectWorkspaceTabs();
  const projectNamesById = useMemo(() => {
    const names = new Map<string, string>();
    if (navigation.data) {
      names.set(
        navigation.data.personalProject.id,
        navigation.data.personalProject.name,
      );
      for (const project of navigation.data.projects) {
        names.set(project.id, project.name);
      }
    }
    return names;
  }, [navigation.data]);
  const sectionNamesById = useMemo(
    () =>
      new Map(
        navigation.data?.sections.map((section) => [
          section.id,
          section.name,
        ]) ?? [],
      ),
    [navigation.data?.sections],
  );
  const recentThreads = useMemo(
    () =>
      navigation.data
        ? [
            ...navigation.data.personalProject.threads,
            ...navigation.data.projects.flatMap((project) => project.threads),
          ].sort((left, right) => right.updatedAt - left.updatedAt)
        : [],
    [navigation.data],
  );

  const navigateToTab = useCallback(
    (tabId: string, projectId: string) => {
      selectTab(tabId);
      onNavigate?.();
      void navigate(
        getProjectWorkspaceRoutePath({ projectId, workspaceTabId: tabId }),
      );
    },
    [navigate, onNavigate, selectTab],
  );

  const createProjectTab = useCallback(
    (projectId: string, projectName: string) => {
      const tab = createTab({ projectId, projectName });
      navigateToTab(tab.id, tab.projectId);
    },
    [createTab, navigateToTab],
  );

  const activateProject = useCallback(
    (projectId: string, projectName: string) => {
      const currentTab = tabs.find(
        (tab) => tab.id === activeTabId && tab.projectId === projectId,
      );
      const existingTab =
        currentTab ?? tabs.find((tab) => tab.projectId === projectId);
      if (existingTab) {
        navigateToTab(existingTab.id, existingTab.projectId);
        return;
      }
      const tab = openTab({ projectId, projectName });
      navigateToTab(tab.id, tab.projectId);
    },
    [activeTabId, navigateToTab, openTab, tabs],
  );

  const newProjectAction = onNewProject ? (
    <button
      type="button"
      aria-label="Add project"
      className="inline-flex size-6 items-center justify-center rounded-md text-subtle-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      onClick={onNewProject}
    >
      <Icon name="Plus" className="size-3.5" aria-hidden="true" />
    </button>
  ) : undefined;

  return (
    <div className="px-2 py-1">
      {threadSearch?.isActive ? (
        <SidebarThreadSearchPanel
          activeIndex={threadSearch.activeIndex}
          sectionNamesById={sectionNamesById}
          isRecentsLoading={navigation.isLoading}
          onActiveIndexChange={threadSearch.onActiveIndexChange}
          onNavigationItemsChange={threadSearch.onNavigationItemsChange}
          onSelect={threadSearch.onSelectItem}
          projectNamesById={projectNamesById}
          query={threadSearch.query}
          recentThreads={recentThreads}
          showSectionLabels
        />
      ) : (
        <TopLevelSidebarSection
          label="Projects"
          actions={newProjectAction}
          collapseControl={{
            isCollapsed,
            onToggleCollapsed: () => setIsCollapsed((current) => !current),
          }}
        >
          <SidebarMenu className="gap-0.5">
            {navigation.isLoading ? (
              <>
                <SidebarMenuSkeleton />
                <SidebarMenuSkeleton />
              </>
            ) : navigation.isError ? (
              <SidebarMenuItem className="px-2 py-1.5 text-xs text-muted-foreground">
                Projects unavailable
              </SidebarMenuItem>
            ) : navigation.data?.projects.length ? (
              navigation.data.projects.map((project) => {
                const isActive = tabs.some(
                  (tab) =>
                    tab.id === activeTabId && tab.projectId === project.id,
                );
                return (
                  <SidebarMenuItem key={project.id}>
                    <ContextMenu>
                      <ContextMenuTrigger asChild>
                        <SidebarMenuButton
                          type="button"
                          aria-current={isActive ? "page" : undefined}
                          tooltip={project.name}
                          className={cn(
                            "gap-2 text-sidebar-foreground/85",
                            isActive && SIDEBAR_ROW_SELECTED_STATE_CLASS,
                          )}
                          onClick={() =>
                            activateProject(project.id, project.name)
                          }
                        >
                          <Icon
                            name="Folder"
                            className="size-3.5 shrink-0 text-subtle-foreground"
                            aria-hidden="true"
                          />
                          <span className="truncate">{project.name}</span>
                        </SidebarMenuButton>
                      </ContextMenuTrigger>
                      <ContextMenuContent
                        aria-label={`${project.name} actions`}
                      >
                        <ContextMenuItem
                          onSelect={() =>
                            createProjectTab(project.id, project.name)
                          }
                        >
                          <Icon name="Plus" aria-hidden="true" />
                          Create tab
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  </SidebarMenuItem>
                );
              })
            ) : (
              <SidebarMenuItem className="px-2 py-1.5 text-xs text-muted-foreground">
                No projects
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </TopLevelSidebarSection>
      )}
    </div>
  );
}

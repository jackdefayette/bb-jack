import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import type { ReactNode } from "react";

interface ProjectWorkspacePaneFrameProps {
  actionLabel?: string;
  children: ReactNode;
  className?: string;
  headerAccessory?: ReactNode;
  icon: IconName;
  onActivate?: () => void;
  onHeaderDoubleClick?: () => void;
  onToggleFocus?: () => void;
  title: string;
}

/** Shared, intentionally compact chrome for each fixed workspace quadrant. */
export function ProjectWorkspacePaneFrame({
  actionLabel,
  children,
  className,
  headerAccessory,
  icon,
  onActivate,
  onHeaderDoubleClick,
  onToggleFocus,
  title,
}: ProjectWorkspacePaneFrameProps) {
  return (
    <section
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-canvas",
        className,
      )}
      onPointerDown={onActivate}
      data-project-workspace-pane={title}
    >
      <header
        className="flex h-8 shrink-0 items-center gap-2 border-b border-border/70 bg-sidebar px-2.5"
        onDoubleClick={onHeaderDoubleClick}
      >
        <Icon
          name={icon}
          className="size-3.5 text-muted-foreground"
          aria-hidden
        />
        <h2 className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {title}
        </h2>
        {headerAccessory}
        {onToggleFocus ? (
          <button
            type="button"
            className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={actionLabel}
            onClick={(event) => {
              event.stopPropagation();
              onToggleFocus();
            }}
          >
            <Icon
              name={
                actionLabel?.startsWith("Restore") ? "Minimize2" : "Maximize2"
              }
              className="size-3.5"
              aria-hidden
            />
          </button>
        ) : null}
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

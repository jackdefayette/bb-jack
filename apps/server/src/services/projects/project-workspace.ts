import { createHash } from "node:crypto";
import { getProjectSourceByHost } from "@bb/db";
import type { ProjectWorkspaceRoutingQuery } from "@bb/server-contract";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import {
  assertUsableHostId,
  requirePrimaryHostId,
} from "../hosts/primary-host.js";
import {
  requireEnvironment,
  requireReadyEnvironment,
} from "../lib/entity-lookup.js";
import {
  requireWorkspaceCommandTarget,
  workspaceContextFromPath,
  type WorkspaceCommandTarget,
} from "../environments/workspace-command-target.js";

export interface ProjectWorkspaceTarget {
  hostId: string;
  path: string;
}

function projectSourceRuntimeId(args: {
  hostId: string;
  path: string;
  projectId: string;
}): string {
  const digest = createHash("sha256")
    .update(args.projectId)
    .update("\0")
    .update(args.hostId)
    .update("\0")
    .update(args.path)
    .digest("hex")
    .slice(0, 16);
  return `project-source:${args.projectId}:${args.hostId}:${digest}`;
}

interface ResolveProjectWorkspaceArgs extends ProjectWorkspaceRoutingQuery {
  projectId: string;
}

function requireProjectEnvironment(
  deps: Pick<AppDeps, "db">,
  args: { environmentId: string; projectId: string; ready: boolean },
) {
  const environment = args.ready
    ? requireReadyEnvironment(deps.db, args.environmentId)
    : requireEnvironment(deps.db, args.environmentId);
  if (environment.projectId !== args.projectId) {
    throw new ApiError(404, "environment_not_found", "Environment not found");
  }
  return environment;
}

function resolveProjectSourceOnHost(
  deps: Pick<AppDeps, "db">,
  args: { hostId: string; projectId: string },
): ProjectWorkspaceTarget | null {
  const source = getProjectSourceByHost(deps.db, args.projectId, args.hostId);
  if (!source || source.type !== "local_path") {
    return null;
  }
  return { hostId: source.hostId, path: source.path };
}

/**
 * Resolve a concrete project workspace for files, paths, and file content.
 * An environment selects its own host and workspace path; otherwise an
 * explicit host selects that host's project source; omission intentionally
 * falls back to the primary host's project source.
 */
export function resolveProjectWorkspaceTarget(
  deps: Pick<AppDeps, "config" | "db" | "hub">,
  args: ResolveProjectWorkspaceArgs,
): ProjectWorkspaceTarget {
  if (args.environmentId !== undefined) {
    const environment = requireProjectEnvironment(deps, {
      environmentId: args.environmentId,
      projectId: args.projectId,
      ready: true,
    });
    assertUsableHostId(deps, { hostId: environment.hostId });
    if (environment.path === null) {
      throw new ApiError(
        409,
        "environment_not_ready",
        "Environment workspace is not ready",
      );
    }
    return { hostId: environment.hostId, path: environment.path };
  }

  const hostId = args.hostId ?? requirePrimaryHostId(deps);
  assertUsableHostId(deps, { hostId });
  const source = resolveProjectSourceOnHost(deps, {
    hostId,
    projectId: args.projectId,
  });
  if (source) {
    return source;
  }
  throw new ApiError(
    args.hostId !== undefined ? 404 : 409,
    "invalid_request",
    args.hostId !== undefined
      ? "Project has no local-path source for host"
      : "Project has no local-path source for the primary host",
  );
}

/**
 * Resolve status against the exact selected project workspace. A configured
 * project checkout uses a synthetic identity because workspace.status needs an
 * execution lane key, while its path remains the authoritative project source.
 */
export function resolveProjectWorkspaceStatusTarget(
  deps: Pick<AppDeps, "config" | "db" | "hub">,
  args: ResolveProjectWorkspaceArgs,
): WorkspaceCommandTarget {
  if (args.environmentId !== undefined) {
    const environment = requireProjectEnvironment(deps, {
      environmentId: args.environmentId,
      projectId: args.projectId,
      ready: true,
    });
    assertUsableHostId(deps, { hostId: environment.hostId });
    return requireWorkspaceCommandTarget(environment);
  }

  const source = resolveProjectWorkspaceTarget(deps, args);
  return {
    environmentId: projectSourceRuntimeId({
      projectId: args.projectId,
      hostId: source.hostId,
      path: source.path,
    }),
    hostId: source.hostId,
    workspaceContext: workspaceContextFromPath({
      path: source.path,
      workspaceProvisionType: "unmanaged",
    }),
  };
}

export interface ProjectCommandWorkspace {
  hostId: string;
  cwd: string | null;
}

/**
 * Resolve command discovery on the same selected host policy as concrete
 * project workspace reads. Commands may still discover user-home entries when
 * a selected host has no ready workspace, so `cwd` can be null.
 */
export function resolveProjectCommandWorkspace(
  deps: Pick<AppDeps, "config" | "db" | "hub">,
  args: ResolveProjectWorkspaceArgs,
): ProjectCommandWorkspace {
  if (args.environmentId !== undefined) {
    const environment = requireProjectEnvironment(deps, {
      environmentId: args.environmentId,
      projectId: args.projectId,
      ready: false,
    });
    assertUsableHostId(deps, { hostId: environment.hostId });
    if (environment.status === "ready" && environment.path !== null) {
      return { hostId: environment.hostId, cwd: environment.path };
    }
    return {
      hostId: environment.hostId,
      cwd:
        resolveProjectSourceOnHost(deps, {
          hostId: environment.hostId,
          projectId: args.projectId,
        })?.path ?? null,
    };
  }

  const hostId = args.hostId ?? requirePrimaryHostId(deps);
  assertUsableHostId(deps, { hostId });
  return {
    hostId,
    cwd:
      resolveProjectSourceOnHost(deps, {
        hostId,
        projectId: args.projectId,
      })?.path ?? null,
  };
}

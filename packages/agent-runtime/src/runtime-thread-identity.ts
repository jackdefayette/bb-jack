import type { ThreadEvent } from "@bb/domain";
import type { AgentRuntimeProviderSession } from "./types.js";

interface PendingIdentityWaiter {
  resolve: (providerThreadId: string | null) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface RuntimeProviderIdentityState {
  bbThreadIdsByProviderThreadId: Map<string, string>;
  identityWaiters: Map<string, PendingIdentityWaiter>;
  pendingIdentityThreadIds: string[];
  providerId: string;
  threadIds: Set<string>;
}

export interface CreateRuntimeProviderIdentityStateArgs {
  providerId: string;
}

export interface RegisterThreadProviderArgs {
  providerId: string;
  providerState: RuntimeProviderIdentityState;
  shouldWaitForProviderIdentity: boolean;
  threadId: string;
}

export interface RecordProviderThreadIdentityArgs {
  providerState: RuntimeProviderIdentityState;
  providerThreadId: string;
  threadId: string;
}

export interface ResolveBbThreadIdForProviderThreadArgs {
  providerState: RuntimeProviderIdentityState;
  providerThreadId: string | undefined;
}

export interface WaitForProviderThreadIdentityArgs {
  providerState: RuntimeProviderIdentityState;
  threadId: string;
  timeoutMs: number;
}

export interface ForgetThreadArgs {
  providerState: RuntimeProviderIdentityState;
  threadId: string;
}

export interface ResolveProviderEventThreadIdArgs {
  eventThreadId: string | undefined;
  providerState: RuntimeProviderIdentityState;
  sourceThreadId: string | undefined;
}

export interface StampThreadEventScopeArgs {
  event: ThreadEvent;
  providerThreadId: string | undefined;
  threadId: string;
}

export class RuntimeThreadIdentityRegistry {
  private readonly threadToProvider = new Map<string, string>();
  private readonly threadToProviderThread = new Map<string, string>();

  createProviderState(
    args: CreateRuntimeProviderIdentityStateArgs,
  ): RuntimeProviderIdentityState {
    return {
      bbThreadIdsByProviderThreadId: new Map(),
      identityWaiters: new Map(),
      pendingIdentityThreadIds: [],
      providerId: args.providerId,
      threadIds: new Set(),
    };
  }

  registerThreadProvider(args: RegisterThreadProviderArgs): void {
    this.threadToProvider.set(args.threadId, args.providerId);
    args.providerState.threadIds.add(args.threadId);
    if (args.shouldWaitForProviderIdentity) {
      args.providerState.pendingIdentityThreadIds.push(args.threadId);
    }
  }

  resolveProviderForThread(threadId: string): string {
    const providerId = this.threadToProvider.get(threadId);
    if (!providerId) {
      throw new Error(`No provider associated with thread "${threadId}"`);
    }
    return providerId;
  }

  getProviderThreadId(threadId: string): string | undefined {
    return this.threadToProviderThread.get(threadId);
  }

  getProviderSession(threadId: string): AgentRuntimeProviderSession | null {
    const providerId = this.threadToProvider.get(threadId);
    const providerThreadId = this.threadToProviderThread.get(threadId);
    if (!providerId || !providerThreadId) {
      return null;
    }
    return { providerId, providerThreadId };
  }

  recordProviderThreadIdentity(args: RecordProviderThreadIdentityArgs): void {
    const existingOwner = args.providerState.bbThreadIdsByProviderThreadId.get(
      args.providerThreadId,
    );
    if (existingOwner !== undefined && existingOwner !== args.threadId) {
      throw new Error(
        `Provider thread "${args.providerThreadId}" is already owned by BB thread "${existingOwner}" and cannot be assigned to "${args.threadId}"`,
      );
    }
    const previousProviderThreadId = this.threadToProviderThread.get(
      args.threadId,
    );
    if (previousProviderThreadId !== undefined) {
      args.providerState.bbThreadIdsByProviderThreadId.delete(
        previousProviderThreadId,
      );
    }
    this.threadToProviderThread.set(args.threadId, args.providerThreadId);
    args.providerState.bbThreadIdsByProviderThreadId.set(
      args.providerThreadId,
      args.threadId,
    );
    const waiter = args.providerState.identityWaiters.get(args.threadId);
    if (!waiter) {
      return;
    }
    clearTimeout(waiter.timeout);
    args.providerState.identityWaiters.delete(args.threadId);
    waiter.resolve(args.providerThreadId);
  }

  waitForProviderThreadIdentity(
    args: WaitForProviderThreadIdentityArgs,
  ): Promise<string | null> {
    const existing = this.threadToProviderThread.get(args.threadId);
    if (existing) {
      return Promise.resolve(existing);
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        args.providerState.identityWaiters.delete(args.threadId);
        resolve(null);
      }, args.timeoutMs);
      args.providerState.identityWaiters.set(args.threadId, {
        resolve,
        timeout,
      });
    });
  }

  resolveBbThreadIdForProviderThread(
    args: ResolveBbThreadIdForProviderThreadArgs,
  ): string | undefined {
    if (!args.providerThreadId) {
      return undefined;
    }

    return args.providerState.bbThreadIdsByProviderThreadId.get(
      args.providerThreadId,
    );
  }

  resolveProviderEventThreadId(
    args: ResolveProviderEventThreadIdArgs,
  ): string | undefined {
    if (
      args.sourceThreadId &&
      args.providerState.threadIds.has(args.sourceThreadId)
    ) {
      return args.sourceThreadId;
    }

    if (
      args.eventThreadId &&
      args.providerState.threadIds.has(args.eventThreadId)
    ) {
      return args.eventThreadId;
    }

    const lookupId = args.sourceThreadId || args.eventThreadId;
    if (lookupId) {
      const mappedThreadId =
        args.providerState.bbThreadIdsByProviderThreadId.get(lookupId);
      if (mappedThreadId !== undefined) {
        return mappedThreadId;
      }
    }

    if (args.providerState.threadIds.size === 1) {
      return [...args.providerState.threadIds][0];
    }

    return undefined;
  }

  resolvePendingProviderThreadIdentity(
    providerState: RuntimeProviderIdentityState,
  ): string | undefined {
    return providerState.pendingIdentityThreadIds.shift();
  }

  clearThread(threadId: string): void {
    this.threadToProvider.delete(threadId);
    this.threadToProviderThread.delete(threadId);
  }

  /**
   * Fully detaches one thread from a still-running provider process: clears
   * the identity maps, drops the thread from the provider's bookkeeping, and
   * resolves any pending identity waiter with `null`. Used when a thread ends
   * its residency (stop/archive) while the provider process keeps serving
   * other threads.
   */
  forgetThread(args: ForgetThreadArgs): void {
    args.providerState.threadIds.delete(args.threadId);
    args.providerState.pendingIdentityThreadIds =
      args.providerState.pendingIdentityThreadIds.filter(
        (pendingThreadId) => pendingThreadId !== args.threadId,
      );
    const waiter = args.providerState.identityWaiters.get(args.threadId);
    if (waiter) {
      clearTimeout(waiter.timeout);
      args.providerState.identityWaiters.delete(args.threadId);
      waiter.resolve(null);
    }
    const providerThreadId = this.threadToProviderThread.get(args.threadId);
    if (providerThreadId !== undefined) {
      args.providerState.bbThreadIdsByProviderThreadId.delete(providerThreadId);
    }
    this.clearThread(args.threadId);
  }

  clearProviderState(providerState: RuntimeProviderIdentityState): void {
    providerState.pendingIdentityThreadIds = [];
    for (const threadId of providerState.threadIds) {
      this.clearThread(threadId);
    }
    providerState.bbThreadIdsByProviderThreadId.clear();
    this.resolvePendingIdentityWaiters(providerState);
  }

  resolvePendingIdentityWaiters(
    providerState: RuntimeProviderIdentityState,
  ): void {
    for (const [threadId, waiter] of providerState.identityWaiters) {
      clearTimeout(waiter.timeout);
      providerState.identityWaiters.delete(threadId);
      waiter.resolve(null);
    }
  }
}

export function stampThreadEventScope(
  args: StampThreadEventScopeArgs,
): ThreadEvent {
  if ("providerThreadId" in args.event && args.providerThreadId) {
    return {
      ...args.event,
      providerThreadId: args.providerThreadId,
      threadId: args.threadId,
    };
  }

  return {
    ...args.event,
    threadId: args.threadId,
  };
}

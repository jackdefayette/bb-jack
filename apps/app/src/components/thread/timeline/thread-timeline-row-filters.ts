import type { ThreadTimelineRowFilter } from "./useThreadTimelineController.js";

/**
 * Provisioning transcripts are host diagnostics, not conversation content.
 * Keep them in thread data for diagnostics while removing the raw operation
 * row from user-facing chat timelines.
 */
export const hideProvisioningTimelineRow: ThreadTimelineRowFilter = (row) =>
  !(
    row.kind === "system" &&
    row.systemKind === "operation" &&
    row.operationKind === "thread-provisioning"
  );

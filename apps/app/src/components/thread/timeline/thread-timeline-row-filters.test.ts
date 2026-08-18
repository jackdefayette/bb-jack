import { describe, expect, it } from "vitest";
import { systemRow } from "@/test/fixtures/thread-timeline-rows.js";
import { hideProvisioningTimelineRow } from "./thread-timeline-row-filters.js";

describe("hideProvisioningTimelineRow", () => {
  it("hides only raw thread-provisioning operations", () => {
    expect(
      hideProvisioningTimelineRow(
        systemRow({
          completedAt: null,
          operationKind: "thread-provisioning",
          status: "pending",
        }),
      ),
    ).toBe(false);
    expect(
      hideProvisioningTimelineRow(
        systemRow({ operationKind: "thread-provisioning" }),
      ),
    ).toBe(false);
    expect(
      hideProvisioningTimelineRow(systemRow({ operationKind: "generic" })),
    ).toBe(true);
  });
});

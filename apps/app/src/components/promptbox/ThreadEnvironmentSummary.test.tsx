// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { describe, expect, it, vi } from "vitest";
import { ThreadEnvironmentSummary } from "./ThreadEnvironmentSummary";

describe("ThreadEnvironmentSummary", () => {
  it("shows a human checkout label while retaining the exact branch in secondary detail", () => {
    render(
      <ThreadEnvironmentSummary
        environmentLabel="Worktree"
        environmentCheckout={{
          copyErrorMessage: "Failed to copy branch name",
          copyLabel: "Copy branch name",
          copySuccessMessage: "Branch name copied",
          copyValue: "bb/bbj-7-hi-thr_eni72xgbvu",
          label: "BBJ-7",
          rowLabel: "Branch",
          title: "Copy branch name: bb/bbj-7-hi-thr_eni72xgbvu",
        }}
      />,
    );

    const checkout = screen.getByRole("button", { name: "BBJ-7" });
    expect(checkout.textContent).toBe("BBJ-7");
    expect(checkout.getAttribute("title")).toBe(
      "Copy branch name: bb/bbj-7-hi-thr_eni72xgbvu",
    );
    expect(screen.queryByText("bb/bbj-7-hi-thr_eni72xgbvu")).toBeNull();
  });

  it("explains the create-thread action in a tooltip", async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary
          environmentLabel="Worktree"
          onCreateNewThreadInWorktree={vi.fn()}
        />
      </TooltipProvider>,
    );

    fireEvent.focus(
      screen.getByRole("button", {
        name: "Create new thread in this worktree",
      }),
    );

    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Create new thread in this worktree",
    );
  });
});

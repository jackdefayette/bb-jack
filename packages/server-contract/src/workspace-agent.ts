import {
  permissionModeSchema,
  promptInputSchema,
  reasoningLevelSchema,
  serviceTierSchema,
} from "@bb/domain";
import { z } from "zod";
import {
  createExecutionInputSourcesSchema,
  createThreadEnvironmentArgsSchema,
} from "./api-types.js";

const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export const workspaceAgentRequestSchema = z
  .object({
    projectId: z.string().startsWith("proj_"),
    providerId: z.string().trim().min(1),
    model: z.string().trim().min(1),
    reasoningLevel: reasoningLevelSchema,
    permissionMode: permissionModeSchema,
    serviceTier: serviceTierSchema.optional(),
    executionInputSources: createExecutionInputSourcesSchema,
    environment: createThreadEnvironmentArgsSchema,
    input: z.array(promptInputSchema).min(1),
  })
  .strict();

export type WorkspaceAgentRequest = z.infer<typeof workspaceAgentRequestSchema>;

export const workspaceAgentStartInputSchema = z
  .object({
    workspaceKey: z.string().trim().min(1).max(512),
    bbProjectId: z.string().startsWith("proj_"),
    projectName: z.string().trim().min(1).max(256),
    role: z.enum(["builder", "reviewer"]),
    request: workspaceAgentRequestSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.request.projectId !== value.bbProjectId) {
      context.addIssue({
        code: "custom",
        path: ["request", "projectId"],
        message: "must equal bbProjectId",
      });
    }
  });

export type WorkspaceAgentStartInput = z.infer<
  typeof workspaceAgentStartInputSchema
>;

export const workspaceAgentStartOutputSchema = z
  .object({
    taskId: z.string().regex(ULID_PATTERN, "must be a ULID"),
    taskKey: z.string().min(1),
    threadId: z.string().startsWith("thr_"),
    environmentId: z.string().nullable(),
  })
  .strict();

export type WorkspaceAgentStartOutput = z.infer<
  typeof workspaceAgentStartOutputSchema
>;

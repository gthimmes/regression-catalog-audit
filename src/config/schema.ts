import { z } from "zod";

/**
 * zod schema + inferred types for catalog-audit.yaml.
 *
 * Defaults here mirror the SPEC. Invalid config must surface every violation
 * with its YAML path (see load.ts) and exit 2.
 */

export const areaSchema = z
  .object({
    name: z.string().min(1),
    team: z.string().min(1),
    paths: z.array(z.string().min(1)).min(1),
    testiny: z
      .object({
        /**
         * Testiny project (name or id) holding this area's catalog. Overrides
         * the top-level `testiny.project`; required when no top-level project
         * is set. Supports one-project-per-team Testiny layouts.
         */
        project: z.string().min(1).optional(),
        /**
         * Folder path within the project. Omit to treat the entire project as
         * the area's catalog (common when each team has its own project).
         */
        folder: z.string().min(1).optional(),
      })
      .strict(),
    /** Minimum mapped, non-stale cases for the area to be considered healthy. */
    minCases: z.number().int().positive().default(1),
  })
  .strict();

export const configSchema = z
  .object({
    version: z.literal(1),
    repo: z
      .object({
        path: z.string().min(1).default("."),
        branch: z.string().min(1).optional(),
      })
      .strict()
      .default({ path: "." }),
    churn: z
      .object({
        windowDays: z.number().int().positive().default(90),
        bulkChangeFileThreshold: z.number().int().positive().default(50),
        ignore: z.array(z.string().min(1)).default([]),
      })
      .strict()
      .default({}),
    testiny: z
      .object({
        /** Default project for areas that don't set their own `testiny.project`. */
        project: z.string().min(1).optional(),
      })
      .strict()
      .default({}),
    areas: z.array(areaSchema).min(1),
    thresholds: z
      .object({
        gapChurnScore: z.number().nonnegative().default(50),
        staleChurnScore: z.number().nonnegative().default(100),
        failOn: z.enum(["high", "medium", "low", "never"]).default("high"),
      })
      .strict()
      .default({}),
  })
  .strict()
  .superRefine((config, ctx) => {
    // Every area needs a project: its own testiny.project or the top-level default.
    if (config.testiny.project) return;
    config.areas.forEach((area, i) => {
      if (!area.testiny.project) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["areas", i, "testiny", "project"],
          message:
            `Area "${area.name}" has no Testiny project: set areas[].testiny.project ` +
            "or a top-level testiny.project default",
        });
      }
    });
  });

export type Config = z.infer<typeof configSchema>;
export type AreaConfig = z.infer<typeof areaSchema>;
export type FailOn = Config["thresholds"]["failOn"];

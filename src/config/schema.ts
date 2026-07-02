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
    testiny: z.object({
      folder: z.string().min(1),
    }),
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
        project: z.string().min(1),
      })
      .strict(),
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
  .strict();

export type Config = z.infer<typeof configSchema>;
export type AreaConfig = z.infer<typeof areaSchema>;
export type FailOn = Config["thresholds"]["failOn"];

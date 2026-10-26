import { z } from 'zod';
z.config({ jitless: true });
export const edgePort = 3182;
export const edgeBase = `http://127.0.0.1:${edgePort}`;
export const remoteApplicationSchema = z
  .object({
    id: z.string().min(1).max(512),
    position: z.string().trim().min(1).max(200),
    batch: z.string().max(100),
    rawStatus: z.string().max(200),
    recruitmentType: z.string().max(100).optional(),
    appliedAt: z.string().trim().max(40).optional(),
  })
  .strict();
export const edgeResultSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('success'),
      applications: z.array(remoteApplicationSchema).max(1000),
      applicationUrl: z.string().url().optional(),
      note: z.string().max(200).optional(),
    })
    .strict(),
  z
    .object({ kind: z.enum(['expired', 'challenge', 'error']), message: z.string().max(1000) })
    .strict(),
]);
export interface EdgeJob {
  id: string;
  connectionId: string;
  url: string;
  origin: string;
  platform: string;
  action: 'query' | 'open';
  requestedAt: number;
}
export interface EdgeSetup {
  extensionVersion?: string | null;
  connected: boolean;
  paired: boolean;
  extensionId: string;
  extensionDirectory: string;
  pairCode?: string;
  lastSeenAt: string | null;
  edgeConnections: number;
  preservedCompanies: string[];
}
export const edgeDiagnosticSchema = z
  .object({
    error: z.string().max(300).optional(),
    shapes: z
      .array(
        z
          .object({
            route: z
              .string()
              .max(300)
              .regex(/^\/[^?#]*$/),
            fields: z
              .array(
                z
                  .object({
                    path: z.string().max(300),
                    type: z.enum(['string', 'number', 'boolean', 'null', 'array', 'object']),
                  })
                  .strict(),
              )
              .max(300),
          })
          .strict(),
      )
      .max(20)
      .optional(),
    origin: z.string().url(),
    observedAt: z.number(),
    readyState: z.string().max(20),
    visibility: z.string().max(20),
    mainVisible: z.array(remoteApplicationSchema).max(1000),
    isolatedVisible: z.array(remoteApplicationSchema).max(1000),
    candidates: z.array(remoteApplicationSchema).max(1000),
    routes: z
      .array(
        z
          .string()
          .max(300)
          .regex(/^\/[^?#]*$/),
      )
      .max(100),
    campusTabFound: z.boolean(),
    cards: z.number().int().min(0).max(10000),
    datePaths: z.array(z.string().max(300)).max(40).optional(),
  })
  .strict();

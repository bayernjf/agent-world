import { z } from "zod";

/**
 * Structured, platform-agnostic product-content blocks produced by a layout
 * agent. Instead of free-form Markdown, the final layout node emits a fenced
 * ```product-json block matching this schema; the UI renders it with a proper
 * product-page layout (hero, image cards, spec table, CTA). Markdown remains
 * the fallback when no structured block is present.
 */
export const ProductBlock = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hero"), title: z.string(), subtitle: z.string().optional(), image: z.string().optional() }),
  z.object({ type: z.literal("heading"), text: z.string() }),
  z.object({ type: z.literal("paragraph"), text: z.string() }),
  z.object({ type: z.literal("quote"), text: z.string() }),
  z.object({ type: z.literal("bullets"), items: z.array(z.string()) }),
  z.object({
    type: z.literal("specs"),
    rows: z.array(z.object({ name: z.string(), value: z.string() })),
  }),
  z.object({
    type: z.literal("image"),
    src: z.string(),
    caption: z.string().optional(),
    /** Horizontal placement within the column: full (default) | left | right | center. */
    align: z.enum(["left", "right", "center", "full"]).optional(),
    /** Explicit width as a number of px or a CSS string like "60%". Defaults to layout-driven. */
    width: z.union([z.number(), z.string()]).optional(),
    /** Aspect ratio to constrain the image box, avoiding layout shift on load. */
    aspect: z.enum(["1:1", "3:4", "4:3", "16:9"]).optional(),
    /** Soften the corners for a more lifestyle look. */
    rounded: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("imageCards"),
    /** Grid (default) | carousel (scroll-snap) | row (single horizontal strip). */
    layout: z.enum(["grid", "carousel", "row"]).optional(),
    /** Column count for the grid layout (1-4). */
    columns: z.number().int().min(1).max(4).optional(),
    items: z.array(
      z.object({
        src: z.string(),
        title: z.string().optional(),
        caption: z.string().optional(),
        /** Span 2 columns within a grid (ignored for row/carousel). */
        span: z.number().int().min(1).max(2).optional(),
      }),
    ),
  }),
  z.object({ type: z.literal("cta"), text: z.string() }),
  z.object({ type: z.literal("divider") }),
]);
export type ProductBlock = z.infer<typeof ProductBlock>;

export const ProductDocument = z.object({
  platform: z.string().optional(),
  title: z.string().optional(),
  blocks: z.array(ProductBlock),
});
export type ProductDocument = z.infer<typeof ProductDocument>;

const FENCE = /```product-json\s*([\s\S]*?)```/i;

/**
 * Extract and validate a structured product document from agent output.
 * Returns null when there is no ```product-json fence or it fails validation,
 * in which case the caller falls back to Markdown rendering.
 */
export function parseProductDocument(output: string): ProductDocument | null {
  const match = output.match(FENCE);
  if (!match) return null;
  try {
    const parsed = ProductDocument.safeParse(JSON.parse(match[1]!));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

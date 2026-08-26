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
  }),
  z.object({
    type: z.literal("imageCards"),
    items: z.array(
      z.object({ src: z.string(), title: z.string().optional(), caption: z.string().optional() }),
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

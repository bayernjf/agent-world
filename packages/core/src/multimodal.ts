/**
 * Multimodal content parts (4.5). A worker's `runAgent` input can be a plain
 * string (`input`) or a structured list of content parts mixing text and
 * images. Images are referenced by URL or data URI; the engine builds the
 * `content` list from `input` plus any reference images flowing into the node.
 */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: string };

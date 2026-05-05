// src/lib/pipeline/framing.ts
import type { ProductMetadata } from "./types";

export type FramingScope = "full_body" | "three_quarter" | "chest_up";

const LEG_ITEM_REGEX = /(boot|sneaker|shoe|jean|pant|skirt|trouser|sock|legging|short)/i;

/**
 * Infer the required framing scope from the product items in a look.
 * - Any item with attachment_strategy=worn_on_legs OR an item_type matching
 *   shoe/boot/jean/skirt etc. → full_body (need feet in frame)
 * - Any item with attachment_strategy=held_in_hand or carried_on_shoulder → three_quarter
 * - Otherwise → chest_up
 */
export function inferFramingScope(products: ProductMetadata[]): FramingScope {
  const items = products.flatMap((p) => p.items);
  const hasLegItem = items.some(
    (it) =>
      it.attachment_strategy === "worn_on_legs" ||
      LEG_ITEM_REGEX.test(it.item_type),
  );
  if (hasLegItem) return "full_body";

  const hasMidItem = items.some(
    (it) =>
      it.attachment_strategy === "held_in_hand" ||
      it.attachment_strategy === "carried_on_shoulder",
  );
  if (hasMidItem) return "three_quarter";

  return "chest_up";
}

/**
 * Human-readable framing instructions to inject into a keyframe prompt.
 */
export function framingInstruction(scope: FramingScope): string {
  switch (scope) {
    case "full_body":
      return "Wide full-body shot with generous margin. The person's ENTIRE body must be visible — from the very top of the head (with at least 5% margin above) to the floor (with feet AND ground visible, at least 5% margin below). Feet must be in the lower third of the frame, fully visible with no cropping. Vertical 9:16 wide-shot composition. The frame must accommodate every garment and accessory — top, bottom, footwear, hands, bags. NO part of any item may be cropped at any edge. If unsure, zoom out further.";
    case "three_quarter":
      return "Three-quarter portrait from head to mid-thigh, with both hands and arms fully visible. Vertical 9:16.";
    case "chest_up":
      return "Head-and-shoulders to chest-up portrait, face fully visible in frame, NOT cropped above the chin. Vertical 9:16.";
  }
}

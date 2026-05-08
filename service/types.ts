// service/types.ts
//
// Public type exports. Re-exports from the canonical types module so
// integrators only need to import from "./service" / "./service/types".

export type {
  // Template-side types
  MotionScriptEntry,
  TemplateStyle,
  TemplateMetadata,
  TemplateAsset,
  OutfitSegment,
  OutfitSegmentSubjectState,
  SubjectState,

  // Product-side types
  ProductMetadata,
  ProductItem,
  ProductAsset,
  AttachmentStrategy,
  SidePreference,

  // Face / creator
  FaceMetadata,

  // Orchestration outputs
  OrchestratedPrompts,
  JudgeReport,

  // Run lifecycle
  Look,
  RunState,
  RunStatus,
} from "../src/lib/pipeline/types";

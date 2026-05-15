// Entry point for the Remotion CLI / Studio. registerRoot tells Remotion
// which component registers the compositions. This file is referenced by
// remotion.config.ts implicitly (Remotion looks for src/index.ts by default).
import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

registerRoot(RemotionRoot);

"use client";

import { Bloom, EffectComposer, N8AO, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import type { Quality } from "@/lib/game/store";

/**
 * Post-processing gives the stylized look its softness: ambient occlusion grounds furniture,
 * bloom makes lamps glow, and Khronos Neutral tone mapping keeps colours true (AgX washed the
 * fire and lamps out to beige). Low quality skips the composer; the renderer applies the same curve
 * (set on the Canvas), so the look stays consistent.
 */
export function Effects({ quality }: { quality: Quality }) {
  if (quality === "low") return null;
  return (
    <EffectComposer multisampling={quality === "high" ? 4 : 0}>
      <N8AO
        halfRes
        aoRadius={1.1}
        distanceFalloff={0.7}
        intensity={2.4}
        quality={quality === "high" ? "medium" : "performance"}
        color="#2a1a10"
      />
      <Bloom
        mipmapBlur
        luminanceThreshold={1}
        luminanceSmoothing={0.2}
        intensity={0.55}
        radius={0.75}
      />
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
      <Vignette darkness={0.32} offset={0.28} />
    </EffectComposer>
  );
}

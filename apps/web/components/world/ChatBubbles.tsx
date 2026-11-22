"use client";

import { useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { type Group, MathUtils, type Sprite, SpriteMaterial } from "three";
import { BUBBLE_PX, createBubbleTexture, paintBubble } from "@/lib/chat/bubble";
import { type BubbleFace, type BubbleSource, bubbleFace } from "@/lib/chat/format";
import { chatLive } from "@/lib/chat/store";
import { librarianPresence } from "@/lib/librarian/presence";
import { TAG_PX } from "@/lib/net/nameTag";
import { loadFaceFonts } from "@/lib/world/leaderboardFace";

/*
 * Chat speech bubbles in the 3D library: over another player's name tag, their latest chat line
 * for a few seconds (lib/chat/format.ts BUBBLE_MS, cut to fit) or three stepping dots while
 * they're typing; over Ms. Fenwick, the same while she writes or has just said a chat reply.
 * One canvas sprite each (lib/chat/bubble.ts), repainted only when what it shows changes; what
 * it shows is read every frame from lib/chat/store.ts `chatLive`, so a new line never
 * re-renders the scene. RemotePlayers.tsx places a player's bubble (just above their tag, at the
 * tag's size and fade); FenwickBubble places hers above her head.
 */

/** Where the parent wants the bubble this frame: its bottom edge, the tag's height, its fade. */
export interface BubblePlace {
  y: number;
  size: number;
  opacity: number;
  /** Drawn over the scenery (no depth test) this frame. */
  overlay?: boolean;
}

/** A bubble canvas pixel is drawn this many name-tag pixels tall, so its words read like a name. */
const PX_SCALE = 1.3;
const ASPECT = BUBBLE_PX.w / BUBBLE_PX.h;
/** The bubble's height for each metre of name-tag height. */
const HEIGHT_PER_TAG = (BUBBLE_PX.h / TAG_PX.h) * PX_SCALE;

export function SpeechBubble({
  source,
  place,
}: {
  source: () => BubbleSource | undefined;
  place: React.RefObject<BubblePlace>;
}) {
  const texture = useMemo(() => createBubbleTexture(), []);
  const material = useMemo(
    () =>
      new SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      }),
    [texture],
  );
  const sprite = useRef<Sprite>(null);
  const painted = useRef<string | null>(null);
  const cache = useRef<{ face: BubbleFace | null }>({ face: null });
  useEffect(
    () => () => {
      material.dispose();
      texture.dispose();
    },
    [material, texture],
  );
  // Repaint once the cartoon font has arrived (a canvas doesn't on its own).
  useEffect(() => {
    let live = true;
    void loadFaceFonts().then(() => {
      if (live) painted.current = null;
    });
    return () => {
      live = false;
    };
  }, []);

  useFrame(() => {
    const s = sprite.current;
    if (!s) return;
    const p = place.current;
    const face = bubbleFace(source(), performance.now(), cache.current);
    if (!face || p.opacity <= 0.01) {
      s.visible = false;
      return;
    }
    if (painted.current !== face.key) {
      paintBubble(texture, face);
      painted.current = face.key;
    }
    const h = p.size * HEIGHT_PER_TAG;
    s.scale.set(h * ASPECT, h, 1);
    s.position.y = p.y;
    const m = s.material as SpriteMaterial;
    m.opacity = p.opacity;
    // A render-time state, so it can change frame to frame without recompiling the material.
    m.depthTest = !p.overlay;
    s.visible = true;
  });

  return (
    <sprite ref={sprite} material={material} center={[0.5, 0]} renderOrder={21} visible={false} />
  );
}

/** Her bubble's bottom edge sits this far above her eyes (clear of her big head and bun). */
const FENWICK_ABOVE_EYES = 0.5;
/** Sized and faded like a name tag (RemotePlayers.tsx), but seen from further across the hall. */
const PER_METRE = 0.07;
const MIN_M = 0.16;
const MAX_M = 0.8;
const FADE_FROM = 18;
const FADE_TO = 28;
/**
 * From the hall floor in front of her desk, the LIBRARIAN sign and a pendant lamp (about 1 m
 * nearer than her, hanging at bubble height) cut words out of her bubble, so there it's drawn
 * over the scenery. Only there: below the north gallery's underside (y 4.2), in front of the
 * sign (1.2 m nearer than her) and between the side aisles (x ±7.4). Elsewhere it keeps the depth
 * test, so it never shows through the gallery floor above her or the stacks.
 */
const OVER_BELOW_Y = 4.2;
const OVER_FRONT_M = 1.2;
const OVER_HALF_WIDTH = 7.4;

/** Ms. Fenwick's chat bubble, above her head behind the desk. */
export function FenwickBubble() {
  const group = useRef<Group>(null);
  const place = useRef<BubblePlace>({ y: 0, size: MIN_M, opacity: 0 });
  const source = useCallback(() => chatLive.fenwick, []);
  useFrame(({ camera }) => {
    const g = group.current;
    if (!g) return;
    const eye = librarianPresence.eye;
    g.position.set(eye.x, eye.y + FENWICK_ABOVE_EYES, eye.z);
    const d = camera.position.distanceTo(g.position);
    const p = place.current;
    p.size = MathUtils.clamp(d * PER_METRE, MIN_M, MAX_M);
    const c = camera.position;
    p.overlay =
      c.y < OVER_BELOW_Y && c.z > eye.z + OVER_FRONT_M && Math.abs(c.x - eye.x) < OVER_HALF_WIDTH;
    // Not over her face in the conversation close-up (her panel has the words then).
    p.opacity = librarianPresence.open
      ? 0
      : MathUtils.clamp((FADE_TO - d) / (FADE_TO - FADE_FROM), 0, 1);
  });
  return (
    <group ref={group}>
      <SpeechBubble source={source} place={place} />
    </group>
  );
}

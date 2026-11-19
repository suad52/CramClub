"use client";

import { type RootState, useFrame } from "@react-three/fiber";
import { type RefObject, useMemo } from "react";
import { NeutralToneMapping, type Object3D, PerspectiveCamera, Vector3 } from "three";
import { runtime } from "@/lib/game/runtime";

/** Size and margin of the preview, in CSS pixels. Mirrored by the HTML frame in the HUD. */
export const FACE_PREVIEW = { size: 200, margin: 16 } as const;

const headPos = new Vector3();
const offset = new Vector3();

/** Draws a front-on view of the avatar's face into the bottom-right corner of the canvas. */
function drawFacePreview(
  state: RootState,
  head: Object3D,
  body: Object3D | null,
  camera: PerspectiveCamera,
) {
  const { gl, scene, size } = state;
  // Aim at the middle of the face from just in front of it.
  // The Head bone points up from the neck; the face centre is ~12 cm along it.
  head.localToWorld(headPos.set(0, 0.12, 0));
  offset.set(Math.sin(runtime.facing), 0.04, Math.cos(runtime.facing)).multiplyScalar(0.95);
  camera.position.copy(headPos).add(offset);
  camera.lookAt(headPos);

  const { size: px, margin } = FACE_PREVIEW;
  const x = size.width - px - margin;
  const wasVisible = body?.visible ?? true;
  if (body) body.visible = true; // hidden in first person, but we want to see the face
  const toneMapping = gl.toneMapping;
  const autoClear = gl.autoClear;
  const shadowUpdate = gl.shadowMap.autoUpdate;
  gl.autoClear = false;
  gl.shadowMap.autoUpdate = false; // the main view's shadow map is still valid
  gl.toneMapping = NeutralToneMapping; // the composer turns renderer tone mapping off
  gl.setScissorTest(true);
  gl.setScissor(x, margin, px, px);
  gl.setViewport(x, margin, px, px);
  gl.clear(true, true, false);
  gl.render(scene, camera);
  gl.setScissorTest(false);
  gl.setViewport(0, 0, size.width, size.height);
  gl.toneMapping = toneMapping;
  gl.autoClear = autoClear;
  gl.shadowMap.autoUpdate = shadowUpdate;
  if (body) body.visible = wasVisible;
}

/**
 * Shows the local avatar's face in a corner while expression tracking is on, so you can see
 * your expressions even with the camera behind you or in first person. Runs after the main
 * frame (priority 2). Because R3F stops auto-rendering once a frame callback has a positive
 * priority, `renderMain` draws the main view too when no post-processing composer is doing it.
 */
export function FacePreview({
  head,
  body,
  renderMain,
}: {
  head: RefObject<Object3D | null>;
  body: RefObject<Object3D | null>;
  renderMain: boolean;
}) {
  const camera = useMemo(() => new PerspectiveCamera(26, 1, 0.05, 60), []);
  useFrame((state) => {
    if (renderMain) state.gl.render(state.scene, state.camera);
    if (head.current) drawFacePreview(state, head.current, body.current, camera);
  }, 2);
  return null;
}

"use client";

import { useFrame } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import { type Group, MathUtils, type Object3D, type Sprite, SpriteMaterial } from "three";
import { useShallow } from "zustand/react/shallow";
import { NET, PLAYER, type StudyStatus, movePlayer, wrapAngle } from "@ovr/shared";
import { Avatar, type AvatarMotion } from "@/components/avatar/Avatar";
import { getSeat } from "@/lib/game/actions";
import { runtime } from "@/lib/game/runtime";
import { useGameStore } from "@/lib/game/store";
import { tickNet } from "@/lib/net/connection";
import { type NetSample, SNAP_DISTANCE } from "@/lib/net/interpolation";
import { TAG_PX, createTagTexture, paintTag } from "@/lib/net/nameTag";
import { remoteLive, useRemotePlayers } from "@/lib/net/players";
import { loadFaceFonts } from "@/lib/world/leaderboardFace";

/*
 * Everyone else in the library: their avatars where the server last saw them, drawn
 * NET.INTERP_DELAY_MS in the past and glided between moves (lib/net/interpolation.ts), walking,
 * running and sitting with the same seat poses as your own avatar, their face tracking when they
 * have it on, and a name tag. Their real-face photo never leaves their browser, so they always
 * show the chibi head here.
 */

/** Name tags fade out between these distances from the camera (metres). */
const TAG_FADE_FROM = 16;
const TAG_FADE_TO = 24;
/** The tag's bottom edge, above the head bone (metres): clear of the chibi head and hair. */
const TAG_ABOVE_HEAD = 0.4;
/**
 * Tag height: about this much per metre of distance (so it reads at a steady ~35 px), but never
 * smaller or bigger than these in the room.
 */
const TAG_PER_METRE = 0.07;
const TAG_MIN_M = 0.16;
const TAG_MAX_M = 0.8;
const TAG_ASPECT = TAG_PX.w / TAG_PX.h;
/** Two players' centres closer than this push you gently apart (you only; they push themselves). */
const PERSONAL_SPACE = PLAYER.radius * 2;
/** Feet further apart than this are on different floors (or stairs). */
const SAME_FLOOR = 0.8;

function dampAngle(current: number, target: number, lambda: number, dt: number) {
  return current + wrapAngle(target - current) * (1 - Math.exp(-lambda * dt));
}

function NameTag({
  name,
  status,
  signedIn,
  spriteRef,
}: {
  name: string;
  status: StudyStatus;
  signedIn: boolean;
  spriteRef: React.RefObject<Sprite | null>;
}) {
  const texture = useMemo(() => createTagTexture(), []);
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
  useEffect(
    () => () => {
      material.dispose();
      texture.dispose();
    },
    [material, texture],
  );
  useEffect(() => {
    let live = true;
    const face = { name, status, signedIn };
    paintTag(texture, face);
    // Repaint once the cartoon font has arrived (a canvas doesn't on its own).
    void loadFaceFonts().then(() => live && paintTag(texture, face));
    return () => {
      live = false;
    };
  }, [texture, name, status, signedIn]);
  return (
    <sprite
      ref={spriteRef}
      material={material}
      scale={[TAG_MIN_M * TAG_ASPECT, TAG_MIN_M, 1]}
      center={[0.5, 0]}
      position={[0, 2, 0]}
      renderOrder={20}
    />
  );
}

interface RemoteState {
  motion: AvatarMotion;
  sample: NetSample;
  started: boolean;
  x: number;
  y: number;
  z: number;
  facing: number;
  /** Head height above the feet (from the head bone), for the name tag. */
  headY: number;
}

function RemotePlayer({ id }: { id: string }) {
  const info = useRemotePlayers((s) => s.players[id]);
  const group = useRef<Group>(null);
  const head = useRef<Object3D>(null);
  const tag = useRef<Sprite>(null);
  const state = useRef<RemoteState>({
    motion: { speed: 0, sitBlend: 0, seatHeight: 0.46, face: null, gesture: null },
    sample: { t: 0, x: 0, y: 0, z: 0, ry: 0, speed: 0 },
    started: false,
    x: 0,
    y: 0,
    z: 0,
    facing: 0,
    headY: 1.62,
  });
  const motion = useCallback(() => state.current.motion, []);

  useFrame((frame, rawDt) => {
    const g = group.current;
    const live = remoteLive.get(id);
    if (!g || !live) return;
    const dt = Math.min(rawDt, 0.05);
    const s = state.current;
    const m = s.motion;
    if (!live.buffer.sample(performance.now() - NET.INTERP_DELAY_MS, s.sample)) {
      g.visible = false;
      return;
    }
    const seat = live.seatId ? getSeat(live.seatId) : undefined;
    // Seated: the seat's own spot and facing (as for your avatar); otherwise where they were.
    const tx = seat ? seat.x : s.sample.x;
    const ty = seat ? seat.y : s.sample.y;
    const tz = seat ? seat.z : s.sample.z;
    const tr = seat ? seat.rotationY : s.sample.ry;
    const far = Math.hypot(tx - s.x, ty - s.y, tz - s.z) > SNAP_DISTANCE;
    if (!s.started || far) {
      s.started = true;
      s.x = tx;
      s.y = ty;
      s.z = tz;
      s.facing = tr;
      m.sitBlend = seat ? 1 : 0;
    } else {
      // A light extra smoothing over the interpolation (quicker while walking).
      const k = seat ? 10 : 18;
      s.x = MathUtils.damp(s.x, tx, k, dt);
      s.y = seat ? ty : MathUtils.damp(s.y, ty, k, dt);
      s.z = MathUtils.damp(s.z, tz, k, dt);
      s.facing = dampAngle(s.facing, tr, seat ? 10 : 16, dt);
      m.sitBlend = MathUtils.damp(m.sitBlend, seat ? 1 : 0, seat ? 7 : 9, dt);
    }
    m.speed = seat ? 0 : s.sample.speed;
    if (seat) m.seatHeight = seat.seatHeight;
    m.face = live.faceOn ? live.face : null;
    g.position.set(s.x, s.y, s.z);
    g.rotation.y = s.facing;
    g.visible = true;

    // The tag sits over the head bone (posed last frame, like the group): the avatar's height
    // and sitting are taken care of.
    const h = head.current;
    if (h) {
      const above = h.matrixWorld.elements[13]! - g.matrixWorld.elements[13]!;
      if (above > 0.3 && above < 3) s.headY = MathUtils.damp(s.headY, above, 12, dt);
    }
    const t = tag.current;
    if (t) {
      t.position.y = s.headY + TAG_ABOVE_HEAD;
      const cam = frame.camera.position;
      const d = Math.hypot(cam.x - s.x, cam.y - s.y - s.headY, cam.z - s.z);
      const size = MathUtils.clamp(d * TAG_PER_METRE, TAG_MIN_M, TAG_MAX_M);
      t.scale.set(size * TAG_ASPECT, size, 1);
      const opacity = MathUtils.clamp((TAG_FADE_TO - d) / (TAG_FADE_TO - TAG_FADE_FROM), 0, 1);
      (t.material as SpriteMaterial).opacity = opacity;
      t.visible = opacity > 0.01;
    }

    // A soft push when you walk into someone standing (never through walls: it's a move too).
    const game = useGameStore.getState();
    if (seat || game.seatId || game.phase !== "playing" || Math.abs(runtime.y - s.y) > SAME_FLOOR)
      return;
    const dx = runtime.x - s.x;
    const dz = runtime.z - s.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= PERSONAL_SPACE * PERSONAL_SPACE) return;
    const d = Math.sqrt(d2);
    const nx = d > 1e-4 ? dx / d : Math.sin(runtime.facing + Math.PI);
    const nz = d > 1e-4 ? dz / d : Math.cos(runtime.facing + Math.PI);
    const push = (PERSONAL_SPACE - d) * Math.min(1, 10 * dt);
    const next = movePlayer(runtime, { x: nx * push, z: nz * push }, PLAYER.radius);
    runtime.x = next.x;
    runtime.y = next.y;
    runtime.z = next.z;
  }, -1);

  if (!info) return null;
  return (
    <group ref={group} visible={false}>
      <Suspense fallback={null}>
        <Avatar config={info.avatar} motion={motion} headRef={head} />
      </Suspense>
      <NameTag name={info.name} status={info.status} signedIn={info.signedIn} spriteRef={tag} />
    </group>
  );
}

/** Sends your own moves (when due) and draws everyone else. */
export function RemotePlayers() {
  const ids = useRemotePlayers(useShallow((s) => Object.keys(s.players)));
  useFrame(() => tickNet(performance.now()), -1);
  return (
    <>
      {ids.map((id) => (
        <RemotePlayer key={id} id={id} />
      ))}
    </>
  );
}

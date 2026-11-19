"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { type Group, type MeshBasicMaterial } from "three";
import { getSeat } from "@/lib/game/actions";
import { useGameStore } from "@/lib/game/store";

/** A soft, pulsing ring on the floor around the seat the player can sit in. */
export function SeatHighlight() {
  const seatId = useGameStore((s) => s.nearbySeatId);
  const seat = getSeat(seatId);
  const group = useRef<Group>(null);
  const material = useRef<MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (material.current) material.current.opacity = 0.45 + Math.sin(t * 3) * 0.15;
    if (group.current) group.current.rotation.y = t * 0.4;
  });
  if (!seat) return null;
  return (
    <group ref={group} position={[seat.x, 0.012, seat.z]}>
      <mesh rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.42, 0.48, 48]} />
        <meshBasicMaterial
          ref={material}
          color="#ffd99a"
          transparent
          opacity={0.5}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

"use client";

import { useEffect, useMemo } from "react";
import {
  BackSide,
  BoxGeometry,
  type BufferGeometry,
  Color,
  InstancedMesh,
  MeshStandardMaterial,
  ShaderMaterial,
} from "three";
import { FURNITURE, ROOM } from "@ovr/shared";
import { buildBooks } from "@/lib/world/books";
import { buildFurnitureParts } from "@/lib/world/furniture";
import { buildOutdoors } from "@/lib/world/outdoors";
import { type MaterialKey, mergeParts, PartList } from "@/lib/world/parts";
import { buildRoom, type LampLight } from "@/lib/world/room";
import { canvasTexture, drawFloor } from "@/lib/world/textures";

export interface BuiltWorld {
  interior: Map<MaterialKey, BufferGeometry>;
  outdoors: Map<MaterialKey, BufferGeometry>;
  lights: LampLight[];
}

/** Builds and merges every static piece of the library once. */
export function useBuiltWorld(): BuiltWorld {
  const world = useMemo(() => {
    const all = new PartList();
    const room = buildRoom();
    all.parts.push(...room.parts.parts);
    for (const item of FURNITURE) {
      const parts = buildFurnitureParts(item);
      if (parts) all.addTransformed(parts, item.x, 0, item.z, item.rotationY);
    }
    return {
      interior: mergeParts(all.parts),
      outdoors: mergeParts(buildOutdoors().parts),
      lights: room.lights,
    };
  }, []);
  useEffect(
    () => () => {
      for (const g of world.interior.values()) g.dispose();
      for (const g of world.outdoors.values()) g.dispose();
    },
    [world],
  );
  return world;
}

function MergedMeshes({
  geometries,
  shadows,
}: {
  geometries: Map<MaterialKey, BufferGeometry>;
  shadows: boolean;
}) {
  const solid = geometries.get("solid");
  const metal = geometries.get("metal");
  const glow = geometries.get("glow");
  const glass = geometries.get("glass");
  return (
    <>
      {solid && (
        <mesh geometry={solid} castShadow={shadows} receiveShadow={shadows}>
          <meshStandardMaterial vertexColors roughness={0.82} metalness={0} />
        </mesh>
      )}
      {metal && (
        <mesh geometry={metal} castShadow={shadows} receiveShadow={shadows}>
          <meshStandardMaterial vertexColors roughness={0.32} metalness={0.75} />
        </mesh>
      )}
      {glow && (
        <mesh geometry={glow}>
          <meshBasicMaterial vertexColors toneMapped={false} />
        </mesh>
      )}
      {glass && (
        <mesh geometry={glass} renderOrder={2}>
          <meshStandardMaterial
            vertexColors
            transparent
            opacity={0.14}
            roughness={0.05}
            metalness={0.1}
            depthWrite={false}
          />
        </mesh>
      )}
    </>
  );
}

export function StaticWorld({ world }: { world: BuiltWorld }) {
  return (
    <>
      <MergedMeshes geometries={world.interior} shadows />
      <MergedMeshes geometries={world.outdoors} shadows={false} />
      <Floor />
      <OutsideGround />
      <Sky />
      <Books />
    </>
  );
}

function Floor() {
  const texture = useMemo(
    () =>
      canvasTexture(2048, 2048, drawFloor, {
        repeat: [(ROOM.maxX - ROOM.minX) / 4, (ROOM.maxZ - ROOM.minZ) / 4],
      }),
    [],
  );
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh rotation-x={-Math.PI / 2} receiveShadow>
      <planeGeometry args={[ROOM.maxX - ROOM.minX, ROOM.maxZ - ROOM.minZ]} />
      <meshStandardMaterial map={texture} roughness={0.5} metalness={0} />
    </mesh>
  );
}

function OutsideGround() {
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={-0.03}>
      <planeGeometry args={[600, 600]} />
      <meshStandardMaterial color="#9db87a" roughness={1} />
    </mesh>
  );
}

const skyMaterial = () =>
  new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new Color("#8fbbe0") },
      horizon: { value: new Color("#fbe9cc") },
      bottom: { value: new Color("#c9d6a8") },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 horizon;
      uniform vec3 bottom;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.55)) : mix(horizon, bottom, pow(-h, 0.4));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });

function Sky() {
  const material = useMemo(() => skyMaterial(), []);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh material={material} renderOrder={-1}>
      <sphereGeometry args={[220, 32, 16]} />
    </mesh>
  );
}

function Books() {
  const mesh = useMemo(() => {
    const { matrices, colors } = buildBooks(FURNITURE);
    const geometry = new BoxGeometry(1, 1, 1);
    // Books don't need UVs; dropping them keeps the instance buffer lean.
    geometry.deleteAttribute("uv");
    const material = new MeshStandardMaterial({ roughness: 0.78 });
    const m = new InstancedMesh(geometry, material, matrices.length);
    matrices.forEach((mat, i) => {
      m.setMatrixAt(i, mat);
      m.setColorAt(i, colors[i]!);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.receiveShadow = true;
    m.castShadow = false;
    m.computeBoundingSphere();
    return m;
  }, []);
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as MeshStandardMaterial).dispose();
      mesh.dispose();
    },
    [mesh],
  );
  return <primitive object={mesh} />;
}

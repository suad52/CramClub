"use client";

import { useGLTF } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import {
  type InstancedMesh,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type Texture,
  Vector3,
} from "three";
import type { Quality } from "@/lib/game/store";
import { REMOVED_MODEL_OBJECTS, REMOVED_MODEL_REGIONS } from "@ovr/shared";

/**
 * The library building and its furniture, modelled in Blender (art/library) and exported as one
 * GLB: shared meshes are GPU instances, the rest is joined per material, compressed with meshopt.
 */
export const LIBRARY_URL = "/models/library/library.glb";

const TEXTURE_SLOTS = ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap"] as const;

/**
 * Book cloth takes each book's instance colour, but its gold-leaf titles and rules (the gilt mask
 * in the metalness map's blue channel) must stay gold: tint only where the mask is off.
 */
function keepGiltUntinted(m: MeshStandardMaterial) {
  if (m.userData.ovrGilt) return;
  m.userData.ovrGilt = true;
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
        #ifdef USE_METALNESSMAP
          float ovrGilt = texture2D( metalnessMap, vMetalnessMapUv ).b;
          diffuseColor.rgb *= mix( vColor.rgb, vec3( 1.0 ), ovrGilt );
        #else
          diffuseColor.rgb *= vColor.rgb;
        #endif
      #endif`,
    );
  };
  m.customProgramCacheKey = () => "ovr-gilt";
  m.needsUpdate = true;
}

type Region = (typeof REMOVED_MODEL_REGIONS)[number];

/**
 * Drops every triangle of the model that lies wholly inside one of the regions (a vertical
 * cylinder), for parts of removed objects that the export joined into shared meshes.
 */
function carveOut(scene: Object3D, regions: readonly Region[]) {
  const v = new Vector3();
  const inside = (r: Region) =>
    Math.hypot(v.x - r.x, v.z - r.z) < r.radius && v.y > r.y0 && v.y < r.y1;
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || (mesh as InstancedMesh).isInstancedMesh) return;
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    if (!pos || !geo.index) return;
    const hit = new Uint8Array(pos.count);
    let any = false;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      if (regions.some(inside)) {
        hit[i] = 1;
        any = true;
      }
    }
    if (!any) return;
    const index = geo.index;
    for (let t = 0; t < index.count; t += 3) {
      const a = index.getX(t);
      const b = index.getX(t + 1);
      const c = index.getX(t + 2);
      if (hit[a] && hit[b] && hit[c]) {
        index.setX(t + 1, a);
        index.setX(t + 2, a);
      }
    }
    index.needsUpdate = true;
  });
}

export function LibraryModel({ quality }: { quality: Quality }) {
  const { scene } = useGLTF(LIBRARY_URL);
  const maxAnisotropy = useThree((s) => s.gl.capabilities.getMaxAnisotropy());

  useEffect(() => {
    const shadows = quality !== "low";
    const anisotropy = quality === "high" ? Math.min(8, maxAnisotropy) : 4;
    const seen = new Set<Material>();
    // The floor globe stood in front of the librarian's desk; the plan's collider is dropped too
    // (REMOVED_PLAN_ITEMS in @ovr/shared).
    for (const name of REMOVED_MODEL_OBJECTS) {
      const gone = scene.getObjectByName(name);
      if (gone) gone.visible = false;
    }
    carveOut(scene, REMOVED_MODEL_REGIONS);
    scene.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Material[];
      // Each book's colour comes in as an instance colour on every part of the book; only its
      // cloth should take it (page blocks and brass bookends keep their own colour).
      const inst = mesh as InstancedMesh;
      if (
        inst.isInstancedMesh &&
        inst.instanceColor &&
        !mats.some((m) => m.name === "M_BookCloth")
      ) {
        inst.instanceColor = null;
      }
      const glass = mats.every((m) => m.transparent);
      // Glass lets the sun through (its shadow would black out the window pools). Books sit
      // inside their shelves, where their shadows can't be seen: skipping them halves the
      // shadow pass's draw calls.
      mesh.castShadow = shadows && !glass && !mesh.name.startsWith("Book_");
      mesh.receiveShadow = shadows;
      for (const m of mats) {
        if (seen.has(m)) continue;
        seen.add(m);
        if (m.transparent) m.depthWrite = false;
        const std = m as MeshStandardMaterial;
        if (m.name === "M_BookCloth") keepGiltUntinted(std);
        for (const slot of TEXTURE_SLOTS) {
          const tex = std[slot] as Texture | null | undefined;
          if (tex && tex.anisotropy !== anisotropy) {
            tex.anisotropy = anisotropy;
            tex.needsUpdate = true;
          }
        }
      }
    });
  }, [scene, quality, maxAnisotropy]);

  return <primitive object={scene} />;
}

useGLTF.preload(LIBRARY_URL);

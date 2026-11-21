"use client";

import { useGLTF } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import type { InstancedMesh, Material, Mesh, MeshStandardMaterial, Texture } from "three";
import type { Quality } from "@/lib/game/store";

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

export function LibraryModel({ quality }: { quality: Quality }) {
  const { scene } = useGLTF(LIBRARY_URL);
  const maxAnisotropy = useThree((s) => s.gl.capabilities.getMaxAnisotropy());

  useEffect(() => {
    const shadows = quality !== "low";
    const anisotropy = quality === "high" ? Math.min(8, maxAnisotropy) : 4;
    const seen = new Set<Material>();
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

import {
  type Bone,
  Color,
  type Material,
  Matrix4,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  Plane,
  Quaternion,
  Euler,
  Group,
  Vector3,
} from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import {
  type AvatarConfig,
  DEFAULT_AVATAR,
  KIT_HEAD_CENTER_Z,
  type ResolvedAvatar,
  resolveAvatar,
} from "@ovr/shared";

/** The Blender avatar kit, exported by `pnpm avatar:build` (see docs/avatar-pipeline.md). */
export const AVATAR_KIT_URL = "/models/avatars/avatar-kit.glb";

export const KIT_BONES = [
  "Root",
  "Hips",
  "Spine",
  "Chest",
  "Neck",
  "Head",
  "UpperArm.L",
  "LowerArm.L",
  "Hand.L",
  "UpperLeg.L",
  "LowerLeg.L",
  "Foot.L",
  "UpperArm.R",
  "LowerArm.R",
  "Hand.R",
  "UpperLeg.R",
  "LowerLeg.R",
  "Foot.R",
] as const;
export type KitBone = (typeof KIT_BONES)[number];

/** Height of the Hips bone above the floor at rest (kit_core.BONES). */
export const KIT_HIP_HEIGHT = 0.88;

interface BoneRest {
  bone: Bone;
  /** Inverse of the parent's rest orientation in model space. */
  pre: Quaternion;
  /** The bone's own rest orientation in model space. */
  post: Quaternion;
  position: Vector3;
}

/**
 * One avatar built from the kit: a skinned clone of every part (shared geometry, per-avatar
 * materials) plus the bookkeeping to pose bones, set morphs and recolour quickly.
 */
export interface KitAvatar {
  root: Group;
  bones: Record<KitBone, BoneRest>;
  /** Part name → its mesh(es) (multi-material parts export as several meshes). */
  parts: Map<string, Mesh[]>;
  /** Material name → this avatar's own copy. */
  materials: Map<string, MeshStandardMaterial>;
  resolved: ResolvedAvatar;
  /** Rest model-space matrix of the Head bone, for things rigidly attached to the head. */
  headRestInverse: Matrix4;
  hairPlane: Plane;
  hairPlaneRest: Plane | null;
  dispose: () => void;
}

/** GLTFLoader strips "." from node names ("UpperArm.L" → "UpperArmL"). */
const nodeName = (name: string) => name.replace(/[[\].:/]/g, "").replace(/\s/g, "_");

const isMesh = (o: Object3D): o is Mesh => (o as Mesh).isMesh === true;

export function createKitAvatar(kitScene: Object3D): KitAvatar {
  const root = new Group();
  root.name = "Avatar";
  const model = cloneSkinned(kitScene);
  root.add(model);
  root.updateMatrixWorld(true);

  // Bones: remember rest orientations in model space so poses can be authored in model axes.
  const bones = {} as Record<KitBone, BoneRest>;
  const parentQ = new Quaternion();
  for (const name of KIT_BONES) {
    const bone = model.getObjectByName(nodeName(name)) as Bone | undefined;
    if (!bone) throw new Error(`Avatar kit is missing bone ${name}`);
    const post = bone.getWorldQuaternion(new Quaternion());
    (bone.parent ?? root).getWorldQuaternion(parentQ);
    bones[name] = { bone, pre: parentQ.clone().invert(), post, position: bone.position.clone() };
  }
  const headRestInverse = bones.Head.bone.matrixWorld.clone().invert();

  // Parts and per-avatar materials.
  const parts = new Map<string, Mesh[]>();
  const materials = new Map<string, MeshStandardMaterial>();
  const own = (m: Material) => {
    let copy = materials.get(m.name);
    if (!copy) {
      copy = (m as MeshStandardMaterial).clone();
      materials.set(m.name, copy);
    }
    return copy;
  };
  // Parts sit under the armature node (or the scene root): a mesh, or a group of meshes when
  // the part has several materials.
  const partNodes = new Set<Object3D>();
  model.traverse((o) => {
    if (!isMesh(o)) return;
    const group = o.parent;
    partNodes.add(group && group.type === "Group" && group !== model ? group : o);
  });
  for (const child of partNodes) {
    const meshes: Mesh[] = [];
    child.traverse((o) => {
      if (!isMesh(o)) return;
      o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material);
      o.castShadow = true;
      o.receiveShadow = true;
      // Poses move limbs well outside the rest bounds; parts are small, so skip culling.
      o.frustumCulled = false;
      meshes.push(o);
    });
    if (meshes.length) parts.set(child.name, meshes);
  }

  const avatar: KitAvatar = {
    root,
    bones,
    parts,
    materials,
    resolved: resolveAvatar(DEFAULT_AVATAR),
    headRestInverse,
    hairPlane: new Plane(),
    hairPlaneRest: null,
    dispose: () => {
      for (const m of materials.values()) m.dispose();
    },
  };
  return avatar;
}

/**
 * Applies a config: part visibility, colours, build/face/mouth morphs, height and the
 * hat-hair clip. Cheap, so the creator can call it on every click.
 */
export function applyAvatarConfig(avatar: KitAvatar, config: AvatarConfig) {
  const r = resolveAvatar(config);
  avatar.resolved = r;
  const visible = new Set(r.visible);
  for (const [name, meshes] of avatar.parts) {
    const show = visible.has(name);
    for (const mesh of meshes) {
      mesh.visible = show;
      const dict = mesh.morphTargetDictionary;
      const weights = mesh.morphTargetInfluences;
      if (!dict || !weights) continue;
      weights.fill(0);
      const preset = r.morphs[name];
      for (const [morph, w] of Object.entries({ ...r.build, ...preset })) {
        const i = dict[morph];
        if (i !== undefined) weights[i] = w;
      }
    }
  }
  const color = new Color();
  for (const [name, mat] of avatar.materials) {
    const hex = r.materials[name];
    if (hex) mat.color.copy(color.set(hex));
  }
  avatar.root.scale.setScalar(r.scale);

  // Hats: clip the hair above a tilted plane through the hat's band (kit space → glTF space:
  // Blender (x, y, z) is glTF (x, z, -y), and the face looks down +Z).
  const hairMats = ["MAT_Hair", "MAT_HairAccent"].map((n) => avatar.materials.get(n));
  if (r.hairClip) {
    const front = new Vector3(0, KIT_HEAD_CENTER_Z + r.hairClip.front, 0.17);
    const back = new Vector3(0, KIT_HEAD_CENTER_Z + r.hairClip.back, -0.17);
    const along = back.clone().sub(front);
    // Normal points down (keep what's below), perpendicular to the band and to the X axis.
    const normal = new Vector3(0, -along.z, along.y).normalize();
    if (normal.y > 0) normal.negate();
    avatar.hairPlaneRest = new Plane().setFromNormalAndCoplanarPoint(normal, front);
    for (const m of hairMats) if (m) m.clippingPlanes = [avatar.hairPlane];
  } else {
    avatar.hairPlaneRest = null;
    for (const m of hairMats) if (m) m.clippingPlanes = null;
  }
}

/** Every mesh of the given parts that is currently visible. */
export function visibleMeshes(avatar: KitAvatar, prefix: string): Mesh[] {
  const out: Mesh[] = [];
  for (const [name, meshes] of avatar.parts) {
    if (name.startsWith(prefix)) for (const m of meshes) if (m.visible) out.push(m);
  }
  return out;
}

export function setMorph(meshes: readonly Mesh[], morph: string, value: number) {
  for (const mesh of meshes) {
    const i = mesh.morphTargetDictionary?.[morph];
    if (i !== undefined && mesh.morphTargetInfluences) mesh.morphTargetInfluences[i] = value;
  }
}

const euler = new Euler();
const delta = new Quaternion();
const offset = new Vector3();

/**
 * Poses a bone with a rotation given in the avatar's own axes (+X = its left, +Y up, +Z
 * forward), composed the same way as nested pivots: a child's rotation is applied in its
 * parent's already-rotated frame. Positive X swings a limb backward.
 */
export function poseBone(avatar: KitAvatar, name: KitBone, x: number, y = 0, z = 0) {
  const rest = avatar.bones[name];
  delta.setFromEuler(euler.set(x, y, z));
  rest.bone.quaternion.copy(rest.pre).multiply(delta).multiply(rest.post);
}

/** Moves the hips up/down from rest (model-space metres). */
export function setHipsHeight(avatar: KitAvatar, height: number) {
  const rest = avatar.bones.Hips;
  offset.set(0, height - KIT_HIP_HEIGHT, 0).applyQuaternion(rest.pre);
  rest.bone.position.copy(rest.position).add(offset);
}

const headMatrix = new Matrix4();
/** Keeps the hat clipping plane on the head as it moves. Call after posing. */
export function updateHairClip(avatar: KitAvatar) {
  if (!avatar.hairPlaneRest) return;
  const head = avatar.bones.Head.bone;
  head.updateWorldMatrix(true, false);
  headMatrix.multiplyMatrices(head.matrixWorld, avatar.headRestInverse);
  avatar.hairPlane.copy(avatar.hairPlaneRest).applyMatrix4(headMatrix);
}

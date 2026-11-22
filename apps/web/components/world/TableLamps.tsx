"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import {
  Group,
  type InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  type Object3D,
  Vector3,
} from "three";
import { useBoardLessons } from "@/lib/learning-studio/boardLessons";
import { fadeOpacity, nearestTable, stepFade, tableCentres } from "@/lib/world/tableLamps";
import { LIBRARY_URL } from "./LibraryModel";

/**
 * The brass lamps on the study tables fade out while the table's board has a lesson on it (they
 * stood between the seats and the board) and fade back in when it ends (lib/world/tableLamps.ts).
 * The lamps are one GPU-instanced mesh per material, which can't fade one instance: so for the
 * fade a table's lamp instances are hidden and a copy of each, with its own see-through materials,
 * stands in its place; once they're fully back the instances return and the copies go.
 */

/** The lamp in the model (Blender's Prop_Lamp_Brass_01); the chandeliers' lamps don't match. */
const LAMP = /Lamp_Brass/i;
const HIDDEN = new Matrix4().makeScale(0, 0, 0);

interface TableLamps {
  tableId: string;
  /** 1 the lamps showing … 0 faded out. */
  shown: number;
  /** The stand-in copies, drawn only while the lamps aren't fully there. */
  copies: Group;
  /** The copies' own materials (one table fades without the others), with their usual opacity. */
  materials: { material: Material; opacity: number }[];
  /** The lamp instances on this table, with where each one stands. */
  instances: { mesh: InstancedMesh; index: number; matrix: Matrix4 }[];
}

/** The model's lamp meshes: instanced, named for the lamp (on the mesh or the node above it). */
function findLamps(scene: Object3D): InstancedMesh[] {
  const found: InstancedMesh[] = [];
  scene.traverse((o) => {
    const mesh = o as InstancedMesh;
    if (!mesh.isInstancedMesh) return;
    const names = [mesh.name, mesh.parent?.name ?? "", mesh.parent?.parent?.name ?? ""];
    if (names.some((n) => LAMP.test(n))) found.push(mesh);
  });
  return found;
}

/** Sorts every lamp instance onto its table and builds each table's stand-in copies. */
function buildTables(scene: Object3D, root: Group): TableLamps[] {
  scene.updateWorldMatrix(true, true);
  const centres = tableCentres();
  const tables = new Map<string, TableLamps & { own: Map<Material, Material> }>();
  const local = new Matrix4();
  const world = new Matrix4();
  const at = new Vector3();
  for (const mesh of findLamps(scene)) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, local);
      world.multiplyMatrices(mesh.matrixWorld, local);
      at.setFromMatrixPosition(world);
      const tableId = nearestTable(at.x, at.z, centres);
      if (!tableId) continue;
      let table = tables.get(tableId);
      if (!table) {
        table = {
          tableId,
          shown: 1,
          copies: new Group(),
          materials: [],
          instances: [],
          own: new Map(),
        };
        table.copies.visible = false;
        root.add(table.copies);
        tables.set(tableId, table);
      }
      const t = table;
      const own = materials.map((m) => {
        let copy = t.own.get(m);
        if (!copy) {
          copy = m.clone();
          copy.transparent = true;
          t.own.set(m, copy);
          t.materials.push({ material: copy, opacity: m.opacity });
        }
        return copy;
      });
      const copy = new Mesh(mesh.geometry, own.length === 1 ? own[0] : own);
      copy.matrixAutoUpdate = false;
      copy.matrix.copy(world);
      copy.matrixWorldNeedsUpdate = true;
      // A fading lamp's shadow can't fade with it: the copies cast none.
      copy.castShadow = false;
      copy.receiveShadow = mesh.receiveShadow;
      t.copies.add(copy);
      t.instances.push({ mesh, index: i, matrix: local.clone() });
    }
  }
  return [...tables.values()];
}

/** Hides a table's lamp instances (the copies stand in) or puts them back. */
function showInstances(table: TableLamps, shown: boolean) {
  const touched = new Set<InstancedMesh>();
  for (const { mesh, index, matrix } of table.instances) {
    mesh.setMatrixAt(index, shown ? matrix : HIDDEN);
    touched.add(mesh);
  }
  for (const mesh of touched) mesh.instanceMatrix.needsUpdate = true;
}

/** Moves each table's lamps toward whether its board has a lesson (out) or not (back in). */
function stepTables(tables: readonly TableLamps[], dt: number) {
  const { boards } = useBoardLessons.getState();
  for (const table of tables) {
    const target = boards[table.tableId] ? 0 : 1;
    if (table.shown === target) continue;
    // Leaving "fully there": the copies take over from the instances for the fade.
    if (table.shown === 1) {
      showInstances(table, false);
      table.copies.visible = true;
    }
    table.shown = stepFade(table.shown, target, dt);
    const opacity = fadeOpacity(table.shown);
    for (const { material, opacity: usual } of table.materials) material.opacity = usual * opacity;
    table.copies.visible = table.shown > 0;
    // Fully back: the instances return and the copies go.
    if (table.shown === 1) {
      showInstances(table, true);
      table.copies.visible = false;
    }
  }
}

export function TableLamps() {
  const { scene } = useGLTF(LIBRARY_URL);
  const [root] = useState(() => new Group());
  const tables = useRef<TableLamps[]>([]);

  useEffect(() => {
    const built = buildTables(scene, root);
    tables.current = built;
    return () => {
      tables.current = [];
      for (const table of built) {
        showInstances(table, true);
        root.remove(table.copies);
        for (const { material } of table.materials) material.dispose();
      }
    };
  }, [scene, root]);

  useFrame((_, rawDt) => stepTables(tables.current, Math.min(rawDt, 0.1)));

  return <primitive object={root} />;
}

/**
 * Pack step 1 of 2 for the library GLB: turns the tens of thousands of book nodes (linked
 * duplicates from Blender, each tagged with its cloth colour in extras.ovr_color) into one
 * EXT_mesh_gpu_instancing node per book variant, with the colour as the `_COLOR_0` instance
 * attribute. three.js reads that into InstancedMesh.instanceColor, so every book keeps its own
 * colour in a single draw call per variant. Step 2 is `gltf-transform optimize` (see `pnpm library:pack`).
 *
 *   node art/library/scripts/pack_books.mjs in.raw.glb out.books.glb
 */
import { MathUtils, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshGPUInstancing } from "@gltf-transform/extensions";

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error("usage: node pack_books.mjs in.glb out.glb");
  process.exit(1);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();
const scene = root.getDefaultScene() ?? root.listScenes()[0];
const buffer = root.listBuffers()[0];
const instancing = doc.createExtension(EXTMeshGPUInstancing).setRequired(true);

/**
 * Book nodes grouped by zone (their parent node, an identity empty per plan zone) and by the
 * variant mesh they share, so each room's books can be culled with the room.
 */
const groups = new Map();
for (const node of root.listNodes()) {
  const color = node.getExtras()?.ovr_color;
  const mesh = node.getMesh();
  if (!color || !mesh) continue;
  const parent = node.getParentNode();
  const key = `${parent ? parent.getName() : ""}|${mesh.getName()}`;
  if (!groups.has(key)) groups.set(key, { mesh, parent, nodes: [] });
  groups.get(key).nodes.push(node);
}

let books = 0;
for (const { mesh, parent, nodes } of groups.values()) {
  const n = nodes.length;
  const t = new Float32Array(n * 3);
  const r = new Float32Array(n * 4);
  const s = new Float32Array(n * 3);
  const c = new Float32Array(n * 3);
  const pos = [0, 0, 0];
  const rot = [0, 0, 0, 1];
  const scl = [1, 1, 1];
  nodes.forEach((node, i) => {
    MathUtils.decompose(node.getWorldMatrix(), pos, rot, scl);
    t.set(pos, i * 3);
    r.set(rot, i * 4);
    s.set(scl, i * 3);
    c.set(node.getExtras().ovr_color.slice(0, 3), i * 3);
  });
  const acc = (name, type, array) =>
    doc.createAccessor(`${mesh.getName()}_${name}`).setType(type).setArray(array).setBuffer(buffer);
  const batch = instancing
    .createInstancedMesh()
    .setAttribute("TRANSLATION", acc("t", "VEC3", t))
    .setAttribute("ROTATION", acc("r", "VEC4", r))
    .setAttribute("SCALE", acc("s", "VEC3", s))
    .setAttribute("_COLOR_0", acc("c", "VEC3", c));
  // Zone empties are identity transforms, so world-space instance transforms stay correct.
  const batchNode = doc
    .createNode(mesh.getName())
    .setMesh(mesh)
    .setExtension("EXT_mesh_gpu_instancing", batch);
  (parent ?? scene).addChild(batchNode);
  for (const node of nodes) node.dispose();
  books += n;
}

await io.write(output, doc);
console.log(`[pack_books] ${books} books -> ${groups.size} instanced batches: ${output}`);

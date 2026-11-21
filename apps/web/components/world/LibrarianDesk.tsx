"use client";

import { useEffect, useMemo } from "react";
import {
  CanvasTexture,
  Color,
  type Material,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
} from "three";
import { LIBRARIAN as L } from "@ovr/shared";

/*
 * The librarian's area under the north gallery, straight across the hall from where players
 * arrive: a walnut circulation desk (a tall counter with a green-leather ledge and a brass rail,
 * a lower work surface behind), the librarian's chair, a card catalogue, a returns cart, and a
 * hanging sign. Layout and collision live in @ovr/shared (librarianDesk.ts).
 */

/** Gold letters on library green, for the hanging sign and the brass nameplate. */
function signTexture(
  lines: { text: string; size: number; y: number }[],
  w: number,
  h: number,
  plate = false,
) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext("2d")!;
  c.fillStyle = plate ? "#b48a4c" : "#1f3a2b";
  c.fillRect(0, 0, w, h);
  c.strokeStyle = plate ? "#6e5026" : "#c9a45c";
  c.lineWidth = h * 0.04;
  c.strokeRect(h * 0.07, h * 0.07, w - h * 0.14, h - h * 0.14);
  c.fillStyle = plate ? "#2a1d10" : "#e7c77c";
  c.textAlign = "center";
  c.textBaseline = "middle";
  for (const line of lines) {
    c.font = `600 ${line.size}px Georgia, "Times New Roman", serif`;
    c.letterSpacing = `${Math.round(line.size * 0.12)}px`;
    c.fillText(line.text, w / 2, line.y);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** The card catalogue's front: rows of little drawers, each with a brass pull and label card. */
function catalogueTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 384;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#3a2314";
  c.fillRect(0, 0, 256, 384);
  const cols = 4;
  const rows = 8;
  const dw = 256 / cols;
  const dh = 384 / rows;
  for (let r = 0; r < rows; r++)
    for (let k = 0; k < cols; k++) {
      const x = k * dw;
      const y = r * dh;
      c.fillStyle = (r + k) % 2 ? "#5a3822" : "#61402a";
      c.fillRect(x + 3, y + 3, dw - 6, dh - 6);
      c.fillStyle = "#efe3c8";
      c.fillRect(x + dw / 2 - 12, y + 9, 24, 11);
      c.fillStyle = "#c39b58";
      c.beginPath();
      c.arc(x + dw / 2, y + dh - 14, 5, 0, Math.PI * 2);
      c.fill();
    }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function useMaterials() {
  const m = useMemo(() => {
    const wood = new MeshStandardMaterial({ color: "#4f2f1b", roughness: 0.5 });
    const panel = new MeshStandardMaterial({ color: "#64402a", roughness: 0.45 });
    const dark = new MeshStandardMaterial({ color: "#2c1a10", roughness: 0.6 });
    const leather = new MeshStandardMaterial({ color: "#284634", roughness: 0.7 });
    const brass = new MeshStandardMaterial({ color: "#b38a4e", metalness: 0.85, roughness: 0.32 });
    const shade = new MeshStandardMaterial({ color: "#1f5a3a", roughness: 0.35, metalness: 0.1 });
    const glow = new MeshBasicMaterial({ color: new Color("#ffe2a8"), toneMapped: false });
    const books = ["#7a2e24", "#2d4a6b", "#5b6b2f", "#8a6a2a", "#4b2f5a", "#2f5a52"].map(
      (color) => new MeshStandardMaterial({ color, roughness: 0.75 }),
    );
    const pages = new MeshStandardMaterial({ color: "#eadcc0", roughness: 0.9 });
    const leaf = new MeshStandardMaterial({ color: "#3f6b34", roughness: 0.8 });
    const sign = new MeshStandardMaterial({
      map: signTexture(
        [
          { text: "LIBRARIAN", size: 118, y: 120 },
          { text: "INFORMATION  ·  RETURNS  ·  HELP", size: 34, y: 205 },
        ],
        1024,
        277,
      ),
      roughness: 0.6,
    });
    const plate = new MeshStandardMaterial({
      map: signTexture([{ text: "Ask the Librarian", size: 44, y: 64 }], 512, 128, true),
      metalness: 0.6,
      roughness: 0.35,
    });
    const catalogue = new MeshStandardMaterial({ map: catalogueTexture(), roughness: 0.55 });
    return {
      wood,
      panel,
      dark,
      leather,
      brass,
      shade,
      glow,
      books,
      pages,
      leaf,
      sign,
      plate,
      catalogue,
    };
  }, []);
  useEffect(
    () => () => {
      for (const v of Object.values(m))
        for (const mat of Array.isArray(v) ? v : [v]) {
          (mat as MeshStandardMaterial).map?.dispose();
          (mat as Material).dispose();
        }
    },
    [m],
  );
  return m;
}

type Vec3 = [number, number, number];

function Box({
  size,
  at,
  material,
  rot,
  shadow = true,
}: {
  size: Vec3;
  at: Vec3;
  material: Material;
  rot?: Vec3;
  shadow?: boolean;
}) {
  return (
    <mesh position={at} rotation={rot} material={material} castShadow={shadow} receiveShadow>
      <boxGeometry args={size} />
    </mesh>
  );
}

/** A row of book spines standing on a shelf at (x0..x1, y, z), facing +Z. */
function Books({
  x0,
  x1,
  y,
  z,
  seed,
  m,
}: {
  x0: number;
  x1: number;
  y: number;
  z: number;
  seed: number;
  m: Material[];
}) {
  const books: { x: number; w: number; h: number; i: number }[] = [];
  let x = x0;
  let s = seed;
  while (x < x1 - 0.03) {
    s = (s * 9301 + 49297) % 233280;
    const w = 0.03 + (s % 30) / 1000;
    const h = 0.2 + (s % 70) / 1000;
    books.push({ x: x + w / 2, w, h, i: s % m.length });
    x += w + 0.004;
  }
  return books.map((b, k) => (
    <Box
      key={k}
      size={[b.w, b.h, 0.17]}
      at={[b.x, y + b.h / 2, z]}
      material={m[b.i]!}
      shadow={false}
    />
  ));
}

export function LibrarianDesk() {
  const m = useMaterials();
  const W = L.width;
  const front = L.frontZ;
  const cz = front - L.counterDepth / 2;
  const back = front - L.counterDepth;
  const wz = back - L.workDepth / 2;
  const ch = L.counterHeight;
  return (
    <group position={[L.x, 0, 0]}>
      {/* The counter: plinth, body, raised front panels, a leather-topped ledge and a brass rail. */}
      <Box size={[W + 0.06, 0.1, L.counterDepth + 0.06]} at={[0, 0.05, cz]} material={m.dark} />
      <Box
        size={[W, ch - 0.15, L.counterDepth]}
        at={[0, 0.1 + (ch - 0.15) / 2, cz]}
        material={m.wood}
      />
      {[0, 1, 2, 3].map((i) => (
        <Box
          key={i}
          size={[W / 4 - 0.16, 0.56, 0.025]}
          at={[-W / 2 + (W / 4) * (i + 0.5), 0.55, front + 0.012]}
          material={m.panel}
          shadow={false}
        />
      ))}
      <Box
        size={[W + 0.12, 0.06, L.counterDepth + 0.1]}
        at={[0, ch - 0.03, cz + 0.03]}
        material={m.dark}
      />
      <Box
        size={[W - 0.1, 0.008, L.counterDepth - 0.08]}
        at={[0, ch + 0.004, cz + 0.03]}
        material={m.leather}
        shadow={false}
      />
      <mesh
        position={[0, ch - 0.09, front + 0.06]}
        rotation={[0, 0, Math.PI / 2]}
        material={m.brass}
      >
        <cylinderGeometry args={[0.011, 0.011, W, 10]} />
      </mesh>

      {/* The work surface behind, on two drawer pedestals. */}
      <Box size={[W, 0.04, L.workDepth]} at={[0, L.workHeight - 0.02, wz]} material={m.wood} />
      {[-1, 1].map((side) => (
        <group key={side}>
          <Box
            size={[0.46, L.workHeight - 0.04, L.workDepth - 0.04]}
            at={[side * (W / 2 - 0.25), (L.workHeight - 0.04) / 2, wz]}
            material={m.wood}
          />
          {[0.18, 0.4, 0.6].map((y) => (
            <Box
              key={y}
              size={[0.38, 0.17, 0.02]}
              at={[side * (W / 2 - 0.25), y, back - L.workDepth + 0.01]}
              material={m.panel}
              rot={[0, Math.PI, 0]}
              shadow={false}
            />
          ))}
        </group>
      ))}

      {/* On the ledge: a service bell, the nameplate, a stack of books and a little plant. */}
      <group position={[-0.55, ch + 0.008, cz + 0.06]}>
        <mesh position={[0, 0.006, 0]} material={m.dark}>
          <cylinderGeometry args={[0.05, 0.055, 0.012, 20]} />
        </mesh>
        <mesh position={[0, 0.012, 0]} material={m.brass} castShadow>
          <sphereGeometry args={[0.042, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        </mesh>
        <mesh position={[0, 0.06, 0]} material={m.brass}>
          <cylinderGeometry args={[0.006, 0.008, 0.016, 8]} />
        </mesh>
      </group>
      <group position={[0.1, ch + 0.035, cz + 0.08]} rotation={[-0.35, 0, 0]}>
        <Box size={[0.32, 0.08, 0.012]} at={[0, 0, 0]} material={m.plate} shadow={false} />
      </group>
      {[0, 1, 2].map((i) => (
        <Box
          key={i}
          size={[0.24 - i * 0.02, 0.045, 0.17 - i * 0.01]}
          at={[0.75, ch + 0.03 + i * 0.046, cz + 0.02]}
          rot={[0, 0.25 - i * 0.2, 0]}
          material={m.books[i + 1]!}
        />
      ))}
      <group position={[1.25, ch + 0.008, cz + 0.02]}>
        <mesh position={[0, 0.05, 0]} material={m.dark} castShadow>
          <cylinderGeometry args={[0.06, 0.045, 0.1, 14]} />
        </mesh>
        <mesh position={[0, 0.15, 0]} material={m.leaf} castShadow>
          <icosahedronGeometry args={[0.1, 1]} />
        </mesh>
      </group>

      {/* A banker's lamp on the work surface. */}
      <group position={[-0.95, L.workHeight, wz - 0.05]}>
        <Box size={[0.2, 0.025, 0.13]} at={[0, 0.0125, 0]} material={m.brass} />
        <mesh position={[0, 0.17, 0]} material={m.brass}>
          <cylinderGeometry args={[0.008, 0.008, 0.3, 8]} />
        </mesh>
        <mesh
          position={[0, 0.33, 0.02]}
          rotation={[0, 0, Math.PI / 2]}
          material={m.shade}
          castShadow
        >
          <cylinderGeometry args={[0.07, 0.07, 0.3, 16, 1, false, 0, Math.PI]} />
        </mesh>
        <mesh position={[0, 0.31, 0.02]} rotation={[0, 0, Math.PI / 2]} material={m.glow}>
          <cylinderGeometry args={[0.02, 0.02, 0.24, 8]} />
        </mesh>
      </group>
      <pointLight
        position={[0, 2.3, front - 0.4]}
        color="#ffd59a"
        intensity={5}
        distance={6}
        decay={2}
      />

      {/* Open ledger and papers on the work surface. */}
      <Box
        size={[0.42, 0.012, 0.3]}
        at={[0.25, L.workHeight + 0.006, wz]}
        rot={[0, -0.12, 0]}
        material={m.pages}
        shadow={false}
      />

      {/* The librarian's chair, facing the counter. */}
      <group position={[L.chair.x, 0, L.chair.z]}>
        <Box size={[0.46, 0.06, 0.44]} at={[0, 0.47, 0]} material={m.leather} />
        <Box size={[0.46, 0.5, 0.05]} at={[0, 0.75, -0.22]} material={m.wood} />
        {[
          [-0.2, -0.19],
          [0.2, -0.19],
          [-0.2, 0.19],
          [0.2, 0.19],
        ].map(([x, z]) => (
          <Box key={`${x}${z}`} size={[0.04, 0.45, 0.04]} at={[x!, 0.225, z!]} material={m.dark} />
        ))}
      </group>

      {/* The card catalogue against the bookcase. */}
      <group position={[L.catalogue.x, 0, L.catalogue.z]}>
        <Box
          size={[L.catalogue.width, L.catalogue.height, L.catalogue.depth]}
          at={[0, L.catalogue.height / 2, 0]}
          material={m.wood}
        />
        <mesh position={[0, 0.62, L.catalogue.depth / 2 + 0.002]} material={m.catalogue}>
          <planeGeometry args={[L.catalogue.width - 0.08, L.catalogue.height - 0.18]} />
        </mesh>
        <Box
          size={[L.catalogue.width + 0.05, 0.04, L.catalogue.depth + 0.05]}
          at={[0, L.catalogue.height + 0.02, 0]}
          material={m.dark}
        />
      </group>

      {/* The returns cart: two shelves of books on little wheels. */}
      <group position={[L.cart.x, 0, L.cart.z]}>
        {[-1, 1].map((s) => (
          <Box
            key={s}
            size={[0.03, L.cart.height - 0.08, L.cart.depth]}
            at={[(s * L.cart.width) / 2, 0.08 + (L.cart.height - 0.08) / 2, 0]}
            material={m.wood}
          />
        ))}
        {[0.2, 0.58].map((y) => (
          <group key={y}>
            <Box size={[L.cart.width, 0.025, L.cart.depth]} at={[0, y, 0]} material={m.wood} />
            <Books
              x0={-L.cart.width / 2 + 0.04}
              x1={L.cart.width / 2 - 0.04}
              y={y + 0.0125}
              z={0}
              seed={y * 1000}
              m={m.books}
            />
          </group>
        ))}
        {[-1, 1].flatMap((sx) =>
          [-1, 1].map((sz) => (
            <mesh
              key={`${sx}${sz}`}
              position={[sx * 0.36, 0.04, sz * 0.16]}
              rotation={[0, 0, Math.PI / 2]}
              material={m.dark}
            >
              <cylinderGeometry args={[0.04, 0.04, 0.025, 12]} />
            </mesh>
          )),
        )}
      </group>

      {/* The sign, hung from the gallery on brass rods. */}
      <group position={[0, L.sign.y, L.sign.z]}>
        <Box
          size={[L.sign.width + 0.06, L.sign.height + 0.06, 0.04]}
          at={[0, 0, -0.005]}
          material={m.dark}
        />
        <mesh position={[0, 0, 0.0155]} material={m.sign}>
          <planeGeometry args={[L.sign.width, L.sign.height]} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh
            key={s}
            position={[s * (L.sign.width / 2 - 0.15), (4.2 - L.sign.y) / 2 + L.sign.height / 4, 0]}
            material={m.brass}
          >
            <cylinderGeometry args={[0.008, 0.008, 4.2 - L.sign.y - L.sign.height / 2, 6]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

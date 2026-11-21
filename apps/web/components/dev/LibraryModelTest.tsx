"use client";

/**
 * Dev-only performance test for the Blender-built library (art/library → public/models/library).
 * Loads the GLB as exported (GPU instances, meshopt, WebP) with simple daylight and shows frame
 * rate, draw calls and triangles, so we can see what the browser can afford before integrating it.
 */
import { OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { type Mesh, NeutralToneMapping, Vector3 } from "three";

const MODEL_URL = "/models/library/library.glb";

const VIEWS: Record<string, { pos: [number, number, number]; target: [number, number, number] }> = {
  hero: { pos: [0, 1.62, 5], target: [0, 5.5, -10] },
  west: { pos: [9, 1.7, -1], target: [-14, 4, -1] },
  gallery: { pos: [11.4, 6.25, -8.7], target: [-3, 1.8, 2.5] },
  table: { pos: [-1.05, 1.22, 0.2], target: [-2.6, 0.95, -5.4] },
};

interface Stats {
  fps: number;
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

function Model({ shadows }: { shadows: boolean }) {
  const { scene } = useGLTF(MODEL_URL);
  useEffect(() => {
    scene.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        m.castShadow = shadows;
        m.receiveShadow = shadows;
      }
    });
  }, [scene, shadows]);
  return <primitive object={scene} />;
}

function Probe({ onStats }: { onStats: (s: Stats) => void }) {
  const gl = useThree((s) => s.gl);
  const acc = useRef({ frames: 0, time: 0 });
  useFrame((_, dt) => {
    acc.current.frames += 1;
    acc.current.time += dt;
    if (acc.current.time >= 0.5) {
      const info = gl.info;
      onStats({
        fps: acc.current.frames / acc.current.time,
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      });
      acc.current = { frames: 0, time: 0 };
    }
  });
  return null;
}

/** Exposes the scene for profiling from the console: window.__libtest.{scene, gl, camera}. */
function DebugHandle() {
  const state = useThree();
  useEffect(() => {
    (window as unknown as { __libtest: unknown }).__libtest = {
      scene: state.scene,
      gl: state.gl,
      camera: state.camera,
    };
  }, [state.scene, state.gl, state.camera]);
  return null;
}

function CameraView({ view }: { view: string }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as {
    target: Vector3;
    update: () => void;
  } | null;
  useEffect(() => {
    const v = VIEWS[view];
    if (!v) return;
    camera.position.set(...v.pos);
    if (controls) {
      controls.target.set(...v.target);
      controls.update();
    } else {
      camera.lookAt(new Vector3(...v.target));
    }
  }, [view, camera, controls]);
  return null;
}

export default function LibraryModelTest() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [shadows, setShadows] = useState(false);
  const [view, setView] = useState("hero");
  const sun = useMemo(() => new Vector3(-0.5, 0.75, -1).normalize().multiplyScalar(60), []);

  return (
    <div className="fixed inset-0 bg-black">
      <Canvas
        shadows={shadows ? "percentage" : false}
        dpr={[1, 1.5]}
        gl={{
          antialias: true,
          powerPreference: "high-performance",
          toneMapping: NeutralToneMapping,
        }}
        camera={{ fov: 60, near: 0.05, far: 600, position: VIEWS.hero!.pos }}
      >
        <color attach="background" args={["#bcd3ea"]} />
        <hemisphereLight args={["#f3ead9", "#5a4030", 1.1]} />
        <ambientLight intensity={0.25} />
        <directionalLight
          position={sun}
          intensity={3.2}
          color="#ffe2bc"
          castShadow={shadows}
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-30}
          shadow-camera-right={30}
          shadow-camera-top={30}
          shadow-camera-bottom={-30}
          shadow-camera-far={140}
        />
        <pointLight position={[-5.7, 7.2, -1]} intensity={60} distance={26} color="#ffc98a" />
        <pointLight position={[5.7, 7.2, -1]} intensity={60} distance={26} color="#ffc98a" />
        <Suspense fallback={null}>
          <Model shadows={shadows} />
        </Suspense>
        <OrbitControls makeDefault enableDamping />
        <CameraView view={view} />
        <Probe onStats={setStats} />
        <DebugHandle />
      </Canvas>
      <div className="pointer-events-auto absolute left-3 top-3 rounded-xl bg-black/70 p-3 font-mono text-xs text-white">
        <div>library model test · {MODEL_URL}</div>
        {stats ? (
          <div data-testid="stats">
            fps {stats.fps.toFixed(0)} · calls {stats.calls} · tris{" "}
            {(stats.triangles / 1e6).toFixed(2)}M · geoms {stats.geometries} · textures{" "}
            {stats.textures}
          </div>
        ) : (
          <div>loading…</div>
        )}
        <div className="mt-2 flex gap-2">
          {Object.keys(VIEWS).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setView(k)}
              className={`rounded px-2 py-1 ${view === k ? "bg-white text-black" : "bg-white/15"}`}
            >
              {k}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShadows((s) => !s)}
            className="rounded bg-white/15 px-2 py-1"
          >
            shadows {shadows ? "on" : "off"}
          </button>
        </div>
      </div>
    </div>
  );
}

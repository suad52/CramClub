"use client";

import { useEffect, useMemo } from "react";
import { BackSide, Color, ShaderMaterial } from "three";

/** A soft daylight sky behind the windows: warm at the horizon, clear blue overhead. */
function skyMaterial() {
  return new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new Color("#7fb2e3") },
      horizon: { value: new Color("#f7ead2") },
      bottom: { value: new Color("#b9c79a") },
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
        vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.5)) : mix(horizon, bottom, pow(-h, 0.4));
        gl_FragColor = vec4(c * 1.35, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

export function Sky() {
  const material = useMemo(() => skyMaterial(), []);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh material={material} renderOrder={-1}>
      <sphereGeometry args={[300, 32, 16]} />
    </mesh>
  );
}

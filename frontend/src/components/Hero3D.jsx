/* Landing hero: a slowly rotating "data constellation" point cloud that leans
   toward the cursor and ripples where the pointer passes. GPU shader driven so it
   stays at 60fps with a capped DPR. */
import { useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useTheme } from '../lib/theme';

const COUNT = 4200;

const vertex = /* glsl */ `
  uniform float uTime;
  uniform vec2 uPointer;
  uniform float uReduced;
  attribute float aScale;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vGlow;

  void main() {
    vec3 p = position;
    float t = uTime * (1.0 - 0.85 * uReduced);
    // gentle breathing wave through the cloud
    p.y += sin(t * 0.5 + p.x * 0.35) * 0.22;
    p.x += cos(t * 0.4 + p.z * 0.3) * 0.18;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    // pointer ripple in view space
    vec2 toPointer = mv.xy - uPointer * 6.0;
    float d = length(toPointer);
    float push = smoothstep(3.2, 0.0, d) * 0.9;
    mv.xy += normalize(toPointer + 0.0001) * push;
    vGlow = push;

    gl_Position = projectionMatrix * mv;
    gl_PointSize = aScale * (44.0 / -mv.z) * (1.0 + push * 0.8);
    vColor = aColor;
  }
`;

const fragment = /* glsl */ `
  varying vec3 vColor;
  varying float vGlow;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float alpha = smoothstep(0.5, 0.06, d);
    vec3 c = mix(vColor, vec3(1.0), vGlow * 0.55);
    gl_FragColor = vec4(c, alpha * (0.55 + vGlow * 0.45));
  }
`;

function Constellation() {
  const t = useTheme();
  const mesh = useRef();
  const material = useRef();
  const { size } = useThree();
  const pointer = useRef(new THREE.Vector2(0, 0));
  const target = useRef(new THREE.Vector2(0, 0));

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(COUNT * 3);
    const scales = new Float32Array(COUNT);
    const colors = new Float32Array(COUNT * 3);
    const palette = t.colors.slice(0, 4).map((hex) => new THREE.Color(hex));
    for (let i = 0; i < COUNT; i += 1) {
      const mode = i % 3;
      let x;
      let y;
      let z;
      if (mode === 0) {
        // scatter shell
        const r = 5.2 + Math.random() * 3.6;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        x = r * Math.sin(phi) * Math.cos(theta);
        y = r * Math.cos(phi) * 0.55;
        z = r * Math.sin(phi) * Math.sin(theta);
      } else if (mode === 1) {
        // gridded "plot floor"
        x = (Math.random() - 0.5) * 17;
        z = (Math.random() - 0.5) * 17;
        y = -3.4 + Math.sin(x * 0.5) * 0.5 + Math.cos(z * 0.45) * 0.5;
      } else {
        // rising helix of series points
        const a = (i / COUNT) * Math.PI * 14;
        const r = 2.4 + (i / COUNT) * 3.2;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
        y = -3 + (i / COUNT) * 7.5;
      }
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      scales[i] = 0.5 + Math.random() * 1.5;
      const c = palette[mode === 2 ? 0 : mode % palette.length].clone();
      c.multiplyScalar(0.65 + Math.random() * 0.5);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    return g;
  }, [t.palette, t.colors]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uPointer: { value: new THREE.Vector2(0, 0) },
      uReduced: { value: t.reducedMotion ? 1 : 0 },
    }),
    [t.reducedMotion],
  );

  useFrame((state, delta) => {
    const [px, py] = [state.pointer.x, state.pointer.y];
    target.current.set(px, py);
    pointer.current.lerp(target.current, 0.08);
    if (material.current) {
      material.current.uniforms.uTime.value += delta;
      material.current.uniforms.uPointer.value.copy(pointer.current);
    }
    if (mesh.current) {
      const speed = t.reducedMotion ? 0 : 0.055;
      mesh.current.rotation.y += delta * speed;
      mesh.current.rotation.x = THREE.MathUtils.lerp(
        mesh.current.rotation.x,
        -pointer.current.y * 0.28,
        0.05,
      );
      mesh.current.rotation.z = THREE.MathUtils.lerp(
        mesh.current.rotation.z,
        pointer.current.x * 0.1,
        0.05,
      );
    }
  });

  return (
    <points ref={mesh} geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={vertex}
        fragmentShader={fragment}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

export default function Hero3D() {
  const t = useTheme();
  return (
    <div className="absolute inset-0" aria-hidden="true">
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 1.6, 15], fov: 46 }}
        gl={{ antialias: false, alpha: true, powerPreference: 'high-performance' }}
      >
        <Constellation />
      </Canvas>
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            t.mode === 'dark'
              ? 'radial-gradient(72% 55% at 50% 42%, transparent 32%, rgb(8 12 15 / 0.72) 78%, rgb(8 12 15) 100%)'
              : 'radial-gradient(72% 55% at 50% 42%, transparent 30%, rgb(244 245 243 / 0.8) 76%, rgb(244 245 243) 100%)',
        }}
      />
    </div>
  );
}

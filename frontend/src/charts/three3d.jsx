/* Three.js charts via react-three-fiber: 3D scatter, 3D surface, 3D bars.
   Orbit controls, axis labels, glow-ish additive points, DPR capped for 60fps. */
import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useTheme } from '../lib/theme';
import { fmtNum, truncate } from '../lib/format';

export const THREE_TYPES = new Set(['scatter3d', 'surface3d', 'bar3d']);

const SIZE = 10;

export default function ThreeView({ slide }) {
  const t = useTheme();
  return (
    <Canvas
      dpr={[1, 1.6]}
      camera={{ position: [18, 13.5, 20], fov: 40 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      style={{ width: '100%', height: '100%' }}
      aria-label={slide.title}
    >
      <color attach="background" args={[t.mode === 'dark' ? '#0c1317' : '#f7f8f7']} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[9, 14, 8]} intensity={1.15} />
      <pointLight position={[-10, 6, -8]} intensity={0.5} color={t.colors[1]} />
      <FitCamera />
      <Frame theme={t} />
      {slide.type === 'scatter3d' && <Scatter3D data={slide.data} theme={t} />}
      {slide.type === 'surface3d' && <Surface3D data={slide.data} theme={t} />}
      {slide.type === 'bar3d' && <Bar3D data={slide.data} theme={t} />}
      <OrbitControls
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        minDistance={14}
        maxDistance={40}
        autoRotate={!t.reducedMotion}
        autoRotateSpeed={0.55}
        makeDefault
      />
    </Canvas>
  );
}

function FitCamera() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(size.height, 1);
    const k = aspect < 1.25 ? Math.min(2.1, (1.25 / Math.max(aspect, 0.35)) ** 0.75) : 1;
    camera.position.set(18 * k, 13.5 * k, 20 * k);
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

function Frame({ theme }) {
  const color = theme.mode === 'dark' ? '#22303a' : '#cfd6d2';
  return (
    <group position={[0, 0, 0]}>
      <gridHelper args={[SIZE * 2, 16, color, color]} position={[0, -0.01, 0]} />
      <lineSegments position={[0, SIZE / 2, 0]}>
        <edgesGeometry args={[new THREE.BoxGeometry(SIZE * 2, SIZE, SIZE * 2)]} />
        <lineBasicMaterial color={color} transparent opacity={0.55} />
      </lineSegments>
    </group>
  );
}

function AxisLabel({ position, children, color }) {
  return (
    <Html position={position} center distanceFactor={26} zIndexRange={[10, 0]}>
      <span
        style={{ color, fontSize: 11, fontFamily: 'Satoshi, system-ui', whiteSpace: 'nowrap' }}
        className="num"
      >
        {children}
      </span>
    </Html>
  );
}

function useNorm(points, axes) {
  return useMemo(() => {
    const keys = ['x', 'y', 'z'];
    const ranges = keys.map((k) => {
      const vals = points.map((p) => p[k]);
      return [Math.min(...vals), Math.max(...vals)];
    });
    const scale = (v, i) => {
      const [lo, hi] = ranges[i];
      return hi === lo ? 0 : ((v - lo) / (hi - lo)) * SIZE * 1.7 - SIZE * 0.85;
    };
    return { ranges, scale };
  }, [points, axes]);
}

function Scatter3D({ data, theme }) {
  const { points, axes, groups } = data;
  const { ranges, scale } = useNorm(points, axes);
  const groupNames = useMemo(() => [...new Set(groups || [])], [groups]);
  const ref = useRef();

  const { positions, colors } = useMemo(() => {
    const pos = new Float32Array(points.length * 3);
    const col = new Float32Array(points.length * 3);
    const c = new THREE.Color();
    points.forEach((p, i) => {
      pos[i * 3] = scale(p.x, 0);
      pos[i * 3 + 1] = ((scale(p.y, 1) + SIZE * 0.85) / 1.7) * 0.98;
      pos[i * 3 + 2] = scale(p.z, 2);
      const hex = groups
        ? theme.colors[groupNames.indexOf(groups[i]) % theme.colors.length]
        : theme.colors[0];
      c.set(hex);
      const depth = 0.55 + 0.45 * ((p.z - ranges[2][0]) / (ranges[2][1] - ranges[2][0] || 1));
      col[i * 3] = c.r * depth;
      col[i * 3 + 1] = c.g * depth;
      col[i * 3 + 2] = c.b * depth;
    });
    return { positions: pos, colors: col };
  }, [points, groups, theme.palette, theme.colors, groupNames, ranges, scale]);

  useFrame((state) => {
    if (ref.current && !theme.reducedMotion) {
      const s = 1 + Math.sin(state.clock.elapsedTime * 1.4) * 0.045;
      ref.current.material.size = 0.3 * s;
    }
  });

  return (
    <group>
      <points ref={ref}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.3}
          vertexColors
          sizeAttenuation
          transparent
          opacity={0.95}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
      <AxisLabel position={[SIZE * 0.95, 0.4, 0]} color={theme.chrome.text}>
        {truncate(axes[0], 16)}
      </AxisLabel>
      <AxisLabel position={[-SIZE, SIZE * 1.02, 0]} color={theme.chrome.text}>
        {truncate(axes[1], 16)}
      </AxisLabel>
      <AxisLabel position={[0, 0.4, SIZE * 0.95]} color={theme.chrome.text}>
        {truncate(axes[2], 16)}
      </AxisLabel>
    </group>
  );
}

function Surface3D({ data, theme }) {
  const { z, axes, xTicks, yTicks } = data;
  const geom = useMemo(() => {
    const rows = z.length;
    const cols = z[0].length;
    const flat = z.flat();
    const lo = Math.min(...flat);
    const hi = Math.max(...flat);
    const g = new THREE.PlaneGeometry(SIZE * 1.7, SIZE * 1.7, cols - 1, rows - 1);
    const pos = g.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cLow = new THREE.Color(theme.colors[1]);
    const cHigh = new THREE.Color(theme.colors[0]);
    for (let i = 0; i < pos.count; i += 1) {
      const r = Math.floor(i / cols);
      const cc = i % cols;
      const v = z[Math.min(r, rows - 1)][Math.min(cc, cols - 1)];
      const f = hi === lo ? 0.5 : (v - lo) / (hi - lo);
      pos.setZ(i, f * SIZE * 0.92);
      const mix = cLow.clone().lerp(cHigh, f);
      colors[i * 3] = mix.r;
      colors[i * 3 + 1] = mix.g;
      colors[i * 3 + 2] = mix.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }, [z, theme.palette, theme.colors]);

  return (
    <group rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.2, 0]}>
      <mesh geometry={geom}>
        <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.42} metalness={0.12} flatShading={false} />
      </mesh>
      <mesh geometry={geom}>
        <meshBasicMaterial wireframe color={theme.mode === 'dark' ? '#0b1116' : '#ffffff'} transparent opacity={0.14} />
      </mesh>
      <Html position={[SIZE * 0.9, -SIZE * 0.95, 0]} center distanceFactor={26}>
        <span style={{ color: theme.chrome.text, fontSize: 11 }}>{truncate(axes[0], 14)}</span>
      </Html>
      <Html position={[-SIZE * 0.95, SIZE * 0.9, 0]} center distanceFactor={26}>
        <span style={{ color: theme.chrome.text, fontSize: 11 }}>{truncate(axes[1], 14)}</span>
      </Html>
    </group>
  );
}

function Bar3D({ data, theme }) {
  const { rows, cols, values } = data;
  const max = Math.max(...values.flat().map((v) => Math.abs(v || 0))) || 1;
  const stepX = (SIZE * 1.7) / Math.max(rows.length, 1);
  const stepZ = (SIZE * 1.7) / Math.max(cols.length, 1);
  const bw = Math.min(stepX, stepZ) * 0.62;
  return (
    <group position={[-SIZE * 0.85 + stepX / 2, 0, -SIZE * 0.85 + stepZ / 2]}>
      {rows.map((rowLabel, i) =>
        cols.map((colLabel, j) => {
          const v = Math.abs(values[i][j] || 0);
          const height = Math.max((v / max) * SIZE * 0.92, 0.02);
          return (
            <mesh
              key={`${rowLabel}-${colLabel}`}
              position={[i * stepX, height / 2, j * stepZ]}
              castShadow
            >
              <boxGeometry args={[bw, height, bw]} />
              <meshStandardMaterial
                color={theme.colors[j % theme.colors.length]}
                roughness={0.35}
                metalness={0.18}
                emissive={theme.colors[j % theme.colors.length]}
                emissiveIntensity={0.14}
              />
            </mesh>
          );
        }),
      )}
      {rows.map((rowLabel, i) => (
        <Html key={`r-${rowLabel}`} position={[i * stepX, -0.2, -stepZ * 0.9]} center distanceFactor={30}>
          <span style={{ color: theme.chrome.text, fontSize: 10, whiteSpace: 'nowrap' }}>
            {truncate(rowLabel, 10)}
          </span>
        </Html>
      ))}
      {cols.slice(0, 8).map((colLabel, j) => (
        <Html
          key={`c-${colLabel}`}
          position={[-stepX * 0.9, -0.2, j * stepZ]}
          center
          distanceFactor={30}
        >
          <span style={{ color: theme.colors[j % theme.colors.length], fontSize: 10, whiteSpace: 'nowrap' }}>
            {truncate(colLabel, 10)}
          </span>
        </Html>
      ))}
      <Html position={[SIZE * 0.2, SIZE * 1.05, 0]} center distanceFactor={30}>
        <span style={{ color: theme.chrome.text, fontSize: 10 }}>peak {fmtNum(max)}</span>
      </Html>
    </group>
  );
}

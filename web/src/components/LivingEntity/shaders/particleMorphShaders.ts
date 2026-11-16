/**
 * GLSL Shaders — Gobinda-Das particle-morphing-3js style
 *
 * Simplex Noise-delayed morphing between two arbitrary 3D positions.
 * This creates the flowing plasma / liquid morph effect as seen in cinematic sci-fi.
 * Includes uExplode uniform for cinematic multi-layer disassembly on voice command.
 */

// Simplex Noise (inlined for Vite TS compatibility)
const SIMPLEX_NOISE_GLSL = /* glsl */`
vec4 permute(vec4 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

float simplexNoise3d(vec3 v) {
  const vec2  C = vec2(1.0/6.0, 1.0/3.0);
  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 =   v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + 1.0 * C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0/7.0;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

export const particleMorphVertexShader = /* glsl */`
#define PI 3.141592653589793

uniform vec2 uResolution;
uniform float uSize;
uniform float uProgress;
uniform float uExplode;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uTime;

attribute vec3 aPositionTarget;
attribute float aSize;

varying vec3 vColor;

${SIMPLEX_NOISE_GLSL}

void main() {
  // Noise-based staggered delay: each particle morphs at a slightly different time
  float noise = simplexNoise3d(mix(position * 0.2, aPositionTarget * 0.2, uProgress));
  noise = smoothstep(-1.0, 1.0, noise);

  float duration = 0.4;
  float delay = (1.0 - duration) * noise;
  float end = delay + duration;
  float progress = smoothstep(delay, end, uProgress);

  vec3 mixedPosition = mix(position, aPositionTarget, progress);

  // Kinematic Layer Explosion
  vec3 explodeOffset = vec3(0.0);
  if (uExplode > 0.001) {
    if (abs(mixedPosition.y) > 0.45) {
      explodeOffset.y = sign(mixedPosition.y) * uExplode * 1.85;
    } else {
      vec3 radial = normalize(vec3(mixedPosition.x, 0.0, mixedPosition.z) + vec3(0.001));
      explodeOffset = radial * (uExplode * 1.4);
    }
  }

  // Organic living movement wave (audio-reactive via uSize which carries amplitude)
  float movement = sin(uTime * aSize * 10.0 + PI / 2.0) * 0.025 * noise * (aSize + 0.5);

  vec4 modelPosition = modelMatrix * vec4(mixedPosition + explodeOffset + movement, 1.0);
  vec4 viewPosition = viewMatrix * modelPosition;
  vec4 projectedPosition = projectionMatrix * viewPosition;
  gl_Position = projectedPosition;

  // Point size with perspective attenuation — calibrated for razor-sharp micro pinpoints
  gl_PointSize = uSize * aSize * uResolution.y * 0.42;
  gl_PointSize *= (1.0 / -viewPosition.z);
  gl_PointSize = clamp(gl_PointSize, 1.2, 10.0);

  // Color gradient based on noise field (gives each cluster a distinct hue)
  vColor = mix(uColorA, uColorB, noise);
}
`;

export const particleMorphFragmentShader = /* glsl */`
varying vec3 vColor;

void main() {
  vec2 uv = gl_PointCoord;
  float distanceToCenter = length(uv - 0.5);
  if (distanceToCenter > 0.5) discard;

  // Sharp luminous core with anti-blowout clamping for dense clusters
  float alpha = clamp(0.045 / distanceToCenter - 0.09, 0.0, 0.85);

  gl_FragColor = vec4(vColor, alpha);
}
`;

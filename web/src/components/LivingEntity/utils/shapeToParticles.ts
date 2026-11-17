/**
 * CINEMATIC VOLUMETRIC 3D PARTICLE GENERATORS
 *
 * Produces mathematical 3D point clouds (x, y, z) for JARVIS Holographic Engine:
 * 1. Fibonacci Sphere — Living Stardust Golden JARVIS entity (idle)
 * 2. CPU Die — True volumetric Intel Core i3 (3D LGA Pins, Silicon Cores, L3 Cache, IHS Lid)
 * 3. Brain — Human/AI dual-hemisphere brain with cortical gyri, sulci, and synaptic lattice
 * 4. DNA Helix — Biological B-DNA double helix with horizontal base-pair rungs
 * 5. Globe — Earth planetary sphere with continents, latitude/longitude parallels, and satellite orbit
 * 6. Cyber Shield — Curved hexagonal energy barrier with central security lock core
 * 7. Arc Reactor — Stark toroidal magnetic coils with central cold-fusion plasma vortex
 * 8. Holo Window — Curved 3D floating holographic display workspace with code/data columns
 */

import * as THREE from "three";

export const PARTICLE_COUNT = 5500;

export type MorphShapeKey =
  | "sphere"
  | "cpu"
  | "neural"
  | "dna"
  | "globe"
  | "shield"
  | "reactor"
  | "window";

/**
 * 1. FIBONACCI SPHERE (Idle Living Stardust Entity)
 */
export function generateFibonacciSphere(count = PARTICLE_COUNT, radius = 2.45): Float32Array {
  const pos = new Float32Array(count * 3);
  const goldenRatio = (1 + Math.sqrt(5)) / 2;
  const angleIncrement = Math.PI * 2 * goldenRatio;

  for (let i = 0; i < count; i++) {
    const t = i / count;
    const inclination = Math.acos(1 - 2 * t);
    const azimuth = angleIncrement * i;
    const r = radius * (1.0 + Math.sin(i * 12.34) * 0.035);

    pos[i * 3]     = r * Math.sin(inclination) * Math.cos(azimuth);
    pos[i * 3 + 1] = r * Math.sin(inclination) * Math.sin(azimuth);
    pos[i * 3 + 2] = r * Math.cos(inclination);
  }
  return pos;
}

/**
 * 2. 3D VOLUMETRIC CPU SILICON DIE & MICROARCHITECTURE
 * Modeled after Intel Core i3:
 * - LGA pin grid underneath (y = -0.75)
 * - PCB substrate & bus traces (y = -0.35)
 * - 4 Silicon Cores + Intel UHD 620 + L3 Cache (y = 0.0)
 * - Beveled IHS Heat Spreader on top (y = 0.65)
 */
export function generateCpuDie(count = PARTICLE_COUNT, size = 3.6): Float32Array {
  const pos = new Float32Array(count * 3);
  const half = size / 2;

  const countPins      = Math.floor(count * 0.28);
  const countSubstrate = Math.floor(count * 0.14);
  const countSilicon   = Math.floor(count * 0.32);
  const countTraces    = Math.floor(count * 0.12);
  const countIHS       = count - (countPins + countSubstrate + countSilicon + countTraces);

  let idx = 0;

  // A. 3D LGA Pin Grid (Underside: y from -0.85 to -0.65)
  const pinRows = 24;
  for (let i = 0; i < countPins; i++) {
    const rIdx = i % (pinRows * pinRows);
    const row = Math.floor(rIdx / pinRows);
    const col = rIdx % pinRows;
    const px = (col / (pinRows - 1) - 0.5) * (size * 0.88);
    const pz = (row / (pinRows - 1) - 0.5) * (size * 0.88);
    const pinH = ((i % 3) / 2) * 0.2;

    pos[idx * 3]     = px + (Math.random() - 0.5) * 0.02;
    pos[idx * 3 + 1] = -0.85 + pinH;
    pos[idx * 3 + 2] = pz + (Math.random() - 0.5) * 0.02;
    idx++;
  }

  // B. PCB Substrate Boundary & Alignment Notches (y = -0.38)
  for (let i = 0; i < countSubstrate; i++) {
    const perim = Math.random() * 4;
    let x = 0, z = 0;
    if (perim < 1) { x = (perim - 0.5) * size; z = -half; }
    else if (perim < 2) { x = half; z = (perim - 1.5) * size; }
    else if (perim < 3) { x = (2.5 - perim) * size; z = half; }
    else { x = -half; z = (3.5 - perim) * size; }

    pos[idx * 3]     = x;
    pos[idx * 3 + 1] = -0.38 + (Math.random() - 0.5) * 0.08;
    pos[idx * 3 + 2] = z;
    idx++;
  }

  // C. 4 Silicon Cores + Intel UHD GPU Die + L3 Cache
  const cores = [
    { cx: -0.8, cz: -0.6, w: 0.9, h: 0.8 },
    { cx:  0.8, cz: -0.6, w: 0.9, h: 0.8 },
    { cx: -0.8, cz:  0.6, w: 0.9, h: 0.8 },
    { cx:  0.8, cz:  0.6, w: 0.9, h: 0.8 },
    { cx:  0.0, cz:  0.0, w: 2.2, h: 0.35 },
    { cx:  0.0, cz:  1.3, w: 1.8, h: 0.65 },
  ];

  for (let i = 0; i < countSilicon; i++) {
    const block = cores[i % cores.length];
    const bx = block.cx + (Math.random() - 0.5) * block.w;
    const bz = block.cz + (Math.random() - 0.5) * block.h;
    const by = -0.05 + Math.random() * 0.12;

    pos[idx * 3]     = bx;
    pos[idx * 3 + 1] = by;
    pos[idx * 3 + 2] = bz;
    idx++;
  }

  // D. Circuit Traces & Golden Interconnect Vias
  for (let i = 0; i < countTraces; i++) {
    const angle = (i / countTraces) * Math.PI * 2;
    const r = 1.1 + (i % 7) * 0.18;
    pos[idx * 3]     = Math.cos(angle) * r;
    pos[idx * 3 + 1] = -0.22 + (Math.random() - 0.5) * 0.05;
    pos[idx * 3 + 2] = Math.sin(angle) * r;
    idx++;
  }

  // E. Beveled IHS Heat Spreader Lid (y = 0.55 to 0.85)
  const ihsSize = size * 0.76;
  const ihsHalf = ihsSize / 2;
  for (let i = 0; i < countIHS; i++) {
    if (i < countIHS * 0.65) {
      pos[idx * 3]     = (Math.random() - 0.5) * ihsSize;
      pos[idx * 3 + 1] = 0.85 + (Math.random() - 0.5) * 0.04;
      pos[idx * 3 + 2] = (Math.random() - 0.5) * ihsSize;
    } else {
      const side = i % 4;
      const frac = (Math.random() - 0.5) * ihsSize;
      let x = 0, z = 0;
      if (side === 0) { x = frac; z = -ihsHalf; }
      else if (side === 1) { x = frac; z = ihsHalf; }
      else if (side === 2) { x = -ihsHalf; z = frac; }
      else { x = ihsHalf; z = frac; }
      pos[idx * 3]     = x;
      pos[idx * 3 + 1] = 0.65 + Math.random() * 0.22;
      pos[idx * 3 + 2] = z;
    }
    idx++;
  }

  return pos;
}

/**
 * 3. 3D VOLUMETRIC SYNAPTIC BRAIN & NEURAL LATTICE
 * Dual cerebral hemispheres with realistic cortical gyri/sulci,
 * cerebellum, and internal synaptic impulse paths.
 */
export function generateBrain(count = PARTICLE_COUNT, radius = 2.5): Float32Array {
  const pos = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    // 70% Cerebral Cortex with Gyri & Sulci folds
    if (i < count * 0.7) {
      const u = Math.random();
      const v = Math.random();
      const theta = u * Math.PI * 2;
      const phi = Math.acos(2 * v - 1);

      // Separate left and right hemispheres along X=0
      const side = Math.random() > 0.5 ? 1 : -1;

      // Realistic brain ellipsoid stretch (longer in Z, slightly wider in X)
      const baseR = radius * (0.85 + 0.15 * Math.sin(phi));
      // Convolutions (sulci & gyri) via spherical harmonics
      const gyri = 1.0 + 0.14 * Math.sin(theta * 6) * Math.cos(phi * 5)
                       + 0.08 * Math.sin(phi * 10);

      const x = (Math.sin(phi) * Math.sin(theta) * 0.88 * baseR * gyri) + (side * 0.22);
      const y = (Math.cos(phi) * 0.92 * baseR * gyri) + 0.1;
      const z = (Math.sin(phi) * Math.cos(theta) * 1.15 * baseR * gyri) - 0.1;

      pos[i * 3]     = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
    }
    // 15% Cerebellum at the lower posterior (bottom back)
    else if (i < count * 0.85) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.8;
      const cx = (Math.random() > 0.5 ? 1 : -1) * 0.45 + Math.cos(angle) * r * 0.6;
      const cy = -1.1 + (Math.random() - 0.5) * 0.5;
      const cz = -1.2 + Math.sin(angle) * r * 0.6;

      pos[i * 3]     = cx;
      pos[i * 3 + 1] = cy;
      pos[i * 3 + 2] = cz;
    }
    // 15% Synaptic Nodes and Impulses flowing internally
    else {
      const r = Math.random() * radius * 0.65;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.random() * Math.PI;

      pos[i * 3]     = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.cos(ph) * 0.8;
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th) * 0.9;
    }
  }
  return pos;
}

/**
 * 4. 3D BIOLOGICAL DNA DOUBLE HELIX
 * Two intertwined helical sugar-phosphate backbones connected by
 * horizontal Adenine-Thymine / Guanine-Cytosine base-pair rungs.
 */
export function generateDnaHelix(count = PARTICLE_COUNT, height = 5.2, radius = 1.35, turns = 3.2): Float32Array {
  const pos = new Float32Array(count * 3);
  const countBackbone = Math.floor(count * 0.7);
  const countRungs    = count - countBackbone;

  // Helical Strands (Backbone 1 & 2)
  for (let i = 0; i < countBackbone; i++) {
    const t = i / countBackbone;
    const strand = i % 2; // 0 = Strand A, 1 = Strand B (shifted by PI)
    const angle = t * turns * Math.PI * 2 + (strand * Math.PI);
    const y = (t - 0.5) * height;
    const r = radius + (Math.random() - 0.5) * 0.08;

    pos[i * 3]     = r * Math.cos(angle);
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = r * Math.sin(angle);
  }

  // Base Pair Rungs (Connecting bridges)
  const rungSteps = 36;
  for (let i = 0; i < countRungs; i++) {
    const rungIdx = Math.floor(Math.random() * rungSteps);
    const t = rungIdx / rungSteps;
    const angle = t * turns * Math.PI * 2;
    const y = (t - 0.5) * height;

    // Linear interpolation between Strand A (+angle) and Strand B (+angle + PI)
    const frac = (Math.random() - 0.5) * 2.0; // -1 to 1
    pos[(countBackbone + i) * 3]     = radius * Math.cos(angle) * frac;
    pos[(countBackbone + i) * 3 + 1] = y + (Math.random() - 0.5) * 0.04;
    pos[(countBackbone + i) * 3 + 2] = radius * Math.sin(angle) * frac;
  }

  return pos;
}

/**
 * 5. 3D PLANETARY GLOBE & CONTINENTAL ORBITS
 * Volumetric spherical coordinates with continental landmass clusters,
 * latitude/longitude parallels, and an inclined satellite orbit.
 */
export function generateGlobe(count = PARTICLE_COUNT, radius = 2.45): Float32Array {
  const pos = new Float32Array(count * 3);
  const countContinents = Math.floor(count * 0.55);
  const countParallels  = Math.floor(count * 0.25);
  const countOrbit      = Math.floor(count * 0.12);
  const countAtmosphere = count - (countContinents + countParallels + countOrbit);

  let idx = 0;

  // Continental clusters (approximating Africa, Eurasia, Americas, Australia)
  const continentCenters = [
    { lat: 0.1,  lon: 0.35, spread: 0.45 },  // Africa
    { lat: 0.8,  lon: 1.2,  spread: 0.75 },  // Eurasia
    { lat: 0.65, lon: -1.7, spread: 0.60 },  // North America
    { lat: -0.3, lon: -1.0, spread: 0.45 },  // South America
    { lat: -0.4, lon: 2.3,  spread: 0.35 },  // Australia
    { lat: -1.4, lon: 0.0,  spread: 0.30 },  // Antarctica
  ];

  for (let i = 0; i < countContinents; i++) {
    const c = continentCenters[i % continentCenters.length];
    const lat = c.lat + (Math.random() - 0.5) * c.spread;
    const lon = c.lon + (Math.random() - 0.5) * c.spread;
    const r = radius * (1.0 + Math.random() * 0.04);

    pos[idx * 3]     = r * Math.cos(lat) * Math.sin(lon);
    pos[idx * 3 + 1] = r * Math.sin(lat);
    pos[idx * 3 + 2] = r * Math.cos(lat) * Math.cos(lon);
    idx++;
  }

  // Latitude and Longitude Rings
  const latRings = [-0.8, -0.4, 0, 0.4, 0.8];
  for (let i = 0; i < countParallels; i++) {
    const ringLat = latRings[i % latRings.length];
    const lon = (i / countParallels) * Math.PI * 4;
    const r = radius;

    pos[idx * 3]     = r * Math.cos(ringLat) * Math.sin(lon);
    pos[idx * 3 + 1] = r * Math.sin(ringLat);
    pos[idx * 3 + 2] = r * Math.cos(ringLat) * Math.cos(lon);
    idx++;
  }

  // Inclined Orbital Satellite Ring
  const orbitR = radius * 1.35;
  const orbitInclination = 0.42; // radians
  for (let i = 0; i < countOrbit; i++) {
    const th = (i / countOrbit) * Math.PI * 2;
    const ox = orbitR * Math.cos(th);
    const oz = orbitR * Math.sin(th);
    const oy = Math.sin(th) * orbitR * Math.sin(orbitInclination);

    pos[idx * 3]     = ox;
    pos[idx * 3 + 1] = oy;
    pos[idx * 3 + 2] = oz;
    idx++;
  }

  // Outer Atmospheric Ionosphere Shell
  for (let i = 0; i < countAtmosphere; i++) {
    const u = Math.random();
    const v = Math.random();
    const th = u * Math.PI * 2;
    const ph = Math.acos(2 * v - 1);
    const r = radius * (1.08 + Math.random() * 0.12);

    pos[idx * 3]     = r * Math.sin(ph) * Math.cos(th);
    pos[idx * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
    pos[idx * 3 + 2] = r * Math.cos(ph);
    idx++;
  }

  return pos;
}

/**
 * 6. 3D CYBER SECURITY ENERGY SHIELD & PERIMETER MATRIX
 * Curved hexagonal energy barrier with concentric cyber rings and center lock.
 */
export function generateCyberShield(count = PARTICLE_COUNT, radius = 2.6): Float32Array {
  const pos = new Float32Array(count * 3);
  const countFace = Math.floor(count * 0.65);
  const countHexPerim = Math.floor(count * 0.22);
  const countLock = count - (countFace + countHexPerim);

  let idx = 0;

  // Curved Hexagonal Face (Facing positive Z with parabolic curvature)
  for (let i = 0; i < countFace; i++) {
    const r = Math.sqrt(Math.random()) * radius;
    const th = Math.random() * Math.PI * 2;
    const x = r * Math.cos(th);
    const y = r * Math.sin(th) * 1.15; // slightly tall shield
    const z = -0.38 * (r / radius) * (r / radius); // curved backward

    pos[idx * 3]     = x;
    pos[idx * 3 + 1] = y;
    pos[idx * 3 + 2] = z + 0.4;
    idx++;
  }

  // Hexagonal Perimeter Ring
  const hexSides = 6;
  for (let i = 0; i < countHexPerim; i++) {
    const side = i % hexSides;
    const a1 = (side / hexSides) * Math.PI * 2;
    const a2 = ((side + 1) / hexSides) * Math.PI * 2;
    const alpha = Math.random();
    const x = THREE.MathUtils.lerp(radius * Math.cos(a1), radius * Math.cos(a2), alpha);
    const y = THREE.MathUtils.lerp(radius * Math.sin(a1) * 1.15, radius * Math.sin(a2) * 1.15, alpha);

    pos[idx * 3]     = x;
    pos[idx * 3 + 1] = y;
    pos[idx * 3 + 2] = 0.05 + (Math.random() - 0.5) * 0.05;
    idx++;
  }

  // Central Cyber Lock / Emblem Core
  const lockR = radius * 0.42;
  for (let i = 0; i < countLock; i++) {
    const th = Math.random() * Math.PI * 2;
    const r = Math.random() * lockR;
    pos[idx * 3]     = r * Math.cos(th);
    pos[idx * 3 + 1] = r * Math.sin(th) + 0.1;
    pos[idx * 3 + 2] = 0.45 + (Math.random() - 0.5) * 0.08;
    idx++;
  }

  return pos;
}

/**
 * 7. 3D STARK ARC REACTOR & PLASMA VORTEX
 * 10 Toroidal copper confinement coils + central cold-fusion vortex core.
 */
export function generateArcReactor(count = PARTICLE_COUNT, majorR = 2.4, minorR = 0.68): Float32Array {
  const pos = new Float32Array(count * 3);
  const coilCount = 10;

  for (let i = 0; i < count; i++) {
    // 25% Central Plasma Vortex Core
    if (i < count * 0.25) {
      const r = Math.pow(Math.random(), 0.6) * 0.95;
      const th = Math.random() * Math.PI * 2;
      const h = (Math.random() - 0.5) * 0.6;
      pos[i * 3]     = r * Math.cos(th);
      pos[i * 3 + 1] = h;
      pos[i * 3 + 2] = r * Math.sin(th);
    }
    // 50% Toroidal Magnetic Confinement Ring
    else if (i < count * 0.75) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.random() * Math.PI * 2;
      pos[i * 3]     = (majorR + minorR * Math.cos(v)) * Math.cos(u);
      pos[i * 3 + 1] = minorR * Math.sin(v) * 0.95;
      pos[i * 3 + 2] = (majorR + minorR * Math.cos(v)) * Math.sin(u);
    }
    // 25% 10 Toroidal Copper Wire-wound Coils
    else {
      const coilIdx = i % coilCount;
      const baseAngle = (coilIdx / coilCount) * Math.PI * 2;
      const coilWidth = 0.25;
      const u = baseAngle + (Math.random() - 0.5) * coilWidth;
      const v = Math.random() * Math.PI * 2;
      const coilR = minorR * 1.25;

      pos[i * 3]     = (majorR + coilR * Math.cos(v)) * Math.cos(u);
      pos[i * 3 + 1] = coilR * Math.sin(v) * 1.1;
      pos[i * 3 + 2] = (majorR + coilR * Math.cos(v)) * Math.sin(u);
    }
  }
  return pos;
}

/**
 * 8. 3D FLOATING HOLOGRAPHIC WORKSPACE WINDOW
 * Curved floating holographic HUD display in 3D space with header bar and data columns.
 */
export function generateHoloWindow(count = PARTICLE_COUNT, width = 4.4, height = 2.8): Float32Array {
  const pos = new Float32Array(count * 3);
  const halfW = width / 2;
  const halfH = height / 2;

  const countFrame   = Math.floor(count * 0.35); // Outer cyber bezel
  const countColumns = Math.floor(count * 0.45); // 3 data/code column panes
  const countHeader  = count - (countFrame + countColumns);

  let idx = 0;

  // A. Curved Frame Bezel (cylindrical curve around Y)
  for (let i = 0; i < countFrame; i++) {
    const perim = Math.random() * 4;
    let x = 0, y = 0;
    if (perim < 1) { x = (perim - 0.5) * width; y = halfH; }
    else if (perim < 2) { x = halfW; y = (1.5 - perim) * height; }
    else if (perim < 3) { x = (2.5 - perim) * width; y = -halfH; }
    else { x = -halfW; y = (perim - 3.5) * height; }

    const zCurve = -0.32 * Math.pow(x / halfW, 2);
    pos[idx * 3]     = x;
    pos[idx * 3 + 1] = y;
    pos[idx * 3 + 2] = zCurve;
    idx++;
  }

  // B. 3 Columns with horizontal code/data stream lines
  const cols = [-1.4, 0.0, 1.4];
  for (let i = 0; i < countColumns; i++) {
    const cX = cols[i % cols.length];
    const x = cX + (Math.random() - 0.5) * 1.1;
    // Quantized Y for code lines effect
    const lineIdx = Math.floor(Math.random() * 16);
    const y = ((lineIdx / 15) - 0.5) * (height * 0.72);
    const zCurve = -0.32 * Math.pow(x / halfW, 2);

    pos[idx * 3]     = x;
    pos[idx * 3 + 1] = y;
    pos[idx * 3 + 2] = zCurve;
    idx++;
  }

  // C. Header tab and minimize/maximize glyphs
  for (let i = 0; i < countHeader; i++) {
    const x = (Math.random() - 0.5) * (width * 0.85);
    const y = halfH + 0.18 + (Math.random() - 0.5) * 0.08;
    const zCurve = -0.32 * Math.pow(x / halfW, 2);

    pos[idx * 3]     = x;
    pos[idx * 3 + 1] = y;
    pos[idx * 3 + 2] = zCurve;
    idx++;
  }

  return pos;
}

/**
 * Pre-generate all 8 shapes on startup so morphing is instantaneous.
 */
export function buildAllVolumetricShapes(count = PARTICLE_COUNT): Record<MorphShapeKey, Float32Array> {
  return {
    sphere:  generateFibonacciSphere(count),
    cpu:     generateCpuDie(count),
    neural:  generateBrain(count),
    dna:     generateDnaHelix(count),
    globe:   generateGlobe(count),
    shield:  generateCyberShield(count),
    reactor: generateArcReactor(count),
    window:  generateHoloWindow(count),
  };
}

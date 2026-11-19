import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  MAP_BY_ID,
  MapId,
  MapObstacle,
  ObstacleState,
  getMapObstacles,
  getMapTerrainHeight,
} from '../shared/gameData.ts';
import type { VFXManager } from './vfxManager.ts';

export function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function createProceduralGroundTex(mapId: MapId): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d')!;

  if (mapId === 'shibuya') {
    ctx.fillStyle = '#334155';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 1200; i++) {
      ctx.fillStyle =
        i % 3 === 0
          ? 'rgba(148, 163, 184, 0.14)'
          : i % 3 === 1
          ? 'rgba(15, 23, 42, 0.22)'
          : 'rgba(226, 232, 240, 0.08)';
      ctx.fillRect((i * 79) % 512, (i * 151) % 512, 3 + (i % 4), 3 + (i % 3));
    }
    ctx.strokeStyle = 'rgba(203, 213, 225, 0.14)';
    ctx.lineWidth = 2;
    for (let x = 0; x < 512; x += 128) {
      ctx.strokeRect(x + 1, 1, 126, 510);
    }
  } else if (mapId === 'meadow') {
    ctx.fillStyle = '#477614';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle =
        i % 3 === 0
          ? 'rgba(132, 204, 22, 0.22)'
          : i % 3 === 1
          ? 'rgba(54, 83, 20, 0.26)'
          : 'rgba(163, 230, 53, 0.14)';
      ctx.fillRect((i * 67) % 512, (i * 131) % 512, 5 + (i % 8), 5 + (i % 7));
    }
    ctx.strokeStyle = 'rgba(254, 240, 138, 0.14)';
    ctx.lineWidth = 2;
    for (let x = 0; x < 512; x += 64) {
      for (let y = 0; y < 512; y += 64) {
        ctx.strokeRect(x + 2, y + 2, 60, 60);
      }
    }
  } else if (mapId === 'temple') {
    ctx.fillStyle = '#383242';
    ctx.fillRect(0, 0, 512, 512);
    for (let x = 0; x < 512; x += 64) {
      for (let y = 0; y < 512; y += 64) {
        ctx.fillStyle = (x / 64 + y / 64) % 2 === 0 ? 'rgba(71, 85, 105, 0.28)' : 'rgba(30, 41, 59, 0.26)';
        ctx.fillRect(x + 2, y + 2, 60, 60);
        ctx.strokeStyle = 'rgba(251, 146, 60, 0.24)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, 62, 62);
      }
    }
  } else {
    ctx.fillStyle = '#151526';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = 'rgba(168, 85, 247, 0.28)';
    ctx.lineWidth = 2;
    for (let x = 0; x < 512; x += 64) {
      for (let y = 0; y < 512; y += 64) {
        ctx.strokeRect(x + 1, y + 1, 62, 62);
      }
    }
    ctx.strokeStyle = 'rgba(192, 132, 252, 0.36)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 24; i++) {
      ctx.beginPath();
      const sx = (i * 89) % 512;
      const sy = (i * 137) % 512;
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + ((i % 2 === 0 ? 1 : -1) * 65), sy + ((i % 3 === 0 ? 1 : -1) * 58));
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(24, 24);
  return tex;
}

function createProceduralBumpTex(mapId: MapId): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 256, 256);

  if (mapId === 'shibuya') {
    for (let i = 0; i < 800; i++) {
      const shade = 115 + (i % 4) * 12;
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      ctx.fillRect((i * 53) % 256, (i * 113) % 256, 2, 2);
    }
  } else if (mapId === 'meadow') {
    for (let i = 0; i < 650; i++) {
      const shade = 110 + (i % 5) * 14;
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      ctx.fillRect((i * 73) % 256, (i * 137) % 256, 4, 8);
    }
    ctx.strokeStyle = '#555555';
    ctx.lineWidth = 2;
    for (let x = 0; x < 256; x += 32) {
      for (let y = 0; y < 256; y += 32) {
        ctx.strokeRect(x + 1, y + 1, 30, 30);
      }
    }
  } else if (mapId === 'temple') {
    ctx.strokeStyle = '#383838';
    ctx.lineWidth = 3;
    for (let x = 0; x < 256; x += 32) {
      for (let y = 0; y < 256; y += 32) {
        ctx.fillStyle = (x / 32 + y / 32) % 2 === 0 ? '#969696' : '#7a7a7a';
        ctx.fillRect(x + 2, y + 2, 28, 28);
        ctx.strokeRect(x + 1, y + 1, 30, 30);
      }
    }
  } else {
    ctx.strokeStyle = '#303030';
    ctx.lineWidth = 2;
    for (let x = 0; x < 256; x += 32) {
      for (let y = 0; y < 256; y += 32) {
        ctx.strokeRect(x + 1, y + 1, 30, 30);
      }
    }
    ctx.strokeStyle = '#c8c8c8';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 18; i++) {
      ctx.beginPath();
      const sx = (i * 59) % 256;
      const sy = (i * 97) % 256;
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + (i % 2 === 0 ? 1 : -1) * 34, sy + 28);
      ctx.stroke();
    }
  }

  const bump = new THREE.CanvasTexture(c);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  bump.repeat.set(24, 24);
  return bump;
}

function createWindowFacadeTexture(accentHex: number, cols = 6, rows = 8): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const ctx = c.getContext('2d')!;
  const hexStr = '#' + accentHex.toString(16).padStart(6, '0');

  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, 0, 256, 512);

  // Subtle horizontal floor slabs
  const cellW = 256 / cols;
  const cellH = 512 / rows;
  for (let r = 0; r < rows; r++) {
    ctx.fillStyle = '#334155';
    ctx.fillRect(0, r * cellH, 256, 5);
    for (let col = 0; col < cols; col++) {
      const litSeed = (r * 7 + col * 13) % 5;
      if (litSeed === 0) {
        ctx.fillStyle = '#fef08a';
      } else if (litSeed === 1) {
        ctx.fillStyle = '#bae6fd';
      } else if (litSeed === 2) {
        ctx.fillStyle = hexStr;
      } else if (litSeed === 3) {
        ctx.fillStyle = '#64748b';
      } else {
        ctx.fillStyle = '#0f172a';
      }
      ctx.fillRect(col * cellW + 5, r * cellH + 9, cellW - 10, cellH - 16);
      // Window glare highlight
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(col * cellW + 7, r * cellH + 11, (cellW - 14) * 0.4, cellH - 22);
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createNeonBillboardTexture(label: string, bgHex: string, fgHex: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const ctx = c.getContext('2d')!;

  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, 256, 96);
  ctx.strokeStyle = fgHex;
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, 248, 88);

  ctx.fillStyle = fgHex;
  ctx.font = 'bold 28px "Chakra Petch", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 128, 48);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createAwningStripeTexture(colorHex: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const hexStr = '#' + colorHex.toString(16).padStart(6, '0');
  for (let x = 0; x < 128; x += 16) {
    ctx.fillStyle = (x / 16) % 2 === 0 ? hexStr : '#f8fafc';
    ctx.fillRect(x, 0, 16, 64);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createCrackOverlayTexture(heavy: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 256);

  const strokes = heavy ? 11 : 5;
  for (let i = 0; i < strokes; i++) {
    ctx.beginPath();
    let x = ((i * 53) % 190) + 32;
    let y = ((i * 89) % 190) + 32;
    ctx.moveTo(x, y);
    for (let s = 0; s < (heavy ? 5 : 3); s++) {
      x += Math.cos(i * 1.4 + s * 1.1) * (heavy ? 36 : 26);
      y += Math.sin(i * 1.9 + s * 0.9) * (heavy ? 36 : 26);
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.lineWidth = heavy ? 6 : 4;
    ctx.stroke();

    if (heavy) {
      ctx.strokeStyle = 'rgba(249, 115, 22, 0.72)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createSkyDome(mapId: MapId): THREE.Mesh {
  const geo = new THREE.SphereGeometry(240, 20, 12);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  const topColor = new THREE.Color(
    mapId === 'shibuya'
      ? 0x38bdf8
      : mapId === 'meadow'
      ? 0x1d4ed8
      : mapId === 'temple'
      ? 0x451a03
      : 0x090418
  );
  const midColor = new THREE.Color(
    mapId === 'shibuya'
      ? 0xbae6fd
      : mapId === 'meadow'
      ? 0x38bdf8
      : mapId === 'temple'
      ? 0xc2410c
      : 0x3b0764
  );
  const horizonColor = new THREE.Color(
    mapId === 'shibuya'
      ? 0xf1f5f9
      : mapId === 'meadow'
      ? 0xfef3c7
      : mapId === 'temple'
      ? 0xfdba74
      : 0x6b21a8
  );
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const yNorm = THREE.MathUtils.clamp((pos.getY(i) + 25) / 250, 0, 1);
    if (yNorm < 0.35) {
      tmp.copy(horizonColor).lerp(midColor, yNorm / 0.35);
    } else {
      tmp.copy(midColor).lerp(topColor, (yNorm - 0.35) / 0.65);
    }
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.castShadow = false;
  sky.receiveShadow = false;
  return sky;
}

function safeMerge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (geos.length === 0) return null;
  const nonIndexed = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(nonIndexed, false);
  for (const g of geos) g.dispose();
  for (const g of nonIndexed) {
    if (!geos.includes(g)) g.dispose();
  }
  return merged;
}

interface ObstacleRenderEntry {
  spec: MapObstacle;
  wrapper: THREE.Group;
  mainGroup: THREE.Group;
  rubbleGroup: THREE.Group;
  crackLow: THREE.Mesh;
  crackHigh: THREE.Mesh;
  baseX: number;
  baseY: number;
  baseZ: number;
  lastHp: number;
  shakeTimer: number;
  wasDestroyed: boolean;
}

const SHIBUYA_SIGNS = ['SHIBUYA 109', 'ARCADE 24H', 'CYBER CAFE', 'RAMEN NEO', 'METRO LINE'];

function buildObstacleVisual(
  obs: MapObstacle,
  obsIdx: number,
  mapId: MapId,
  groundY: number,
  crackMatLow: THREE.MeshBasicMaterial,
  crackMatHigh: THREE.MeshBasicMaterial,
  extraTexturesToDispose: THREE.Texture[]
): ObstacleRenderEntry {
  const wrapper = new THREE.Group();
  wrapper.position.set(obs.x, groundY, obs.z);

  const mainGroup = new THREE.Group();
  wrapper.add(mainGroup);

  const w = obs.halfW * 2;
  const d = obs.halfD * 2;
  const h = obs.topY;

  const plinthMat = new THREE.MeshStandardMaterial({
    color: mapId === 'shibuya' ? 0x94a3b8 : mapId === 'temple' ? 0x451a03 : mapId === 'obsidian' ? 0x0f172a : 0x78716c,
    roughness: 0.78,
    metalness: 0.14,
  });

  if (mapId === 'shibuya') {
    if (obs.kind === 'pillar') {
      // Multi-part Tokyo Metro / Shibuya Subway Station Entrance + Glass Canopy + Bollards
      const baseCurb = new THREE.Mesh(new THREE.BoxGeometry(w, 0.34, d), plinthMat);
      baseCurb.position.y = 0.17;
      baseCurb.receiveShadow = true;
      baseCurb.castShadow = false;
      mainGroup.add(baseCurb);

      const wallMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.55, metalness: 0.18 });
      const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.28, h * 0.62, d * 0.92), wallMat);
      leftWall.position.set(-w * 0.4, 0.34 + h * 0.31, 0);
      leftWall.castShadow = false;
      const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.28, h * 0.62, d * 0.92), wallMat);
      rightWall.position.set(w * 0.4, 0.34 + h * 0.31, 0);
      rightWall.castShadow = false;
      const backWall = new THREE.Mesh(new THREE.BoxGeometry(w * 0.86, h * 0.62, 0.28), wallMat);
      backWall.position.set(0, 0.34 + h * 0.31, -d * 0.36);
      backWall.castShadow = false;
      mainGroup.add(leftWall, rightWall, backWall);

      // Stepped subway entrance stair treads inside
      const stairMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.85 });
      for (let s = 0; s < 3; s++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(w * 0.62, 0.24, 0.42), stairMat);
        step.position.set(0, 0.42 + s * 0.24, 0.38 - s * 0.34);
        step.castShadow = false;
        mainGroup.add(step);
      }

      // Steel support columns + glowing glass canopy roof
      const steelMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.72, roughness: 0.28 });
      for (const sx of [-w * 0.42, w * 0.42]) {
        for (const sz of [-d * 0.42, d * 0.42]) {
          const col = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, h * 0.92, 8), steelMat);
          col.position.set(sx, h * 0.46, sz);
          col.castShadow = false;
          mainGroup.add(col);
        }
      }

      const canopyRoof = new THREE.Mesh(
        new THREE.BoxGeometry(w * 1.12, 0.22, d * 1.12),
        new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.2, metalness: 0.35 })
      );
      canopyRoof.position.y = h - 0.25;
      canopyRoof.rotation.x = -0.08;
      canopyRoof.castShadow = false;
      mainGroup.add(canopyRoof);

      const signTex = createNeonBillboardTexture('METRO B2', '#0f172a', '#38bdf8');
      extraTexturesToDispose.push(signTex);
      const stationSign = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.96, 0.56, 0.22),
        new THREE.MeshBasicMaterial({ map: signTex })
      );
      stationSign.position.set(0, h + 0.25, d * 0.42);
      stationSign.castShadow = false;
      mainGroup.add(stationSign);
    } else {
      // Multi-part Tokyo / Shibuya Corner Building (8+ architectural parts)
      const sidewalk = new THREE.Mesh(new THREE.BoxGeometry(w * 1.05, 0.32, d * 1.05), plinthMat);
      sidewalk.position.y = 0.16;
      sidewalk.receiveShadow = true;
      sidewalk.castShadow = false;
      mainGroup.add(sidewalk);

      const winTex = createWindowFacadeTexture(obs.roofColorHex, 5, 6);
      extraTexturesToDispose.push(winTex);

      const coreMat = new THREE.MeshStandardMaterial({
        color: obs.colorHex,
        map: winTex,
        roughness: 0.42,
        metalness: 0.22,
      });
      const bodyH = Math.max(1.2, h - 0.85);
      const body = new THREE.Mesh(new THREE.BoxGeometry(w * 0.92, bodyH, d * 0.92), coreMat);
      body.position.y = 0.32 + bodyH * 0.5;
      body.receiveShadow = true;
      body.castShadow = false;
      mainGroup.add(body);

      // 4 Concrete corner structural pilasters for real architectural silhouette
      const pilasterMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.65 });
      for (const px of [-w * 0.45, w * 0.45]) {
        for (const pz of [-d * 0.45, d * 0.45]) {
          const pilaster = new THREE.Mesh(new THREE.BoxGeometry(0.32, bodyH + 0.35, 0.32), pilasterMat);
          pilaster.position.set(px, 0.32 + (bodyH + 0.35) * 0.5, pz);
          pilaster.castShadow = false;
          mainGroup.add(pilaster);
        }
      }

      // Ground-level illuminated storefront + striped awning canopy
      const glassFront = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.94, 0.95, d * 0.94),
        new THREE.MeshBasicMaterial({ color: 0xe0f2fe })
      );
      glassFront.position.y = 0.82;
      glassFront.castShadow = false;
      mainGroup.add(glassFront);

      const awningTex = createAwningStripeTexture(obs.roofColorHex);
      extraTexturesToDispose.push(awningTex);
      const awning = new THREE.Mesh(
        new THREE.BoxGeometry(w * 1.06, 0.22, d * 1.06),
        new THREE.MeshStandardMaterial({ map: awningTex, roughness: 0.55 })
      );
      awning.position.y = 1.46;
      awning.castShadow = false;
      mainGroup.add(awning);

      // Luminous horizontal marquee + projecting vertical neon signboard
      const signLabel = SHIBUYA_SIGNS[obsIdx % SHIBUYA_SIGNS.length];
      const signTex = createNeonBillboardTexture(
        signLabel,
        '#0f172a',
        '#' + obs.roofColorHex.toString(16).padStart(6, '0')
      );
      extraTexturesToDispose.push(signTex);

      const billboardBezel = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.9, 0.7, 0.18),
        new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.45, metalness: 0.4 })
      );
      billboardBezel.position.set(0, h - 0.65, d * 0.5 + 0.01);
      billboardBezel.castShadow = false;
      mainGroup.add(billboardBezel);

      const frontBillboard = new THREE.Mesh(
        new THREE.PlaneGeometry(w * 0.84, 0.58),
        new THREE.MeshBasicMaterial({ map: signTex })
      );
      frontBillboard.position.set(0, h - 0.65, d * 0.5 + 0.11);
      frontBillboard.castShadow = false;
      mainGroup.add(frontBillboard);

      const vertSign = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, h * 0.48, 0.85),
        new THREE.MeshBasicMaterial({ color: obs.roofColorHex })
      );
      vertSign.position.set(w * 0.52, h * 0.62, 0);
      vertSign.castShadow = false;
      mainGroup.add(vertSign);

      // Rooftop parapet trim + HVAC condenser unit + communications mast
      const parapet = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.98, 0.24, d * 0.98),
        new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5, metalness: 0.35 })
      );
      parapet.position.y = h - 0.12;
      parapet.castShadow = false;
      mainGroup.add(parapet);

      const acUnit = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.38, 0.48, d * 0.36),
        new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.6, metalness: 0.3 })
      );
      acUnit.position.set(-w * 0.16, h + 0.24, -d * 0.12);
      acUnit.castShadow = false;
      mainGroup.add(acUnit);

      const mast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.08, 1.05, 6),
        new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.7 })
      );
      mast.position.set(w * 0.24, h + 0.52, d * 0.18);
      mast.castShadow = false;
      mainGroup.add(mast);
    }
  } else if (mapId === 'temple') {
    // Multi-tiered Japanese Temple Pagoda Shrine (plinth, crimson pillars, lantern walls, curved pagoda roofs, bronze finial)
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(w, 0.46, d), plinthMat);
    plinth.position.y = 0.23;
    plinth.receiveShadow = true;
    plinth.castShadow = false;
    mainGroup.add(plinth);

    const crimsonMat = new THREE.MeshStandardMaterial({ color: obs.colorHex, roughness: 0.62, metalness: 0.12 });
    const shojiMat = new THREE.MeshBasicMaterial({ color: 0xfde68a });
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.48,
      metalness: 0.3,
    });
    const goldMat = new THREE.MeshStandardMaterial({
      color: obs.roofColorHex,
      emissive: obs.roofColorHex,
      emissiveIntensity: 0.25,
      metalness: 0.55,
      roughness: 0.32,
    });

    // Lower hall + shoji lantern windows + 4 vermilion pillars
    const lowerBody = new THREE.Mesh(new THREE.BoxGeometry(w * 0.78, h * 0.44, d * 0.78), shojiMat);
    lowerBody.position.y = 0.46 + h * 0.22;
    lowerBody.castShadow = false;
    mainGroup.add(lowerBody);

    for (const px of [-w * 0.4, w * 0.4]) {
      for (const pz of [-d * 0.4, d * 0.4]) {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, h * 0.5, 8), crimsonMat);
        pillar.position.set(px, 0.46 + h * 0.25, pz);
        pillar.castShadow = false;
        mainGroup.add(pillar);
      }
    }

    // Tier 1 overhanging eave
    const eave1 = new THREE.Mesh(new THREE.BoxGeometry(w * 1.18, 0.26, d * 1.18), roofMat);
    eave1.position.y = 0.46 + h * 0.48;
    eave1.castShadow = false;
    mainGroup.add(eave1);

    // Tier 2 smaller shrine chamber
    const upperBody = new THREE.Mesh(new THREE.BoxGeometry(w * 0.56, h * 0.26, d * 0.56), crimsonMat);
    upperBody.position.y = 0.46 + h * 0.65;
    upperBody.castShadow = false;
    mainGroup.add(upperBody);

    // Upper pyramidal roof + golden sorin spire
    const upperRoof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.68, h * 0.26, 4), roofMat);
    upperRoof.rotation.y = Math.PI * 0.25;
    upperRoof.position.y = h - 0.18;
    upperRoof.castShadow = false;
    mainGroup.add(upperRoof);

    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.14, 0.85, 8), goldMat);
    spire.position.y = h + 0.35;
    spire.castShadow = false;
    mainGroup.add(spire);
  } else if (mapId === 'meadow') {
    // Sunlit Ancient Stone Pavilion / Archway Ruin (stepped stone plinth, 4 fluted columns, lintel cornice, moss cap, gold crest)
    const stoneMat = new THREE.MeshStandardMaterial({ color: obs.colorHex, roughness: 0.84, metalness: 0.06 });
    const darkStoneMat = new THREE.MeshStandardMaterial({ color: 0x78716c, roughness: 0.9 });
    const crestMat = new THREE.MeshStandardMaterial({
      color: obs.roofColorHex,
      emissive: obs.roofColorHex,
      emissiveIntensity: 0.18,
      roughness: 0.35,
      metalness: 0.45,
    });

    const stepBase = new THREE.Mesh(new THREE.BoxGeometry(w * 1.04, 0.42, d * 1.04), darkStoneMat);
    stepBase.position.y = 0.21;
    stepBase.receiveShadow = true;
    stepBase.castShadow = false;
    mainGroup.add(stepBase);

    const innerCore = new THREE.Mesh(new THREE.BoxGeometry(w * 0.62, h - 0.85, d * 0.62), stoneMat);
    innerCore.position.y = 0.42 + (h - 0.85) * 0.5;
    innerCore.receiveShadow = true;
    innerCore.castShadow = false;
    mainGroup.add(innerCore);

    for (const px of [-w * 0.4, w * 0.4]) {
      for (const pz of [-d * 0.4, d * 0.4]) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, h - 0.72, 10), stoneMat);
        col.position.set(px, 0.42 + (h - 0.72) * 0.5, pz);
        col.castShadow = false;
        mainGroup.add(col);
      }
    }

    const archLintel = new THREE.Mesh(new THREE.BoxGeometry(w * 1.12, 0.36, d * 1.12), stoneMat);
    archLintel.position.y = h - 0.26;
    archLintel.castShadow = false;
    mainGroup.add(archLintel);

    const roofCap = new THREE.Mesh(new THREE.BoxGeometry(w * 0.84, 0.26, d * 0.84), crestMat);
    roofCap.position.y = h + 0.04;
    roofCap.castShadow = false;
    mainGroup.add(roofCap);
  } else {
    // Obsidian Storm Peak: Volcanic Fortress Bastion (beveled dark basalt core, armored fins, glowing rune strips, crystal crown)
    const basaltMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.62, metalness: 0.35 });
    const runeMat = new THREE.MeshBasicMaterial({ color: obs.roofColorHex });

    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.56, w * 0.66, 0.55, 6), plinthMat);
    plinth.position.y = 0.275;
    plinth.receiveShadow = true;
    plinth.castShadow = false;
    mainGroup.add(plinth);

    const tower = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.38, w * 0.48, h - 0.75, 6), basaltMat);
    tower.position.y = 0.55 + (h - 0.75) * 0.5;
    tower.receiveShadow = true;
    tower.castShadow = false;
    mainGroup.add(tower);

    // 4 Vertical armored buttress fins with glowing rune channels
    for (let f = 0; f < 4; f++) {
      const ang = (f / 4) * Math.PI * 2 + Math.PI * 0.25;
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.28, h * 0.74, 0.62), basaltMat);
      fin.position.set(Math.cos(ang) * w * 0.42, 0.55 + h * 0.37, Math.sin(ang) * d * 0.42);
      fin.rotation.y = -ang + Math.PI * 0.5;
      fin.castShadow = false;
      mainGroup.add(fin);

      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.1, h * 0.62, 0.66), runeMat);
      strip.position.copy(fin.position);
      strip.rotation.copy(fin.rotation);
      strip.castShadow = false;
      mainGroup.add(strip);
    }

    const crownCollar = new THREE.Mesh(new THREE.TorusGeometry(w * 0.42, 0.08, 6, 12), runeMat);
    crownCollar.rotation.x = Math.PI * 0.5;
    crownCollar.position.y = h - 0.12;
    mainGroup.add(crownCollar);

    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(Math.min(w, d) * 0.36, 0), runeMat);
    crystal.position.y = h + 0.42;
    crystal.castShadow = false;
    mainGroup.add(crystal);
  }

  // Progressive fracture overlay shells (clean polygonOffset, never z-fights)
  const crackGeo = new THREE.BoxGeometry(w * 0.99, Math.max(0.85, h - 0.45), d * 0.99);
  const crackLow = new THREE.Mesh(crackGeo, crackMatLow);
  crackLow.position.y = 0.4 + (h - 0.45) * 0.5;
  crackLow.visible = false;
  crackLow.renderOrder = 3;
  mainGroup.add(crackLow);

  const crackHigh = new THREE.Mesh(crackGeo, crackMatHigh);
  crackHigh.position.y = 0.4 + (h - 0.45) * 0.5;
  crackHigh.visible = false;
  crackHigh.renderOrder = 4;
  mainGroup.add(crackHigh);

  // Low demolished rubble pad revealed after collapse (never blocks fighters)
  const rubbleGroup = new THREE.Group();
  rubbleGroup.visible = false;
  const pad = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.96, 0.08, d * 0.96),
    new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.95 })
  );
  pad.position.y = 0.04;
  pad.receiveShadow = true;
  pad.castShadow = false;
  rubbleGroup.add(pad);
  for (let i = 0; i < 5; i++) {
    const chunk = new THREE.Mesh(
      new THREE.BoxGeometry(0.44 + (i % 2) * 0.26, 0.16, 0.4),
      plinthMat
    );
    const a = (i / 5) * Math.PI * 2 + 0.4;
    chunk.position.set(Math.cos(a) * obs.halfW * 0.44, 0.11, Math.sin(a) * obs.halfD * 0.44);
    chunk.rotation.set(0.16, a, 0.14);
    chunk.castShadow = false;
    rubbleGroup.add(chunk);
  }
  wrapper.add(rubbleGroup);

  return {
    spec: obs,
    wrapper,
    mainGroup,
    rubbleGroup,
    crackLow,
    crackHigh,
    baseX: obs.x,
    baseY: groundY,
    baseZ: obs.z,
    lastHp: obs.maxHp ?? 100,
    shakeTimer: 0,
    wasDestroyed: false,
  };
}

export interface BuiltMapScene {
  group: THREE.Group;
  update: (dt: number, elapsed: number) => void;
  syncObstacles: (obstacles: ObstacleState[] | undefined, vfx?: VFXManager | null) => void;
  dispose: () => void;
}

export function buildArenaMap(mapId: MapId, scene: THREE.Scene, maxAniso: number): BuiltMapScene {
  const spec = MAP_BY_ID[mapId];
  scene.background = new THREE.Color(spec.skyHex);
  scene.fog = new THREE.FogExp2(
    spec.fogHex,
    mapId === 'shibuya' ? 0.004 : mapId === 'meadow' ? 0.0058 : 0.0074
  );

  const group = new THREE.Group();
  scene.add(group);
  const extraTextures: THREE.Texture[] = [];

  // 1-draw-call atmospheric sky dome
  group.add(createSkyDome(mapId));

  const groundTex = createProceduralGroundTex(mapId);
  groundTex.anisotropy = maxAniso;
  const bumpTex = createProceduralBumpTex(mapId);
  bumpTex.anisotropy = maxAniso;

  const terrainGeo = new THREE.PlaneGeometry(220, 220, 48, 48);
  terrainGeo.rotateX(-Math.PI * 0.5);
  const pos = terrainGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, getMapTerrainHeight(mapId, pos.getX(i), pos.getZ(i)));
  }
  terrainGeo.computeVertexNormals();

  const terrainMat = new THREE.MeshStandardMaterial({
    map: groundTex,
    bumpMap: bumpTex,
    bumpScale: mapId === 'shibuya' ? 0.03 : mapId === 'meadow' ? 0.045 : 0.065,
    roughness: mapId === 'obsidian' ? 0.62 : mapId === 'shibuya' ? 0.78 : 0.84,
    metalness: mapId === 'obsidian' ? 0.25 : 0.05,
  });
  const terrain = new THREE.Mesh(terrainGeo, terrainMat);
  terrain.receiveShadow = true;
  terrain.castShadow = false;
  group.add(terrain);

  // Grand inlaid stone/gold/neon combat rings & cardinal runway inlays (1 merged draw call)
  const accentHex =
    mapId === 'shibuya'
      ? 0x38bdf8
      : mapId === 'meadow'
      ? 0xfacc15
      : mapId === 'temple'
      ? 0xfb923c
      : 0xa855f7;
  const ringGeos: THREE.BufferGeometry[] = [];
  const outerRingGeo = new THREE.RingGeometry(spec.arenaRadius - 0.38, spec.arenaRadius + 0.14, 72);
  outerRingGeo.rotateX(-Math.PI * 0.5);
  outerRingGeo.translate(0, 0.03, 0);
  ringGeos.push(outerRingGeo);

  const midRingGeo = new THREE.RingGeometry(spec.arenaRadius * 0.54, spec.arenaRadius * 0.54 + 0.34, 64);
  midRingGeo.rotateX(-Math.PI * 0.5);
  midRingGeo.translate(0, 0.026, 0);
  ringGeos.push(midRingGeo);

  const innerRingGeo = new THREE.RingGeometry(5.1, 5.45, 48);
  innerRingGeo.rotateX(-Math.PI * 0.5);
  innerRingGeo.translate(0, 0.028, 0);
  ringGeos.push(innerRingGeo);

  for (let c = 0; c < 4; c++) {
    const spokeLen = spec.arenaRadius - 6.2;
    const spoke = new THREE.PlaneGeometry(0.42, spokeLen);
    spoke.rotateX(-Math.PI * 0.5);
    spoke.translate(0, 0.022, 5.4 + spokeLen * 0.5);
    spoke.rotateY((c * Math.PI) / 2);
    ringGeos.push(spoke);
  }

  const ringsMerged = safeMerge(ringGeos);
  if (ringsMerged) {
    const ringMesh = new THREE.Mesh(
      ringsMerged,
      new THREE.MeshBasicMaterial({
        color: accentHex,
        transparent: true,
        opacity: mapId === 'shibuya' ? 0.38 : 0.46,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      })
    );
    ringMesh.castShadow = false;
    ringMesh.receiveShadow = false;
    group.add(ringMesh);
  }

  const animatedMeshes: Array<(dt: number, elapsed: number) => void> = [];
  const outerR = spec.arenaRadius + 3.6;

  if (mapId === 'shibuya') {
    // Shibuya Scramble diagonal & cardinal white zebra crosswalk stripes (1 merged draw call)
    const stripeGeos: THREE.BufferGeometry[] = [];
    const directions = [0, Math.PI * 0.5, Math.PI * 0.25, -Math.PI * 0.25];
    for (const dirAng of directions) {
      for (let s = -12; s <= 12; s += 1.65) {
        if (Math.abs(s) < 2.2) continue;
        const stripe = new THREE.PlaneGeometry(2.8, 0.65);
        stripe.rotateX(-Math.PI * 0.5);
        stripe.translate(0, 0.02, s);
        stripe.rotateY(dirAng);
        stripeGeos.push(stripe);
      }
    }
    const mergedCrosswalk = safeMerge(stripeGeos);
    if (mergedCrosswalk) {
      const crosswalkMesh = new THREE.Mesh(
        mergedCrosswalk,
        new THREE.MeshBasicMaterial({
          color: 0xf8fafc,
          transparent: true,
          opacity: 0.72,
          side: THREE.DoubleSide,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
        })
      );
      crosswalkMesh.castShadow = false;
      crosswalkMesh.receiveShadow = false;
      group.add(crosswalkMesh);
    }

    // Contoured Sidewalk Apron around the outer scramble perimeter (tracks terrain slope cleanly, zero triangle clipping)
    const sidewalkGeo = new THREE.RingGeometry(spec.arenaRadius + 0.35, spec.arenaRadius + 18, 64, 4);
    sidewalkGeo.rotateX(-Math.PI * 0.5);
    const swPos = sidewalkGeo.attributes.position;
    for (let i = 0; i < swPos.count; i++) {
      const sx = swPos.getX(i);
      const sz = swPos.getZ(i);
      swPos.setY(i, getMapTerrainHeight('shibuya', sx, sz) + 0.045);
    }
    sidewalkGeo.computeVertexNormals();
    const sidewalkMesh = new THREE.Mesh(
      sidewalkGeo,
      new THREE.MeshStandardMaterial({
        color: 0xe2e8f0,
        roughness: 0.85,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      })
    );
    sidewalkMesh.receiveShadow = true;
    sidewalkMesh.castShadow = false;
    group.add(sidewalkMesh);

    // Instanced Shibuya urban streetlamps + pedestrian guard bollards around perimeter (zero PointLight!)
    const lampCount = 16;
    const poleGeo = new THREE.CylinderGeometry(0.14, 0.18, 5.2, 8);
    poleGeo.translate(0, 2.6, 0);
    const poleInst = new THREE.InstancedMesh(
      poleGeo,
      new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.6, roughness: 0.4 }),
      lampCount
    );
    poleInst.castShadow = false;

    const bulbGeo = new THREE.BoxGeometry(0.85, 0.28, 0.45);
    bulbGeo.translate(0, 5.25, -0.45);
    const bulbInst = new THREE.InstancedMesh(
      bulbGeo,
      new THREE.MeshBasicMaterial({ color: 0xfef08a }),
      lampCount
    );
    bulbInst.castShadow = false;

    const lDummy = new THREE.Object3D();
    for (let i = 0; i < lampCount; i++) {
      const ang = (i / lampCount) * Math.PI * 2;
      lDummy.position.set(Math.cos(ang) * outerR, 0, Math.sin(ang) * outerR);
      lDummy.rotation.set(0, -ang + Math.PI * 0.5, 0);
      lDummy.scale.setScalar(1);
      lDummy.updateMatrix();
      poleInst.setMatrixAt(i, lDummy.matrix);
      bulbInst.setMatrixAt(i, lDummy.matrix);
    }
    poleInst.instanceMatrix.needsUpdate = true;
    bulbInst.instanceMatrix.needsUpdate = true;
    group.add(poleInst, bulbInst);

    // Instanced street curb bollards along arena sidewalk perimeter
    const bollardCount = 32;
    const bolGeo = new THREE.CylinderGeometry(0.14, 0.16, 0.85, 8);
    bolGeo.translate(0, 0.425, 0);
    const bolInst = new THREE.InstancedMesh(
      bolGeo,
      new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.55, roughness: 0.35 }),
      bollardCount
    );
    bolInst.castShadow = false;
    for (let i = 0; i < bollardCount; i++) {
      const ang = (i / bollardCount) * Math.PI * 2 + 0.09;
      lDummy.position.set(Math.cos(ang) * (spec.arenaRadius + 1.0), 0, Math.sin(ang) * (spec.arenaRadius + 1.0));
      lDummy.rotation.set(0, 0, 0);
      lDummy.scale.setScalar(1);
      lDummy.updateMatrix();
      bolInst.setMatrixAt(i, lDummy.matrix);
    }
    bolInst.instanceMatrix.needsUpdate = true;
    group.add(bolInst);

    // Detailed Multi-Part Surrounding Shibuya Skyline Skyscrapers (Window-textured Facades + Rooftop Crowns + Neon Signs)
    const skyBuildCount = 24;
    const facadeTex = createWindowFacadeTexture(0x38bdf8, 8, 12);
    extraTextures.push(facadeTex);
    const towerGeo = new THREE.BoxGeometry(10.5, 1, 10.5);
    towerGeo.translate(0, 0.5, 0);
    const towerInst = new THREE.InstancedMesh(
      towerGeo,
      new THREE.MeshStandardMaterial({
        color: 0xf8fafc,
        map: facadeTex,
        roughness: 0.45,
        metalness: 0.22,
      }),
      skyBuildCount
    );
    towerInst.castShadow = false;

    const crownGeo = new THREE.BoxGeometry(8.2, 2.8, 8.2);
    const crownInst = new THREE.InstancedMesh(
      crownGeo,
      new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.5, metalness: 0.4 }),
      skyBuildCount
    );
    crownInst.castShadow = false;

    const signGeo = new THREE.BoxGeometry(8.4, 2.5, 10.9);
    const signInst = new THREE.InstancedMesh(
      signGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      skyBuildCount
    );
    signInst.castShadow = false;

    const palette = [0x38bdf8, 0xf43f5e, 0xfacc15, 0x2dd4bf, 0x6366f1];
    const bDummy = new THREE.Object3D();
    const cTmp = new THREE.Color();
    for (let i = 0; i < skyBuildCount; i++) {
      const ang = (i / skyBuildCount) * Math.PI * 2 + 0.13;
      const dist = outerR + 11.5 + (i % 3) * 7.5;
      const bh = 20 + (i % 5) * 7.5;
      const bx = Math.cos(ang) * dist;
      const bz = Math.sin(ang) * dist;

      bDummy.position.set(bx, 0, bz);
      bDummy.rotation.set(0, -ang, 0);
      bDummy.scale.set(1, bh, 1);
      bDummy.updateMatrix();
      towerInst.setMatrixAt(i, bDummy.matrix);
      towerInst.setColorAt(i, cTmp.setHex(i % 2 === 0 ? 0xf8fafc : 0xe2e8f0));

      bDummy.position.set(bx, bh + 1.4, bz);
      bDummy.scale.set(1, 1, 1);
      bDummy.updateMatrix();
      crownInst.setMatrixAt(i, bDummy.matrix);

      bDummy.position.set(bx, 7.8 + (i % 3) * 3.0, bz);
      bDummy.updateMatrix();
      signInst.setMatrixAt(i, bDummy.matrix);
      signInst.setColorAt(i, cTmp.setHex(palette[i % palette.length]));
    }
    towerInst.instanceMatrix.needsUpdate = true;
    crownInst.instanceMatrix.needsUpdate = true;
    signInst.instanceMatrix.needsUpdate = true;
    if (towerInst.instanceColor) towerInst.instanceColor.needsUpdate = true;
    if (signInst.instanceColor) signInst.instanceColor.needsUpdate = true;
    group.add(towerInst, crownInst, signInst);
  } else {
    // Instanced inlaid energy floor tiles across the mid-outer ring (1 draw call)
    const tileCount = 24;
    const tileGeo = new THREE.PlaneGeometry(2.6, 1.45);
    tileGeo.rotateX(-Math.PI * 0.5);
    tileGeo.translate(0, 0.016, 0);
    const tileMat = new THREE.MeshBasicMaterial({
      color: mapId === 'meadow' ? 0xfef08a : mapId === 'temple' ? 0xfdba74 : 0xc084fc,
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const tileInst = new THREE.InstancedMesh(tileGeo, tileMat, tileCount);
    tileInst.castShadow = false;
    tileInst.receiveShadow = false;
    const tileDummy = new THREE.Object3D();
    for (let i = 0; i < tileCount; i++) {
      const ang = (i / tileCount) * Math.PI * 2;
      const r = i % 2 === 0 ? spec.arenaRadius * 0.76 : spec.arenaRadius * 0.36;
      tileDummy.position.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
      tileDummy.rotation.set(0, -ang + Math.PI * 0.5, 0);
      tileDummy.scale.setScalar(1);
      tileDummy.updateMatrix();
      tileInst.setMatrixAt(i, tileDummy.matrix);
    }
    tileInst.instanceMatrix.needsUpdate = true;
    tileInst.computeBoundingSphere();
    group.add(tileInst);

    // Perimeter Stone Pillars with Glowing Braziers (InstancedMesh, zero PointLight!)
    const brazierCount = 16;
    const pedGeo = new THREE.CylinderGeometry(0.68, 0.85, 3.8, 8);
    pedGeo.translate(0, 1.9, 0);
    const pedInst = new THREE.InstancedMesh(
      pedGeo,
      new THREE.MeshStandardMaterial({
        color: mapId === 'meadow' ? 0x64748b : mapId === 'temple' ? 0x991b1b : 0x1e293b,
        roughness: 0.72,
        metalness: 0.18,
      }),
      brazierCount
    );
    pedInst.castShadow = false;
    pedInst.receiveShadow = false;

    const bowlGeo = new THREE.CylinderGeometry(0.95, 0.55, 0.55, 8);
    bowlGeo.translate(0, 4.05, 0);
    const bowlInst = new THREE.InstancedMesh(
      bowlGeo,
      new THREE.MeshStandardMaterial({
        color: mapId === 'obsidian' ? 0x312e81 : 0xb45309,
        roughness: 0.38,
        metalness: 0.65,
      }),
      brazierCount
    );
    bowlInst.castShadow = false;
    bowlInst.receiveShadow = false;

    const flameGeo = new THREE.OctahedronGeometry(0.56, 0);
    flameGeo.translate(0, 4.7, 0);
    const flameColor = mapId === 'meadow' ? 0xfacc15 : mapId === 'temple' ? 0xf97316 : 0xc084fc;
    const flameMat = new THREE.MeshBasicMaterial({ color: flameColor });
    const flameInst = new THREE.InstancedMesh(flameGeo, flameMat, brazierCount);
    flameInst.castShadow = false;
    flameInst.receiveShadow = false;

    const haloGeo = new THREE.SphereGeometry(1.15, 8, 6);
    haloGeo.translate(0, 4.7, 0);
    const haloInst = new THREE.InstancedMesh(
      haloGeo,
      new THREE.MeshBasicMaterial({
        color: flameColor,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      brazierCount
    );
    haloInst.castShadow = false;
    haloInst.receiveShadow = false;

    const pDummy = new THREE.Object3D();
    for (let i = 0; i < brazierCount; i++) {
      const ang = (i / brazierCount) * Math.PI * 2;
      const px = Math.cos(ang) * outerR;
      const pz = Math.sin(ang) * outerR;
      pDummy.position.set(px, getMapTerrainHeight(mapId, px, pz) * 0.4, pz);
      pDummy.rotation.set(0, -ang, 0);
      pDummy.scale.setScalar(1);
      pDummy.updateMatrix();
      pedInst.setMatrixAt(i, pDummy.matrix);
      bowlInst.setMatrixAt(i, pDummy.matrix);
      flameInst.setMatrixAt(i, pDummy.matrix);
      haloInst.setMatrixAt(i, pDummy.matrix);
    }
    pedInst.instanceMatrix.needsUpdate = true;
    bowlInst.instanceMatrix.needsUpdate = true;
    flameInst.instanceMatrix.needsUpdate = true;
    haloInst.instanceMatrix.needsUpdate = true;
    group.add(pedInst, bowlInst, flameInst, haloInst);

    // Distant Mountain / Spire Silhouettes (1 merged static draw call)
    const silhouetteGeos: THREE.BufferGeometry[] = [];
    const silCount = 18;
    for (let i = 0; i < silCount; i++) {
      const ang = (i / silCount) * Math.PI * 2 + 0.14;
      const dist = 76 + (i % 3) * 11;
      const h = 18 + (i % 4) * 7;
      const peak =
        mapId === 'obsidian'
          ? new THREE.CylinderGeometry(1.6, 5.2, h, 5)
          : new THREE.ConeGeometry(8 + (i % 3) * 3, h, 5);
      peak.translate(Math.cos(ang) * dist, h * 0.42, Math.sin(ang) * dist);
      silhouetteGeos.push(peak);
    }
    const mergedSilhouette = safeMerge(silhouetteGeos);
    if (mergedSilhouette) {
      const silMesh = new THREE.Mesh(
        mergedSilhouette,
        new THREE.MeshStandardMaterial({
          color: mapId === 'meadow' ? 0x334155 : mapId === 'temple' ? 0x451a2b : 0x0f172a,
          roughness: 0.92,
        })
      );
      silMesh.castShadow = false;
      silMesh.receiveShadow = false;
      group.add(silMesh);
    }
  }

  if (mapId === 'meadow') {
    const moatGeo = new THREE.RingGeometry(spec.arenaRadius + 1.4, spec.arenaRadius + 4.8, 64);
    moatGeo.rotateX(-Math.PI * 0.5);
    moatGeo.translate(0, 0.015, 0);
    const moatMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.58,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const moatMesh = new THREE.Mesh(moatGeo, moatMat);
    moatMesh.castShadow = false;
    moatMesh.receiveShadow = false;
    group.add(moatMesh);
    animatedMeshes.push((_dt, elapsed) => {
      moatMat.opacity = 0.5 + Math.sin(elapsed * 2.2) * 0.1;
    });

    // 4 Cardinal Stone Bridges spanning the moat
    const bridgeGeos: THREE.BufferGeometry[] = [];
    for (let b = 0; b < 4; b++) {
      const deck = new THREE.BoxGeometry(3.8, 0.35, 5.2);
      deck.translate(0, 0.18, spec.arenaRadius + 3.1);
      deck.rotateY((b * Math.PI) / 2);
      bridgeGeos.push(deck);
    }
    const mergedBridges = safeMerge(bridgeGeos);
    if (mergedBridges) {
      const bridgeMesh = new THREE.Mesh(
        mergedBridges,
        new THREE.MeshStandardMaterial({ color: 0xd6d3d1, roughness: 0.85 })
      );
      bridgeMesh.castShadow = false;
      bridgeMesh.receiveShadow = true;
      group.add(bridgeMesh);
    }

    const treeCount = 24;
    const trunkGeo = new THREE.CylinderGeometry(0.26, 0.46, 4.4, 6);
    trunkGeo.translate(0, 2.2, 0);
    const trunkInst = new THREE.InstancedMesh(
      trunkGeo,
      new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.9 }),
      treeCount
    );
    trunkInst.castShadow = false;
    trunkInst.receiveShadow = false;

    const crownGeo = new THREE.DodecahedronGeometry(2.3, 0);
    crownGeo.translate(0, 4.8, 0);
    const crownInst = new THREE.InstancedMesh(
      crownGeo,
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.84 }),
      treeCount
    );
    crownInst.castShadow = false;
    crownInst.receiveShadow = false;

    const dummy = new THREE.Object3D();
    const greenA = new THREE.Color(0x4d7c0f);
    const greenB = new THREE.Color(0x84cc16);
    const goldLeaf = new THREE.Color(0xb45309);
    for (let t = 0; t < treeCount; t++) {
      const ang = (t / treeCount) * Math.PI * 2 + 0.18;
      const dist = outerR + 7.5 + (t % 3) * 4.5;
      const tx = Math.cos(ang) * dist;
      const tz = Math.sin(ang) * dist;
      const ty = getMapTerrainHeight('meadow', tx, tz);
      const scale = 0.92 + (t % 3) * 0.18;
      dummy.position.set(tx, ty, tz);
      dummy.rotation.set(0, ang, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      trunkInst.setMatrixAt(t, dummy.matrix);
      crownInst.setMatrixAt(t, dummy.matrix);
      crownInst.setColorAt(t, t % 4 === 0 ? goldLeaf : t % 2 === 0 ? greenA : greenB);
    }
    trunkInst.instanceMatrix.needsUpdate = true;
    crownInst.instanceMatrix.needsUpdate = true;
    if (crownInst.instanceColor) crownInst.instanceColor.needsUpdate = true;
    group.add(trunkInst, crownInst);
  } else if (mapId === 'temple') {
    const daisMesh = new THREE.Mesh(
      new THREE.CircleGeometry(10.5, 48),
      new THREE.MeshBasicMaterial({
        color: 0x475569,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      })
    );
    daisMesh.rotation.x = -Math.PI * 0.5;
    daisMesh.position.y = 0.015;
    daisMesh.castShadow = false;
    daisMesh.receiveShadow = false;
    group.add(daisMesh);

    // 4 Cardinal Vermilion Torii Gates outside arena perimeter (merged 1 draw call)
    const toriiGeos: THREE.BufferGeometry[] = [];
    for (let g = 0; g < 4; g++) {
      const ang = (g * Math.PI) / 2;
      const dist = spec.arenaRadius + 5.2;
      const pL = new THREE.CylinderGeometry(0.32, 0.38, 6.2, 8);
      pL.translate(-2.4, 3.1, dist);
      pL.rotateY(ang);
      const pR = new THREE.CylinderGeometry(0.32, 0.38, 6.2, 8);
      pR.translate(2.4, 3.1, dist);
      pR.rotateY(ang);
      const topBeam = new THREE.BoxGeometry(7.2, 0.55, 0.72);
      topBeam.translate(0, 6.1, dist);
      topBeam.rotateY(ang);
      const subBeam = new THREE.BoxGeometry(5.6, 0.36, 0.46);
      subBeam.translate(0, 4.9, dist);
      subBeam.rotateY(ang);
      toriiGeos.push(pL, pR, topBeam, subBeam);
    }
    const mergedTorii = safeMerge(toriiGeos);
    if (mergedTorii) {
      const toriiMesh = new THREE.Mesh(
        mergedTorii,
        new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.48, metalness: 0.12 })
      );
      toriiMesh.castShadow = false;
      group.add(toriiMesh);
    }
  } else if (mapId === 'obsidian') {
    const crystalCount = 12;
    const spireGeo = new THREE.ConeGeometry(1.25, 6.2, 5);
    spireGeo.translate(0, 3.0, 0);
    const crystalInst = new THREE.InstancedMesh(
      spireGeo,
      new THREE.MeshStandardMaterial({
        color: 0xc084fc,
        emissive: 0x9333ea,
        emissiveIntensity: 1.15,
        roughness: 0.25,
        metalness: 0.5,
      }),
      crystalCount
    );
    crystalInst.castShadow = false;
    crystalInst.receiveShadow = false;

    const dummy = new THREE.Object3D();
    for (let i = 0; i < crystalCount; i++) {
      const ang = (i / crystalCount) * Math.PI * 2 + 0.19;
      const dist = outerR + 3.2 + (i % 2) * 3.0;
      const scaleY = 0.9 + (i % 3) * 0.35;
      dummy.position.set(Math.cos(ang) * dist, 0, Math.sin(ang) * dist);
      dummy.rotation.set(0, ang, (i % 2 === 0 ? 1 : -1) * 0.14);
      dummy.scale.set(1, scaleY, 1);
      dummy.updateMatrix();
      crystalInst.setMatrixAt(i, dummy.matrix);
    }
    crystalInst.instanceMatrix.needsUpdate = true;
    group.add(crystalInst);

    const centerSeal = new THREE.Mesh(
      new THREE.RingGeometry(5.8, 6.2, 6),
      new THREE.MeshBasicMaterial({
        color: 0xa855f7,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    centerSeal.rotation.x = -Math.PI * 0.5;
    centerSeal.position.y = 0.035;
    centerSeal.castShadow = false;
    centerSeal.receiveShadow = false;
    group.add(centerSeal);
    animatedMeshes.push((dt) => {
      centerSeal.rotation.z += dt * 0.25;
    });
  }

  // Destructible Buildings / Ruins / Shrines / Bastions inside the Arena
  const crackTexLow = createCrackOverlayTexture(false);
  const crackTexHigh = createCrackOverlayTexture(true);
  const crackMatLow = new THREE.MeshBasicMaterial({
    map: crackTexLow,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const crackMatHigh = new THREE.MeshBasicMaterial({
    map: crackTexHigh,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });

  const obstacleEntries = new Map<string, ObstacleRenderEntry>();
  getMapObstacles(mapId).forEach((obs, idx) => {
    const gy = getMapTerrainHeight(mapId, obs.x, obs.z);
    const entry = buildObstacleVisual(obs, idx, mapId, gy, crackMatLow, crackMatHigh, extraTextures);
    group.add(entry.wrapper);
    obstacleEntries.set(obs.id, entry);
  });

  animatedMeshes.push((dt) => {
    for (const entry of obstacleEntries.values()) {
      if (entry.shakeTimer > 0) {
        entry.shakeTimer = Math.max(0, entry.shakeTimer - dt);
        const mag = (entry.shakeTimer / 0.14) * 0.14;
        entry.wrapper.position.set(
          entry.baseX + (Math.random() - 0.5) * mag,
          entry.baseY,
          entry.baseZ + (Math.random() - 0.5) * mag
        );
      } else if (entry.wrapper.position.x !== entry.baseX || entry.wrapper.position.z !== entry.baseZ) {
        entry.wrapper.position.set(entry.baseX, entry.baseY, entry.baseZ);
      }
    }
  });

  // Ambient drifting atmospheric motes (single InstancedMesh draw call, zero-GC updates)
  const moteCount = 44;
  const moteGeo = new THREE.OctahedronGeometry(0.13, 0);
  const moteColor =
    mapId === 'shibuya'
      ? 0x38bdf8
      : mapId === 'meadow'
      ? 0xfef08a
      : mapId === 'temple'
      ? 0xfb923c
      : 0xc084fc;
  const moteMat = new THREE.MeshBasicMaterial({
    color: moteColor,
    transparent: true,
    opacity: mapId === 'shibuya' ? 0.48 : 0.72,
    blending: mapId === 'shibuya' ? THREE.NormalBlending : THREE.AdditiveBlending,
    depthWrite: false,
  });
  const moteInst = new THREE.InstancedMesh(moteGeo, moteMat, moteCount);
  moteInst.frustumCulled = false;
  const moteSeeds = Array.from({ length: moteCount }, (_, i) => ({
    angle: (i / moteCount) * Math.PI * 2,
    radius: 8.5 + (i % 9) * 3.2,
    baseY: 0.9 + (i % 5) * 1.2,
    speed: (i % 2 === 0 ? 1 : -1) * (0.12 + (i % 4) * 0.045),
    bobSpeed: 1.4 + (i % 3) * 0.6,
    scale: 0.65 + (i % 4) * 0.22,
  }));
  const moteDummy = new THREE.Object3D();
  group.add(moteInst);
  animatedMeshes.push((_dt, elapsed) => {
    for (let i = 0; i < moteCount; i++) {
      const s = moteSeeds[i];
      const a = s.angle + elapsed * s.speed;
      moteDummy.position.set(
        Math.cos(a) * s.radius,
        s.baseY + Math.sin(elapsed * s.bobSpeed + i) * 0.45,
        Math.sin(a) * s.radius
      );
      moteDummy.rotation.set(elapsed * 1.1 + i, elapsed * 0.8, 0);
      const pulse = s.scale * (0.75 + 0.3 * Math.sin(elapsed * 3.0 + i * 1.3));
      moteDummy.scale.setScalar(pulse);
      moteDummy.updateMatrix();
      moteInst.setMatrixAt(i, moteDummy.matrix);
    }
    moteInst.instanceMatrix.needsUpdate = true;
  });

  return {
    group,
    update: (dt, elapsed) => {
      for (const fn of animatedMeshes) fn(dt, elapsed);
    },
    syncObstacles: (obstacles, vfx) => {
      if (!obstacles) return;
      for (const obs of obstacles) {
        const entry = obstacleEntries.get(obs.id);
        if (!entry) continue;
        if (obs.hp < entry.lastHp && !obs.destroyed) {
          entry.shakeTimer = 0.14;
        }
        entry.lastHp = obs.hp;

        if (obs.destroyed) {
          if (!entry.wasDestroyed) {
            entry.wasDestroyed = true;
            vfx?.spawnRubbleBurst(
              entry.baseX,
              entry.baseY,
              entry.baseZ,
              Math.max(entry.spec.halfW, entry.spec.halfD),
              entry.spec.roofColorHex
            );
          }
          entry.mainGroup.visible = false;
          entry.crackLow.visible = false;
          entry.crackHigh.visible = false;
          entry.rubbleGroup.visible = true;
        } else {
          entry.wasDestroyed = false;
          entry.mainGroup.visible = true;
          entry.rubbleGroup.visible = false;
          const pct = obs.hp / Math.max(1, obs.maxHp);
          entry.crackLow.visible = pct < 0.72;
          entry.crackHigh.visible = pct < 0.38;
        }
      }
    },
    dispose: () => {
      scene.remove(group);
      group.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) {
          if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
          else m.material.dispose();
        }
      });
      for (const tex of extraTextures) tex.dispose();
      crackTexLow.dispose();
      crackTexHigh.dispose();
      groundTex.dispose();
      bumpTex.dispose();
    },
  };
}

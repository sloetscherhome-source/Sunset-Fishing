// ================= Sunset Fishing — Three.js 3D scene =================

// progress saves to localStorage as you play (per browser, per computer) —
// see "Save / restore" near the bottom of this file.

// bumped on every published update — a save from any other version is wiped
// on load, so everyone starts fresh once after each update
const SAVE_VERSION = 3;
(function resetSaveIfOutdated() {
  try {
    if (localStorage.getItem('sunsetFishing.saveVersion') === String(SAVE_VERSION)) return;
    Object.keys(localStorage)
      .filter((k) => k.startsWith('sunsetFishing.'))
      .forEach((k) => localStorage.removeItem(k));
    localStorage.setItem('sunsetFishing.saveVersion', String(SAVE_VERSION));
  } catch (e) { /* localStorage unavailable — nothing saved to reset */ }
})();

const W = 460, H = 740;
const scoreEl = document.getElementById('score');
// the on-screen message text was removed (top-right now hosts the manual
// button instead) — kept as a no-op so the many call sites throughout the
// file that report state changes ("Casting...", "BITE!", etc.) don't need
// to be touched individually
function setMessage(t) {}

const wrap = document.getElementById('wrap');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(W, H, false); // keep the canvas's internal resolution fixed; CSS scales it responsively to fit the screen
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
// toon shading reads best with a crisp, hard-edged shadow rather than a soft
// penumbra — PCF still antialiases the edge a touch so it doesn't look
// pixelated, but doesn't blur it into a gradient like PCFSoft did
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
wrap.insertBefore(renderer.domElement, wrap.firstChild);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(58, W / H, 0.1, 1200);
camera.position.set(6, 5.2, 20);
camera.lookAt(new THREE.Vector3(-1, -0.3, -30));

// ------------------------------------------------------------------
// Toon shading helpers — a shared stepped gradient ramp (so MeshToonMaterial
// renders flat color bands instead of smooth shading) and an inverted-hull
// outline (a slightly-scaled, backface-only black copy of a mesh, added as
// its own child) for that cel-shaded "ink line" look. Both are procedural —
// no texture/model files involved, same as the existing canvas-texture tricks
// used elsewhere in this file (net crosshatch, music notes, sky glow).
// ------------------------------------------------------------------
// more bands + linear filtering than a typical hard toon ramp — this keeps a
// soft stylized falloff (recovers shading nuance/form) rather than flat,
// poster-like cutouts, while still reading as cel-shaded rather than fully
// smooth-shaded like the water (see waterMat, which opts out of toon entirely
// since its surface deforms every frame and hard bands there used to pop/shift)
const TOON_BANDS = 6;
function makeToonGradientTexture() {
  const c = document.createElement('canvas');
  c.width = TOON_BANDS; c.height = 1;
  const ctx2 = c.getContext('2d');
  for (let i = 0; i < TOON_BANDS; i++) {
    const v = Math.round((i / (TOON_BANDS - 1)) * 255);
    ctx2.fillStyle = `rgb(${v},${v},${v})`;
    ctx2.fillRect(i, 0, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}
const toonGradientMap = makeToonGradientTexture();
// every former `new THREE.MeshStandardMaterial(opts)` call in this file was
// mechanically swapped to `toonMat(opts)` so the whole scene gets the banded
// cel look at once. MeshToonMaterial ignores the stray roughness/metalness
// keys left over from the original options objects.
function toonMat(opts) {
  return new THREE.MeshToonMaterial(Object.assign({ gradientMap: toonGradientMap }, opts));
}
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x15110c, side: THREE.BackSide });
function addOutline(mesh, scale) {
  const o = new THREE.Mesh(mesh.geometry, outlineMat);
  o.scale.setScalar(scale || 1.04);
  mesh.add(o);
  return mesh;
}
// ------------------------------------------------------------------
// World reference levels
// ------------------------------------------------------------------
const topY = 0;          // wharf deck / shore level (character sits here)
const waterY = -2.2;     // water surface level
const wharfLeftWidth = 3.2;  // deck extends further out on this side
const wharfRightWidth = 1.2;
const wharfCenterX = (wharfRightWidth - wharfLeftWidth) / 2;
const wharfTipZ = -5;    // far end of the wharf, out over the water (character sits here)
const wharfShoreZ = 16;  // where the wharf meets the shore/grass
const beachNearZ = wharfTipZ + 10; // where the beach meets open water
const beachFarZ = wharfShoreZ - 2;  // where the beach meets the grass
const swashRange = 6.5;  // how far up the sand the waves can reach at peak swash

// ------------------------------------------------------------------
// Lighting — warm low sun + soft sky fill
// ------------------------------------------------------------------
// Pushed back to z=-438 (from -170) so the camera ray to its lower rim
// crosses the real water at a depth close to where the water mesh's own far
// edge sits — that's the same screen row the horizon reads at everywhere else
// in the image, so the natural (untouched) depth occlusion lines up flush
// with the rest of the horizon instead of cutting at a nearer, lower row.
// Radius/glow scaled up to compensate so the disc still reads the same
// apparent size on screen despite being farther away.
const sunPos = new THREE.Vector3(6, 5, -438);

const sunLight = new THREE.DirectionalLight(0xffb86b, 1.1);
sunLight.position.copy(sunPos).normalize().multiplyScalar(80);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(1024, 1024);
sunLight.shadow.camera.left = -12;
sunLight.shadow.camera.right = 12;
sunLight.shadow.camera.top = 12;
sunLight.shadow.camera.bottom = -12;
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 60;
sunLight.shadow.bias = -0.003;
sunLight.target.position.set(0, 0, wharfTipZ);
scene.add(sunLight, sunLight.target);

const hemi = new THREE.HemisphereLight(0x8fd4ff, 0x3a5a30, 0.4);
scene.add(hemi);

const fill = new THREE.AmbientLight(0xffe0b3, 0.15);
scene.add(fill);

// ------------------------------------------------------------------
// Sky dome (gradient) + sun disc + glow
// ------------------------------------------------------------------
const skyGeo = new THREE.SphereGeometry(500, 32, 20);
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  uniforms: {
    topColor: { value: new THREE.Color(0x1596d6) },
    horizonColor: { value: new THREE.Color(0xffb04d) },
    bottomColor: { value: new THREE.Color(0x2a3560) }
  },
  vertexShader: `
    varying vec3 vPos;
    void main() {
      vPos = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    varying vec3 vPos;
    uniform vec3 topColor;
    uniform vec3 horizonColor;
    uniform vec3 bottomColor;
    void main() {
      float h = normalize(vPos).y;
      vec3 col;
      if (h > 0.05) {
        col = mix(horizonColor, topColor, smoothstep(0.0, 0.55, h));
      } else {
        col = mix(bottomColor, horizonColor, smoothstep(-0.15, 0.05, h));
      }
      gl_FragColor = vec4(col, 1.0);
    }
  `
});
const sky = new THREE.Mesh(skyGeo, skyMat);
sky.name = 'sky';
scene.add(sky);

const sunMesh = new THREE.Mesh(
  new THREE.SphereGeometry(26.5, 24, 24),
  new THREE.MeshBasicMaterial({ color: 0xffd257 })
);
sunMesh.position.copy(sunPos);
sunMesh.name = 'sun';
sunMesh.material.fog = false;
scene.add(sunMesh);

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx2 = c.getContext('2d');
  const g = ctx2.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,220,140,0.55)');
  g.addColorStop(0.4, 'rgba(255,180,100,0.22)');
  g.addColorStop(1, 'rgba(255,150,80,0)');
  ctx2.fillStyle = g;
  ctx2.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}
const glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({
  map: makeGlowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
}));
glowSprite.scale.set(133, 133, 1);
glowSprite.position.copy(sunPos);
glowSprite.material.fog = false;
scene.add(glowSprite);

scene.fog = new THREE.FogExp2(0x2a4a6a, 0.0028);

// ------------------------------------------------------------------
// Shore — grass with a sandy strip where the wharf meets land
// ------------------------------------------------------------------
const grassGeo = new THREE.PlaneGeometry(40, 26, 24, 16);
grassGeo.rotateX(-Math.PI / 2);
grassGeo.translate(0, topY, wharfShoreZ + 11);
{
  const pos = grassGeo.attributes.position;
  const colors = [];
  const green = new THREE.Color(0x2e8b46);
  const sand = new THREE.Color(0xd8bf7e);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const jitter = (Math.sin(x * 1.7) * Math.cos(z * 1.3) + Math.sin(x * 0.6 + z * 0.9)) * 0.02;
    pos.setY(i, topY + jitter);
    const t = THREE.MathUtils.clamp(1 - (z - wharfShoreZ) / 4, 0, 1); // near the wharf -> sandy
    const c = green.clone().lerp(sand, t * 0.85);
    colors.push(c.r, c.g, c.b);
  }
  grassGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  grassGeo.computeVertexNormals();
}
const grassMat = toonMat({ vertexColors: true, roughness: 0.95, metalness: 0 });
const grassMesh = new THREE.Mesh(grassGeo, grassMat);
grassMesh.receiveShadow = true;
scene.add(grassMesh);

// ------------------------------------------------------------------
// Beach — sand slope with an animated swash/backwash line where waves
// wash up the sand and drain back out, so the shore reads as wet, not submerged.
// ------------------------------------------------------------------
const beachWetSand = new THREE.Color(0x8c6d3c);
const beachDrySand = new THREE.Color(0xd8bf7e);
const beachFoam = new THREE.Color(0xf3f6ee);
const beachShallow = new THREE.Color(0x6fae9e);

const beachGeo = new THREE.PlaneGeometry(40, beachFarZ - beachNearZ, 48, 22);
beachGeo.rotateX(-Math.PI / 2);
beachGeo.translate(0, 0, (beachNearZ + beachFarZ) / 2);
beachGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(beachGeo.attributes.position.count * 3), 3));

// static per-vertex grain so the sand has fine, non-animated texture
const beachGrain = new Float32Array(beachGeo.attributes.position.count);
{
  const pos = beachGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    beachGrain[i] = n - Math.floor(n); // pseudo-random 0..1
  }
}

const beachMat = toonMat({ vertexColors: true, roughness: 0.95, metalness: 0 });
const beachMesh = new THREE.Mesh(beachGeo, beachMat);
beachMesh.receiveShadow = true;
scene.add(beachMesh);

function updateBeach(t) {
  const pos = beachGeo.attributes.position;
  const colorAttr = beachGeo.attributes.color;

  // asymmetric wave cycle: quick rush in, slower drain back out (real swash/backwash timing)
  const cycle = 9;
  const local = (t % cycle) / cycle;
  let swashPhase;
  if (local < 0.25) {
    const p = local / 0.25;
    swashPhase = 1 - Math.pow(1 - p, 3); // fast rush up the sand
  } else {
    const p = (local - 0.25) / 0.75;
    swashPhase = Math.pow(1 - p, 1.5); // slow backwash draining away
  }

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const slopeT = THREE.MathUtils.clamp((z - beachNearZ) / (beachFarZ - beachNearZ), 0, 1);
    const slope = slopeT * slopeT * (3 - 2 * slopeT); // smoothstep — concave beach curve
    const grain = beachGrain[i];
    const fineTexture = Math.sin(z * 3.4 + x * 0.5) * 0.012 + Math.sin(x * 5.1 - z * 1.7) * 0.008 + (grain - 0.5) * 0.02;
    let y = waterY + (topY - waterY) * slope + fineTexture * (0.25 + slopeT * 0.75);

    // current leading edge of the swash, with a wavy (non-straight) waterline
    const waterlineZ = beachNearZ + 0.25 + swashPhase * swashRange + Math.sin(x * 0.22 + t * 0.3) * 0.35;
    const distToLine = z - waterlineZ;

    let c;
    if (distToLine < -0.55) {
      c = beachShallow.clone();
      y += 0.05; // thin sheet of water sitting on the sand
    } else if (distToLine < 0.22) {
      const foamT = THREE.MathUtils.clamp((distToLine + 0.55) / 0.77, 0, 1);
      c = beachFoam.clone().lerp(beachWetSand, foamT);
      y += (1 - foamT) * 0.035;
    } else {
      const dryT = THREE.MathUtils.clamp((distToLine - 0.22) / 2.6, 0, 1);
      c = beachWetSand.clone().lerp(beachDrySand, dryT);
    }

    const speck = (grain - 0.5) * 0.12;
    c.r = THREE.MathUtils.clamp(c.r + speck, 0, 1);
    c.g = THREE.MathUtils.clamp(c.g + speck * 0.9, 0, 1);
    c.b = THREE.MathUtils.clamp(c.b + speck * 0.65, 0, 1);

    pos.setY(i, y);
    colorAttr.setXYZ(i, c.r, c.g, c.b);
  }
  pos.needsUpdate = true;
  colorAttr.needsUpdate = true;
  beachGeo.computeVertexNormals();
}

// ------------------------------------------------------------------
// Wharf — a wooden plank deck on pilings, running from the shore out over the water
// ------------------------------------------------------------------
const deckLength = wharfShoreZ - wharfTipZ;
const plankCount = 14;
const plankLen = deckLength / plankCount;
// Plain smooth-shaded materials here (not toonMat) and no ink outlines on the
// individual boards/posts below — unlike the character/fish/props, the wharf
// is structural environment like the water/beach/grass around it, which are
// all smooth-shaded too. Toon banding + bold black silhouette outlines made
// every board read as its own graphic-novel sticker and the whole structure
// stood out against the softer surroundings; this brings it back in line.
const plankMats = [
  new THREE.MeshStandardMaterial({ color: 0x8a6a44, roughness: 0.85 }),
  new THREE.MeshStandardMaterial({ color: 0x80603f, roughness: 0.85 })
];
// soft dark "grout" strip dropped at every plank boundary (including both
// deck ends) and down both long outer edges, so board joints and the deck
// perimeter still read clearly without needing a hard ink outline on every
// individual board.
const seamMat = new THREE.MeshBasicMaterial({ color: 0x3a2c1c, transparent: true, opacity: 0.55 });
const seamH = 0.03, seamD = 0.03; // thin — a painted line, not a raised rail
const deckHalfWidth = (wharfLeftWidth + wharfRightWidth - 0.05) / 2;
for (let i = 0; i < plankCount; i++) {
  const zc = wharfTipZ + i * plankLen + plankLen / 2;
  // deterministic (not time-random, so it's stable across reloads) per-plank
  // wobble — slight height/shade variation so the deck reads as worn, hand-laid
  // boards rather than a perfectly uniform printed grid
  const wobbleRaw = Math.sin(i * 12.9898) * 43758.5453;
  const wobble = wobbleRaw - Math.floor(wobbleRaw); // 0..1 pseudo-random, same hash style as beachGrain
  const yJitter = (wobble - 0.5) * 0.05;
  const shadeJitter = (Math.sin(i * 7.233) * 0.5) * 0.035;
  const geo = new THREE.BoxGeometry(wharfLeftWidth + wharfRightWidth - 0.05, 0.3, plankLen - 0.08);
  const mat = plankMats[i % 2].clone();
  mat.color.offsetHSL(0, 0, shadeJitter);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(wharfCenterX, topY - 0.15 + yJitter, zc);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
}
// cross-strips at every plank boundary, including the tip and shore ends
for (let i = 0; i <= plankCount; i++) {
  const seamGeo = new THREE.BoxGeometry(wharfLeftWidth + wharfRightWidth + 0.02, seamH, seamD);
  const seam = new THREE.Mesh(seamGeo, seamMat);
  seam.position.set(wharfCenterX, topY + 0.01, wharfTipZ + i * plankLen);
  scene.add(seam);
}
// long strips down both outer edges
[-deckHalfWidth, deckHalfWidth].forEach((xOff) => {
  const edgeGeo = new THREE.BoxGeometry(seamD, seamH, deckLength + 0.04);
  const edge = new THREE.Mesh(edgeGeo, seamMat);
  edge.position.set(wharfCenterX + xOff, topY + 0.01, (wharfTipZ + wharfShoreZ) / 2);
  scene.add(edge);
});

// a soft radial falloff texture, reused below for both the water ripples and
// the sand disturbance patches — same procedural-canvas trick as the sky glow
// sprite elsewhere in this file, just grayscale so it can be tinted per-use
function makeSoftRadialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx2 = c.getContext('2d');
  const g = ctx2.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx2.fillStyle = g;
  ctx2.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const softRadialTex = makeSoftRadialTexture();

// Pilings — posts further inland sit in sand and get a small disturbed-sand
// stain at the base; posts out over open water are split into a dry (above
// the surface) and wet (submerged) segment with a distinctly darker, mossier
// material at the break, plus a soft ripple that continuously laps against
// every one of them. That color break and the ripple are what actually sell
// "this post keeps going down into the water" instead of fading into the
// water color and looking cut off.
const pilingMat = new THREE.MeshStandardMaterial({ color: 0x4a3323, roughness: 0.9 });
const pilingWetMat = new THREE.MeshStandardMaterial({ color: 0x33432f, roughness: 0.95 });
const pilingXs = [-(wharfLeftWidth - 0.15), wharfCenterX, wharfRightWidth - 0.15];
const pilingWaterMarkers = [];
const pilingTop = topY - 0.3, pilingBottom = waterY - 3.2;
const pilingRTop = 0.12, pilingRBottom = 0.15;
const pilingWaterFrac = (waterY - pilingBottom) / (pilingTop - pilingBottom);
const pilingRAtWater = pilingRBottom + (pilingRTop - pilingRBottom) * pilingWaterFrac;
const WATER_RIPPLE_DURATION = 2.6;
const sandPatchColor = new THREE.Color(0x7d5c38);
let pilingSeed = 0;
for (let z = wharfTipZ + 1.2; z <= wharfShoreZ - 1.2; z += 3.5) {
  const overWater = z < beachNearZ; // further inland pilings sit in sand, not water
  pilingXs.forEach((x) => {
    pilingSeed++;
    if (overWater) {
      const dryGeo = new THREE.CylinderGeometry(pilingRTop, pilingRAtWater, pilingTop - waterY, 8);
      dryGeo.translate(0, (pilingTop - waterY) / 2, 0);
      const dryMesh = new THREE.Mesh(dryGeo, pilingMat);
      dryMesh.position.set(x, waterY, z);
      dryMesh.castShadow = true;
      scene.add(dryMesh);

      const wetGeo = new THREE.CylinderGeometry(pilingRAtWater, pilingRBottom, waterY - pilingBottom, 8);
      wetGeo.translate(0, -(waterY - pilingBottom) / 2, 0);
      const wetMesh = new THREE.Mesh(wetGeo, pilingWetMat);
      wetMesh.position.set(x, waterY, z);
      scene.add(wetMesh);

      // own material per post (not shared) so each ripple's fade/scale can
      // animate independently — a shared material here was the earlier bug
      // that made only one post ever appear to ripple
      const rippleMat = new THREE.MeshBasicMaterial({
        map: softRadialTex, color: 0xeef5ff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide
      });
      const ripple = new THREE.Mesh(new THREE.CircleGeometry(0.4, 20), rippleMat);
      ripple.rotation.x = -Math.PI / 2;
      ripple.position.set(x, waterY, z);
      scene.add(ripple);
      pilingWaterMarkers.push({ mesh: ripple, x, z, phase: (pilingSeed * 0.9) % WATER_RIPPLE_DURATION });
    } else {
      const geo = new THREE.CylinderGeometry(pilingRTop, pilingRBottom, pilingTop - pilingBottom, 8);
      geo.translate(0, (pilingTop - pilingBottom) / 2, 0);
      const mesh = new THREE.Mesh(geo, pilingMat);
      mesh.position.set(x, pilingBottom, z);
      mesh.castShadow = true;
      scene.add(mesh);

      // static disturbed-sand stain at the base, roughly at the beach's slope
      // height for this (x,z) — same slope formula updateBeach() uses, just
      // without its per-frame swash/foam terms since this patch doesn't animate
      const slopeT = THREE.MathUtils.clamp((z - beachNearZ) / (beachFarZ - beachNearZ), 0, 1);
      const slope = slopeT * slopeT * (3 - 2 * slopeT);
      const groundY = waterY + (topY - waterY) * slope;
      const patchMat = new THREE.MeshBasicMaterial({
        map: softRadialTex, color: sandPatchColor, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide
      });
      const patch = new THREE.Mesh(new THREE.CircleGeometry(0.4, 20), patchMat);
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(x, groundY + 0.02, z);
      scene.add(patch);
    }
  });
}
function updatePilingWaterMarkers(t) {
  pilingWaterMarkers.forEach((m) => {
    const y = waveHeight(m.x, m.z, t);
    m.mesh.position.set(m.x, y + 0.05, m.z); // held clear of the animated surface to avoid z-fighting flicker
    const cycle = ((t + m.phase) % WATER_RIPPLE_DURATION) / WATER_RIPPLE_DURATION;
    const s = 0.4 + cycle * 1.4;
    m.mesh.scale.set(s, s, s);
    m.mesh.material.opacity = (1 - cycle) * 0.5;
  });
}

// ------------------------------------------------------------------
// Water — animated waves, sunset-tinted horizon
// ------------------------------------------------------------------
const waterSegs = 84;
const waterGeo = new THREE.PlaneGeometry(420, 420, waterSegs, waterSegs);
waterGeo.rotateX(-Math.PI / 2);
waterGeo.translate(0, waterY, wharfTipZ - 200);
const waterColorsAttr = [];
{
  const pos = waterGeo.attributes.position;
  const deep = new THREE.Color(0x1c2f8f);
  const warm = new THREE.Color(0x9a5a6e);
  const shallow = new THREE.Color(0x6fae9e);
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const t = THREE.MathUtils.clamp((-z - 40) / 340, 0, 1); // far (-z big) -> warm horizon tint
    const c = deep.clone().lerp(warm, t * 0.3);
    const shoreT = THREE.MathUtils.clamp((z - (beachNearZ - 16)) / 16, 0, 1); // near the beach -> pale shallow water
    c.lerp(shallow, shoreT * 0.8);
    waterColorsAttr.push(c.r, c.g, c.b);
  }
  waterGeo.setAttribute('color', new THREE.Float32BufferAttribute(waterColorsAttr, 3));
}
// deliberately NOT toonMat() here, unlike the rest of the scene — the water's
// normals are recomputed every frame as the waves animate (see animate()),
// and the toon gradient-map's lighting bands would snap between steps as
// those normals shift, reading as flickering/popping polygon facets on the
// surface. A smooth-lit material keeps the wave motion shading continuous.
const waterMat = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.75, metalness: 0, transparent: true, opacity: 0.94,
  emissive: new THREE.Color(0x111f52), emissiveIntensity: 0.55
});
const waterMesh = new THREE.Mesh(waterGeo, waterMat);
waterMesh.name = 'water';
waterMesh.receiveShadow = true;
scene.add(waterMesh);

function waveHeight(x, z, t) {
  const raw = Math.sin(x * 0.15 + t * 1.1) * 0.22 +
    Math.sin(z * 0.09 - t * 0.65) * 0.32 +
    Math.sin((x + z) * 0.05 + t * 0.4) * 0.16 +
    Math.sin(x * 0.35 - t * 1.4) * 0.07;
  // flatten the swell as it nears the beach so it doesn't fight the swash animation there
  const shoreFade = THREE.MathUtils.clamp((beachNearZ - z) / 9, 0, 1);
  // flatten toward the far horizon too, so the distant ocean reads as calm/flat
  const farFade = THREE.MathUtils.clamp((z + 170) / 130, 0, 1);
  return waterY + raw * shoreFade * farFade;
}

// ------------------------------------------------------------------
// Character — built from primitives, seated on the cliff edge
// ------------------------------------------------------------------
const skinMat = toonMat({ color: 0xe0a877, roughness: 0.8 });
const shirtMat = toonMat({ color: 0x2c5c8a, roughness: 0.75 });
const pantsMat = toonMat({ color: 0x2e2f38, roughness: 0.8 });
const bootMat = toonMat({ color: 0x3a2a1e, roughness: 0.7 });
const hairMat = toonMat({ color: 0x1c140f, roughness: 0.7 });
const rodMat = toonMat({ color: 0x6b4a2a, roughness: 0.6 });

function limb(a, b, r0, r1, mat, outline) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(r1, r0, len, 8);
  geo.translate(0, len / 2, 0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(a);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  mesh.castShadow = true;
  if (outline !== false) addOutline(mesh);
  return mesh;
}

const character = new THREE.Group();
character.position.set(0, topY, wharfTipZ + 0.85);
scene.add(character);

// torso (slight forward lean)
const torsoGeo = new THREE.CylinderGeometry(0.34, 0.4, 1.05, 10);
torsoGeo.translate(0, 0.52, 0);
const torso = new THREE.Mesh(torsoGeo, shirtMat);
torso.position.set(0, 0, 0);
torso.rotation.x = -0.12;
torso.castShadow = true;
addOutline(torso);
character.add(torso);

const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 16), skinMat);
head.position.set(0, 1.42, -0.12);
head.castShadow = true;
addOutline(head);
character.add(head);

const hair = new THREE.Mesh(new THREE.SphereGeometry(0.31, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
hair.position.copy(head.position).add(new THREE.Vector3(0, 0.04, 0));
hair.castShadow = true;
addOutline(hair);
character.add(hair);

// Fishing Hat cosmetic (bought in the shop) — sits on the head while worn, kept in
// world space (not parented to the character) so it can detach and tumble off on its own
const hatMat = toonMat({ color: 0xcdbb8a, roughness: 0.7 });
const hatGroup = new THREE.Group();
const hatCrown = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.18, 12), hatMat);
hatCrown.position.set(0, 0.09, 0);
hatCrown.castShadow = true;
addOutline(hatCrown);
hatGroup.add(hatCrown);
const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.03, 16), hatMat);
hatBrim.position.set(0, 0.01, 0);
hatBrim.castShadow = true;
addOutline(hatBrim);
hatGroup.add(hatBrim);
hatGroup.visible = false;
scene.add(hatGroup);

let hatFlying = false;
let hatFloating = false;
let hatFlyTimer = 0;
const hatFlyStart = new THREE.Vector3();
const hatDriftDir = new THREE.Vector3();
const hatHeadWorldPos = new THREE.Vector3();

// a quick burst of streaking wind lines — the visible "gust" that knocks the hat off.
// they spawn upwind (the opposite side from where the hat ends up flying) and sweep
// through, so it reads as wind blowing in from behind and pushing the hat along.
const windStreakMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 });
const activeWindStreaks = [];
function triggerWindGust(origin, dir) {
  const perpX = -dir.z, perpZ = dir.x;
  const upwind = dir.clone().multiplyScalar(-1.4);
  for (let i = 0; i < 7; i++) {
    const spread = (Math.random() - 0.5) * 1.3;
    const heightJitter = (Math.random() - 0.5) * 0.7;
    const start = origin.clone().add(upwind).add(new THREE.Vector3(perpX * spread, heightJitter, perpZ * spread));
    const len = 0.7 + Math.random() * 0.7;
    const end = start.clone().add(dir.clone().multiplyScalar(len));
    const mesh = limb(start, end, 0.015, 0.05, windStreakMat.clone(), false);
    scene.add(mesh);
    activeWindStreaks.push({ mesh, t: 0, dir: dir.clone(), origin: start.clone() });
  }
}
function updateWindGust(dt) {
  const GUST_DUR = 0.5;
  for (let i = activeWindStreaks.length - 1; i >= 0; i--) {
    const s = activeWindStreaks[i];
    s.t += dt;
    const p = Math.min(s.t / GUST_DUR, 1);
    s.mesh.position.copy(s.origin).addScaledVector(s.dir, p * 2.6);
    s.mesh.material.opacity = 0.6 * (1 - p);
    if (p >= 1) {
      scene.remove(s.mesh);
      s.mesh.geometry.dispose();
      s.mesh.material.dispose();
      activeWindStreaks.splice(i, 1);
    }
  }
}

const HAT_LAUNCH_SPEED = 3.4; // the initial gust-knocked-off toss
const HAT_DRIFT_SPEED = 1.1;  // gentle current once it's floating — much slower than the toss
const hatLandPos = new THREE.Vector3();
let hatFloatTimer = 0;

function blowHatOff() {
  hatOwned = false;
  hatFlying = true;
  hatFloating = false;
  hatFlyTimer = 0;
  hatFlyStart.copy(hatGroup.position);
  const side = Math.random() < 0.5 ? -1 : 1;
  hatDriftDir.set(side, 0, -0.35).normalize();
  triggerWindGust(hatFlyStart, hatDriftDir);
}

function updateHat(dt, t) {
  if (hatOwned) {
    head.getWorldPosition(hatHeadWorldPos);
    hatGroup.position.set(hatHeadWorldPos.x, hatHeadWorldPos.y + 0.32, hatHeadWorldPos.z);
    hatGroup.rotation.set(0, 0, 0);
    hatGroup.visible = true;
  } else if (hatFlying) {
    hatGroup.visible = true;
    if (!hatFloating) {
      hatFlyTimer += dt;
      const p = hatFlyTimer;
      const x = hatFlyStart.x + hatDriftDir.x * HAT_LAUNCH_SPEED * p;
      const z = hatFlyStart.z + hatDriftDir.z * HAT_LAUNCH_SPEED * p;
      const y = hatFlyStart.y + 5.2 * p - 4.9 * p * p;
      const waterHere = waveHeight(x, z, t);
      if (y <= waterHere + 0.05) {
        hatFloating = true;
        hatFloatTimer = 0;
        hatLandPos.set(x, waterHere, z);
        triggerSplash(new THREE.Vector3(x, waterHere + 0.02, z));
        hatGroup.position.set(x, waterHere + 0.06, z);
      } else {
        hatGroup.position.set(x, y, z);
        hatGroup.rotation.x += dt * 7;
        hatGroup.rotation.z += dt * 5;
      }
    } else {
      hatFloatTimer += dt;
      const x = hatLandPos.x + hatDriftDir.x * HAT_DRIFT_SPEED * hatFloatTimer;
      const z = hatLandPos.z + hatDriftDir.z * HAT_DRIFT_SPEED * hatFloatTimer;
      hatGroup.position.set(x, waveHeight(x, z, t) + 0.06, z);
      hatGroup.rotation.x = Math.sin(t * 2.2) * 0.15;
      hatGroup.rotation.z = Math.sin(t * 1.7 + 1) * 0.15;
      if (Math.abs(x) > 40 || hatFloatTimer > 45) {
        hatFlying = false;
        hatFloating = false;
        hatGroup.visible = false;
      }
    }
  } else {
    hatGroup.visible = false;
  }
  updateWindGust(dt);
}

// Little Radio cosmetic (bought in the shop) — sits on the deck, plays a small
// procedurally-synthesized chiptune loop via Web Audio, with colorful notes
// floating up out of it in time with the beat.
const radioBodyMat = toonMat({ color: 0x2b2b2e, roughness: 0.6 });
const radioAccentMat = toonMat({ color: 0xc9a227, roughness: 0.5 });
const radioSpeakerMat = toonMat({ color: 0x111114, roughness: 0.8 });

const radioGroup = new THREE.Group();
radioGroup.visible = false;
radioGroup.position.set(-1.3, topY, wharfTipZ + 1.4);
scene.add(radioGroup);

const radioBody = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.32, 0.22), radioBodyMat);
radioBody.position.set(0, 0.16, 0);
radioBody.castShadow = true;
addOutline(radioBody);
radioGroup.add(radioBody);

[-0.13, 0.13].forEach((xOff) => {
  const speaker = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.03, 16), radioSpeakerMat);
  speaker.rotation.x = Math.PI / 2;
  speaker.position.set(xOff, 0.16, 0.12);
  radioGroup.add(speaker);
});

radioGroup.add(limb(new THREE.Vector3(0.2, 0.3, -0.05), new THREE.Vector3(0.35, 0.75, -0.15), 0.012, 0.02, radioAccentMat));

const radioDial = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 10), radioAccentMat);
radioDial.rotation.x = Math.PI / 2;
radioDial.position.set(0, 0.28, 0.12);
radioGroup.add(radioDial);

// --- a tiny synthesized chiptune loop (no audio files — just oscillators) ---
let audioCtx = null;
function ensureAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function playRadioTone(freq, dur, type, peakGain) {
  const ctx = ensureAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(peakGain, ctx.currentTime + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + dur + 0.02);
}
function playRadioKick() {
  const ctx = ensureAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(130, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(45, ctx.currentTime + 0.12);
  gain.gain.setValueAtTime(0.28, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.18);
}
const RADIO_MELODY = [523.25, 0, 659.25, 783.99, 0, 659.25, 523.25, 392.0]; // C5 . E5 G5 . E5 C5 G4
const RADIO_KICK_STEPS = new Set([0, 4]);
const RADIO_STEP_DUR = 0.32;
let radioStepIndex = 0;
let radioScheduleTimer = null;
function playRadioStep() {
  const i = radioStepIndex % RADIO_MELODY.length;
  const freq = RADIO_MELODY[i];
  if (freq > 0) {
    playRadioTone(freq, RADIO_STEP_DUR * 1.25, 'sine', 0.16);
    spawnMusicNote();
  }
  if (RADIO_KICK_STEPS.has(i)) playRadioKick();
  radioStepIndex++;
}
function startRadioMusic() {
  if (radioScheduleTimer) return;
  radioStepIndex = 0;
  playRadioStep();
  radioScheduleTimer = setInterval(playRadioStep, RADIO_STEP_DUR * 1000);
}
function stopRadioMusic() {
  if (radioScheduleTimer) {
    clearInterval(radioScheduleTimer);
    radioScheduleTimer = null;
  }
}

// --- colorful musical notes that pop out of the radio in time with the beat ---
function makeNoteTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx2d = canvas.getContext('2d');
  ctx2d.font = '54px sans-serif';
  ctx2d.textAlign = 'center';
  ctx2d.textBaseline = 'middle';
  ctx2d.fillStyle = '#ffffff';
  ctx2d.fillText('♪', 32, 36);
  return new THREE.CanvasTexture(canvas);
}
const noteTexture = makeNoteTexture();
const NOTE_COLORS = [0xff10f0, 0x39ff14, 0x04d9ff, 0xfff01f, 0xff6700, 0xbc13fe]; // neon palette
const activeNotes = [];
function spawnMusicNote() {
  // additive blending makes the neon colors actually glow instead of just tinting a shape
  const mat = new THREE.SpriteMaterial({
    map: noteTexture,
    color: NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)],
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.45, 0.45, 1);
  sprite.position.copy(radioGroup.position).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.55, (Math.random() - 0.5) * 0.2));
  scene.add(sprite);
  activeNotes.push({ sprite, t: 0, driftX: (Math.random() - 0.5) * 0.6 });
}
function updateMusicNotes(dt) {
  const DUR = 1.6;
  for (let i = activeNotes.length - 1; i >= 0; i--) {
    const n = activeNotes[i];
    n.t += dt;
    const p = n.t / DUR;
    n.sprite.position.y += dt * 0.6;
    n.sprite.position.x += n.driftX * dt;
    n.sprite.material.opacity = Math.max(0, 1 - p);
    n.sprite.scale.setScalar(0.45 + p * 0.2);
    if (p >= 1) {
      scene.remove(n.sprite);
      n.sprite.material.dispose();
      activeNotes.splice(i, 1);
    }
  }
}

// right (rod) arm — built on a pivot at the shoulder so it can swing for the cast animation
const rShoulder = new THREE.Vector3(0.4, 1.05, -0.05);
const rElbow = new THREE.Vector3(0.62, 0.72, -0.55);
const rHand = new THREE.Vector3(0.68, 0.6, -1.05);
const rightArmPivot = new THREE.Group();
rightArmPivot.position.copy(rShoulder);
character.add(rightArmPivot);
const rElbowLocal = rElbow.clone().sub(rShoulder);
const rHandLocal = rHand.clone().sub(rShoulder);
rightArmPivot.add(limb(new THREE.Vector3(0, 0, 0), rElbowLocal, 0.13, 0.11, shirtMat));
rightArmPivot.add(limb(rElbowLocal, rHandLocal, 0.11, 0.09, skinMat));

const lShoulder = new THREE.Vector3(-0.42, 1.05, -0.05);
const lElbow = new THREE.Vector3(-0.55, 0.7, 0.25);
const lHand = new THREE.Vector3(-0.45, 0.55, 0.45);
character.add(limb(lShoulder, lElbow, 0.13, 0.11, shirtMat));
character.add(limb(lElbow, lHand, 0.11, 0.09, skinMat));

// legs — thighs go out over the edge, shins hang down off the wharf
const hip = new THREE.Vector3(0, 0.05, 0);
[-0.22, 0.22].forEach((xOff) => {
  const hipPt = hip.clone().add(new THREE.Vector3(xOff, 0, 0));
  const knee = new THREE.Vector3(xOff * 0.9, -0.1, -0.95);
  const ankle = new THREE.Vector3(xOff * 0.8, -1.35, -1.2);
  const toe = new THREE.Vector3(xOff * 0.8, -1.45, -1.55);
  character.add(limb(hipPt, knee, 0.19, 0.17, pantsMat));
  character.add(limb(knee, ankle, 0.15, 0.11, pantsMat));
  character.add(limb(ankle, toe, 0.12, 0.1, bootMat));
});

// pelvis block (so the torso reads as "sitting on the rim" rather than floating)
const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.32, 0.4), pantsMat);
seat.position.set(0, 0.02, -0.05);
seat.castShadow = true;
addOutline(seat);
character.add(seat);

// ------------------------------------------------------------------
// Fishing rod + line + bobber
// ------------------------------------------------------------------
const rodTipLocal = new THREE.Vector3(1.1, 0.95, -1.7);
const rodTipLocalRel = rodTipLocal.clone().sub(rShoulder);
const rod = limb(rHandLocal, rodTipLocalRel, 0.045, 0.02, rodMat);
rightArmPivot.add(rod);
const rodTipMarker = new THREE.Object3D();
rodTipMarker.position.copy(rodTipLocalRel);
rightArmPivot.add(rodTipMarker);
const rodTipWorldVec = new THREE.Vector3();
function getRodTipWorld() {
  return rodTipMarker.getWorldPosition(rodTipWorldVec).clone();
}

const lineMat = new THREE.LineBasicMaterial({ color: 0xd8c79a });
const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const fishingLine = new THREE.Line(lineGeo, lineMat);
scene.add(fishingLine);

// ------------------------------------------------------------------
// Scoop net — an alternate tool, bought in the Equipment tab and swapped in
// with the tool-swap button. Shares the rod's arm/hand pivot. The netting
// uses a real crosshatch texture (drawn to a canvas, same trick as the music
// note sprite) as an alpha mask, rather than relying on wireframe rendering.
// ------------------------------------------------------------------
function makeNetPatternTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.5;
  const step = 18;
  for (let x = -size; x < size * 2; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + size, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, size); ctx.lineTo(x + size, 0); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 2);
  return tex;
}
const netPatternTexture = makeNetPatternTexture();
const netHoopMat = toonMat({ color: 0xc8cdd2, roughness: 0.35, metalness: 0.6 });
const netMeshMat = toonMat({
  color: 0xf0ece0,
  alphaMap: netPatternTexture,
  transparent: true,
  side: THREE.DoubleSide,
  roughness: 0.85
});
const netTipLocal = new THREE.Vector3(1.0, 0.9, -1.3);
const netTipLocalRel = netTipLocal.clone().sub(rShoulder);
const netGroup = new THREE.Group();
netGroup.add(limb(rHandLocal, netTipLocalRel, 0.05, 0.028, rodMat));
const netHoop = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.045, 10, 24), netHoopMat);
netHoop.position.copy(netTipLocalRel);
netHoop.rotation.x = Math.PI / 2;
addOutline(netHoop);
netGroup.add(netHoop);
// netBag intentionally has no outline — it's a transparent alpha-mapped
// crosshatch mesh, and a solid inverted-hull outline would just render as a
// opaque black cone behind the netting instead of an ink line
const netBag = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.42, 20, 1, true), netMeshMat);
netBag.position.copy(netTipLocalRel).add(new THREE.Vector3(0, -0.03, 0.22));
netBag.rotation.x = Math.PI / 2;
netGroup.add(netBag);
netGroup.visible = false;
rightArmPivot.add(netGroup);

// stand-alone (not arm-attached) mesh used for the fish-food toss animation
const feedTossMat = toonMat({ color: 0xc9a86a, roughness: 0.9 });
const feedTossMesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), feedTossMat);
feedTossMesh.visible = false;
scene.add(feedTossMesh);

const bobber = new THREE.Mesh(
  new THREE.SphereGeometry(0.16, 12, 12),
  toonMat({ color: 0xe8e8f0, roughness: 0.4 })
);
bobber.castShadow = true;
bobber.visible = false;
addOutline(bobber);
scene.add(bobber);

// ripple rings
const ripples = [];
for (let i = 0; i < 3; i++) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.2, 0.28, 24),
    new THREE.MeshBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);
  ripples.push(ring);
}

// one-shot splash rings — used when junk gets chucked back into the water
const SPLASH_POOL_SIZE = 4;
const splashPool = [];
for (let i = 0; i < SPLASH_POOL_SIZE; i++) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.24, 20),
    new THREE.MeshBasicMaterial({ color: 0xe6eeff, transparent: true, opacity: 0, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);
  splashPool.push({ mesh: ring, active: false, t: 0, pos: new THREE.Vector3() });
}
function triggerSplash(pos) {
  const s = splashPool.find((s) => !s.active) || splashPool[0];
  s.active = true;
  s.t = 0;
  s.pos.copy(pos);
  s.mesh.visible = true;
}
function updateSplashes(dt) {
  const SPLASH_DUR = 0.6;
  splashPool.forEach((s) => {
    if (!s.active) return;
    s.t += dt;
    if (s.t >= SPLASH_DUR) { s.active = false; s.mesh.visible = false; return; }
    const p = s.t / SPLASH_DUR;
    s.mesh.position.set(s.pos.x, s.pos.y + 0.02, s.pos.z);
    const sc = 0.3 + p * 3.2;
    s.mesh.scale.set(sc, sc, sc);
    s.mesh.material.opacity = (1 - p) * 0.6;
  });
}

// ------------------------------------------------------------------
// Fish swimming beneath the surface — several species, shapes, sizes
// ------------------------------------------------------------------
// a shared procedural "skin" texture — multiplied with each species' own
// flat color (standard map*color behavior), so every fish keeps its own hue
// but gains the two cues that read as "a real fish" rather than a flat-shaded
// blob: countershading (darker dorsal fading to a pale belly) and a faint
// overlapping scale pattern. Kept subtle on purpose — this is a stylized toon
// scene, not a realism pass, so it's a hint of texture, not a busy one.
function makeFishSkinTexture() {
  const w = 128, h = 128;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#8f98a3');
  grad.addColorStop(0.5, '#d6dce2');
  grad.addColorStop(1, '#fbfbf8');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(55,65,78,0.14)';
  ctx.lineWidth = 1;
  const rows = 10, cols = 14;
  const rowH = h / rows, colW = w / cols;
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (colW / 2);
    for (let cI = -1; cI <= cols; cI++) {
      const cx = cI * colW + offset;
      const cy = r * rowH + rowH * 0.5;
      ctx.beginPath();
      ctx.arc(cx, cy, colW * 0.55, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  return tex;
}
const fishSkinTexture = makeFishSkinTexture();

const fishMat = toonMat({ color: 0x9fb4d8, roughness: 0.5, metalness: 0.2, map: fishSkinTexture });

const FISH_SHAPES = {
  normal: { body: [1.6, 0.7, 0.9], tailX: -0.42, tailScale: [1, 1, 0.3], finPos: [0.02, 0.16, 0] },
  elongated: { body: [2.3, 0.55, 0.7], tailX: -0.62, tailScale: [1.1, 1, 0.28], finPos: [0.1, 0.13, 0] },
  round: { body: [1.15, 1.05, 1.0], tailX: -0.3, tailScale: [0.8, 0.9, 0.32], finPos: [-0.05, 0.22, 0] }
};

function makeFishMesh(mat, shape) {
  const m = mat || fishMat;
  const s = FISH_SHAPES[shape] || FISH_SHAPES.normal;
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), m);
  body.scale.set(s.body[0], s.body[1], s.body[2]);
  body.castShadow = true;
  addOutline(body);
  g.add(body);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.3, 4), m);
  tail.rotation.z = Math.PI / 2;
  tail.position.set(s.tailX, 0, 0);
  tail.scale.set(s.tailScale[0], s.tailScale[1], s.tailScale[2]);
  addOutline(tail);
  g.add(tail);
  const finTop = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.18, 3), m);
  finTop.position.set(s.finPos[0], s.finPos[1], s.finPos[2]);
  finTop.rotation.z = Math.PI;
  finTop.scale.set(1, 1, 0.25);
  addOutline(finTop);
  g.add(finTop);
  return g;
}
function getFishHookOffset(shape) {
  const s = FISH_SHAPES[shape] || FISH_SHAPES.normal;
  return new THREE.Vector3(0.22 * s.body[0], 0, 0);
}

// a "heap of different fish" — species vary in color, body shape and size
const FISH_SPECIES = [
  { name: 'Bluegill', color: 0x9fb4d8, shape: 'normal', scale: 1.0, rarity: 'Common', weightRange: [0.3, 1.2] },
  { name: 'Perch', color: 0x8a9a4a, shape: 'normal', scale: 0.95, rarity: 'Common', weightRange: [0.4, 1.5] },
  { name: 'Bass', color: 0x3f6b42, shape: 'normal', scale: 1.2, rarity: 'Common', weightRange: [1, 5] },
  { name: 'Mackerel', color: 0xaebac2, shape: 'elongated', scale: 1.0, rarity: 'Common', weightRange: [1, 3] },
  { name: 'Sardine', color: 0xb8c6d6, shape: 'elongated', scale: 0.55, rarity: 'Common', weightRange: [0.05, 0.3], schooling: true, sellMultiplier: 4.7 },
  { name: 'Anchovy', color: 0x9fb2c2, shape: 'elongated', scale: 0.45, rarity: 'Common', weightRange: [0.02, 0.15] },
  { name: 'Herring', color: 0x8fa3b8, shape: 'elongated', scale: 0.65, rarity: 'Common', weightRange: [0.1, 0.5], schooling: true, sellMultiplier: 4.7 },
  { name: 'Minnow', color: 0xbcc9d4, shape: 'normal', scale: 0.4, rarity: 'Common', weightRange: [0.01, 0.08], schooling: true, sellMultiplier: 4.7 },
  { name: 'Tilapia', color: 0x6f8a5a, shape: 'normal', scale: 1.0, rarity: 'Common', weightRange: [0.5, 2] },
  { name: 'Crappie', color: 0x7a9a5a, shape: 'normal', scale: 0.95, rarity: 'Common', weightRange: [0.3, 1.5] },
  { name: 'Bluefish', color: 0x6f8fae, shape: 'elongated', scale: 1.1, rarity: 'Common', weightRange: [1, 4] },
  { name: 'Flounder', color: 0xb0a080, shape: 'round', scale: 0.9, rarity: 'Common', weightRange: [0.5, 3] },
  { name: 'Bullhead', color: 0x4a3c2e, shape: 'normal', scale: 0.9, rarity: 'Common', weightRange: [0.4, 2] },
  { name: 'Smelt', color: 0xc8d4dc, shape: 'elongated', scale: 0.5, rarity: 'Common', weightRange: [0.05, 0.25] },
  { name: 'Shiner', color: 0xd8e4ea, shape: 'normal', scale: 0.45, rarity: 'Common', weightRange: [0.03, 0.2] },
  { name: 'Gudgeon', color: 0x8a8a5a, shape: 'elongated', scale: 0.55, rarity: 'Common', weightRange: [0.05, 0.3] },
  { name: 'Roach', color: 0xc98a7a, shape: 'normal', scale: 0.8, rarity: 'Common', weightRange: [0.2, 1] },
  { name: 'Chub', color: 0x8a7a6a, shape: 'normal', scale: 0.9, rarity: 'Common', weightRange: [0.3, 1.8] },
  { name: 'Dace', color: 0xa8c2a0, shape: 'elongated', scale: 0.55, rarity: 'Common', weightRange: [0.1, 0.6] },
  { name: 'Bream', color: 0xb89a5a, shape: 'round', scale: 1.0, rarity: 'Common', weightRange: [0.4, 2.5] },
  { name: 'Rainbow Trout', color: 0x6f9aab, shape: 'normal', scale: 1.05, rarity: 'Uncommon', weightRange: [1, 4] },
  { name: 'Red Snapper', color: 0xc0503a, shape: 'round', scale: 1.1, rarity: 'Uncommon', weightRange: [2, 8] },
  { name: 'Clownfish', color: 0xe8722f, shape: 'round', scale: 0.75, rarity: 'Uncommon', weightRange: [0.05, 0.2] },
  { name: 'Carp', color: 0xa89058, shape: 'round', scale: 1.15, rarity: 'Uncommon', weightRange: [2, 10] },
  { name: 'Salmon', color: 0xd88a7a, shape: 'elongated', scale: 1.15, rarity: 'Uncommon', weightRange: [3, 12] },
  { name: 'Walleye', color: 0x9a8a4a, shape: 'normal', scale: 1.1, rarity: 'Uncommon', weightRange: [1.5, 6] },
  { name: 'Grouper', color: 0x6a5a45, shape: 'round', scale: 1.2, rarity: 'Uncommon', weightRange: [3, 12] },
  { name: 'Mahi Mahi', color: 0x2fd0a0, shape: 'elongated', scale: 1.15, rarity: 'Uncommon', weightRange: [3, 10] },
  { name: 'Zander', color: 0x8fae7a, shape: 'elongated', scale: 1.05, rarity: 'Uncommon', weightRange: [1, 5] },
  { name: 'Sea Bream', color: 0xd8a8a0, shape: 'round', scale: 1.0, rarity: 'Uncommon', weightRange: [1, 4] },
  { name: 'Sturgeon', color: 0x5a6570, shape: 'elongated', scale: 1.3, rarity: 'Uncommon', weightRange: [3, 12] },
  { name: 'Golden Trout', color: 0xd9a441, shape: 'normal', scale: 1.05, rarity: 'Rare', weightRange: [1, 3] },
  { name: 'Catfish', color: 0x554d40, shape: 'elongated', scale: 1.3, rarity: 'Rare', weightRange: [3, 15] },
  { name: 'Pufferfish', color: 0xd8c98a, shape: 'round', scale: 0.85, rarity: 'Rare', weightRange: [0.5, 2] },
  { name: 'Sailfish', color: 0x2a4a7a, shape: 'elongated', scale: 1.4, rarity: 'Rare', weightRange: [4, 14] },
  { name: 'Wahoo', color: 0x2a6a6a, shape: 'elongated', scale: 1.25, rarity: 'Rare', weightRange: [3, 10] },
  { name: 'Moray Eel', color: 0x3a4a2a, shape: 'elongated', scale: 1.2, rarity: 'Rare', weightRange: [2, 7] },
  { name: 'Lionfish', color: 0xd05040, shape: 'round', scale: 0.85, rarity: 'Rare', weightRange: [0.5, 2] },
  { name: 'Eel', color: 0x3a3f35, shape: 'elongated', scale: 1.5, rarity: 'Epic', weightRange: [2, 6] },
  { name: 'Barracuda', color: 0x7a8a95, shape: 'elongated', scale: 1.55, rarity: 'Epic', weightRange: [3, 9] },
  { name: 'Swordfish', color: 0x3a5a7a, shape: 'elongated', scale: 1.6, rarity: 'Epic', weightRange: [4, 10] },
  { name: 'Giant Grouper', color: 0x4a3a2a, shape: 'round', scale: 1.5, rarity: 'Epic', weightRange: [3, 8] },
  { name: 'Manta Ray', color: 0x1a2a3a, shape: 'round', scale: 1.65, rarity: 'Epic', weightRange: [5, 11] },
  { name: 'Marlin', color: 0x2f5578, shape: 'elongated', scale: 1.7, rarity: 'Legendary', weightRange: [80, 400] },
  { name: 'Golden Goldfish', color: 0xffd700, shape: 'round', scale: 0.8, rarity: 'Mythic', weightRange: [0.3, 1.2] }
];
FISH_SPECIES.forEach((sp) => {
  sp.type = 'fish';
  sp.mat = toonMat({ color: sp.color, roughness: 0.45, metalness: 0.2, map: fishSkinTexture });
  sp.hookOffset = getFishHookOffset(sp.shape);
  sp.build = () => {
    const g = makeFishMesh(sp.mat, sp.shape);
    g.scale.setScalar(sp.scale);
    return g;
  };
});

// schooling fish are net-only — the rod's catch pool leaves them out
const ROD_FISH_SPECIES = FISH_SPECIES.filter((sp) => !sp.schooling);

const fishList = [];
for (let i = 0; i < 10; i++) {
  const sp = FISH_SPECIES[Math.floor(Math.random() * FISH_SPECIES.length)];
  const mesh = sp.build();
  const radius = 6 + Math.random() * 26;
  const speed = 0.15 + Math.random() * 0.2;
  const angle0 = Math.random() * Math.PI * 2;
  const depth = -1.5 - Math.random() * 2.5;
  const cx = -4 + Math.random() * 8;
  const cz = wharfTipZ - 10 - Math.random() * 60;
  fishList.push({ mesh, radius, speed, angle0, depth, cx, cz });
  scene.add(mesh);
}

// ------------------------------------------------------------------
// Fish schools — a tight cluster of one schooling species passes through the
// water every so often. Individually small and pale (subtle), but the
// coordinated group movement makes the school itself easy to notice (obvious).
// ------------------------------------------------------------------
const SCHOOL_SPECIES = FISH_SPECIES.filter((s) => s.schooling);
const SCHOOL_CHECK_INTERVAL = 15;
const SCHOOL_CHANCE = 0.2;

// the fish themselves stay dim underwater like the rest of the ambient life (the water
// is nearly opaque by design), so a trail of small wake ripples on the surface is what
// actually makes a passing school obvious, rather than the fish bodies themselves
const schoolWakeMat = new THREE.MeshBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0, side: THREE.DoubleSide });
const SCHOOL_WAKE_POOL_SIZE = 8;
const schoolWakePool = [];
for (let i = 0; i < SCHOOL_WAKE_POOL_SIZE; i++) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.22, 16), schoolWakeMat.clone());
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);
  schoolWakePool.push({ mesh: ring, active: false, t: 0, pos: new THREE.Vector3() });
}
function triggerSchoolWake(pos) {
  const s = schoolWakePool.find((s) => !s.active) || schoolWakePool[0];
  s.active = true;
  s.t = 0;
  s.pos.copy(pos);
  s.mesh.visible = true;
}
function updateSchoolWakes(dt) {
  const DUR = 1.1;
  schoolWakePool.forEach((s) => {
    if (!s.active) return;
    s.t += dt;
    if (s.t >= DUR) { s.active = false; s.mesh.visible = false; return; }
    const p = s.t / DUR;
    s.mesh.position.set(s.pos.x, s.pos.y + 0.015, s.pos.z);
    const sc = 0.25 + p * 1.6;
    s.mesh.scale.set(sc, sc, sc);
    s.mesh.material.opacity = (1 - p) * 0.35;
  });
}

const schoolState = {
  active: false,
  fishes: [], // { mesh, offsetX, offsetZ, offsetY, phase, bobSpeed }
  species: null,
  startX: 0,
  endX: 0,
  z: 0,
  depth: 0,
  duration: 0,
  timer: 0,
  wakeTimer: 0,
  held: false, // true once a net swoop lands on it — stops swimming and thrashes in place until the net reel resolves
  nextCheckAt: 10 + Math.random() * 10
};

function startSchool() {
  const sp = SCHOOL_SPECIES[Math.floor(Math.random() * SCHOOL_SPECIES.length)];
  schoolState.species = sp;
  const dir = Math.random() < 0.5 ? 1 : -1;
  schoolState.startX = dir * -20;
  schoolState.endX = dir * 20;
  schoolState.z = wharfTipZ - 2 - Math.random() * 8;
  schoolState.depth = -0.5 - Math.random() * 0.7;
  schoolState.duration = 16 + Math.random() * 6;
  schoolState.timer = 0;
  schoolState.wakeTimer = 0;
  schoolState.held = false;
  schoolState.active = true;

  const count = 10 + Math.floor(Math.random() * 7);
  schoolState.fishes = [];
  for (let i = 0; i < count; i++) {
    const mesh = sp.build();
    mesh.scale.multiplyScalar(0.85 + Math.random() * 0.3);
    scene.add(mesh);
    schoolState.fishes.push({
      mesh,
      offsetX: (Math.random() - 0.5) * 2.6,
      offsetZ: (Math.random() - 0.5) * 2.2,
      offsetY: (Math.random() - 0.5) * 0.5,
      phase: Math.random() * Math.PI * 2,
      bobSpeed: 1.2 + Math.random() * 0.8
    });
  }
}

function endSchool() {
  schoolState.fishes.forEach((f) => scene.remove(f.mesh));
  schoolState.fishes = [];
  schoolState.active = false;
  schoolState.held = false;
}

function updateSchool(dt, t) {
  if (krakenState.phase !== 'idle') {
    if (schoolState.active) endSchool(); // clears out immediately once the kraken shows up, not just blocked from starting
    return;
  }
  if (!schoolState.active) {
    if (t >= schoolState.nextCheckAt) {
      schoolState.nextCheckAt = t + SCHOOL_CHECK_INTERVAL;
      if (Math.random() < SCHOOL_CHANCE) startSchool();
    }
    return;
  }

  // caught in the net: the timer freezes so the school stays put instead of
  // swimming on past while the net reel plays out
  if (!schoolState.held) schoolState.timer += dt;
  const p = Math.min(schoolState.timer / schoolState.duration, 1);
  const leadX = THREE.MathUtils.lerp(schoolState.startX, schoolState.endX, p);
  const wave = Math.sin(p * Math.PI * 2.5) * 2.0;
  const facingY = schoolState.endX > schoolState.startX ? 0 : Math.PI;
  const thrash = schoolState.held ? 4 : 1;

  schoolState.fishes.forEach((f) => {
    const x = leadX + f.offsetX + (schoolState.held ? Math.sin(t * 9 + f.phase) * 0.12 : 0);
    const z = schoolState.z + wave + f.offsetZ;
    const y = waterY + schoolState.depth + f.offsetY + Math.sin(t * f.bobSpeed * thrash + f.phase) * 0.12;
    f.mesh.position.set(x, y, z);
    f.mesh.rotation.y = facingY + (schoolState.held ? Math.sin(t * 7 + f.phase) * 0.6 : 0);
    f.mesh.rotation.z = Math.sin(t * f.bobSpeed * 0.5 * thrash + f.phase) * 0.08 * thrash;
  });

  schoolState.wakeTimer += dt;
  if (schoolState.wakeTimer >= (schoolState.held ? 0.15 : 0.35)) {
    schoolState.wakeTimer = 0;
    const wx = leadX + (Math.random() - 0.5) * 2.2;
    const wz = schoolState.z + wave + (Math.random() - 0.5) * 1.8;
    triggerSchoolWake(new THREE.Vector3(wx, waveHeight(wx, wz, t) + 0.02, wz));
  }

  if (schoolState.timer >= schoolState.duration) {
    endSchool();
    schoolState.nextCheckAt = t + SCHOOL_CHECK_INTERVAL;
  }
}

// ------------------------------------------------------------------
// Message in a bottle — a rare drifter that only ever comes in from the
// right, well out of range of the rod. Has to be scooped with the net like a
// school of fish, but it's a straight grab (no timing mini-game after) —
// there's nothing alive in there to wrestle with.
// ------------------------------------------------------------------
const bottleGlassMat = toonMat({ color: 0x2f5c3a, roughness: 0.3, transparent: true, opacity: 0.85 });
const bottleCorkMat = toonMat({ color: 0xb98a4a, roughness: 0.9 });
const bottleMesh = new THREE.Group();
const bottleBody = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.34, 10), bottleGlassMat);
bottleBody.position.y = 0.17;
addOutline(bottleBody);
bottleMesh.add(bottleBody);
const bottleNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.07, 0.16, 10), bottleGlassMat);
bottleNeck.position.y = 0.42;
addOutline(bottleNeck);
bottleMesh.add(bottleNeck);
const bottleCork = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.07, 10), bottleCorkMat);
bottleCork.position.y = 0.535;
addOutline(bottleCork);
bottleMesh.add(bottleCork);
bottleMesh.rotation.z = Math.PI / 2;
bottleMesh.visible = false;
scene.add(bottleMesh);

const BOTTLE_CHECK_INTERVAL = 45;
const BOTTLE_CHANCE = 0.1;
const bottleState = {
  active: false,
  startX: 0,
  endX: 0,
  z: 0,
  duration: 0,
  progress: 0, // 0..1 — advances at an uneven rate (see updateBottle) instead of tracking elapsed time directly
  currentX: 0, // actual on-screen x this frame — what the swoop hit-check uses
  nextCheckAt: 25 + Math.random() * 20
};

function startBottle() {
  bottleState.startX = 22;
  bottleState.endX = -22; // always drifts in from the right
  bottleState.z = wharfTipZ - 2 - Math.random() * 6;
  bottleState.duration = 55 + Math.random() * 15;
  bottleState.progress = 0;
  bottleState.active = true;
  bottleMesh.visible = true;
}

function endBottle() {
  bottleMesh.visible = false;
  bottleState.active = false;
}

function updateBottle(dt, t) {
  if (!bottleState.active) {
    if (t >= bottleState.nextCheckAt) {
      bottleState.nextCheckAt = t + BOTTLE_CHECK_INTERVAL;
      if (Math.random() < BOTTLE_CHANCE) startBottle();
    }
    return;
  }
  // the pace itself is uneven — sometimes crawling, sometimes surging — but
  // always forward, so it never visibly zigzags or backtracks. the sway and
  // bob below are what read as "choppy water" instead.
  const paceFactor = 1 + Math.sin(t * 0.31) * 0.35 + Math.sin(t * 0.83 + 2.2) * 0.2;
  bottleState.progress = Math.min(1, bottleState.progress + (dt / bottleState.duration) * Math.max(0.35, paceFactor));
  const x = THREE.MathUtils.lerp(bottleState.startX, bottleState.endX, bottleState.progress);
  const z = bottleState.z + Math.sin(t * 0.5 + 2.1) * 1.6 + Math.sin(t * 1.3) * 0.6;
  const bob = Math.sin(t * 2.4) * 0.05 + Math.sin(t * 5.1 + 0.7) * 0.03 + Math.sin(t * 3.3 + 2) * 0.02;
  bottleState.currentX = x;
  bottleMesh.position.set(x, waveHeight(x, z, t) + 0.05 + bob, z);
  bottleMesh.rotation.x = Math.sin(t * 2.6) * 0.4 + Math.sin(t * 4.3 + 1) * 0.2;
  bottleMesh.rotation.y = Math.sin(t * 0.7) * 0.35;
  bottleMesh.rotation.z = Math.PI / 2 + Math.sin(t * 2.1 + 0.5) * 0.4 + Math.sin(t * 3.7) * 0.15;
  if (bottleState.progress >= 1) endBottle();
}

const BOTTLE_NOTE_TEXT = `The glass is salt-worn, the note inside damp but legible:

"Two feeds, not one, cast as one hand —
the crowned in gold, the hearty and stout.
Fed together as the light goes down,
something ancient may hear you, and rise."`;

const bottleNotePanelEl = document.getElementById('bottleNotePanel');
const bottleNoteTextEl = document.getElementById('bottleNoteText');
const bottleNoteCloseBtnEl = document.getElementById('bottleNoteCloseBtn');
let bottleNoteOpen = false;
function openBottleNote() {
  bottleNoteTextEl.textContent = BOTTLE_NOTE_TEXT;
  bottleNotePanelEl.classList.add('open');
  bottleNoteOpen = true;
  updateBackdrop();
}
function closeBottleNote() {
  bottleNotePanelEl.classList.remove('open');
  bottleNoteOpen = false;
  updateBackdrop();
}
bottleNoteCloseBtnEl.addEventListener('click', () => closeBottleNote());

// ------------------------------------------------------------------
// Dolphins — a rare bit of scenery: a small pod arcs out of the water far
// out near the horizon, leaping a few times as it passes, then is gone.
// Purely ambient — nothing to catch, just something nice to spot.
// ------------------------------------------------------------------
const dolphinMat = toonMat({ color: 0x5f7590, roughness: 0.6 });
const dolphinBellyMat = toonMat({ color: 0xb9c4cf, roughness: 0.6 });

// built facing local +x so a leap's pitch is just a rotation about z
function makeDolphin() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), dolphinMat);
  body.scale.set(2.2, 0.55, 0.6);
  g.add(addOutline(body, 1.06));
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), dolphinBellyMat);
  belly.scale.set(1.8, 0.4, 0.5);
  belly.position.set(0.1, -0.08, 0);
  g.add(belly);
  const snout = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.5, 8), dolphinMat);
  snout.rotation.z = -Math.PI / 2;
  snout.position.set(1.25, -0.04, 0);
  g.add(snout);
  // dorsal fin, swept back
  const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.5, 6), dolphinMat);
  dorsal.scale.z = 0.3;
  dorsal.rotation.z = 0.55;
  dorsal.position.set(-0.05, 0.36, 0);
  g.add(dorsal);
  // tail flukes — flat and wide, horizontal like a real dolphin's
  const flukes = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.85), dolphinMat);
  flukes.position.set(-1.25, 0, 0);
  g.add(flukes);
  [-1, 1].forEach((side) => {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.03, 0.14), dolphinMat);
    fin.position.set(0.45, -0.18, side * 0.3);
    fin.rotation.set(side * 0.5, side * 0.6, -0.3);
    g.add(fin);
  });
  g.rotation.order = 'YZX'; // roll (x) spins about the body's own axis, after pitch + heading
  g.scale.setScalar(3);
  g.visible = false;
  scene.add(g);
  return g;
}

const DOLPHIN_POD_MAX = 4;
const dolphinMeshes = [];
for (let i = 0; i < DOLPHIN_POD_MAX; i++) dolphinMeshes.push(makeDolphin());

// spray — a handful of white droplets per splash. A flat ring (like
// triggerSplash) would be invisible this far out, seen almost edge-on.
const DOLPHIN_SPRAY_COUNT = 60;
const dolphinSpray = [];
const dolphinSprayGeo = new THREE.SphereGeometry(0.5, 6, 4);
for (let i = 0; i < DOLPHIN_SPRAY_COUNT; i++) {
  const m = new THREE.Mesh(dolphinSprayGeo, new THREE.MeshBasicMaterial({ color: 0xf2f6ff, transparent: true, opacity: 0 }));
  m.visible = false;
  scene.add(m);
  dolphinSpray.push({ mesh: m, life: 0, vel: new THREE.Vector3() });
}
function triggerDolphinSpray(x, y, z) {
  let n = 7;
  for (const s of dolphinSpray) {
    if (s.life > 0) continue;
    s.life = 0.6 + Math.random() * 0.3;
    s.vel.set((Math.random() - 0.5) * 5, 5 + Math.random() * 4, (Math.random() - 0.5) * 3);
    s.mesh.position.set(x + (Math.random() - 0.5) * 1.5, y, z);
    s.mesh.visible = true;
    if (--n === 0) break;
  }
}

const DOLPHIN_CHECK_INTERVAL = 40;
const DOLPHIN_CHANCE = 0.12;
const DOLPHIN_POD_Z_NEAR = -210, DOLPHIN_POD_Z_FAR = -260;
const dolphinState = {
  active: false,
  dir: 1,
  pod: [], // [{ mesh, x, z, leapsLeft, phase: 'under'|'air', timer, wait, swimSpeed, leap }]
  nextCheckAt: 60 + Math.random() * 40
};

// every leap is rolled fresh, so the pod never falls into a rhythm — mostly
// low skims and ordinary arcs, now and then a big spinning breach
function rollDolphinLeap(d) {
  const r = Math.random();
  let height, dist, dur, spins = 0;
  if (r < 0.3) {        // low skim
    height = 2 + Math.random() * 1.5; dist = 8 + Math.random() * 4; dur = 0.8 + Math.random() * 0.25;
  } else if (r < 0.85) { // ordinary arc
    height = 4 + Math.random() * 2.5; dist = 9 + Math.random() * 5; dur = 1.1 + Math.random() * 0.35;
  } else {              // big breach, sometimes with a corkscrew spin
    height = 8 + Math.random() * 3; dist = 10 + Math.random() * 4; dur = 1.6 + Math.random() * 0.4;
    spins = Math.random() < 0.6 ? 1 + Math.floor(Math.random() * 2) : 0;
  }
  d.leap = { startX: d.x, height, dist, dur, spins, zDrift: (Math.random() - 0.5) * 3, startZ: d.z };
}

function startDolphins() {
  const dir = Math.random() < 0.5 ? 1 : -1;
  const size = 2 + Math.floor(Math.random() * (DOLPHIN_POD_MAX - 1));
  const baseZ = DOLPHIN_POD_Z_NEAR + Math.random() * (DOLPHIN_POD_Z_FAR - DOLPHIN_POD_Z_NEAR);
  // centered on where the camera is actually looking out at that distance,
  // so the pod passes through the middle of the view instead of the edges
  const viewCenterX = camera.position.x - 0.14 * (camera.position.z - baseZ);
  const startX = viewCenterX - dir * (35 + Math.random() * 25);
  dolphinState.dir = dir;
  dolphinState.pod = [];
  for (let i = 0; i < size; i++) {
    dolphinState.pod.push({
      mesh: dolphinMeshes[i],
      x: startX - dir * (i * 3 + Math.random() * 4),
      z: baseZ + (Math.random() - 0.5) * 10,
      leapsLeft: 2 + Math.floor(Math.random() * 5),
      phase: 'under',
      timer: 0,
      wait: Math.random() * 1.8,
      swimSpeed: 3 + Math.random() * 3,
      leap: null
    });
  }
  dolphinState.active = true;
}

function updateDolphins(dt, t) {
  for (const s of dolphinSpray) {
    if (s.life <= 0) continue;
    s.life -= dt;
    if (s.life <= 0) { s.mesh.visible = false; continue; }
    s.vel.y -= 12 * dt;
    s.mesh.position.addScaledVector(s.vel, dt);
    s.mesh.material.opacity = Math.min(1, s.life * 2) * 0.85;
  }

  if (!dolphinState.active) {
    if (t >= dolphinState.nextCheckAt) {
      dolphinState.nextCheckAt = t + DOLPHIN_CHECK_INTERVAL;
      if (Math.random() < DOLPHIN_CHANCE) startDolphins();
    }
    return;
  }

  const dir = dolphinState.dir;
  let anyLeft = false;
  for (const d of dolphinState.pod) {
    if (d.leapsLeft <= 0 && d.phase === 'under') continue;
    anyLeft = true;
    d.timer += dt;
    if (d.phase === 'under') {
      d.x += dir * d.swimSpeed * dt; // keeps swimming between leaps
      if (d.timer < d.wait) continue;
      d.phase = 'air';
      d.timer = 0;
      rollDolphinLeap(d);
      triggerDolphinSpray(d.x, waveHeight(d.x, d.z, t), d.z);
      // falls through so the pose is set this same frame — showing the mesh
      // before positioning it flashed it at the origin, right on the dock
    }
    const L = d.leap;
    const p = Math.min(d.timer / L.dur, 1);
    d.x = L.startX + dir * L.dist * p;
    d.z = L.startZ + L.zDrift * p;
    // starts and ends a little below the surface so it visibly breaks the water
    const arc = L.height + 1.5;
    const y = waveHeight(d.x, d.z, t) - 1.5 + arc * 4 * p * (1 - p);
    d.mesh.position.set(d.x, y, d.z);
    d.mesh.rotation.y = dir > 0 ? 0 : Math.PI;
    // nose follows the arc: up on the way out, down on the way back in
    d.mesh.rotation.z = Math.atan2(arc * 4 * (1 - 2 * p), L.dist);
    d.mesh.rotation.x = L.spins * Math.PI * 2 * p;
    d.mesh.visible = true;
    if (p >= 1) {
      triggerDolphinSpray(d.x, waveHeight(d.x, d.z, t), d.z);
      d.mesh.visible = false;
      d.phase = 'under';
      d.timer = 0;
      d.wait = 0.3 + Math.random() * 2.2;
      d.swimSpeed = 3 + Math.random() * 3;
      d.leapsLeft--;
    }
  }
  if (!anyLeft) dolphinState.active = false;
}

// ------------------------------------------------------------------
// Junk — sometimes you don't reel in a fish
// ------------------------------------------------------------------
const junkBootMat = toonMat({ color: 0x4a3624, roughness: 0.85 });
const bootSoleMat = toonMat({ color: 0x2a2018, roughness: 0.9 });
function makeBootMesh() {
  const g = new THREE.Group();
  const sole = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.1, 0.22), bootSoleMat);
  sole.position.set(0, -0.13, 0);
  g.add(sole);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.28, 0.2), junkBootMat);
  foot.position.set(-0.02, 0.02, 0);
  g.add(foot);
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.4, 0.19), junkBootMat);
  shaft.position.set(0.15, 0.18, 0);
  shaft.rotation.z = -0.3;
  g.add(shaft);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  // outlines added after the traverse above (not before) — that traverse walks
  // every mesh in the group, and an outline child added earlier would get
  // needlessly swept up by it too
  addOutline(sole); addOutline(foot); addOutline(shaft);
  return g;
}
const canMat = toonMat({ color: 0xb9bcbe, roughness: 0.4, metalness: 0.7 });
function makeCanMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.32, 12), canMat);
  body.rotation.z = Math.PI / 2.3;
  g.add(body);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  addOutline(body);
  return g;
}
const seaweedMat = toonMat({ color: 0x2f6b3a, roughness: 0.8 });
function makeSeaweedMesh() {
  const g = new THREE.Group();
  const blades = [];
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.5 + Math.random() * 0.2, 5), seaweedMat);
    blade.position.set((Math.random() - 0.5) * 0.15, 0.1, (Math.random() - 0.5) * 0.15);
    blade.rotation.set((Math.random() - 0.5) * 0.8, Math.random() * Math.PI, (Math.random() - 0.5) * 0.8);
    g.add(blade);
    blades.push(blade);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  blades.forEach((b) => addOutline(b, 1.1));
  return g;
}
const tireMat = toonMat({ color: 0x181818, roughness: 0.8 });
function makeTireMesh() {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.09, 8, 16), tireMat);
  g.add(tire);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  addOutline(tire);
  return g;
}
const bucketMat = toonMat({ color: 0x7a4a2a, roughness: 0.6, metalness: 0.4 });
function makeBucketMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.17, 0.34, 10, 1, true), bucketMat);
  g.add(body);
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.17, 10), bucketMat);
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = -0.17;
  g.add(bottom);
  // the DoubleSide fix-up below applies to every mesh currently in the
  // group — the outline is added after it runs so the shared BackSide-only
  // outlineMat doesn't get mutated to DoubleSide (which would make every
  // outline in the whole scene render over the model's front faces too)
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.material.side = THREE.DoubleSide; } });
  addOutline(body);
  return g;
}

const JUNK_ITEMS = [
  { name: 'an Old Boot', short: 'Old Boot', icon: 'boot', swatch: 0x4a3624, build: makeBootMesh, hookOffset: new THREE.Vector3(0.15, 0.3, 0), scale: 1.0, rarity: 'Common', weightRange: [1, 2.5] },
  { name: 'a Rusty Can', short: 'Rusty Can', icon: 'can', swatch: 0xb9bcbe, build: makeCanMesh, hookOffset: new THREE.Vector3(0, 0.16, 0), scale: 1.0, rarity: 'Common', weightRange: [0.1, 0.3] },
  { name: 'a Clump of Seaweed', short: 'Seaweed', icon: 'seaweed', swatch: 0x2f6b3a, build: makeSeaweedMesh, hookOffset: new THREE.Vector3(0, 0.35, 0), scale: 1.0, rarity: 'Common', weightRange: [0.2, 1] },
  { name: 'an Old Tire', short: 'Old Tire', icon: 'tire', swatch: 0x181818, build: makeTireMesh, hookOffset: new THREE.Vector3(0, 0.26, 0), scale: 1.0, rarity: 'Common', weightRange: [8, 20] },
  { name: 'a Rusty Bucket', short: 'Rusty Bucket', icon: 'bucket', swatch: 0x7a4a2a, build: makeBucketMesh, hookOffset: new THREE.Vector3(0, 0.17, 0), scale: 1.0, rarity: 'Common', weightRange: [2, 5] }
];
JUNK_ITEMS.forEach((j) => { j.type = 'junk'; });

// ------------------------------------------------------------------
// Beach critters — static shells scattered in the sand, and a couple of
// crabs that wander around. Purely ambient scenery, not part of the fishing
// system. Positioned using the same beach-slope formula as updateBeach()/the
// piling sand patches, so they sit correctly on the sloped sand.
// ------------------------------------------------------------------
function beachGroundY(z) {
  const slopeT = THREE.MathUtils.clamp((z - beachNearZ) / (beachFarZ - beachNearZ), 0, 1);
  const slope = slopeT * slopeT * (3 - 2 * slopeT);
  return waterY + (topY - waterY) * slope;
}
const SHELL_COLORS = [0xf5e8d8, 0xe8c9b8, 0xd9a8a0, 0xf0d9c0, 0xfaf3e8];
function makeShellMesh(seed) {
  const mat = toonMat({ color: SHELL_COLORS[seed % SHELL_COLORS.length], roughness: 0.55 });
  const g = new THREE.Group();
  if (seed % 2 === 0) {
    // scallop — a small flattened ribbed dome
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    body.scale.set(1, 0.5, 1);
    g.add(body);
    addOutline(body, 1.08);
  } else {
    // sea snail — a small leaning spiral cone
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 10), mat);
    body.position.y = 0.09;
    body.rotation.z = 0.35;
    g.add(body);
    addOutline(body, 1.08);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
// re-randomized on every load — just scenery, not part of saved progress
const SHELL_COUNT = 7;
for (let i = 0; i < SHELL_COUNT; i++) {
  const x = -9 + Math.random() * 20;
  const z = beachNearZ + 1.5 + Math.random() * (beachFarZ - beachNearZ - 3);
  const shell = makeShellMesh(i);
  shell.position.set(x, beachGroundY(z) + 0.01, z);
  shell.rotation.y = Math.random() * Math.PI * 2;
  scene.add(shell);
}

// crabs walk sideways relative to their direction of travel (the body's
// "face" axis stays perpendicular to the heading), which is the one authentic
// touch worth keeping even in a simple wander behavior
const CRAB_AREA = { x0: -8, x1: 12, z0: beachNearZ + 1, z1: beachFarZ - 1 };
const CRAB_COLORS = [0xd8522f, 0xc96a3a];
const CRAB_SCALE = 0.42; // small enough to just read as "a crab", not a focal model
function makeCrabMesh(colorIdx) {
  const bodyMat = toonMat({ color: CRAB_COLORS[colorIdx], roughness: 0.6 });
  const clawMat = toonMat({ color: CRAB_COLORS[colorIdx], roughness: 0.5 });
  const eyeMat = toonMat({ color: 0x1c140f, roughness: 0.4 });
  const g = new THREE.Group();

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), bodyMat);
  body.scale.set(1.3, 0.55, 1);
  body.position.y = 0.1;
  g.add(body);
  addOutline(body, 1.06);

  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 3; i++) {
      const hip = new THREE.Vector3(side * 0.1, 0.1, -0.09 + i * 0.09);
      const foot = new THREE.Vector3(side * 0.33, -0.02, -0.09 + i * 0.09 + side * 0.04);
      g.add(limb(hip, foot, 0.022, 0.013, bodyMat));
    }
  }

  [-1, 1].forEach((side) => {
    const shoulder = new THREE.Vector3(side * 0.12, 0.13, 0.13);
    const elbow = new THREE.Vector3(side * 0.22, 0.09, 0.2);
    g.add(limb(shoulder, elbow, 0.025, 0.018, clawMat));
    const claw = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), clawMat);
    claw.position.copy(elbow);
    claw.scale.set(1.3, 0.8, 0.9);
    g.add(claw);
    addOutline(claw, 1.1);

    const eyeBase = new THREE.Vector3(side * 0.05, 0.18, 0.11);
    const eyeTip = new THREE.Vector3(side * 0.06, 0.26, 0.14);
    g.add(limb(eyeBase, eyeTip, 0.012, 0.012, bodyMat));
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), eyeMat);
    eye.position.copy(eyeTip);
    g.add(eye);
  });

  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.scale.setScalar(CRAB_SCALE);
  return g;
}
const crabs = [];
for (let i = 0; i < 2; i++) {
  const group = makeCrabMesh(i);
  const startX = CRAB_AREA.x0 + (i + 0.5) / 2 * (CRAB_AREA.x1 - CRAB_AREA.x0);
  const startZ = CRAB_AREA.z0 + (CRAB_AREA.z1 - CRAB_AREA.z0) * 0.5;
  group.position.set(startX, beachGroundY(startZ) + 0.12 * CRAB_SCALE, startZ);
  scene.add(group);
  crabs.push({
    group,
    x: startX, z: startZ,
    targetX: startX, targetZ: startZ,
    speed: 0.5 + Math.random() * 0.3,
    state: 'idle',
    waitTimer: Math.random() * 2,
    bobPhase: Math.random() * Math.PI * 2
  });
}
function pickCrabTarget(crab) {
  crab.targetX = CRAB_AREA.x0 + Math.random() * (CRAB_AREA.x1 - CRAB_AREA.x0);
  crab.targetZ = CRAB_AREA.z0 + Math.random() * (CRAB_AREA.z1 - CRAB_AREA.z0);
}
const KRAKEN_CRAB_FLEE_SPEED = 2.6;
function updateCrabs(dt, t) {
  const krakenActive = krakenState.phase !== 'idle';
  crabs.forEach((crab) => {
    if (krakenActive) {
      if (crab.state !== 'fleeing') {
        // run sideways to whichever edge of the beach is closer, not toward
        // or away from the water — "the nearest side", not just "away"
        const distToMin = crab.x - CRAB_AREA.x0, distToMax = CRAB_AREA.x1 - crab.x;
        crab.targetX = distToMin < distToMax ? CRAB_AREA.x0 - 1 : CRAB_AREA.x1 + 1;
        crab.targetZ = crab.z;
        crab.state = 'fleeing';
      }
      const dx = crab.targetX - crab.x, dz = crab.targetZ - crab.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.05) {
        const step = Math.min(dist, KRAKEN_CRAB_FLEE_SPEED * dt);
        crab.x += (dx / dist) * step;
        crab.z += (dz / dist) * step;
        crab.group.rotation.y = Math.atan2(dx, dz) + Math.PI / 2;
      }
    } else {
      if (crab.state === 'fleeing') {
        // the kraken just left — pause a beat before wandering back out, rather
        // than instantly reversing course
        crab.state = 'idle';
        crab.waitTimer = 0.6 + Math.random() * 1.5;
      } else if (crab.state === 'idle') {
        crab.waitTimer -= dt;
        if (crab.waitTimer <= 0) { pickCrabTarget(crab); crab.state = 'walking'; }
      } else {
        const dx = crab.targetX - crab.x, dz = crab.targetZ - crab.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.15) {
          crab.state = 'idle';
          crab.waitTimer = 1 + Math.random() * 2.5;
        } else {
          const step = Math.min(dist, crab.speed * dt);
          crab.x += (dx / dist) * step;
          crab.z += (dz / dist) * step;
          crab.group.rotation.y = Math.atan2(dx, dz) + Math.PI / 2;
        }
      }
    }
    const moving = crab.state === 'walking' || crab.state === 'fleeing';
    const bob = moving ? Math.abs(Math.sin(t * 10 + crab.bobPhase)) * 0.015 * CRAB_SCALE : 0;
    crab.group.position.set(crab.x, beachGroundY(crab.z) + 0.12 * CRAB_SCALE + bob, crab.z);
    crab.group.rotation.z = moving ? Math.sin(t * 10 + crab.bobPhase) * 0.08 : 0;
  });
}

// rarer species come up much less often — the rarity tier is rolled first (so adding
// more species to a tier never changes that tier's overall odds), then the specific
// species is picked with equal odds among everything in that tier
// Mythic's weight is tuned to land at roughly a 0.001% chance per catch — it's
// the Golden Goldfish and nothing else, an intentional near-impossible pull
const RARITY_WEIGHTS = { Common: 100, Uncommon: 40, Rare: 14, Epic: 5, Legendary: 1.2, Mythic: 0.0016 };
function pickRarityThenSpecies(pool, weights) {
  const rarities = [...new Set(pool.map((e) => e.rarity))];
  const total = rarities.reduce((sum, r) => sum + weights[r], 0);
  let roll = Math.random() * total;
  let chosenRarity = rarities[rarities.length - 1];
  for (const r of rarities) {
    roll -= weights[r];
    if (roll <= 0) { chosenRarity = r; break; }
  }
  const candidates = pool.filter((e) => e.rarity === chosenRarity);
  return candidates[Math.floor(Math.random() * candidates.length)];
}
function weightedPick(pool) {
  return pickRarityThenSpecies(pool, RARITY_WEIGHTS);
}

// Fish Food (bought in the food tab) — same tiered rarity idea as the hired
// fishermen, but it's you casting: each tier restricts your next several rod
// catches to its rarity range. Better tiers cost more and run out faster.
const FISH_FOOD_TIERS = [
  { id: 'basic', name: 'Basic Fish Food', cost: 40, rarities: ['Common', 'Uncommon'], uses: 4 },
  { id: 'hearty', name: 'Hearty Fish Food', cost: 70, rarities: ['Common', 'Uncommon', 'Rare'], uses: 3 },
  { id: 'rich', name: 'Rich Fish Food', cost: 130, rarities: ['Uncommon', 'Rare', 'Epic'], uses: 2 },
  { id: 'golden', name: 'Golden Fish Food', cost: 350, rarities: ['Epic', 'Legendary'], uses: 1 }
];
const FOOD_OWNED_KEY = 'sunsetFishing.foodOwned';
const FOOD_ACTIVE_KEY = 'sunsetFishing.activeFoods';
let foodOwned = {}; // { [tierId]: count }
let activeFoods = []; // [{ tierId, usesLeft }] — more than one can be active at once
try {
  foodOwned = JSON.parse(localStorage.getItem(FOOD_OWNED_KEY) || '{}');
  activeFoods = JSON.parse(localStorage.getItem(FOOD_ACTIVE_KEY) || '[]');
} catch (e) { /* localStorage unavailable — food just won't persist */ }
function saveFoodOwned() { try { localStorage.setItem(FOOD_OWNED_KEY, JSON.stringify(foodOwned)); } catch (e) {} }
function saveActiveFoods() { try { localStorage.setItem(FOOD_ACTIVE_KEY, JSON.stringify(activeFoods)); } catch (e) {} }

// "Use last catch as bait" — a one-off, 50-coin lure that consumes your most
// recent unsold catch and biases the very next rod catch toward its rarity:
// 80% the same rarity, 20% one tier higher (never bumped up into Mythic).
const BAIT_COST = 50;
let baitRarity = null; // set the instant bait is used, consumed by the next pickCatch()

function findLastBaitableCatch() {
  for (let i = 0; i < catchLog.length; i++) {
    const e = catchLog[i];
    if (e.type === 'fish' && !e.sold && !e.stolen && !e.baited) return e;
  }
  return null;
}

function pickBaitRarityOutcome(baseRarity) {
  const idx = RARITY_ORDER.indexOf(baseRarity);
  const capIdx = RARITY_ORDER.indexOf('Legendary'); // never bait up into Mythic
  if (idx >= capIdx || Math.random() < 0.8) return baseRarity;
  return RARITY_ORDER[idx + 1];
}

function useLastCatchAsBait() {
  const entry = findLastBaitableCatch();
  if (!entry || coins < BAIT_COST) return;
  addCoins(-BAIT_COST);
  entry.baited = true;
  saveCatchLog();
  const idx = pileLogEntries.indexOf(entry);
  if (idx !== -1) {
    scene.remove(pileFishes[idx]);
    pileFishes.splice(idx, 1);
    pilePlacements.splice(idx, 1);
    pileLogEntries.splice(idx, 1);
  }
  baitRarity = entry.rarity;
  showCatchPopup(`${entry.name} rigged as bait!`, false);
  if (openPanel === 'log') renderLog();
  if (openPanel === 'sell') renderSell();
}

// Auto-Caster (bought in the shop) — a one-time 750-coin purchase, then a toggle
// that automatically casts again right after you land a fish
const AUTO_RECAST_OWNED_KEY = 'sunsetFishing.autoRecastOwned';
const AUTO_RECAST_ENABLED_KEY = 'sunsetFishing.autoRecastEnabled';
let autoRecastOwned = false;
let autoRecastEnabled = false;
try {
  autoRecastOwned = localStorage.getItem(AUTO_RECAST_OWNED_KEY) === '1';
  autoRecastEnabled = localStorage.getItem(AUTO_RECAST_ENABLED_KEY) === '1';
} catch (e) { /* localStorage unavailable — the auto-caster just won't persist */ }
function saveAutoRecastOwned() { try { localStorage.setItem(AUTO_RECAST_OWNED_KEY, autoRecastOwned ? '1' : '0'); } catch (e) {} }
function saveAutoRecastEnabled() { try { localStorage.setItem(AUTO_RECAST_ENABLED_KEY, autoRecastEnabled ? '1' : '0'); } catch (e) {} }

// Fishing Net (bought in the equipment tab) — a one-time purchase, then swap to it
// with the tool-swap button under the message log to scoop passing schools
const NET_OWNED_KEY = 'sunsetFishing.netOwned';
let netOwned = false;
try {
  netOwned = localStorage.getItem(NET_OWNED_KEY) === '1';
} catch (e) { /* localStorage unavailable — the net just won't persist */ }
function saveNetOwned() { try { localStorage.setItem(NET_OWNED_KEY, netOwned ? '1' : '0'); } catch (e) {} }
let equippedTool = 'rod'; // 'rod' | 'net'

// a real net (hoop + mesh + handle), drawn to match the other menu icons rather than
// relying on an emoji — there's no dedicated "fishing net" character in Unicode
const NET_ICON_SVG = '<svg viewBox="0 0 24 24" width="22" height="22">' +
  '<circle cx="9" cy="9" r="6.3" fill="none" stroke="#fff" stroke-width="1.7"/>' +
  '<g stroke="#fff" stroke-width="0.7" opacity="0.85">' +
  '<line x1="4.5" y1="13.5" x2="13.5" y2="4.5"/>' +
  '<line x1="4.5" y1="10" x2="10" y2="4.5"/>' +
  '<line x1="8" y1="13.5" x2="13.5" y2="8"/>' +
  '<line x1="4.5" y1="4.5" x2="13.5" y2="13.5"/>' +
  '<line x1="4.5" y1="8" x2="8" y2="13.5"/>' +
  '<line x1="10" y1="4.5" x2="13.5" y2="10"/>' +
  '</g>' +
  '<path d="M13.6 13.6L21 21" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>' +
  '</svg>';

// ------------------------------------------------------------------
// Fishing Manual — a reference panel explaining each menu tab, opened from
// the button that now sits where the old message text used to be.
// ------------------------------------------------------------------
const MANUAL_ENTRIES = [
  { icon: '🎣', name: 'Catching', desc: 'Click the water or press SPACE to cast your line. Wait for a bite, then click or press SPACE to hook it. Hold to keep the bar lined up with the fish — drift too far off it and the bar drains, so let go and re-catch it before it runs out.' },
  { icon: NET_ICON_SVG, name: 'Fishing Net', desc: 'Once you own it, swap to the net with the button in the top-right corner, just under the manual button, or with F on the keyboard. Time a swing to catch a passing school of fish, then hold to keep the bar on target in the follow-up mini-game to scoop up several at once. It can also net floating items.' },
  { icon: '🗂️', name: 'Catch Index', desc: 'Tracks every different species you can catch, the junk too. Locked entries stay hidden until you catch them.' },
  { icon: '📜', name: 'Fishing Log', desc: 'A running history of everything you’ve caught — what’s been sold, stolen by a pelican, or rigged as bait.' },
  { icon: '💰', name: 'Sell Catch', desc: 'Sell every unsold fish in your pile at once, at the standard rate.' },
  { icon: '🪱', name: 'Fish Food', desc: 'Buy tiered bait that limits your next catches to specific rarities. More than one tier can be fed and active at the same time — this is also where you can rig your most recent catch as bait.' },
  { icon: '🎣', name: 'Rods', desc: 'Upgrade your rod through Fiberglass, Graphite, and Carbon — the capture bar falls slower with each tier, and Graphite and Carbon never fish up junk. After Carbon comes the Legendary Rod, locked until you’ve completed every Challenge.' },
  { icon: '🏦', name: 'Bank', desc: 'Keep coins in Savings to earn interest, or take out a Loan. Interest on both is added every time you sell fish at the dock — black market sales don’t count. You can’t deposit while you owe money, and a loan left unpaid too long brings the police.' },
  { icon: '🎰', name: 'Gambling', desc: 'Slots and Blackjack. Unlocks once you’ve completed 3 Challenges.' },
  { icon: '🏆', name: 'Challenges', desc: 'Timed catch challenges for coin rewards. Complete every one of them at least once to unlock the Legendary Rod.' },
  { icon: '🏴‍☠️', name: 'Black Market', desc: 'A shady boat that turns up now and then, offering better sell prices or discounted gear. Only one deal per visit.' },
  { icon: '🐦', name: 'Pelican', desc: 'As your fish pile gets big, there is a chance a pelican will come and steal one. The bigger the pile, the more likely that pesky bird will swipe one. Doesn’t seem to like music.' },
  { icon: '🚓', name: 'Police Boat', desc: 'The police boat comes along every so often to check that no illegal gear is being used. If you are caught, you will be slapped with a fine, or have your gear confiscated. They also collect overdue bank loans — plus a 100 🪙 penalty, even if it leaves you in the red.' },
  { icon: '🐙', name: 'The Kraken', desc: 'Through tales from the sea, a kraken can be awoken from the deep. Beat it in a battle and claim your reward. Lose against it, and it flees, falling back into it’s slumber.' }
];

const manualPanelEl = document.getElementById('manualPanel');
const manualButtonEl = document.getElementById('manualButton');
const manualBookmarksEl = document.getElementById('manualBookmarks');
const manualContentEl = document.getElementById('manualContent');
let manualSelectedIndex = 0;
let manualOpen = false;

function renderManualContent() {
  const entry = MANUAL_ENTRIES[manualSelectedIndex];
  manualContentEl.innerHTML = `<h3>${entry.icon} ${entry.name}</h3>${entry.desc}`;
  Array.from(manualBookmarksEl.children).forEach((btn, i) => btn.classList.toggle('active', i === manualSelectedIndex));
}

MANUAL_ENTRIES.forEach((entry, i) => {
  const btn = document.createElement('button');
  btn.className = 'manual-bookmark-btn';
  btn.innerHTML = `<span>${entry.icon}</span><span>${entry.name}</span>`;
  btn.addEventListener('click', () => {
    manualSelectedIndex = i;
    renderManualContent();
  });
  manualBookmarksEl.appendChild(btn);
});

// no Close button — closes by clicking outside it (the shared menu backdrop)
// or by clicking the manual button again
function openManual() {
  closeEverything();
  renderManualContent();
  manualPanelEl.classList.add('open');
  manualOpen = true;
  updateBackdrop();
}
function closeManual() {
  manualPanelEl.classList.remove('open');
  manualOpen = false;
  updateBackdrop();
}
manualButtonEl.addEventListener('click', (e) => {
  e.stopPropagation();
  if (manualOpen) closeManual();
  else openManual();
});

// Rods (bought in the equipment tab) — four sequential upgrades. Each tier makes
// the capture bar fall slower (drain more slowly) when you drift off the fish
// during the reel-in, so a better rod means more forgiving fishing across every
// catch, not just a specific rarity.
const ROD_TIERS = [
  { id: 'bamboo', name: 'Bamboo Rod', cost: 0, drainMult: 1.0, desc: 'Your starting rod. Nothing special.' },
  { id: 'fiberglass', name: 'Fiberglass Rod', cost: 350, drainMult: 0.78, desc: 'A stiffer blank — the capture bar falls slower when you drift off the fish.' },
  { id: 'graphite', name: 'Graphite Rod', cost: 900, drainMult: 0.56, desc: 'Lighter and more responsive — even more forgiving on the capture bar. Never fishes up junk.' },
  { id: 'carbon', name: 'Carbon Rod', cost: 1800, drainMult: 0.4, desc: 'Top of the line — the capture bar barely falls when you slip off the fish. Never fishes up junk.' },
  { id: 'legendary', name: 'Legendary Rod', cost: 2000, drainMult: 0.4, desc: 'Only Epic, Legendary, or Mythic fish bite. Never fishes up junk.', unlockRequiresFullCatalog: true }
];
const ROD_TIER_KEY = 'sunsetFishing.rodTier';
let rodTier = 0;
try {
  rodTier = parseInt(localStorage.getItem(ROD_TIER_KEY) || '0', 10) || 0;
} catch (e) { /* localStorage unavailable — rod tier just won't persist */ }
function saveRodTier() { try { localStorage.setItem(ROD_TIER_KEY, String(rodTier)); } catch (e) {} }

// highest tier ever bought — rodTier is just whichever owned rod is currently
// equipped, and can be swapped back down to any lower tier you already own
const HIGHEST_ROD_TIER_KEY = 'sunsetFishing.highestRodTier';
let highestRodTier = rodTier;
try {
  highestRodTier = parseInt(localStorage.getItem(HIGHEST_ROD_TIER_KEY) || String(rodTier), 10) || rodTier;
} catch (e) { /* localStorage unavailable — won't persist */ }
function saveHighestRodTier() { try { localStorage.setItem(HIGHEST_ROD_TIER_KEY, String(highestRodTier)); } catch (e) {} }

// the Legendary Rod stays locked until every challenge (all 20, not just any
// 20 completions) has been completed at least once
const LEGENDARY_ROD_TIER = 4;
const LEGENDARY_ROD_RARITIES = ['Epic', 'Legendary', 'Mythic'];
function isLegendaryRodUnlocked() {
  return completedChallengeIds.size >= CHALLENGES.length;
}

// picks what's on the line — mostly fish (weighted by rarity), sometimes junk
let forcedNextCatch = null; // cheat-only: set by the cheat menu's fish dropdowns
// which food tiers (if any) were active for the catch pickCatch() just returned —
// snapshotted here since activeFoods itself gets consumed/trimmed inside this call,
// so anything checking "was this catch fed" later needs it captured up front
let lastPickFedTierIds = [];
function pickCatch() {
  lastPickFedTierIds = [];
  if (forcedNextCatch) {
    const forced = forcedNextCatch;
    forcedNextCatch = null;
    return forced;
  }
  if (baitRarity) {
    const rarity = pickBaitRarityOutcome(baitRarity);
    baitRarity = null;
    const pool = ROD_FISH_SPECIES.filter((s) => s.rarity === rarity);
    return pickRarityThenSpecies(pool, RARITY_WEIGHTS);
  }
  if (activeFoods.length) {
    lastPickFedTierIds = activeFoods.map((f) => f.tierId);
    const rarities = new Set();
    activeFoods.forEach((f) => {
      const tier = FISH_FOOD_TIERS.find((t) => t.id === f.tierId);
      tier.rarities.forEach((r) => rarities.add(r));
    });
    const pool = ROD_FISH_SPECIES.filter((s) => rarities.has(s.rarity));
    const catchEntry = weightedPick(pool);
    activeFoods.forEach((f) => f.usesLeft--);
    activeFoods = activeFoods.filter((f) => f.usesLeft > 0);
    saveActiveFoods();
    return catchEntry;
  }
  // the two best rods (Graphite, Carbon) never fish up junk — same for Legendary,
  // which also only ever hooks Epic, Legendary, or Mythic fish
  if (rodTier < 2 && Math.random() < 0.22) {
    return JUNK_ITEMS[Math.floor(Math.random() * JUNK_ITEMS.length)];
  }
  if (rodTier === LEGENDARY_ROD_TIER) {
    const pool = ROD_FISH_SPECIES.filter((s) => LEGENDARY_ROD_RARITIES.includes(s.rarity));
    return weightedPick(pool);
  }
  return weightedPick(ROD_FISH_SPECIES);
}

// how hard the reel-in mini-game is, scaled by the rarity of what's on the line —
// common stuff is nearly foolproof, legendary catches demand real precision (but
// are still always winnable with a steady hand)
// fillRate is fixed — every rod fills at the same pace, so tracking skill still
// matters the same regardless of gear. drainRate is the baseline (Bamboo Rod,
// 1.0x) pace — every other rod tier's drainMult is a percentage of it, floored
// at 40% (see ROD_TIERS). Only the fall is what better rods make more forgiving.
const REEL_DIFFICULTY = {
  Common: { zoneHalf: 0.20, fishSpeed: 1.6, fishMinT: 1.0, fishMaxT: 1.6, fillRate: 0.33, drainRate: 0.26 },
  Uncommon: { zoneHalf: 0.165, fishSpeed: 2.0, fishMinT: 0.85, fishMaxT: 1.4, fillRate: 0.29, drainRate: 0.30 },
  Rare: { zoneHalf: 0.15, fishSpeed: 2.4, fishMinT: 0.75, fishMaxT: 1.3, fillRate: 0.26, drainRate: 0.32 },
  Epic: { zoneHalf: 0.12, fishSpeed: 3.1, fishMinT: 0.55, fishMaxT: 1.0, fillRate: 0.21, drainRate: 0.40 },
  Legendary: { zoneHalf: 0.095, fishSpeed: 3.8, fishMinT: 0.4, fishMaxT: 0.8, fillRate: 0.18, drainRate: 0.48 },
  // Mythic is the one exception to "rarer = harder" — impossibly rare to even hook,
  // but trivial to land once you do, so the moment isn't ruined by a fumble
  Mythic: { zoneHalf: 0.45, fishSpeed: 0.6, fishMinT: 2.0, fishMaxT: 3.0, fillRate: 0.9, drainRate: 0.02 }
};

// ------------------------------------------------------------------
// Catch index — a bottom menu button that pops open a collection grid.
// Uncaught entries show as a black silhouette labeled "???"; landing one
// for the first time reveals its real shape/color and name, permanently
// (progress is remembered in localStorage).
// ------------------------------------------------------------------
const CATALOG = [...FISH_SPECIES, ...JUNK_ITEMS];
const CAUGHT_STORAGE_KEY = 'sunsetFishing.caughtNames';
let caughtNames = new Set();
try {
  const saved = JSON.parse(localStorage.getItem(CAUGHT_STORAGE_KEY) || '[]');
  caughtNames = new Set(saved);
} catch (e) { /* localStorage unavailable — progress just won't persist */ }

function markCaught(entry) {
  if (caughtNames.has(entry.name)) return;
  caughtNames.add(entry.name);
  try { localStorage.setItem(CAUGHT_STORAGE_KEY, JSON.stringify([...caughtNames])); } catch (e) {}
}

const RARITY_COLORS = { Common: '#9aa5ad', Uncommon: '#5fce7a', Rare: '#5aa7f2', Epic: '#b988f0', Legendary: '#ffcf4d', Mythic: '#fff6c9' };

// renders an actual snapshot of each catch's real 3D model for its catalog icon
// (instead of a generic stand-in), so a Marlin really looks long and torpedo-shaped,
// a Pufferfish looks round, a boot looks like a boot, etc.
const ICON_SIZE = 128;
const iconRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
iconRenderer.setSize(ICON_SIZE, ICON_SIZE);
iconRenderer.setClearColor(0x000000, 0);
const iconScene = new THREE.Scene();
const iconCamera = new THREE.PerspectiveCamera(32, 1, 0.05, 50);
const iconKeyLight = new THREE.DirectionalLight(0xffffff, 1.15);
iconKeyLight.position.set(2, 3, 4);
iconScene.add(iconKeyLight);
iconScene.add(new THREE.AmbientLight(0xffffff, 0.6));
const iconSilhouetteMat = new THREE.MeshBasicMaterial({ color: 0x11151a });

const iconCache = new Map();
function getEntryIcon(entry, silhouette) {
  const key = entry.name + (silhouette ? ':lock' : ':full');
  if (iconCache.has(key)) return iconCache.get(key);

  const mesh = entry.build();
  mesh.scale.multiplyScalar(entry.scale || 1);
  if (silhouette) {
    mesh.traverse((o) => { if (o.isMesh) o.material = iconSilhouetteMat; });
  }
  iconScene.add(mesh);

  const box = new THREE.Box3().setFromObject(mesh);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const dist = (sphere.radius / Math.sin((iconCamera.fov * Math.PI / 180) / 2)) * 1.4;
  const dir = new THREE.Vector3(0.75, 0.55, 1).normalize();
  iconCamera.position.copy(sphere.center).addScaledVector(dir, dist);
  iconCamera.lookAt(sphere.center);

  iconRenderer.render(iconScene, iconCamera);
  const url = iconRenderer.domElement.toDataURL('image/png');

  iconScene.remove(mesh);
  iconCache.set(key, url);
  return url;
}

const menuButtonEl = document.getElementById('menuButton');
const menuStackEl = document.getElementById('menuStack');
const indexButtonEl = document.getElementById('indexButton');
const logButtonEl = document.getElementById('logButton');
const catalogPanelEl = document.getElementById('catalogPanel');
const logPanelEl = document.getElementById('logPanel');
const menuBackdropEl = document.getElementById('menuBackdrop');
const catalogGridEl = document.getElementById('catalogGrid');
const catalogProgressEl = document.getElementById('catalogProgress');
const logListEl = document.getElementById('logList');
const logCountEl = document.getElementById('logCount');

// the fishing log — every catch, remembered, each with its own randomized weight
// (so two Bass you've caught don't weigh the same)
const CATALOG_BY_NAME = new Map(CATALOG.map((e) => [e.short || e.name, e]));
const CATCH_LOG_KEY = 'sunsetFishing.catchLog';
let catchLog = [];
try {
  catchLog = JSON.parse(localStorage.getItem(CATCH_LOG_KEY) || '[]');
} catch (e) { /* localStorage unavailable — log just won't persist */ }

function rollWeight(entry) {
  const [lo, hi] = entry.weightRange || [1, 1];
  return lo + Math.random() * (hi - lo);
}

function saveCatchLog() {
  try { localStorage.setItem(CATCH_LOG_KEY, JSON.stringify(catchLog)); } catch (e) {}
}

function logCatch(entry, weight) {
  const displayName = entry.short || entry.name;
  const row = { name: displayName, type: entry.type, rarity: entry.rarity, weight, sold: false, stolen: false, baited: false };
  catchLog.unshift(row);
  if (catchLog.length > 200) catchLog.length = 200;
  saveCatchLog();
  return row;
}

function formatWeight(w) {
  return (w < 10 ? w.toFixed(1) : Math.round(w)) + ' lb';
}

function renderLog() {
  logListEl.innerHTML = '';
  if (catchLog.length === 0) {
    logListEl.innerHTML = '<div class="log-empty">Nothing landed yet — go cast a line!</div>';
    logCountEl.textContent = '';
    return;
  }
  catchLog.forEach((row) => {
    const entry = CATALOG_BY_NAME.get(row.name);
    const rowEl = document.createElement('div');
    rowEl.className = 'log-row' + (row.sold || row.stolen || row.baited ? ' sold' : '');

    const icon = document.createElement('div');
    icon.className = 'log-icon';
    if (entry) {
      const img = document.createElement('img');
      img.src = getEntryIcon(entry, false);
      icon.appendChild(img);
    }

    const info = document.createElement('div');
    info.className = 'log-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'log-name';
    nameEl.textContent = row.name;
    const rarityEl = document.createElement('div');
    rarityEl.className = 'log-rarity';
    rarityEl.textContent = row.rarity + (row.sold ? ' · sold' : (row.stolen ? ' · stolen by pelican' : (row.baited ? ' · used as bait' : '')));
    rarityEl.style.color = (row.sold || row.stolen || row.baited) ? '#7a8894' : RARITY_COLORS[row.rarity];
    info.appendChild(nameEl);
    info.appendChild(rarityEl);

    const weightEl = document.createElement('div');
    weightEl.className = 'log-weight';
    weightEl.textContent = formatWeight(row.weight);

    rowEl.appendChild(icon);
    rowEl.appendChild(info);
    rowEl.appendChild(weightEl);
    logListEl.appendChild(rowEl);
  });
  logCountEl.textContent = `${catchLog.length} catch${catchLog.length === 1 ? '' : 'es'}`;
}

// ------------------------------------------------------------------
// Coins — sell your unsold catches for coins, priced by weight and rarity
// ------------------------------------------------------------------
const RARITY_PRICE_PER_LB = { Common: 4, Uncommon: 6, Rare: 11, Epic: 22, Legendary: 47, Mythic: 10000 };

function catchValue(row) {
  const base = row.weight * (RARITY_PRICE_PER_LB[row.rarity] || 1);
  // schooling fish are net-exclusive and otherwise nearly worthless by weight —
  // a per-species premium is what makes bothering with the net actually pay off
  const entry = CATALOG_BY_NAME.get(row.name);
  const mult = (entry && entry.sellMultiplier) || 1;
  return Math.round(base * mult);
}

const COINS_KEY = 'sunsetFishing.coins';
let coins = 0;
try {
  coins = parseInt(localStorage.getItem(COINS_KEY) || '0', 10) || 0;
} catch (e) { /* localStorage unavailable — coins just won't persist */ }

function updateCoinsHUD() {
  scoreEl.textContent = '🪙 ' + coins;
  scoreEl.classList.toggle('negative', coins < 0);
}
function addCoins(n) {
  coins += n;
  try { localStorage.setItem(COINS_KEY, String(coins)); } catch (e) {}
  updateCoinsHUD();
}

// dev cheat menu: click the coin counter 4x within 1.5s, enter 4321 to open it.
// not styled, not hidden well — just a quick way to test paid features. add
// new simple cheats to the CHEATS array below; each becomes a button in the panel.
const CHEATS = [
  { label: '+10000 coins', action: () => addCoins(10000) },
  { label: 'skip hire cooldowns', action: () => {
      let changed = false;
      HIRE_GUYS.forEach((guy) => {
        if (hires[guy.id]) { hires[guy.id] = Date.now(); changed = true; }
      });
      if (changed) saveHires();
    }
  },
  { label: 'unlock gambling', action: () => {
      challengesCompletedCount = GAMBLING_UNLOCK_COUNT;
      updateGamblingLockUI();
      if (openPanel === 'challenges') renderChallenges();
    }
  },
  { label: () => `hire tab: ${hireTabUnlocked ? 'ON' : 'OFF'}`, action: () => {
      hireTabUnlocked = !hireTabUnlocked;
      updateHireTabVisibility();
      if (!hireTabUnlocked && openPanel === 'hire') closeEverything();
    }
  }
];

// events are picked from a dropdown but not fired until the cheat panel is
// closed — the panel covers the scene, so firing immediately means you'd
// never actually see the animation play out
const CHEAT_EVENTS = [
  { id: 'blackmarket', label: 'Black Market', action: () => {
      if (blackMarketState.phase === 'idle') startBlackMarketEvent();
    }
  },
  { id: 'bird', label: 'Bird', action: () => startPelicanEvent() },
  { id: 'police', label: 'Police Boat', action: () => {
      if (policeState.phase === 'idle') startPoliceBoatEvent();
    }
  },
  { id: 'kraken-heave', label: 'Kraken (Heave)', action: () => startKrakenEvent('heave') },
  { id: 'kraken-frenzy', label: 'Kraken (Frenzy)', action: () => startKrakenEvent('frenzy') },
  { id: 'bottle', label: 'Message in a Bottle', action: () => {
      if (!bottleState.active) startBottle();
    }
  },
  { id: 'dolphins', label: 'Dolphins', action: () => {
      if (!dolphinState.active) startDolphins();
    }
  }
];
let pendingCheatEvent = null;

const cheatPanelEl = document.getElementById('cheatPanel');
const cheatListEl = document.getElementById('cheatList');
const cheatCloseBtnEl = document.getElementById('cheatCloseBtn');

function renderCheatMenu() {
  cheatListEl.innerHTML = '';

  // one dropdown per rarity — picking a fish forces it to be the next rod catch
  RARITY_ORDER.forEach((rarity) => {
    const species = FISH_SPECIES.filter((s) => s.rarity === rarity);
    if (species.length === 0) return;
    const select = document.createElement('select');
    select.className = 'cheat-btn';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = `-- ${rarity} --`;
    select.appendChild(placeholder);
    species.forEach((sp) => {
      const opt = document.createElement('option');
      opt.value = sp.name;
      opt.textContent = sp.name;
      select.appendChild(opt);
    });
    select.addEventListener('change', () => {
      if (!select.value) return;
      forcedNextCatch = species.find((sp) => sp.name === select.value) || null;
      select.value = '';
    });
    cheatListEl.appendChild(select);
  });

  // Events — queued, not fired until the panel closes (see pendingCheatEvent)
  const eventSelect = document.createElement('select');
  eventSelect.className = 'cheat-btn';
  const eventPlaceholder = document.createElement('option');
  eventPlaceholder.value = '';
  eventPlaceholder.textContent = pendingCheatEvent ? `-- Events (${pendingCheatEvent.label} queued) --` : '-- Events --';
  eventSelect.appendChild(eventPlaceholder);
  CHEAT_EVENTS.forEach((ev) => {
    const opt = document.createElement('option');
    opt.value = ev.id;
    opt.textContent = ev.label;
    eventSelect.appendChild(opt);
  });
  eventSelect.addEventListener('change', () => {
    if (!eventSelect.value) return;
    pendingCheatEvent = CHEAT_EVENTS.find((e) => e.id === eventSelect.value) || null;
    eventSelect.value = '';
    renderCheatMenu();
  });
  cheatListEl.appendChild(eventSelect);

  CHEATS.forEach((cheat) => {
    const btn = document.createElement('button');
    btn.className = 'cheat-btn';
    btn.textContent = typeof cheat.label === 'function' ? cheat.label() : cheat.label;
    btn.addEventListener('click', () => {
      cheat.action();
      renderCheatMenu();
    });
    cheatListEl.appendChild(btn);
  });
}

cheatCloseBtnEl.addEventListener('click', () => {
  cheatPanelEl.classList.remove('open');
  if (pendingCheatEvent) {
    const ev = pendingCheatEvent;
    pendingCheatEvent = null;
    ev.action();
  }
});

let cheatClickCount = 0;
let cheatClickTimer = null;
scoreEl.addEventListener('click', () => {
  cheatClickCount++;
  clearTimeout(cheatClickTimer);
  cheatClickTimer = setTimeout(() => { cheatClickCount = 0; }, 1500);
  if (cheatClickCount >= 4) {
    cheatClickCount = 0;
    const code = prompt('Code:');
    if (code === '4321') {
      renderCheatMenu();
      cheatPanelEl.classList.add('open');
    }
  }
});

const sellPanelEl = document.getElementById('sellPanel');
const sellStatsEl = document.getElementById('sellStats');
const sellButtonEl = document.getElementById('sellButton');
const sellAmountEl = document.getElementById('sellAmount');
const sellButtonToggleEl = document.getElementById('sellButtonToggle');

function renderSell() {
  const pending = catchLog.filter((e) => e.type === 'fish' && !e.sold && !e.stolen && !e.baited);
  const totalWeight = pending.reduce((s, e) => s + e.weight, 0);
  const totalCoins = pending.reduce((s, e) => s + catchValue(e), 0);

  if (pending.length === 0) {
    sellStatsEl.innerHTML = '<div class="log-empty">Nothing to sell yet — go catch some fish!</div>';
  } else {
    sellStatsEl.innerHTML = `
      <div>Your catch: <b>${pending.length} fish</b> (${totalWeight.toFixed(1)} lb).</div>
      <div class="sell-breakdown">Priced by weight and rarity — rarer fish sell for much more per pound.</div>
    `;
  }
  sellAmountEl.textContent = totalCoins;
  sellButtonEl.disabled = pending.length === 0;
}

sellButtonEl.addEventListener('click', () => {
  const pending = catchLog.filter((e) => e.type === 'fish' && !e.sold && !e.stolen && !e.baited);
  if (!pending.length) return;
  const total = pending.reduce((s, e) => s + catchValue(e), 0);
  pending.forEach((e) => { e.sold = true; });
  saveCatchLog();
  addCoins(total);
  clearPile();
  onDockSaleForBank(total);
  renderSell();
  if (openPanel === 'log') renderLog();
});

// ------------------------------------------------------------------
// Shop
// ------------------------------------------------------------------
const foodPanelEl = document.getElementById('foodPanel');
const foodListEl = document.getElementById('foodList');
const foodButtonEl = document.getElementById('foodButton');
const equipmentPanelEl = document.getElementById('equipmentPanel');
const equipmentListEl = document.getElementById('equipmentList');
const equipmentButtonEl = document.getElementById('equipmentButton');
const AUTO_RECAST_COST = 400;
const NET_COST = 200;
const HAT_COST = 10;
let hatOwned = false;
let hatFishCount = 0;
const RADIO_COST = 50;
let radioOwned = false;
let radioPlaying = false;

const blackMarketPanelEl = document.getElementById('blackMarketPanel');
const blackMarketStatsEl = document.getElementById('blackMarketStats');
const blackMarketAmountEl = document.getElementById('blackMarketAmount');
const blackMarketSellButtonEl = document.getElementById('blackMarketSellButton');
const blackMarketButtonEl = document.getElementById('blackMarketButton');
const BLACKMARKET_BONUS = 1.1;

function renderBlackMarket() {
  const pending = catchLog.filter((e) => e.type === 'fish' && !e.sold && !e.stolen && !e.baited);
  const totalWeight = pending.reduce((s, e) => s + e.weight, 0);
  const totalCoins = Math.round(pending.reduce((s, e) => s + catchValue(e), 0) * BLACKMARKET_BONUS);
  if (pending.length === 0) {
    blackMarketStatsEl.innerHTML = '<div class="log-empty">Nothing to unload right now.</div>';
  } else {
    blackMarketStatsEl.innerHTML = `
      <div>They'll take <b>${pending.length} fish</b> (${totalWeight.toFixed(1)} lb) off your hands.</div>
      <div class="sell-breakdown">No questions asked — 10% over the going rate.</div>
    `;
  }
  blackMarketAmountEl.textContent = totalCoins;
  blackMarketSellButtonEl.disabled = pending.length === 0 || blackMarketTransacted;
}

blackMarketSellButtonEl.addEventListener('click', () => {
  if (blackMarketTransacted) return;
  const pending = catchLog.filter((e) => e.type === 'fish' && !e.sold && !e.stolen && !e.baited);
  if (!pending.length) return;
  const total = Math.round(pending.reduce((s, e) => s + catchValue(e), 0) * BLACKMARKET_BONUS);
  pending.forEach((e) => { e.sold = true; });
  saveCatchLog();
  addCoins(total);
  clearPile();
  blackMarketTransacted = true;
  renderBlackMarket();
  if (openPanel === 'log') renderLog();
  if (openPanel === 'sell') renderSell();
  maybeTriggerPoliceBoat();
  setTimeout(() => endBlackMarketVisit(), 1200);
});

// Black Market Buy — the same equipment/rods/food as the regular shops, but
// 10% off. Like selling, buying anything sends the boat on its way shortly
// after — one transaction per visit (buy OR sell, not both, and only once),
// so blackMarketTransacted locks everything out the instant that one deal
// happens rather than waiting for the boat to actually leave.
const BLACKMARKET_BUY_DISCOUNT = 0.9;
const blackMarketBuyListEl = document.getElementById('blackMarketBuyList');
const blackMarketSellTabBtnEl = document.getElementById('blackMarketSellTabBtn');
const blackMarketBuyTabBtnEl = document.getElementById('blackMarketBuyTabBtn');
const blackMarketSellViewEl = document.getElementById('blackMarketSellView');
const blackMarketBuyViewEl = document.getElementById('blackMarketBuyView');
let blackMarketTab = 'sell';
let blackMarketTransacted = false;

function afterBlackMarketBuy() {
  blackMarketTransacted = true;
  setTimeout(() => endBlackMarketVisit(), 1200);
}

// everything bought off the black market raises the odds a police boat shows
// up — 2% per item bought, capped at 20%, checked on every successful rod
// catch or net swoop, and on every black market buy/sell. when it does, it
// goes after whatever was bought most recently: confiscated if you still
// have it, a 200-coin fine if it's already gone (a consumed Fish Food, a rod
// you've since upgraded past)
const BLACKMARKET_ITEMS_BOUGHT_KEY = 'sunsetFishing.blackMarketItemsBought';
let blackMarketItemsBought = 0;
try {
  blackMarketItemsBought = parseInt(localStorage.getItem(BLACKMARKET_ITEMS_BOUGHT_KEY) || '0', 10) || 0;
} catch (e) { /* localStorage unavailable — won't persist */ }
let lastBlackMarketItem = null; // { kind: 'autocaster'|'net'|'hat'|'radio'|'rod'|'food', tier?, tierId? }
function trackBlackMarketPurchase(item) {
  blackMarketItemsBought++;
  lastBlackMarketItem = item;
  try { localStorage.setItem(BLACKMARKET_ITEMS_BOUGHT_KEY, String(blackMarketItemsBought)); } catch (e) {}
  maybeTriggerPoliceBoat();
}

function renderBlackMarketBuy() {
  blackMarketBuyListEl.innerHTML = '';

  if (blackMarketTransacted) {
    blackMarketBuyListEl.innerHTML = '<div class="log-empty">Already made a deal this visit — he\'s packing up.</div>';
    return;
  }

  const autoCost = Math.round(AUTO_RECAST_COST * BLACKMARKET_BUY_DISCOUNT);
  blackMarketBuyListEl.appendChild(buildShopItemEl(
    '🔁', 'Auto-Caster', 'Automatically casts again after every fish.',
    autoRecastOwned ? 'Already owned.' : '',
    [makeShopBtn(autoRecastOwned ? 'Owned' : `Buy (${autoCost} 🪙)`, autoRecastOwned, autoRecastOwned || coins < autoCost, () => {
      if (blackMarketTransacted || autoRecastOwned || coins < autoCost) return;
      addCoins(-autoCost);
      autoRecastOwned = true;
      autoRecastEnabled = true;
      saveAutoRecastOwned();
      saveAutoRecastEnabled();
      trackBlackMarketPurchase({ kind: 'autocaster' });
      showCatchPopup('Auto-Caster acquired!', false);
      afterBlackMarketBuy();
      renderBlackMarketBuy();
    })]
  ));

  const netCost = Math.round(NET_COST * BLACKMARKET_BUY_DISCOUNT);
  blackMarketBuyListEl.appendChild(buildShopItemEl(
    NET_ICON_SVG, 'Fishing Net', 'Swap in for the rod to scoop a passing school.',
    netOwned ? 'Already owned.' : '',
    [makeShopBtn(netOwned ? 'Owned' : `Buy (${netCost} 🪙)`, netOwned, netOwned || coins < netCost, () => {
      if (blackMarketTransacted || netOwned || coins < netCost) return;
      addCoins(-netCost);
      netOwned = true;
      saveNetOwned();
      trackBlackMarketPurchase({ kind: 'net' });
      showCatchPopup('Fishing Net acquired!', false);
      updateToolSwapButton();
      afterBlackMarketBuy();
      renderBlackMarketBuy();
    })]
  ));

  const hatCost = Math.round(HAT_COST * BLACKMARKET_BUY_DISCOUNT);
  blackMarketBuyListEl.appendChild(buildShopItemEl(
    '🎩', 'Fishing Hat', "Doesn't do anything.",
    hatOwned ? 'Worn.' : '',
    [makeShopBtn(hatOwned ? 'Worn' : `Buy (${hatCost} 🪙)`, hatOwned, hatOwned || coins < hatCost, () => {
      if (blackMarketTransacted || hatOwned || coins < hatCost) return;
      addCoins(-hatCost);
      hatOwned = true;
      hatFishCount = 0;
      hatFlying = false;
      trackBlackMarketPurchase({ kind: 'hat' });
      afterBlackMarketBuy();
      renderBlackMarketBuy();
    })]
  ));

  const radioCost = Math.round(RADIO_COST * BLACKMARKET_BUY_DISCOUNT);
  blackMarketBuyListEl.appendChild(buildShopItemEl(
    '📻', 'Little Radio', 'Plays a little beat.',
    radioOwned ? 'Already owned.' : '',
    [makeShopBtn(radioOwned ? 'Owned' : `Buy (${radioCost} 🪙)`, radioOwned, radioOwned || coins < radioCost, () => {
      if (blackMarketTransacted || radioOwned || coins < radioCost) return;
      addCoins(-radioCost);
      radioOwned = true;
      radioPlaying = true;
      radioGroup.visible = true;
      startRadioMusic();
      trackBlackMarketPurchase({ kind: 'radio' });
      afterBlackMarketBuy();
      renderBlackMarketBuy();
    })]
  ));

  // rods — same owned/equipped/next/locked states as the Equipment tab
  ROD_TIERS.forEach((rod, i) => {
    let status, rodButtons;
    if (i === rodTier) {
      status = 'Equipped.';
      rodButtons = [makeShopBtn('Equipped', true, true, () => {})];
    } else if (i <= highestRodTier) {
      status = 'Owned.';
      rodButtons = [makeShopBtn('Equip', false, false, () => {
        rodTier = i;
        saveRodTier();
        applyToolVisibility();
        showCatchPopup(`${rod.name} equipped!`, false);
        renderBlackMarketBuy();
      })];
    } else if (i === highestRodTier + 1 && rod.unlockRequiresFullCatalog && !isLegendaryRodUnlocked()) {
      status = 'Locked — complete every challenge first.';
      rodButtons = [makeShopBtn('Locked', true, true, () => {})];
    } else if (i === highestRodTier + 1) {
      const rodCost = Math.round(rod.cost * BLACKMARKET_BUY_DISCOUNT);
      status = '';
      rodButtons = [makeShopBtn(`Buy (${rodCost} 🪙)`, false, coins < rodCost, () => {
        if (blackMarketTransacted || coins < rodCost) return;
        addCoins(-rodCost);
        rodTier = i;
        highestRodTier = i;
        saveRodTier();
        saveHighestRodTier();
        applyToolVisibility();
        trackBlackMarketPurchase({ kind: 'rod', tier: i });
        showCatchPopup(`${rod.name} equipped!`, false);
        afterBlackMarketBuy();
        renderBlackMarketBuy();
      })];
    } else {
      status = `Upgrade to the ${ROD_TIERS[highestRodTier + 1].name} first.`;
      rodButtons = [makeShopBtn('Locked', true, true, () => {})];
    }
    blackMarketBuyListEl.appendChild(buildShopItemEl('🎣', rod.name, rod.desc, status, rodButtons));
  });

  // fish food — stacks, always buyable
  FISH_FOOD_TIERS.forEach((tier) => {
    const foodCost = Math.round(tier.cost * BLACKMARKET_BUY_DISCOUNT);
    const owned = foodOwned[tier.id] || 0;
    blackMarketBuyListEl.appendChild(buildShopItemEl(
      '🪱', tier.name, `Only attracts ${tier.rarities.join('/')} fish. Lasts ${tier.uses} fish.`,
      owned > 0 ? `Owned: ${owned}` : '',
      [makeShopBtn(`Buy (${foodCost} 🪙)`, false, coins < foodCost, () => {
        if (blackMarketTransacted || coins < foodCost) return;
        addCoins(-foodCost);
        foodOwned[tier.id] = (foodOwned[tier.id] || 0) + 1;
        saveFoodOwned();
        trackBlackMarketPurchase({ kind: 'food', tierId: tier.id });
        showCatchPopup(`${tier.name} bought!`, false);
        afterBlackMarketBuy();
        renderBlackMarketBuy();
      })]
    ));
  });
}

function setBlackMarketTab(tab) {
  blackMarketTab = tab;
  blackMarketSellTabBtnEl.classList.toggle('active', tab === 'sell');
  blackMarketBuyTabBtnEl.classList.toggle('active', tab === 'buy');
  blackMarketSellViewEl.style.display = tab === 'sell' ? 'flex' : 'none';
  blackMarketBuyViewEl.style.display = tab === 'buy' ? 'flex' : 'none';
  if (tab === 'sell') renderBlackMarket();
  else renderBlackMarketBuy();
}
blackMarketSellTabBtnEl.addEventListener('click', () => setBlackMarketTab('sell'));
blackMarketBuyTabBtnEl.addEventListener('click', () => setBlackMarketTab('buy'));

function buildShopItemEl(iconText, name, desc, statusText, buttons) {
  const item = document.createElement('div');
  item.className = 'shop-item';

  const icon = document.createElement('div');
  icon.className = 'shop-item-icon';
  icon.innerHTML = iconText;
  item.appendChild(icon);

  const info = document.createElement('div');
  info.className = 'shop-item-info';
  const nameEl = document.createElement('div');
  nameEl.className = 'shop-item-name';
  nameEl.textContent = name;
  const descEl = document.createElement('div');
  descEl.className = 'shop-item-desc';
  descEl.textContent = desc;
  info.appendChild(nameEl);
  info.appendChild(descEl);
  if (statusText) {
    const status = document.createElement('div');
    status.className = 'shop-item-status';
    status.textContent = statusText;
    info.appendChild(status);
  }
  item.appendChild(info);

  const actions = document.createElement('div');
  actions.className = 'shop-item-actions';
  buttons.forEach((b) => actions.appendChild(b));
  item.appendChild(actions);

  return item;
}

function makeShopBtn(text, secondary, disabled, onClick) {
  const btn = document.createElement('button');
  btn.className = 'shop-btn' + (secondary ? ' secondary' : '');
  btn.textContent = text;
  btn.disabled = !!disabled;
  btn.addEventListener('click', onClick);
  return btn;
}

// the bottle note's riddle, made real: casting off while both Golden and
// Hearty Fish Food are active at once has a chance to summon the Kraken
// instead of a normal cast — checked in startCast()
const KRAKEN_SUMMON_CHANCE = 0.6;

function renderFood() {
  foodListEl.innerHTML = '';

  FISH_FOOD_TIERS.forEach((tier) => {
    const owned = foodOwned[tier.id] || 0;
    const buttons = [makeShopBtn(`Buy (${tier.cost} 🪙)`, false, coins < tier.cost, () => {
      if (coins < tier.cost) return;
      addCoins(-tier.cost);
      foodOwned[tier.id] = (foodOwned[tier.id] || 0) + 1;
      saveFoodOwned();
      renderFood();
    })];
    if (owned > 0) {
      buttons.push(makeShopBtn('Feed the water', true, false, () => {
        foodOwned[tier.id]--;
        saveFoodOwned();
        const existing = activeFoods.find((f) => f.tierId === tier.id);
        if (existing) existing.usesLeft += tier.uses;
        else activeFoods.push({ tierId: tier.id, usesLeft: tier.uses });
        saveActiveFoods();
        showCatchPopup(`${tier.name} tossed in!`, false);
        startFoodToss();
        renderFood();
      }));
    }
    const activeEntry = activeFoods.find((f) => f.tierId === tier.id);
    const status = activeEntry
      ? `Active — ${activeEntry.usesLeft} fish left.`
      : (owned > 0 ? `Owned: ${owned}` : '');
    foodListEl.appendChild(buildShopItemEl(
      '🪱', tier.name, `Only attracts ${tier.rarities.join('/')} fish. Lasts ${tier.uses} fish.`, status, buttons
    ));
  });

  const baitEntry = findLastBaitableCatch();
  const baitStatus = baitEntry
    ? `Ready to rig: ${baitEntry.name} (${baitEntry.rarity})`
    : 'No fish available';
  const baitButtons = [makeShopBtn(`Use (${BAIT_COST} 🪙)`, false, !baitEntry || coins < BAIT_COST, () => {
    useLastCatchAsBait();
    renderFood();
  })];
  foodListEl.appendChild(buildShopItemEl(
    '🐟', 'Use Last Catch as Bait', 'Rigs your most recent fish as bait', baitStatus, baitButtons
  ));
}

function renderEquipment() {
  equipmentListEl.innerHTML = '';

  // Auto-Caster — one-time purchase, then an on/off toggle, infinite use
  let autoButtons;
  let autoStatus;
  if (!autoRecastOwned) {
    autoButtons = [makeShopBtn(`Buy (${AUTO_RECAST_COST} 🪙)`, false, coins < AUTO_RECAST_COST, () => {
      if (coins < AUTO_RECAST_COST) return;
      addCoins(-AUTO_RECAST_COST);
      autoRecastOwned = true;
      autoRecastEnabled = true;
      saveAutoRecastOwned();
      saveAutoRecastEnabled();
      showCatchPopup('Auto-Caster acquired!', false);
      renderEquipment();
    })];
    autoStatus = '';
  } else {
    autoButtons = [makeShopBtn(autoRecastEnabled ? 'ON' : 'OFF', !autoRecastEnabled, false, () => {
      autoRecastEnabled = !autoRecastEnabled;
      saveAutoRecastEnabled();
      renderEquipment();
    })];
    autoStatus = autoRecastEnabled ? 'Active — casts again automatically after every fish.' : 'Owned, but switched off.';
  }
  equipmentListEl.appendChild(buildShopItemEl(
    '🔁', 'Auto-Caster', 'Automatically casts again right after you land a fish. Buy once, toggle any time.', autoStatus, autoButtons
  ));

  // Fishing Net — one-time purchase, then swap to it with the tool-swap button
  const netButtons = [makeShopBtn(netOwned ? 'Owned' : `Buy (${NET_COST} 🪙)`, netOwned, netOwned || coins < NET_COST, () => {
    if (netOwned || coins < NET_COST) return;
    addCoins(-NET_COST);
    netOwned = true;
    saveNetOwned();
    showCatchPopup('Fishing Net acquired!', false);
    renderEquipment();
    updateToolSwapButton();
  })];
  const netStatus = netOwned ? 'Owned — swap to it with the button under your message log.' : '';
  equipmentListEl.appendChild(buildShopItemEl(
    NET_ICON_SVG, 'Fishing Net', 'Swap in for the rod to scoop a passing school.', netStatus, netButtons
  ));

  // Fishing Hat — purely cosmetic, blows off after 2 fish and needs rebuying
  const hatButtons = [makeShopBtn(hatOwned ? 'Worn' : `Buy (${HAT_COST} 🪙)`, hatOwned, hatOwned || coins < HAT_COST, () => {
    if (hatOwned || coins < HAT_COST) return;
    addCoins(-HAT_COST);
    hatOwned = true;
    hatFishCount = 0;
    hatFlying = false;
    renderEquipment();
  })];
  const hatStatus = hatOwned ? 'Worn.' : '';
  equipmentListEl.appendChild(buildShopItemEl(
    '🎩', 'Fishing Hat', "Doesn't do anything.", hatStatus, hatButtons
  ));

  // Little Radio — plays a small synthesized beat, buy once, toggle any time
  let radioButtons;
  if (!radioOwned) {
    radioButtons = [makeShopBtn(`Buy (${RADIO_COST} 🪙)`, false, coins < RADIO_COST, () => {
      if (coins < RADIO_COST) return;
      addCoins(-RADIO_COST);
      radioOwned = true;
      radioPlaying = true;
      radioGroup.visible = true;
      startRadioMusic();
      renderEquipment();
    })];
  } else {
    radioButtons = [makeShopBtn(radioPlaying ? 'ON' : 'OFF', !radioPlaying, false, () => {
      radioPlaying = !radioPlaying;
      if (radioPlaying) startRadioMusic(); else stopRadioMusic();
      renderEquipment();
    })];
  }
  const radioStatus = radioOwned ? (radioPlaying ? 'Playing a little tune.' : 'Turned off.') : '';
  equipmentListEl.appendChild(buildShopItemEl(
    '📻', 'Little Radio', 'Plays a little beat.', radioStatus, radioButtons
  ));

  // Rods — four sequential upgrades, each buyable only once the one before it
  // is owned. highestRodTier is the ceiling on what's ownable/buyable; rodTier
  // is just whichever owned tier is currently equipped, and can be swapped
  // back down to any lower tier already owned via the Equip button.
  const rodLabel = document.createElement('div');
  rodLabel.className = 'shop-section-label';
  rodLabel.textContent = 'Rods';
  equipmentListEl.appendChild(rodLabel);

  ROD_TIERS.forEach((rod, i) => {
    let status, rodButtons;
    if (i === rodTier) {
      status = i === 0 && highestRodTier === 0 ? 'Your starting rod — equipped.' : 'Equipped.';
      rodButtons = [makeShopBtn('Equipped', true, true, () => {})];
    } else if (i <= highestRodTier) {
      status = 'Owned.';
      rodButtons = [makeShopBtn('Equip', false, false, () => {
        rodTier = i;
        saveRodTier();
        applyToolVisibility();
        showCatchPopup(`${rod.name} equipped!`, false);
        renderEquipment();
      })];
    } else if (i === highestRodTier + 1 && rod.unlockRequiresFullCatalog && !isLegendaryRodUnlocked()) {
      status = 'Locked — complete every challenge first.';
      rodButtons = [makeShopBtn('Locked', true, true, () => {})];
    } else if (i === highestRodTier + 1) {
      status = '';
      rodButtons = [makeShopBtn(`Buy (${rod.cost} 🪙)`, false, coins < rod.cost, () => {
        if (coins < rod.cost) return;
        addCoins(-rod.cost);
        rodTier = i;
        highestRodTier = i;
        saveRodTier();
        saveHighestRodTier();
        applyToolVisibility();
        showCatchPopup(`${rod.name} equipped!`, false);
        renderEquipment();
      })];
    } else {
      status = `Upgrade to the ${ROD_TIERS[highestRodTier + 1].name} first.`;
      rodButtons = [makeShopBtn('Locked', true, true, () => {})];
    }
    equipmentListEl.appendChild(buildShopItemEl('🎣', rod.name, rod.desc, status, rodButtons));
  });
}

// ------------------------------------------------------------------
// Bank — Savings and Loans sub-tabs, laid out like the gambling tab: a big
// balance readout, an amount stepper, and action buttons. Interest on both
// is applied each time fish are sold at the dock (black market sales don't
// count). While a loan is unpaid, nothing can be deposited into savings.
// A loan that's been out for too many dock sales gets an on-screen warning;
// if it's still unpaid at the next dock sale after that, the police boat
// comes to collect what's owed plus a penalty — straight out of your coins,
// even if that takes you negative.
// ------------------------------------------------------------------
const SAVINGS_RATE = 0.20;        // savings earn 20% of each dock sale's total (only while there's something saved)
const LOAN_RATE = 0.10;           // +10% of the amount owed per dock sale
const LOAN_MAX = 500;             // most you can borrow at once
const LOAN_SALES_BEFORE_WARNING = 5; // dock sales a loan can sit unpaid before the warning
const LOAN_POLICE_PENALTY = 100;
const BANK_STEP_SMALL = 50;
const BANK_STEP_BIG = 100;

const BANK_KEY = 'sunsetFishing.bank';
const bank = {
  savings: 0,
  loanOwed: 0,
  loanSales: 0,       // dock sales since the loan was taken out
  loanWarned: false,
  loanPoliceCalled: false // true once the police have been sent — the debt is theirs to collect now
};
try {
  const saved = JSON.parse(localStorage.getItem(BANK_KEY) || 'null');
  if (saved) Object.assign(bank, saved);
} catch (e) { /* localStorage unavailable — bank state just won't persist */ }
function saveBank() { try { localStorage.setItem(BANK_KEY, JSON.stringify(bank)); } catch (e) {} }

const bankPanelEl = document.getElementById('bankPanel');
const bankButtonEl = document.getElementById('bankButton');
const loanWarningEl = document.getElementById('loanWarning');
const savingsTabBtnEl = document.getElementById('savingsTabBtn');
const loansTabBtnEl = document.getElementById('loansTabBtn');
const savingsViewEl = document.getElementById('savingsView');
const loansViewEl = document.getElementById('loansView');
const savingsBalanceEl = document.getElementById('savingsBalance');
const savingsStatusEl = document.getElementById('savingsStatus');
const savingsAmountEl = document.getElementById('savingsAmount');
const depositBtnEl = document.getElementById('depositBtn');
const withdrawBtnEl = document.getElementById('withdrawBtn');
const loanOwedEl = document.getElementById('loanOwed');
const loanStatusEl = document.getElementById('loanStatus');
const loanAmountEl = document.getElementById('loanAmount');
const loanActionBtnEl = document.getElementById('loanActionBtn');

let bankTab = 'savings';
let savingsAmount = BANK_STEP_SMALL;
let loanAmount = BANK_STEP_SMALL;

function hasLoan() { return bank.loanOwed > 0; }

// interest always moves by at least 1 coin on a non-empty balance, so small
// balances still visibly grow
function interestOn(amount, rate) {
  return amount > 0 ? Math.max(1, Math.round(amount * rate)) : 0;
}

function updateLoanWarningHUD() {
  const show = hasLoan() && bank.loanWarned;
  loanWarningEl.classList.toggle('show', show);
  if (!show) return;
  loanWarningEl.textContent = bank.loanPoliceCalled
    ? '🚓 The police are coming to collect your loan!'
    : `Loan overdue - Repay ${bank.loanOwed} 🪙`;
}

// called after every regular dock sale (not black market sales)
function onDockSaleForBank(saleTotal) {
  const savingsInterest = bank.savings > 0 ? interestOn(saleTotal, SAVINGS_RATE) : 0;
  bank.savings += savingsInterest;
  if (hasLoan() && !bank.loanPoliceCalled) {
    bank.loanOwed += interestOn(bank.loanOwed, LOAN_RATE);
    if (bank.loanWarned) {
      // the warning already went out and they sold again without paying —
      // send the police
      bank.loanPoliceCalled = true;
      callLoanPolice();
    } else {
      bank.loanSales++;
      if (bank.loanSales >= LOAN_SALES_BEFORE_WARNING) {
        bank.loanWarned = true;
        showCatchPopup('⚠️ Your loan is overdue!', true);
      }
    }
  }
  saveBank();
  if (savingsInterest > 0) progressChallenge('savingsInterest');
  updateLoanWarningHUD();
  if (openPanel === 'bank') renderBank();
}

// run by the police boat when it docks for a loan collection
function collectLoanByPolice() {
  if (!hasLoan()) return;
  const taken = bank.loanOwed + LOAN_POLICE_PENALTY;
  addCoins(-taken);
  clearLoan();
  setMessage(`Police boat! Collected ${taken} 🪙 for your unpaid loan.`);
  showCatchPopup(`Loan seized! -${taken} 🪙`, true);
}

function clearLoan() {
  bank.loanOwed = 0;
  bank.loanSales = 0;
  bank.loanWarned = false;
  bank.loanPoliceCalled = false;
  saveBank();
  updateLoanWarningHUD();
  if (openPanel === 'bank') renderBank();
}

// --- what each button would actually move, given the chosen amount ---
function depositAmount() { return hasLoan() ? 0 : Math.max(0, Math.min(savingsAmount, coins)); }
function withdrawAmount() { return Math.min(savingsAmount, bank.savings); }
function repayAmount() { return Math.max(0, Math.min(loanAmount, bank.loanOwed, coins)); }

// the stepper's ceiling — whatever the bigger of the two actions could use
function savingsAmountCap() { return Math.max(BANK_STEP_SMALL, coins, bank.savings); }
function loanAmountCap() { return hasLoan() ? Math.max(BANK_STEP_SMALL, bank.loanOwed) : LOAN_MAX; }

function depositSavings() {
  const amount = depositAmount();
  if (amount <= 0) return;
  addCoins(-amount);
  bank.savings += amount;
  saveBank();
  progressChallenge('bankDeposit', (ch) => amount >= ch.target);
  progressChallenge('savingsBalance', (ch) => bank.savings >= ch.target);
  renderBank();
}

function withdrawSavings() {
  const amount = withdrawAmount();
  if (amount <= 0) return;
  bank.savings -= amount;
  addCoins(amount);
  saveBank();
  renderBank();
}

function takeLoan() {
  if (hasLoan()) return;
  const amount = Math.min(loanAmount, LOAN_MAX);
  bank.loanOwed = amount;
  bank.loanSales = 0;
  bank.loanWarned = false;
  bank.loanPoliceCalled = false;
  addCoins(amount);
  saveBank();
  loanAmount = BANK_STEP_SMALL;
  renderBank();
}

function repayLoan() {
  if (!hasLoan() || bank.loanPoliceCalled) return;
  const amount = repayAmount();
  if (amount <= 0) return;
  addCoins(-amount);
  bank.loanOwed -= amount;
  if (bank.loanOwed <= 0) {
    clearLoan();
    progressChallenge('loanRepaid');
  } else {
    saveBank();
    updateLoanWarningHUD();
  }
  renderBank();
}

function renderSavings() {
  savingsAmount = THREE.MathUtils.clamp(savingsAmount, BANK_STEP_SMALL, savingsAmountCap());
  savingsBalanceEl.textContent = bank.savings;
  savingsAmountEl.textContent = savingsAmount;
  const locked = hasLoan();
  savingsStatusEl.textContent = locked ? '🔒 Deposits locked until your loan is repaid' : '';
  savingsStatusEl.classList.toggle('alert', locked);
  const dep = depositAmount();
  const wd = withdrawAmount();
  depositBtnEl.textContent = locked ? 'Deposit 🔒' : `Deposit (${dep} 🪙)`;
  depositBtnEl.disabled = dep <= 0;
  withdrawBtnEl.textContent = `Withdraw (${wd} 🪙)`;
  withdrawBtnEl.disabled = wd <= 0;
}

function renderLoans() {
  const loan = hasLoan();
  loanAmount = THREE.MathUtils.clamp(loanAmount, BANK_STEP_SMALL, loanAmountCap());
  loanOwedEl.textContent = bank.loanOwed;
  loanAmountEl.textContent = loanAmount;

  let status = '';
  let alert = false;
  if (!loan) {
    status = `Borrow up to ${LOAN_MAX} 🪙`;
  } else if (bank.loanPoliceCalled) {
    status = '🚓 The police are on their way to collect';
    alert = true;
  } else if (bank.loanWarned) {
    status = '⚠️ OVERDUE — repay before your next sale!';
    alert = true;
  } else {
    const left = LOAN_SALES_BEFORE_WARNING - bank.loanSales;
    status = `${left} sale${left === 1 ? '' : 's'} left before it's overdue`;
  }
  loanStatusEl.textContent = status;
  loanStatusEl.classList.toggle('alert', alert);

  if (!loan) {
    loanActionBtnEl.textContent = `Borrow (${loanAmount} 🪙)`;
    loanActionBtnEl.disabled = false;
  } else {
    const r = repayAmount();
    loanActionBtnEl.textContent = bank.loanPoliceCalled ? 'Repay 🔒' : `Repay (${r} 🪙)`;
    loanActionBtnEl.disabled = bank.loanPoliceCalled || r <= 0;
  }
}

function renderBank() {
  savingsTabBtnEl.classList.toggle('active', bankTab === 'savings');
  loansTabBtnEl.classList.toggle('active', bankTab === 'loans');
  savingsViewEl.style.display = bankTab === 'savings' ? 'flex' : 'none';
  loansViewEl.style.display = bankTab === 'loans' ? 'flex' : 'none';
  if (bankTab === 'savings') renderSavings();
  else renderLoans();
}
savingsTabBtnEl.addEventListener('click', () => { bankTab = 'savings'; renderBank(); });
loansTabBtnEl.addEventListener('click', () => { bankTab = 'loans'; renderBank(); });

[['savingsAmtDown100', -BANK_STEP_BIG], ['savingsAmtDown50', -BANK_STEP_SMALL],
 ['savingsAmtUp50', BANK_STEP_SMALL], ['savingsAmtUp100', BANK_STEP_BIG]].forEach(([id, step]) => {
  document.getElementById(id).addEventListener('click', () => { savingsAmount += step; renderSavings(); });
});
[['loanAmtDown100', -BANK_STEP_BIG], ['loanAmtDown50', -BANK_STEP_SMALL],
 ['loanAmtUp50', BANK_STEP_SMALL], ['loanAmtUp100', BANK_STEP_BIG]].forEach(([id, step]) => {
  document.getElementById(id).addEventListener('click', () => { loanAmount += step; renderLoans(); });
});
document.getElementById('savingsMax').addEventListener('click', () => { savingsAmount = savingsAmountCap(); renderSavings(); });
document.getElementById('loanMax').addEventListener('click', () => { loanAmount = loanAmountCap(); renderLoans(); });
depositBtnEl.addEventListener('click', depositSavings);
withdrawBtnEl.addEventListener('click', withdrawSavings);
loanActionBtnEl.addEventListener('click', () => { if (hasLoan()) repayLoan(); else takeLoan(); });

updateLoanWarningHUD();

// ------------------------------------------------------------------
// Hire — pay a fisherman to go out and bring back a haul of fish, restricted to
// his own rarity range. Higher-tier guys catch better fish but take longer.
// ------------------------------------------------------------------
const hirePanelEl = document.getElementById('hirePanel');
const hireListEl = document.getElementById('hireList');
const hireButtonEl = document.getElementById('hireButton');
// hidden by default — dev-only, flip on via the cheat menu
let hireTabUnlocked = false;
function updateHireTabVisibility() { hireButtonEl.classList.toggle('unavailable', !hireTabUnlocked); }

const HIRE_GUYS = [
  { id: 'dockhand', icon: '🎣', name: 'Dock Hand', cost: 150, tripSeconds: 40, catchCount: 18, rarities: ['Common', 'Uncommon'], shirt: 0x3f6b42, hat: 0xd8c98a, wideBrim: false, beard: false },
  { id: 'angler', icon: '🚣', name: 'Angler', cost: 340, tripSeconds: 65, catchCount: 30, rarities: ['Common', 'Uncommon', 'Rare'], shirt: 0xb5651d, hat: 0x2c5c8a, wideBrim: false, beard: false },
  { id: 'trawler', icon: '⚓', name: 'Trawler', cost: 680, tripSeconds: 100, catchCount: 24, rarities: ['Uncommon', 'Rare', 'Epic'], shirt: 0x6b2020, hat: 0x4a3624, wideBrim: true, beard: false },
  { id: 'oldsalt', icon: '🧔', name: 'Old Salt', cost: 1580, tripSeconds: 150, catchCount: 26, rarities: ['Rare', 'Epic', 'Legendary'], shirt: 0x1c2430, hat: 0x14171c, wideBrim: true, beard: true }
];

// noticeably better odds within their allowed range than the player gets fishing normally.
// Legendary is kept rare here on purpose — Old Salt's trips should pay off on Rare/Epic
// fish alone, with the Marlin as an occasional bonus rather than the expected outcome.
const HIRE_RARITY_WEIGHTS = { Common: 100, Uncommon: 50, Rare: 22, Epic: 10, Legendary: 0.1 };
function hirePickFish(guy) {
  const pool = FISH_SPECIES.filter((s) => guy.rarities.includes(s.rarity));
  return pickRarityThenSpecies(pool, HIRE_RARITY_WEIGHTS);
}

const HIRES_KEY = 'sunsetFishing.hires';
let hires = {}; // { [guyId]: epoch ms when the trip finishes }
try {
  hires = JSON.parse(localStorage.getItem(HIRES_KEY) || '{}');
} catch (e) { /* localStorage unavailable — hires just won't persist */ }
function saveHires() { try { localStorage.setItem(HIRES_KEY, JSON.stringify(hires)); } catch (e) {} }

function formatCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60), r = s % 60;
  return m + ':' + String(r).padStart(2, '0');
}

function renderHire() {
  hireListEl.innerHTML = '';
  HIRE_GUYS.forEach((guy) => {
    const until = hires[guy.id];
    let statusText, buttons;
    if (until) {
      const remaining = until - Date.now();
      statusText = remaining > 0 ? `Out fishing — back in ${formatCountdown(remaining)}` : 'Rowing back with the catch...';
      buttons = [makeShopBtn('Out', true, true, () => {})];
    } else {
      statusText = '';
      buttons = [makeShopBtn(`Hire (${guy.cost} 🪙)`, false, coins < guy.cost, () => {
        if (coins < guy.cost || hires[guy.id]) return;
        addCoins(-guy.cost);
        hires[guy.id] = Date.now() + guy.tripSeconds * 1000;
        saveHires();
        renderHire();
      })];
    }
    const desc = `Only catches ${guy.rarities.join('/')} fish. Brings back ${guy.catchCount}. Trip takes ${formatCountdown(guy.tripSeconds * 1000)}.`;
    hireListEl.appendChild(buildShopItemEl(guy.icon, guy.name, desc, statusText, buttons));
  });
}
setInterval(() => { if (openPanel === 'hire') renderHire(); }, 1000);

// ------------------------------------------------------------------
// Gambling — Slots and Blackjack, both fish-themed. Two sub-games sharing one panel.
// ------------------------------------------------------------------
const gamblingPanelEl = document.getElementById('gamblingPanel');
const gamblingButtonEl = document.getElementById('gamblingButton');
const slotsTabBtnEl = document.getElementById('slotsTabBtn');
const blackjackTabBtnEl = document.getElementById('blackjackTabBtn');
const predictTabBtnEl = document.getElementById('predictTabBtn');
const slotsViewEl = document.getElementById('slotsView');
const blackjackViewEl = document.getElementById('blackjackView');
const predictViewEl = document.getElementById('predictView');

let gamblingTab = 'slots';
function renderGambling() {
  slotsTabBtnEl.classList.toggle('active', gamblingTab === 'slots');
  blackjackTabBtnEl.classList.toggle('active', gamblingTab === 'blackjack');
  predictTabBtnEl.classList.toggle('active', gamblingTab === 'predict');
  slotsViewEl.style.display = gamblingTab === 'slots' ? 'flex' : 'none';
  blackjackViewEl.style.display = gamblingTab === 'blackjack' ? 'flex' : 'none';
  predictViewEl.style.display = gamblingTab === 'predict' ? 'flex' : 'none';
  if (gamblingTab === 'slots') renderSlots();
  else if (gamblingTab === 'blackjack') renderBlackjack();
  else renderPredict();
}
slotsTabBtnEl.addEventListener('click', () => { gamblingTab = 'slots'; renderGambling(); });
blackjackTabBtnEl.addEventListener('click', () => { gamblingTab = 'blackjack'; renderGambling(); });
predictTabBtnEl.addEventListener('click', () => { gamblingTab = 'predict'; renderGambling(); });

// --- Slots — fish-themed symbols, 3 reels ---
const SLOT_SYMBOLS = [
  { icon: '🐟', weight: 40, payout3: 2 },
  { icon: '🐠', weight: 25, payout3: 4 },
  { icon: '🐡', weight: 15, payout3: 8 },
  { icon: '🦈', weight: 10, payout3: 15 },
  { icon: '🐙', weight: 7, payout3: 25 },
  { icon: '🐋', weight: 3, payout3: 50 }
];
const SLOTS_BET_MIN = 50;
const SLOTS_BET_STEP_SMALL = 50;
const SLOTS_BET_STEP_BIG = 100;
// no fixed table limit on any of the gambling games — the most you can bet is
// whatever you've got (stepping up past your balance lands exactly on it, so
// going all-in is always reachable), never dropping below the game's minimum
function maxAffordableBet(minBet) {
  return Math.max(minBet, coins);
}
let slotsBet = 50;
let slotsSpinning = false;

const slotsReel1El = document.getElementById('slotsReel1');
const slotsReel2El = document.getElementById('slotsReel2');
const slotsReel3El = document.getElementById('slotsReel3');
const slotsMessageEl = document.getElementById('slotsMessage');
const slotsBetAmountEl = document.getElementById('slotsBetAmount');
const slotsBetDown100El = document.getElementById('slotsBetDown100');
const slotsBetDown50El = document.getElementById('slotsBetDown50');
const slotsBetUp50El = document.getElementById('slotsBetUp50');
const slotsBetUp100El = document.getElementById('slotsBetUp100');
const slotsAllInEl = document.getElementById('slotsAllIn');
const slotsSpinBtnEl = document.getElementById('slotsSpinBtn');

function pickSlotSymbol() {
  const total = SLOT_SYMBOLS.reduce((s, sym) => s + sym.weight, 0);
  let r = Math.random() * total;
  for (const sym of SLOT_SYMBOLS) {
    r -= sym.weight;
    if (r <= 0) return sym;
  }
  return SLOT_SYMBOLS[SLOT_SYMBOLS.length - 1];
}

function renderSlots() {
  slotsBetAmountEl.textContent = slotsBet;
  slotsSpinBtnEl.textContent = `Spin (${slotsBet} 🪙)`;
  slotsSpinBtnEl.disabled = slotsSpinning || coins < slotsBet;
  slotsBetDown100El.disabled = slotsSpinning;
  slotsBetDown50El.disabled = slotsSpinning;
  slotsBetUp50El.disabled = slotsSpinning;
  slotsBetUp100El.disabled = slotsSpinning;
  slotsAllInEl.disabled = slotsSpinning || coins < SLOTS_BET_MIN;
}

slotsBetDown100El.addEventListener('click', () => {
  slotsBet = Math.max(SLOTS_BET_MIN, slotsBet - SLOTS_BET_STEP_BIG);
  renderSlots();
});
slotsBetDown50El.addEventListener('click', () => {
  slotsBet = Math.max(SLOTS_BET_MIN, slotsBet - SLOTS_BET_STEP_SMALL);
  renderSlots();
});
slotsBetUp50El.addEventListener('click', () => {
  slotsBet = Math.min(maxAffordableBet(SLOTS_BET_MIN), slotsBet + SLOTS_BET_STEP_SMALL);
  renderSlots();
});
slotsBetUp100El.addEventListener('click', () => {
  slotsBet = Math.min(maxAffordableBet(SLOTS_BET_MIN), slotsBet + SLOTS_BET_STEP_BIG);
  renderSlots();
});
slotsAllInEl.addEventListener('click', () => {
  slotsBet = maxAffordableBet(SLOTS_BET_MIN);
  renderSlots();
});

function settleSlots(results) {
  slotsSpinning = false;
  const [a, b, c] = results;
  if (a.icon === b.icon && b.icon === c.icon) {
    const win = slotsBet * a.payout3;
    addCoins(win);
    slotsMessageEl.textContent = `Jackpot! Three ${a.icon} — you win ${win} 🪙!`;
    progressChallenge('gamblingWin');
  } else if (a.icon === b.icon || b.icon === c.icon || a.icon === c.icon) {
    const halfBack = Math.round(slotsBet / 2);
    addCoins(halfBack);
    slotsMessageEl.textContent = `Two match — you get ${halfBack} 🪙 back.`;
  } else {
    slotsMessageEl.textContent = 'No match. Try again!';
  }
  renderSlots();
}

slotsSpinBtnEl.addEventListener('click', () => {
  if (slotsSpinning || coins < slotsBet) return;
  addCoins(-slotsBet);
  slotsSpinning = true;
  slotsMessageEl.textContent = '';
  renderSlots();
  const results = [pickSlotSymbol(), pickSlotSymbol(), pickSlotSymbol()];
  const reelEls = [slotsReel1El, slotsReel2El, slotsReel3El];
  reelEls.forEach((el, i) => {
    let ticks = 0;
    const maxTicks = 10 + i * 6;
    const iv = setInterval(() => {
      el.textContent = SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)].icon;
      ticks++;
      if (ticks >= maxTicks) {
        clearInterval(iv);
        el.textContent = results[i].icon;
        if (i === 2) settleSlots(results);
      }
    }, 60);
  });
});

// --- Blackjack — standard rules, fish-themed suits instead of hearts/clubs/etc ---
const BJ_SUITS = [
  { symbol: '🐟', dark: true },
  { symbol: '🦈', dark: true },
  { symbol: '🐠', dark: false },
  { symbol: '🐡', dark: false }
];
const BJ_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const BJ_BET_MIN = 50;
const BJ_BET_STEP_SMALL = 50;
const BJ_BET_STEP_BIG = 100;

const bjDealerRowEl = document.getElementById('bjDealerRow');
const bjDealerScoreEl = document.getElementById('bjDealerScore');
const bjPlayerRowEl = document.getElementById('bjPlayerRow');
const bjPlayerScoreEl = document.getElementById('bjPlayerScore');
const bjMessageEl = document.getElementById('bjMessage');
const bjBetControlsEl = document.getElementById('bjBetControls');
const bjActionControlsEl = document.getElementById('bjActionControls');
const bjBetAmountEl = document.getElementById('bjBetAmount');
const bjBetDown100El = document.getElementById('bjBetDown100');
const bjBetDown50El = document.getElementById('bjBetDown50');
const bjBetUp50El = document.getElementById('bjBetUp50');
const bjBetUp100El = document.getElementById('bjBetUp100');
const bjAllInEl = document.getElementById('bjAllIn');
const bjDealBtnEl = document.getElementById('bjDealBtn');
const bjHitBtnEl = document.getElementById('bjHitBtn');
const bjStandBtnEl = document.getElementById('bjStandBtn');

const bjState = {
  phase: 'betting', // betting | playing | result
  deck: [],
  playerHand: [],
  dealerHand: [],
  bet: 50,
  message: ''
};

function bjBuildDeck() {
  const deck = [];
  for (let s = 0; s < BJ_SUITS.length; s++) {
    for (const r of BJ_RANKS) deck.push({ rank: r, suit: s });
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
function bjCardValue(card) {
  if (card.rank === 'A') return 11;
  if (card.rank === 'J' || card.rank === 'Q' || card.rank === 'K') return 10;
  return parseInt(card.rank, 10);
}
function bjHandScore(hand) {
  let total = hand.reduce((s, c) => s + bjCardValue(c), 0);
  let aces = hand.filter((c) => c.rank === 'A').length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}
function bjIsBlackjack(hand) { return hand.length === 2 && bjHandScore(hand) === 21; }

function bjRenderHand(containerEl, hand, hideFirst) {
  containerEl.innerHTML = '';
  hand.forEach((card, i) => {
    const cardEl = document.createElement('div');
    if (hideFirst && i === 0) {
      cardEl.className = 'bj-card bj-card-back';
      cardEl.textContent = '🎣';
    } else {
      const suit = BJ_SUITS[card.suit];
      cardEl.className = 'bj-card ' + (suit.dark ? 'bj-dark' : 'bj-bright');
      cardEl.innerHTML = `<div class="bj-rank">${card.rank}</div><div class="bj-suit">${suit.symbol}</div>`;
    }
    containerEl.appendChild(cardEl);
  });
}

function renderBlackjack() {
  const hideDealer = bjState.phase === 'playing';
  bjRenderHand(bjDealerRowEl, bjState.dealerHand, hideDealer);
  bjRenderHand(bjPlayerRowEl, bjState.playerHand, false);
  bjPlayerScoreEl.textContent = bjState.playerHand.length ? 'Score: ' + bjHandScore(bjState.playerHand) : '';
  bjDealerScoreEl.textContent = bjState.dealerHand.length ? (hideDealer ? 'Score: ?' : 'Score: ' + bjHandScore(bjState.dealerHand)) : '';
  bjMessageEl.textContent = bjState.message;
  bjBetAmountEl.textContent = bjState.bet;

  const betting = bjState.phase === 'betting' || bjState.phase === 'result';
  bjBetControlsEl.style.display = betting ? 'flex' : 'none';
  bjActionControlsEl.style.display = bjState.phase === 'playing' ? 'flex' : 'none';
  bjDealBtnEl.style.display = betting ? 'block' : 'none';
  bjDealBtnEl.textContent = bjState.phase === 'result' ? `Deal again (${bjState.bet} 🪙)` : `Deal (${bjState.bet} 🪙)`;
  bjDealBtnEl.disabled = coins < bjState.bet;
  bjBetDown100El.disabled = !betting;
  bjBetDown50El.disabled = !betting;
  bjBetUp50El.disabled = !betting;
  bjBetUp100El.disabled = !betting;
  bjAllInEl.disabled = !betting || coins < BJ_BET_MIN;
}

bjBetDown100El.addEventListener('click', () => {
  bjState.bet = Math.max(BJ_BET_MIN, bjState.bet - BJ_BET_STEP_BIG);
  renderBlackjack();
});
bjBetDown50El.addEventListener('click', () => {
  bjState.bet = Math.max(BJ_BET_MIN, bjState.bet - BJ_BET_STEP_SMALL);
  renderBlackjack();
});
bjBetUp50El.addEventListener('click', () => {
  bjState.bet = Math.min(maxAffordableBet(BJ_BET_MIN), bjState.bet + BJ_BET_STEP_SMALL);
  renderBlackjack();
});
bjBetUp100El.addEventListener('click', () => {
  bjState.bet = Math.min(maxAffordableBet(BJ_BET_MIN), bjState.bet + BJ_BET_STEP_BIG);
  renderBlackjack();
});
bjAllInEl.addEventListener('click', () => {
  bjState.bet = maxAffordableBet(BJ_BET_MIN);
  renderBlackjack();
});

function bjDealerPlayAndSettle(playerHadBlackjack) {
  while (bjHandScore(bjState.dealerHand) < 17) bjState.dealerHand.push(bjState.deck.pop());
  const playerScore = bjHandScore(bjState.playerHand);
  const dealerScore = bjHandScore(bjState.dealerHand);
  const dealerBJ = bjIsBlackjack(bjState.dealerHand);
  let outcome;
  if (playerHadBlackjack && dealerBJ) outcome = 'push';
  else if (playerHadBlackjack) outcome = 'blackjack';
  else if (dealerScore > 21) outcome = 'win';
  else if (playerScore > dealerScore) outcome = 'win';
  else if (playerScore === dealerScore) outcome = 'push';
  else outcome = 'lose';

  if (outcome === 'blackjack') {
    addCoins(Math.round(bjState.bet * 2.5));
    bjState.message = `Blackjack! You win ${Math.round(bjState.bet * 1.5)} 🪙!`;
    progressChallenge('gamblingWin');
  } else if (outcome === 'win') {
    addCoins(bjState.bet * 2);
    bjState.message = `You win ${bjState.bet} 🪙!`;
    progressChallenge('gamblingWin');
  } else if (outcome === 'push') {
    addCoins(bjState.bet);
    bjState.message = 'Push — bet returned.';
  } else {
    bjState.message = 'Dealer wins.';
  }
  bjState.phase = 'result';
  renderBlackjack();
}

bjDealBtnEl.addEventListener('click', () => {
  if (coins < bjState.bet) return;
  addCoins(-bjState.bet);
  bjState.deck = bjBuildDeck();
  bjState.playerHand = [bjState.deck.pop(), bjState.deck.pop()];
  bjState.dealerHand = [bjState.deck.pop(), bjState.deck.pop()];
  bjState.phase = 'playing';
  bjState.message = '';
  if (bjIsBlackjack(bjState.playerHand)) {
    bjDealerPlayAndSettle(true);
  } else {
    renderBlackjack();
  }
});

bjHitBtnEl.addEventListener('click', () => {
  if (bjState.phase !== 'playing') return;
  bjState.playerHand.push(bjState.deck.pop());
  if (bjHandScore(bjState.playerHand) > 21) {
    bjState.phase = 'result';
    bjState.message = 'Bust! You lose.';
  }
  renderBlackjack();
});

bjStandBtnEl.addEventListener('click', () => {
  if (bjState.phase !== 'playing') return;
  bjDealerPlayAndSettle(false);
});

// ------------------------------------------------------------------
// Next Catch — a third gambling game: bet on the exact species of your next
// rod-caught fish. One dropdown per rarity you've actually unlocked, listing
// only species you've already caught (you have to have seen it to call it).
// Payout is the real fair-odds multiplier for that exact species (1 / its
// true catch probability) — rarer species pay dramatically more, since a
// correct call on them is dramatically less likely. Landing the right
// rarity but the wrong species still pays a 10% consolation.
// ------------------------------------------------------------------
const PREDICT_BET_MIN = 50, PREDICT_BET_STEP_SMALL = 50, PREDICT_BET_STEP_BIG = 100;
const PREDICT_CONSOLATION_RATE = 0.10;
const RARITY_TOTAL_WEIGHT = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
function rarityProbability(rarity) { return RARITY_WEIGHTS[rarity] / RARITY_TOTAL_WEIGHT; }
function speciesProbability(sp) {
  const tierCount = ROD_FISH_SPECIES.filter((s) => s.rarity === sp.rarity).length;
  return rarityProbability(sp.rarity) / tierCount;
}

const predictDropdownsEl = document.getElementById('predictDropdowns');
const predictInfoEl = document.getElementById('predictInfo');
const predictBetAmountEl = document.getElementById('predictBetAmount');
const predictBetDown100El = document.getElementById('predictBetDown100');
const predictBetDown50El = document.getElementById('predictBetDown50');
const predictBetUp50El = document.getElementById('predictBetUp50');
const predictBetUp100El = document.getElementById('predictBetUp100');
const predictAllInEl = document.getElementById('predictAllIn');
const predictPlaceBtnEl = document.getElementById('predictPlaceBtn');

let predictBet = 50;
let predictTargetName = null;
let predictPending = false;

function renderPredict() {
  predictBetAmountEl.textContent = predictBet;
  [predictBetDown100El, predictBetDown50El, predictBetUp50El, predictBetUp100El].forEach((b) => b.disabled = predictPending);
  predictAllInEl.disabled = predictPending || coins < PREDICT_BET_MIN;

  if (predictPending) {
    predictDropdownsEl.innerHTML = '';
    const sp = FISH_SPECIES.find((s) => s.name === predictTargetName);
    predictInfoEl.textContent = `Bet placed on ${sp.name} (${sp.rarity}) — waiting for your next catch...`;
    predictPlaceBtnEl.textContent = 'Waiting for a catch...';
    predictPlaceBtnEl.disabled = true;
    return;
  }

  predictDropdownsEl.innerHTML = '';
  let anyUnlocked = false;
  RARITY_ORDER.forEach((rarity) => {
    const species = ROD_FISH_SPECIES.filter((s) => s.rarity === rarity && caughtNames.has(s.name));
    if (!species.length) return;
    anyUnlocked = true;
    const select = document.createElement('select');
    select.className = 'predict-select';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    const rarityMult = Math.max(1, Math.round(1 / (rarityProbability(rarity) / species.length)));
    placeholder.textContent = `-- ${rarity} (up to ~${rarityMult}x) --`;
    select.appendChild(placeholder);
    species.forEach((sp) => {
      const opt = document.createElement('option');
      opt.value = sp.name;
      opt.textContent = sp.name;
      if (sp.name === predictTargetName) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', () => {
      if (!select.value) return;
      predictTargetName = select.value;
      renderPredict();
    });
    predictDropdownsEl.appendChild(select);
  });

  if (!anyUnlocked) {
    predictInfoEl.textContent = 'Catch a few fish first — you can only bet on species you’ve already caught.';
  } else if (predictTargetName) {
    const sp = FISH_SPECIES.find((s) => s.name === predictTargetName);
    const mult = Math.max(1, Math.round(1 / speciesProbability(sp)));
    predictInfoEl.textContent = `${sp.name} (${sp.rarity}) — exact match pays ${mult}x, same rarity pays 10% back.`;
  } else {
    predictInfoEl.textContent = 'Pick a fish to bet on.';
  }

  predictPlaceBtnEl.textContent = `Place Bet (${predictBet} 🪙)`;
  predictPlaceBtnEl.disabled = !predictTargetName || coins < predictBet;
}

predictBetDown100El.addEventListener('click', () => { predictBet = Math.max(PREDICT_BET_MIN, predictBet - PREDICT_BET_STEP_BIG); renderPredict(); });
predictBetDown50El.addEventListener('click', () => { predictBet = Math.max(PREDICT_BET_MIN, predictBet - PREDICT_BET_STEP_SMALL); renderPredict(); });
predictBetUp50El.addEventListener('click', () => { predictBet = Math.min(maxAffordableBet(PREDICT_BET_MIN), predictBet + PREDICT_BET_STEP_SMALL); renderPredict(); });
predictBetUp100El.addEventListener('click', () => { predictBet = Math.min(maxAffordableBet(PREDICT_BET_MIN), predictBet + PREDICT_BET_STEP_BIG); renderPredict(); });
predictAllInEl.addEventListener('click', () => { predictBet = maxAffordableBet(PREDICT_BET_MIN); renderPredict(); });

predictPlaceBtnEl.addEventListener('click', () => {
  if (predictPending || !predictTargetName || coins < predictBet) return;
  addCoins(-predictBet);
  predictPending = true;
  renderPredict();
});

// called from finishReel() the moment a real fish (not junk) lands
function resolvePredictBet(catchEntry) {
  if (!predictPending) return;
  const target = FISH_SPECIES.find((s) => s.name === predictTargetName);
  if (catchEntry.name === target.name) {
    const payout = Math.round(predictBet * Math.max(1, 1 / speciesProbability(target)));
    addCoins(payout);
    showCatchPopup(`Bet won! ${target.name} — +${payout} 🪙`, false);
  } else if (catchEntry.rarity === target.rarity) {
    const payout = Math.round(predictBet * PREDICT_CONSOLATION_RATE);
    addCoins(payout);
    showCatchPopup(`Close bet — same rarity, +${payout} 🪙`, false);
  } else {
    showCatchPopup('Bet lost — wrong catch', true);
  }
  predictPending = false;
  if (openPanel === 'gambling' && gamblingTab === 'predict') renderPredict();
}

// called from finishReel() when the fish slips off the line — losing the
// fight means the bet never gets a catch to check against, so it's an
// automatic loss rather than staying pending for the next attempt
function failPredictBet() {
  if (!predictPending) return;
  predictPending = false;
  showCatchPopup('Bet lost — it got away', true);
  if (openPanel === 'gambling' && gamblingTab === 'predict') renderPredict();
}

// ------------------------------------------------------------------
// Challenges — pay to enter a timed goal, win double your entry. Completing
// 3 of them unlocks the Gambling tab.
// ------------------------------------------------------------------
const challengesPanelEl = document.getElementById('challengesPanel');
const challengesButtonEl = document.getElementById('challengesButton');
const challengesListEl = document.getElementById('challengesList');
const challengeTimerEl = document.getElementById('challengeTimer');

function updateChallengeHudTimer() {
  if (!challengeState.activeId) {
    challengeTimerEl.classList.remove('show');
    return;
  }
  const ch = CHALLENGES.find((c) => c.id === challengeState.activeId);
  if (!ch) {
    challengeTimerEl.classList.remove('show');
    return;
  }
  const remaining = Math.max(0, ch.duration - (clockT - challengeState.startedAt));
  challengeTimerEl.textContent = `⏱ ${ch.name}: ${Math.ceil(remaining)}s`;
  challengeTimerEl.classList.add('show');
}

const RARITY_ORDER = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'];
const GAMBLING_UNLOCK_COUNT = 3;
let challengesCompletedCount = 0;
let completedChallengeIds = new Set(); // which distinct challenges have been completed at least once — gates the Legendary Rod

// reward is explicit per challenge now (used to just be cost*2) — a flat 2x
// made no sense once you work out the odds: something like Legend Hunt has a
// single-digit percent chance of ever seeing a Legendary in the window, so a
// flat double-up was a bad bet even though it "paid out." Rewards below are
// sized so every challenge is a clearly good bet at its actual hit rate, not
// just the easy ones.
const CHALLENGES = [
  { id: 'c1', name: 'Quick Catch', desc: 'Catch 3 fish in 60 seconds.', cost: 10, reward: 20, duration: 60, type: 'catchCount', target: 3 },
  { id: 'c2', name: 'Junk Run', desc: 'Catch 2 pieces of junk in 45 seconds.', cost: 10, reward: 25, duration: 45, type: 'junkCount', target: 2 },
  { id: 'c3', name: 'Steady Hands', desc: 'Catch 5 fish in 60 seconds.', cost: 15, reward: 30, duration: 60, type: 'catchCount', target: 5 },
  { id: 'c4', name: 'Step Up', desc: 'Catch an Uncommon fish or better in 30 seconds.', cost: 15, reward: 30, duration: 30, type: 'rarityAtLeast', target: 'Uncommon' },
  { id: 'c5', name: 'Heavy Haul', desc: 'Catch a fish weighing 5 lb or more in 45 seconds.', cost: 20, reward: 40, duration: 45, type: 'weightAtLeast', target: 5 },
  { id: 'c6', name: 'Rare Find', desc: 'Catch a Rare fish or better in 45 seconds.', cost: 25, reward: 50, duration: 45, type: 'rarityAtLeast', target: 'Rare' },
  { id: 'c7', name: 'Marathon', desc: 'Catch 8 fish in 90 seconds.', cost: 25, reward: 50, duration: 90, type: 'catchCount', target: 8 },
  { id: 'c8', name: 'Variety Pack', desc: 'Catch 3 different fish species in 60 seconds.', cost: 30, reward: 60, duration: 60, type: 'speciesCount', target: 3 },
  { id: 'c9', name: 'Epic Rush', desc: 'Catch an Epic fish or better in 75 seconds.', cost: 35, reward: 140, duration: 75, type: 'rarityAtLeast', target: 'Epic' },
  { id: 'c10', name: 'Legend Hunt', desc: 'Catch a Legendary fish in 2 minutes.', cost: 50, reward: 700, duration: 120, type: 'rarityAtLeast', target: 'Legendary' },
  { id: 'c11', name: 'Net Novice', desc: 'Land a net swoop on a school in 45 seconds.', cost: 15, reward: 35, duration: 45, type: 'netSwoopCount', target: 1 },
  { id: 'c12', name: 'Net Master', desc: 'Land 3 net swoops in 2 minutes.', cost: 30, reward: 90, duration: 120, type: 'netSwoopCount', target: 3 },
  { id: 'c13', name: 'Well Fed', desc: 'Catch a fish while Fish Food is active, in 60 seconds.', cost: 10, reward: 20, duration: 60, type: 'fedCatch' },
  { id: 'c14', name: 'Golden Touch', desc: 'Catch a fish while Golden Fish Food is active, in 90 seconds.', cost: 40, reward: 150, duration: 90, type: 'goldenFoodCatch' },
  { id: 'c15', name: 'Rainy Day Fund', desc: 'Deposit 50 🪙 or more into Savings at once, in 30 seconds.', cost: 5, reward: 12, duration: 30, type: 'bankDeposit', target: 50 },
  { id: 'c16', name: 'Compound Interest', desc: 'Earn interest on your Savings by selling fish at the dock, in 90 seconds.', cost: 20, reward: 50, duration: 90, type: 'savingsInterest' },
  { id: 'c17', name: 'Nest Egg', desc: 'Have 300 🪙 or more in Savings at once, in 90 seconds.', cost: 25, reward: 60, duration: 90, type: 'savingsBalance', target: 300 },
  { id: 'c18', name: 'Top-Tier Angler', desc: 'Catch a fish using the Carbon Rod, in 30 seconds.', cost: 20, reward: 45, duration: 30, type: 'topRodCatch' },
  { id: 'c19', name: 'Clean Slate', desc: 'Pay off a bank Loan in full, in 90 seconds.', cost: 15, reward: 40, duration: 90, type: 'loanRepaid' },
  { id: 'c20', name: 'High Roller', desc: 'Win a hand of Blackjack or hit the Slots jackpot, in 60 seconds.', cost: 20, reward: 50, duration: 60, type: 'gamblingWin' }
];

const challengeState = {
  activeId: null,
  startedAt: 0,
  progressCount: 0,
  speciesSeen: new Set()
};

function isGamblingUnlocked() { return challengesCompletedCount >= GAMBLING_UNLOCK_COUNT; }
function updateGamblingLockUI() {
  const unlocked = isGamblingUnlocked();
  gamblingButtonEl.classList.toggle('locked', !unlocked);
  gamblingButtonEl.querySelector('span').textContent = unlocked ? '🎰' : '🔒';
}

// count-based types track toward ch.target; everything else completes the
// instant its condition is met, so its target count is just 1
function challengeTargetCount(ch) {
  const counted = ['catchCount', 'junkCount', 'speciesCount', 'netSwoopCount'];
  return counted.includes(ch.type) ? ch.target : 1;
}

// only 10 of the 20 challenges are shown at once — a slot gets swapped for a
// fresh (currently hidden) challenge whenever its occupant is completed or failed
function shuffledIds(list) {
  const ids = list.map((c) => c.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}
let visibleChallengeIds = shuffledIds(CHALLENGES).slice(0, 10);
// completed challenges never come back, so the pool only ever shrinks toward
// zero — a clear countdown to unlocking the Legendary Rod. Failing one just
// swaps in a different uncompleted challenge (or leaves it be if there's
// nothing else left to offer); only completing one can shrink the list.
function swapChallenge(oldId, allowShrink) {
  const idx = visibleChallengeIds.indexOf(oldId);
  if (idx === -1) return;
  const hiddenIds = CHALLENGES.map((c) => c.id)
    .filter((id) => !visibleChallengeIds.includes(id) && !completedChallengeIds.has(id));
  if (hiddenIds.length) {
    visibleChallengeIds[idx] = hiddenIds[Math.floor(Math.random() * hiddenIds.length)];
  } else if (allowShrink) {
    visibleChallengeIds.splice(idx, 1);
  }
}

function enterChallenge(ch) {
  if (challengeState.activeId || coins < ch.cost) return;
  addCoins(-ch.cost);
  challengeState.activeId = ch.id;
  challengeState.startedAt = clockT;
  challengeState.progressCount = 0;
  challengeState.speciesSeen = new Set();
  closeEverything();
  showCatchPopup(`Challenge started: ${ch.name}!`, false);
  updateChallengeHudTimer();
}

function completeChallenge(ch) {
  const reward = ch.reward;
  addCoins(reward);
  challengesCompletedCount++;
  completedChallengeIds.add(ch.id);
  challengeState.activeId = null;
  showCatchPopup(`Challenge complete! +${reward} 🪙`, false);
  updateGamblingLockUI();
  swapChallenge(ch.id, true);
  updateChallengeHudTimer();
  if (openPanel === 'challenges') renderChallenges();
}

function failChallenge(ch) {
  challengeState.activeId = null;
  showCatchPopup(`Challenge failed: ${ch.name}`, true);
  swapChallenge(ch.id);
  updateChallengeHudTimer();
  if (openPanel === 'challenges') renderChallenges();
}

// generic hook for challenge types that progress from a single event elsewhere
// in the game (a net swoop, a bank deposit, a gambling win) rather than
// from the rod's catch-completion code below
function progressChallenge(type, predicate) {
  if (!challengeState.activeId) return;
  const ch = CHALLENGES.find((c) => c.id === challengeState.activeId);
  if (!ch || ch.type !== type) return;
  if (predicate && !predicate(ch)) return;
  challengeState.progressCount++;
  if (challengeState.progressCount >= challengeTargetCount(ch)) completeChallenge(ch);
  else if (openPanel === 'challenges') renderChallenges();
}

// called from the catch-completion code right after a fish or piece of junk lands
function registerChallengeCatch(entry, weight) {
  if (!challengeState.activeId) return;
  const ch = CHALLENGES.find((c) => c.id === challengeState.activeId);
  if (!ch) return;
  if (entry.type === 'fish') {
    if (ch.type === 'catchCount') {
      challengeState.progressCount++;
    } else if (ch.type === 'rarityAtLeast') {
      if (RARITY_ORDER.indexOf(entry.rarity) >= RARITY_ORDER.indexOf(ch.target)) challengeState.progressCount = 1;
    } else if (ch.type === 'weightAtLeast') {
      if (weight != null && weight >= ch.target) challengeState.progressCount = 1;
    } else if (ch.type === 'speciesCount') {
      challengeState.speciesSeen.add(entry.name);
      challengeState.progressCount = challengeState.speciesSeen.size;
    } else if (ch.type === 'fedCatch') {
      if (state.currentCatchFedTierIds.length) challengeState.progressCount = 1;
    } else if (ch.type === 'goldenFoodCatch') {
      if (state.currentCatchFedTierIds.includes('golden')) challengeState.progressCount = 1;
    } else if (ch.type === 'topRodCatch') {
      if (ROD_TIERS[rodTier].id === 'carbon') challengeState.progressCount = 1;
    }
  } else if (entry.type === 'junk') {
    if (ch.type === 'junkCount') challengeState.progressCount++;
  }
  if (challengeState.progressCount >= challengeTargetCount(ch)) completeChallenge(ch);
  else if (openPanel === 'challenges') renderChallenges();
}

// checked every frame (cheap) — the visible countdown itself only re-renders on a slow tick
function updateChallenges() {
  if (!challengeState.activeId) return;
  const ch = CHALLENGES.find((c) => c.id === challengeState.activeId);
  if (!ch) { challengeState.activeId = null; return; }
  if (clockT - challengeState.startedAt >= ch.duration) {
    failChallenge(ch);
    return;
  }
  updateChallengeHudTimer();
}
// only the active challenge's countdown text needs to tick every second — rebuilding
// the whole list on every tick was fighting the browser's scroll position, so a full
// renderChallenges() now only happens on real state changes (enter/complete/fail/give up)
let activeChallengeStatusEl = null;
function tickActiveChallengeCountdown() {
  if (!challengeState.activeId || !activeChallengeStatusEl) return;
  const ch = CHALLENGES.find((c) => c.id === challengeState.activeId);
  if (!ch) return;
  const remaining = Math.max(0, ch.duration - (clockT - challengeState.startedAt));
  const targetCount = challengeTargetCount(ch);
  activeChallengeStatusEl.textContent = `${Math.min(challengeState.progressCount, targetCount)}/${targetCount} — ${Math.ceil(remaining)}s left`;
}
setInterval(() => { if (openPanel === 'challenges') tickActiveChallengeCountdown(); }, 1000);

function renderChallenges() {
  challengesListEl.innerHTML = '';
  activeChallengeStatusEl = null;
  visibleChallengeIds.map((id) => CHALLENGES.find((c) => c.id === id)).forEach((ch) => {
    if (!ch) return;
    const isActive = challengeState.activeId === ch.id;
    let statusText, buttons;
    if (isActive) {
      const remaining = Math.max(0, ch.duration - (clockT - challengeState.startedAt));
      const targetCount = challengeTargetCount(ch);
      statusText = `${Math.min(challengeState.progressCount, targetCount)}/${targetCount} — ${Math.ceil(remaining)}s left`;
      buttons = [makeShopBtn('Give up', true, false, () => failChallenge(ch))];
    } else {
      statusText = '';
      buttons = [makeShopBtn(`Enter (${ch.cost} 🪙)`, false, !!challengeState.activeId || coins < ch.cost, () => enterChallenge(ch))];
    }
    const itemEl = buildShopItemEl('🎯', ch.name, ch.desc + ` Pays ${ch.reward} 🪙.`, statusText, buttons);
    if (isActive) activeChallengeStatusEl = itemEl.querySelector('.shop-item-status');
    challengesListEl.appendChild(itemEl);
  });
}

function renderCatalog() {
  catalogGridEl.innerHTML = '';
  let unlocked = 0;
  CATALOG.forEach((entry) => {
    const isUnlocked = caughtNames.has(entry.name);
    if (isUnlocked) unlocked++;
    const slot = document.createElement('div');
    slot.className = 'catalog-slot' + (isUnlocked ? '' : ' locked') + (entry.type === 'junk' ? ' junk' : '');
    const icon = document.createElement('div');
    icon.className = 'catalog-icon';
    const img = document.createElement('img');
    img.src = getEntryIcon(entry, !isUnlocked);
    icon.appendChild(img);
    const label = document.createElement('div');
    label.className = 'catalog-name';
    label.textContent = isUnlocked ? (entry.short || entry.name) : '???';
    slot.appendChild(icon);
    slot.appendChild(label);
    if (isUnlocked) {
      const rarity = document.createElement('div');
      rarity.className = 'catalog-rarity';
      rarity.textContent = entry.rarity;
      rarity.style.color = RARITY_COLORS[entry.rarity];
      slot.appendChild(rarity);
    }
    catalogGridEl.appendChild(slot);
  });
  catalogProgressEl.textContent = `${unlocked} / ${CATALOG.length}`;
}

// menuStack (the little fan of feature buttons) and the panels it opens are
// separate layers so more buttons/panels can be added to the stack later
// a registry of stack panels so adding another button later is just one more entry here
const PANELS = {
  catalog: { el: catalogPanelEl, render: renderCatalog },
  log: { el: logPanelEl, render: renderLog },
  sell: { el: sellPanelEl, render: renderSell },
  food: { el: foodPanelEl, render: renderFood },
  equipment: { el: equipmentPanelEl, render: renderEquipment },
  bank: { el: bankPanelEl, render: renderBank },
  hire: { el: hirePanelEl, render: renderHire },
  gambling: { el: gamblingPanelEl, render: renderGambling },
  challenges: { el: challengesPanelEl, render: renderChallenges },
  blackmarket: { el: blackMarketPanelEl, render: () => setBlackMarketTab(blackMarketTab) }
};
let stackOpen = false;
let openPanel = null; // null or one of the PANELS keys
function updateBackdrop() {
  menuBackdropEl.classList.toggle('open', stackOpen || !!openPanel || bottleNoteOpen || manualOpen);
}
function setStackOpen(open) {
  stackOpen = open;
  menuButtonEl.classList.toggle('active', open);
  menuStackEl.classList.toggle('open', open);
  updateBackdrop();
}
function setOpenPanel(name) {
  Object.keys(PANELS).forEach((key) => PANELS[key].el.classList.toggle('open', key === name));
  openPanel = name;
  updateBackdrop();
  if (name) PANELS[name].render();
}
function closeEverything() {
  setStackOpen(false);
  setOpenPanel(null);
  closeManual();
}
menuButtonEl.addEventListener('click', (e) => {
  e.stopPropagation();
  if (bottleNoteOpen) return;
  const wasStackOpen = stackOpen;
  closeEverything();
  setStackOpen(!wasStackOpen);
});
indexButtonEl.addEventListener('click', (e) => { e.stopPropagation(); closeEverything(); setOpenPanel('catalog'); });
logButtonEl.addEventListener('click', (e) => { e.stopPropagation(); closeEverything(); setOpenPanel('log'); });
sellButtonToggleEl.addEventListener('click', (e) => { e.stopPropagation(); closeEverything(); setOpenPanel('sell'); });
foodButtonEl.addEventListener('click', (e) => { e.stopPropagation(); closeEverything(); setOpenPanel('food'); });
equipmentButtonEl.addEventListener('click', (e) => { e.stopPropagation(); closeEverything(); setOpenPanel('equipment'); });
bankButtonEl.addEventListener('click', (e) => { e.stopPropagation(); closeEverything(); setOpenPanel('bank'); });
hireButtonEl.addEventListener('click', (e) => { e.stopPropagation(); closeEverything(); setOpenPanel('hire'); });
gamblingButtonEl.addEventListener('click', (e) => {
  e.stopPropagation();
  closeEverything();
  if (!isGamblingUnlocked()) return;
  setOpenPanel('gambling');
});
challengesButtonEl.addEventListener('click', (e) => { e.stopPropagation(); closeEverything(); setOpenPanel('challenges'); });
blackMarketButtonEl.addEventListener('click', (e) => { e.stopPropagation(); closeEverything(); setOpenPanel('blackmarket'); });
menuBackdropEl.addEventListener('click', () => closeEverything());

updateCoinsHUD();
updateGamblingLockUI();

// the model shown hooked on the line when something is landed — rebuilt per catch
const caughtItem = new THREE.Group();
caughtItem.visible = false;
scene.add(caughtItem);
function setCaughtItem(entry) {
  while (caughtItem.children.length) caughtItem.remove(caughtItem.children[0]);
  const mesh = entry.build();
  mesh.scale.multiplyScalar(entry.scale || 1);
  caughtItem.add(mesh);
  caughtItem.scale.set(1, 1, 1);
}

// keeps the catch's hook point (a fish's mouth, or wherever a boot/can got snagged)
// pinned to a world point, so it always reads as hooked rather than floating
function hangCatchAtHook(mesh, hookOffsetLocal, targetPos, rotX, rotY, rotZ) {
  const euler = new THREE.Euler(rotX || 0, rotY || 0, rotZ || 0);
  const offset = hookOffsetLocal.clone().applyEuler(euler);
  mesh.position.set(targetPos.x - offset.x, targetPos.y - offset.y, targetPos.z - offset.z);
  mesh.rotation.copy(euler);
}

// a growing pile of the fish you've reeled in, tossed onto the deck partway along the
// wharf — junk never joins it, it just gets kept and put away instead. items are placed
// with simple farthest-point spacing so they mound outward instead of stacking directly
// on top of each other.
const PILE_CENTER = new THREE.Vector3(-0.3, topY, (wharfTipZ + wharfShoreZ) / 2 - 2);
const PILE_MAX = 24;
const pileFishes = [];
const pilePlacements = []; // {x, z, r} footprints of everything already placed
const pileLogEntries = []; // matching sunsetFishing.catchLog row for each pile mesh, if any
function spawnPileItem(entry, logRow) {
  if (pileFishes.length >= PILE_MAX) return;
  const mesh = entry.build();
  const sizeJitter = 1.0 + Math.random() * 0.15;
  // cap how large any single pile item reads as, so an oversized species (Marlin, Eel)
  // can't dominate the whole pile and swallow everything spaced around it
  const totalScale = Math.min((entry.scale || 1) * sizeJitter, 1.35);
  mesh.scale.multiplyScalar(totalScale);

  const footprint = 0.24 * totalScale;
  const searchRadius = 0.5 + pilePlacements.length * 0.075;

  let best = null;
  let bestScore = -Infinity;
  const candidates = pilePlacements.length === 0 ? 1 : 40;
  for (let i = 0; i < candidates; i++) {
    const ang = Math.random() * Math.PI * 2;
    const rad = Math.random() * searchRadius;
    const cx = Math.cos(ang) * rad;
    const cz = Math.sin(ang) * rad * 0.75;
    let minGap = Infinity;
    for (const p of pilePlacements) {
      const gap = Math.hypot(cx - p.x, cz - p.z) - (footprint + p.r) * 0.92;
      if (gap < minGap) minGap = gap;
    }
    if (pilePlacements.length === 0) minGap = 0;
    if (minGap > bestScore) { bestScore = minGap; best = { x: cx, z: cz }; }
  }

  // if even the best spot still overlaps, let it rest a little higher, like it landed on something
  const restHeight = Math.max(0, -bestScore) * 0.55;
  mesh.position.set(
    PILE_CENTER.x + best.x,
    PILE_CENTER.y + 0.08 + restHeight + pilePlacements.length * 0.01,
    PILE_CENTER.z + best.z
  );
  mesh.rotation.set((Math.random() - 0.5) * 0.5, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.6);
  mesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(mesh);
  pileFishes.push(mesh);
  pilePlacements.push({ x: best.x, z: best.z, r: footprint });
  pileLogEntries.push(logRow || null);
}

// empties the physical pile off the deck — called once everything in it is sold
function clearPile() {
  pileFishes.forEach((mesh) => scene.remove(mesh));
  pileFishes.length = 0;
  pilePlacements.length = 0;
  pileLogEntries.length = 0;
}

// ------------------------------------------------------------------
// Pelican — occasionally waddles in from the shore once the pile gets big enough
// and steals a fish off the top, then flies off with it.
// ------------------------------------------------------------------
// modelled on a great white pelican: white body, black flight feathers that
// show along the folded wing's trailing edge, a long flat bill with a hooked
// tip, and a big orange throat pouch slung underneath
const pelicanBodyMat = toonMat({ color: 0xf4f0e6, roughness: 0.7 });
const pelicanWingMat = toonMat({ color: 0xe9e3d5, roughness: 0.7 });
const pelicanFlightFeatherMat = toonMat({ color: 0x2b2724, roughness: 0.7 });
const pelicanBeakMat = toonMat({ color: 0xe8b04a, roughness: 0.5 });
const pelicanBeakTipMat = toonMat({ color: 0xd2553a, roughness: 0.5 });
const pelicanPouchMat = toonMat({ color: 0xf2a23c, roughness: 0.6 });
const pelicanFaceMat = toonMat({ color: 0xf2bfa2, roughness: 0.6 });
const pelicanCrestMat = toonMat({ color: 0xf3df9a, roughness: 0.7 });
const pelicanEyeMat = toonMat({ color: 0xf6efc8, roughness: 0.4 });
const pelicanPupilMat = new THREE.MeshBasicMaterial({ color: 0x15110c });
const pelicanLegMat = toonMat({ color: 0xe88c5a, roughness: 0.7 });

// a box running from z=0 forward to z=-len that narrows linearly from
// (w0, h0) at the base to (w1, h1) at the tip — the bill needs to read as
// long and flat rather than conical
function pelicanTaperedBox(len, w0, h0, w1, h1) {
  const geo = new THREE.BoxGeometry(1, 1, len, 1, 1, 6);
  geo.translate(0, 0, -len / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = -pos.getZ(i) / len;
    pos.setX(i, pos.getX(i) * THREE.MathUtils.lerp(w0, w1, t));
    pos.setY(i, pos.getY(i) * THREE.MathUtils.lerp(h0, h1, t));
  }
  geo.computeVertexNormals();
  return geo;
}

function pelicanPart(geo, mat, x, y, z, outline) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  if (outline !== false) addOutline(mesh);
  return mesh;
}

const pelican = new THREE.Group();
pelican.visible = false;
scene.add(pelican);

// plump, chest-up body with a rounded breast out front
const pelicanBody = pelicanPart(new THREE.SphereGeometry(0.5, 16, 12), pelicanBodyMat, 0, 0.6, 0.05);
pelicanBody.scale.set(0.86, 0.82, 1.45);
pelicanBody.rotation.x = 0.12;
pelican.add(pelicanBody);

const pelicanBreast = pelicanPart(new THREE.SphereGeometry(0.32, 14, 10), pelicanBodyMat, 0, 0.7, -0.42);
pelicanBreast.scale.set(1, 1.1, 1);
pelican.add(pelicanBreast);

// short fan of tail feathers, tipped slightly up
const pelicanTail = new THREE.Group();
pelicanTail.position.set(0, 0.68, 0.7);
pelicanTail.rotation.x = -0.25;
pelican.add(pelicanTail);
for (let i = 0; i < 5; i++) {
  const geo = new THREE.BoxGeometry(0.1, 0.03, 0.32);
  geo.translate(0, 0, 0.16);
  const feather = pelicanPart(geo, pelicanWingMat, (i - 2) * 0.05, 0, 0);
  feather.rotation.y = (i - 2) * 0.22;
  pelicanTail.add(feather);
}

// the neck pivots from its base so the whole head can dip toward the pile
const pelicanNeckHead = new THREE.Group();
pelicanNeckHead.position.set(0, 0.82, -0.5);
pelican.add(pelicanNeckHead);

// gentle S-curve neck built from tapered segments with joint spheres to hide the seams
const pelicanNeckPts = [
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, 0.32, 0.07),
  new THREE.Vector3(0, 0.58, -0.03),
  new THREE.Vector3(0, 0.74, -0.14)
];
const pelicanNeckRadii = [0.16, 0.12, 0.1, 0.1];
for (let i = 0; i < pelicanNeckPts.length - 1; i++) {
  pelicanNeckHead.add(limb(pelicanNeckPts[i], pelicanNeckPts[i + 1], pelicanNeckRadii[i], pelicanNeckRadii[i + 1], pelicanBodyMat));
  if (i > 0) {
    const p = pelicanNeckPts[i];
    pelicanNeckHead.add(pelicanPart(new THREE.SphereGeometry(pelicanNeckRadii[i], 10, 8), pelicanBodyMat, p.x, p.y, p.z));
  }
}

const pelicanHead = pelicanPart(new THREE.SphereGeometry(0.17, 14, 10), pelicanBodyMat, 0, 0.76, -0.15);
pelicanHead.scale.set(0.9, 0.95, 1.15);
pelicanNeckHead.add(pelicanHead);

// pale-yellow shaggy crest swept back off the crown
const pelicanCrest = pelicanPart(new THREE.SphereGeometry(0.08, 10, 8), pelicanCrestMat, 0, 0.88, -0.05);
pelicanCrest.scale.set(0.8, 0.6, 1.5);
pelicanCrest.rotation.x = -0.3;
pelicanNeckHead.add(pelicanCrest);

// bare pink facial skin around each eye, with a pale iris and dark pupil
[-1, 1].forEach((side) => {
  const face = pelicanPart(new THREE.SphereGeometry(0.07, 10, 8), pelicanFaceMat, side * 0.125, 0.77, -0.25, false);
  face.scale.set(0.5, 1, 1.3);
  pelicanNeckHead.add(face);
  pelicanNeckHead.add(pelicanPart(new THREE.SphereGeometry(0.034, 8, 6), pelicanEyeMat, side * 0.148, 0.79, -0.25, false));
  pelicanNeckHead.add(pelicanPart(new THREE.SphereGeometry(0.018, 6, 5), pelicanPupilMat, side * 0.175, 0.79, -0.26, false));
});

// bill angles forward and down from the face
const pelicanBill = new THREE.Group();
pelicanBill.position.set(0, 0.72, -0.27);
pelicanBill.rotation.x = -0.35;
pelicanNeckHead.add(pelicanBill);

const pelicanBeakTop = pelicanPart(pelicanTaperedBox(0.85, 0.12, 0.05, 0.07, 0.035), pelicanBeakMat, 0, 0.02, 0);
pelicanBill.add(pelicanBeakTop);

const pelicanBeakHook = pelicanPart(new THREE.ConeGeometry(0.035, 0.09, 6), pelicanBeakTipMat, 0, -0.02, -0.84);
pelicanBeakHook.rotation.x = Math.PI; // points down — the hooked nail at the end of the bill
pelicanBill.add(pelicanBeakHook);

// the throat pouch hangs under the bill, deepest toward the middle
const pelicanPouch = pelicanPart(new THREE.SphereGeometry(1, 14, 10), pelicanPouchMat, 0, -0.09, -0.38);
pelicanPouch.scale.set(0.085, 0.12, 0.38);
pelicanBill.add(pelicanPouch);

// where a stolen fish sits — tucked into the pouch
const pelicanFishHold = new THREE.Object3D();
pelicanFishHold.position.set(0, -0.12, -0.45);
pelicanBill.add(pelicanFishHold);

// each wing is a chain of pivots so it can fold flat along the body while
// walking and swing open for flight:
//   shoulder (flap, about the body's long axis)
//     → fold (yaw — swings the span back alongside the body)
//       → roll (stands the folded wing up on its leading edge against the flank)
//         → inner arm panel + elbow (secondary flap flex) → hand panel + primaries
function makePelicanWing(sign) {
  const shoulder = new THREE.Group();
  shoulder.position.set(sign * 0.44, 0.82, -0.22);
  const fold = new THREE.Group();
  shoulder.add(fold);
  const roll = new THREE.Group();
  fold.add(roll);

  // panels are flattened ellipsoids rather than boxes so the folded wing
  // reads as a smooth feathered shape against the body, not a slab
  const panel = (mat, sx, sy, sz, x, y, z) => {
    const mesh = pelicanPart(new THREE.SphereGeometry(1, 14, 8), mat, x, y, z);
    mesh.scale.set(sx, sy, sz);
    return mesh;
  };
  roll.add(panel(pelicanWingMat, 0.28, 0.035, 0.24, sign * 0.25, 0, 0.1));
  // black secondaries peeking out along the trailing edge
  roll.add(panel(pelicanFlightFeatherMat, 0.27, 0.025, 0.09, sign * 0.25, -0.006, 0.3));

  const elbow = new THREE.Group();
  elbow.position.set(sign * 0.48, 0, 0);
  roll.add(elbow);
  elbow.add(panel(pelicanWingMat, 0.21, 0.03, 0.19, sign * 0.16, 0, 0.06));

  // black primaries — the "fingers" at the wingtip. Each hangs off its own
  // pivot so they can spread wide in flight and close up when folded.
  const primaries = [];
  for (let i = 0; i < 5; i++) {
    const pivot = new THREE.Group();
    pivot.position.set(sign * 0.26, -0.004 * i, -0.04 + i * 0.06);
    pivot.add(panel(pelicanFlightFeatherMat, 0.22, 0.018, 0.045, sign * 0.2, 0, 0));
    elbow.add(pivot);
    primaries.push(pivot);
  }

  shoulder.userData = { sign, fold, roll, elbow, primaries };
  return shoulder;
}
const pelicanWingL = makePelicanWing(1);
const pelicanWingR = makePelicanWing(-1);
pelican.add(pelicanWingL, pelicanWingR);

// 0 = folded flat against the flanks, 1 = fully spread for flight
function setPelicanWingSpread(f) {
  [pelicanWingL, pelicanWingR].forEach((wing) => {
    const { sign, fold, roll, primaries } = wing.userData;
    fold.rotation.y = -sign * (Math.PI / 2) * (1 - f);
    roll.rotation.x = 1.7 * (1 - f);
    const fan = 0.15 + 0.85 * f;
    primaries.forEach((p, i) => {
      p.rotation.y = sign * (0.12 - i * 0.12) * fan;
      p.position.z = (-0.04 + i * 0.06) * (0.25 + 0.75 * f); // bunch up into one tip when folded
    });
  });
}

function setPelicanFlap(shoulderAngle, elbowAngle) {
  [pelicanWingL, pelicanWingR].forEach((wing) => {
    const { sign, elbow } = wing.userData;
    wing.rotation.z = sign * shoulderAngle;
    elbow.rotation.z = sign * elbowAngle;
  });
}

// short orange legs that swing from the hip, ending in webbed feet
const pelicanWebShape = new THREE.Shape();
pelicanWebShape.moveTo(0, 0.03);
pelicanWebShape.lineTo(-0.1, -0.15);
pelicanWebShape.quadraticCurveTo(-0.05, -0.12, 0, -0.19);
pelicanWebShape.quadraticCurveTo(0.05, -0.12, 0.1, -0.15);
pelicanWebShape.lineTo(0, 0.03);
const pelicanWebGeo = new THREE.ExtrudeGeometry(pelicanWebShape, { depth: 0.025, bevelEnabled: false });
pelicanWebGeo.rotateX(Math.PI / 2); // lay flat with the toes pointing forward (-z)
pelicanWebGeo.translate(0, 0.025, 0);

const pelicanLegs = [-0.16, 0.16].map((xOff) => {
  const hip = new THREE.Group();
  hip.position.set(xOff, 0.32, 0.12);
  hip.add(limb(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.32, -0.02), 0.05, 0.035, pelicanLegMat));
  hip.add(pelicanPart(pelicanWebGeo, pelicanLegMat, 0, -0.32, -0.02, false));
  pelican.add(hip);
  return hip;
});

function resetPelicanPose() {
  setPelicanWingSpread(0);
  setPelicanFlap(0, 0);
  pelicanNeckHead.rotation.x = 0;
  pelicanLegs.forEach((hip) => { hip.rotation.x = 0; });
}
resetPelicanPose();

const pelicanState = {
  phase: 'idle', // idle | walkingIn | grabbing | flyingOff
  timer: 0,
  startPos: new THREE.Vector3(),
  grabPos: new THREE.Vector3(),
  exitPos: new THREE.Vector3(),
  stolenMesh: null
};

// once the pile is 10+, there's a chance a pelican swoops in and steals one — the
// odds climb 2% for every additional ten fish sitting out
function maybeTriggerPelican() {
  if (pelicanState.phase !== 'idle' || !pileFishes.length) return;
  const count = pileFishes.length;
  if (count < 10) return;
  const tier = Math.floor(count / 10);
  const chance = 0.05 + (tier - 1) * 0.02;
  if (Math.random() < chance) startPelicanEvent();
}

// the radio keeps the bird away entirely while it's playing — checked here
// (the one true entry point for the pelican actually showing up) so both the
// natural random trigger and the cheat menu's direct "Bird" button respect it
function startPelicanEvent() {
  if (radioPlaying) return;
  const jitterX = (Math.random() - 0.5) * 1.2;
  pelicanState.startPos.set(PILE_CENTER.x + jitterX, topY, wharfShoreZ + 2);
  pelicanState.grabPos.set(PILE_CENTER.x + jitterX * 0.3, topY, PILE_CENTER.z + 1.1);
  pelicanState.exitPos.set(PILE_CENTER.x + jitterX + (Math.random() - 0.5) * 3, topY + 15, wharfShoreZ + 4);
  pelican.position.copy(pelicanState.startPos);
  pelican.rotation.set(0, 0, 0); // faces -z by default, matching the walk-in direction
  resetPelicanPose();
  pelican.visible = true;
  pelicanState.phase = 'walkingIn';
  pelicanState.timer = 0;
}

function updatePelican(dt) {
  if (pelicanState.phase === 'idle') return;
  pelicanState.timer += dt;
  const WALK_DUR = 2.2, GRAB_DUR = 0.45, FLY_DUR = 2.6;

  if (pelicanState.phase === 'walkingIn') {
    const p = Math.min(pelicanState.timer / WALK_DUR, 1);
    pelican.position.lerpVectors(pelicanState.startPos, pelicanState.grabPos, p);
    pelican.position.y = topY + Math.abs(Math.sin(pelicanState.timer * 9)) * 0.06;
    pelican.rotation.z = Math.sin(pelicanState.timer * 9) * 0.05;
    // waddle: legs swing in opposition and the head bobs with each step
    const stride = Math.sin(pelicanState.timer * 9) * 0.4;
    pelicanLegs[0].rotation.x = stride;
    pelicanLegs[1].rotation.x = -stride;
    pelicanNeckHead.rotation.x = Math.sin(pelicanState.timer * 18) * 0.05;
    if (p >= 1) {
      pelicanLegs.forEach((hip) => { hip.rotation.x = 0; });
      pelicanState.phase = 'grabbing';
      pelicanState.timer = 0;
      const idx = Math.floor(Math.random() * pileFishes.length);
      pelicanState.stolenMesh = pileFishes[idx];
      const stolenLogRow = pileLogEntries[idx];
      pileFishes.splice(idx, 1);
      pilePlacements.splice(idx, 1);
      pileLogEntries.splice(idx, 1);
      if (pelicanState.stolenMesh) pelicanState.stolenMesh.scale.multiplyScalar(0.7);
      if (stolenLogRow) {
        stolenLogRow.stolen = true;
        saveCatchLog();
        if (openPanel === 'sell') renderSell();
        if (openPanel === 'log') renderLog();
      }
    }
  } else if (pelicanState.phase === 'grabbing') {
    const p = Math.min(pelicanState.timer / GRAB_DUR, 1);
    pelicanNeckHead.rotation.x = -Math.sin(p * Math.PI) * 0.55; // dip down into the pile and back up
    if (pelicanState.stolenMesh) {
      const beakWorld = pelicanFishHold.getWorldPosition(new THREE.Vector3());
      pelicanState.stolenMesh.position.copy(beakWorld);
    }
    if (p >= 1) {
      pelicanNeckHead.rotation.x = 0;
      pelicanState.phase = 'flyingOff';
      pelicanState.timer = 0;
      pelican.rotation.y = Math.PI; // now facing +z, back the way it came
    }
  } else if (pelicanState.phase === 'flyingOff') {
    const p = Math.min(pelicanState.timer / FLY_DUR, 1);
    pelican.position.lerpVectors(pelicanState.grabPos, pelicanState.exitPos, p);
    pelican.rotation.x = -0.3 * Math.sin(p * Math.PI * 0.5);
    // wings swing open over the first moment of takeoff, then settle into slow,
    // deep pelican wingbeats with the hand lagging behind the arm; legs tuck
    // back and the head draws in toward the shoulders
    const spread = Math.min(pelicanState.timer / 0.35, 1);
    setPelicanWingSpread(spread);
    const beat = pelicanState.timer * 9;
    setPelicanFlap(Math.sin(beat) * 0.6 * spread, Math.sin(beat - 0.6) * 0.35 * spread);
    pelicanLegs.forEach((hip) => { hip.rotation.x = -1.2 * spread; });
    pelicanNeckHead.rotation.x = 0.3 * spread;
    if (pelicanState.stolenMesh) {
      const beakWorld = pelicanFishHold.getWorldPosition(new THREE.Vector3());
      pelicanState.stolenMesh.position.copy(beakWorld);
    }
    if (p >= 1) {
      pelicanState.phase = 'idle';
      pelican.visible = false;
      resetPelicanPose();
      if (pelicanState.stolenMesh) {
        scene.remove(pelicanState.stolenMesh);
        pelicanState.stolenMesh = null;
      }
    }
  }
}

// ------------------------------------------------------------------
// Black market boat — occasionally drifts in out on the water and offers to
// buy your catch for a bit more than the going rate, no questions asked.
// ------------------------------------------------------------------
const BOAT_HULL_CENTER_Y = 0.35;
const BOAT_HULL_HALF_HEIGHT = 0.425;

// ---- shared boat-building helpers (used by both the black market and police boats) ----
// Both boats share one procedurally-lofted hull shape: a run of cross-section
// "stations" from the flat transom (t=0, +z) to a pointed, raised bow (t=1, -z).
// Each station is a 7-point profile — vertical topsides, a hard chine, and a
// V keel — so the hull reads as an actual boat instead of a box with a wedge.
const BOAT_HULL_LEN = 6.8;
const BOAT_HULL_STERN_Z = 2.8;
const BOAT_HULL_HALF_W = 1.05;
const BOAT_HULL_KEEL_Y = BOAT_HULL_CENTER_Y - BOAT_HULL_HALF_HEIGHT;
const BOAT_HULL_TOP_Y = BOAT_HULL_CENTER_Y + BOAT_HULL_HALF_HEIGHT;
const BOAT_BOW_RISE = 0.35;
const BOAT_HULL_MAX_Y = BOAT_HULL_TOP_Y + BOAT_BOW_RISE;
const BOAT_DECK_DROP = 0.12; // deck sits this far below the gunwale, leaving a low bulwark
const BOAT_TOPSIDE_H = 0.3;  // height of the vertical upper hull side (where name decals go)

function boatHullStation(t) {
  const bowT = THREE.MathUtils.clamp((t - 0.55) / 0.45, 0, 1);
  const sternPinch = 0.88 + 0.12 * THREE.MathUtils.smoothstep(t, 0, 0.12);
  return {
    z: BOAT_HULL_STERN_Z - t * BOAT_HULL_LEN,
    w: BOAT_HULL_HALF_W * sternPinch * Math.sqrt(Math.max(0, 1 - bowT * bowT)),
    top: BOAT_HULL_TOP_Y + BOAT_BOW_RISE * bowT * bowT,
    keel: BOAT_HULL_KEEL_Y + 0.3 * Math.pow(bowT, 1.4)
  };
}
function boatTAtZ(z) { return THREE.MathUtils.clamp((BOAT_HULL_STERN_Z - z) / BOAT_HULL_LEN, 0, 1); }
function boatDeckYAt(z) { return boatHullStation(boatTAtZ(z)).top - BOAT_DECK_DROP; }
function boatHalfWidthAt(z) { return boatHullStation(boatTAtZ(z)).w; }

function boatProfile(s) {
  const shoulder = s.top - BOAT_TOPSIDE_H;
  const chine = s.keel + (shoulder - s.keel) * 0.4;
  return [
    [-s.w, s.top], [-s.w, shoulder], [-s.w * 0.78, chine], [0, s.keel],
    [s.w * 0.78, chine], [s.w, shoulder], [s.w, s.top]
  ];
}

function makeBoatHullGeometry() {
  const N = 24, P = 7;
  const positions = [], uvs = [], indices = [];
  const vOf = (y) => (y - BOAT_HULL_KEEL_Y) / (BOAT_HULL_MAX_Y - BOAT_HULL_KEEL_Y);
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const s = boatHullStation(t);
    boatProfile(s).forEach(([x, y]) => { positions.push(x, y, s.z); uvs.push(t, vOf(y)); });
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < P - 1; j++) {
      const a = i * P + j, b = i * P + j + 1, c = (i + 1) * P + j + 1, d = (i + 1) * P + j;
      indices.push(a, c, b, a, d, c);
    }
  }
  // flat transom — its own vertex copies so its normal stays crisp instead of
  // smoothing into the hull sides
  const base = positions.length / 3;
  const s0 = boatHullStation(0);
  boatProfile(s0).forEach(([x, y]) => { positions.push(x, y, s0.z); uvs.push(0, vOf(y)); });
  for (let j = 1; j < P - 1; j++) indices.push(base, base + j, base + j + 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function makeBoatDeckGeometry() {
  const N = 24, inset = 0.06;
  const positions = [], uvs = [], indices = [];
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * 0.97;
    const s = boatHullStation(t);
    const w = Math.max(0, s.w - inset), y = s.top - BOAT_DECK_DROP;
    positions.push(-w, y, s.z, w, y, s.z);
    uvs.push(0.5 - w / (2 * BOAT_HULL_HALF_W), t * 3, 0.5 + w / (2 * BOAT_HULL_HALF_W), t * 3);
  }
  for (let i = 0; i < N; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2 + 1, d = (i + 1) * 2;
    indices.push(a, b, c, a, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// recenters a geometry on its own bounding box so addOutline()'s uniform scale
// grows the ink hull evenly in every direction instead of skewing off the origin
function centeredMesh(geo, mat) {
  geo.computeBoundingBox();
  const c = new THREE.Vector3();
  geo.boundingBox.getCenter(c);
  geo.translate(-c.x, -c.y, -c.z);
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(c);
  return m;
}

// paints horizontal hull bands by hull-local height (canvas row <-> uv.v), and
// hands the 2D context to an optional extra painter for streaks/grime
function makeHullTexture(baseColor, bands, extraPaint) {
  const w = 512, h = 256;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, w, h);
  const rowOf = (y) => (1 - (y - BOAT_HULL_KEEL_Y) / (BOAT_HULL_MAX_Y - BOAT_HULL_KEEL_Y)) * h;
  bands.forEach(([y0, y1, color]) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, rowOf(y1), w, rowOf(y0) - rowOf(y1));
  });
  if (extraPaint) extraPaint(ctx, w, h, rowOf);
  return new THREE.CanvasTexture(c);
}

function makeTextDecalTexture(draw, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

// a matching decal on both flat topsides, centered at hull-local z
function addHullSideDecals(boat, tex, z, len, height) {
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  const y = BOAT_HULL_TOP_Y - BOAT_TOPSIDE_H / 2;
  const w = boatHalfWidthAt(z) + 0.006;
  [1, -1].forEach((side) => {
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(len, height), mat);
    decal.position.set(side * w, y, z);
    decal.rotation.y = side * Math.PI / 2; // text reads bow-ward on both sides
    boat.add(decal);
  });
}

function makeBoatHullAndDeck(boat, hullMat, deckMat) {
  const hull = centeredMesh(makeBoatHullGeometry(), hullMat);
  hull.castShadow = true;
  hull.receiveShadow = true;
  addOutline(hull, 1.025);
  boat.add(hull);
  const deck = new THREE.Mesh(makeBoatDeckGeometry(), deckMat);
  deck.receiveShadow = true;
  boat.add(deck);
}

function boxAt(parent, w, h, d, mat, x, y, z, outline) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  if (outline !== false) addOutline(m, 1.04);
  parent.add(m);
  return m;
}

// a flag plane hinged at its left edge, rippled per-vertex each frame
function makeWavingFlag(tex, w, h) {
  const geo = new THREE.PlaneGeometry(w, h, 10, 4);
  geo.translate(w / 2, 0, 0);
  const mesh = new THREE.Mesh(geo, toonMat({ map: tex, side: THREE.DoubleSide, roughness: 0.9 }));
  mesh.userData.baseX = Float32Array.from({ length: geo.attributes.position.count }, (_, i) => geo.attributes.position.getX(i));
  mesh.userData.flagW = w;
  return mesh;
}
function animateWavingFlag(mesh, t) {
  const pos = mesh.geometry.attributes.position;
  const bx = mesh.userData.baseX, fw = mesh.userData.flagW;
  for (let i = 0; i < pos.count; i++) {
    const x = bx[i], k = x / fw;
    pos.setZ(i, Math.sin(x * 7 - t * 7) * 0.07 * k + Math.sin(pos.getY(i) * 5 + t * 4) * 0.02 * k);
  }
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
}

// ---- black market boat: a battered smuggler's trawler ----
const boatHullTex = makeHullTexture('#1f1c1b', [
  [BOAT_HULL_KEEL_Y, 0.2, '#3a1210'],    // antifouling below the waterline
  [0.2, 0.29, '#6e1a14'],                 // faded red boot stripe
  [BOAT_HULL_TOP_Y - 0.07, BOAT_HULL_TOP_Y - 0.035, '#a89a7c'] // chipped cream sheer line
], (ctx, w, h, rowOf) => {
  // rust streaks bleeding down from the gunwale and the odd scuff
  let seed = 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < 60; i++) {
    const x = rnd() * w, len = 20 + rnd() * 70, top = rowOf(BOAT_HULL_TOP_Y + rnd() * 0.2);
    const g = ctx.createLinearGradient(0, top, 0, top + len);
    g.addColorStop(0, `rgba(${120 + rnd() * 50},${50 + rnd() * 20},20,${0.35 + rnd() * 0.35})`);
    g.addColorStop(1, 'rgba(90,40,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, top, 1.5 + rnd() * 3, len);
  }
  for (let i = 0; i < 25; i++) {
    ctx.fillStyle = `rgba(70,64,58,${0.25 + rnd() * 0.3})`;
    ctx.fillRect(rnd() * w, rowOf(0.3 + rnd() * 0.5), 6 + rnd() * 18, 2 + rnd() * 5);
  }
});
const boatHullMat = toonMat({ map: boatHullTex, roughness: 0.85, side: THREE.DoubleSide });

function makePlankDeckTexture(colors, seam) {
  const w = 128, h = 256;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const planks = 8, pw = w / planks;
  let seed = 3;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < planks; i++) {
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(i * pw, 0, pw, h);
    ctx.fillStyle = seam;
    ctx.fillRect(i * pw, 0, 1.5, h);
    const joint = rnd() * h;
    ctx.fillRect(i * pw, joint, pw, 1.5); // staggered butt joints
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
const boatDeckMat = toonMat({ map: makePlankDeckTexture(['#5a4330', '#4e3a29', '#614832', '#53402d'], '#241a12'), roughness: 0.95 });
const boatCabinMat = toonMat({ color: 0x3d4a3f, roughness: 0.85 });   // weathered green-gray paint
const boatRoofMat = toonMat({ color: 0x2a2421, roughness: 0.85 });
const boatWoodMat = toonMat({ color: 0x7a5a38, roughness: 0.9 });
const boatMetalMat = toonMat({ color: 0x2e2c2a, roughness: 0.6 });
const boatTarpMat = toonMat({ color: 0x3f4a2a, roughness: 0.95 });
const boatWindowMat = new THREE.MeshBasicMaterial({ color: 0xffb04a });
const boatLanternMat = toonMat({ color: 0xffcf7a, emissive: 0xffb347, emissiveIntensity: 1.1, roughness: 0.4 });

function makeSailTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#5b5247';
  ctx.fillRect(0, 0, 128, 128);
  [['#6b6052', 18, 30, 34, 26], ['#4a433a', 66, 64, 30, 22], ['#71654f', 38, 92, 26, 18]].forEach(([col, x, y, w, h]) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(30,25,20,0.6)';
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2); // stitched patches
  });
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(30,25,20,0.35)';
  for (let y = 10; y < 128; y += 22) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(128, y + 6); ctx.stroke(); }
  return new THREE.CanvasTexture(c);
}

function makeSkullFlagTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 80;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#121212';
  ctx.fillRect(0, 0, 128, 80);
  ctx.strokeStyle = '#ece6d6';
  ctx.lineCap = 'round';
  ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(38, 22); ctx.lineTo(90, 66); ctx.moveTo(90, 22); ctx.lineTo(38, 66); ctx.stroke();
  ctx.fillStyle = '#ece6d6';
  ctx.beginPath(); ctx.arc(64, 34, 16, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(56, 42, 16, 12);
  ctx.fillStyle = '#121212';
  ctx.beginPath(); ctx.arc(58, 33, 4.5, 0, Math.PI * 2); ctx.arc(70, 33, 4.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(60, 48, 2, 6); ctx.fillRect(66, 48, 2, 6);
  return new THREE.CanvasTexture(c);
}

// a small standing figure (feet at y=0, ~0.85 tall in boat-local units), built
// facing -z; the caller rotates it to face wherever it should
function makeHoodedSmuggler() {
  const g = new THREE.Group();
  const cloakMat = toonMat({ color: 0x1e1a24, roughness: 0.9 });
  const cloak = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 12), cloakMat);
  cloak.position.y = 0.35;
  cloak.castShadow = true;
  addOutline(cloak, 1.06);
  g.add(cloak);
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 12), cloakMat);
  hood.position.set(0, 0.74, 0);
  hood.scale.set(1, 1.15, 1);
  addOutline(hood, 1.08);
  g.add(hood);
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.085, 12), new THREE.MeshBasicMaterial({ color: 0x050407 }));
  face.position.set(0, 0.72, -0.118);
  face.rotation.y = Math.PI;
  g.add(face);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffe066 });
  [-0.03, 0.03].forEach((x) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), eyeMat);
    eye.position.set(x, 0.735, -0.122);
    g.add(eye);
  });
  // a hand-held lantern dangling at its side
  g.add(limb(new THREE.Vector3(0.14, 0.5, -0.04), new THREE.Vector3(0.2, 0.32, -0.08), 0.03, 0.025, cloakMat));
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.07, 8), boatLanternMat);
  lantern.position.set(0.2, 0.27, -0.08);
  g.add(lantern);
  return g;
}

const blackMarketBoat = new THREE.Group();
blackMarketBoat.visible = false;
scene.add(blackMarketBoat);

makeBoatHullAndDeck(blackMarketBoat, boatHullMat, boatDeckMat);
addHullSideDecals(blackMarketBoat, makeTextDecalTexture((ctx, w, h) => {
  ctx.font = 'italic bold 84px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(205,190,155,0.8)';
  ctx.fillText('SEA RAT', w / 2, h / 2 + 4);
  // scrape out some of the paint so it reads as old and chipped
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 120; i++) ctx.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 6, 1 + Math.random() * 3);
}, 512, 128), -0.35, 1.3, 0.26);

// wheelhouse aft, with warm lamplight in the windows
const BM_DECK_AFT = boatDeckYAt(1.45);
const BM_CABIN_H = 0.95;
boxAt(blackMarketBoat, 1.3, BM_CABIN_H, 1.4, boatCabinMat, 0, BM_DECK_AFT + BM_CABIN_H / 2, 1.45);
const BM_ROOF_Y = BM_DECK_AFT + BM_CABIN_H + 0.04;
boxAt(blackMarketBoat, 1.5, 0.08, 1.62, boatRoofMat, 0, BM_ROOF_Y, 1.45);
[-0.3, 0.3].forEach((x) => boxAt(blackMarketBoat, 0.4, 0.28, 0.03, boatWindowMat, x, BM_DECK_AFT + 0.65, 0.745));
[-0.656, 0.656].forEach((x) => {
  boxAt(blackMarketBoat, 0.03, 0.26, 0.38, boatWindowMat, x, BM_DECK_AFT + 0.65, 1.1);
  boxAt(blackMarketBoat, 0.03, 0.26, 0.38, boatWindowMat, x, BM_DECK_AFT + 0.65, 1.75);
});
// stovepipe chimney (smoke puffs are spawned from its tip each frame)
blackMarketBoat.add(limb(new THREE.Vector3(0.38, BM_ROOF_Y, 1.85), new THREE.Vector3(0.38, BM_ROOF_Y + 0.5, 1.85), 0.06, 0.055, boatMetalMat));
boxAt(blackMarketBoat, 0.18, 0.05, 0.18, boatMetalMat, 0.38, BM_ROOF_Y + 0.52, 1.85);
const bmChimneyTop = new THREE.Object3D();
bmChimneyTop.position.set(0.38, BM_ROOF_Y + 0.6, 1.85);
blackMarketBoat.add(bmChimneyTop);

// mast, boom, and a tattered patched sail
const BM_MAST_Z = -1.0;
const BM_DECK_MAST = boatDeckYAt(BM_MAST_Z);
blackMarketBoat.add(limb(new THREE.Vector3(0, BM_DECK_MAST, BM_MAST_Z), new THREE.Vector3(0, 3.45, BM_MAST_Z), 0.07, 0.045, boatWoodMat));
blackMarketBoat.add(limb(new THREE.Vector3(0, BM_DECK_MAST + 0.5, BM_MAST_Z), new THREE.Vector3(0, BM_DECK_MAST + 0.56, 0.6), 0.035, 0.03, boatWoodMat));
const bmSail = (() => {
  // built in shape coords (sx = -z, y), then turned edge-on to lie along the boat
  const bottom = [-BM_MAST_Z - 0.06, BM_DECK_MAST + 0.6], top = [-BM_MAST_Z - 0.06, 3.2], clew = [-0.55, BM_DECK_MAST + 0.62];
  const shape = new THREE.Shape();
  shape.moveTo(bottom[0], bottom[1]);
  shape.lineTo(top[0], top[1]);
  const jag = [0.04, -0.07, 0.05, -0.1, 0.02, -0.06, 0.08, -0.04];
  for (let i = 1; i < jag.length; i++) {
    const k = i / jag.length;
    // ragged trailing edge, nibbled inward
    shape.lineTo(top[0] + (clew[0] - top[0]) * k - 0.06 - Math.abs(jag[i]), top[1] + (clew[1] - top[1]) * k + jag[i]);
  }
  shape.lineTo(clew[0], clew[1]);
  shape.lineTo(bottom[0], bottom[1]);
  const hole = new THREE.Path();
  hole.absarc(0.55, 2.0, 0.06, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateY(Math.PI / 2);
  const tex = makeSailTexture();
  tex.repeat.set(1 / 1.6, 1 / 2.2);
  tex.offset.set(0.6 / 1.6, -BM_DECK_MAST / 2.2);
  const sail = new THREE.Mesh(geo, toonMat({ map: tex, side: THREE.DoubleSide, roughness: 0.95 }));
  sail.castShadow = true;
  return sail;
})();
blackMarketBoat.add(bmSail);

const bmFlag = makeWavingFlag(makeSkullFlagTexture(), 0.85, 0.53);
bmFlag.position.set(0, 3.15, BM_MAST_Z);
bmFlag.rotation.y = -Math.PI / 2; // streams aft along the boat
blackMarketBoat.add(bmFlag);

// contraband: stacked crates, a tarp-covered heap, barrels and rope aft
const bmFore = -1.9;
const bmForeDeck = boatDeckYAt(bmFore);
boxAt(blackMarketBoat, 0.42, 0.42, 0.42, boatWoodMat, -0.32, bmForeDeck + 0.21, bmFore).rotation.y = 0.2;
boxAt(blackMarketBoat, 0.4, 0.4, 0.4, boatWoodMat, 0.25, bmForeDeck + 0.2, bmFore + 0.1).rotation.y = -0.3;
boxAt(blackMarketBoat, 0.36, 0.36, 0.36, boatWoodMat, -0.05, bmForeDeck + 0.58, bmFore + 0.02).rotation.y = 0.6;
const bmTarp = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 10), boatTarpMat);
bmTarp.scale.set(1.1, 0.5, 0.9);
bmTarp.position.set(0, boatDeckYAt(-2.75) + 0.1, -2.75);
bmTarp.castShadow = true;
addOutline(bmTarp, 1.05);
blackMarketBoat.add(bmTarp);
[-0.48, 0.48].forEach((x) => {
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.42, 12), boatWoodMat);
  barrel.position.set(x, boatDeckYAt(2.45) + 0.21, 2.45);
  barrel.castShadow = true;
  addOutline(barrel, 1.06);
  blackMarketBoat.add(barrel);
  const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.172, 0.012, 6, 16), boatMetalMat);
  hoop.rotation.x = Math.PI / 2;
  hoop.position.copy(barrel.position);
  blackMarketBoat.add(hoop);
});

// strings of colored lanterns sagging from the masthead to the bow and the wheelhouse
const bmLanterns = [];
function addLanternString(a, b, count, colors) {
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const k = i / 16;
    const p = new THREE.Vector3().lerpVectors(a, b, k);
    p.y -= Math.sin(k * Math.PI) * 0.25;
    pts.push(p);
  }
  blackMarketBoat.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x1a1410 })));
  for (let i = 1; i <= count; i++) {
    const p = pts[Math.round((i / (count + 1)) * 16)];
    const col = colors[i % colors.length];
    const lm = new THREE.MeshBasicMaterial({ color: col });
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), lm);
    l.position.copy(p).add(new THREE.Vector3(0, -0.07, 0));
    blackMarketBoat.add(l);
    bmLanterns.push({ mesh: l, base: new THREE.Color(col), phase: Math.random() * 10 });
  }
}
const bowTip = boatHullStation(0.98);
addLanternString(new THREE.Vector3(0, 3.0, BM_MAST_Z), new THREE.Vector3(0, bowTip.top + 0.05, bowTip.z), 4, [0xffb347, 0xff5a3c, 0x7dff8a]);
addLanternString(new THREE.Vector3(0, 2.7, BM_MAST_Z), new THREE.Vector3(0, BM_ROOF_Y + 0.05, 0.75), 3, [0xffb347, 0x7dff8a, 0xff5a3c]);

// a hanging lantern by the wheelhouse door on the wharf-facing side, which also
// carries the boat's one real light so its glow actually spills on the hull/deck
const boatLantern = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), boatLanternMat);
boatLantern.position.set(-0.75, BM_DECK_AFT + 0.75, 0.7);
blackMarketBoat.add(boatLantern);
const boatLanternLight = new THREE.PointLight(0xffb347, 0.8, 7);
boatLanternLight.position.copy(boatLantern.position);
blackMarketBoat.add(boatLanternLight);

// the smuggler, waiting on the wharf-facing side of the deck (local -x faces
// the wharf once the boat docks turned bow-left)
const bmSmuggler = makeHoodedSmuggler();
bmSmuggler.position.set(-0.55, boatDeckYAt(0.25), 0.25);
bmSmuggler.rotation.y = Math.PI / 2;
blackMarketBoat.add(bmSmuggler);

// scaled up so it reads as a proper boat (rather than a toy) out on the water
const BOAT_SCALE = 2.1;
blackMarketBoat.scale.setScalar(BOAT_SCALE);

// ---- shared boat FX: a foamy wake trail behind moving boats, and chimney smoke ----
const BOAT_WAKE_POOL = 60;
const boatWakePool = [];
for (let i = 0; i < BOAT_WAKE_POOL; i++) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(0.5, 16), new THREE.MeshBasicMaterial({
    map: softRadialTex, color: 0xf2f7ff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide
  }));
  m.rotation.x = -Math.PI / 2;
  m.visible = false;
  scene.add(m);
  boatWakePool.push({ mesh: m, active: false, t: 0, x: 0, z: 0, size: 1 });
}
let boatWakeCursor = 0;
const boatFxTmp = new THREE.Vector3();
function spawnBoatWake(boat, localX, localZ, size) {
  boatFxTmp.set(localX, 0, localZ);
  boat.localToWorld(boatFxTmp);
  const w = boatWakePool[boatWakeCursor];
  boatWakeCursor = (boatWakeCursor + 1) % BOAT_WAKE_POOL;
  w.active = true; w.t = 0; w.x = boatFxTmp.x; w.z = boatFxTmp.z; w.size = size;
  w.mesh.visible = true;
}
// stern churn plus two bow-wave puffs per tick — reads as a V trailing behind
function emitBoatWake(boat) {
  spawnBoatWake(boat, 0, BOAT_HULL_STERN_Z + 0.3, 1.6);
  spawnBoatWake(boat, -0.9, -1.0, 0.9);
  spawnBoatWake(boat, 0.9, -1.0, 0.9);
}

const BOAT_SMOKE_POOL = 24;
const boatSmokePool = [];
for (let i = 0; i < BOAT_SMOKE_POOL; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softRadialTex, color: 0x5a5550, transparent: true, opacity: 0, depthWrite: false }));
  s.visible = false;
  scene.add(s);
  boatSmokePool.push({ sprite: s, active: false, t: 0, drift: 0 });
}
let boatSmokeCursor = 0;
function spawnBoatSmoke(anchor) {
  const p = boatSmokePool[boatSmokeCursor];
  boatSmokeCursor = (boatSmokeCursor + 1) % BOAT_SMOKE_POOL;
  anchor.getWorldPosition(p.sprite.position);
  p.active = true; p.t = 0; p.drift = (Math.random() - 0.5) * 0.6;
  p.sprite.visible = true;
}

function updateBoatFx(dt, t) {
  const WAKE_LIFE = 2.4, SMOKE_LIFE = 3.2;
  boatWakePool.forEach((w) => {
    if (!w.active) return;
    w.t += dt;
    const p = w.t / WAKE_LIFE;
    if (p >= 1) { w.active = false; w.mesh.visible = false; return; }
    const s = w.size * (1 + p * 3.5);
    w.mesh.scale.set(s, s, s);
    w.mesh.position.set(w.x, waveHeight(w.x, w.z, t) + 0.06, w.z);
    w.mesh.material.opacity = (1 - p) * (1 - p) * 0.55;
  });
  boatSmokePool.forEach((s) => {
    if (!s.active) return;
    s.t += dt;
    const p = s.t / SMOKE_LIFE;
    if (p >= 1) { s.active = false; s.sprite.visible = false; return; }
    s.sprite.position.y += dt * 1.1;
    s.sprite.position.x += dt * (0.5 + s.drift); // breeze carries it off
    const sc = 0.6 + p * 2.4;
    s.sprite.scale.set(sc, sc, 1);
    s.sprite.material.opacity = Math.sin(p * Math.PI) * 0.45;
  });
}

// sit the hull so the waterline crosses about 30% up from its bottom edge, like a
// hull actually displacing water, instead of resting entirely above the surface
const BOAT_WATERLINE_LOCAL_Y = BOAT_HULL_CENTER_Y - BOAT_HULL_HALF_HEIGHT * 0.3;
const BOAT_Y_OFFSET = -BOAT_WATERLINE_LOCAL_Y * BOAT_SCALE;

const BLACKMARKET_CHECK_INTERVAL = 20; // seconds between arrival rolls, once eligible
const BLACKMARKET_CHANCE = 0.2;
const BLACKMARKET_DOCK_DURATION = 35; // gives up and leaves if ignored this long
const BLACKMARKET_LEAVE_COOLDOWN = 20; // minimum gap after it sails off before it can be rolled again
const blackMarketState = {
  phase: 'idle', // idle | arriving | docked | leaving
  timer: 0,
  nextCheckAt: 18 + Math.random() * 12,
  startPos: new THREE.Vector3(),
  dockPos: new THREE.Vector3(),
  exitPos: new THREE.Vector3()
};

// the camera's horizontal view narrows the closer z gets to the camera, so the
// dock spot (well within frame) and the entry point (well outside it, off to the
// side) both sit at roughly the same depth — the boat glides in from off-screen
// rather than fading into view where it happens to stop
function startBlackMarketEvent() {
  blackMarketTab = 'sell';
  blackMarketTransacted = false;
  const jitterX = (Math.random() - 0.5) * 3;
  const dockZ = -24;
  blackMarketState.dockPos.set(8 + jitterX, waterY, dockZ);
  blackMarketState.startPos.set(32 + jitterX * 0.3, waterY, dockZ + (Math.random() - 0.5) * 5);
  blackMarketState.exitPos.set(-30 + jitterX * 0.3, waterY, dockZ + (Math.random() - 0.5) * 5);
  blackMarketBoat.position.copy(blackMarketState.startPos);
  blackMarketBoat.rotation.set(0, Math.PI / 2, 0); // bow turned to head in -x — sails in from the right, and later leaves continuing the same way, off to the left
  blackMarketBoat.visible = true;
  blackMarketState.phase = 'arriving';
  blackMarketState.timer = 0;
}

function endBlackMarketVisit() {
  if (blackMarketState.phase === 'idle' || blackMarketState.phase === 'leaving') return;
  blackMarketState.phase = 'leaving';
  blackMarketState.timer = 0;
  blackMarketButtonEl.classList.add('unavailable');
  if (openPanel === 'blackmarket') closeEverything();
}

function updateBlackMarket(dt, t) {
  if (blackMarketState.phase === 'idle') {
    if (t >= blackMarketState.nextCheckAt) {
      blackMarketState.nextCheckAt = t + BLACKMARKET_CHECK_INTERVAL;
      if (pileFishes.length >= 10 && Math.random() < BLACKMARKET_CHANCE) startBlackMarketEvent();
    }
    return;
  }

  blackMarketState.timer += dt;
  const ARRIVE_DUR = 6, LEAVE_DUR = 6;

  if (blackMarketState.phase === 'arriving') {
    const p = Math.min(blackMarketState.timer / ARRIVE_DUR, 1);
    blackMarketBoat.position.lerpVectors(blackMarketState.startPos, blackMarketState.dockPos, p);
    if (p >= 1) {
      blackMarketState.phase = 'docked';
      blackMarketState.timer = 0;
      blackMarketButtonEl.classList.remove('unavailable');
      setMessage('A shady boat has pulled up out on the water...');
      showCatchPopup('Psst... the black market is here', false);
    }
  } else if (blackMarketState.phase === 'docked') {
    blackMarketBoat.position.x = blackMarketState.dockPos.x;
    blackMarketBoat.position.z = blackMarketState.dockPos.z;
    if (blackMarketState.timer >= BLACKMARKET_DOCK_DURATION) endBlackMarketVisit();
  } else if (blackMarketState.phase === 'leaving') {
    const p = Math.min(blackMarketState.timer / LEAVE_DUR, 1);
    blackMarketBoat.position.lerpVectors(blackMarketState.dockPos, blackMarketState.exitPos, p);
    if (p >= 1) {
      blackMarketState.phase = 'idle';
      blackMarketBoat.visible = false;
      blackMarketState.nextCheckAt = t + BLACKMARKET_LEAVE_COOLDOWN;
    }
  }

  const bx = blackMarketBoat.position.x, bz = blackMarketBoat.position.z;
  blackMarketBoat.position.y = waveHeight(bx, bz, t) + BOAT_Y_OFFSET;
  blackMarketBoat.rotation.z = Math.sin(t * 1.3 + bx) * 0.05;
  blackMarketBoat.rotation.x = Math.sin(t * 1.1 + bz) * 0.04;
  if (!blackMarketBoat.visible) return;

  animateWavingFlag(bmFlag, t);
  bmSail.rotation.y = Math.sin(t * 0.9) * 0.04;
  bmLanterns.forEach((l) => {
    const f = 0.75 + 0.25 * Math.sin(t * 11 + l.phase) * Math.sin(t * 4.3 + l.phase * 2);
    l.mesh.material.color.copy(l.base).multiplyScalar(f);
  });
  boatLanternLight.intensity = 0.75 + Math.sin(t * 13) * 0.1 + Math.sin(t * 7.3) * 0.08;
  bmSmuggler.rotation.z = Math.sin(t * 1.3) * 0.04; // shifting weight with the swell

  blackMarketState.fxTimer = (blackMarketState.fxTimer || 0) + dt;
  blackMarketState.smokeTimer = (blackMarketState.smokeTimer || 0) + dt;
  if (blackMarketState.phase !== 'docked' && blackMarketState.fxTimer > 0.08) {
    blackMarketState.fxTimer = 0;
    emitBoatWake(blackMarketBoat);
  }
  if (blackMarketState.smokeTimer > 0.4) {
    blackMarketState.smokeTimer = 0;
    spawnBoatSmoke(bmChimneyTop);
  }
}

// ------------------------------------------------------------------
// Police boat — the risk side of buying gear off the black market. Every item
// bought that way adds 2% to the odds it shows up the next time you land a
// catch; when it does, it docks just long enough to fine you, then leaves.
// ------------------------------------------------------------------
// ---- police boat: a crisp white patrol cruiser ----
const policeHullTex = makeHullTexture('#eef1f4', [
  [BOAT_HULL_KEEL_Y, 0.2, '#14233f'],
  [0.2, 0.4, '#1c3f6e'],   // navy band
  [0.42, 0.455, '#e8b730'] // gold pinstripe
]);
const policeHullMat = toonMat({ map: policeHullTex, roughness: 0.5, side: THREE.DoubleSide });
const policeDeckMat = toonMat({ color: 0xb9bec4, roughness: 0.9 });
const policeCabinMat = toonMat({ color: 0xf2f4f6, roughness: 0.5 });
const policeTrimMat = toonMat({ color: 0x1c3f6e, roughness: 0.6 });
const policeChromeMat = toonMat({ color: 0xd0d6dc, roughness: 0.3 });
const policeDarkMat = toonMat({ color: 0x1a1c20, roughness: 0.6 });
const policeGlassMat = new THREE.MeshBasicMaterial({ color: 0x1b2a3a, side: THREE.DoubleSide });
const policeLightRedMat = toonMat({ color: 0xff2222, emissive: 0xff0000, emissiveIntensity: 1.2 });
const policeLightBlueMat = toonMat({ color: 0x2255ff, emissive: 0x2255ff, emissiveIntensity: 1.2 });

const policeBoat = new THREE.Group();
policeBoat.visible = false;
scene.add(policeBoat);

makeBoatHullAndDeck(policeBoat, policeHullMat, policeDeckMat);
addHullSideDecals(policeBoat, makeTextDecalTexture((ctx, w, h) => {
  // gold star badge, then bold POLICE lettering
  const cx = 70, cy = h / 2, R = 46;
  ctx.fillStyle = '#e8b730';
  ctx.strokeStyle = '#1c3f6e';
  ctx.lineWidth = 5;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? R * 0.45 : R, a = -Math.PI / 2 + i * Math.PI / 5;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.font = 'italic 900 96px "Arial Black", Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#1c3f6e';
  ctx.fillText('POLICE', 140, cy + 6);
}, 1024, 128), 0.25, 2.3, 0.29);

// enclosed wheelhouse with a raked windshield — an extruded side profile
const PD = boatDeckYAt(0.4);
const PCAB_FRONT = -0.55, PCAB_BACK = 1.3, PCAB_W = 1.3, PCAB_H = 1.1;
const PCAB_SILL = PD + 0.5;               // where the windshield starts
const PCAB_SHIELD_TOP_Z = PCAB_FRONT + 0.45;
{
  // shape coords are (-z, y); extruded across the beam, then turned to lie along the boat
  const shape = new THREE.Shape();
  shape.moveTo(-PCAB_BACK, PD);
  shape.lineTo(-PCAB_FRONT, PD);
  shape.lineTo(-PCAB_FRONT, PCAB_SILL);
  shape.lineTo(-PCAB_SHIELD_TOP_Z, PD + PCAB_H);
  shape.lineTo(-PCAB_BACK, PD + PCAB_H);
  shape.lineTo(-PCAB_BACK, PD);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: PCAB_W, bevelEnabled: false });
  geo.rotateY(Math.PI / 2);
  geo.translate(-PCAB_W / 2, 0, 0);
  const cabin = centeredMesh(geo, policeCabinMat);
  cabin.castShadow = true;
  addOutline(cabin, 1.03);
  policeBoat.add(cabin);
}
// tinted windshield laid on the raked face
{
  const dz = PCAB_SHIELD_TOP_Z - PCAB_FRONT, dy = PD + PCAB_H - PCAB_SILL;
  const len = Math.hypot(dz, dy), a = Math.atan2(dz, dy);
  const shield = new THREE.Mesh(new THREE.PlaneGeometry(PCAB_W - 0.14, len * 0.8), policeGlassMat);
  shield.rotation.x = a;
  shield.position.set(0, PCAB_SILL + dy / 2 + Math.sin(a) * 0.012, PCAB_FRONT + dz / 2 - Math.cos(a) * 0.012);
  policeBoat.add(shield);
}
[-1, 1].forEach((side) => {
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.32), policeGlassMat);
  win.rotation.y = side * Math.PI / 2;
  win.position.set(side * (PCAB_W / 2 + 0.006), PD + 0.8, 0.65);
  policeBoat.add(win);
});
const PROOF_Y = PD + PCAB_H;
boxAt(policeBoat, PCAB_W + 0.16, 0.07, PCAB_BACK - PCAB_SHIELD_TOP_Z + 0.25, policeTrimMat, 0, PROOF_Y + 0.035, (PCAB_BACK + PCAB_SHIELD_TOP_Z) / 2 + 0.05);

// roof light bar — red/blue lenses with additive glow sprites for the strobe
const PBAR_Y = PROOF_Y + 0.07;
boxAt(policeBoat, 0.95, 0.06, 0.22, policeDarkMat, 0, PBAR_Y + 0.03, 0.35);
const policeLightRed = boxAt(policeBoat, 0.38, 0.12, 0.2, policeLightRedMat, -0.25, PBAR_Y + 0.12, 0.35, false);
const policeLightBlue = boxAt(policeBoat, 0.38, 0.12, 0.2, policeLightBlueMat, 0.25, PBAR_Y + 0.12, 0.35, false);
function makePoliceGlow(color, x) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softRadialTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.set(1.6, 1.6, 1);
  s.position.set(x, PBAR_Y + 0.14, 0.35);
  policeBoat.add(s);
  return s;
}
const policeGlowRed = makePoliceGlow(0xff3030, -0.25);
const policeGlowBlue = makePoliceGlow(0x3a6bff, 0.25);
const policeLight = new THREE.PointLight(0xff2222, 0.9, 7);
policeLight.position.set(0, PBAR_Y + 0.3, 0.35);
policeBoat.add(policeLight);

// radar arm spinning on a short post, plus a whip antenna
policeBoat.add(limb(new THREE.Vector3(0, PROOF_Y + 0.07, 1.0), new THREE.Vector3(0, PROOF_Y + 0.3, 1.0), 0.04, 0.035, policeChromeMat));
const policeRadar = new THREE.Group();
policeRadar.position.set(0, PROOF_Y + 0.32, 1.0);
boxAt(policeRadar, 0.7, 0.06, 0.08, policeCabinMat, 0, 0, 0);
policeBoat.add(policeRadar);
policeBoat.add(limb(new THREE.Vector3(0.5, PROOF_Y + 0.07, 1.15), new THREE.Vector3(0.62, PROOF_Y + 1.25, 1.35), 0.018, 0.008, policeDarkMat, false));

// swiveling searchlight on the roof's front edge, with a soft additive beam
const policeSearchYaw = new THREE.Group();
policeSearchYaw.position.set(0.45, PROOF_Y + 0.14, PCAB_SHIELD_TOP_Z + 0.1);
policeBoat.add(policeSearchYaw);
const policeSearchPitch = new THREE.Group();
policeSearchPitch.rotation.x = 0.28;
policeSearchYaw.add(policeSearchPitch);
{
  const lampGeo = new THREE.CylinderGeometry(0.09, 0.07, 0.16, 12);
  lampGeo.rotateX(Math.PI / 2);
  const lamp = new THREE.Mesh(lampGeo, policeDarkMat);
  addOutline(lamp, 1.08);
  policeSearchPitch.add(lamp);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.075, 12), new THREE.MeshBasicMaterial({ color: 0xfff6d0 }));
  lens.position.z = 0.081;
  policeSearchPitch.add(lens);
  const beamLen = 4.2;
  const beamGeo = new THREE.ConeGeometry(0.75, beamLen, 20, 1, true);
  beamGeo.translate(0, -beamLen / 2, 0);
  beamGeo.rotateX(-Math.PI / 2); // tip at the lamp, widening out along +z
  const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({
    color: 0xfff2c0, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending
  }));
  beam.position.z = 0.08;
  policeSearchPitch.add(beam);
}

// chrome bow rail running forward from the wheelhouse to the stem
[-1, 1].forEach((side) => {
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const t = 0.52 + (i / 8) * 0.44;
    const s = boatHullStation(t);
    pts.push(new THREE.Vector3(side * Math.max(0, s.w - 0.07), s.top + 0.22, s.z));
  }
  for (let i = 0; i < pts.length - 1; i++) policeBoat.add(limb(pts[i], pts[i + 1], 0.02, 0.02, policeChromeMat, false));
  for (let i = 0; i < pts.length - 1; i += 2) {
    policeBoat.add(limb(new THREE.Vector3(pts[i].x, pts[i].y - 0.22, pts[i].z), pts[i], 0.018, 0.018, policeChromeMat, false));
  }
});

// orange life ring mounted on the wheelhouse side facing the wharf (+x once docked)
{
  const c = document.createElement('canvas');
  c.width = 64; c.height = 8;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#ffffff' : '#ff6a1a'; ctx.fillRect(i * 8, 0, 8, 8); }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.05, 8, 24), toonMat({ map: new THREE.CanvasTexture(c), roughness: 0.6 }));
  ring.rotation.y = Math.PI / 2;
  ring.position.set(PCAB_W / 2 + 0.05, PD + 0.38, 0.95);
  addOutline(ring, 1.06);
  policeBoat.add(ring);
}

// twin outboards hung off the transom
[-0.42, 0.42].forEach((x) => {
  const sz = BOAT_HULL_STERN_Z + 0.22;
  boxAt(policeBoat, 0.32, 0.42, 0.38, policeDarkMat, x, BOAT_HULL_TOP_Y + 0.12, sz);
  boxAt(policeBoat, 0.3, 0.1, 0.36, policeChromeMat, x, BOAT_HULL_TOP_Y + 0.37, sz, false);
  policeBoat.add(limb(new THREE.Vector3(x, BOAT_HULL_TOP_Y - 0.08, sz), new THREE.Vector3(x, BOAT_HULL_KEEL_Y - 0.1, sz + 0.05), 0.06, 0.045, policeDarkMat));
});

// the officer on the aft deck, megaphone arm raised once the boat's docked
const policeOfficer = new THREE.Group();
const policeMegaphoneArm = new THREE.Group();
{
  const uniformMat = toonMat({ color: 0x1c2c4a, roughness: 0.8 });
  const g = policeOfficer;
  [-0.07, 0.07].forEach((x) => g.add(limb(new THREE.Vector3(x, 0, 0), new THREE.Vector3(x, 0.38, 0), 0.055, 0.065, uniformMat)));
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.12, 0.34, 10), uniformMat);
  body.position.y = 0.55;
  body.castShadow = true;
  addOutline(body, 1.06);
  g.add(body);
  // hi-vis vest band
  const vest = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.13, 0.06, 10), toonMat({ color: 0xd6ff3a }));
  vest.position.y = 0.6;
  g.add(vest);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 12), skinMat);
  head.position.y = 0.81;
  addOutline(head, 1.08);
  g.add(head);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.09, 0.06, 12), policeTrimMat);
  cap.position.y = 0.88;
  addOutline(cap, 1.08);
  g.add(cap);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.015, 0.08), policeDarkMat);
  brim.position.set(0, 0.86, -0.1);
  g.add(brim);
  g.add(limb(new THREE.Vector3(-0.14, 0.68, 0), new THREE.Vector3(-0.16, 0.42, 0.02), 0.04, 0.035, uniformMat));
  policeMegaphoneArm.position.set(0.14, 0.68, 0);
  policeMegaphoneArm.add(limb(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.02, -0.26, 0), 0.04, 0.035, uniformMat));
  const megaGeo = new THREE.ConeGeometry(0.06, 0.16, 12, 1, true);
  const mega = new THREE.Mesh(megaGeo, toonMat({ color: 0xf2f2f2, side: THREE.DoubleSide }));
  mega.position.set(0.02, -0.3, 0); // cone's narrow tip sits at the hand, bell flares out past it
  policeMegaphoneArm.add(mega);
  g.add(policeMegaphoneArm);
}
policeOfficer.position.set(0.45, boatDeckYAt(1.95), 1.95);
policeOfficer.rotation.y = -Math.PI / 2; // faces +x, toward the wharf
policeBoat.add(policeOfficer);

policeBoat.scale.setScalar(BOAT_SCALE);

const POLICE_FINE = 200;
const POLICE_ARRIVE_DUR = 5, POLICE_DOCK_DURATION = 4, POLICE_LEAVE_DUR = 5;
const policeState = {
  phase: 'idle', // idle | arriving | docked | leaving
  timer: 0,
  startPos: new THREE.Vector3(),
  dockPos: new THREE.Vector3(),
  exitPos: new THREE.Vector3(),
  gearCheck: false,  // came over black market gear — runs issuePolicePenalty() on docking
  collectLoan: false // came for an overdue bank loan — runs collectLoanByPolice() on docking
};
let loanCollectionQueued = false; // a loan collection waiting for the boat to finish its current trip

// reason is 'gear' (black market — the default, also used by the cheat menu)
// or 'loan' (an overdue bank loan)
function startPoliceBoatEvent(reason = 'gear') {
  policeState.gearCheck = reason === 'gear';
  policeState.collectLoan = reason === 'loan';
  const jitterX = (Math.random() - 0.5) * 3;
  const dockZ = -20;
  policeState.dockPos.set(-6 + jitterX, waterY, dockZ);
  policeState.startPos.set(-32 + jitterX * 0.3, waterY, dockZ + (Math.random() - 0.5) * 5);
  policeState.exitPos.set(32 + jitterX * 0.3, waterY, dockZ + (Math.random() - 0.5) * 5);
  policeBoat.position.copy(policeState.startPos);
  policeBoat.rotation.set(0, -Math.PI / 2, 0); // bow turned to head in +x — comes in from the left, leaves the same way off to the right
  policeBoat.visible = true;
  policeState.phase = 'arriving';
  policeState.timer = 0;
}

// rolled once per successful rod catch or net swoop — only ever fires if
// you own at least one piece of black-market gear
function maybeTriggerPoliceBoat() {
  if (blackMarketItemsBought <= 0 || policeState.phase !== 'idle') return;
  const chance = Math.min(0.02 * blackMarketItemsBought, 0.2);
  if (Math.random() < chance) startPoliceBoatEvent();
}

// sends the police after an overdue loan. if the boat is already heading in,
// it picks up the collection on the same trip; if it's docked or leaving,
// the collection waits and a fresh trip starts once it's gone
function callLoanPolice() {
  if (policeState.phase === 'idle') startPoliceBoatEvent('loan');
  else if (policeState.phase === 'arriving') policeState.collectLoan = true;
  else loanCollectionQueued = true;
}

function issuePoliceFine() {
  const fine = Math.max(0, Math.min(POLICE_FINE, coins)); // never a negative "fine" when coins are already below zero
  addCoins(-fine);
  setMessage(`Police boat! Fined ${fine} 🪙.`);
  showCatchPopup(`Busted! -${fine} 🪙`, true);
}

// goes after whatever was bought most recently from the black market — seizes
// it if it's still actually in your possession, otherwise falls back to a fine
function issuePolicePenalty() {
  const item = lastBlackMarketItem;
  if (!item) { issuePoliceFine(); return; }

  if (item.kind === 'autocaster' && autoRecastOwned) {
    autoRecastOwned = false;
    autoRecastEnabled = false;
    saveAutoRecastOwned();
    saveAutoRecastEnabled();
    setMessage('Police boat! Confiscated your Auto-Caster.');
    showCatchPopup('Busted! Auto-Caster seized', true);
    return;
  }
  if (item.kind === 'net' && netOwned) {
    netOwned = false;
    saveNetOwned();
    if (equippedTool === 'net') { equippedTool = 'rod'; applyToolVisibility(); }
    updateToolSwapButton();
    setMessage('Police boat! Confiscated your Fishing Net.');
    showCatchPopup('Busted! Net seized', true);
    return;
  }
  if (item.kind === 'hat' && hatOwned) {
    blowHatOff();
    setMessage('Police boat! Confiscated your Fishing Hat.');
    showCatchPopup('Busted! Hat seized', true);
    return;
  }
  if (item.kind === 'radio' && radioOwned) {
    radioOwned = false;
    radioPlaying = false;
    radioGroup.visible = false;
    stopRadioMusic();
    setMessage('Police boat! Confiscated your Radio.');
    showCatchPopup('Busted! Radio seized', true);
    return;
  }
  if (item.kind === 'rod' && highestRodTier === item.tier && item.tier > 0) {
    const seized = ROD_TIERS[item.tier].name;
    highestRodTier = item.tier - 1;
    saveHighestRodTier();
    if (rodTier > highestRodTier) { rodTier = highestRodTier; saveRodTier(); }
    applyToolVisibility();
    setMessage(`Police boat! Repossessed your ${seized}.`);
    showCatchPopup(`Busted! ${seized} seized`, true);
    return;
  }
  if (item.kind === 'food' && (foodOwned[item.tierId] || 0) > 0) {
    foodOwned[item.tierId]--;
    saveFoodOwned();
    const tierDef = FISH_FOOD_TIERS.find((t) => t.id === item.tierId);
    setMessage(`Police boat! Confiscated your ${tierDef ? tierDef.name : 'Fish Food'}.`);
    showCatchPopup('Busted! Fish Food seized', true);
    return;
  }
  issuePoliceFine();
}

function updatePoliceBoat(dt, t) {
  if (policeState.phase === 'idle') return;
  policeState.timer += dt;

  if (policeState.phase === 'arriving') {
    const p = Math.min(policeState.timer / POLICE_ARRIVE_DUR, 1);
    policeBoat.position.lerpVectors(policeState.startPos, policeState.dockPos, p);
    if (p >= 1) {
      policeState.phase = 'docked';
      policeState.timer = 0;
      if (policeState.collectLoan) collectLoanByPolice();
      if (policeState.gearCheck) {
        // on a combined trip, hold the gear penalty back a moment so its
        // popup doesn't overwrite the loan one
        if (policeState.collectLoan) setTimeout(issuePolicePenalty, 1800);
        else issuePolicePenalty();
      }
    }
  } else if (policeState.phase === 'docked') {
    policeBoat.position.x = policeState.dockPos.x;
    policeBoat.position.z = policeState.dockPos.z;
    if (policeState.timer >= POLICE_DOCK_DURATION) {
      policeState.phase = 'leaving';
      policeState.timer = 0;
    }
  } else if (policeState.phase === 'leaving') {
    const p = Math.min(policeState.timer / POLICE_LEAVE_DUR, 1);
    policeBoat.position.lerpVectors(policeState.dockPos, policeState.exitPos, p);
    if (p >= 1) {
      policeState.phase = 'idle';
      policeBoat.visible = false;
      if (loanCollectionQueued) {
        loanCollectionQueued = false;
        startPoliceBoatEvent('loan');
      }
    }
  }

  const px = policeBoat.position.x, pz = policeBoat.position.z;
  policeBoat.position.y = waveHeight(px, pz, t) + BOAT_Y_OFFSET;
  policeBoat.rotation.z = Math.sin(t * 1.3 + px) * 0.05;
  policeBoat.rotation.x = Math.sin(t * 1.1 + pz) * 0.04;
  if (!policeBoat.visible) return;

  // double-strobe: red-red, then blue-blue
  const cyc = (t * 1.6) % 1;
  const redOn = cyc < 0.1 || (cyc > 0.18 && cyc < 0.28);
  const blueOn = (cyc > 0.5 && cyc < 0.6) || (cyc > 0.68 && cyc < 0.78);
  policeLightRedMat.emissiveIntensity = redOn ? 1.6 : 0.15;
  policeLightBlueMat.emissiveIntensity = blueOn ? 1.6 : 0.15;
  policeGlowRed.visible = redOn;
  policeGlowBlue.visible = blueOn;
  policeLight.color.set(redOn ? 0xff2222 : 0x2255ff);
  policeLight.intensity = redOn || blueOn ? 1.3 : 0.25;

  policeSearchYaw.rotation.y = Math.PI / 2 + Math.sin(t * 0.8) * 0.7;
  policeRadar.rotation.y += dt * 3;

  const armTarget = policeState.phase === 'docked' ? 1.45 : 0;
  policeMegaphoneArm.rotation.x += (armTarget - policeMegaphoneArm.rotation.x) * Math.min(1, dt * 5);

  policeState.fxTimer = (policeState.fxTimer || 0) + dt;
  if (policeState.phase !== 'docked' && policeState.fxTimer > 0.07) {
    policeState.fxTimer = 0;
    emitBoatWake(policeBoat);
  }
}

// ------------------------------------------------------------------
// The Kraken — a rare special event, cheat-only for now. Nothing like the
// hold-and-align reel/net games: this is a tug-of-war where you alternate
// two buttons to reel it in while it constantly drags the rope back toward
// itself. Mash one side without alternating and it actively costs you ground.
// ------------------------------------------------------------------
const krakenMat = toonMat({ color: 0x3a1f4a, roughness: 0.75 });
const krakenSuckerMat = toonMat({ color: 0x8a4aa0, roughness: 0.55 });
const krakenEyeMat = toonMat({ color: 0xd8502f, roughness: 0.3 });
const krakenPupilMat = new THREE.MeshBasicMaterial({ color: 0x0a0510 });

const krakenGroup = new THREE.Group();
krakenGroup.visible = false;
scene.add(krakenGroup);

// a head reads as "a creature," not just six sticks — gives the whole thing
// a silhouette and something to glare at the player with while it fights
const krakenHead = new THREE.Mesh(new THREE.SphereGeometry(0.85, 16, 12), krakenMat);
krakenHead.scale.set(1, 0.85, 1);
krakenHead.position.y = 0.65;
krakenGroup.add(krakenHead);
addOutline(krakenHead, 1.05);
[-1, 1].forEach((side) => {
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), krakenEyeMat);
  eye.position.set(side * 0.33, 0.8, 0.68);
  krakenGroup.add(eye);
  addOutline(eye, 1.1);
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), krakenPupilMat);
  pupil.position.set(side * 0.33, 0.8, 0.8);
  krakenGroup.add(pupil);
});

const KRAKEN_TENTACLE_COUNT = 6;
const krakenTentaclePivots = [];
for (let i = 0; i < KRAKEN_TENTACLE_COUNT; i++) {
  const pivot = new THREE.Group();
  const ang = (i / KRAKEN_TENTACLE_COUNT) * Math.PI * 2;
  pivot.position.set(Math.cos(ang) * 1.0, 0, Math.sin(ang) * 1.0);
  pivot.add(limb(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 2.4 + (i % 2) * 0.5, 0), 0.3, 0.07, krakenMat));
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), krakenSuckerMat);
  tip.position.set(0, 2.4 + (i % 2) * 0.5, 0);
  addOutline(tip);
  pivot.add(tip);
  // a couple of smaller suckers further down the tentacle, not just at the
  // tip — the one other cheap detail that actually reads at this silhouette
  // scale without modeling full curved/segmented tentacles
  [0.45, 0.75].forEach((f) => {
    const sucker = new THREE.Mesh(new THREE.SphereGeometry(0.085, 6, 6), krakenSuckerMat);
    sucker.position.set(0.12, (2.4 + (i % 2) * 0.5) * f, 0);
    addOutline(sucker, 1.1);
    pivot.add(sucker);
  });
  krakenGroup.add(pivot);
  krakenTentaclePivots.push(pivot);
}

// Pre-emergence tell — a dark whirlpool decal that spins up on the water's
// surface, plus a steady stream of rising bubbles, both at the spot the
// kraken is about to burst out of. Gives the player a beat of "something is
// coming" before it actually appears, rather than it just popping into being.
function makeKrakenSwirlTexture() {
  const s = 128, cx = s / 2, cy = s / 2;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const base = ctx.createRadialGradient(cx, cy, 0, cx, cy, s / 2);
  base.addColorStop(0, 'rgba(8,6,16,0.8)');
  base.addColorStop(0.6, 'rgba(8,6,16,0.45)');
  base.addColorStop(1, 'rgba(8,6,16,0)');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = 'rgba(210,222,255,0.55)';
  ctx.lineWidth = 3;
  for (let arm = 0; arm < 3; arm++) {
    const armOffset = (arm / 3) * Math.PI * 2;
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
      const tt = i / 60;
      const theta = tt * Math.PI * 2.4 + armOffset;
      const r = tt * (s / 2 - 6);
      const x = cx + Math.cos(theta) * r, y = cy + Math.sin(theta) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return new THREE.CanvasTexture(c);
}
// depthTest stays ON (default) — the wharf/pilings/character need to be able
// to occlude this normally when it's actually behind them. renderOrder alone
// (below) is enough to keep it layered above the water specifically.
const krakenSwirlMat = new THREE.MeshBasicMaterial({
  map: makeKrakenSwirlTexture(), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide
});
const krakenSwirlMesh = new THREE.Mesh(new THREE.CircleGeometry(1.8, 32), krakenSwirlMat);
krakenSwirlMesh.rotation.x = -Math.PI / 2;
krakenSwirlMesh.visible = false;
krakenSwirlMesh.renderOrder = 10; // explicit, so it draws after (on top of) the water regardless of distance-sort
scene.add(krakenSwirlMesh);

const KRAKEN_BUBBLE_COUNT = 10;
const krakenBubbles = [];
for (let i = 0; i < KRAKEN_BUBBLE_COUNT; i++) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.05 + Math.random() * 0.04, 6, 6), mat);
  mesh.visible = false;
  mesh.renderOrder = 10;
  scene.add(mesh);
  krakenBubbles.push({ mesh, t: 0, dur: 0, active: false, baseX: 0, baseZ: 0, phase: Math.random() * Math.PI * 2 });
}
let krakenBubbleSpawnTimer = 0;
function spawnKrakenBubble() {
  const b = krakenBubbles.find((b) => !b.active) || krakenBubbles[0];
  b.active = true;
  b.t = 0;
  b.dur = 1.0 + Math.random() * 0.8;
  const ang = Math.random() * Math.PI * 2, rad = Math.random() * 1.3 * KRAKEN_SIZE;
  b.baseX = krakenGroup.position.x + Math.cos(ang) * rad;
  b.baseZ = krakenGroup.position.z + Math.sin(ang) * rad;
  b.mesh.visible = true;
  b.mesh.scale.setScalar((0.6 + Math.random() * 0.6) * Math.sqrt(KRAKEN_SIZE));
}
function updateKrakenBubbles(dt, t) {
  krakenBubbles.forEach((b) => {
    if (!b.active) return;
    b.t += dt;
    const p = b.t / b.dur;
    if (p >= 1) { b.active = false; b.mesh.visible = false; return; }
    const y = waveHeight(b.baseX, b.baseZ, t) + 0.05 + p * 0.9;
    const wob = Math.sin(t * 4 + b.phase) * 0.05;
    b.mesh.position.set(b.baseX + wob, y, b.baseZ);
    b.mesh.material.opacity = Math.sin(p * Math.PI) * 0.55;
  });
}

const KRAKEN_WARNING_DUR = 4.5;
const KRAKEN_RISE_DUR = 1.4;
const KRAKEN_SINK_DUR = 1.3;
const KRAKEN_REWARD = 800;
const KRAKEN_SIZE = 2.5; // overall scale of the whole rig at full height — the rise/sink animations scale relative to this

// Heave — replaces the old tug-of-war. That one was just "alternate as fast
// as you physically can," which meant raw mashing speed always won. This one
// can't be beaten by speed at all: a marker auto-oscillates back and forth on
// its own, there's a narrow sweet zone, and a single HEAVE button only does
// anything once every cooldown. Spam it and you're pressing at essentially
// random phase — mostly misses, which cost more than a hit is worth — so the
// only way to come out ahead is actually timing it to the swing.
const KRAKEN_HEAVE_TIME_LIMIT = 22;
const KRAKEN_DRAIN_RATE = 0.13; // per second, constantly pulls back toward the kraken
const KRAKEN_HEAVE_GAIN = 0.19;
const KRAKEN_HEAVE_MISS_LOSS = 0.12; // no click cooldown, so this alone is what makes spamming a losing bet
const KRAKEN_HEAVE_PERIOD_MAX = 3.4; // seconds per full swing early on
const KRAKEN_HEAVE_PERIOD_MIN = 2.0; // swings faster as tension climbs
const KRAKEN_HEAVE_ZONE_MAX = 0.26; // fraction of the swing width, forgiving early
const KRAKEN_HEAVE_ZONE_MIN = 0.13; // narrows near the end

// Frenzy — the harder alternative mode. No steady rhythm to fall into: a
// random direction flashes up and you have to hit that exact button before
// its window closes. Wrong button or too slow both cost real ground, and the
// window keeps shrinking as you get closer to landing it. Runs longer than
// Heave and takes more clean hits to close out — a real endurance test.
const KRAKEN_DIRECTIONS = ['up', 'down', 'left', 'right'];
const KRAKEN_FRENZY_TIME_LIMIT = 26;
const KRAKEN_FRENZY_GAIN = 0.09;
const KRAKEN_FRENZY_MISS_LOSS = 0.16;
const KRAKEN_FRENZY_PROMPT_TIME_MAX = 0.8;
const KRAKEN_FRENZY_PROMPT_TIME_MIN = 0.32;

const krakenState = {
  phase: 'idle', // idle | warning | rising | fighting | sinking
  mode: 'heave', // heave | frenzy
  timer: 0,
  tension: 0.5, // 0 = it escapes, 1 = you land it
  heaveMarkerPos: 0.5,
  heaveSweepTimer: 0,
  heaveSweepDir: 1,
  heaveHits: 0, // current hit streak — shrinks the zone and speeds up the swing, resets to 0 on a miss
  prompt: null,
  promptTime: 0,
  promptTimer: 0
};

const krakenUIEl = document.getElementById('krakenUI');
const krakenMarkerEl = document.getElementById('krakenMarker');
const krakenZoneEl = document.getElementById('krakenZone');
const krakenHeaveBtnEl = document.getElementById('krakenHeaveBtn');
const krakenProgressFillEl = document.getElementById('krakenProgressFill');

const krakenFrenzyUIEl = document.getElementById('krakenFrenzyUI');
const krakenPromptGlyphEl = document.getElementById('krakenPromptGlyph');
const krakenFrenzyTimerFillEl = document.getElementById('krakenFrenzyTimerFill');
const krakenFrenzyProgressFillEl = document.getElementById('krakenFrenzyProgressFill');
const krakenDirBtnEls = Array.from(document.querySelectorAll('.kraken-dir-btn'));
const KRAKEN_DIRECTION_GLYPHS = { up: '▲', down: '▼', left: '◄', right: '►' };

// Suspense cues — screen vignette, a dimming/desaturating sky and lights, and
// a camera shake. Driven by a single 0..1 intensity the caller computes per
// phase: eased in across the whole (now longer) warning build-up, held at
// full through the rise and the fight itself, then eased back out as it
// sinks away. Base values captured once so they can be restored exactly
// rather than drifting from repeated lerps.
const krakenVignetteEl = document.getElementById('krakenVignette');
const krakenCameraBase = camera.position.clone();
const krakenSkyBase = {
  top: skyMat.uniforms.topColor.value.clone(),
  horizon: skyMat.uniforms.horizonColor.value.clone(),
  bottom: skyMat.uniforms.bottomColor.value.clone()
};
const krakenLightBase = { sun: sunLight.intensity, hemi: hemi.intensity, fill: fill.intensity };
function resetKrakenSuspenseFx() {
  krakenVignetteEl.style.opacity = '0';
  skyMat.uniforms.topColor.value.copy(krakenSkyBase.top);
  skyMat.uniforms.horizonColor.value.copy(krakenSkyBase.horizon);
  skyMat.uniforms.bottomColor.value.copy(krakenSkyBase.bottom);
  sunLight.intensity = krakenLightBase.sun;
  hemi.intensity = krakenLightBase.hemi;
  fill.intensity = krakenLightBase.fill;
  camera.position.copy(krakenCameraBase);
}
function applyKrakenSuspenseFx(e) {
  krakenVignetteEl.style.opacity = String(e * 0.8);
  const darken = 1 - e * 0.55;
  skyMat.uniforms.topColor.value.copy(krakenSkyBase.top).multiplyScalar(darken);
  skyMat.uniforms.horizonColor.value.copy(krakenSkyBase.horizon).multiplyScalar(darken);
  skyMat.uniforms.bottomColor.value.copy(krakenSkyBase.bottom).multiplyScalar(darken);
  sunLight.intensity = krakenLightBase.sun * darken;
  hemi.intensity = krakenLightBase.hemi * darken;
  fill.intensity = krakenLightBase.fill * darken;
  const shake = e * 0.09;
  camera.position.set(
    krakenCameraBase.x + (Math.random() - 0.5) * shake,
    krakenCameraBase.y + (Math.random() - 0.5) * shake,
    krakenCameraBase.z + (Math.random() - 0.5) * shake * 0.5
  );
}

function startKrakenEvent(mode) {
  if (krakenState.phase !== 'idle') return;
  closeEverything();
  const spot = state.castTarget;
  krakenGroup.position.set(spot.x + (Math.random() - 0.5) * 3, waterY, spot.z + (Math.random() - 0.5) * 3);
  krakenGroup.scale.setScalar(0.05);
  krakenGroup.visible = false; // stays hidden through the warning build-up — only the swirl/bubbles show
  krakenState.phase = 'warning';
  krakenState.mode = mode || (Math.random() < 0.7 ? 'frenzy' : 'heave');
  krakenState.timer = 0;
  krakenState.tension = 0.5;
  krakenState.heaveMarkerPos = 0.5;
  krakenState.heaveSweepTimer = 0;
  krakenState.heaveSweepDir = 1;
  krakenState.heaveHits = 0;
  krakenSwirlMesh.position.set(krakenGroup.position.x, waterY + 0.02, krakenGroup.position.z);
  krakenSwirlMesh.rotation.z = 0;
  krakenSwirlMesh.scale.setScalar(0.3 * KRAKEN_SIZE);
  krakenSwirlMesh.visible = true;
  krakenSwirlMat.opacity = 0;
  krakenBubbleSpawnTimer = 0;
  setMessage('The water churns ominously...');
}

// every successful heave shrinks the zone and speeds up the swing a step —
// a single miss resets both all the way back to easy, so it's a streak you
// have to keep alive rather than a one-way ramp
const KRAKEN_HEAVE_SHRINK_PER_HIT = 0.025;
const KRAKEN_HEAVE_SPEEDUP_PER_HIT = 0.22; // seconds shaved off the swing period per hit
function krakenHeaveZoneWidth() {
  return Math.max(KRAKEN_HEAVE_ZONE_MIN, KRAKEN_HEAVE_ZONE_MAX - krakenState.heaveHits * KRAKEN_HEAVE_SHRINK_PER_HIT);
}
function krakenHeavePeriod() {
  return Math.max(KRAKEN_HEAVE_PERIOD_MIN, KRAKEN_HEAVE_PERIOD_MAX - krakenState.heaveHits * KRAKEN_HEAVE_SPEEDUP_PER_HIT);
}

function updateKrakenUI() {
  const zw = krakenHeaveZoneWidth();
  krakenZoneEl.style.width = (zw * 100) + '%';
  krakenZoneEl.style.marginLeft = (-zw * 50) + '%';
  krakenMarkerEl.style.left = (krakenState.heaveMarkerPos * 100) + '%';
  krakenProgressFillEl.style.width = (krakenState.tension * 100) + '%';
}

function krakenHeave() {
  if (krakenState.phase !== 'fighting' || krakenState.mode !== 'heave') return;
  const inZone = Math.abs(krakenState.heaveMarkerPos - 0.5) < krakenHeaveZoneWidth() / 2;
  if (inZone) {
    krakenState.heaveHits++;
  } else {
    krakenState.heaveHits = 0; // miss resets the streak — zone widens and the swing slows back down
  }
  krakenState.tension = THREE.MathUtils.clamp(
    krakenState.tension + (inZone ? KRAKEN_HEAVE_GAIN : -KRAKEN_HEAVE_MISS_LOSS), 0, 1);
  updateKrakenUI();
  // check right here, not just in the per-frame loop — otherwise the constant
  // drain in updateKraken() ticks the tension back down a hair before the
  // next frame's check ever sees the 1.0 a winning heave just landed
  if (krakenState.tension >= 1) resolveKraken(true);
  else if (krakenState.tension <= 0) resolveKraken(false);
}
krakenHeaveBtnEl.addEventListener('click', (e) => { e.stopPropagation(); krakenHeave(); });
window.addEventListener('keydown', (e) => {
  if (krakenState.phase !== 'fighting') return;
  if (krakenState.mode === 'heave') {
    if (e.code === 'Space' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); krakenHeave(); }
    return;
  }
  if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') krakenFrenzyInput('up');
  else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') krakenFrenzyInput('down');
  else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') krakenFrenzyInput('left');
  else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') krakenFrenzyInput('right');
});

function nextKrakenPrompt(keepDirection) {
  // a timeout keeps the same arrow up (just restarts its clock) — only an
  // actual press moves on to a new direction
  if (!keepDirection || !krakenState.prompt) {
    const choices = KRAKEN_DIRECTIONS.filter((d) => d !== krakenState.prompt);
    krakenState.prompt = choices[Math.floor(Math.random() * choices.length)];
  }
  // the window shrinks as tension climbs, so the closer you are to landing it
  // the faster you have to react
  krakenState.promptTime = THREE.MathUtils.lerp(KRAKEN_FRENZY_PROMPT_TIME_MAX, KRAKEN_FRENZY_PROMPT_TIME_MIN, krakenState.tension);
  krakenState.promptTimer = krakenState.promptTime;
  updateKrakenFrenzyUI();
}

function updateKrakenFrenzyUI() {
  krakenPromptGlyphEl.textContent = KRAKEN_DIRECTION_GLYPHS[krakenState.prompt] || '?';
  const p = krakenState.promptTime > 0 ? Math.max(0, krakenState.promptTimer / krakenState.promptTime) : 0;
  krakenFrenzyTimerFillEl.style.width = (p * 100) + '%';
  krakenFrenzyProgressFillEl.style.width = (krakenState.tension * 100) + '%';
  krakenDirBtnEls.forEach((btn) => btn.classList.toggle('active', btn.dataset.dir === krakenState.prompt));
}

function krakenFrenzyInput(dir) {
  if (krakenState.phase !== 'fighting' || krakenState.mode !== 'frenzy') return;
  if (dir === krakenState.prompt) {
    krakenState.tension = THREE.MathUtils.clamp(krakenState.tension + KRAKEN_FRENZY_GAIN, 0, 1);
  } else {
    krakenState.tension = THREE.MathUtils.clamp(krakenState.tension - KRAKEN_FRENZY_MISS_LOSS, 0, 1);
  }
  if (krakenState.tension >= 1) { resolveKraken(true); return; }
  if (krakenState.tension <= 0) { resolveKraken(false); return; }
  nextKrakenPrompt();
}
krakenDirBtnEls.forEach((btn) => {
  btn.addEventListener('click', (e) => { e.stopPropagation(); krakenFrenzyInput(btn.dataset.dir); });
});

function resolveKraken(win) {
  krakenUIEl.style.display = 'none';
  krakenFrenzyUIEl.style.display = 'none';
  if (win) {
    addCoins(KRAKEN_REWARD);
    setMessage(`You beat the Kraken! +${KRAKEN_REWARD} 🪙`);
    showCatchPopup(`Kraken defeated! +${KRAKEN_REWARD} 🪙`, false);
  } else {
    setMessage('The Kraken dragged itself back into the deep...');
    showCatchPopup('The Kraken got away...', true);
  }
  krakenState.phase = 'sinking';
  krakenState.timer = 0;
}

function updateKraken(dt, t) {
  if (krakenState.phase === 'idle') return;
  krakenState.timer += dt;

  let krakenFxIntensity = 0;

  if (krakenState.phase === 'warning') {
    const p = Math.min(krakenState.timer / KRAKEN_WARNING_DUR, 1);
    krakenSwirlMesh.position.y = waveHeight(krakenGroup.position.x, krakenGroup.position.z, t) + 0.1;
    krakenSwirlMesh.rotation.z += dt * (1.5 + p * 2.5); // spins up faster as it builds toward the burst
    krakenSwirlMesh.scale.setScalar((0.3 + p * 0.9) * KRAKEN_SIZE);
    krakenSwirlMat.opacity = Math.sin(Math.min(p, 0.3) / 0.3 * Math.PI / 2) * 0.85; // quick fade in, held through the build-up
    krakenBubbleSpawnTimer -= dt;
    if (krakenBubbleSpawnTimer <= 0) {
      spawnKrakenBubble();
      krakenBubbleSpawnTimer = 0.12 + Math.random() * 0.1;
    }
    // sqrt rather than p² — reaches a strong level quickly and holds it
    // through most of the (now longer) build-up, instead of barely
    // registering until the last moment
    krakenFxIntensity = Math.sqrt(p);
    if (p >= 1) {
      krakenState.phase = 'rising';
      krakenState.timer = 0;
      krakenGroup.visible = true;
      krakenSwirlMesh.visible = false;
      krakenSwirlMat.opacity = 0;
      // suspense fx deliberately NOT reset here — they carry straight through
      // the rise and the fight, only easing out once it's gone (see 'sinking')
      triggerSplash(new THREE.Vector3(
        krakenGroup.position.x,
        waveHeight(krakenGroup.position.x, krakenGroup.position.z, t) + 0.02,
        krakenGroup.position.z
      ));
      showCatchPopup('The Kraken!', true);
    }
  } else if (krakenState.phase === 'rising') {
    const p = Math.min(krakenState.timer / KRAKEN_RISE_DUR, 1);
    const eased = 1 - Math.pow(1 - p, 3); // fast burst out of the water, settling in at the top
    krakenGroup.scale.setScalar((0.05 + 0.95 * eased) * KRAKEN_SIZE);
    krakenBubbleSpawnTimer -= dt;
    if (krakenBubbleSpawnTimer <= 0) {
      spawnKrakenBubble();
      krakenBubbleSpawnTimer = 0.15 + Math.random() * 0.15;
    }
    krakenFxIntensity = 1;
    if (p >= 1) {
      krakenState.phase = 'fighting';
      krakenState.timer = 0;
      if (krakenState.mode === 'heave') {
        setMessage('Fight it off! Time your heave to the surge!');
        krakenUIEl.style.display = 'flex';
        updateKrakenUI();
      } else {
        setMessage('Fight it off! Hit the right direction, fast!');
        krakenFrenzyUIEl.style.display = 'flex';
        krakenState.prompt = null;
        nextKrakenPrompt();
      }
    }
  } else if (krakenState.phase === 'fighting' && krakenState.mode === 'heave') {
    krakenFxIntensity = 1;
    krakenState.tension = THREE.MathUtils.clamp(krakenState.tension - KRAKEN_DRAIN_RATE * dt, 0, 1);
    // constant speed within a sweep — the pace only changes between sweeps,
    // as the hit streak shortens the period, not partway through one
    const period = krakenHeavePeriod();
    const halfPeriod = period / 2;
    krakenState.heaveSweepTimer += dt;
    if (krakenState.heaveSweepTimer >= halfPeriod) {
      krakenState.heaveSweepTimer -= halfPeriod;
      krakenState.heaveSweepDir *= -1;
    }
    const sweepP = THREE.MathUtils.clamp(krakenState.heaveSweepTimer / halfPeriod, 0, 1);
    const from = krakenState.heaveSweepDir === 1 ? 0 : 1;
    const to = krakenState.heaveSweepDir === 1 ? 1 : 0;
    krakenState.heaveMarkerPos = THREE.MathUtils.lerp(from, to, sweepP);
    updateKrakenUI();
    if (krakenState.tension >= 1) { resolveKraken(true); }
    else if (krakenState.tension <= 0) { resolveKraken(false); }
    else if (krakenState.timer >= KRAKEN_HEAVE_TIME_LIMIT) { resolveKraken(false); }
  } else if (krakenState.phase === 'fighting' && krakenState.mode === 'frenzy') {
    krakenFxIntensity = 1;
    krakenState.promptTimer -= dt;
    updateKrakenFrenzyUI();
    if (krakenState.promptTimer <= 0) {
      krakenState.tension = THREE.MathUtils.clamp(krakenState.tension - KRAKEN_FRENZY_MISS_LOSS, 0, 1);
      if (krakenState.tension <= 0) { resolveKraken(false); }
      else { nextKrakenPrompt(true); }
    } else if (krakenState.timer >= KRAKEN_FRENZY_TIME_LIMIT) {
      resolveKraken(false);
    }
  } else if (krakenState.phase === 'sinking') {
    const p = Math.min(krakenState.timer / KRAKEN_SINK_DUR, 1);
    krakenGroup.scale.setScalar((1 - p) * KRAKEN_SIZE);
    krakenFxIntensity = 1 - p; // eases back out to normal as it disappears, rather than snapping
    if (p >= 1) {
      krakenGroup.visible = false;
      krakenState.phase = 'idle';
      resetKrakenSuspenseFx(); // exact restore, avoids any float drift from the per-frame lerps
    }
  }
  if (krakenState.phase !== 'idle') applyKrakenSuspenseFx(krakenFxIntensity);

  if (krakenState.phase === 'fighting') {
    // a slower, ambient churn of bubbles continues around it while it fights
    krakenBubbleSpawnTimer -= dt;
    if (krakenBubbleSpawnTimer <= 0) {
      spawnKrakenBubble();
      krakenBubbleSpawnTimer = 0.4 + Math.random() * 0.3;
    }
  }
  updateKrakenBubbles(dt, t); // keeps already-spawned bubbles animating/fading even once sinking starts

  if (krakenState.phase !== 'idle') {
    const kx = krakenGroup.position.x, kz = krakenGroup.position.z;
    krakenGroup.position.y = waveHeight(kx, kz, t) + Math.sin(t * 3) * 0.15;
    krakenTentaclePivots.forEach((pivot, i) => {
      // a wild thrash as it breaches, settling to a steady fighting writhe,
      // and a gentler idle sway the rest of the time (e.g. during 'warning',
      // when the group is invisible anyway and this is just cheap upkeep)
      const intensity = krakenState.phase === 'rising' ? 1.4 : krakenState.phase === 'fighting' ? 1 : 0.35;
      pivot.rotation.z = Math.sin(t * 6 + i * 1.3) * 0.35 * intensity;
      pivot.rotation.x = Math.cos(t * 5 + i * 0.7) * 0.25 * intensity;
    });
  }
}

// ------------------------------------------------------------------
// Hired fishermen — a shared rowboat + figure rig, re-skinned per guy. We only
// see him when he's rowing back in with the 10 fish he caught for you.
// ------------------------------------------------------------------
const rowBoatMat = toonMat({ color: 0x7a5230, roughness: 0.8 });
const hireShirtMat = toonMat({ color: 0x3f6b42, roughness: 0.75 });
const hireHatMat = toonMat({ color: 0xd8c98a, roughness: 0.7 });
const hireBeardMat = toonMat({ color: 0x9a958c, roughness: 0.8 });

const hireRig = new THREE.Group();
hireRig.visible = false;
scene.add(hireRig);

const HIRE_HULL_CENTER_Y = 0.25;
const HIRE_HULL_HALF_HEIGHT = 0.25;

const hireHull = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.5, 3.4), rowBoatMat);
hireHull.position.set(0, HIRE_HULL_CENTER_Y, 0);
hireHull.castShadow = true;
addOutline(hireHull);
hireRig.add(hireHull);

const hireBow = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 1.0), rowBoatMat);
hireBow.rotation.y = Math.PI / 4;
hireBow.position.set(0, HIRE_HULL_CENTER_Y, -1.85);
hireBow.castShadow = true;
addOutline(hireBow);
hireRig.add(hireBow);

function makeOar(sign) {
  return limb(new THREE.Vector3(sign * 0.12, 0.7, 0.3), new THREE.Vector3(sign * 1.5, 0.35, 1.2), 0.04, 0.03, rowBoatMat);
}
hireRig.add(makeOar(1), makeOar(-1));

const hireTorso = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.6, 8), hireShirtMat);
hireTorso.position.set(0, 0.75, 0.2);
hireTorso.castShadow = true;
addOutline(hireTorso);
hireRig.add(hireTorso);

const hireHead = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), skinMat);
hireHead.position.set(0, 1.18, 0.15);
hireHead.castShadow = true;
addOutline(hireHead);
hireRig.add(hireHead);

const hireHat = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.22, 10), hireHatMat);
hireHat.position.set(0, 1.34, 0.15);
addOutline(hireHat);
hireRig.add(hireHat);

const hireHatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.04, 14), hireHatMat);
hireHatBrim.position.set(0, 1.25, 0.15);
hireHatBrim.visible = false; // wide-brim look, toggled per guy
addOutline(hireHatBrim);
hireRig.add(hireHatBrim);

const hireBeard = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.1), hireBeardMat);
hireBeard.position.set(0, 1.08, 0.28);
hireBeard.visible = false; // toggled per guy
addOutline(hireBeard);
hireRig.add(hireBeard);

hireRig.add(limb(new THREE.Vector3(0.22, 0.95, 0.2), new THREE.Vector3(0.55, 0.7, 0.55), 0.08, 0.06, hireShirtMat));
hireRig.add(limb(new THREE.Vector3(-0.22, 0.95, 0.2), new THREE.Vector3(-0.55, 0.7, 0.55), 0.08, 0.06, hireShirtMat));

const HIRE_WATERLINE_LOCAL_Y = HIRE_HULL_CENTER_Y - HIRE_HULL_HALF_HEIGHT * 0.3;
const HIRE_Y_OFFSET = -HIRE_WATERLINE_LOCAL_Y;

function applyHireLook(guy) {
  hireShirtMat.color.setHex(guy.shirt);
  hireHatMat.color.setHex(guy.hat);
  hireHat.visible = !guy.wideBrim;
  hireHatBrim.visible = !!guy.wideBrim;
  hireBeard.visible = !!guy.beard;
}

function deliverHireCatch(guyId) {
  const guy = HIRE_GUYS.find((g) => g.id === guyId);
  for (let i = 0; i < guy.catchCount; i++) {
    const sp = hirePickFish(guy);
    const weight = rollWeight(sp);
    const row = logCatch(sp, weight);
    spawnPileItem(sp, row);
    maybeTriggerPelican();
  }
  delete hires[guyId];
  saveHires();
  if (openPanel === 'hire') renderHire();
  if (openPanel === 'log') renderLog();
  if (openPanel === 'sell') renderSell();
}

const hireReturnState = {
  phase: 'idle', // idle | arriving | delivering | leaving
  timer: 0,
  guyId: null,
  startPos: new THREE.Vector3(),
  dockPos: new THREE.Vector3(),
  exitPos: new THREE.Vector3()
};
const hireQueue = [];
const hireQueuedIds = new Set(); // runtime-only guard so a finished trip isn't re-queued every frame

function queueHireReturn(guyId) {
  if (hireReturnState.guyId === guyId || hireQueue.includes(guyId)) return;
  hireQueue.push(guyId);
}

function startNextHireReturn() {
  if (hireReturnState.phase !== 'idle' || hireQueue.length === 0) return;
  const guyId = hireQueue.shift();
  const guy = HIRE_GUYS.find((g) => g.id === guyId);
  applyHireLook(guy);
  const jitterX = (Math.random() - 0.5) * 2;
  const dockZ = -10;
  hireReturnState.dockPos.set(5 + jitterX, waterY, dockZ);
  hireReturnState.startPos.set(22 + jitterX * 0.3, waterY, dockZ + (Math.random() - 0.5) * 3);
  hireReturnState.exitPos.set(-20 + jitterX * 0.3, waterY, dockZ + (Math.random() - 0.5) * 3);
  hireRig.position.copy(hireReturnState.startPos);
  hireRig.rotation.set(0, Math.PI / 2, 0); // bow turned to head in -x — rows in from the right, continues off to the left
  hireRig.visible = true;
  hireReturnState.guyId = guyId;
  hireReturnState.phase = 'arriving';
  hireReturnState.timer = 0;
}

function updateHireReturn(dt, t) {
  for (const guy of HIRE_GUYS) {
    const until = hires[guy.id];
    if (until && Date.now() >= until && !hireQueuedIds.has(guy.id)) {
      hireQueuedIds.add(guy.id);
      queueHireReturn(guy.id);
    }
  }

  if (hireReturnState.phase === 'idle') {
    startNextHireReturn();
    if (hireReturnState.phase === 'idle') return;
  }

  hireReturnState.timer += dt;
  const ARRIVE_DUR = 5, DELIVER_DUR = 2.5, LEAVE_DUR = 5;

  if (hireReturnState.phase === 'arriving') {
    const p = Math.min(hireReturnState.timer / ARRIVE_DUR, 1);
    hireRig.position.lerpVectors(hireReturnState.startPos, hireReturnState.dockPos, p);
    if (p >= 1) {
      hireReturnState.phase = 'delivering';
      hireReturnState.timer = 0;
      const guy = HIRE_GUYS.find((g) => g.id === hireReturnState.guyId);
      setMessage(guy.name + ' is back with 10 fish!');
      showCatchPopup(guy.name + ' delivered 10 fish!', false);
      deliverHireCatch(hireReturnState.guyId);
      hireQueuedIds.delete(hireReturnState.guyId);
    }
  } else if (hireReturnState.phase === 'delivering') {
    hireRig.position.x = hireReturnState.dockPos.x;
    hireRig.position.z = hireReturnState.dockPos.z;
    if (hireReturnState.timer >= DELIVER_DUR) {
      hireReturnState.phase = 'leaving';
      hireReturnState.timer = 0;
    }
  } else if (hireReturnState.phase === 'leaving') {
    const p = Math.min(hireReturnState.timer / LEAVE_DUR, 1);
    hireRig.position.lerpVectors(hireReturnState.dockPos, hireReturnState.exitPos, p);
    if (p >= 1) {
      hireReturnState.phase = 'idle';
      hireReturnState.guyId = null;
      hireRig.visible = false;
    }
  }

  const hx = hireRig.position.x, hz = hireRig.position.z;
  hireRig.position.y = waveHeight(hx, hz, t) + HIRE_Y_OFFSET;
  hireRig.rotation.z = Math.sin(t * 1.4 + hx) * 0.04;
  hireRig.rotation.x = Math.sin(t * 1.2 + hz) * 0.03;
}

// ------------------------------------------------------------------
// Game state machine (idle -> casting -> waiting -> bite -> reeling -> caught/missed)
// ------------------------------------------------------------------
const state = {
  phase: 'idle',
  timer: 0,
  waitFor: 0,
  biteDeadline: 0,
  castTarget: new THREE.Vector3(-1, waterY, wharfTipZ - 10),
  bobberStart: new THREE.Vector3(),
  pileTarget: new THREE.Vector3(),
  pileSpawned: false,
  junkSplashTarget: new THREE.Vector3(),
  splashTriggered: false,
  currentCatch: null,
  currentLogEntry: null,
  currentCatchFedTierIds: [],
  pendingAutoRecast: false
};

// pops up a "Caught a X!" toast that fades in, floats up a bit, then fades out
const catchPopupEl = document.getElementById('catchPopup');
let catchPopupTimer = null;
function showCatchPopup(text, isJunk) {
  clearTimeout(catchPopupTimer);
  catchPopupEl.textContent = text;
  catchPopupEl.classList.toggle('junk', !!isJunk);
  catchPopupEl.classList.remove('show');
  // force reflow so re-triggering the animation works even if a popup is already showing
  void catchPopupEl.offsetWidth;
  catchPopupEl.classList.add('show');
  catchPopupTimer = setTimeout(() => catchPopupEl.classList.remove('show'), 1600);
}

// reel-in mini-game: hold to lift a catch zone onto a wandering fish marker
const reelUI = document.getElementById('reelUI');
const reelFishEl = document.getElementById('reelFish');
const reelZoneEl = document.getElementById('reelZone');
const reelProgressFillEl = document.getElementById('reelProgressFill');
const reel = {
  fishY: 0.5, fishTarget: 0.5, fishTimer: 0,
  zoneY: 0.5, zoneVel: 0,
  progress: 0.35,
  holding: false,
  difficulty: REEL_DIFFICULTY.Common
};

function startReel() {
  state.phase = 'reeling';
  state.timer = 0;
  reel.fishY = 0.5;
  reel.fishTarget = 0.5;
  reel.fishTimer = 0;
  reel.zoneY = 0.5;
  reel.zoneVel = 0;
  reel.progress = 0.35;
  state.currentCatch = pickCatch();
  state.currentCatchFedTierIds = lastPickFedTierIds;
  reel.difficulty = REEL_DIFFICULTY[state.currentCatch.rarity] || REEL_DIFFICULTY.Common;
  const zonePx = reel.difficulty.zoneHalf * 2 * 260;
  reelZoneEl.style.height = zonePx + 'px';
  reelZoneEl.style.marginTop = (-zonePx / 2) + 'px';
  setCaughtItem(state.currentCatch);
  reelUI.style.display = 'flex';
  setMessage('Hold to reel it in!');
}

function finishReel(success) {
  reelUI.style.display = 'none';
  state.timer = 0;
  if (success) {
    state.phase = 'caught';
    state.pileSpawned = false;
    state.splashTriggered = false;
    const ang = Math.random() * Math.PI * 2;
    const rad = Math.random() * 0.5;
    state.pileTarget.set(PILE_CENTER.x + Math.cos(ang) * rad, PILE_CENTER.y, PILE_CENTER.z + Math.sin(ang) * rad * 0.7);
    const rodTipWorld = getRodTipWorld();
    state.junkSplashTarget.set(
      rodTipWorld.x + (Math.random() - 0.5) * 5,
      waterY,
      rodTipWorld.z + (Math.random() - 0.5) * 4 - 2
    );
    markCaught(state.currentCatch);
    const weight = rollWeight(state.currentCatch);
    state.currentLogEntry = logCatch(state.currentCatch, weight);
    if (openPanel === 'catalog') renderCatalog();
    if (openPanel === 'log') renderLog();
    if (openPanel === 'sell') renderSell();
    if (state.currentCatch.type === 'fish') {
      setMessage(`Caught a ${state.currentCatch.name}! (${formatWeight(weight)})`);
      showCatchPopup(`Caught a ${state.currentCatch.name}! (${formatWeight(weight)})`, false);
      resolvePredictBet(state.currentCatch);
    } else {
      setMessage(`Ugh, just ${state.currentCatch.name}.`);
      showCatchPopup(`It's just ${state.currentCatch.name}...`, true);
    }
  } else {
    state.phase = 'missed';
    setMessage('The fish slipped off the line.');
    failPredictBet();
  }
}

// called once a catch has finished being delivered (pile or splash) — goes
// back to idle/auto-recast
function finishCaughtSequence() {
  state.phase = 'idle';
  if (autoRecastEnabled) {
    state.pendingAutoRecast = true;
  } else {
    setMessage('Click the water or press SPACE to cast your line');
  }
}

// a quick toss animation for feeding the water — cosmetic only, doesn't gate
// whether the food activates (that already happened by the time this is called)
const FOOD_TOSS_DURATION = 0.5;
const foodTossState = { phase: 'idle', timer: 0, splashTarget: new THREE.Vector3() };

function startFoodToss() {
  if (foodTossState.phase !== 'idle') return;
  if (!['idle', 'missed'].includes(state.phase) || netState.phase !== 'idle') return;
  // deliberately leaves the Fish Food panel open, so you can keep feeding
  // (or check what's active) without reopening the menu each time
  foodTossState.phase = 'tossing';
  foodTossState.timer = 0;
  const rodTipWorld = getRodTipWorld();
  foodTossState.splashTarget.set(
    rodTipWorld.x + (Math.random() - 0.5) * 3,
    waterY,
    rodTipWorld.z - 2 - Math.random() * 3
  );
}

function updateFoodToss(dt, t) {
  if (foodTossState.phase !== 'tossing') return;
  foodTossState.timer += dt;
  const p = Math.min(foodTossState.timer / FOOD_TOSS_DURATION, 1);
  const armAngle = p < 0.4
    ? THREE.MathUtils.lerp(0, -0.5, p / 0.4)
    : THREE.MathUtils.lerp(-0.5, 0.35, (p - 0.4) / 0.6);
  rightArmPivot.rotation.x = armAngle;

  const rodTipWorld = getRodTipWorld();
  const splash = foodTossState.splashTarget;
  const thrown = new THREE.Vector3().lerpVectors(rodTipWorld, splash, p);
  thrown.y = THREE.MathUtils.lerp(rodTipWorld.y, waveHeight(splash.x, splash.z, t), p) + Math.sin(p * Math.PI) * 0.9;
  feedTossMesh.visible = true;
  feedTossMesh.position.copy(thrown);

  if (p >= 1) {
    feedTossMesh.visible = false;
    triggerSplash(new THREE.Vector3(splash.x, waveHeight(splash.x, splash.z, t), splash.z));
    foodTossState.phase = 'idle';
  }
}

function updateReel(dt) {
  if (state.phase !== 'reeling') return;
  const diff = reel.difficulty;

  reel.fishTimer -= dt;
  if (reel.fishTimer <= 0) {
    reel.fishTarget = 0.08 + Math.random() * 0.84;
    reel.fishTimer = diff.fishMinT + Math.random() * (diff.fishMaxT - diff.fishMinT);
  }
  reel.fishY += (reel.fishTarget - reel.fishY) * Math.min(dt * diff.fishSpeed, 1);

  const accel = reel.holding ? 2.9 : -3.2;
  reel.zoneVel = THREE.MathUtils.clamp(reel.zoneVel + accel * dt, -1.3, 1.3);
  reel.zoneY += reel.zoneVel * dt;
  if (reel.zoneY < 0) { reel.zoneY = 0; reel.zoneVel = 0; }
  if (reel.zoneY > 1) { reel.zoneY = 1; reel.zoneVel = 0; }

  const onFish = Math.abs(reel.zoneY - reel.fishY) < diff.zoneHalf;
  const drainMult = ROD_TIERS[rodTier].drainMult;
  reel.progress = THREE.MathUtils.clamp(reel.progress + (onFish ? diff.fillRate : -diff.drainRate * drainMult) * dt, 0, 1);

  reelFishEl.style.top = ((1 - reel.fishY) * 100) + '%';
  reelZoneEl.style.top = ((1 - reel.zoneY) * 100) + '%';
  reelProgressFillEl.style.height = (reel.progress * 100) + '%';

  if (reel.progress >= 1) finishReel(true);
  else if (reel.progress <= 0) finishReel(false);
}

// ------------------------------------------------------------------
// Net swoop — the alternate tool once the Fishing Net is bought and equipped.
// A quick scoop instead of a cast; land it while a school is passing near the
// wharf, then a horizontal timing mini-game (same pace as reeling in a Common
// fish) decides how much of it you actually net. Come up empty if you're not
// timed with a school at all, or if you fumble the mini-game.
// ------------------------------------------------------------------
const NET_SWOOP_DURATION = 0.55;
const NET_SWOOP_COOLDOWN = 0.4;
const NET_SWOOP_X_RADIUS = 4.5;
const netState = { phase: 'idle', timer: 0, success: false, species: null, bottleHit: false };

function schoolLeadX() {
  const p = Math.min(schoolState.timer / schoolState.duration, 1);
  return THREE.MathUtils.lerp(schoolState.startX, schoolState.endX, p);
}

function startNetSwoop() {
  if (netState.phase !== 'idle') return;
  closeEverything();
  netState.phase = 'swinging';
  netState.timer = 0;
  netState.success = schoolState.active && Math.abs(schoolLeadX() - character.position.x) < NET_SWOOP_X_RADIUS;
  netState.species = netState.success ? schoolState.species : null;
  if (netState.success) schoolState.held = true;
  // the bottle only ever matters if the swoop didn't already land on a school
  netState.bottleHit = !netState.success && bottleState.active && Math.abs(bottleState.currentX - character.position.x) < NET_SWOOP_X_RADIUS;
  setMessage('Swooping...');
}

function resolveBottleCatch() {
  endBottle();
  netState.bottleHit = false;
  netState.phase = 'cooldown';
  netState.timer = 0;
  setMessage('You scooped up a bottle with a note inside!');
  showCatchPopup('Message in a bottle!', false);
  openBottleNote();
}

function resolveNetSwoop(success) {
  if (success && netState.species) {
    const count = 4 + Math.floor(Math.random() * 4); // 4-7
    for (let i = 0; i < count; i++) {
      const weight = rollWeight(netState.species);
      const row = logCatch(netState.species, weight);
      spawnPileItem(netState.species, row);
      maybeTriggerPelican();
    }
    if (openPanel === 'catalog') renderCatalog();
    if (openPanel === 'log') renderLog();
    if (openPanel === 'sell') renderSell();
    const label = `${netState.species.name}${count > 1 ? 's' : ''}`;
    setMessage(`Scooped up ${count} ${label}!`);
    showCatchPopup(`Netted ${count} ${label}!`, false);
    progressChallenge('netSwoopCount');
    maybeTriggerPoliceBoat();
  } else {
    setMessage(netState.species ? 'The school scattered — nothing this time.' : 'Nothing there — time it with a passing school!');
  }
  // a school the net landed on is gone either way — scooped into the pile, or scattered
  if (netState.species && schoolState.active) {
    endSchool();
    schoolState.nextCheckAt = clockT + SCHOOL_CHECK_INTERVAL;
  }
  netState.phase = 'cooldown';
  netState.timer = 0;
}

// horizontal timing mini-game, played once a swoop lands on a school — reuses
// the Common reel's exact zone/speed/fill numbers so it plays at the same pace
const netReelUI = document.getElementById('netReelUI');
const swoopFishEl = document.getElementById('swoopFish');
const swoopZoneEl = document.getElementById('swoopZone');
const swoopProgressFillEl = document.getElementById('swoopProgressFill');
const netReel = {
  fishX: 0.5, fishTarget: 0.5, fishTimer: 0,
  zoneX: 0.5, zoneVel: 0,
  progress: 0.35,
  holding: false
};

function startNetReel() {
  netState.phase = 'reeling';
  netState.timer = 0;
  netReel.fishX = 0.5;
  netReel.fishTarget = 0.5;
  netReel.fishTimer = 0;
  netReel.zoneX = 0.5;
  netReel.zoneVel = 0;
  netReel.progress = 0.35;
  const diff = REEL_DIFFICULTY.Common;
  const zonePx = diff.zoneHalf * 2 * 260;
  swoopZoneEl.style.width = zonePx + 'px';
  swoopZoneEl.style.marginLeft = (-zonePx / 2) + 'px';
  netReelUI.style.display = 'flex';
  setMessage('Hold to swing the net through it!');
}

function finishNetReel(success) {
  netReelUI.style.display = 'none';
  resolveNetSwoop(success);
}

function updateNetReel(dt) {
  if (netState.phase !== 'reeling') return;
  const diff = REEL_DIFFICULTY.Common;

  netReel.fishTimer -= dt;
  if (netReel.fishTimer <= 0) {
    netReel.fishTarget = 0.08 + Math.random() * 0.84;
    netReel.fishTimer = diff.fishMinT + Math.random() * (diff.fishMaxT - diff.fishMinT);
  }
  netReel.fishX += (netReel.fishTarget - netReel.fishX) * Math.min(dt * diff.fishSpeed, 1);

  const accel = netReel.holding ? 2.9 : -3.2;
  netReel.zoneVel = THREE.MathUtils.clamp(netReel.zoneVel + accel * dt, -1.3, 1.3);
  netReel.zoneX += netReel.zoneVel * dt;
  if (netReel.zoneX < 0) { netReel.zoneX = 0; netReel.zoneVel = 0; }
  if (netReel.zoneX > 1) { netReel.zoneX = 1; netReel.zoneVel = 0; }

  const onFish = Math.abs(netReel.zoneX - netReel.fishX) < diff.zoneHalf;
  netReel.progress = THREE.MathUtils.clamp(netReel.progress + (onFish ? diff.fillRate : -diff.drainRate) * dt, 0, 1);

  swoopFishEl.style.left = (netReel.fishX * 100) + '%';
  swoopZoneEl.style.left = (netReel.zoneX * 100) + '%';
  swoopProgressFillEl.style.width = (netReel.progress * 100) + '%';

  if (netReel.progress >= 1) finishNetReel(true);
  else if (netReel.progress <= 0) finishNetReel(false);
}

function updateNetSwoop(dt) {
  if (netState.phase === 'swinging') {
    netState.timer += dt;
    const p = Math.min(netState.timer / NET_SWOOP_DURATION, 1);
    // three-beat scoop: wind up and back, sweep hard through the water, lift out and hold
    let ax, az;
    if (p < 0.22) {
      const q = p / 0.22;
      ax = THREE.MathUtils.lerp(0, -0.55, q);
      az = THREE.MathUtils.lerp(0, -0.35, q);
    } else if (p < 0.62) {
      const q = (p - 0.22) / 0.4;
      ax = THREE.MathUtils.lerp(-0.55, 1.15, q);
      az = THREE.MathUtils.lerp(-0.35, 0.45, q);
    } else {
      const q = (p - 0.62) / 0.38;
      ax = THREE.MathUtils.lerp(1.15, 0.3, q);
      az = THREE.MathUtils.lerp(0.45, 0.1, q);
    }
    rightArmPivot.rotation.x = ax;
    rightArmPivot.rotation.z = az;
    if (p >= 1) {
      if (netState.success) startNetReel();
      else if (netState.bottleHit) resolveBottleCatch();
      else resolveNetSwoop(false);
    }
  } else if (netState.phase === 'reeling') {
    // arm holds the net steady in the water while the mini-game plays out
  } else if (netState.phase === 'cooldown') {
    netState.timer += dt;
    rightArmPivot.rotation.x = THREE.MathUtils.lerp(rightArmPivot.rotation.x, 0, Math.min(dt * 6, 1));
    rightArmPivot.rotation.z = THREE.MathUtils.lerp(rightArmPivot.rotation.z, 0, Math.min(dt * 6, 1));
    if (netState.timer >= NET_SWOOP_COOLDOWN) {
      netState.phase = 'idle';
      if (equippedTool === 'net') setMessage('Swoop when a school passes!');
    }
  }
}

function applyToolVisibility() {
  rod.visible = equippedTool === 'rod';
  netGroup.visible = equippedTool === 'net';
  if (equippedTool === 'net') {
    bobber.visible = false;
    const rodTipWorld = getRodTipWorld();
    fishingLine.geometry.setFromPoints([rodTipWorld, rodTipWorld]);
  }
}

const toolSwapButtonEl = document.getElementById('toolSwapButton');
const toolSwapIconEl = document.getElementById('toolSwapIcon');
function updateToolSwapButton() {
  toolSwapButtonEl.style.display = netOwned ? 'flex' : 'none';
  toolSwapIconEl.innerHTML = equippedTool === 'rod' ? NET_ICON_SVG : '🎣';
}
// abandons whatever the rod is currently doing (cast in flight, waiting on a
// bite, mid-reel, even delivering a just-landed catch) so switching to the
// net can interrupt it instead of being blocked until it finishes on its own
function cancelRodCast() {
  state.phase = 'idle';
  state.timer = 0;
  bobber.visible = false;
  caughtItem.visible = false;
  reel.holding = false;
  reelUI.style.display = 'none';
  const rodTipWorld = getRodTipWorld();
  fishingLine.geometry.setFromPoints([rodTipWorld, rodTipWorld]);
}

function trySwapTool() {
  if (!netOwned || bottleNoteOpen) return;
  if (krakenState.phase !== 'idle') return;
  if (netState.phase !== 'idle') return;
  if (equippedTool === 'rod' && !['idle', 'missed'].includes(state.phase)) cancelRodCast();
  equippedTool = equippedTool === 'rod' ? 'net' : 'rod';
  applyToolVisibility();
  updateToolSwapButton();
  setMessage(equippedTool === 'net' ? 'Swoop when a school passes!' : 'Click the water or press SPACE to cast your line');
}
toolSwapButtonEl.addEventListener('click', (e) => { e.stopPropagation(); trySwapTool(); });
window.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') trySwapTool();
});
updateToolSwapButton();

// the bobber always lands in the same spot, relative to the rod tip — no aiming
const CAST_OFFSET = new THREE.Vector3(-2, 0, -13);

function getCastTarget() {
  const rodTipWorld = getRodTipWorld();
  return new THREE.Vector3(rodTipWorld.x + CAST_OFFSET.x, waterY, rodTipWorld.z + CAST_OFFSET.z);
}

function startCast() {
  if (!['idle', 'missed'].includes(state.phase)) return;
  if (krakenState.phase !== 'idle') return;
  if (bottleNoteOpen) return;
  // the bottle note's riddle, made real: if Golden and Hearty Fish Food are
  // both out in the water when you cast, there's a chance the Kraken answers
  // instead of a normal cast happening at all
  const hasGolden = activeFoods.some((f) => f.tierId === 'golden');
  const hasHearty = activeFoods.some((f) => f.tierId === 'hearty');
  if (hasGolden && hasHearty && Math.random() < KRAKEN_SUMMON_CHANCE) {
    // the summon eats the offering — one use off each feed, same as a catch —
    // so the Kraken can't be farmed back-to-back off a single pair of foods
    activeFoods.forEach((f) => { if (f.tierId === 'golden' || f.tierId === 'hearty') f.usesLeft--; });
    activeFoods = activeFoods.filter((f) => f.usesLeft > 0);
    saveActiveFoods();
    renderFood();
    closeEverything();
    setMessage('The water stirs as you cast...');
    showCatchPopup('Something answers!', false);
    startKrakenEvent();
    return;
  }
  closeEverything();
  state.castTarget.copy(getCastTarget());
  state.bobberStart.copy(getRodTipWorld());
  state.phase = 'casting';
  state.timer = 0;
  bobber.visible = true;
  setMessage('Casting...');
}

function pressStart() {
  if (krakenState.phase !== 'idle') return;
  if (bottleNoteOpen) return;
  if (equippedTool === 'net') {
    if (netState.phase === 'reeling') {
      netReel.holding = true;
    } else if (netState.phase === 'idle') {
      startNetSwoop();
    }
    return;
  }
  if (state.phase === 'bite') {
    startReel();
    reel.holding = true;
  } else if (state.phase === 'reeling') {
    reel.holding = true;
  } else if (['idle', 'missed'].includes(state.phase)) {
    startCast();
  } else if (state.phase === 'waiting') {
    setMessage('Wait for a bite...');
  }
}

renderer.domElement.addEventListener('mousedown', () => pressStart());
window.addEventListener('mouseup', () => { reel.holding = false; netReel.holding = false; });
renderer.domElement.addEventListener('touchstart', (e) => {
  e.preventDefault();
  pressStart();
}, { passive: false });
window.addEventListener('touchend', () => { reel.holding = false; netReel.holding = false; });

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) pressStart();
    reel.holding = true;
    netReel.holding = true;
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') { reel.holding = false; netReel.holding = false; }
});

// ------------------------------------------------------------------
// Save / restore — most progress (coins, log, gear, food, bank, hires) saves
// itself as it changes, via its own key above. These last few bits change in
// too many places (shop, black market, police seizures, the hat blowing off)
// to hook every one, so they're snapshotted on a short timer and on page close.
// ------------------------------------------------------------------
const EXTRAS_KEY = 'sunsetFishing.extras';

function saveExtras() {
  try {
    localStorage.setItem(EXTRAS_KEY, JSON.stringify({
      hatOwned,
      hatFishCount,
      radioOwned,
      challengesCompletedCount,
      completedChallengeIds: [...completedChallengeIds]
    }));
  } catch (e) {}
}

(function restoreExtras() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(EXTRAS_KEY) || 'null'); } catch (e) {}
  if (!saved) return;
  hatOwned = !!saved.hatOwned;
  hatFishCount = saved.hatFishCount || 0;
  // the radio comes back on the deck but quiet — browsers won't play audio
  // before the player has clicked something, so it's toggled on by hand
  radioOwned = !!saved.radioOwned;
  radioPlaying = false;
  radioGroup.visible = radioOwned;
  challengesCompletedCount = saved.challengesCompletedCount || 0;
  completedChallengeIds = new Set(saved.completedChallengeIds || []);
  updateGamblingLockUI();
})();

// the pile on the deck isn't saved directly — it's rebuilt from the unsold
// fish still in the catch log (oldest first, so it mounds the same way)
(function rebuildPileFromLog() {
  const pending = catchLog.filter((e) => e.type === 'fish' && !e.sold && !e.stolen && !e.baited);
  pending.slice(0, PILE_MAX).reverse().forEach((row) => {
    const entry = CATALOG_BY_NAME.get(row.name);
    if (entry) spawnPileItem(entry, row);
  });
})();

setInterval(saveExtras, 2000);
window.addEventListener('beforeunload', saveExtras);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveExtras(); });

// ------------------------------------------------------------------
// Update / animate
// ------------------------------------------------------------------
let clockT = 0;
let lastPerf = performance.now();

function updateWater(t) {
  const pos = waterGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, waveHeight(x, z, t));
  }
  pos.needsUpdate = true;
  waterGeo.computeVertexNormals();
}

function updateFish(dt, t) {
  for (const f of fishList) {
    const a = f.angle0 + t * f.speed;
    const x = f.cx + Math.cos(a) * f.radius;
    const z = f.cz + Math.sin(a) * f.radius * 0.6;
    f.mesh.position.set(x, waterY + f.depth + Math.sin(t + f.angle0) * 0.15, z);
    f.mesh.rotation.y = -a + Math.PI / 2;
  }
}

function updateFishingLine(t, dt) {
  const rodTipWorld = getRodTipWorld();
  let bobberPos;
  caughtItem.visible = false;

  if (state.phase === 'casting') {
    const p = Math.min(state.timer / 0.45, 1);
    const arcH = 2.2;
    bobberPos = new THREE.Vector3().lerpVectors(state.bobberStart, state.castTarget, p);
    bobberPos.y += Math.sin(p * Math.PI) * arcH;

    // arm swings back then snaps forward through the cast, like a real cast motion
    const armAngle = p < 0.32
      ? THREE.MathUtils.lerp(0, -0.95, p / 0.32)
      : THREE.MathUtils.lerp(-0.95, 0.1, (p - 0.32) / 0.68);
    rightArmPivot.rotation.x = armAngle;

    if (p >= 1) {
      state.phase = 'waiting';
      state.timer = 0;
      state.waitFor = 1.2 + Math.random() * 2.3;
      setMessage('Waiting for a bite...');
    }
  } else if (state.phase === 'waiting') {
    bobberPos = state.castTarget.clone();
    bobberPos.y = waveHeight(bobberPos.x, bobberPos.z, t);
    if (state.timer >= state.waitFor) {
      state.phase = 'bite';
      state.timer = 0;
      state.biteDeadline = 0.75;
      setMessage('BITE! Click / press SPACE now!');
    }
  } else if (state.phase === 'bite') {
    bobberPos = state.castTarget.clone();
    bobberPos.y = waveHeight(bobberPos.x, bobberPos.z, t) + Math.sin(state.timer * 45) * 0.25;
    if (state.timer >= state.biteDeadline) {
      state.phase = 'missed';
      state.timer = 0;
      setMessage('The fish got away. Click to cast again.');
    }
  } else if (state.phase === 'reeling') {
    bobberPos = state.castTarget.clone();
    bobberPos.y = waveHeight(bobberPos.x, bobberPos.z, t) + Math.sin(t * 25) * 0.12;

    // the hooked catch thrashes just under the surface, hook point pinned to the bobber
    caughtItem.visible = true;
    const wiggle = bobberPos.clone();
    wiggle.y -= 0.3;
    hangCatchAtHook(caughtItem, state.currentCatch.hookOffset, wiggle, Math.sin(t * 14) * 0.35, t * 5, 0);
  } else if (state.phase === 'caught') {
    const isFish = state.currentCatch.type === 'fish';
    const LIFT = 0.45;
    caughtItem.visible = true;

    if (state.timer < LIFT) {
      // lifted out of the water, still hooked
      const p = state.timer / LIFT;
      bobberPos = new THREE.Vector3().lerpVectors(state.castTarget, rodTipWorld, p);
      bobberPos.y += Math.sin(p * Math.PI) * 1.4;
      hangCatchAtHook(caughtItem, state.currentCatch.hookOffset, bobberPos, 0, Math.sin(t * 10) * 0.3, Math.PI / 2 + Math.sin(t * 16) * 0.3 * (1 - p * 0.5));
    } else if (isFish) {
      // fish get tossed onto the growing pile on the wharf
      const THROW = 0.4;
      if (state.timer < LIFT + THROW) {
        const p2 = (state.timer - LIFT) / THROW;
        const thrown = new THREE.Vector3().lerpVectors(rodTipWorld, state.pileTarget, p2);
        thrown.y = THREE.MathUtils.lerp(rodTipWorld.y, PILE_CENTER.y + 0.15, p2) + Math.sin(p2 * Math.PI) * 1.6;
        caughtItem.position.copy(thrown);
        caughtItem.rotation.set(t * 10, t * 14, Math.PI / 2 + t * 8);
      } else {
        caughtItem.visible = false;
        if (!state.pileSpawned) {
          state.pileSpawned = true;
          spawnPileItem(state.currentCatch, state.currentLogEntry);
          maybeTriggerPelican();
          maybeTriggerPoliceBoat();
          registerChallengeCatch(state.currentCatch, state.currentLogEntry ? state.currentLogEntry.weight : null);
          if (hatOwned) {
            hatFishCount++;
            if (hatFishCount >= 2) blowHatOff();
          }
        }
      }
      if (state.timer >= LIFT + THROW + 0.2) {
        finishCaughtSequence();
      }
    } else {
      // junk never joins the pile — it gets chucked back into the water
      const TOSS = 0.5;
      if (state.timer < LIFT + TOSS) {
        const p2 = (state.timer - LIFT) / TOSS;
        const splash = state.junkSplashTarget;
        const thrown = new THREE.Vector3().lerpVectors(rodTipWorld, splash, p2);
        thrown.y = THREE.MathUtils.lerp(rodTipWorld.y, waveHeight(splash.x, splash.z, t), p2) + Math.sin(p2 * Math.PI) * 1.3;
        caughtItem.position.copy(thrown);
        caughtItem.rotation.set(t * 12, t * 9, t * 15);
      } else {
        if (!state.splashTriggered) {
          state.splashTriggered = true;
          const splash = state.junkSplashTarget;
          triggerSplash(new THREE.Vector3(splash.x, waveHeight(splash.x, splash.z, t), splash.z));
          registerChallengeCatch(state.currentCatch, null);
        }
        caughtItem.visible = false;
      }
      if (state.timer >= LIFT + TOSS + 0.15) {
        finishCaughtSequence();
      }
    }

    if (state.timer >= LIFT) {
      bobber.visible = false;
      fishingLine.geometry.setFromPoints([rodTipWorld, rodTipWorld]);
      rightArmPivot.rotation.x = THREE.MathUtils.lerp(rightArmPivot.rotation.x, 0, Math.min(dt * 5, 1));
      return;
    }
  } else if (state.phase === 'missed') {
    bobberPos = state.castTarget.clone();
    bobberPos.y = waveHeight(bobberPos.x, bobberPos.z, t);
    if (state.timer >= 1.4) { state.phase = 'idle'; bobber.visible = false; setMessage('Click the water or press SPACE to cast your line'); }
  } else {
    bobber.visible = false;
    if (netState.phase === 'idle' && foodTossState.phase === 'idle') {
      rightArmPivot.rotation.x = THREE.MathUtils.lerp(rightArmPivot.rotation.x, 0, Math.min(dt * 5, 1));
      rightArmPivot.rotation.z = THREE.MathUtils.lerp(rightArmPivot.rotation.z, 0, Math.min(dt * 5, 1));
    }
    return;
  }

  if (state.phase !== 'casting') {
    rightArmPivot.rotation.x = THREE.MathUtils.lerp(rightArmPivot.rotation.x, 0, Math.min(dt * 5, 1));
  }
  bobber.position.copy(bobberPos);
  const linePts = [rodTipWorld, bobberPos];
  fishingLine.geometry.setFromPoints(linePts);

  const showRipples = state.phase === 'waiting' || state.phase === 'bite';
  ripples.forEach((ring, i) => {
    if (!showRipples) { ring.visible = false; return; }
    const cyc = 1.6;
    const rt = ((state.timer + i * (cyc / ripples.length)) % cyc) / cyc;
    ring.visible = true;
    ring.position.set(state.castTarget.x, waveHeight(state.castTarget.x, state.castTarget.z, t) + 0.02, state.castTarget.z);
    const s = 0.3 + rt * 3.2;
    ring.scale.set(s, s, s);
    ring.material.opacity = (1 - rt) * 0.5;
  });
}

function animate() {
  const now = performance.now();
  const dt = Math.min((now - lastPerf) / 1000, 0.05);
  lastPerf = now;
  clockT += dt;
  state.timer += dt;

  updateWater(clockT);
  updatePilingWaterMarkers(clockT);
  updateBeach(clockT);
  updateFish(dt, clockT);
  updateCrabs(dt, clockT);
  updateSchool(dt, clockT);
  updateSchoolWakes(dt);
  updateBottle(dt, clockT);
  updateDolphins(dt, clockT);
  updateFishingLine(clockT, dt);
  updateNetSwoop(dt);
  updateNetReel(dt);
  updateFoodToss(dt, clockT);
  updateReel(dt);
  updateSplashes(dt);
  updatePelican(dt);
  updateBlackMarket(dt, clockT);
  updatePoliceBoat(dt, clockT);
  updateBoatFx(dt, clockT);
  updateKraken(dt, clockT);
  updateHireReturn(dt, clockT);
  updateHat(dt, clockT);
  updateMusicNotes(dt);
  updateChallenges();

  if (state.pendingAutoRecast) {
    state.pendingAutoRecast = false;
    startCast();
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);








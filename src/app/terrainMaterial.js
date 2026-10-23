// Regolith shader.
//
// Per pixel: Lommel-Seeliger scattering (I ~ mu0 / (mu0 + mu)), which keeps the
// Moon brighter than Lambert at grazing Sun, times the traced sun visibility
// baked per vertex. Fine relief below the mesh resolution is added as a
// procedural bump field that fades out with distance, so close-up ground breaks
// into the grainy light-and-shadow texture real low-Sun photos show.
import * as THREE from 'three';
import { MOON } from '../core/constants.js';

const vertexShader = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute float aVis;
  attribute float aAlb;
  varying float vVis;
  varying float vAlb;
  varying vec3 vPos;
  varying vec3 vNormal;
  varying vec3 vUp;
  varying float vDist;
  uniform float uR;
  void main() {
    vVis = aVis;
    vAlb = aAlb;
    vPos = position;
    vNormal = normal;
    vUp = normalize(position + vec3(0.0, 0.0, uR));
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDist = -mv.z;
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`;

const fragmentShader = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uSun;
  uniform float uGain;
  uniform float uFill;
  varying float vVis;
  varying float vAlb;
  varying vec3 vPos;
  varying vec3 vNormal;
  varying vec3 vUp;
  varying float vDist;

  // sine-free hash (Hoskins): stable in float32 where fract(sin(x)) bands into streaks
  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  // height field of sub-mesh relief, metres
  float relief(vec2 p, float fade1, float fade2) {
    float h = 0.0;
    h += 0.55 * vnoise(p / 7.0) * fade1;
    h += 0.22 * vnoise(p / 2.3 + 17.0) * fade1;
    h += 0.07 * vnoise(p / 0.7 - 5.0) * fade2;
    return h;
  }

  void main() {
    #include <logdepthbuf_fragment>
    vec3 n = normalize(vNormal);
    // detail fades with distance so it never shimmers
    float fade1 = 1.0 - smoothstep(150.0, 900.0, vDist);
    float fade2 = 1.0 - smoothstep(25.0, 140.0, vDist);
    // wrap coordinates so the noise keeps float precision hundreds of km out
    // (offset keeps the wrap seams 4 km from the landing site)
    vec2 p = mod(vPos.xy + 4096.0, 8192.0);
    if (fade1 > 0.0) {
      float e = 0.25;
      float h0 = relief(p, fade1, fade2);
      float hx = relief(p + vec2(e, 0.0), fade1, fade2);
      float hy = relief(p + vec2(0.0, e), fade1, fade2);
      vec3 grad = vec3((hx - h0) / e, (hy - h0) / e, 0.0);
      // tilt the normal against the slope, in the local tangent plane
      grad -= vUp * dot(grad, vUp);
      n = normalize(n - grad);
    }
    float mu0 = max(dot(n, uSun), 0.0);
    float ls = mu0 / (mu0 + 0.5);
    // gentle albedo mottling: older, darker soil and brighter fresh ejecta
    float mott = 0.9 + 0.2 * vnoise(p / 37.0) + 0.06 * vnoise(p / 3.1) * fade1;
    float alb = vAlb * mott;
    float b = alb * (vVis * uGain * ls + 0.012);
    b += alb * uFill * (0.55 + 0.45 * dot(n, vUp));
    gl_FragColor = vec4(vec3(b, b * 0.985, b * 0.955), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function makeTerrainMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: new THREE.Vector3(0, 0, 1) },
      uGain: { value: 5.5 },
      uFill: { value: 0 },
      uR: { value: MOON.radius },
    },
    vertexShader,
    fragmentShader,
  });
}

/** Expose the baked visibility and albedo arrays as shader attributes. */
export function attachTerrainAttributes(geometry) {
  const { alb, vis } = geometry.userData;
  geometry.setAttribute('aVis', new THREE.BufferAttribute(vis, 1));
  geometry.setAttribute('aAlb', new THREE.BufferAttribute(alb, 1));
  geometry.deleteAttribute('color');
}

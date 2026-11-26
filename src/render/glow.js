// Light glow ("bloom"), kept in the spirit of the era's painted halos: only values that are already
// near the overbright clip (fullbright strips, effects, muzzle flashes) bleed a soft halo, the rest
// of the image is untouched. Every shader here works in display space, like the world shaders, so
// the pass copies the finished frame, extracts the brights at quarter resolution, blurs them over
// two scales and adds them back onto the screen. No tone mapping, no lens tricks.
import * as THREE from 'three';

const quadVert = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const brightFrag = /* glsl */`
uniform sampler2D src;
uniform vec2 texel;
uniform float threshold;
varying vec2 vUv;
vec3 pick(vec2 uv) {
  vec3 c = texture2D(src, uv).rgb;
  float l = max(c.r, max(c.g, c.b));
  return c * smoothstep(threshold, 1.0, l);
}
void main() {
  // 4-tap box while downsampling, so tiny sparks still register
  vec3 c = pick(vUv + texel * vec2(-1.0, -1.0)) + pick(vUv + texel * vec2(1.0, -1.0)) + pick(vUv + texel * vec2(-1.0, 1.0)) + pick(vUv + texel * vec2(1.0, 1.0));
  gl_FragColor = vec4(c * 0.25, 1.0);
}`;
const blurFrag = /* glsl */`
uniform sampler2D src;
uniform vec2 dir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(src, vUv).rgb * 0.2270270270;
  c += texture2D(src, vUv + dir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(src, vUv - dir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(src, vUv + dir * 3.2307692308).rgb * 0.0702702703;
  c += texture2D(src, vUv - dir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;
const addFrag = /* glsl */`
uniform sampler2D a;
uniform sampler2D b;
uniform float strength;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(a, vUv).rgb * 0.9 + texture2D(b, vUv).rgb * 0.7;
  gl_FragColor = vec4(c * strength, 1.0);
}`;

export class Glow {
  constructor(renderer) {
    this.renderer = renderer;
    this.size = new THREE.Vector2();
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    const mk = (frag, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, ...extra });
    this.bright = mk(brightFrag, { src: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 0.86 } });
    this.blur = mk(blurFrag, { src: { value: null }, dir: { value: new THREE.Vector2() } });
    this.add = mk(addFrag, { a: { value: null }, b: { value: null }, strength: { value: 0.75 } }, { blending: THREE.AdditiveBlending, transparent: true });
    this.frame = null;
    this.rt = [];
  }

  resize(w, h) {
    if (this.size.x === w && this.size.y === h) return;
    this.size.set(w, h);
    if (this.frame) this.frame.dispose();
    for (const r of this.rt) r.dispose();
    this.frame = new THREE.FramebufferTexture(w, h);
    this.frame.minFilter = this.frame.magFilter = THREE.LinearFilter;
    const opt = { depthBuffer: false, type: THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    const q = (d) => new THREE.WebGLRenderTarget(Math.max(1, Math.round(w / d)), Math.max(1, Math.round(h / d)), opt);
    this.rt = [q(4), q(4), q(8), q(8)];
  }

  pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.cam);
  }

  // call after everything is drawn to the screen
  apply(strength = 0.75) {
    const r = this.renderer;
    const w = r.domElement.width, h = r.domElement.height;
    if (!w || !h) return;
    this.resize(w, h);
    const prevTarget = r.getRenderTarget(), prevAuto = r.autoClear;
    r.autoClear = true;
    r.copyFramebufferToTexture(this.frame);
    const [a0, a1, b0, b1] = this.rt;
    this.bright.uniforms.src.value = this.frame;
    this.bright.uniforms.texel.value.set(1 / w, 1 / h);
    this.pass(this.bright, a0);
    // quarter-res blur
    this.blur.uniforms.src.value = a0.texture; this.blur.uniforms.dir.value.set(1 / a0.width, 0); this.pass(this.blur, a1);
    this.blur.uniforms.src.value = a1.texture; this.blur.uniforms.dir.value.set(0, 1 / a0.height); this.pass(this.blur, a0);
    // eighth-res, wider halo
    this.blur.uniforms.src.value = a0.texture; this.blur.uniforms.dir.value.set(1 / b0.width, 0); this.pass(this.blur, b1);
    this.blur.uniforms.src.value = b1.texture; this.blur.uniforms.dir.value.set(0, 1 / b0.height); this.pass(this.blur, b0);
    this.blur.uniforms.src.value = b0.texture; this.blur.uniforms.dir.value.set(2 / b0.width, 0); this.pass(this.blur, b1);
    this.blur.uniforms.src.value = b1.texture; this.blur.uniforms.dir.value.set(0, 2 / b0.height); this.pass(this.blur, b0);
    // add both onto the screen
    this.add.uniforms.a.value = a0.texture; this.add.uniforms.b.value = b0.texture; this.add.uniforms.strength.value = strength;
    r.autoClear = false;
    this.pass(this.add, null);
    r.autoClear = prevAuto;
    r.setRenderTarget(prevTarget);
  }

  dispose() { if (this.frame) this.frame.dispose(); for (const x of this.rt) x.dispose(); }
}

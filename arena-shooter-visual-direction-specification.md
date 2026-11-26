# Arena Shooter Visual Direction Specification
### A style bible for a fast sci-fi competitive shooter, inspired by the late-90s / early-2000s arena FPS idiom

---

## 1. Core Philosophy

This document defines a visual direction, not a reproduction of any specific game. It extracts the design principles that made the golden-age arena shooter readable, fast and memorable, and restates them as production guidelines you can apply to a new project.

**Guiding pillars:**

1. **Readability at velocity.** The player moves extremely fast and fights in 360 degrees. Every visual decision is judged by one question: can a player moving at high speed, mid-fight, parse this in under 100 ms? Silhouettes stay bold, color coding stays strict, clutter stays subtractive.
2. **Texture-first beauty.** Visual richness lives in the surface textures, not in geometric detail or per-pixel shading. A wall is a mid-poly slab carrying a hand-detailed, information-dense texture. This is the single most defining trait of the look.
3. **The world is a machine.** Environments read as engineered, functional structures: industrial gothic, brutalist tech, orbital hardware. Everything looks purpose-built, bolted down, and worn in.
4. **Color communicates.** Bright, saturated light colors are gameplay signals (weapons, pickups, hazards, routes). The environment's neutral range stays controlled so that a hot magenta projectile or green health glow pops instantly against it.
5. **Stylized reality.** Fog is colored, light is exaggerated, smoke is chunky, explosions are orange-black brushwork. Nothing attempts photorealism; everything attempts *impact*.
6. **Everything is lit like a stage.** Lighting is theatrical, not physical. Baked warm/cold contrasts, hard shadow lines, and colored atmospheric haze come before any notion of real energy conservation.
7. **Motion is expression.** Weapon FX, swaying fixtures, and animated textures make the world feel alive even when idle. A static arena is a dead arena.
8. **Speed reads as direction.** Wall panels carry directional trims and greebles aligned to flow lanes: the environment subconsciously guides navigation.

---

## 2. Rendering Paradigm

The look is fundamentally a **pre-PBR, forward-rendered, baked-lighting** paradigm. Modern engines can replicate it; the important thing is to understand what the renderer was *not* doing, because those absences define the style.

### 2.1 Lighting model (target behavior)

| Aspect | Target behavior |
|---|---|
| Static geometry lighting | 100% baked into lightmaps (or vertex color); never dynamic |
| Dynamic entities | Approximate per-vertex lighting sampled from the nearest static lights; cheap and slightly wrong-looking, and that slight wrongness is part of the charm |
| Direct light specular | Blinn-Phong, single specular lobe per light, no Fresnel-corrected energy |
| Ambient reflection | A small number of hand-placed cube maps (one per arena zone), applied with a strong rim falloff; chrome and fixtures only |
| Ambient diffuse | Either flat or a simple gradient, per zone |
| Emissive | Fullbright unlit channel; emissive surfaces ignore all lighting |
| Shadows | Sharp, high-contrast, single hard terminator; no soft penumbra, no ambient occlusion |
| Tone mapping | None. HDR values are hard-clamped, producing the characteristic glowing blowout of emissives against darks |

**Key rule:** dynamic lights should be *rare and expensive-looking*. A rocket in flight casting a modest animated light on a wall is an event. If every light is dynamic, the idiom dies.

### 2.2 Overbright and gamma behavior

- Light response uses a **hard quadratic falloff** (`1/d²`) with **clamped** output, so nearby light sources and emissives clip to blown-out whites.
- Colors land in exaggerated contrast; darker midtones crush, lights bloom out without any bloom post-process actually existing.
- To reproduce this in a modern linear-HDR engine: either author in gamma space like it's 2001 (hard to maintain), or write a small tone-shaper that clamps the top of the range and lets emissives ride up to several times the clamp value before clipping.

### 2.3 Fog and atmospheric distance

- **One fog color and density per arena zone**, always a saturated tint of the zone's key light, never gray and never neutral.
- Fog exists as worldbuilding first, readability second: a rust-orange industrial arena gets a warm ochre haze; a toxic facility gets a low green murk.
- Density is bold. Corridors should visibly haze within 40-60 m. Fog overlapping an emissive surface or a bright light generates large visible halos.
- Opaque skybox-colored fog at the far plane means the horizon is a colored silhouette wash, not a real distant view.

### 2.4 Camera and field of view

- FOV 90-105 horizontal. Wide FOV is a rendering *style* decision as much as gameplay: it stretches weapon FX and edges, which players of the idiom read as speed.
- No depth of field, no motion blur, no camera lens artifacts. The camera is a window, not a lens.
- Optional but iconic: the viewmodel is rendered with a narrower FOV so it stays bold and readable at the edges of the screen.

### 2.5 Building it in a modern engine

- Use **unlit/emissive material workflows liberally**. Many "cool" surfaces are literally what-you-painted-is-what-you-get, with baked light handled separately.
- Bake static lighting and accept its artifacts: the baked gradient across a face, with visible brightness steps and color bleed over trim, is signature, not a bug.
- Consider a **palette LUT** to capture the epoch's crushed shadows and blown-out lights instead of fighting the engine's filmic curve.
- Keep anisotropic filtering low and let mid-distance mip transitions blur surfaces. The characteristic shimmering/blurring of distant texture detail is an accepted, even desirable artifact.
- Optionally limit lightmap resolution for that chunky baked-color bleed on angular geometry.

---

## 3. Texture and Surface Finishing

This is the heart of the direction. Accumulate detail pass-by-pass like a traditional matte painter, not procedurally by algorithm alone.

### 3.1 Budgets and philosophy

| Aspect | Guideline |
|---|---|
| Base resolution | 128-512 px per tile; density and hand-craft matter more than raw pixel count |
| Texture stack | One diffuse with all lighting/reflection info baked in; optionally a small specular/gloss tweak. No albedo/roughness/normal/metallic PBR stack |
| Baked lighting in albedo | Yes, absolutely. Paint ambient occlusion, darkened corners, and glow falloff directly into the diffuse. This gives the world its pre-solved, hyper-graphic look |
| Noise | Not real noise: **hand-placed fake noise**, large-scale, positioned to enhance panel forms |

### 3.2 Core look

- **Aged-but-maintained surfaces:** every material looks like it has decades of use, not neglect: scratched metal, dull chrome, oil streaking, heat scorching around vents.
- **Harsh ambient contrast:** interior corners darkened to near-black, panel tops and edges blown out by imagined "stage lights."
- **Deep panel seams:** panels sit slightly recessed or raised inside engraved seams. **Shadow lines** 1-2 pixels wide border every panel edge; this makes the whole environment read as assembled, engineered, modular.
- **Greebles come pre-painted:** surface panels display painted-on vents, bolts, micro-louvres, warning stripes. Geometric greeble is restricted (see section 5) because painted detail survives at all distances and costs nothing.
- **Variety through wear masks, not new textures:** one metal texture yields five variants: factory-new, weathered streaked, drip-blackened, rust-bloomed, scorched.

### 3.3 Hand-painted workflow (generation steps)

1. Start with a clean base: metal, stone, concrete, or opaque armor-plastic.
2. **Panel pass:** divide the tile with a deliberate big-medium-small panel hierarchy.
3. **Ambient occlusion pass:** darken all seams and corners, and add a bright top-edge highlight to every raised edge. This is the single most important pass; it constitutes the signature look.
4. **Decal pass:** stencil text, product markings, hazard stripes. This "industrial graffiti" carries theme (tech level, faction, age).
5. **Grime pass:** streaks under every bolt (drip direction is down), washes at floor-wall joins, rust blooms near any moisture point.
6. **Wear pass:** hand-placed scratches, chips and rub marks on edges and high points. **No uniform noise.** Wear happens *where things would be hit*.
7. Export high-contrast; saturation may be restrained, contrast must be strong.

The final look is **richness through shadow-line craft and grime placement**, not through resolution.

### 3.4 Material palette exemplars

| Material family | Finished look |
|---|---|
| Gunmetal | Dark blue-gray, speckled cast feel, edge-highlight bevels, slight oiled sheen |
| Brushed metal | Directional streaks, painted glints, worn through use |
| Rusted metal | Orange-brown bloom, worn-through metallic streaks, drips and crust |
| Concrete/stone | Chalky and dusty, dark-seamed tile work, half-worn painted markings |
| Painted armor plate | Solid saturated color over riveted base, chips reveal bare metal |
| Industrial warning | Yellow-black and orange-black chevrons, half-worn, placed to guide flow and flag hazards |
| Emissive fixtures | Fullbright core color with a painted overbright halo in the surrounding pixels; nearby metal scorched or heat-discolored |
| Tech panel | Dark navy/graphite micro-detail, pinpoints of green/orange operational lights, glowing data strips |

### 3.5 Texture animation

Use scrolling, blending, and frame-flipped animated textures as **function**: flowing energy floors (hazard marker and navigation landmark), pulsing warning lights, rotating skydomes, flickering broken fixtures.

---

## 4. Color and Composition Direction

### 4.1 Global color rules

- **Strict complementary pairs per arena:** warm key light plus cool shadow tint, or inverted (hot interior, cold windows).
- **Saturation is rationed.** Environment neutrals hover around 25% saturation; gameplay elements (weapon FX, pickups, hazards) run 85-100%. This guarantees pop.
- **Value structure:** rich blacks and blown highs, with mid-tones chosen as strong stepping stones. If an arena's grayscale version reads well, its values are correct.
- **One identity color per zone:** rust-orange industrial, teal research tech, lava-red dusk, sickly-green chem, navy-gold gothic-tech. Players should be able to name a map by its color.

### 4.2 Composition rules

- Big readable silhouettes: arena landmarks (towers, cranes, monolith machinery) visible from anywhere.
- Bright directional beacons flag "up" and important routes.
- Negative space is deliberate: every focal point is surrounded by calm.
- **Three focal points max visible at once**; everything else supports.

---

## 5. Geometry and Architecture Language

The geometry derives from brush-based construction tools even if modeled in a modern DCC, and that derivation shapes the idiom.

### 5.1 Surface rules

- **Planar-dominated construction:** floors, walls and arch volumes are large flat slabs, cylinders and straightforward extrusions. **No sculptural rocks, no dense organic meshes.**
- **Mandatory bevels and chamfers:** every panel is a chamfered box. Bevels catch baked light and create readable edge highlights; the edge bevel is the primary readability geometry.
- **Trim sheet philosophy:** geometric trim (bevels, strips, vents, rivet rows, glowing side-lights) is painted into strips on texture and laid over simple 3-step geometry (flat + bevel + recess). One modular wall kit with matching trims covers an entire arena aesthetic.
- **Arch and alcove discipline:** doorways, arches and pipes are shaped for cover, flow and silhouette; cross-sections are oversized enough to read as scale cues.
- Big angular outer silhouettes with carved interior arenas: pits, galleries, nooks.

### 5.2 Density

- **Low-poly, "high-graphic":** a wall's polygon budget can be trivial (10-50 tris) while its texture carries hundreds of painted features.
- Real geometric detail appears only up close and interactive: door frames, jump pads, armor pickups, weapon meshes, viewmodels.
- Greeble restraint: painted panels simulate machine complexity; physical greeble never overrides readability.

### 5.3 Functional set pieces

Jump pads, teleporters, item platforms and holder-arches for pickups, hazard machinery (crushers, vents, vats), scoreboard displays, glass-bottomed chasm walkways. Arenas are dense with these because they weld theme and gameplay together.

---

## 6. Post Processing and Screen Space

Post-processing is off or nearly off. Approved list:

- Screen-space damage flash (directional red), pickup flash (plain white/yellow), powerup overlay (pulsing tint or shell). All are full-screen tint blits, not photographic effects.
- Optional camera shake on explosion proximity.

That is all. No bloom (emissives are "already bloomed" via their painted overbright halos), no depth of field, no vignette or an extremely light one, no chromatic aberration.

**Rationale:** the look is achieved entirely inside tone-mapping and baked lighting; post layers only veil it.

---

## 7. VFX Pass: Weapon Effects

The VFX language is **loud, screen-punchy, palette-pure, and technically simple**. Nothing is physically simulated fluid dynamics. Every weapon family has a signature high-saturation color that identifies it instantly at any distance.

### 7.1 VFX design laws

1. **Readability over spectacle:** a mid-fight player must see enemy fire, parse type, origin and threat within 1-2 frames. The color IS the signature, the shape IS the gun.
2. **Additive-bright core, dark contrast shell.** Every effect stacks a bright additive center with dimmer additive layers, plus dark smoke to carve the effect out against dark walls.
3. **Palette purity:** each effect uses a narrow two- or three-step ramp: white core, weapon-colored mid, transparent rim. Never a full rainbow gradient, never subtle.
4. **Exaggeration:** projectiles are large on screen and slower than plausible; muzzle flashes are stylized stars; hits read like action-figure impacts (sparks, chunky debris), not medical accuracy.
5. **Cheap tech, big feel:** effects are built from a vocabulary of simple emissive assets: camera-facing sprites, scrolling-texture ribbons, emissive projectile meshes, hard-alpha chunky particles. No soft-particle fluids, no volumetrics, no depth-collision gases.

### 7.2 Core technique vocabulary

| Technique | How it works | Where used |
|---|---|---|
| **Camera-facing quad (sprite) particle** | Billboarded quad with animated/scrolled texture, additive blend | Muzzle flashes, sparks, explosion cores, smoke puffs, glow halos |
| **Scrolling/rotating emissive texture** | Thin polygonal volumes animating UV offset in shader | Energy beams, weapon charge glow, teleporter surface |
| **Ribbon / trail mesh** | Triangle strip extruded along the projectile path, texture scrolling along it | Plasma trails, rocket smoke trails, streaks |
| **Projectile mesh + emissive material** | Mid-poly shape with fullbright painted streaks | Visible bolt bodies, rocket casings |
| **Chunky debris particles** | Small hard-alpha chip sprites that spin and drop with aggressive gravity | Explosion debris, impact fragments |
| **Beam mesh** | Cylinder or camera-facing strip with UV scroll plus noise-driven flicker | Lightning/energy weapons, tethers |
| **Impact decals** | One- to four-frame darkened bullet-hole or burn sprite stamps on surfaces | All hitscan and scorch marks |
| **Dynamic light punch** | Short-lived light flash with radius and falloff on impact events | Explosions, rocket hits, heavy muzzle flash |
| **Shockwave rings** | Large expanding ring texture, flat against the impact plane or spherical | Heavy projectile impacts, explosions |

### 7.3 Signature FX archetypes (build specs)

**A. Hitscan (bullet / rail-style beam)**
- Muzzle: 1-2 frame bright star sprite plus a small smoke puff drifting forward, plus a brief light flash.
- Trace (rail-style): an instantly drawn camera-facing scrolling ribbon in the weapon's signature color, lingering 0.5-1 s and fading with a residual spiral texture.
- Impact: quick spark spray (3-5 tiny bright hard-alpha particles), decal stamp, one smoke puff, small light pulse.

**B. Plasma / energy bolt**
- Visible entity: cross-shaped camera-facing sprite or elongated rotating "blob" mesh with fullbright animated core.
- Trail: fading ribbon chain, ramp of white-hot core, weapon color, transparent.
- Impact: bright burst sprite along the firing line, then 4-6 chunky sparks that fly ballistically, and an energy-splat decal in the signature color.

**C. Rocket / heavy missile**
- Projectile: mid-poly rocket mesh with emissive engine, trailing a stream of **oil-black smoke puffs**: the smoke trail telegraphs the trajectory, which is a readability choice before it is a beauty choice.
- Flight light: a constant modest warm dynamic light following the rocket.
- Explosion layer stack, in order:
  1. Large (1.5-3 m) white-yellow core flash sprite, 1-2 frames.
  2. Orange fireball (expanding scrolling sprite or sphere), fast, 0.2 s, solid-looking.
  3. 6-10 dark smoke puffs spawning staggered, drifting outward and up, living 1-1.5 s.
  4. Shockwave ring expanding flat against the ground, plus a spherical ring fake.
  5. 10-20 chunky debris sprites kicked ballistically, tumbling.
  6. Radial scorch decal, dynamic light flash decaying over 0.3-0.5 s.
  7. Camera shake with radius falloff.
- The whole effect must be readable at 100 m and satisfying at 2 m.

**D. Beam / lightning**
- Loud, almost solid: 2-3 parallel beam meshes jittering vertex positions at 15-30 Hz, white core with the weapon color at the rim.
- Contact points spawn sustained sprite bursts, crackle particles and a halo light; endpoints carry crackling "root" sprites.

**E. Flak / shard scatter**
- 5-9 visible shard tracers (tiny stretched sprites) with hard-angle ricochet colored streaks and micro smoke puffs at spawn.
- Each shard impact makes a mini spark and wall scar; combined they read as a bright geometric shotgun burst.

**F. Flame / spray**
- A volume of candle-flame-shaped camera sprites spawning forward with cone-path velocity and upward drift, additive orange-yellow ramping to dark smoke at end of life, plus surface-specific decals. Dense in aggregate, cheap per sprite.

**G. Player status / power FX**
- Pickup flash: white screen tint plus an item-specific bloom and spin-up sprite play, color-coded (health green, armor yellow, damage red).
- Powerup shell: additive, slowly hue-cycling, semi-transparent pulsing shell mesh around the character, with trailing sparkle particles. Must be tellable from a mile away.

### 7.4 Weapon palette chart (canonical assignment)

| FX family | Core | Rim / halo | Trail |
|---|---|---|---|
| Ballistic / hitscan | White-yellow | Warm orange | Thin white |
| Rail / beam | Pure white | Electric cyan | Cyan ribbon |
| Plasma bolt | White | Violent magenta or purple | Fading violet |
| Rocket / heavy | White-yellow | Hot orange-red | Black smoke plus orange |
| Lightning / tesla | White | Sky blue-violet | Persistent stream |
| Corrosive / bio | Pale yellow | Toxic green | Oily green droplets |
| Flame | White | Orange-amber | Dark smoke |

Rule: **one hue family per weapon**, never shared between two weapons on the same map, tested against each arena zone's tint for pop.

### 7.5 Performance and production rules

- Budget effects in draw calls, not particle counts; the whole vocabulary is sprite-quad based. Effects share a handful of texture atlases; scrolling and rotation are shader-driven, with no per-particle CPU simulation.
- Sprite particles are **unlit by palette, not by lighting**: additive blend, zero lighting response, popped once by a spawn flash if needed.
- **Hard edges, no alpha feathering.** Smoke is dense cards of visible discrete puffs, never a continuous gas.
- Make 90% of effect materials **additive**, so blend order is irrelevant and effects always brighten what is behind them.

---

## 8. Character and Weapon Model Finishing

Brief but binding:

- Weapons and characters are mid-poly with **painted shading**, not sculpted normal maps: baked edge highlights, panel seams and metal glints live in the diffuse.
- Viewmodels are bold and oversized with strong side-view silhouettes and fullbright animated indicator parts (screen readouts, energy cells).
- Characters carry the environment's surface grain (chipped armor, glowing team-color accents, identity sigils) and read instantly against any zone palette: "identifiable as teammate/enemy/type at 60 m, in fog, mid-turn."
- Armor accent colors coordinate with the FX palette chart (7.4), reinforcing color's gameplay-legibility role.

---

## 9. Audio-Visual Synchronization (reference note)

The idiom relies on hard-synced audio: every sprite burst, impact decal and light flash lands on a percussive authored sound. Author each effect as a small musical hit: anticipation (weapon charge), strike (flash frame), tail (smoke, debris, echo decay). Keyframe effects like sheet music.

---

## 10. Quick Reference Card (for artists)

| Attribute | Direction |
|---|---|
| First question | Readable at high speed, mid-fight? |
| Surface richness | Hand-painted texture passes with baked AO and painted edge highlights |
| Geometry | Chamfered slabs plus trim sheets; planar, low-poly |
| Lighting | Baked stage light, hard shadows, colored fog per zone, rare dynamic lights |
| Shading | Pre-PBR Blinn-Phong, overbright clamp, no tone mapping |
| Color | Rationed saturation: quiet neutrals, loud gameplay colors |
| VFX | Additive sprite/ribbon/mesh vocabulary, palette-pure, chunky, hard-edged |
| Post | Off by default; screen flashes only |
| Detail philosophy | Detail happens where wear would happen |

---

## 11. Glossary of Era Techniques (for reproduction in modern tools)

- **Lightmap baking:** pre-computed static lighting stored in surface textures; emulate with modern bake tools or painterly gradients.
- **Vertex-lit dynamic objects:** light interpolated across an object's vertices rather than per pixel; recreate with vertex-color shading or a vertex-unwrap shader.
- **Cube map specular:** a single static reflection texture sampled with the view vector; cheap, strong, authored per zone.
- **Fullbright / emissive:** a surface rendered at full brightness, ignoring light; recreate with unlit emissive materials.
- **Trim sheet:** one texture atlas of painted trims and decal strips mapped onto standardized modular geometry.
- **Additive particle:** a particle blended so it brightens what is behind it (source blend = one); guarantees readability and removes sorting issues.
- **Overbrightening:** letting brights exceed the display range so they clip to a glowing flat white; the era's "free bloom" without any post-process.
- **Fog table:** per-zone fog parameters (color, start, end) governing distance readability and mood.

*End of specification. Use as target-look guidance for concept art, environment, character, weapon and VFX production; amend per arena for individual identity colors.*
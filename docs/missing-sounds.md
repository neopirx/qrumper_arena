# Missing sounds

Sounds the game plays that have no recorded sample yet. The items under **Still synthesized**
have procedural stand-ins (`generate()` in `src/client/audio.js`); the items under **New, silent
until supplied** have no sound at all.

To add one, drop the file in `assets/audio/` (`.wav`) or `assets/audio/announcer/` (`.mp3`)
and add its name to `SAMPLES` / `ANNOUNCER` in `src/client/audio.js` (an array of names picks one
at random per play). Samples are loudness-matched and lead-trimmed at load, so levels don't need
to be exact. Menu music lives in `assets/audio/music/` (`MUSIC` in the same file).

## Now supplied

`death_scream` / `death_scream02` (death), `gib_explode` (gib), `nade_bounce` (grenade bounce),
`armor_shard_pickup` (shard), `dry_fire` (empty weapon), `FleshHit_BW.12166` (bullet / pellet body
hit, heard by everyone), `health_pickup02` (+5 health), announcer `telefrag`,
`died_3_times_in_a_row` (every third death without a frag), `you_lose_02` (second lose line),
music `qrump_theme` (main menu).

## Still synthesized (sample wanted)

| Buffer name | Suggested file | When it plays |
|---|---|---|
| `rocketLoop` | `rocket_fly_loop.wav` (seamless loop) | A rocket is in flight, follows the rocket |
| `hit` | `hitsound.wav` | You damage someone (pitched by damage, CPMA style) |
| `kill` | `frag_confirm.wav` | You frag someone |
| `ammo` | `ammo_pickup.wav` | Ammo box picked up |
| `walljump` | `walljump.wav` | UT-style wall dodge |

## New, silent until supplied

| Suggested file | When it should play |
|---|---|
| `gib_chunk.wav` (2–3 variants) | A gib chunk hits a wall or floor (wet slap) |
| `bullet_impact.wav` (2–3 variants) | Machinegun / shotgun hits a wall (ricochet) |
| `footstep_metal.wav`, `footstep_2.wav`… | Footstep variation; only one footstep sample exists |
| `mega_respawn.wav` | Mega Health / Red Armor respawn (uses `health_respawn` now) |
| `player_spawn.wav` | Player respawn (uses `teleport` now, like Q3) |
| `slime_burn.wav`, `lava_burn.wav` | Standing in slime / lava (uses the pain grunt now) |
| `match_music.mp3` | Optional in-match music (only the menu has music) |

## Announcer lines not recorded yet (optional)

| Suggested file | When it would play |
|---|---|
| `ludicrous_kill.mp3`, `holy_shit.mp3` | Multi kill 6 and 7+ (UT ladder; Monster Kill repeats now) |
| `killing_spree.mp3`, `rampage.mp3`, `dominating.mp3`, `unstoppable.mp3`, `godlike.mp3` | 5 / 10 / 15 / 20 / 25 frags without dying (not implemented yet) |
| `taken_lead.mp3`, `tied_lead.mp3`, `lost_lead.mp3` | Lead changes (not implemented yet) |
| `5_minutes_remain.mp3`, `1_minute_remains.mp3` | Timelimit warnings (not implemented yet) |
| `3_frags_left.mp3`, `2_frags_left.mp3`, `1_frag_left.mp3` | Fraglimit approaching (not implemented yet) |

# NEXUS BLOCKS - Visual Identity Specs
*Art Direction Document*

## 1. Visual Theme: "Quantum Glass / Deep Cyberpunk"
The aesthetic of NEXUS BLOCKS avoids the standard retro-pixel look. Instead, it relies on a sleek, "Quantum Glass" aesthetic. The blocks appear as thick, frosted glass tiles containing concentrated, glowing neon plasma. 

**Grid Background Texture:**
A deep, abyssal surface (`rgba(20,20,30, 0.6)`) overlaid with a subtle, animated geometric hex-mesh. The grid lines are not solid white, but rather a very faint, glowing cyan that subtly pulses to the beat of the background music. It feels like interacting with a high-end holographic terminal.

**Block Visual Style:**
- **Material:** 3D-ish frosted glass (achieved via CSS radial gradients, inset shadows, and backdrop filters).
- **Lighting:** Blocks emit an inner glow that reacts to placement.
- **Nexus Connectors:** Specialized glowing nodes on the edges of pieces that pulse rapidly when brought near compatible nodes.

## 2. Color System
*(Hex codes implemented in `nexus_visuals.css`)*

### Core Palette
- **Primary:** (Inherited from `styles.css`) Deep, rich background anchor.
- **Secondary (Nexus Glow):** `#00F0FF` (Neon Cyan) - Used exclusively for the game's unique Nexus Link mechanic to ensure it immediately draws the eye.
- **Tertiary (Danger/Warning):** `#FF0055` (Laser Pink) - Used for time-rush warnings or blocked placements.
- **Surface:** `rgba(20, 20, 30, 0.6)` - Used for UI panels, frosted glass overlays.

### Block Colors (Quantum Plasma)
Each of the 8 piece colors consists of a Base, a Highlight (Light), and a Core Shadow.
1. **Crimson:** Base `#FF2A6D`
2. **Cyan:** Base `#05D9E8`
3. **Amber:** Base `#FFC600`
4. **Emerald:** Base `#01FF89`
5. **Violet:** Base `#B900FF`
6. **Cobalt:** Base `#0055FF`
7. **Orange:** Base `#FF7700`
8. **Prism (White):** Base `#E0E0E0`

## 3. UI/UX Style Guide

### Typography
- **Display Font:** `Outfit` (Google Fonts) - Used for scores, headers, and combo popups. It is geometric, futuristic, and highly legible.
- **Body Font:** `Inter` (Google Fonts) - Clean, utilitarian font for menus, rules, and buttons.

### Button States
Buttons use the frosted glass aesthetic. 
- **Resting:** Translucent dark background with a solid primary border.
- **Hover/Active:** The border shifts to Neon Cyan (`#00F0FF`), the button lifts slightly (`translateY(-2px)`), and casts a vibrant neon box-shadow.

## 4. Animation Language Specs

### Piece Placement
When a player drops a piece onto the grid:
1. The piece instantly scales up to `115%` and its brightness spikes to `150%`.
2. Over `0.3s` using a snappy cubic-bezier (`0.175, 0.885, 0.32, 1.275`), it snaps down into the grid, settling at `100%` scale and normal brightness.
*(See `.anim-piece-place` in CSS)*

### Line Clear Animation
Instead of just vanishing, lines undergo a high-energy structural failure:
1. Blocks scale up to `110%`, lift slightly upward (`translateY(-2px)`), and their brightness triples.
2. A neon glow (`box-shadow`) wraps the entire line.
3. The blocks flatten vertically (`scaleY(0.1)`) and stretch horizontally (`scaleX(1.5)`) while fading to `opacity: 0` over `0.4s`.
*(See `.anim-line-clear` in CSS)*

### Combo Burst Particle System
Triggered on multi-clears or Nexus cascades:
- **Count:** 20+ particles per line.
- **Color:** Golden yellow (`#FFD700`) with a cyan aura (`#00F0FF`).
- **Behavior:** Particles explode radially from the center of the cleared line. They start fast, decelerate rapidly using a steep cubic-bezier curve, shrink to `scale(0)`, and fade out over `0.6s`.
*(See `spawnComboBurst` in JS)*

### Level-Up Celebration
A UI overlay pops up. The level badge scales from `80%` to `120%`, casting a massive golden drop-shadow, then settles back to `100%` with a satisfying bounce over `1.0s`. 
*(See `.anim-level-up` in CSS)*

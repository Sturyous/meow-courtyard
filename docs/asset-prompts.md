# 生成素材记录

本项目使用内置 imagegen 模式生成项目内位图。参考图来自用户指定的非商业素材仓库。

## courtyard-bg.png

```text
Use case: stylized-concept
Asset type: finished 3:2 top-down game background for a browser-based multiplayer cat courtyard
Input images: Image 1 is the Stardew Valley outdoor tilesheet and is the strict reference for pixel scale, material vocabulary, edge treatment, palette richness, grass texture, wood, stone, foliage, and cozy farm-game visual density. Do not paste the whole sheet; use it as a visual and material reference.
Primary request: Create a polished top-down pixel-art cat courtyard at exactly the visual fidelity and dense handmade tile feeling of the reference. The courtyard must feel like an actual small location in a cozy farming RPG, not flat vector art and not a UI mockup.
Scene/backdrop: spring grass enclosed by detailed wooden fencing; a narrow irregular stone path runs vertically through the center to a small gate; four distinct cushioned cat beds in the upper-left; a wooden study table with open books and a tiny warm lamp in the upper-right; two ceramic food/water bowls in the lower-left; a neat wooden-framed litter box with sand in the lower-right; layered flower beds, shrubs, tufts, pebbles, barrels, pots, fence shadows, and warm lanterns around the edges. Keep the broad center lawn open so several cats can walk and be visible. No house blocking the play area.
Style/medium: authentic crisp 16-bit pixel art, top-down 3/4 RPG tiles, hard pixel edges, coherent 16px tile grid, dense crafted texture, strong readable silhouettes.
Composition/framing: exact 3:2 landscape, game-ready full-bleed background, no border, no UI. Important props clearly separated and not cropped.
Lighting/mood: warm late-afternoon spring light, cozy and inviting, subtle long shadows, lively but not dark.
Color palette: rich grassy greens, warm honey wood, cream stone, dusty pink and blue accents.
Constraints: no cats, no people, no text, no labels, no interface, no speech bubbles, no watermark. No blurry painterly texture, no smooth vector shapes, no isometric perspective, no photorealism. Preserve open navigable space in the center.
```

参考图：`StardewValley-Assets/Maps/spring_outdoorsTileSheet..png`

## cat-atlas.png

```text
Use case: style-transfer
Asset type: transparent pixel-art sprite sheet for a top-down browser game
Input images: Image 1 is the edit target and strict structural reference: a 4-column by 6-row orange cat sprite sheet. Preserve its exact logical grid, pose order, facing directions, silhouette scale, and action readability.
Primary request: redraw this cat sprite sheet with richer, more polished cozy-farming-RPG pixel art. Make the cat a neutral cream-and-warm-gray domestic cat so the game can recolor it into multiple coats. Keep every pose aligned to identical cell centers and consistent proportions.
Style/medium: crisp hand-placed 16-bit pixel art, hard square pixels, limited palette, dark warm outline, expressive tiny face, readable ears/tail/paws. Match the visual density and polish of a classic cozy farm RPG.
Composition/framing: exactly 4 columns and 6 rows, evenly spaced cells, one cat centered per cell. Preserve the reference pose sequence: front idle/walk, side walk, back walk, alternate idle, sleeping/curling and play/lying poses. Leave transparent padding between every cell.
Constraints: genuinely transparent background; no grid lines; no labels; no text; no props; no shadows crossing cells; no anti-aliasing; no gradients; no extra cats outside the 24 cells; do not merge adjacent sprites.
```

参考图：`StardewValley-Assets/Animals/cat..png`

## cabin-bg.png

以 courtyard-bg.png 为风格参考图（input_fidelity: low）生成，1536×1024，随后用脚本抹除右下角水印。

```text
Asset type: finished 3:2 top-down game interior background for a browser-based multiplayer cat game, the cozy cabin belonging to the same courtyard as the input image.
Input images: Image 1 is the strict reference for pixel scale, material vocabulary, edge treatment, palette richness, wood tones, and cozy farm-game visual density. Match its handmade 16-bit pixel-art fidelity exactly, but create an INTERIOR scene.
Primary request: Create a polished top-down pixel-art cabin interior at the same visual fidelity as the reference. A single warm wooden room where two cats can hang out together, feeling like the inside of a Stardew-Valley-style farmhouse, not flat vector art.
Scene contents: warm honey-brown wooden plank floor covering the whole room; wooden walls only along the top edge; a stone fireplace with a small burning fire on the LEFT side of the top wall; a tall bookshelf packed with colorful books on the RIGHT side of the top wall; a large window centered on the top wall showing plain dark evening sky (keep the sky area simple and flat); a big round woven rug in warm red and cream in the center; an extra-wide cushioned cat bed big enough for two cats in the lower-right area, dusty pink with a folded blanket; a soft armchair with a tiny side table and an open book on the left-center; a small door mat at the bottom-center edge marking the exit; a few potted plants, a curled ball of yarn, subtle warm lighting.
Composition/framing: exact 3:2 landscape, game-ready full-bleed background, no border, no UI. Keep the center and lower half largely open and walkable; all furniture pushed against the top wall or into corners. Important props clearly separated and not cropped.
Style/medium: authentic crisp 16-bit pixel art, top-down 3/4 RPG view, hard pixel edges, coherent tile grid, dense crafted texture, strong readable silhouettes.
Lighting/mood: warm firelight evening mood, cozy and intimate, gentle orange glow from the fireplace, rest of the room softly lit.
Color palette: warm honey wood, cream, dusty pink and brick red accents, stone gray fireplace, deep warm browns.
Constraints: no cats, no people, no text, no labels, no interface, no watermark. No blurry painterly texture, no smooth vector shapes, no isometric perspective, no photorealism. Preserve open navigable floor space in the center and lower half.
```

参考图：`public/assets/courtyard-bg.png`（本项目庭院图，作风格/材质参考）
原始生成文件：`docs/asset-src/`（未去水印的原图，cabin-bg.png 为处理后版本）

## cat-squat-v1.png

```text
Use case: style-transfer
Asset type: one transparent pixel-art action sprite for a top-down cozy farming RPG
Input images: Image 1 is the strict style, palette, outline, facial-expression, pixel-density, and body-proportion reference for the same cream-and-warm-gray cat used by the game.
Primary request: create exactly one new three-quarter rear/side-view squatting cat pose suitable for using a litter box. This must be an anatomically readable squat, not a standing cat and not a lying cat.
Pose anatomy: both front legs are straight and vertical under the shoulders, supporting an upright chest; both hind legs are visibly bent at the knees and folded forward/outward; hips and rump are lowered close to the ground; back slopes gently from shoulders to lowered rump; paws remain visible; tail curves naturally to one side and does not point straight upward.
Style/medium: crisp hand-placed 16-bit pixel art matching the reference cat exactly, hard square pixels, warm dark outline, limited colors, no anti-aliasing.
Composition/framing: a single isolated full-body cat centered in a square canvas, generous transparent padding on every side, feet aligned on one baseline.
Constraints: genuinely transparent background; exactly one cat; no litter box, no sand, no floor, no shadow, no text, no props, no duplicate pose, no cropped tail or paws, no standing posture, no flattened or stretched anatomy.
```

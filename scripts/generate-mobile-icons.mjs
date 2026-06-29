import sharp from 'sharp'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(__dirname, '..', 'public')
const outDir = path.join(__dirname, '..', 'mobile', 'resources')
const srcPath = path.join(publicDir, 'musashi-icon.jpg')

// Same manual crop used for the PWA icons (scripts/generate-pwa-icons.mjs).
// The crop is a black crest on a white background, not a transparent cutout.
const crop = { left: 452, top: 139, width: 1114, height: 1114 }
const BRAND_BROWN = { r: 139, g: 115, b: 85 } // #8b7355
const CREAM = { r: 250, g: 245, b: 235 }
const CANVAS = 1024
// Legacy (non-adaptive) icon: comfortable margin since nothing else insets it.
const LEGACY_RATIO = 0.7
// @capacitor/assets wraps the adaptive foreground in its own 16.7% inset, so
// the source here must be near full-bleed or the crest ends up tiny.
const FOREGROUND_RATIO = 0.98

async function creamGlyphRgba(size) {
  // Grayscale + invert turns the white background into alpha=0 and the
  // black crest into alpha=255, so it can be used directly as an alpha mask.
  const alpha = await sharp(srcPath)
    .extract(crop)
    .resize(size, size)
    .grayscale()
    .negate()
    .raw()
    .toBuffer()

  return sharp({
    create: { width: size, height: size, channels: 3, background: CREAM },
  })
    .joinChannel(alpha, { raw: { width: size, height: size, channels: 1 } })
    .png()
    .toBuffer()
}

// Legacy (non-adaptive) launcher icon: brand-brown square with the cream crest centered.
const legacySize = Math.round(CANVAS * LEGACY_RATIO)
const legacyGlyph = await creamGlyphRgba(legacySize)
const legacyOffset = Math.round((CANVAS - legacySize) / 2)
await sharp({
  create: { width: CANVAS, height: CANVAS, channels: 3, background: BRAND_BROWN },
})
  .composite([{ input: legacyGlyph, left: legacyOffset, top: legacyOffset }])
  .png()
  .toFile(path.join(outDir, 'icon.png'))
console.log('wrote icon.png')

// Adaptive foreground: near full-bleed cream crest on a transparent canvas —
// @capacitor/assets applies its own safe-zone inset on top of this.
const fgSize = Math.round(CANVAS * FOREGROUND_RATIO)
const fgGlyph = await creamGlyphRgba(fgSize)
const fgOffset = Math.round((CANVAS - fgSize) / 2)
await sharp({
  create: { width: CANVAS, height: CANVAS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite([{ input: fgGlyph, left: fgOffset, top: fgOffset }])
  .png()
  .toFile(path.join(outDir, 'icon-foreground.png'))
console.log('wrote icon-foreground.png')

// Adaptive background: solid brand color.
await sharp({
  create: { width: CANVAS, height: CANVAS, channels: 3, background: BRAND_BROWN },
})
  .png()
  .toFile(path.join(outDir, 'icon-background.png'))
console.log('wrote icon-background.png')

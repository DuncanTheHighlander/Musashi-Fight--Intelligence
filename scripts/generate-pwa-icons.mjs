import sharp from 'sharp'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(__dirname, '..', 'public')
const srcPath = path.join(publicDir, 'musashi-icon.jpg')

// Manual square crop around the helmet crest (auto-trim is thrown off by
// faint scan noise near the JPG's edges).
const crop = { left: 452, top: 139, width: 1114, height: 1114 }

for (const size of [192, 512]) {
  const outPath = path.join(publicDir, `musashi-icon-${size}.png`)
  await sharp(srcPath)
    .extract(crop)
    .resize(size, size)
    .png()
    .toFile(outPath)
  console.log('wrote', outPath)
}

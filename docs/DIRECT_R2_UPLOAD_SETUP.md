# Direct-to-R2 upload setup (required for phone videos >100 MB)

Phone originals must **PUT straight to R2**. Cloudflare Workers reject request
bodies over ~100 MB on Free/Pro, so Worker-proxied uploads will 413.

## 1. Create an R2 API token

Cloudflare Dashboard → R2 → Manage R2 API Tokens → Create API token:

- Permissions: Object Read & Write on bucket `musashi-uploads` only
- Copy **Access Key ID** and **Secret Access Key** once

## 2. Set Worker secrets

```powershell
cd "C:\Users\smith\Desktop\codiing\Musashi\fight app\download_package"
pnpm exec wrangler secret put STORAGE_SERVICE_URL
# value: https://<ACCOUNT_ID>.r2.cloudflarestorage.com

pnpm exec wrangler secret put STORAGE_ACCESS_KEY
pnpm exec wrangler secret put STORAGE_SECRET_KEY
pnpm exec wrangler secret put STORAGE_BUCKET_NAME
# value: musashi-uploads
```

## 3. Apply bucket CORS

```powershell
pnpm exec wrangler r2 bucket cors set musashi-uploads --file scripts/r2-cors-musashi-uploads.json
```

Allowed origins include `https://app.duncanazsmith.workers.dev`, localhost, and
Capacitor. Browser PUTs use `withCredentials=false`.

## 4. Verify

```powershell
curl https://app.duncanazsmith.workers.dev/api/health
```

Expect:

```json
"storage": {
  "signingConfigured": true,
  "directUploadReady": true,
  "largeOriginalReady": true
}
```

## Flow

1. `POST /api/upload-ticket` → `{ presignedUrl, assetId }` (15 min TTL)
2. Browser `PUT` file to R2 hostname (not the Worker)
3. `POST /api/uploads/:id/complete` verifies object size
4. `POST /api/fight` `{ action: "upload_video", assetId, sourceStartSec, sourceEndSec }` JSON only
5. Worker streams R2 → Modal FFmpeg trim/normalize → Gemini ACTIVE → `fileUri`

# Finish Line Playbook (From Browser to Phone)

## Goal
Get this Next.js app into real people’s hands **fast**, without getting stuck on Cloudflare/DB/migrations.

This is written for a **solo dev**.

---

## What is NOT required for MVP
Your MVP goal is: **a working hosted link that opens on a phone**.

You do **not** need these to ship a real MVP:

- **Database**
  - Skip it unless your MVP *requires* saving user data between sessions.
  - If you need persistence later, add it after you have users.
- **Migrations**
  - Only matter once you commit to a real database.
- **Auth (accounts/login)**
  - Optional for MVP.
  - Use a “single player” experience first (no login) if you can.
- **Billing / Stripe**
  - Not required for MVP.
  - You can validate demand before charging.
- **Cloudflare**
  - Not required to ship.
  - You can deploy on Vercel in minutes.

**MVP definition:**
- You can run it locally
- You can deploy it
- You can open it on your phone
- It behaves consistently

---

## Plain-English: what things mean

### What “Windsurfer” is
Windsurfer is basically your **development environment**: the place you edit code and run the app while building.

It’s not the “host” where users go. It’s your workshop.

### What “deployment” means
Deployment means: **you upload your app to a hosting service** so it gets a public URL like:

`https://your-app.vercel.app`

That URL is what real users open on their phones.

### How the same web app becomes “mobile-ready”
A phone can open any normal website.

To make it feel like an “app”, you usually do this in steps:

1. **Hosted web app** (fastest)
2. **PWA** (Add to Home Screen, full-screen, app icon)
3. **Android wrapper** later (optional) if you want Play Store distribution

You are not building “a separate mobile app” right now. You are shipping the same app as a hosted URL first.

---

## Fastest deployment path (local → hosted → mobile-usable)

### Phase 1: Run locally (10–20 minutes)
This repo’s `package.json` has these scripts:
- `dev`: `next dev -H 127.0.0.1 -p 3000`
- `build`: `next build`
- `start`: `next start`

#### Checklist
1. Install dependencies
   - Run:
     - `pnpm install`
2. Start the dev server
   - Run:
     - `pnpm dev`
3. Open it on your computer
   - Go to:
     - `http://127.0.0.1:3000`

#### If you want to open it on your phone while running locally
Phones cannot reach `127.0.0.1` on your computer.

To test on your phone locally you need a LAN address.

Fast options:
- **Option A (recommended): deploy first** and test on phone using the hosted URL.
- **Option B: change dev host** to `0.0.0.0` and use your PC’s local IP.

I recommend **Option A** because it’s simpler and closer to real users.

---

### Phase 2: Deploy (Vercel) (15–30 minutes)
This is the fastest path to a real link.

#### Checklist
1. Create a Vercel account
2. Put your code in a Git repo (GitHub)
   - If it isn’t already, create a GitHub repo and push the project.
3. In Vercel:
   - “New Project” → import the GitHub repo
   - Framework: Next.js (auto-detected)
   - Install command: `pnpm install`
   - Build command: `pnpm build`
   - Output: default
4. Click Deploy
5. Test the URL on your computer
6. Send the URL to your phone (text to yourself) and open it

#### What about environment variables?
If the app uses any `process.env.*` values, Vercel will need them.

Checklist:
- Find required env vars (common ones):
  - API keys
  - session secret
- Add them in:
  - Vercel Project → Settings → Environment Variables

**If you don’t know which env vars are required:**
- Try deploying.
- If it errors, Vercel logs will tell you what is missing.

---

## Phase 3: Make it a PWA (Add to Home Screen)
A PWA gives:
- App icon
- “Add to Home Screen”
- Full-screen feel

### What you need for a basic PWA
- A **web app manifest** (`manifest.webmanifest`)
- A few icons (`192x192`, `512x512`)
- A small update in Next.js to serve them

### Checklist (minimal PWA)
1. Add `public/manifest.webmanifest`
2. Add icons:
   - `public/icons/icon-192.png`
   - `public/icons/icon-512.png`
3. Add metadata in your root layout:
   - Link to the manifest
   - Theme color
4. Deploy again
5. On Android Chrome:
   - Open the site
   - Menu → “Add to Home screen”

Notes:
- iPhone support exists but is pickier.
- You can ship to Android first (fine).

---

## Optional Phase 4: Wrap for Android later (Play Store path)
Only do this if you need Play Store distribution.

Two simple wrapper choices:

### Option A: Bubblewrap (Trusted Web Activity)
- Best if your app is mostly a web UI
- Basically turns your PWA into an Android app shell

### Option B: Capacitor
- Best if you want native plugins later
- Requires a bit more setup but still reasonable

### Checklist (high level)
1. Ensure the hosted app works perfectly on mobile
2. Ensure PWA manifest + icons are correct
3. Choose wrapper
4. Build APK / AAB
5. Internal testing on Android
6. Publish when ready

---

## Decision shortcuts (to avoid infrastructure hell)
Use these rules:

- If you don’t need to store user data → **no DB**
- If you’re not charging yet → **no billing**
- If you’re not multi-user yet → **no auth**
- If your goal is “real users on phones” → **deploy first**

---

## Your fastest “today” plan (recommended)
1. `pnpm install`
2. `pnpm dev` (quick sanity check)
3. Push to GitHub
4. Deploy on Vercel
5. Open the Vercel URL on your phone
6. Only after that: PWA

---

## If you want, I can tailor this to your repo
Tell me:
- Which page is your “main experience” you want users to land on?
- Do you need login on day 1?
- Do you need saving anything on day 1?

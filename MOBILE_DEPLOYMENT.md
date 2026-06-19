# 📱 Mobile Deployment Guide for Musashi AI

## Overview
This guide explains how to deploy your Musashi AI Combat Systems app to Android and iOS devices.

## 🔧 Prerequisites
- Working desktop version of Musashi
- Node.js 18+ installed
- Android Studio (for Android)
- Xcode (for iOS, Mac required)

---

## 🤖 Android Deployment

### Option 1: Quick Test (Browser)
1. Find your computer's IP address:
   ```bash
   ipconfig  # Windows
   ```
2. Start dev server:
   ```bash
   pnpm dev
   ```
3. On Android phone:
   - Connect to same WiFi
   - Open Chrome
   - Navigate to: `http://YOUR_IP:3000`
   - Test all features!

### Option 2: PWA (Progressive Web App)
1. Deploy to Cloudflare Pages:
   ```bash
   pnpm build
   npx wrangler pages deploy out
   ```
2. Visit site on Android Chrome
3. Tap menu → "Add to Home Screen"
4. App icon appears, works offline!

### Option 3: Native Android App (Capacitor)
```bash
# Install Capacitor
pnpm add @capacitor/core @capacitor/android @capacitor/cli

# Initialize Capacitor
npx cap init Musashi com.musashi.ai --web-dir=out

# Add Android platform
npx cap add android

# Build Next.js
pnpm build

# Copy to Android
npx cap copy android

# Open in Android Studio
npx cap open android
```

Then in Android Studio:
1. Connect Android device via USB
2. Enable Developer Mode on phone
3. Click "Run" → Select your device
4. APK installs automatically!

---

## 🍎 iOS Deployment (Requires Mac)

### Option 1: Safari Web Test
Same as Android Option 1, but use Safari.

### Option 2: Native iOS App (Capacitor)
```bash
# Add iOS platform
npx cap add ios

# Build and copy
pnpm build
npx cap copy ios

# Open in Xcode
npx cap open ios
```

In Xcode:
1. Select your Apple Developer account
2. Connect iPhone via USB
3. Trust computer on iPhone
4. Click "Run"

---

## 🚀 Production Deployment

### Cloudflare Pages (Recommended)
1. Push code to GitHub
2. Connect repo to Cloudflare Pages
3. Build settings:
   ```
   Build command: pnpm build
   Build output: out
   ```
4. Environment variables:
   - Add all from `.env.local`
5. Deploy!

### Features by Platform

| Feature | Web | Android PWA | Android Native | iOS Safari | iOS Native |
|---------|-----|------------|----------------|------------|------------|
| Video Upload | ✅ | ✅ | ✅ | ✅ | ✅ |
| MediaPipe Pose | ✅ | ✅ | ✅ | ✅ | ✅ |
| AI Chat | ✅ | ✅ | ✅ | ✅ | ✅ |
| Audio Response | ✅ | ✅ | ✅ | ✅ | ✅ |
| Live Kinematics | ✅ | ✅ | ✅ | ✅ | ✅ |
| SAM Segmentation | ✅* | ❌ | ❌ | ❌ | ❌ |

*WebGPU required (Chrome/Edge desktop only for now)

---

## ⚡ Performance Tips

### Mobile Optimization
1. **Reduce video quality** for faster processing:
   ```javascript
   // In handleFileSelect
   const maxSize = 10 * 1024 * 1024; // 10MB limit
   ```

2. **Lower pose detection frequency**:
   ```javascript
   // In renderPoseOverlayOnce
   if (now - lastRender < 100) return; // 10fps on mobile
   ```

3. **Disable SAM on mobile** (auto-detected):
   ```javascript
   const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
   if (isMobile) setSamEnabled(false);
   ```

---

## 📝 App Store Submission

### Google Play Store
1. Generate signed APK in Android Studio
2. Create developer account ($25 one-time)
3. Upload APK to Play Console
4. Fill app details, screenshots
5. Submit for review (1-2 days)

### Apple App Store
1. Archive in Xcode
2. Create developer account ($99/year)
3. Upload to App Store Connect
4. Add metadata, screenshots
5. Submit for review (2-7 days)

---

## 🐛 Troubleshooting

### Android Issues
- **Camera not working**: Check permissions in Settings
- **Slow performance**: Lower video quality, disable effects
- **Can't install APK**: Enable "Unknown sources" in Settings

### iOS Issues
- **Safari restrictions**: Can't access camera in PWA mode
- **WebGPU not available**: SAM won't work on mobile Safari
- **App crashes**: Check memory usage, reduce video size

---

## 🎉 Quick Start Commands

```bash
# Test on mobile browser
pnpm dev
# Visit http://YOUR_IP:3000 on phone

# Deploy to web
pnpm build && npx wrangler pages deploy out

# Build Android app
npx cap copy android && npx cap open android

# Build iOS app (Mac only)
npx cap copy ios && npx cap open ios
```

---

## 📞 Support
- GitHub Issues: [your-repo/issues]
- Discord: [your-discord]
- Email: support@musashi.ai

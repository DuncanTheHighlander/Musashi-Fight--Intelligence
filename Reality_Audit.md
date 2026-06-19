# Reality Audit Report

> **Purpose:** Identify and eliminate all mock data, random generators, canned responses, dev shortcuts, and UI illusions that make the app appear functional when it is not.

---

## Summary

| Category | Count | Action Required |
|----------|-------|-----------------|
| Mock Data Arrays | 2 | REPLACE WITH REAL CALL |
| Stub Functions | 11 | REPLACE WITH REAL CALL |
| Hard-coded Auth Bypass | 1 | DELETE |
| Hard-coded User Display | 1 | REPLACE WITH REAL CALL |
| NODE_ENV Checks | 2 | KEEP (legitimate security) |

---

## 1. Mock Data in Social Pages

### 1.1 Fighter Profiles Page
**File:** `src/app/social/profiles/page.tsx`  
**Lines:** 31-61  
**What it does:** Hard-codes 2 fake fighter profiles in a `useEffect` instead of fetching from API.

```typescript
useEffect(() => {
  // Mock data - replace with API call
  setProfiles([
    { id: '1', displayName: 'Alex "The Ghost" Rodriguez', ... },
    { id: '2', displayName: 'Sarah Chen', ... }
  ])
}, [])
```

| Action | Recommendation |
|--------|----------------|
| **REPLACE WITH REAL CALL** | Fetch from `/api/social/profiles` which already exists and queries D1. Display "No profiles found" or skeleton loader while loading. |

**What to display instead:**
- While loading: Skeleton cards
- If empty: "No fighter profiles yet. Be the first to create one!"
- If API error: Error toast + "Failed to load profiles"

---

### 1.2 Opponent Scouting Page
**File:** `src/app/social/scouting/page.tsx`  
**Lines:** 50-93  
**What it does:** Hard-codes 2 fake scouting requests instead of fetching from API.

```typescript
useEffect(() => {
  // Mock data - replace with API call
  setRequests([
    { id: '1', authorName: 'Mike Johnson', opponentName: 'Carlos "El Toro" Mendez', ... },
    { id: '2', authorName: 'Sarah Williams', opponentName: 'Unknown Thai Fighter', ... }
  ])
}, [])
```

| Action | Recommendation |
|--------|----------------|
| **REPLACE WITH REAL CALL** | Fetch from `/api/social/scouting` which already exists. Show empty state if no requests. |

**What to display instead:**
- While loading: Skeleton cards
- If empty: "No scouting requests yet. Create one to get community help!"
- If API error: Error toast

---

## 2. Stub Functions in Fight Page

**File:** `src/app/fight/page.tsx`  
**Lines:** 255-293

These functions are defined but do nothing (`// stub: no-op for now`):

| Function | Line | Action |
|----------|------|--------|
| `analyzeCurrentFrame` | 255-257 | **REPLACE WITH REAL CALL** - Should call `/api/fight/analyze-frame` |
| `styleScanThreeFrames` | 258-260 | **REPLACE WITH REAL CALL** - Should call `/api/fight/analyze-frames` |
| `generateCoaching` | 261-263 | **REPLACE WITH REAL CALL** - Should call `/api/fight/chat` |
| `sendChat` | 264-266 | **REPLACE WITH REAL CALL** - Should call `/api/fight/chat` |
| `startVoice` | 267-269 | **REPLACE WITH REAL CALL** - Implement SpeechRecognition |
| `stopVoice` | 270-272 | **REPLACE WITH REAL CALL** - Stop SpeechRecognition |
| `saveLocalSession` | 279-281 | **REPLACE WITH REAL CALL** - Use `putSession` from fightLocalStore |
| `onExportLocal` | 282-284 | **REPLACE WITH REAL CALL** - Use `exportAll` from fightLocalStore |
| `onImportLocal` | 285-287 | **REPLACE WITH REAL CALL** - Use `importAll` from fightLocalStore |
| `loadLocalSession` | 288-290 | **REPLACE WITH REAL CALL** - Use `getSession` from fightLocalStore |
| `removeLocalSession` | 291-293 | **REPLACE WITH REAL CALL** - Use `deleteSession` from fightLocalStore |

**What to display instead:**
- If function not implemented: Show toast "Feature not implemented yet" when user clicks the button
- Or: Hide/disable the UI element that triggers the stub

---

## 3. Hard-coded Auth Bypass

**File:** `src/app/fight/page.tsx`  
**Line:** 198

```typescript
const isShogun = true // stub; replace with real auth check later
```

| Action | Recommendation |
|--------|----------------|
| **DELETE** | Remove this line and fetch actual user role from `/api/auth/me` or use a proper auth hook. |

**What to display instead:**
- Shogun-only UI elements should be hidden until real auth check confirms role

---

## 4. Hard-coded User Display in Navigation

**File:** `src/components/navigation.tsx`  
**Lines:** 104-114

```typescript
<AvatarFallback className="bg-card/60">JD</AvatarFallback>
...
<p className="font-medium text-sm text-foreground">John Doe</p>
<p className="text-xs text-muted-foreground">john@example.com</p>
```

| Action | Recommendation |
|--------|----------------|
| **REPLACE WITH REAL CALL** | Fetch current user from `/api/auth/me` and display actual name/email. Show login button if not authenticated. |

**What to display instead:**
- If logged in: Real user name, email, avatar
- If not logged in: "Login" / "Sign up" buttons instead of avatar dropdown

---

## 5. NODE_ENV Checks (KEEP)

**File:** `src/lib/musashiAuth.ts`  
**Lines:** 126, 131

```typescript
const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
```

| Action | Recommendation |
|--------|----------------|
| **KEEP** | These are legitimate security checks for cookie attributes. Not fake functionality. |

---

## 6. Items That Are NOT Lies (Verified Real)

These components/hooks are correctly wired to real APIs:

| Component/Hook | Status |
|----------------|--------|
| `src/hooks/use-messages.ts` | ✅ Fetches from `/api/social/messages` |
| `src/hooks/use-notifications.ts` | ✅ Fetches from `/api/notifications` |
| `src/app/social/marketplace/page.tsx` | ✅ Fetches from `/api/social/marketplace` |
| `src/app/library/page.tsx` | ✅ Fetches from `/api/library` |
| `src/app/fight/dashboard/page.tsx` | ✅ Fetches from `/api/library/stats` |
| `src/app/shogun/page.tsx` | ✅ Fetches from `/api/shogun/*` |

---

## Priority Order for Fixes

1. **HIGH** - Hard-coded auth bypass (`isShogun = true`) - Security risk
2. **HIGH** - Mock data in profiles/scouting pages - Users see fake data
3. **MEDIUM** - Stub functions in fight page - Buttons do nothing
4. **MEDIUM** - Hard-coded user in navigation - Shows wrong user info
5. **LOW** - NODE_ENV checks - Keep as-is

---

## Quick Fix Template

For mock data pages, replace the `useEffect` with:

```typescript
const [loading, setLoading] = useState(true)
const [error, setError] = useState<string | null>(null)

useEffect(() => {
  const fetchData = async () => {
    try {
      const res = await fetch('/api/social/profiles')
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setProfiles(data.profiles || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }
  fetchData()
}, [])
```

For stub functions, either:
1. Implement the real functionality
2. Or show honest feedback: `toast({ title: 'Not implemented yet' })`

---

*Generated by Reality Audit Agent*

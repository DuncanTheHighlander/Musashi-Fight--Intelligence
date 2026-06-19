# 🔒 Security Guidelines for Musashi

## ⚠️ CRITICAL: API Key Security

**NEVER commit `.env.local` or any file containing API keys to version control!**

### Setup Instructions

1. Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```

2. Fill in your actual API keys in `.env.local`

3. Verify `.env.local` is in `.gitignore` (it should be by default)

4. **If you accidentally committed API keys:**
   - **IMMEDIATELY** revoke the exposed keys from their respective services
   - Generate new keys
   - Update `.env.local` with new keys
   - Remove the keys from git history using `git filter-branch` or BFG Repo-Cleaner

### Required API Keys

#### Gemini AI (Required)
- Get your key from: https://aistudio.google.com/app/apikey
- Used for: Fight analysis, coaching, video processing
- Free tier: 1500 requests/day

#### Stripe (Required for payments)
- Get your keys from: https://dashboard.stripe.com/apikeys
- Use test keys for development
- Switch to live keys only in production

#### OpenAI (Optional)
- Fallback provider if Gemini is unavailable
- Get from: https://platform.openai.com/api-keys

### Production Deployment

When deploying to Cloudflare Workers:

1. **Use Secrets, not environment variables:**
   ```bash
   wrangler secret put GEMINI_API_KEY
   wrangler secret put STRIPE_SECRET_KEY
   wrangler secret put MUSASHI_SESSION_SECRET
   ```

2. **Never hardcode keys in code**

3. **Rotate keys regularly** (every 90 days minimum)

4. **Use different keys for dev/staging/production**

5. **Monitor API usage** for suspicious activity

### Database Security

- D1 database credentials are managed by Cloudflare automatically
- Use `wrangler.toml` for bindings (committed)
- Never expose database URLs or connection strings

### Session Security

- Generate a strong `MUSASHI_SESSION_SECRET`:
  ```bash
  openssl rand -base64 32
  ```
- Never reuse secrets across environments
- Rotate session secrets after security incidents

### Common Vulnerabilities to Avoid

❌ **DON'T:**
- Commit `.env.local` to git
- Use the same keys across environments
- Hardcode API keys in source code
- Share keys in chat/email/Slack
- Use default/example keys in production

✅ **DO:**
- Use environment-specific keys
- Rotate keys regularly
- Monitor API usage and billing
- Use HTTPS everywhere
- Implement rate limiting
- Validate all user inputs

### Emergency Response

If keys are compromised:

1. **Revoke immediately** at the provider
2. Generate new keys
3. Update all environments
4. Review access logs for abuse
5. Notify affected users if data was accessed
6. Document the incident

### Security Contacts

For security issues: security@musashi.ai (update with real contact)

Report vulnerabilities privately before public disclosure.

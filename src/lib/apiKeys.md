# API Keys Configuration Guide

## Environment Variables

Add these to your `.env.local` file (never commit to git):

### Payment & Billing
```
STRIPE_SECRET_KEY=sk_test_...  # Stripe secret key
STRIPE_PUBLISHABLE_KEY=pk_test_...  # Stripe public key (client-safe)
STRIPE_WEBHOOK_SECRET=whsec_...  # Stripe webhook signature
```

### Email Services
```
EMAIL_SERVICE_URL=https://api.resend.com  # or your email service
EMAIL_API_KEY=re_...  # Resend API key or similar
EMAIL_FROM_ADDRESS=noreply@yourapp.com
```

### Storage Services
```
STORAGE_SERVICE_URL=https://your-r2-account.r2.cloudflarestorage.com
STORAGE_ACCESS_KEY=your-access-key
STORAGE_SECRET_KEY=your-secret-key
STORAGE_BUCKET_NAME=musashi-uploads
```

### AI Services (if not using built-in endpoints)
```
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIza...
```

### External Integrations
```
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
GOOGLE_MAPS_API_KEY=AIza...
```

## Security Notes

1. **Never expose API keys to client-side code**
2. **Use different keys for development and production**
3. **Regularly rotate API keys**
4. **Monitor API usage and set up alerts**
5. **Use webhook signatures for payment processing**

## Usage Examples

### Stripe Payment
```typescript
import { stripeClient } from '@/lib/apiClient'

// Create payment intent
const response = await stripeClient.post('/payment_intents', {
  amount: 2000, // $20.00 in cents
  currency: 'usd',
  customer: 'cus_...'
})
```

### Email Sending
```typescript
import { emailClient } from '@/lib/apiClient'

// Send email
const response = await emailClient.post('/emails', {
  from: process.env.EMAIL_FROM_ADDRESS,
  to: 'user@example.com',
  subject: 'Welcome to Musashi',
  html: '<h1>Welcome!</h1><p>Your account is ready.</p>'
})
```

### Custom API
```typescript
import { createApiClient } from '@/lib/apiClient'

const customApi = createApiClient('MyService', 'https://api.myservice.com', 'MY_SERVICE_API_KEY')

const response = await customApi.get('/users', { page: '1', limit: '10' })
```

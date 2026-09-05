import { getEmailApiKey } from '@/lib/email/getEmailApiKey'

export type SendEmailResult = { sent: true } | { dryRun: true; url?: string }

/** Dry-run URLs are dev-only — never expose reset/verify links in production responses. */
export function emailDryRunClientPayload(
  result: SendEmailResult
): { dryRun: true; url?: string } | Record<string, never> {
  if (!('dryRun' in result)) return {}
  if (process.env.NODE_ENV === 'production') return { dryRun: true }
  return { dryRun: true, url: result.url }
}

const isDryRunMode = async (): Promise<boolean> => {
  if (process.env.EMAIL_DRY_RUN === '1') return true
  if (process.env.NODE_ENV === 'production') return false
  return !(await getEmailApiKey())
}

export async function sendTransactionalEmail(args: {
  to: string
  subject: string
  html: string
  text: string
  actionUrl?: string
}): Promise<SendEmailResult> {
  if (await isDryRunMode()) {
    return { dryRun: true, url: args.actionUrl }
  }

  const serviceUrl = String(process.env.EMAIL_SERVICE_URL || '').replace(/\/$/, '')
  const apiKey = await getEmailApiKey()
  const from = String(process.env.EMAIL_FROM_ADDRESS || '').trim()

  if (!serviceUrl || !apiKey || !from) {
    throw new Error('EMAIL_NOT_CONFIGURED')
  }

  const resp = await fetch(`${serviceUrl}/emails`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [args.to],
      subject: args.subject,
      html: args.html,
      text: args.text,
    }),
  })

  if (!resp.ok) {
    const data = (await resp.json().catch(() => ({}))) as { message?: string }
    const message = typeof data?.message === 'string' ? data.message : 'Email send failed'
    throw new Error(message)
  }

  return { sent: true }
}

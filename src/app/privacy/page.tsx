import Link from 'next/link'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

function Section({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  )
}

export default function PrivacyPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-primary/5" />
      <div className="pointer-events-none absolute inset-0 bg-[url('/grid.svg')] opacity-[0.05]" />

      <div className="container relative mx-auto max-w-2xl px-4 py-12 lg:py-16">
        <Card className="border-border/60 bg-card/80 shadow-xl backdrop-blur-sm">
          <CardHeader className="space-y-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/20">
              <ShieldCheck className="h-6 w-6" aria-hidden="true" />
            </div>
            <CardTitle className="text-2xl tracking-tight">Privacy Policy</CardTitle>
            <CardDescription>Last updated: June 2026</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Section title="1. Information We Collect">
              <p>
                We collect the information needed to operate Musashi: account information (name,
                email, password hash, profile details you choose to add), content you upload
                (training and sparring videos, and the pose, technique, and analysis data derived
                from them), and usage information (pages visited, features used, device and browser
                details, and approximate region from IP address).
              </p>
            </Section>

            <Section title="2. How We Use Your Information">
              <p>
                We use your information to provide and improve the Service: to run AI analysis on
                your uploaded footage, generate coaching insights, track your training progress,
                enable social and marketplace features you opt into, process payments, secure your
                account, and communicate with you about the Service. We do not use your private
                videos to advertise to third parties.
              </p>
            </Section>

            <Section title="3. Storage and Infrastructure">
              <p>
                Your data, including uploaded videos and analysis results, is stored on Cloudflare
                infrastructure (including Cloudflare R2 object storage and D1 databases). Data is
                encrypted in transit. Access to your private content is restricted to your account
                and the systems required to process it.
              </p>
            </Section>

            <Section title="4. No Sale of Personal Data">
              <p>
                We do not sell your personal data. We share data only with service providers that
                help us operate the platform (such as hosting and payment processing), and only to
                the extent necessary, or where required by law.
              </p>
            </Section>

            <Section title="5. Cookies and Sessions">
              <p>
                Musashi uses a session cookie to keep you signed in and to protect your account.
                We may use additional cookies or local storage for preferences and basic analytics.
                We do not use third-party advertising cookies.
              </p>
            </Section>

            <Section title="6. Data Retention and Deletion">
              <p>
                We retain your data while your account is active. You can delete individual videos
                and documents from within the app, or request deletion of your entire account and
                associated data by contacting support. Deletion requests are honored within a
                reasonable period, subject to legal retention requirements.
              </p>
            </Section>

            <Section title="7. Your Rights">
              <p>
                Depending on your jurisdiction, you may have rights to access, correct, export, or
                delete your personal data. Contact us to exercise these rights and we will respond
                in accordance with applicable law.
              </p>
            </Section>

            <Section title="8. Contact">
              <p>
                Privacy questions or deletion requests can be sent to support via the contact
                options in the app or to the Musashi support email listed on our website.
              </p>
            </Section>

            <p className="text-xs italic leading-relaxed text-muted-foreground/70">
              This is a general template provided for review; consult a lawyer before public
              launch.
            </p>

            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="outline" className="h-10" asChild>
                <Link href="/">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Go home
                </Link>
              </Button>
              <Button variant="ghost" className="h-10 text-muted-foreground hover:text-foreground" asChild>
                <Link href="/terms">Terms of Service</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

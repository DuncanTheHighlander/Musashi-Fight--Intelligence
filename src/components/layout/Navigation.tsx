'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Users,
  ShoppingBag,
  Target,
  MessageSquare,
  BookOpen,
  LogOut,
  User,
  Crown,
  Menu,
  X,
  Brain,
  ShieldCheck,
} from 'lucide-react'
import { MusashiIcon, MusashiWordmark } from '@/components/icons/MusashiIcon'
import { ThemeToggle } from '@/components/ThemeToggle'
import { useAuth } from '@/hooks/useAuth'
import { useSection, type AppSection } from '@/contexts/SectionContext'

const ALL_NAV_ITEMS: { section: AppSection; label: string; icon: typeof Brain; description: string; preview?: boolean }[] = [
  { section: 'coach', label: 'Fight Lab', icon: Brain, description: 'Upload clips for tactical analysis' },
  { section: 'fighters', label: 'Fighters', icon: Users, description: 'Connect with fighters' },
  { section: 'scouting', label: 'Scouting', icon: Target, description: 'Opponent analysis', preview: true },
  { section: 'coaches', label: 'Coaches', icon: Crown, description: 'Top-ranked coaches', preview: true },
  { section: 'messages', label: 'Messages', icon: MessageSquare, description: 'Chat with fighters', preview: true },
  { section: 'library', label: 'Library', icon: BookOpen, description: 'Your saved content' },
  { section: 'profile', label: 'Profile', icon: User, description: 'Your account & activity' },
]

const ALL_ROUTED_NAV_ITEMS: { href: string; label: string; icon: typeof Brain; description: string; preview?: boolean }[] = [
  { href: '/marketplace', label: 'Marketplace', icon: ShoppingBag, description: 'Post a bounty or hire an analyst' },
]

const PREVIEW_ENABLED = process.env.NEXT_PUBLIC_MUSASHI_PREVIEW_FEATURES === '1'

const navItems = PREVIEW_ENABLED
  ? ALL_NAV_ITEMS
  : ALL_NAV_ITEMS.filter((i) => !i.preview)

const routedNavItems = PREVIEW_ENABLED
  ? ALL_ROUTED_NAV_ITEMS
  : ALL_ROUTED_NAV_ITEMS.filter((i) => !i.preview)

export default function Navigation() {
  const router = useRouter()
  const pathname = usePathname()
  const { user, logout } = useAuth()
  const { activeSection, setActiveSection } = useSection()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  // A URL-routed page (e.g. /marketplace/*) is active when pathname matches,
  // so in that case no section button should appear active.
  const onRoutedPage = pathname ? routedNavItems.some((r) => pathname.startsWith(r.href)) : false
  const openSection = (section: AppSection) => {
    if (onRoutedPage) router.push('/')
    setActiveSection(section)
    setMobileMenuOpen(false)
  }

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-card/85 shadow-sm backdrop-blur-md">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <MusashiIcon size={32} />
            <MusashiWordmark height={24} className="hidden sm:block" />
          </div>
        </div>
      </header>
    )
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-card/85 shadow-sm backdrop-blur-md supports-[backdrop-filter]:bg-card/75">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        {/* Logo */}
        <div className="flex shrink-0">
          <button
            onClick={() => openSection('coach')}
            className="flex items-center gap-2 group w-full"
            aria-label="Go to Fight Lab"
          >
            <div className="w-[32px] h-[32px] relative flex-shrink-0">
              <MusashiIcon size={32} className="group-hover:scale-105 transition-transform" />
            </div>
            <div className="hidden sm:block h-[20px] relative w-[80px] sm:w-[100px] flex-shrink-0 mt-1">
              <MusashiWordmark height={20} />
            </div>
          </button>
        </div>

        {/* Desktop Navigation */}
        <nav className="hidden lg:flex flex-1 justify-center items-center gap-1 mx-2 xl:mx-4">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = !onRoutedPage && activeSection === item.section
            return (
              <button
                key={item.section}
                onClick={() => {
                  openSection(item.section)
                }}
                className={`
                  flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background
                  ${active
                    ? 'bg-primary/15 text-primary shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  }
                `}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            )
          })}
          {routedNavItems.map((item) => {
            const Icon = item.icon
            const active = pathname?.startsWith(item.href) ?? false
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`
                  flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background
                  ${active
                    ? 'bg-primary/15 text-primary shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  }
                `}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-3">
          <ThemeToggle />
          {user && (
            <Button
              variant="outline"
              size="sm"
              className="hidden sm:flex items-center gap-2 border-primary/50 text-primary hover:bg-primary/10"
              onClick={() => router.push('/pricing')}
            >
              <Crown className="h-4 w-4" />
              Upgrade
            </Button>
          )}

          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative h-9 w-9 rounded-full">
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className="bg-primary/20 text-primary text-sm">
                      {user.display_name?.substring(0, 2).toUpperCase() || user.email.substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-2 py-1.5">
                  <p className="text-sm font-medium">{user.display_name}</p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => openSection('profile')}>
                  <User className="h-4 w-4 mr-2" />
                  Profile
                </DropdownMenuItem>
                {user.role === 'shogun' && (
                  <>
                    <DropdownMenuItem asChild>
                      <Link href="/shogun" className="flex items-center gap-2">
                        <Crown className="h-4 w-4" />
                        Admin Panel
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/admin/coach-review" className="flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4" />
                        Quality Review
                      </Link>
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive cursor-pointer"
                  onClick={async () => {
                    await logout()
                    router.push('/login')
                  }}
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={() => router.push('/login')}
            >
              Log In
            </Button>
          )}

          {/* Mobile menu button */}
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile Navigation */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-border/60 bg-card/95 backdrop-blur-md">
          <nav className="container mx-auto py-4 px-4 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon
              const active = !onRoutedPage && activeSection === item.section
              return (
                <button
                  key={item.section}
                  onClick={() => {
                    openSection(item.section)
                  }}
                  className={`
                    flex items-center gap-3 px-4 py-3 rounded-lg transition-all w-full text-left
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                    ${active
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                    }
                  `}
                >
                  <Icon className="h-5 w-5" />
                  <div>
                    <div className="font-medium">{item.label}</div>
                    <div className="text-xs text-muted-foreground">{item.description}</div>
                  </div>
                </button>
              )
            })}
            {routedNavItems.map((item) => {
              const Icon = item.icon
              const active = pathname?.startsWith(item.href) ?? false
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`
                    flex items-center gap-3 px-4 py-3 rounded-lg transition-all w-full text-left
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                    ${active
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                    }
                  `}
                >
                  <Icon className="h-5 w-5" />
                  <div>
                    <div className="font-medium">{item.label}</div>
                    <div className="text-xs text-muted-foreground">{item.description}</div>
                  </div>
                </Link>
              )
            })}
          </nav>
        </div>
      )}
    </header>
  )
}

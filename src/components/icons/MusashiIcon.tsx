import React from 'react'
import Image from 'next/image'

interface MusashiIconProps {
  size?: number
  className?: string
}

export function MusashiIcon({ size = 24, className }: MusashiIconProps) {
  // Icon aspect ratio is 2019 / 1393 ≈ 1.45
  const width = Math.round(size * 1.45)
  return (
    <Image
      src="/musashi-icon.jpg"
      alt="Musashi"
      width={width}
      height={size}
      className={`musashi-logo ${className ?? ''}`.trim()}
      style={{ objectFit: 'contain' }}
    />
  )
}

interface MusashiWordmarkProps {
  height?: number
  className?: string
}

export function MusashiWordmark({ height = 40, className }: MusashiWordmarkProps) {
  // Wordmark aspect ratio is 1579 / 587 ≈ 2.69
  const width = Math.round(height * 2.69)
  return (
    <Image
      src="/musashi-wordmark.jpg"
      alt="Musashi - AI Fight Intelligence"
      width={width}
      height={height}
      className={`musashi-logo ${className ?? ''}`.trim()}
      style={{ objectFit: 'contain' }}
      priority
    />
  )
}

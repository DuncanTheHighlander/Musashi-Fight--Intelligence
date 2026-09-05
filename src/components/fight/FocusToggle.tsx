'use client'

import React from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Users,
  User,
  SwitchCamera,
  Focus
} from 'lucide-react'

export type FocusTarget = 'both' | 'blue' | 'red' | 'unsure'
export type Corner = 'blue' | 'red'

interface FocusToggleProps {
  currentFocus: FocusTarget
  onFocusChange: (focus: FocusTarget) => void
  myCorner: Corner
  onCornerChange: (corner: Corner) => void
  detectedFighters?: {
    blue: boolean
    red: boolean
  }
  disabled?: boolean
}

export function FocusToggle({
  currentFocus,
  onFocusChange,
  myCorner,
  onCornerChange,
  detectedFighters = { blue: true, red: true },
  disabled = false
}: FocusToggleProps) {
  const focusOptions: Array<{
    value: FocusTarget
    label: string
    icon: typeof Users
    color: string
    description: string
    disabled?: boolean
  }> = [
    {
      value: 'both',
      label: 'Both Fighters',
      icon: Users,
      color: 'bg-gray-600',
      description: 'Analyze both fighters equally'
    },
    {
      value: 'blue',
      label: 'Blue Corner',
      icon: User,
      color: 'bg-blue-600',
      description: 'Focus on blue corner (left)',
      disabled: !detectedFighters.blue
    },
    {
      value: 'red',
      label: 'Red Corner',
      icon: User,
      color: 'bg-red-600',
      description: 'Focus on red corner (right)',
      disabled: !detectedFighters.red
    },
    {
      value: 'unsure',
      label: 'Not Sure',
      icon: Focus,
      color: 'bg-amber-600',
      description: 'Identity unclear — coach cautiously'
    },
  ]

  const currentFocusInfo = focusOptions.find(o => o.value === currentFocus) || focusOptions[0]

  return (
    <Card className="border-2 border-gray-800 bg-gray-900/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-bold text-white flex items-center gap-2">
            <Focus className="w-5 h-5 text-blue-400" />
            Analysis Focus
          </CardTitle>
          <Badge className={`${currentFocusInfo.color} text-white text-xs`}>
            {currentFocusInfo.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* My Corner Selector */}
        <div className="space-y-2">
          <div className="text-xs text-gray-400 uppercase tracking-wide">My Corner</div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="sm"
              variant={myCorner === 'blue' ? 'default' : 'outline'}
              onClick={() => onCornerChange('blue')}
              disabled={disabled}
              className={myCorner === 'blue'
                ? 'bg-blue-600 text-white border-transparent hover:bg-blue-700'
                : 'border-gray-600 text-gray-300 hover:bg-gray-800'}
            >
              Blue (Left)
            </Button>
            <Button
              size="sm"
              variant={myCorner === 'red' ? 'default' : 'outline'}
              onClick={() => onCornerChange('red')}
              disabled={disabled}
              className={myCorner === 'red'
                ? 'bg-red-600 text-white border-transparent hover:bg-red-700'
                : 'border-gray-600 text-gray-300 hover:bg-gray-800'}
            >
              Red (Right)
            </Button>
          </div>
        </div>

        {/* Focus Toggle Buttons */}
        <div className="space-y-2">
          <div className="text-xs text-gray-400 uppercase tracking-wide">Highlight</div>
          <div className="grid grid-cols-4 gap-2">
            {focusOptions.map((option) => (
              <Button
                key={option.value}
                size="sm"
                variant={currentFocus === option.value ? 'default' : 'outline'}
                onClick={() => onFocusChange(option.value)}
                disabled={disabled || option.disabled}
                className={`${
                  currentFocus === option.value
                    ? `${option.color} text-white border-transparent`
                    : 'border-gray-600 text-gray-300 hover:bg-gray-800'
                } ${option.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <option.icon className="w-4 h-4 mr-1" />
                {option.value === 'both' ? 'Both' : option.value === 'blue' ? 'Blue' : option.value === 'red' ? 'Red' : 'Not sure'}
              </Button>
            ))}
          </div>
        </div>

        {/* Detection Status */}
        <div className="border-t border-gray-700 pt-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">Fighter Detection</span>
            <div className="flex gap-2">
              <div className="flex items-center gap-1">
                <div className={`w-2 h-2 rounded-full ${detectedFighters.blue ? 'bg-blue-400' : 'bg-gray-600'}`} />
                <span className="text-gray-300">Blue</span>
              </div>
              <div className="flex items-center gap-1">
                <div className={`w-2 h-2 rounded-full ${detectedFighters.red ? 'bg-red-400' : 'bg-gray-600'}`} />
                <span className="text-gray-300">Red</span>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onFocusChange(currentFocus === 'blue' ? 'red' : currentFocus === 'red' ? 'both' : 'blue')}
            disabled={disabled}
            className="flex-1 border-gray-600 text-gray-300 hover:bg-gray-800"
          >
            <SwitchCamera className="w-4 h-4 mr-2" />
            Cycle Focus
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

interface CompactFocusToggleProps {
  currentFocus: FocusTarget
  onFocusChange: (focus: FocusTarget) => void
  size?: 'sm' | 'md'
  showLabels?: boolean
  disabled?: boolean
}

export function CompactFocusToggle({
  currentFocus,
  onFocusChange,
  size = 'sm',
  showLabels = false,
  disabled = false,
}: CompactFocusToggleProps) {
  const options: { value: FocusTarget; label: string; color: string; activeColor: string }[] = [
    { value: 'both', label: 'Both', color: 'text-gray-400', activeColor: 'bg-gray-600 text-white' },
    { value: 'blue', label: 'Blue', color: 'text-blue-400', activeColor: 'bg-blue-600 text-white' },
    { value: 'red', label: 'Red', color: 'text-red-400', activeColor: 'bg-red-600 text-white' },
    { value: 'unsure', label: 'Not sure', color: 'text-amber-400', activeColor: 'bg-amber-600 text-white' },
  ]

  return (
    <div className="flex flex-wrap items-center gap-1">
      {options.map((opt) => (
        <Button
          key={opt.value}
          size={size === 'sm' ? 'sm' : 'default'}
          variant={currentFocus === opt.value ? 'default' : 'ghost'}
          onClick={() => onFocusChange(opt.value)}
          disabled={disabled}
          className={`${
            currentFocus === opt.value
              ? opt.activeColor
              : `${opt.color} hover:bg-gray-800`
          } ${size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-sm'}`}
        >
          {opt.value === 'both' ? (
            <Users className={size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'} />
          ) : (
            <User className={size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'} />
          )}
          {showLabels && <span className="ml-1">{opt.label}</span>}
        </Button>
      ))}
    </div>
  )
}

interface FocusIndicatorProps {
  currentFocus: FocusTarget
  isActive?: boolean
}

export function FocusIndicator({ currentFocus, isActive = true }: FocusIndicatorProps) {
  const colorMap: Record<FocusTarget, string> = {
    both: 'bg-gray-400',
    blue: 'bg-blue-500',
    red: 'bg-red-500',
    unsure: 'bg-amber-500',
  }
  const labelMap: Record<FocusTarget, string> = {
    both: 'Both',
    blue: 'Blue',
    red: 'Red',
    unsure: 'Not sure',
  }

  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-2 h-2 rounded-full ${colorMap[currentFocus]} ${isActive ? 'animate-pulse' : 'opacity-50'}`} />
      <span className="text-xs text-gray-400">{labelMap[currentFocus]}</span>
    </div>
  )
}

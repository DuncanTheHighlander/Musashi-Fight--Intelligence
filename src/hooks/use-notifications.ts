import { useState, useEffect } from 'react'
import { parseApiResponse } from '@/lib/safeJson'

interface Notification {
  id: string
  type: string
  title: string
  body: string
  payload: any
  isRead: boolean
  createdAt: string
  readAt?: string
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchNotifications = async (unreadOnly = false) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (unreadOnly) params.set('unread', 'true')
      params.set('limit', '50')
      
      const res = await fetch(`/api/notifications?${params.toString()}`)
      if (res.status === 401) {
        setNotifications([])
        setUnreadCount(0)
        return
      }
      if (!res.ok) throw new Error('Failed to fetch notifications')
      
      const data: { notifications?: Notification[], unreadCount?: number } = await parseApiResponse(res)
      setNotifications(data.notifications || [])
      setUnreadCount(data.unreadCount || 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const markAsRead = async (notificationId: string) => {
    try {
      const res = await fetch(`/api/notifications?id=${notificationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark-read' })
      })
      if (!res.ok) throw new Error('Failed to mark as read')
      
      setNotifications(prev => 
        prev.map(n => n.id === notificationId ? { ...n, isRead: true, readAt: new Date().toISOString() } : n)
      )
      setUnreadCount(prev => Math.max(0, prev - 1))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    }
  }

  const markAllAsRead = async () => {
    try {
      const res = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark-all-read' })
      })
      if (!res.ok) throw new Error('Failed to mark all as read')
      
      setNotifications(prev => 
        prev.map(n => ({ ...n, isRead: true, readAt: new Date().toISOString() }))
      )
      setUnreadCount(0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    }
  }

  const deleteNotification = async (notificationId: string) => {
    try {
      const res = await fetch(`/api/notifications?id=${notificationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete' })
      })
      if (!res.ok) throw new Error('Failed to delete notification')
      
      const notification = notifications.find(n => n.id === notificationId)
      setNotifications(prev => prev.filter(n => n.id !== notificationId))
      if (notification && !notification.isRead) {
        setUnreadCount(prev => Math.max(0, prev - 1))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    }
  }

  useEffect(() => {
    fetchNotifications()
    
    const interval = setInterval(() => {
      fetchNotifications(true)
    }, 30000)
    
    return () => clearInterval(interval)
  }, [])

  return {
    notifications,
    unreadCount,
    loading,
    error,
    refetch: () => fetchNotifications(),
    markAsRead,
    markAllAsRead,
    deleteNotification
  }
}

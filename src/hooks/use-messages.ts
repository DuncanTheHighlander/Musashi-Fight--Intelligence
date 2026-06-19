import { useState, useEffect } from 'react'
import { parseApiResponse } from '@/lib/safeJson'

interface Message {
  id: string
  senderId: string
  receiverId: string
  content: string
  attachments: string[]
  isRead: boolean
  createdAt: string
  readAt?: string
}

interface Conversation {
  partnerId: string
  partnerName: string
  lastMessage: {
    id: string
    content: string
    createdAt: string
    senderId: string
    isRead: boolean
  }
  unreadCount: number
  attachments: string[]
  isVerified: boolean
}

export function useMessages() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchConversations = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/social/messages')
      if (!res.ok) throw new Error('Failed to fetch conversations')
      
      const data: { conversations?: Conversation[] } = await parseApiResponse(res)
      setConversations(data.conversations || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const fetchMessages = async (partnerId: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/social/messages?conversationUserId=${partnerId}`)
      if (!res.ok) throw new Error('Failed to fetch messages')
      
      const data: { messages?: Message[] } = await parseApiResponse(res)
      setMessages(data.messages || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const sendMessage = async (receiverId: string, content: string, attachments: string[] = []) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/social/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiverId, content, attachments })
      })
      if (!res.ok) throw new Error('Failed to send message')
      
      const newMessage: Message = await parseApiResponse(res)
      setMessages(prev => [...prev, newMessage])
      
      await fetchConversations()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const markAsRead = async (partnerId: string) => {
    try {
      const res = await fetch(`/api/social/messages?action=mark-read&conversationUserId=${partnerId}`)
      if (!res.ok) throw new Error('Failed to mark as read')
      
      setMessages(prev => prev.map(msg => 
        msg.receiverId === 'me' ? { ...msg, isRead: true, readAt: new Date().toISOString() } : msg
      ))
      
      await fetchConversations()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    }
  }

  const deleteMessage = async (messageId: string) => {
    try {
      const res = await fetch(`/api/social/messages?id=${messageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete' })
      })
      if (!res.ok) throw new Error('Failed to delete message')
      
      setMessages(prev => prev.filter(msg => msg.id !== messageId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    }
  }

  const selectConversation = (partnerId: string) => {
    setSelectedConversation(partnerId)
    fetchMessages(partnerId)
    markAsRead(partnerId)
  }

  useEffect(() => {
    fetchConversations()
    
    const interval = setInterval(() => {
      fetchConversations()
      if (selectedConversation) {
        fetchMessages(selectedConversation)
      }
    }, 10000)
    
    return () => clearInterval(interval)
  }, [selectedConversation])

  return {
    conversations,
    messages,
    selectedConversation,
    loading,
    error,
    selectConversation,
    sendMessage,
    markAsRead,
    deleteMessage,
    refetchConversations: fetchConversations,
    refetchMessages: () => selectedConversation && fetchMessages(selectedConversation)
  }
}

'use client'

import React, { useState } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Send, Search, MessageSquare } from 'lucide-react'
import { useMessages } from '@/hooks/use-messages'
import { SectionHeader } from '@/components/ui/section-header'
import { ComingSoonSection } from './ComingSoonSection'

const PREVIEW_ENABLED = process.env.NEXT_PUBLIC_MUSASHI_PREVIEW_FEATURES === '1'

export default function MessagesSection() {
  const [searchTerm, setSearchTerm] = useState('')
  const [newMessage, setNewMessage] = useState('')
  const {
    conversations,
    messages,
    selectedConversation,
    loading,
    selectConversation,
    sendMessage,
  } = useMessages()

  const filteredConversations = conversations.filter(conv =>
    conv.partnerName.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const selectedConv = conversations.find(c => c.partnerId === selectedConversation)

  const handleSendMessage = () => {
    if (!newMessage.trim() || !selectedConversation) return
    
    sendMessage(selectedConversation, newMessage.trim())
    setNewMessage('')
  }

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
  }

  if (!PREVIEW_ENABLED) {
    return (
      <ComingSoonSection
        title="Messages"
        icon={MessageSquare}
        description="Direct messaging with fighters and coaches."
        details="Available soon. We're hardening real-time delivery before launch."
      />
    )
  }

  return (
    <div className="container mx-auto px-4 py-8 lg:px-6 lg:py-10 h-[calc(100vh-4rem)] max-w-7xl">
      <SectionHeader
        icon={MessageSquare}
        iconAccent="green"
        eyebrow="Inbox"
        title="Messages"
        subtitle="Connect with fighters, coaches, and analysts"
        className="mb-6"
      />

      <div className="grid h-[calc(100%-7rem)] grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-1 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search conversations..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          <ScrollArea className="h-[calc(100%-3rem)]">
            <div className="space-y-2">
              {filteredConversations.length === 0 && !loading && (
                <div className="text-center py-12 px-4">
                  <MessageSquare className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
                  <h3 className="text-sm font-semibold mb-1">No conversations yet</h3>
                  <p className="text-xs text-muted-foreground">
                    {searchTerm
                      ? 'No matches for your search.'
                      : 'When fighters or coaches message you, they’ll appear here.'}
                  </p>
                </div>
              )}
              {filteredConversations.map((conversation) => (
                <Card
                  key={conversation.partnerId}
                  className={`cursor-pointer transition-colors ${
                    selectedConversation === conversation.partnerId ? 'border-primary bg-accent' : 'hover:bg-accent'
                  }`}
                  onClick={() => selectConversation(conversation.partnerId)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="relative">
                        <Avatar className="h-12 w-12">
                          <AvatarFallback>
                            {getInitials(conversation.partnerName)}
                          </AvatarFallback>
                        </Avatar>
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <h3 className="font-medium truncate">
                            {conversation.partnerName}
                          </h3>
                          <span className="text-xs text-muted-foreground">
                            {formatTime(conversation.lastMessage.createdAt)}
                          </span>
                        </div>
                        
                        <div className="flex items-center gap-2 mb-1">
                          {conversation.isVerified && (
                            <Badge variant="secondary" className="text-xs">
                              Verified
                            </Badge>
                          )}
                          {conversation.unreadCount > 0 && (
                            <Badge className="bg-primary text-primary-foreground text-xs">
                              {conversation.unreadCount}
                            </Badge>
                          )}
                        </div>
                        
                        <p className="text-sm text-muted-foreground truncate">
                          {conversation.lastMessage.content}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </div>

        <div className="lg:col-span-2">
          {selectedConversation ? (
            <Card className="h-full flex flex-col">
              <CardHeader className="border-b">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback>
                        {getInitials(selectedConv?.partnerName || '')}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <h2 className="font-semibold">
                        {selectedConv?.partnerName}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {selectedConv?.isVerified ? 'Verified Fighter' : 'User'}
                      </p>
                    </div>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="flex-1 p-0">
                <ScrollArea className="h-[calc(100%-8rem)] p-4">
                  <div className="space-y-4">
                    {messages.map((message) => (
                      <div
                        key={message.id}
                        className={`flex ${message.senderId === selectedConversation ? 'justify-start' : 'justify-end'}`}
                      >
                        <div
                          className={`max-w-[70%] rounded-lg p-3 ${
                            message.senderId === selectedConversation
                              ? 'bg-accent'
                              : 'bg-primary text-primary-foreground'
                          }`}
                        >
                          <p className="text-sm">{message.content}</p>
                          <p className={`text-xs mt-1 ${
                            message.senderId === selectedConversation ? 'text-muted-foreground' : 'opacity-70'
                          }`}>
                            {formatTime(message.createdAt)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>

              <div className="p-4 border-t">
                <div className="flex gap-2">
                  <Input
                    placeholder="Type a message..."
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                    disabled={loading}
                    className="flex-1"
                  />
                  <Button onClick={handleSendMessage} disabled={loading || !newMessage.trim()}>
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ) : (
            <Card className="h-full flex items-center justify-center">
              <div className="text-center">
                <div className="w-16 h-16 bg-accent rounded-full flex items-center justify-center mx-auto mb-4">
                  <MessageSquare className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-medium mb-2">Select a conversation</h3>
                <p className="text-muted-foreground">Choose a conversation from the list to start messaging</p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

'use client'

import React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Eye } from 'lucide-react'

type PromptPreviewModalProps = {
  templateKey: string
  content: string
  context?: string
  knowledgeContext?: string
  children?: React.ReactNode
}

export function PromptPreviewModal({
  templateKey,
  content,
  context,
  knowledgeContext,
  children,
}: PromptPreviewModalProps) {
  const [open, setOpen] = React.useState(false)

  // Simulate placeholder substitution for preset prompts
  const renderFinalPrompt = () => {
    let final = content.trim()
    if (context) {
      final += '\n\nContext JSON:\n' + context
    }
    if (knowledgeContext) {
      final += '\n\n' + knowledgeContext
    }
    return final
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button variant="outline" size="sm">
            <Eye className="w-4 h-4 mr-2" />
            Preview
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Prompt Preview</DialogTitle>
          <DialogDescription>
            Final composed prompt for <Badge variant="secondary">{templateKey}</Badge>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Textarea
            value={renderFinalPrompt()}
            readOnly
            className="min-h-[400px] font-mono text-sm"
            placeholder="Final prompt will appear here..."
          />
          <div className="text-xs text-muted-foreground">
            <div>Length: {renderFinalPrompt().length} characters</div>
            <div>Lines: {renderFinalPrompt().split('\n').length}</div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

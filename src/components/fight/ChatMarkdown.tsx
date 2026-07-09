'use client'

/**
 * Renders the coach-brain's markdown-shaped chat replies (### headings,
 * **bold**, * bullets) as real elements instead of raw text. See
 * src/lib/chatMarkdown.ts for the parser.
 */
import { parseChatMarkdown, splitBoldSegments } from '@/lib/chatMarkdown'

function InlineText({ text }: { text: string }) {
  const segments = splitBoldSegments(text)
  return (
    <>
      {segments.map((seg, i) => (seg.bold ? <strong key={i}>{seg.text}</strong> : <span key={i}>{seg.text}</span>))}
    </>
  )
}

export default function ChatMarkdown({ text }: { text: string }) {
  const blocks = parseChatMarkdown(text ?? '')
  if (blocks.length === 0) return null

  return (
    <div className="space-y-1.5">
      {blocks.map((block, i) => {
        if (block.type === 'heading') {
          const className = block.level === 2 ? 'text-sm font-semibold' : 'text-sm font-semibold text-foreground/95'
          return block.level === 2 ? (
            <h4 key={i} className={className}><InlineText text={block.text} /></h4>
          ) : (
            <h5 key={i} className={className}><InlineText text={block.text} /></h5>
          )
        }
        if (block.type === 'list') {
          return (
            <ul key={i} className="list-disc space-y-0.5 pl-4">
              {block.items.map((item, j) => (
                <li key={j}><InlineText text={item} /></li>
              ))}
            </ul>
          )
        }
        return (
          <p key={i}>
            <InlineText text={block.text} />
          </p>
        )
      })}
    </div>
  )
}

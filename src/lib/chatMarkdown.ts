/**
 * Minimal markdown parsing for AI chat bubbles. The coach-brain output rules
 * format structured coaching answers with `### ` headings, `**bold**`
 * labels, and `* ` bullets — chat bubbles previously rendered that as plain
 * `whitespace-pre-wrap` text, so users saw literal "###"/"**" symbols.
 *
 * Deliberately not a full CommonMark implementation — just the subset the
 * coaching prompts actually produce. No new dependency (react-markdown etc.)
 * so this doesn't touch package.json/the lockfile.
 */

export type ChatMdBlock =
  | { type: 'heading'; level: 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }

export function parseChatMarkdown(input: string): ChatMdBlock[] {
  const lines = input.replace(/\r\n/g, '\n').split('\n')
  const blocks: ChatMdBlock[] = []
  let paragraphBuf: string[] = []
  let listBuf: string[] = []

  const flushParagraph = () => {
    if (paragraphBuf.length) {
      blocks.push({ type: 'paragraph', text: paragraphBuf.join(' ').trim() })
      paragraphBuf = []
    }
  }
  const flushList = () => {
    if (listBuf.length) {
      blocks.push({ type: 'list', items: listBuf })
      listBuf = []
    }
  }

  for (const rawLine of lines) {
    const trimmed = rawLine.trim()

    if (trimmed === '') {
      flushParagraph()
      flushList()
      continue
    }

    const h3 = trimmed.match(/^###\s+(.*)$/)
    if (h3) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'heading', level: 3, text: h3[1].trim() })
      continue
    }
    const h2 = trimmed.match(/^##\s+(.*)$/)
    if (h2) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'heading', level: 2, text: h2[1].trim() })
      continue
    }
    // Bullet marker requires whitespace right after * or - so a bold line
    // like "**1. Title**" (no space after the first *) is never misread as
    // a list item — it falls through to the paragraph branch instead.
    const bullet = trimmed.match(/^[*-]\s+(.*)$/)
    if (bullet) {
      flushParagraph()
      listBuf.push(bullet[1].trim())
      continue
    }

    flushList()
    paragraphBuf.push(trimmed)
  }
  flushParagraph()
  flushList()
  return blocks
}

export type BoldSegment = { text: string; bold: boolean }

/** Splits `**bold**` runs out of a line for inline rendering. */
export function splitBoldSegments(text: string): BoldSegment[] {
  const segments: BoldSegment[] = []
  const regex = /\*\*(.+?)\*\*/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), bold: false })
    }
    segments.push({ text: match[1], bold: true })
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), bold: false })
  }
  if (segments.length === 0) segments.push({ text, bold: false })
  return segments
}

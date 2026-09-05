import { describe, expect, test } from 'vitest'
import { parseChatMarkdown, splitBoldSegments } from './chatMarkdown'

describe('parseChatMarkdown', () => {
  test('parses a heading', () => {
    expect(parseChatMarkdown('### Coach\'s Read')).toEqual([
      { type: 'heading', level: 3, text: "Coach's Read" },
    ])
  })

  test('parses a bold-only line as a paragraph, not a bullet', () => {
    const blocks = parseChatMarkdown('**1. Open Guard Connection**')
    expect(blocks).toEqual([{ type: 'paragraph', text: '**1. Open Guard Connection**' }])
  })

  test('groups consecutive bullets into one list block', () => {
    const blocks = parseChatMarkdown('* First\n* Second\n* Third')
    expect(blocks).toEqual([{ type: 'list', items: ['First', 'Second', 'Third'] }])
  })

  test('a blank line ends a list even with more bullets after a paragraph', () => {
    const blocks = parseChatMarkdown('* One\n\nSome text\n\n* Two')
    expect(blocks).toEqual([
      { type: 'list', items: ['One'] },
      { type: 'paragraph', text: 'Some text' },
      { type: 'list', items: ['Two'] },
    ])
  })

  test('joins consecutive non-blank lines into one paragraph', () => {
    const blocks = parseChatMarkdown('Line one\nLine two')
    expect(blocks).toEqual([{ type: 'paragraph', text: 'Line one Line two' }])
  })

  test('matches the real coach-brain shape end to end', () => {
    const input = [
      "### Coach's Read",
      '',
      'The top player bypassed your open guard.',
      '',
      '### 3 Things to Fix',
      '',
      '**1. Open Guard Connection**',
      '*   **The Problem:** No early contact.',
      '*   **The Fix:** Get grips immediately.',
    ].join('\n')

    expect(parseChatMarkdown(input)).toEqual([
      { type: 'heading', level: 3, text: "Coach's Read" },
      { type: 'paragraph', text: 'The top player bypassed your open guard.' },
      { type: 'heading', level: 3, text: '3 Things to Fix' },
      { type: 'paragraph', text: '**1. Open Guard Connection**' },
      {
        type: 'list',
        items: ['**The Problem:** No early contact.', '**The Fix:** Get grips immediately.'],
      },
    ])
  })

  test('empty input yields no blocks', () => {
    expect(parseChatMarkdown('')).toEqual([])
    expect(parseChatMarkdown('   \n  \n')).toEqual([])
    expect(parseChatMarkdown(undefined as unknown as string)).toEqual([])
  })
})

describe('splitBoldSegments', () => {
  test('plain text with no bold stays a single segment', () => {
    expect(splitBoldSegments('just text')).toEqual([{ text: 'just text', bold: false }])
  })

  test('splits a single bold run', () => {
    expect(splitBoldSegments('**The Problem:** no contact')).toEqual([
      { text: 'The Problem:', bold: true },
      { text: ' no contact', bold: false },
    ])
  })

  test('handles multiple bold runs', () => {
    expect(splitBoldSegments('a **b** c **d** e')).toEqual([
      { text: 'a ', bold: false },
      { text: 'b', bold: true },
      { text: ' c ', bold: false },
      { text: 'd', bold: true },
      { text: ' e', bold: false },
    ])
  })
})

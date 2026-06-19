import { NextResponse } from 'next/server'
import { createDocument } from '@/lib/musashiLibrary'

interface ImportMapping {
  titleField: string
  contentField: string
  tagsField?: string
  disciplineField?: string
  difficultyField?: string
}

interface ImportRequest {
  sourceUrl?: string
  data?: Record<string, any>[]
  format?: 'json' | 'csv'
  mapping: ImportMapping
  tags?: string[]
  sourceType?: string
}

function extractField(record: Record<string, any>, fieldPath: string): any {
  const parts = fieldPath.split('.')
  let value: any = record
  for (const part of parts) {
    if (value == null) return null
    value = value[part]
  }
  return value
}

export async function POST(req: Request) {
  try {
    // Only allow imports from admin (Shogun) or in development
    const isDev = process.env.NODE_ENV === 'development'

    if (!isDev) {
      const { requireUser } = await import('@/lib/musashiAuth')
      await requireUser(req, { role: 'shogun' })
    }

    const body = (await req.json()) as ImportRequest
    const { sourceUrl, data, mapping, tags: extraTags, sourceType } = body

    if (!mapping?.titleField || !mapping?.contentField) {
      return NextResponse.json(
        { error: 'mapping.titleField and mapping.contentField are required' },
        { status: 400 }
      )
    }

    let records: Record<string, any>[] = []

    // Option A: fetch from URL
    if (sourceUrl) {
      try {
        const res = await fetch(sourceUrl)
        if (!res.ok) {
          return NextResponse.json(
            { error: `Failed to fetch source: ${res.status} ${res.statusText}` },
            { status: 502 }
          )
        }
        const fetched = (await res.json()) as Record<string, any> | Record<string, any>[]
        records = Array.isArray(fetched) ? fetched : (fetched as any).data || (fetched as any).results || [fetched]
      } catch (e) {
        return NextResponse.json(
          { error: `Failed to fetch source URL: ${e instanceof Error ? e.message : String(e)}` },
          { status: 502 }
        )
      }
    }

    // Option B: inline data
    if (data && Array.isArray(data)) {
      records = [...records, ...data]
    }

    if (records.length === 0) {
      return NextResponse.json(
        { error: 'No records to import. Provide sourceUrl or data array.' },
        { status: 400 }
      )
    }

    // Cap at 100 records per import to prevent abuse
    const maxRecords = 100
    if (records.length > maxRecords) {
      records = records.slice(0, maxRecords)
    }

    const results: { title: string; id: string; status: string }[] = []
    const errors: { index: number; error: string }[] = []

    for (let i = 0; i < records.length; i++) {
      const record = records[i]
      try {
        const title = String(extractField(record, mapping.titleField) || `Import ${i + 1}`)
        const content = String(extractField(record, mapping.contentField) || '')

        if (!content.trim()) {
          errors.push({ index: i, error: 'Empty content' })
          continue
        }

        const recordTags: string[] = [...(extraTags || [])]
        if (mapping.tagsField) {
          const tagValue = extractField(record, mapping.tagsField)
          if (Array.isArray(tagValue)) {
            recordTags.push(...tagValue.map(String))
          } else if (typeof tagValue === 'string') {
            recordTags.push(...tagValue.split(',').map((t: string) => t.trim()).filter(Boolean))
          }
        }

        if (mapping.disciplineField) {
          const disc = extractField(record, mapping.disciplineField)
          if (disc) recordTags.push(String(disc))
        }

        const doc = await createDocument({
          title,
          content,
          sourceType: (sourceType as any) || 'api',
          tags: recordTags,
          metadata: {
            importedFrom: sourceUrl || 'inline',
            importedAt: new Date().toISOString(),
            originalRecord: record,
          },
        })

        results.push({ title: doc.title, id: doc.id, status: 'created' })
      } catch (e) {
        errors.push({ index: i, error: e instanceof Error ? e.message : String(e) })
      }
    }

    return NextResponse.json({
      success: true,
      imported: results.length,
      errors: errors.length,
      results,
      ...(errors.length > 0 ? { errorDetails: errors } : {}),
    })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Login required' }, { status: 401 })
    }
    if (code === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }
    return NextResponse.json(
      { error: 'Import failed', details: code },
      { status: 500 }
    )
  }
}

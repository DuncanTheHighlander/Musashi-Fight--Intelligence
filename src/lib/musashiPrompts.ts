import { getDb } from '@/lib/db'

export type MusashiPromptTemplate = {
  id: string
  key: string
  name: string
  description: string | null
}

export type MusashiPromptVersion = {
  id: string
  templateId: string
  version: number
  content: string
  createdByUserId: string | null
  createdAt: string
}

export const getActivePromptContent = async (templateKey: string, fallback: string): Promise<string> => {
  try {
    const db = getDb()
    const row = await db
      .prepare(
        'SELECT v.content as content FROM musashi_prompt_templates t JOIN musashi_prompt_active a ON a.template_id = t.id JOIN musashi_prompt_versions v ON v.id = a.active_version_id WHERE t.key = ? LIMIT 1'
      )
      .bind(templateKey)
      .first()

    const content = row?.content != null ? String(row.content) : ''
    return content.trim() ? content : fallback
  } catch {
    return fallback
  }
}

export const getPromptBundleForKey = async (
  templateKey: string
): Promise<{
  template: MusashiPromptTemplate | null
  active: MusashiPromptVersion | null
  versions: MusashiPromptVersion[]
}> => {
  const db = getDb()

  const templateRow = await db
    .prepare('SELECT id, key, name, description FROM musashi_prompt_templates WHERE key = ?')
    .bind(templateKey)
    .first()

  if (!templateRow?.id) {
    return { template: null, active: null, versions: [] }
  }

  const template: MusashiPromptTemplate = {
    id: String(templateRow.id),
    key: String(templateRow.key),
    name: String(templateRow.name),
    description: templateRow.description != null ? String(templateRow.description) : null,
  }

  const activeRow = await db
    .prepare(
      'SELECT v.id, v.template_id, v.version, v.content, v.created_by_user_id, v.created_at FROM musashi_prompt_active a JOIN musashi_prompt_versions v ON v.id = a.active_version_id WHERE a.template_id = ?'
    )
    .bind(template.id)
    .first()

  const active: MusashiPromptVersion | null = activeRow?.id
    ? {
        id: String(activeRow.id),
        templateId: String(activeRow.template_id),
        version: Number(activeRow.version),
        content: String(activeRow.content),
        createdByUserId: activeRow.created_by_user_id != null ? String(activeRow.created_by_user_id) : null,
        createdAt: String(activeRow.created_at),
      }
    : null

  const versionsRows = await db
    .prepare(
      'SELECT id, template_id, version, content, created_by_user_id, created_at FROM musashi_prompt_versions WHERE template_id = ? ORDER BY version DESC LIMIT 50'
    )
    .bind(template.id)
    .all()

  const versions: MusashiPromptVersion[] = (versionsRows?.results || []).map((r: any) => ({
    id: String(r.id),
    templateId: String(r.template_id),
    version: Number(r.version),
    content: String(r.content),
    createdByUserId: r.created_by_user_id != null ? String(r.created_by_user_id) : null,
    createdAt: String(r.created_at),
  }))

  return { template, active, versions }
}

export const upsertPromptTemplateAndCreateVersion = async (params: {
  key: string
  name: string
  description?: string | null
  content: string
  createdByUserId?: string | null
  createdByUserEmail?: string | null
  reason?: string
}): Promise<{ template: MusashiPromptTemplate; active: MusashiPromptVersion; validationResult?: { valid: boolean; errors: string[] } }> => {
  const db = getDb()

  const key = String(params.key || '').trim()
  const name = String(params.name || '').trim()
  const content = String(params.content || '')

  if (!key) throw new Error('Missing key')
  if (!name) throw new Error('Missing name')
  if (!content.trim()) throw new Error('Missing content')

  // Validation
  const validationResult = await validatePromptContent(key, content)
  if (!validationResult.valid) {
    throw new Error(`Validation failed: ${validationResult.errors.join('; ')}`)
  }

  const now = new Date().toISOString()

  const existing = await db.prepare('SELECT id FROM musashi_prompt_templates WHERE key = ?').bind(key).first()

  const templateId = existing?.id ? String(existing.id) : crypto.randomUUID()

  await db
    .prepare(
      'INSERT INTO musashi_prompt_templates (id, key, name, description, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET name=excluded.name, description=excluded.description, updated_at=excluded.updated_at'
    )
    .bind(templateId, key, name, params.description ?? null, now)
    .run()

  const latest = await db
    .prepare('SELECT MAX(version) as v FROM musashi_prompt_versions WHERE template_id = ?')
    .bind(templateId)
    .first()

  const nextVersion = latest?.v != null ? Number(latest.v) + 1 : 1
  const versionId = crypto.randomUUID()

  await db
    .prepare(
      'INSERT INTO musashi_prompt_versions (id, template_id, version, content, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .bind(versionId, templateId, nextVersion, content, params.createdByUserId ?? null, now)
    .run()

  await db
    .prepare(
      'INSERT INTO musashi_prompt_active (template_id, active_version_id, updated_at) VALUES (?, ?, ?) ON CONFLICT(template_id) DO UPDATE SET active_version_id=excluded.active_version_id, updated_at=excluded.updated_at'
    )
    .bind(templateId, versionId, now)
    .run()

  // Audit log for creation
  const auditId = crypto.randomUUID()
  const metadata = JSON.stringify({
    reason: params.reason || null,
    action: 'created',
    validationResult,
  })
  await db
    .prepare(
      'INSERT INTO musashi_prompt_audit (id, template_id, version_id, action, user_id, user_email, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(auditId, templateId, versionId, 'created', params.createdByUserId || null, params.createdByUserEmail || null, metadata, now)
    .run()

  const template: MusashiPromptTemplate = {
    id: templateId,
    key,
    name,
    description: params.description != null ? String(params.description) : null,
  }

  const active: MusashiPromptVersion = {
    id: versionId,
    templateId,
    version: nextVersion,
    content,
    createdByUserId: params.createdByUserId != null ? String(params.createdByUserId) : null,
    createdAt: now,
  }

  return { template, active, validationResult }
}

export const activatePromptVersion = async (params: { templateKey: string; versionId: string; userId?: string | null; userEmail?: string | null; reason?: string }): Promise<void> => {
  const db = getDb()

  const key = String(params.templateKey || '').trim()
  const versionId = String(params.versionId || '').trim()
  if (!key) throw new Error('Missing key')
  if (!versionId) throw new Error('Missing versionId')

  const template = await db.prepare('SELECT id FROM musashi_prompt_templates WHERE key = ?').bind(key).first()
  if (!template?.id) throw new Error('Unknown template')

  const templateId = String(template.id)
  const exists = await db
    .prepare('SELECT id FROM musashi_prompt_versions WHERE id = ? AND template_id = ?')
    .bind(versionId, templateId)
    .first()

  if (!exists?.id) throw new Error('Unknown version')

  // Fetch previous active version for audit
  const previousActive = await db
    .prepare(
      'SELECT a.active_version_id FROM musashi_prompt_active a WHERE a.template_id = ?'
    )
    .bind(templateId)
    .first()

  const now = new Date().toISOString()
  await db
    .prepare(
      'INSERT INTO musashi_prompt_active (template_id, active_version_id, updated_at) VALUES (?, ?, ?) ON CONFLICT(template_id) DO UPDATE SET active_version_id=excluded.active_version_id, updated_at=excluded.updated_at'
    )
    .bind(templateId, versionId, now)
    .run()

  // Audit log
  const auditId = crypto.randomUUID()
  const metadata = JSON.stringify({
    oldVersionId: previousActive?.active_version_id || null,
    reason: params.reason || null,
    action: 'activated',
  })
  await db
    .prepare(
      'INSERT INTO musashi_prompt_audit (id, template_id, version_id, action, user_id, user_email, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(auditId, templateId, versionId, 'activated', params.userId || null, params.userEmail || null, metadata, now)
    .run()
}

type ValidationResult = {
  valid: boolean
  errors: string[]
}

export const validatePromptContent = async (templateKey: string, content: string): Promise<ValidationResult> => {
  const errors: string[] = []
  const db = getDb()

  // Fetch validation rules for this template key
  const ruleRow = await db
    .prepare('SELECT max_length, required_placeholders, forbidden_patterns FROM musashi_prompt_validation_rules WHERE template_key = ?')
    .bind(templateKey)
    .first()

  const maxLength = ruleRow?.max_length ? Number(ruleRow.max_length) : 10000
  const requiredPlaceholders: string[] = ruleRow?.required_placeholders ? JSON.parse(String(ruleRow.required_placeholders)) : []
  const forbiddenPatterns: string[] = ruleRow?.forbidden_patterns ? JSON.parse(String(ruleRow.forbidden_patterns)) : []

  // Length validation
  if (content.length > maxLength) {
    errors.push(`Content exceeds maximum length of ${maxLength} characters (current: ${content.length})`)
  }

  // Required placeholders validation
  for (const placeholder of requiredPlaceholders) {
    if (!content.includes(placeholder)) {
      errors.push(`Missing required placeholder: ${placeholder}`)
    }
  }

  // Forbidden patterns validation
  for (const pattern of forbiddenPatterns) {
    try {
      const regex = new RegExp(pattern, 'i')
      if (regex.test(content)) {
        errors.push(`Content contains forbidden pattern: ${pattern}`)
      }
    } catch {
      // Skip invalid regex patterns
    }
  }

  // Basic sanity checks
  if (!content.trim()) {
    errors.push('Content cannot be empty')
  }

  return { valid: errors.length === 0, errors }
}

export const getPromptAuditLogs = async (templateId: string, limit = 50): Promise<{
  id: string
  action: string
  user_id: string | null
  user_email: string | null
  metadata: string | null
  created_at: string
  version_id: string
}[]> => {
  const db = getDb()
  const rows = await db
    .prepare(
      `SELECT id, action, user_id, user_email, metadata, created_at, version_id
       FROM musashi_prompt_audit
       WHERE template_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .bind(templateId, limit)
    .all()
  return (rows?.results || []).map((r: any) => ({
    id: String(r.id),
    action: String(r.action),
    user_id: r.user_id != null ? String(r.user_id) : null,
    user_email: r.user_email != null ? String(r.user_email) : null,
    metadata: r.metadata != null ? String(r.metadata) : null,
    created_at: String(r.created_at),
    version_id: String(r.version_id),
  }))
}

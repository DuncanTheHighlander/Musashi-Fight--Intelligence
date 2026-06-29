/**
 * Client-side upload helper — creates ticket, PUTs bytes, completes.
 */
export type UploadPurpose = 'job_video' | 'deliverable' | 'dispute_evidence' | 'profile_media' | 'analysis_clip'

export type UploadedAsset = {
  id: string
  purpose: UploadPurpose
  originalName: string
  contentType: string
}

type TicketResponse = {
  asset: { id: string; status: string }
  upload: {
    method: string
    url: string
    headers: Record<string, string>
  }
}

export async function uploadMarketplaceFile(args: {
  file: File
  purpose: UploadPurpose
  jobId?: string
  disputeId?: string
  onProgress?: (pct: number) => void
}): Promise<UploadedAsset> {
  const { file, purpose, jobId, disputeId, onProgress } = args

  const ticketRes = await fetch('/api/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      purpose,
      originalName: file.name,
      contentType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      jobId,
      disputeId,
    }),
  })
  if (!ticketRes.ok) {
    const err = await ticketRes.json().catch(() => ({}))
    const message = String((err as { error?: string }).error || 'Failed to create upload ticket')
    if (ticketRes.status === 501) {
      throw new Error('Direct upload unavailable — paste a shareable link instead.')
    }
    throw new Error(message)
  }
  const ticket = (await ticketRes.json()) as TicketResponse

  await putWithProgress(ticket.upload.url, file, ticket.upload.headers, onProgress)

  const completeRes = await fetch(`/api/uploads/${ticket.asset.id}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ sizeBytes: file.size }),
  })
  if (!completeRes.ok) {
    const err = await completeRes.json().catch(() => ({}))
    throw new Error(String((err as { error?: string }).error || 'Failed to complete upload'))
  }

  return {
    id: ticket.asset.id,
    purpose,
    originalName: file.name,
    contentType: file.type || 'application/octet-stream',
  }
}

function putWithProgress(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress?: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.withCredentials = true
    for (const [k, v] of Object.entries(headers || {})) {
      xhr.setRequestHeader(k, v)
    }
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) {
        onProgress(Math.round((ev.loaded / ev.total) * 100))
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`Upload failed (${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error('Upload network error'))
    xhr.send(file)
  })
}

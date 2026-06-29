'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Upload, X, Loader2, FileVideo } from 'lucide-react'
import { uploadMarketplaceFile, type UploadPurpose, type UploadedAsset } from '@/lib/storage/uploadClient'
import { cn } from '@/lib/utils'

type Props = {
  purpose: UploadPurpose
  accept?: string
  label?: string
  hint?: string
  jobId?: string
  disputeId?: string
  disabled?: boolean
  className?: string
  onUploaded: (asset: UploadedAsset) => void
  onRemoved?: (assetId: string) => void
}

export function UploadDropzone({
  purpose,
  accept,
  label = 'Upload file',
  hint,
  jobId,
  disputeId,
  disabled,
  className,
  onUploaded,
  onRemoved,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [items, setItems] = useState<UploadedAsset[]>([])
  const [error, setError] = useState<string | null>(null)

  async function handleFiles(fileList: FileList | null) {
    if (!fileList?.length || disabled || uploading) return
    setError(null)
    setUploading(true)
    setProgress(0)
    try {
      for (const file of Array.from(fileList)) {
        const asset = await uploadMarketplaceFile({
          file,
          purpose,
          jobId,
          disputeId,
          onProgress: setProgress,
        })
        setItems((prev) => [...prev, asset])
        onUploaded(asset)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
      setProgress(0)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((x) => x.id !== id))
    onRemoved?.(id)
  }

  return (
    <div className={cn('space-y-2', className)}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={purpose === 'job_video' || purpose === 'dispute_evidence'}
        className="hidden"
        disabled={disabled || uploading}
        onChange={(e) => void handleFiles(e.target.files)}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
        className="w-full justify-start"
      >
        {uploading ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <Upload className="h-4 w-4 mr-2" />
        )}
        {uploading ? `Uploading ${progress}%…` : label}
      </Button>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {uploading && progress > 0 && <Progress value={progress} className="h-1.5" />}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {items.length > 0 && (
        <ul className="space-y-1">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 text-xs"
            >
              <span className="flex items-center gap-1.5 min-w-0">
                <FileVideo className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{item.originalName}</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={() => removeItem(item.id)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

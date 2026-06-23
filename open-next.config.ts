import { defineCloudflareConfig } from '@opennextjs/cloudflare'

export default defineCloudflareConfig({
  // No incremental cache binding is configured yet. Keep the package build
  // deployable, then wire R2/KV cache deliberately when we add that binding.
  incrementalCache: 'dummy',
  tagCache: 'dummy',
  queue: 'dummy',
  cachePurge: 'dummy',
  enableCacheInterception: false,
})

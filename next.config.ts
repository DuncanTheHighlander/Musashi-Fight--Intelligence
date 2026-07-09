import path from 'path'
import { NextConfig } from 'next'
import webpack from 'webpack'

const localD1Binding = path.join(__dirname, 'src/lib/localD1Binding.ts')
const localD1BindingStub = path.join(__dirname, 'src/lib/localD1Binding.stub.ts')
const instrumentationNode = path.join(__dirname, 'src/instrumentation.node.ts')
const instrumentationNodeStub = path.join(__dirname, 'src/instrumentation.node.stub.ts')

const nextConfig: NextConfig = {
  // wrangler/miniflare pull Node-only deps; keep them out of the webpack graph
  serverExternalPackages: ['wrangler', 'miniflare'],
  async redirects() {
    return []
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(self), geolocation=()',
          },
        ],
      },
    ]
  },
  webpack: (config, { dev, isServer, nextRuntime }) => {
    if (isServer && config.output) {
      config.output.chunkFilename = '[name].js'
    }

    if (dev) {
      config.cache = {
        type: 'filesystem',
        maxMemoryGenerations: 1,
      }
    }

    config.resolve = config.resolve || {}
    config.resolve.alias = {
      ...config.resolve.alias,
      sharp: false,
      '@img/sharp-libvips-dev/include': false,
      '@img/sharp-libvips-dev/cplusplus': false,
      '@img/sharp-wasm32/versions': false,
    }

    // Keep wrangler/miniflare out of client and edge bundles (Node-only tooling).
    if (!isServer || nextRuntime === 'edge') {
      config.resolve.alias = {
        ...config.resolve.alias,
        wrangler: false,
        miniflare: false,
        [localD1Binding]: localD1BindingStub,
        [instrumentationNode]: instrumentationNodeStub,
      }
      config.plugins = config.plugins || []
      config.plugins.push(
        new webpack.IgnorePlugin({ resourceRegExp: /^wrangler$/ }),
        new webpack.IgnorePlugin({ resourceRegExp: /^miniflare$/ })
      )
    }

    // ONNX Runtime Web + @huggingface/transformers need special handling:
    // - Exclude Node.js-only modules from the browser bundle
    // - Allow .wasm and .onnx files to be served as assets
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
        os: false,
        child_process: false,
        perf_hooks: false,
      }

      // Exclude Node.js onnxruntime from browser bundle
      // (use onnxruntime-web instead, which is browser-compatible)
      config.resolve.alias = {
        ...config.resolve.alias,
        'onnxruntime-node': false,
        wrangler: false,
        miniflare: false,
        esbuild: false,
        [localD1Binding]: localD1BindingStub,
        [instrumentationNode]: instrumentationNodeStub,
      }

      config.plugins = config.plugins || []
      config.plugins.push(
        new webpack.IgnorePlugin({ resourceRegExp: /^wrangler$/ }),
        new webpack.IgnorePlugin({ resourceRegExp: /^miniflare$/ }),
        new webpack.IgnorePlugin({ resourceRegExp: /^esbuild$/ })
      )
    }

    // Exclude .node native binaries from webpack
    config.module = config.module || {}
    config.module.rules = config.module.rules || []

    // Ignore .node files (Node.js native modules)
    config.module.rules.push({
      test: /\.node$/,
      use: 'ignore-loader',
    })

    // Treat .onnx files as assets so they can be loaded by ONNX Runtime
    config.module.rules.push({
      test: /\.onnx$/,
      type: 'asset/resource',
    })

    return config
  },
}

export default nextConfig

import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'

// OpenNext Cloudflare dev proxy requires wrangler login when remoteBindings is
// enabled (default). Musashi does not call getCloudflareContext(); local dev
// uses mock D1 (MUSASHI_DISABLE_AUTH=1) or initLocalD1Binding (MUSASHI_D1_LOCAL=1).
// Only opt in when explicitly testing Cloudflare bindings in next dev.
if (
  process.env.NODE_ENV === 'development' &&
  process.env.MUSASHI_OPENNEXT_DEV === '1'
) {
  initOpenNextCloudflareForDev({
    configPath: 'wrangler.toml',
    persist: true,
    remoteBindings: false,
  })
}

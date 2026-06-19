import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

const sampleProducts = [
  {
    title: "Muay Thai Roundhouse Kick Mastery",
    description: "Complete breakdown of the perfect roundhouse technique with balance drills and power generation",
    type: "video",
    price: 29.99,
    creator_name: "Saenchai Sor. Kingstar",
    tags: JSON.stringify(["muay thai", "kicks", "technique", "striking"]),
    video_url: "https://example.com/roundhouse-demo.mp4",
    thumbnail_url: "https://example.com/roundhouse-thumb.jpg",
    duration: 1800, // 30 minutes
    rating: 4.8,
    review_count: 127,
    sales_count: 892,
    is_published: true
  },
  {
    title: "Brazilian Jiu-Jitsu Guard Passing Fundamentals",
    description: "Essential guard passing techniques for white and blue belts - pressure, posture, and progression",
    type: "video", 
    price: 39.99,
    creator_name: "Gordon Ryan",
    tags: JSON.stringify(["bjj", "guard passing", "fundamentals", "grappling"]),
    video_url: "https://example.com/guard-passing.mp4",
    thumbnail_url: "https://example.com/guard-passing-thumb.jpg", 
    duration: 2400, // 40 minutes
    rating: 4.9,
    review_count: 203,
    sales_count: 1456,
    is_published: true
  },
  {
    title: "Boxing Footwork & Angles Masterclass",
    description: "Advanced footwork patterns, angle creation, and ring cutting strategies from a pro champion",
    type: "coaching",
    price: 149.99,
    creator_name: "Vasiliy Lomachenko",
    tags: JSON.stringify(["boxing", "footwork", "angles", "strategy"]),
    video_url: "https://example.com/footwork-masterclass.mp4",
    thumbnail_url: "https://example.com/footwork-thumb.jpg",
    duration: 3600, // 1 hour
    rating: 4.7,
    review_count: 89,
    sales_count: 423,
    is_published: true
  },
  {
    title: "MMA Elbow Strikes Complete Guide",
    description: "12 different elbow techniques with setups, counters, and fight-ending combinations",
    type: "pdf",
    price: 19.99,
    creator_name: "Jesse Roncero",
    tags: JSON.stringify(["mma", "elbows", "striking", "techniques"]),
    video_url: "",
    thumbnail_url: "https://example.com/elbows-guide-thumb.jpg",
    duration: 0,
    rating: 4.6,
    review_count: 156,
    sales_count: 678,
    is_published: true
  },
  {
    title: "Wrestling Double Leg Takedown System",
    description: "From setup to finish - the complete double leg takedown system for MMA and wrestling",
    type: "video",
    price: 49.99,
    creator_name: "Jordan Burroughs",
    tags: JSON.stringify(["wrestling", "takedowns", "double leg", "mma"]),
    video_url: "https://example.com/double-leg-system.mp4",
    thumbnail_url: "https://example.com/double-leg-thumb.jpg",
    duration: 2700, // 45 minutes
    rating: 4.9,
    review_count: 178,
    sales_count: 934,
    is_published: true
  },
  {
    title: "Combat Sports Conditioning Program",
    description: "12-week strength and conditioning program specifically designed for fighters",
    type: "coaching",
    price: 89.99,
    creator_name: "Phil Daru",
    tags: JSON.stringify(["conditioning", "strength", "fitness", "training"]),
    video_url: "https://example.com/conditioning-program.mp4",
    thumbnail_url: "https://example.com/conditioning-thumb.jpg",
    duration: 5400, // 90 minutes
    rating: 4.5,
    review_count: 234,
    sales_count: 1567,
    is_published: true
  }
]

// Hard guard — this endpoint inserts fake celebrity-named products
// ("Saenchai Sor. Kingstar", "Gordon Ryan", "Vasiliy Lomachenko", etc.)
// into the content_products table. It exists ONLY for local development
// testing of the marketplace UI with non-trivial data. Shipping fake
// creators to a real audience is a credibility tax we will not pay.
//
// To run the seed locally you must explicitly set BOTH of:
//   - NODE_ENV !== 'production'
//   - MUSASHI_ALLOW_MARKETPLACE_SEED=1
// In any other environment this returns 403 and refuses to write.
const isSeedAllowed = (): boolean => {
  if (process.env.NODE_ENV === 'production') return false
  return process.env.MUSASHI_ALLOW_MARKETPLACE_SEED === '1'
}

export async function POST() {
  if (!isSeedAllowed()) {
    return NextResponse.json(
      {
        error:
          'Marketplace seeding is disabled. This endpoint only writes fake demo data and is blocked outside opt-in local development. Set MUSASHI_ALLOW_MARKETPLACE_SEED=1 with NODE_ENV != production to re-enable.',
      },
      { status: 403 }
    )
  }

  try {
    const db = getDb()

    for (const product of sampleProducts) {
      // Check if product already exists
      const existing = await db.prepare(`
        SELECT id FROM content_products WHERE title = ? AND creator_name = ?
      `).bind(product.title, product.creator_name).first()
      
      if (!existing) {
        await db.prepare(`
          INSERT INTO content_products (
            creator_id, creator_name, creator_avatar, title, description, type,
            price, currency, video_url, thumbnail_url, duration, tags,
            is_published, sales_count, rating, review_count, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).bind(
          'sample-creator-' + product.creator_name.toLowerCase().replace(' ', '-'),
          product.creator_name,
          '',
          product.title,
          product.description,
          product.type,
          product.price,
          'USD',
          product.video_url,
          product.thumbnail_url,
          product.duration,
          product.tags,
          product.is_published,
          product.sales_count,
          product.rating,
          product.review_count
        ).run()
      }
    }
    
    return NextResponse.json({ 
      success: true, 
      message: 'Sample marketplace products seeded successfully' 
    })
  } catch (error) {
    console.error('Error seeding marketplace:', error)
    return NextResponse.json(
      { error: 'Failed to seed marketplace products' },
      { status: 500 }
    )
  }
}

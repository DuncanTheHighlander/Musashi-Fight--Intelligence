import { NextRequest, NextResponse } from 'next/server'
import { getDbOrNull } from '@/lib/db'

export async function GET() {
  try {
    const DB = getDbOrNull()
    
    // If DB is not available, return zeros
    if (!DB) {
      return NextResponse.json({
        aiAnalyses: 0,
        videosReviewed: 0,
        community: 0,
        techniques: 0,
        aiAnalysesTrend: '+0%',
        videosReviewedTrend: '+0%',
        communityTrend: '+0%',
        techniquesTrend: '+0%'
      })
    }
    
    // Get current date for trend calculations
    const now = new Date()
    const previousDay = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    
    // Fetch AI Analyses count with fallback
    let currentAnalyses = 0
    let previousAnalyses = 0
    try {
      const result = await DB.prepare(`
        SELECT COALESCE(SUM(analyze_count), 0) as total_analyses
        FROM musashi_usage_daily
      `).bind().first()
      currentAnalyses = result?.total_analyses || 0
      
      const prevResult = await DB.prepare(`
        SELECT COALESCE(SUM(analyze_count), 0) as total_analyses
        FROM musashi_usage_daily 
        WHERE day = ?
      `).bind(previousDay).first()
      previousAnalyses = prevResult?.total_analyses || 0
    } catch (err) {
      console.log('AI analyses query failed:', err)
    }
    
    // Fetch Videos count with fallback
    let videosCount = 0
    try {
      const result = await DB.prepare(`
        SELECT COUNT(DISTINCT id) as video_count
        FROM scouting_requests 
        WHERE videos IS NOT NULL AND videos != '[]'
      `).bind().first()
      videosCount = result?.video_count || 0
    } catch (err) {
      console.log('Videos query failed:', err)
    }
    
    // Fetch Community count with fallback
    let communityCount = 0
    try {
      const result = await DB.prepare(`
        SELECT COUNT(*) as user_count
        FROM musashi_users
      `).bind().first()
      communityCount = result?.user_count || 0
    } catch (err) {
      console.log('Community query failed:', err)
    }
    
    // Fetch Techniques count with fallback
    let techniquesCount = 0
    try {
      const result = await DB.prepare(`
        SELECT COUNT(*) as technique_count
        FROM content_products 
        WHERE type = 'technique' AND is_published = 1
      `).bind().first()
      techniquesCount = result?.technique_count || 0
    } catch (err) {
      console.log('Techniques query failed:', err)
    }
    
    // Calculate trends
    const analysesTrend = previousAnalyses > 0 
      ? `+${Math.round(((currentAnalyses - previousAnalyses) / previousAnalyses) * 100)}%`
      : '+0%'
    
    const stats = {
      aiAnalyses: currentAnalyses,
      videosReviewed: videosCount,
      community: communityCount,
      techniques: techniquesCount,
      aiAnalysesTrend: analysesTrend,
      videosReviewedTrend: '+0%',
      communityTrend: '+0%',
      techniquesTrend: '+0%'
    }

    return NextResponse.json(stats)
  } catch (error) {
    console.error('Stats API error:', error)
    // Return zeros on error rather than failing
    return NextResponse.json({
      aiAnalyses: 0,
      videosReviewed: 0,
      community: 0,
      techniques: 0,
      aiAnalysesTrend: '+0%',
      videosReviewedTrend: '+0%',
      communityTrend: '+0%',
      techniquesTrend: '+0%'
    })
  }
}

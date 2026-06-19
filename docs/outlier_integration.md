# Outlier Database Integration — Research & Plan

## What Is Outlier?

Outlier is an external data platform that can provide fight statistics, technique libraries, and training data for combat sports. This document outlines the research needed and the integration path to incorporate external data sources into Musashi's knowledge base.

## Research Questions (To Be Answered)

1. **Data Source Identification**
   - What specific Outlier database/API are we targeting?
   - Is it a fight statistics DB (like FightMetric/UFC Stats)?
   - Is it a technique library (instructional content)?
   - Is it a training data platform (video/motion capture data)?

2. **API Access**
   - What authentication method does the API use? (API key, OAuth, etc.)
   - What are the rate limits and pricing?
   - What data formats are returned? (JSON, CSV, XML)
   - Is there a sandbox/test environment?

3. **Data Schema**
   - What fields are available per record?
   - How does the data map to our existing `FightKnowledgeEntry` type?
   - What metadata is included? (discipline, difficulty, tags, etc.)

4. **Legal & Licensing**
   - What are the terms of use for the data?
   - Can we store and re-serve the data in our knowledge base?
   - Are there attribution requirements?

## Integration Architecture

Once the research is complete, the integration follows this path:

```
External API → /api/library/import → createDocument() → processIngestion()
                                          ↓                    ↓
                                    D1 Database          Vectorize (embeddings)
                                          ↓                    ↓
                                    getKnowledgeContext() ← searchKnowledge()
                                          ↓
                                    AI Coaching Prompts
```

### Step 1: Import Endpoint (Built)
`POST /api/library/import` accepts:
- `sourceUrl`: URL to fetch data from
- `format`: 'json' | 'csv'
- `mapping`: field mapping rules
- `tags`: additional tags to apply

### Step 2: Data Transformer
A transformer function converts external data into our `LibraryDocument` format:
```typescript
interface ImportMapping {
  titleField: string       // Which field → document title
  contentField: string     // Which field → document content
  tagsField?: string       // Which field → tags array
  disciplineField?: string // Which field → discipline
  difficultyField?: string // Which field → difficulty level
}
```

### Step 3: Ingestion Pipeline (Already Built)
Documents created via import go through the same pipeline:
1. `createDocument()` — stores in D1
2. `processIngestion()` — auto-triggered (Phase 1.3 wired this)
3. Chunks created + embeddings generated via Cloudflare AI
4. Vectors stored in Cloudflare Vectorize
5. Searchable via `searchKnowledge()` / `getKnowledgeContext()`

### Step 4: Continuous Sync (Future)
- Scheduled worker to poll external API for new data
- Deduplication by title + source hash
- Incremental updates (only new/changed records)

## Candidate External Data Sources

| Source | Type | Format | Notes |
|--------|------|--------|-------|
| UFC Stats / FightMetric | Fight statistics | Web scraping | Historical fight data, strike accuracy, takedown rates |
| Sherdog | Fighter records | Web scraping | Win/loss records, fight history |
| BJJ Heroes | Technique library | Web scraping | Grappling techniques, lineage |
| YouTube API | Instructional content | JSON API | Transcripts of technique breakdowns |
| Custom Outlier DB | TBD | TBD | Requires research on specific API |

## Next Steps

1. [ ] Identify the specific Outlier database the user wants to integrate
2. [ ] Get API access credentials and documentation
3. [ ] Build the `/api/library/import` endpoint
4. [ ] Create field mapping for the specific data source
5. [ ] Test with a small batch of records
6. [ ] Verify data appears in knowledge search results
7. [ ] Confirm AI coaching references the imported data

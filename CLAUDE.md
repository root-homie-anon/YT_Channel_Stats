# YT_Channel_Stats — Master Project File

## System Overview
Standalone niche analysis and market research tool for YouTube.
Validates niches, surfaces competitor intelligence, and produces profitability recommendations.
Built to eventually serve as the intelligence layer for YT_Channel_Auto.

## Session Start
1. Show past research sessions
2. Ask user: new research session or review existing?
3. For new session: collect niche input, kick off research pipeline
4. Pipeline runs API layer + Chrome extraction layer in sequence
5. Output: full niche validation report + dashboard entry

## Data Sources
- YouTube Data API — structured channel and video data
- Claude in Chrome — Social Blade, VidIQ, TubeBuddy, YouTube Studio, channel/video pages
- Additional third-party APIs as configured in `.env`

## Output
- Niche validation report (PDF + markdown)
- Dashboard entry with recommendation (profitable / not profitable)
- Stored session data for future reference and trend monitoring

## Integration (Future)
Will expose a topic discovery endpoint for YT_Channel_Auto to query.

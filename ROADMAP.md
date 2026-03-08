# YT_Channel_Stats — Project Roadmap

---

## Priority 1 — Project Scaffold & Infrastructure

Stand up the repo and connect all data sources before any research logic is built.

- Initialize repo with full folder structure
- Set up `.env` — YouTube Data API key, any third-party tool API keys
- Build config loader and validator
- Confirm YouTube Data API connection — channel search, video stats, metadata
- Set up Claude in Chrome integration — establish navigation and extraction patterns
- Set up VM backend server — will serve dashboard and orchestrate research sessions
- Define research session schema — inputs, outputs, storage format

---

## Priority 2 — YouTube Data API Layer

Pull everything YouTube's official API exposes and structure it for analysis.

- Channel search by niche/keyword — returns channel list with metadata
- Per-channel stats — subscriber count, total views, upload frequency, avg views per video
- Video-level data — view count, likes, comments, publish date, duration, format (long/short)
- Keyword and hashtag frequency analysis across top performing videos in niche
- Title pattern extraction — structure, length, keyword placement
- Niche saturation scoring — channel count, upload volume, engagement benchmarks

---

## Priority 3 — Claude in Chrome Extraction Layer

Use Claude in Chrome to capture data the API won't expose.

- Channel page extraction — estimated revenue indicators, membership status, community activity
- Video page extraction — retention curve signals, pinned comments, chapter structure
- YouTube Studio navigation — if logged in, pull real retention and revenue data for owned channels
- Social Blade integration — subscriber growth trends, estimated earnings range, channel rank
- VidIQ / TubeBuddy navigation — keyword scores, competition level, search volume indicators
- Store all extracted data in research session alongside API data

---

## Priority 4 — Niche Analysis Engine

Process raw data into actionable niche intelligence.

- Saturation classifier — under/balanced/oversaturated based on channel density and engagement ratios
- Success metrics benchmarking — what good looks like in this niche (views, subs, retention)
- Format analysis — is long or short performing better, what ratio are top channels using
- Trend direction — is the niche growing, plateauing, or declining based on publish frequency and view trajectory
- Related niche finder — surface adjacent niches worth validating
- Profitable/not profitable recommendation engine — weighted scoring across all signals

---

## Priority 5 — Report Output

Generate a clean, readable niche validation report from research session data.

- Structured report template — niche overview, saturation level, competitor snapshot, success metrics, format breakdown, trend direction, related niches, final recommendation
- Export as PDF and/or markdown
- Store report in session history for future reference
- Summary view for quick read, full detail view for deep dive

---

## Priority 6 — Research Dashboard on VM

Persistent dashboard for managing and reviewing niche research sessions.

- Node/Express server on VM (can share infra with YT_Channel_Auto dashboard)
- Session list — all past research runs with niche, date, recommendation
- Launch new research session — input niche, kick off pipeline
- Session detail view — full report inline
- Status indicator — research in progress / complete
- Basic auth

---

## Priority 7 — Hardening & Accuracy Tuning

Validate outputs and improve recommendation reliability.

- Cross-validate API data against Chrome-extracted data for consistency
- Tune saturation and profitability scoring weights based on real results
- Edge case handling — very new niches, niches with no YouTube presence, ambiguous keywords
- Rate limiting and retry logic for all data sources
- Documentation — setup guide, how to interpret reports, data source reference

---

## Priority 8 — YT_Channel_Stats ↔ YT_Channel_Auto Integration

Connect the two systems so automation can query stats intelligence directly.

- Define shared API contract — what stats exposes, what auto consumes
- Topic discovery endpoint — given a channel niche, return high-potential topics based on current trends
- Trend monitoring — periodic re-runs on active niches, flag when conditions change
- Auto pipeline trigger — automation calls stats, validates topic, proceeds to production if approved
- Telegram notification when new high-potential topics are detected for a channel's niche

---

*This system is designed from the start to eventually serve as the intelligence layer for YT_Channel_Auto.*

# Niche Topic Target — Feature Spec

> Future phase. Lives in `YT_Channel_Stats` as a standalone monitoring system.
> Does not modify `youtube-automation`. Feeds its production queue only.

---

## Purpose

Monitor top-performing channels in each active niche. When a watched channel posts a new video, evaluate it as a potential topic signal. If it passes the trigger threshold, inject it into the `youtube-automation` production queue. Their post is the idea — our pipeline handles everything else.

This keeps the channel competitive on trending topics without manual discovery. Posting strategy and scheduling remain unchanged inside `youtube-automation`.

---

## How It Works

1. **Channel Watchlist** — `youtube-niche-researcher` identifies top channels per niche and writes them to a watchlist stored in `YT_Channel_Stats`
2. **Monitoring** — `YT_Channel_Stats` polls watched channels via YouTube RSS feeds or the YouTube Data API for new uploads
3. **Signal Evaluation** — new video is scored against trigger criteria before any action is taken
4. **Queue Injection** — videos that pass the threshold are added to the `youtube-automation` production queue as a topic seed (title + description + transcript excerpt)
5. **Pipeline Runs Normally** — `youtube-automation` picks up the queued topic and runs its standard production flow; posting schedule is not affected

---

## Trigger Criteria (TBD — to be refined at implementation)

Not every new video from a watched channel should trigger production. Possible signals:

- Early view velocity — views per hour in first window exceeds channel baseline
- Comment spike relative to channel average
- Topic relevance score against the active channel's niche
- Manual override — force-queue a specific video regardless of score

---

## Data Flow

```
youtube-niche-researcher
  → identifies top niche channels
  → writes channel IDs to YT_Channel_Stats watchlist

YT_Channel_Stats (monitoring loop)
  → polls watched channels for new uploads
  → scores each new video against trigger criteria
  → on pass: extracts title + description + transcript
  → injects topic seed into youtube-automation queue

youtube-automation
  → receives queued topic like any other
  → runs standard pipeline
  → posts on existing schedule
```

---

## What Gets Passed to the Queue

- Video title
- Channel name + niche tag
- Description (first 500 chars)
- Auto-caption transcript excerpt (if available via YouTube Data API)
- Source video URL (for reference only — not used in production)

---

## What This Is Not

- Not a copy or clone operation
- Not a post-when-they-post system
- Not a scraper — uses official YouTube Data API and RSS feeds only
- Does not alter posting schedule or channel strategy

---

## Dependencies

- `YT_Channel_Stats` — host system for this feature
- `youtube-niche-researcher` — supplies the initial channel watchlist
- YouTube Data API — upload monitoring + transcript access
- YouTube RSS feeds — lightweight polling alternative
- `youtube-automation` production queue — receives injected topics

---

## Status

⬜ Not started — future phase

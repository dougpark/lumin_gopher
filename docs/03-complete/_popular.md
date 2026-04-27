# read the daily pinboard popular page 
- Write a script to scrape the popular page of pinboard daily
- Extract the title, url, and description for each popular item
- Save the extracted data in a structured format (e.g., JSON or CSV) for further processing

## Pinboard URL
- https://pinboard.in/popular

## Pinboard html example

```html
<div class="bookmark" id="c96b870ed2bb5ba891c4b860740f56eccf9edf51">        <div class="display">
       <a class="bookmark_title has_bmark" href="https://www.theverge.com/podcast/917029/software-brain-ai-backlash-databases-automation">BEWARE SOFTWARE BRAIN | The Verge</a> &nbsp;<a href="/url:c96b870ed2bb5ba891c4b860740f56eccf9edf51" class="bookmark_count">20</a><br><a class="url_display" href="https://www.theverge.com/podcast/917029/software-brain-ai-backlash-databases-automation">https://www.theverge.com/podcast/917029/software-brain-ai-backlash-databases-automation</a>
</div> </div>
```

## V1 - write a json file with the extracted data, including fields for title, url, description, and published date
- complete

## v2 - feed new bookmarks into Lumin api as rss posts.

- look in .env LUMIN_RSS_INGEST_TOKEN for rss token
- look in .env LUMIN_API_URL for base url
- RSS ingest endpoint:
- POST /v1/rss/posts — requires a token with rss:ingest scope
- max batch size is 50 items per batch, so if there are more than 50 items, we need to split them into multiple batches and send multiple requests

payload: 
```json
{
  "source": "https://pinboard.in/popular",
  "scraped_at": "2026-04-27T22:16:45.807Z",
  "items": [
    {
      "url": "https://example.com/article",
      "title": "Article title here",
      "summary": "Optional description",
      "published_at": "2026-04-27T18:00:00Z",
      "guid": "optional-unique-id"
    }
  ]
}
```

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

## V1 - write a json file with the extracted data, including fields for title, url, description, and published date

## v2 - enrich the extracted data with AI-generated tags and summaries using a local Ollama model, and save the enriched data in a structured format for further processing.

## v3 - feed new bookmarks into Lumin as bookmarks with the #pinboard tag, including the enriched AI-generated tags and summaries.
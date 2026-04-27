# Retreive Full Text from URL
- use the URL field to fetch the full text of the document, if available.
- this can be done using a web scraping library or an API that provides full text extraction.
- save the full text in a new field called `full_text` in the Lumin database
- this full text can then be used for further AI enrichment, such as generating a synthesis or extracting additional tags and metadata.

## What are best libraries 
- headless browsers like Puppeteer or Playwright for dynamic content
- readability libraries like Readability.js for extracting main content from web pages
- APIs like Diffbot or Mercury Web Parser for structured data extraction from URLs

## Workflow Considerations
- need to decide when to trigger the full text retrieval process. This could be done immediately after
- need a plan to either make this part of the exising ai_enrichment step or create a new step in the workflow specifically for fetching full text from URLs
- consider the performance implications of fetching full text, especially if there are many entries with URLs, and implement caching or rate limiting as needed to avoid overloading the system or violating terms of service of target websites.

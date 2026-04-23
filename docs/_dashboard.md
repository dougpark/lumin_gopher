# save enough data to show a status dashboard

### each api call should save the following to a local SQLite database:
- timestamp
- type (file_drop, rss_enrichment, etc.)
- status (success, error, etc.)
- details (JSON blob for any extra info, like error messages or generated tags)


### create a new dashbord route at `/` and client 
dashboard.html that shows a live-updating status dashboard based on this data. Use Tailwind for styling and make it look nice!

### goal is to show a timeseries graph showing the last 48 hours of activity, with filters for type and status. This will help you monitor the health of the Gopher and quickly identify any issues with AI processing or file drops.

### be able to see counts
- total items processed, by hour, day, week
- success vs error rates
- recent error messages for debugging
# define new email status page
This page will show the status of the email processing system, including:
- Recent email processing activity 
- most recent processing date/time
- most recent number of emails processed
- total emails processed to date

# new page 
- based on existing /src/client/dashboard.html
- name it /src/client/email.html
- add a new route in index.ts to serve email.html at /email
- add a new route in index.ts to serve email stats at /email/stats (JSON endpoint)

# database access
- a named docker volume: gopher-email-data:/app/emaildata # External named volume for email data
- sqlite db path: /app/emaildata/db.sqlite
- table: email_archive_items
- create a new worker /src/workers/emailStats.ts to handle database access and stats calculation
- define functions to get recent activity, last processing time, email counts, etc.
- use these functions in the /email/stats route to return JSON stats


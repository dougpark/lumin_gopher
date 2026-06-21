# email viewer

# New Page: Email Viewer
- emailviewer.html
- route: /email/viewer
- purpose: to display a list of archived emails with details and options to view individual emails
# Database Access
- use the same sqlite db at /app/emaildata/db.sqlite
- table: email_archive_items
- create a new worker /src/workers/emailViewer.ts to handle database access for the email viewer
- define functions to get a list of archived emails, get details for a specific email, etc.
- use these functions in the /email/viewer route to return JSON data for the frontend
# Frontend
- create a new emailviewer.html page based on the existing dashboard.html template
- add a new section to display a list of archived emails with columns for subject, sender, date, and a link to view details
- add a new section to display the details of a selected email, including the full email content and metadata
- use JavaScript to fetch the list of archived emails from the /email/viewer endpoint and display them in a table
- pick a js library for rendering the archived .eml files in the email details section (e.g., eml-parser or mailparser)
- add event listeners to the email list to fetch and display details when an email is clicked
- provide a search and filter functionality to allow users to easily find specific emails based on criteria like sender, subject, or date
# Design
- maintain the clean and minimalist design of the dashboard
- use a dedicated section for the email viewer with a soft background color to differentiate it from other sections
- use simple icons and clear typography to enhance readability and navigation within the email viewer   

# read from a Lumin API for bookmarks tagged

- Get a list of all bookmarks tagged with "blog" using the Lumin API.
- For each bookmark, extract the URL and title, and body content if available.
- Use the extracted information to generate a markdown file for each bookmark, formatted as follows:
- Pelican Front Matter:
```markdown---
title: "Bookmark Title"
date: 2024-06-01
slug: "bookmark-title"
tags: ["blog", "other_tags"]
---
```
- Body Content:
```markdown
Bookmark description or notes go here. If the bookmark has a body content, include it here.
```
- Save each markdown file in a specified directory (e.g., `./bookmarks/`) with a filename derived from the bookmark title (e.g., `bookmark-title.md`) and current date for uniqueness (e.g., `bookmark-title-2024-06-01.md`).
- Implement error handling to manage cases where the bookmark data is incomplete (e.g., missing title or URL) or if the API request fails. Log any errors encountered during the process for debugging purposes.
- create a new table to track new bookmarks that have been processed and avoid duplicates in the future. This table should store the bookmark ID, title, URL, and the date it was processed. Before generating a markdown file for a bookmark, check this table to see if it has already been processed. If it has, skip it; if not, proceed with the markdown generation and then add an entry to the table once it's done.
- also, create a review list to show the last n bookmarks for editing before they are published to the blog. This review list can be a simple HTML page that lists the bookmarks with their titles and inline details to edit the corresponding markdown file. This allows for a final review step before the content goes live on the blog.
- also be able to create a new markdown file that is manually created and then have the option to publish it to the blog by adding a specific tag (e.g., "publish") that the script will look for. When the script detects a markdown file with the "publish" tag, it will move it to the appropriate directory for the blog and update the front matter to reflect its published status. This allows for a manual creation and review process while still leveraging the automation for publishing.

- trigger the github action to deploy the blog after new markdown files are added to the blog directory. This can be done by making a commit to the repository with the new markdown files, which will then trigger the GitHub Actions workflow to build and deploy the blog. Ensure that the commit message is clear and indicates that new content has been added for deployment. Additionally, implement error handling to manage any issues that may arise during the commit or deployment process, and log these errors for debugging purposes.

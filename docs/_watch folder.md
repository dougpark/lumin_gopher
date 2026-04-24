# Watch Folder for Lumin
- use the existing prototype code in this repo to create a file watcher that detects new files in a specified folder (e.g., "watch_folder")
- when a new file is detected, read its contents and metadata (e.g., filename, creation date)
- determine the type of data (e.g., journal entry, email, calendar event, weather data) based on the file format or naming convention
- convert the data into a format that can be imported into the Lumin database using the API
- log the import event with relevant metadata (e.g., filename, data type, import status) for monitoring and debugging purposes
- implement error handling to catch and log any issues that arise during the file reading, data conversion, or API import processes
- ensure that the file watcher runs continuously in the background and can handle multiple files being added in quick succession without crashing or missing any files

## Multimedia Handling
- photo/image files: extract metadata (e.g., creation date, location) and generate tags using the Ollama model; host the images separately and include links in the Lumin entries
- audio files: extract metadata (e.g., creation date, duration) and generate tags using the Ollama model; host the audio files separately and include links in the Lumin entries
- video files: extract metadata (e.g., creation date, duration) and generate tags using the Ollama model; host the video files separately and include links in the Lumin entries

## Archive watched files after processing
- move processed files to an "archive" folder to prevent reprocessing and keep the watch folder organized
- log the archival event with relevant metadata (e.g., filename, archive date) for monitoring and debugging purposes
- link the archived file in the Lumin entry for reference, allowing users to access the original file if needed

## Provide a browser based file browser interface 
- to view the contents of the watch folder and the archive folder, allowing users to see what files have been processed and what files are currently being watched.


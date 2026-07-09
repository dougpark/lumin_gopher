# email viewer delete

provide a way for users to delete archived emails from the email viewer interface
- add a delete button/icon to each email item in the list. it should appear on hover to keep the interface clean, and use a trash can icon for clarity.
- when clicked, show a confirmation dialog to prevent accidental deletions
- if confirmed, send a request to a new endpoint (e.g., /email/viewer/delete) with the email ID to be deleted
- in the backend, create a new route to handle the delete request, validate the email ID, and remove the corresponding entry from the email_archive_items table in the database
- after deletion, return a success response and update the frontend to remove the deleted email from the list without requiring a full page refresh
- ensure proper error handling and user feedback for cases where the email ID is invalid or the deletion fails for some reason.

# keep the current read only db for normal access, but allow deletions by creating a separate writable connection for the delete operation.

example of opening a writable connection for deletion:

function openReadWriteEmailDb(): Database {
    // Open in read-write mode
    const db = new Database(EMAIL_DB_PATH, { readonly: false });
    
    // Crucial: Set WAL mode immediately upon opening for writing
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA busy_timeout = 5000;");
    
    return db;
}

# remove the actual .eml files from the filesystem when an email is deleted, in addition to removing the database entry. 

example of using a transaction to ensure both the database entry and the file are deleted atomically:

const db = openReadWriteEmailDb();
try {
    db.transaction(() => {
        // 1. Get the file path from the DB
        const record = db.query("SELECT file_path FROM emails WHERE id = ?").get(id);
        
        // 2. Delete the record
        db.query("DELETE FROM emails WHERE id = ?").run(id);
        
        // 3. Delete the actual file from disk
        // (You can use Bun.file(record.file_path).delete() here)
    })();
} catch (e) {
    console.error("Delete failed, transaction rolled back:", e);
} finally {
    db.close(); // Cleanly close the write connection
}
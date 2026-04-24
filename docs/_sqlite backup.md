# create a perfect, un-locked copy for the Synology to grab

This is the ultimate "System Stability" move. Since you have 20 years of Linux experience, you know that a "clever" script is only good if it's "boring" and "reliable."
By creating a script that finds every .sqlite file and creates a safe .backup clone, you are effectively creating a Local Snapshot Engine. Synology Drive will then see these "static" clones and beam them to your DS920+ without any risk of "tearing" the data.
The "Production" Bash Script
Here is a robust script designed for your environment. It handles subdirectories (for all your Bun projects) and ensures the backups are named clearly.
#!/bin/bash

# --- CONFIGURATION ---
# The root folder where all your Bun projects live
SOURCE_DIR="$HOME/Production"

# Where you want the safe snapshots to land (inside your Synology Sync folder)
BACKUP_ROOT="$HOME/SynologyDrive/DatabaseSnaps"

# Create the backup root if it doesn't exist
mkdir -p "$BACKUP_ROOT"

echo "[$(date)] Starting SQLite snapshot for $SOURCE_DIR..."

# --- THE SCAN ---
# Find all .sqlite files, excluding node_modules to save time
find "$SOURCE_DIR" -name "*.sqlite" -not -path "*/node_modules/*" | while read -r DB_PATH; do
    
    # Create a unique filename by replacing slashes with underscores
    # Example: /home/doug/Production/Lumin/master.sqlite -> Lumin_master.sqlite
    REL_PATH=${DB_PATH#$SOURCE_DIR/}
    SAFE_NAME=$(echo "$REL_PATH" | tr '/' '_')
    DEST_PATH="$BACKUP_ROOT/$SAFE_NAME"

    # --- THE ATOMIC BACKUP ---
    # This is the "Big Tech" way to do it. It uses the SQLite Online Backup API.
    sqlite3 "$DB_PATH" ".backup '$DEST_PATH'"

    if [ $? -eq 0 ]; then
        echo "  ✓ Snapshotted: $REL_PATH"
    else
        echo "  ✗ FAILED: $REL_PATH"
    fi
done

echo "[$(date)] All snapshots synced to SynologyDrive."

Why this works for the Archivist:
1. Safety First: It uses sqlite3 ".backup '...'" which is the only way to guarantee a consistent file while the Lumin Gopher is writing to it.
2. Flat Hierarchy: By converting the path to a filename (Lumin_master.sqlite), you avoid deep, messy directory structures in your backup folder. It makes it easier to find a specific database on your NAS.
3. Efficiency: It skips node_modules, so it won't get bogged down in your Bun dependency folders.
4. Synology Friendly: Synology Drive will see these as "new" or "updated" files and instantly push them to your DS920+.
Implementation Steps:
1. Save it: Save this as ~/scripts/snap_dbs.sh.
2. Make it executable: chmod +x ~/scripts/snap_dbs.sh.
3. Cron it: Add it to your crontab so it runs while you're sleeping (or just before your daily Gopher forage). # Run every night at 3:00 AM 0 3 * * * /home/doug/scripts/snap_dbs.sh >> /home/doug/logs/db_backup.log 2>&1

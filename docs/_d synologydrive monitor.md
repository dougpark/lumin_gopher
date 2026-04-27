# Add Synology Drive Client to Dashboard
- check if running: `ps aux | grep synology-drive`
- add a new section to the dashboard that shows "Synology Drive Status: Running / Not Running"
- if running, show the last sync time (can be obtained from the synology-drive log file, usually located at `~/.config/synology-drive/logs/drive.log`
- if not running, show a warning message and a button to start the service (which would run `systemctl --user start synology-drive` via an API endpoint)

## Backup Exceptions
# This creates a perfect, un-locked copy for the Synology to grab
sqlite3 ~/lumin-gopher/lumin.sqlite ".backup '~/SynologyDrive/backups/lumin_vault_daily.sqlite.backup'"
- where to put this process so i can add all my .sqlite files in the future without worrying about locking issues? maybe a cron job that runs every night and creates backup copies of all .sqlite files in the data directory, with a timestamp in the filename for versioning (e.g., lumin_vault_2024-06-01.sqlite.backup)
- maybe a bash script that scans the Production folder for all .sqlite files and creates backup copies in the SynologyDrive folder, which can be run manually or scheduled with cron
- exclude *.sqlite from synology drive backup
- must create a separate backup copy of the database for the Synology to sync, since the live database is locked by the Gopher and can't be read by another process, must rename the copy extension so backup will pick it up (e.g., lumin_vault_daily.sqlite.backup)

This is a classic hurdle for headless Linux servers. Synology Drive was designed as a "desktop first" tool, so its background engine (the cloud-drive-ui daemon) is technically tied to a user session. Since your box is in a closet, you don't want to be forced to sit there with a monitor just to keep the backups running.
Here is the "Production" way to keep it running 24/7 without a physical login.
1. The "Persistent Session" Fix (Lingering)
By default, Ubuntu kills user processes the moment you log out of SSH. You need to tell Ubuntu to let your user "Linger" even when no one is logged in. This keeps the background services alive.
Run this once:
sudo loginctl enable-linger doug

Replace doug with your actual Linux username.
2. The "Remote Configuration" Hack (X11 Forwarding)
Since the setup wizard is a GUI, you can "borrow" the screen from your MacBook to finish the configuration without ever opening that closet door.
1. On your Mac: Download and install XQuartz.
2. SSH with X11: Open a terminal on your Mac and SSH into the box with the -X flag: ssh -X doug@your-linux-ip
3. Launch the UI: Run the command to start the Drive client: synology-drive
4. The Magic: The Synology window will pop up on your MacBook screen, but it is actually running on the Linux box. Finish the "Start Now" wizard and map your folders.
3. Autostart via systemd (The "Forever" Plan)
Once configured, you want the sync engine to start automatically every time the box boots up, even if you haven't SSH'd in yet.
Create a user-level service:
1. Create the directory: mkdir -p ~/.config/systemd/user/
2. Create the service file: nano ~/.config/systemd/user/synology-drive.service
3. Paste this in:
[Unit]
Description=Synology Drive Client
After=network.target

[Service]
Type=simple
# This is the path to the background daemon
ExecStart=/usr/bin/synology-drive --no-sandbox
Restart=always
RestartSec=10

[Install]
WantedBy=default.target

1. Enable and Start it:
systemctl --user daemon-reload
systemctl --user enable synology-drive
systemctl --user start synology-drive

4. How to Verify while you're in Japan
Since you won't be near the closet, you can check if the Gopher's data is actually syncing by running this via SSH:
# Check if the process is alive
ps aux | grep synology-drive

# Check the systemd log
journalctl --user -u synology-drive -f

The "IT Pro" Result
With Linger enabled and a systemd service, your Linux box is now a true "Production Server." You can reboot it remotely, and it will automatically reconnect to the DS920+ and resume syncing your Master Index and project code without any human intervention.
Does that take the pressure off of having to "stay logged in" to the closet box?
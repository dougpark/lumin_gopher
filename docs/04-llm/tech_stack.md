
# Project Manifest: Development and Production Environment

### Docker
- development and production environment
- always look for docker specific requirements Ex. file system access, port mapping
- Docker GPU Support: Ensure the nvidia-container-toolkit is installed on the host. Use runtime: nvidia in docker-compose.yml for any service requiring direct VRAM access.

### Bun.js
- Use Bun.js as the runtime and package manager. All scripts should be run with bun commands (e.g., bun install, bun run). Avoid npm or yarn.
- Bun's built-in file watcher (bun run --watch) should be used for development to enable hot-reloading of the Gopher worker.

### .env and Configuration
- Use a .env file for all configuration variables. Access these via process.env in the codebase. This allows for easy overrides in different environments (development, staging, production) without changing code.
- Ensure that sensitive information (like API tokens) is not hardcoded and is only accessed through environment variables.

### Networking
- Networking: Use extra_hosts: ["host.docker.internal:host-gateway"] in docker-compose.yml. This allows the Bun runtime inside Docker to communicate with services running on the Ubuntu host (like Ollama) using a consistent internal URL.

### Performance
- Linux Kernel Tuning: Increase fs.inotify.max_user_watches on the host to handle recursive watching of large archival directories.

- Storage Drivers: For the SQLite database, use Bind Mounts for the .sqlite file rather than Docker Volumes to ensure maximum performance and easier "Archivist" backups from the host level.

### Logging and Healthcheck
- Healthchecks: Implement the Bun.serve health endpoint in docker-compose.yml.

- Logging: Use JSON logging format for the Gopher. This makes it easier for you to eventually feed your own Gopher logs back into the Lumin index (meta-archiving!).

### Core Tech Stack
• Runtime & Package Manager: Bun.js (Use bun commands for installing, testing, and running).
- Hono for the web server and API routes.
- SQLite for the database (use Bun's built-in SQLite support).
• Styling: Tailwind CSS. Utilize the custom tailwind.config.js (Gemini-Modern aesthetic) provided previously.

### Architectural Standards
• Module System: ES Modules (ESM) only. Use import/export syntax. No require.
• Organization: Keep logic modular. Separate concerns into: 
• /src/index.ts (Worker entry point) 
• /src/db/ (Database schemas and migrations) 
• /src/components/ (UI components) 
• /src/utils/ (Helper functions)
• Environment Variables: Access via the env object.

### UI Design Rules (Gemini-Modern)
Refer to these tokens for all generated frontend code:
• Primary Accent: #4285F4 (bg-gemini-blue)
• Background: #FFFFFF (bg-gemini-surface)
• Rounding: Full pills for buttons (rounded-full), 24px for cards (rounded-gemini-lg).
• Typography: Center-aligned hero content, Inter/Roboto font, high whitespace density.

### Developer Instructions for AI
When generating code for this project:

1. Write for Bun: Use Bun-specific APIs where applicable (e.g., Bun.password or high-performance fetch).

3. Tailwind-First: Do not write custom CSS files. Use utility classes.

4. SQLite

5. Concise Modules: Keep files small and focused. Export individual functions rather than large monolithic objects.




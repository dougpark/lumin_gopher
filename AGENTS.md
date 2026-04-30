# Lumin-Gopher System
- a locally run lumin service/daemon
- connects to external interfaces such as Pinboard, Feedbin, Jina, and a local Ollama instance
- connects to the Lumin API
- schedules jobs/tasks to run at specific times or intervals
- provides an admin page to UI
- Hardware: Ubuntu Linux Box, 32GB RAM, Nvidia 5060TI 16GB VRAM
- Runs local Ollama models
- Running inside a Docker container
- Uses bun.js (no Node.js) for the backend
- use Tailwind CSS for styling
- plain HTML/JS for the frontend
- Uses SQLite for local data storage
- Uses GitHub for version control and collaboration

## VS Code
- running locally on Macbook
- uses remote development extension to connect to the Ubuntu Linux Box

## Entry Point
- /src/index.ts


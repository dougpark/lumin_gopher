# System Metrics to Capture
- capture other linux level metrics like CPU, RAM, and disk usage. This can be useful for monitoring the health of the Gopher worker and identifying potential performance bottlenecks.

- Gopher is running inside a Docker container, so you can use tools like "docker stats" to monitor resource usage in real-time. Additionally, you can implement a lightweight metrics collection system within the Gopher worker itself to log these metrics at regular intervals.

## Disk Usage
- collect usage, usage %, available, and total for both the root disk (/) and the archival disk (/mnt/world). This can help you understand how much storage space is being consumed by the Gopher's operations and whether you need to consider expanding storage or cleaning up old files.
- Disk — / root
- Disk — /mnt/world

## System Resource Usage
- CPU Usage
- RAM Usage

- use a lightweight library like "systeminformation" to capture these metrics without adding significant overhead to the Gopher worker.

# Nvidia GPU Metrics
- capture Nvidia GPU metrics like VRAM usage and GPU load. This is especially important if you are using a local GPU for AI processing, as it can help you understand how your AI workloads are impacting GPU resources.

- use the "nvidia-smi" command-line tool to capture GPU metrics. You can execute this command from within your Bun.js code and parse the output to extract relevant information.

## NVIDIA GPU

Utilization 0%
Temperature 34°C
Memory Used 288 MiB
Power Draw 3.96W
Fan Speed 0%


# Ollama Model Performance
- capture Ollama model, track which models are being used for which files, and log any errors that occur during AI processing. This can help you identify if certain models are struggling with specific types of files or if there are any recurring issues that need to be addressed.

- MODEL	SIZE	PROCESSOR (GPU/CPU)    VRAM USAGE	ERRORS

- is there a trigger to know when a model is loaded? or do we have to poll the Ollama API at regular intervals to check which models are currently loaded and their status? If polling is necessary, you can set up a regular interval (e.g., every 1 minute) to query the Ollama API for model status and log this information when it changes.

# Frequency of Metrics Capture
- frequency of metrics capture: Every 5 minutes, or after every 10 files processed, whichever comes first. This ensures you have regular insights into the system's performance without overwhelming your logging with too much data.
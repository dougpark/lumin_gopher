# Start with the Bun base image
FROM oven/bun:latest

# Switch to root to install system packages
USER root

# Update the package list and install curl
# We clean up the cache (rm -rf) to keep the image small
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory inside the container
WORKDIR /app

# Switch back to the bun user for security
USER bun

# The command is usually handled by your docker-compose, 
# but we can set a default here
CMD ["bun", "run", "src/index.ts"]
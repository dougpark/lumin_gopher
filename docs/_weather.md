# Import weather data into Lumin
- Does Ubuntu have a weather client that can read from a weather API?
- Write a procedure to fetch weather data from a public API and convert it to a format that can be imported into the Lumin database
- Write a script to automate the import process on a regular interval (e.g., every hour)
- For zip code: 76109, Fort Worth, TX, USA, use the Open-Meteo API to fetch current weather data and historical data for the past 7 days

## AI Enrichment for Weather Data
- Extract relevant weather metadata (temperature, conditions, humidity, wind speed) from the API response
- Use a local Ollama model to generate tags (e.g., "sunny", "rainy", "hot", "cold") and a brief summary for each weather data point
- Format the enriched data according to Lumin's API requirements for seamless integration, allowing for a weather timeline


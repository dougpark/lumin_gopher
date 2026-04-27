# AI Synthesis
- use local Ollama to parse full_text and generate a one to two paragraph synthesis focusing on industrial impact.
- part of ai_enrichment step in the workflow, after ai_tags and ai_summary.
- if full_text is available
- save the synthesis in a new field called ai_synthesis, and the timestamp in ai_synthesis_at
- limit full_text to 10,000 characters for the synthesis step to keep costs down and ensure a quick response time.

## Prompt
The "Lumin" Digest: Since you're using an LLM to auto-tag and file your documents, you could prompt it to "generate a one-paragraph synthesis focusing on industrial impact" for every entry.
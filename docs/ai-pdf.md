# special considerations for processing pdf documents
# many pdf documents contain complex layouts, images, and embedded fonts that can make text extraction challenging. When processing PDFs with AI, it is important to consider these factors to ensure accurate data extraction and analysis.

# workflow
[Incoming PDF] 
      │
      ▼
[Gopher Triage] ───► Run pdftoppm (Convert to PNGs)
      │
      ▼
[Gemma 4 Vision] ──► Generate Summary & Tags
      │
      ▼
[Immediate Cleanup] ► Erase local PDF & temp PNGs

# prompt
- The prompt should ask for 3 things: 5 tags, a 5 sentence summary, and the full OCR text for each page image.
- Summarize the content of the PDF, including key points, tags, and any relevant metadata extracted from the text and images. make 5 tags and a 5 sentence summary.
- also, for each page image generated from the PDF, provide the following instruction to the AI: "Act as an advanced OCR engine. Transcribe every word visible in this document image verbatim. Do not summarize, do not correct spelling, and do not omit text."

# post processing
- Append the full text ocr output to the final json ai_summary before return the patch to the api

# Extablish an image processing workflow
- support other image file types
- implement OCR for all supported image file types
- ensure that OCR output is correctly appended to the JSON ai_summary for all image types
- ensure 5 tags and 5 sentence summary are generated for all image types
- ensure that the workflow can handle multiple images per PDF and correctly associate OCR output with the corresponding page in the JSON ai_summary
- ensure that any errors encountered during OCR or image processing are properly logged and handled to prevent workflow interruptions
- error msg should include details about the type of error, the file or page that caused it, and any relevant context to help diagnose and resolve the issue, and be included in the ai_summary for review. 
- Ex. [Error] Unable to process page 3 of file example.pdf due to unreadable text.




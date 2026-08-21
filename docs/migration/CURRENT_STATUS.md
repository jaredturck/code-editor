# Current IRIS Integration Status

Completed integration milestones:

- AI Settings and provider configuration
- Core Agent Chat runtime
- Durable planning and autonomous project runs
- Editor-aware workspace filesystem tools
- Brokered terminal/build/test/diagnostics tools
- Exact code search
- Semantic file search and indexing
- Document, PDF and archive intelligence

The Code Editor now uses the migrated IRIS semantic filesystem index from the existing Search activity, including bounded document/PDF/archive retrieval. Indexed Office/OpenDocument/PDF/ZIP results can be inspected as extracted text without unpacking archives to disk; PDF page counts and generic ZIP archive-entry provenance are surfaced when available. Semantic rescans remain driven by workspace changes and index/model lifecycle remains managed in AI Settings.

## Next milestone

**Image and Video Semantic Indexing**

- CLIP image embeddings
- image/video semantic search
- media worker queues and persistence

Semantic concepts, RAG, multi-agent delegation, vision controls, automation, and broader system authority remain later milestones.

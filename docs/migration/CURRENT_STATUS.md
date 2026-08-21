# Current IRIS Integration Status

Completed integration milestones:

- AI Settings and provider configuration
- Core Agent Chat runtime
- Durable planning and autonomous project runs
- Editor-aware workspace filesystem tools
- Brokered terminal/build/test/diagnostics tools
- Exact code search
- Semantic file search and indexing

The Code Editor now uses the migrated IRIS semantic filesystem index directly from the existing Search activity. Semantic text searches are filtered to the open workspace, indexed summaries and scores are surfaced without importing the old IRIS Search UI, and results can pivot into the existing similar-file lookup. The workspace refresh pipeline schedules debounced incremental IRIS rescans whenever the semantic index is ready, while model installation and full index lifecycle controls remain in AI Settings.

## Next milestone

**Document, PDF and Archive Intelligence**

- document/PDF extraction and indexing
- archive inspection
- indexed document retrieval

Image/video semantic search, concepts, RAG, multi-agent delegation, vision, automation, and broader system authority remain later milestones.

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
- Image and video semantic indexing
- Semantic concepts

The Code Editor now uses the migrated IRIS semantic filesystem index from the existing Search activity for text, documents, images, videos and concept-driven discovery. The Concepts mode searches the persistent MiniLM and CLIP concept centroids, resolves their stored memberships, filters member files to the open workspace, and preserves document/media handling already connected by the previous milestones. IRIS's existing clustering workers, centroid generation and encrypted membership persistence remain the implementation source.

## Next milestone

**RAG and Project Context Engine**

- semantic candidate retrieval
- live-file evidence reads
- context assembly and ranking

Memory/context compaction, persistence infrastructure, multi-agent work, additional IRIS capabilities and final validation remain later milestones.

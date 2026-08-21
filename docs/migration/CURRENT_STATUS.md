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

The Code Editor now uses the migrated IRIS semantic filesystem index from the existing Search activity for text, documents, images and videos. The new Media mode searches the persisted CLIP image/video space, keeps results scoped to the open workspace, surfaces video-frame timestamps, and opens media with the operating system rather than treating binary files as editor text. IRIS's existing image preparation queue/worker pools, video frame extraction and encrypted semantic persistence remain the implementation source; workspace rescans and model/index lifecycle remain managed through the existing semantic-index controls.

## Next milestone

**Semantic Concepts**

- concept clustering, centroids and membership
- concept-driven file discovery

RAG, memory/context compaction, persistence infrastructure, multi-agent work, additional IRIS capabilities and final validation remain later milestones.

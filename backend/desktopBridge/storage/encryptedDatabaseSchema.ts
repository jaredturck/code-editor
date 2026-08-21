/**
 * Defines the encrypted SQLite schema and compatibility migrations. Keeping schema ownership
 * separate from repository operations reduces merge conflicts without changing initialization order.
 */

export const ENCRYPTED_DATABASE_SCHEMA_SQL = `
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA temp_store = MEMORY;
      PRAGMA trusted_schema = OFF;
      PRAGMA secure_delete = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA wal_autocheckpoint = 1000;

      CREATE TABLE IF NOT EXISTS storage_keys (
        id TEXT PRIMARY KEY,
        wrapped_key BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        version INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS encrypted_store (
        key TEXT PRIMARY KEY,
        ciphertext BLOB NOT NULL,
        nonce BLOB NOT NULL CHECK(length(nonce) = 12),
        tag BLOB NOT NULL CHECK(length(tag) = 16),
        cipher_version INTEGER NOT NULL,
        key_version INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        display_ciphertext BLOB NOT NULL,
        display_nonce BLOB NOT NULL CHECK(length(display_nonce) = 12),
        display_tag BLOB NOT NULL CHECK(length(display_tag) = 16),
        cipher_version INTEGER NOT NULL,
        key_version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0 CHECK(message_count >= 0)
      );
      CREATE INDEX IF NOT EXISTS chats_updated_at_index ON chats(updated_at DESC);

      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        payload_ciphertext BLOB NOT NULL,
        payload_nonce BLOB NOT NULL CHECK(length(payload_nonce) = 12),
        payload_tag BLOB NOT NULL CHECK(length(payload_tag) = 16),
        cipher_version INTEGER NOT NULL,
        key_version INTEGER NOT NULL,
        FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
        UNIQUE(chat_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS chat_messages_chat_sequence_index
        ON chat_messages(chat_id, sequence);

      CREATE TABLE IF NOT EXISTS chat_state (
        chat_id TEXT PRIMARY KEY,
        payload_ciphertext BLOB NOT NULL,
        payload_nonce BLOB NOT NULL CHECK(length(payload_nonce) = 12),
        payload_tag BLOB NOT NULL CHECK(length(payload_tag) = 16),
        cipher_version INTEGER NOT NULL,
        key_version INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS web_search_sessions (
        id TEXT PRIMARY KEY,
        display_ciphertext BLOB NOT NULL,
        display_nonce BLOB NOT NULL CHECK(length(display_nonce) = 12),
        display_tag BLOB NOT NULL CHECK(length(display_tag) = 16),
        payload_ciphertext BLOB NOT NULL,
        payload_nonce BLOB NOT NULL CHECK(length(payload_nonce) = 12),
        payload_tag BLOB NOT NULL CHECK(length(payload_tag) = 16),
        cipher_version INTEGER NOT NULL,
        key_version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS web_search_sessions_updated_at_index
        ON web_search_sessions(updated_at DESC);

      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        chat_id TEXT,
        metadata_ciphertext BLOB NOT NULL,
        metadata_nonce BLOB NOT NULL CHECK(length(metadata_nonce) = 12),
        metadata_tag BLOB NOT NULL CHECK(length(metadata_tag) = 16),
        cipher_version INTEGER NOT NULL,
        key_version INTEGER NOT NULL,
        byte_length INTEGER NOT NULL DEFAULT 0,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS artifacts_chat_date_index ON artifacts(chat_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS artifact_chunks (
        artifact_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        payload_ciphertext BLOB NOT NULL,
        payload_nonce BLOB NOT NULL CHECK(length(payload_nonce) = 12),
        payload_tag BLOB NOT NULL CHECK(length(payload_tag) = 16),
        cipher_version INTEGER NOT NULL,
        key_version INTEGER NOT NULL,
        PRIMARY KEY(artifact_id, chunk_index),
        FOREIGN KEY(artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS subagent_outputs (
        task_id TEXT PRIMARY KEY,
        payload_ciphertext BLOB NOT NULL,
        payload_nonce BLOB NOT NULL CHECK(length(payload_nonce) = 12),
        payload_tag BLOB NOT NULL CHECK(length(payload_tag) = 16),
        cipher_version INTEGER NOT NULL,
        key_version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS user_skills (
        profile TEXT NOT NULL,
        skill_id TEXT NOT NULL,
        payload_ciphertext BLOB NOT NULL,
        payload_nonce BLOB NOT NULL CHECK(length(payload_nonce) = 12),
        payload_tag BLOB NOT NULL CHECK(length(payload_tag) = 16),
        cipher_version INTEGER NOT NULL,
        key_version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(profile, skill_id)
      );

      CREATE TABLE IF NOT EXISTS launcher_index_meta (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        payload_ciphertext BLOB NOT NULL,
        payload_nonce BLOB NOT NULL CHECK(length(payload_nonce) = 12),
        payload_tag BLOB NOT NULL CHECK(length(payload_tag) = 16),
        cipher_version INTEGER NOT NULL,
        key_version INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS launcher_applications (
        id TEXT PRIMARY KEY,
        metadata_ciphertext BLOB NOT NULL,
        metadata_nonce BLOB NOT NULL CHECK(length(metadata_nonce) = 12),
        metadata_tag BLOB NOT NULL CHECK(length(metadata_tag) = 16),
        embedding_ciphertext BLOB NOT NULL,
        embedding_nonce BLOB NOT NULL CHECK(length(embedding_nonce) = 12),
        embedding_tag BLOB NOT NULL CHECK(length(embedding_tag) = 16),
        embedding_dimension INTEGER NOT NULL CHECK(embedding_dimension > 0),
        cipher_version INTEGER NOT NULL,
        key_version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS launcher_applications_updated_at_index
        ON launcher_applications(updated_at DESC);

      CREATE TABLE IF NOT EXISTS file_index_meta (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        payload_ciphertext BLOB NOT NULL,
        payload_nonce BLOB NOT NULL CHECK(length(payload_nonce) = 12),
        payload_tag BLOB NOT NULL CHECK(length(payload_tag) = 16),
        cipher_version INTEGER NOT NULL,
        key_version INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS filesystem_nodes (
        id TEXT PRIMARY KEY,
        parent_id TEXT,
        node_type TEXT NOT NULL DEFAULT 'file',
        content_kind TEXT NOT NULL DEFAULT 'binary',
        size_bytes INTEGER NOT NULL DEFAULT 0,
        modified_at INTEGER NOT NULL DEFAULT 0,
        indexed_at INTEGER NOT NULL DEFAULT 0,
        scan_order INTEGER NOT NULL DEFAULT 0,
        payload_ciphertext BLOB NOT NULL,
        payload_nonce BLOB NOT NULL CHECK(length(payload_nonce) = 12),
        payload_tag BLOB NOT NULL CHECK(length(payload_tag) = 16),
        payload_cipher_version INTEGER NOT NULL,
        payload_key_version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(parent_id) REFERENCES filesystem_nodes(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS filesystem_nodes_parent_index
        ON filesystem_nodes(parent_id);

      CREATE TABLE IF NOT EXISTS file_embedding_profile (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        payload_ciphertext BLOB NOT NULL,
        payload_nonce BLOB NOT NULL CHECK(length(payload_nonce) = 12),
        payload_tag BLOB NOT NULL CHECK(length(payload_tag) = 16),
        cipher_version INTEGER NOT NULL,
        key_version INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS file_semantics (
        file_id TEXT PRIMARY KEY,
        payload_ciphertext BLOB NOT NULL,
        payload_nonce BLOB NOT NULL CHECK(length(payload_nonce) = 12),
        payload_tag BLOB NOT NULL CHECK(length(payload_tag) = 16),
        embedding_ciphertext BLOB NOT NULL,
        embedding_nonce BLOB NOT NULL CHECK(length(embedding_nonce) = 12),
        embedding_tag BLOB NOT NULL CHECK(length(embedding_tag) = 16),
        embedding_dimension INTEGER NOT NULL CHECK(embedding_dimension > 0),
        payload_cipher_version INTEGER NOT NULL,
        payload_key_version INTEGER NOT NULL,
        embedding_cipher_version INTEGER NOT NULL,
        embedding_key_version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(file_id) REFERENCES filesystem_nodes(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS file_semantics_updated_at_index
        ON file_semantics(updated_at DESC);


      CREATE TABLE IF NOT EXISTS video_frame_semantics (
        semantic_id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL,
        timestamp_ms INTEGER NOT NULL DEFAULT 0,
        payload_ciphertext BLOB NOT NULL,
        payload_nonce BLOB NOT NULL CHECK(length(payload_nonce) = 12),
        payload_tag BLOB NOT NULL CHECK(length(payload_tag) = 16),
        embedding_ciphertext BLOB NOT NULL,
        embedding_nonce BLOB NOT NULL CHECK(length(embedding_nonce) = 12),
        embedding_tag BLOB NOT NULL CHECK(length(embedding_tag) = 16),
        embedding_dimension INTEGER NOT NULL CHECK(embedding_dimension > 0),
        payload_cipher_version INTEGER NOT NULL,
        payload_key_version INTEGER NOT NULL,
        embedding_cipher_version INTEGER NOT NULL,
        embedding_key_version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(file_id) REFERENCES filesystem_nodes(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS video_frame_semantics_file_index
        ON video_frame_semantics(file_id, timestamp_ms);

      CREATE TABLE IF NOT EXISTS file_concepts (
        concept_id TEXT PRIMARY KEY,
        generation TEXT NOT NULL,
        embedding_space TEXT NOT NULL,
        payload_ciphertext BLOB NOT NULL,
        payload_nonce BLOB NOT NULL CHECK(length(payload_nonce) = 12),
        payload_tag BLOB NOT NULL CHECK(length(payload_tag) = 16),
        centroid_ciphertext BLOB NOT NULL,
        centroid_nonce BLOB NOT NULL CHECK(length(centroid_nonce) = 12),
        centroid_tag BLOB NOT NULL CHECK(length(centroid_tag) = 16),
        centroid_dimension INTEGER NOT NULL CHECK(centroid_dimension > 0),
        member_count INTEGER NOT NULL DEFAULT 0 CHECK(member_count >= 0),
        cohesion REAL NOT NULL DEFAULT 0,
        payload_cipher_version INTEGER NOT NULL,
        payload_key_version INTEGER NOT NULL,
        centroid_cipher_version INTEGER NOT NULL,
        centroid_key_version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS file_concepts_generation_space_index
        ON file_concepts(generation, embedding_space, member_count DESC, cohesion DESC);

      CREATE TABLE IF NOT EXISTS file_concept_memberships (
        concept_id TEXT NOT NULL,
        generation TEXT NOT NULL,
        file_id TEXT NOT NULL,
        source_semantic_id TEXT NOT NULL,
        timestamp_ms INTEGER NOT NULL DEFAULT 0,
        similarity REAL NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(concept_id, file_id),
        FOREIGN KEY(concept_id) REFERENCES file_concepts(concept_id) ON DELETE CASCADE,
        FOREIGN KEY(file_id) REFERENCES filesystem_nodes(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS file_concept_memberships_concept_score_index
        ON file_concept_memberships(concept_id, similarity DESC, file_id);
      CREATE INDEX IF NOT EXISTS file_concept_memberships_file_index
        ON file_concept_memberships(file_id, concept_id);
`;

export const ENCRYPTED_DATABASE_COMPATIBILITY_INDEX_SQL = `
      CREATE INDEX IF NOT EXISTS filesystem_nodes_kind_size_index
        ON filesystem_nodes(content_kind, size_bytes DESC, id);
      CREATE INDEX IF NOT EXISTS filesystem_nodes_kind_scan_index
        ON filesystem_nodes(content_kind, indexed_at, id);
      CREATE INDEX IF NOT EXISTS filesystem_nodes_kind_scan_order_index
        ON filesystem_nodes(content_kind, indexed_at, scan_order, id);
`;

export const ENCRYPTED_DATABASE_SCHEMA_VERSION_SQL = `INSERT INTO schema_meta(key, value) VALUES('schema_version', '7')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`;

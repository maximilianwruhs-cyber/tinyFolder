---
title: Local RAG — LiteParse + Obsidian Vault Search Architecture
type: topic
tags:
  - research
  - RAG
  - liteparse
  - embeddings
  - vault-search
  - nomic-embed-text
sources: 0
created: '2026-04-22'
updated: '2026-04-22'
---
# Local RAG — LiteParse + Obsidian Vault Search Architecture

**The Three-Stage RAG Architecture**
The integration pathway for this local-first architecture operates through a three-stage sequence designed to maintain data sovereignty [1]. First, the **Ingestion Layer** processes unstructured raw documents via the LiteParse engine to generate spatial Markdown [1]. Second, this extracted data enters the **Knowledge Repository**, functioning as an active Obsidian Vault tightly structured with YAML metadata [1]. Finally, the **Intelligence Layer** relies on a Watchdog Daemon to continuously monitor file system events and synchronize any modifications directly to a Local Vector Database for LLM retrieval [1]. 

**LiteParse Spatial Grid Parsing**
Traditional document parsing frequently suffers from "spatial collapse," where forced table detection flattens text and destroys crucial structural relationships [1-3]. To solve this, **LiteParse utilizes PDF.js to extract text tokens alongside their exact $(x, y)$ coordinate bounding boxes** [4, 5]. Instead of guessing column alignments to build rigid Markdown tables, LiteParse projects these tokens onto a virtual two-dimensional plane, filling empty gaps with precise whitespace and padding characters [4-6]. Because LLMs are trained heavily on code formatting, they natively understand this ASCII-style spatial layout as a visual delimiter, preserving reading flow without data corruption [5]. 

**The Two-Stage Agentic Parsing Pattern**
Relying entirely on complex multimodal vision models introduces high latency (often 2 to 5 seconds per page) and exponential costs [7]. LiteParse instead utilizes a two-stage agentic parsing pattern: **it processes roughly 80% of pages purely locally using spatial grid projection at an ultra-fast ~50 milliseconds per page** [5]. Only when the parser detects extremely dense charts, overlapping visual elements, or low-confidence regions does it generate a targeted screenshot of that specific problem area and selectively route it to a multimodal vision model for deeper reasoning [5].

**Obsidian Integration & Bridging**
A Python bridging script automates the conversion of LiteParse's raw spatial output into Obsidian-compatible Markdown [8]. This script analyzes large vertical gaps to programmatically infer section breaks and inject hierarchical Markdown headers (`#`, `##`, `###`) [9]. To ensure that Obsidian's renderer does not collapse the crucial spaces used in grid tables, **the script wraps spatial tables within Markdown code blocks (```)**, forcing a monospaced font that perfectly honors LiteParse's exact whitespace padding [10]. It also saves any generated screenshots directly to the vault's attachments directory and embeds them using standard wiki-link syntax [9].

**YAML Frontmatter Schema**
The bridging script injects a highly structured YAML schema at the absolute top of every generated file to enable downstream metadata filtering [10, 11]. The implementation details include:
*   `title`: Essential for BM25 keyword search weighting [11].
*   `aliases`: An array of alternative nomenclature to capture varied lexical queries [11].
*   `tags`: A hierarchical array of taxonomies; crucially, **the `#` prefix must be omitted** to prevent YAML parsing errors [11].
*   `source_uri`: The original path or URL for citation trailing [11].
*   `ingestion_date`: An ISO 8601 timestamp to allow for temporal decay algorithms [11].
*   `document_type`: A string (e.g., `research_paper`) used to route queries before vector search begins [11, 12].
*   `content_hash`: A SHA256 hash mathematically representing the text body [12].

**The Python Watchdog Daemon & Debouncing Mechanics**
An active Obsidian vault is continuously modified, requiring a persistent background daemon to bridge the filesystem and vector database in real-time [13]. Built using the Python `watchdog` library, the daemon uses an `Observer` and a `PatternMatchingEventHandler` to recursively monitor for `*.md` files [13, 14]. It explicitly ignores local caches like `.obsidian` or `.smart-env/` to prevent infinite loops while listening for `on_created`, `on_modified`, `on_moved`, and `on_deleted` events [13, 14]. 

Because Obsidian constantly auto-saves text as the user types, standard monitoring would overwhelm CPU resources with redundant `on_modified` embedding executions [15]. To mitigate this, **the daemon utilizes debouncing mechanics by adding modified file paths and a Unix timestamp to a queue** [15]. A background worker thread only processes files that have remained untouched for a threshold of 5 to 10 seconds, guaranteeing a responsive UI [15, 16].

**SHA256 Deduplication and State Management**
To eliminate the devastating problem of duplicate vector embeddings stacking up after file modifications, the daemon enforces deterministic state synchronization [16, 17]. It calculates a SHA256 cryptographic hash of the entire file and checks a local state database (structured as SQLite or serialized JSON) that maps the file's relative path to this hash and its associated chunk UUIDs [17]. If the daemon detects that the new hash differs from the historical hash, it executes a strict **"delete and replace" protocol**: it explicitly deletes the old vectors associated with the file's UUIDs from the database *before* embedding and upserting the newly chunked data [17, 18]. 

**Vector Storage: ChromaDB vs. sqlite-vss**
The architecture highlights two highly optimized localized vector stores:
*   **ChromaDB:** A specialized NoSQL instance and the default for standard LangChain/LlamaIndex pipelines [19]. It inherently manages embedding function calls and connects easily to local models via Ollama [19, 20].
*   **sqlite-vss:** A highly efficient, monolithic alternative integrating Facebook AI Similarity Search (FAISS) into a single standard SQLite file [20]. This approach unifies relational data with high-dimensional float arrays, processing metadata and vectors simultaneously [20, 21].

**Embedding Pipeline and Semantic Chunking**
Chunking must be executed flawlessly to prevent severing logical meaning. The pipeline uses sophisticated semantic chunking via tools like LlamaIndex's `MarkdownNodeParser`, which splits documents dynamically based on hierarchical header delimiters [22]. **It is an absolute requirement that spatial grid tables remain strictly contained within a single chunk** so their internal relational logic isn't destroyed [22]. The pipeline targets optimal chunk sizes of 256 to 512 tokens, utilizing an overlap of 20 to 50 tokens to preserve context across contiguous boundaries [22, 23].

**Hybrid Search Implementation**
To minimize latency and maximize signal-to-noise ratios, the system relies on hybrid search rather than raw vector similarity [12]. By enforcing the YAML frontmatter schema upon ingestion, the database first executes standard relational metadata filtering (e.g., computing SQL `JOIN` operations on `document_type` or tags) to drastically narrow down the search space [12, 21]. Only then does it compute K-Nearest Neighbors (KNN) cosine distances—via functions like `vss_search` in sqlite-vss—or execute traditional FTS5 BM25 keyword searches against the heavily refined corpus [20, 21].

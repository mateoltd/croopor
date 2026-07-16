# ADR 0002: Content Discovery And Provenance
Status: Accepted

## Context
Axial can install Minecraft versions and loaders, but it has no way to find or
install content (mods, modpacks, resource packs, shader packs). Mods today are
opaque `.jar` files under `<game_dir>/mods`, scanned by filename and toggled with
a `.disabled` suffix. Nothing records what a jar is, where it came from, or which
version it is.

That missing identity is the real blocker. Without provenance we cannot dedupe
results against what is already installed, offer updates, resolve dependencies or
conflicts, or let users cherry-pick content into an existing instance. Any
"Discover" feature that ignores this ends up as a download button bolted onto an
unmanaged mods folder.

We also want one design that covers several content types, integrates with the
existing install queue rather than growing a parallel download system, and keeps
policy (dependency and conflict decisions) on the backend per `CONVENTIONS.md`.

## Decision
Add a content discovery subsystem built on four durable choices.

1. Dedicated `core/content` crate.
Provider clients, the canonical model, canonicalization, and the install
pipeline live in a new `core/content` crate that depends on `core/minecraft` for
verified downloads and integrity. This keeps `core/minecraft` focused on the game
runtime and gives content a clear API boundary.

2. Provider abstraction with a canonical model.
A `ContentProvider` trait (search, detail, versions, identify) feeds a
`ProviderRegistry` that merges and canonicalizes results into `CanonicalContent`.
Modrinth is the first and, for now, only implementation: it is the only content
source with a fully public API. CurseForge requires a partner key and carries
redistribution restrictions, so it is out until we choose to key it. The
abstraction is multi-provider from day one so adding a second source is a plug-in,
not a rewrite.

3. Hash-based canonicalization for dedupe.
A file's `sha512` is its universal identity. Identical files across providers and
managed pack contents collapse to one canonical file, and Modrinth's
`version_file/{hash}` endpoint resolves provider-described pack files back to a
project and version. Project-level cross-provider merging (by project id, then
shared source URL) is best-effort and strengthened later; nothing in Phase 1
depends on it.

4. Per-instance provenance manifest.
Each instance gains an `axial.content.json` manifest, owned by `core/content`,
recording every launcher-managed entry (canonical id, provider, project/version
ids, kind, filename, hashes, size, dependencies, enabled state, and install
time). The filesystem stays the truth for current file presence, while the
manifest remains the durable identity and ownership record. Reading instance
content never rewrites provenance or adopts files that appeared outside a
launcher-owned install transaction.

Supporting choices:
- Content installs are a new kind on the existing install queue, reusing verified
  transfer, SSE/desktop progress, and the single `activeDownload` representation.
  No second download-state mirror.
- Dependency and conflict resolution produce a backend-authored `ResolutionPlan`
  view-model (to install, deps added, conflicts with suggested resolution,
  removals). The frontend renders and confirms it; it does not author policy.
- Installs are staged then atomically renamed, and the manifest is updated
  transactionally, so failures roll back cleanly.

Scope for the first release:
- Data packs are deferred. Vanilla data packs are per-world, which does not fit
  "install into instance" cleanly; they come in a later phase.
- Discover ships with Modrinth mods, resource packs, shaders, full modpack setup,
  compatible-file cherry-pick, managed provenance, dependency and conflict
  resolution, update detection, and queue-integrated progress. A second provider
  remains deferred until a suitable independent source exists.

## Consequences
Positive:
- One pipeline and one canonical model serve every content type.
- Provenance makes dedupe, updates, conflict resolution, and cherry-pick
  tractable for launcher-managed content.
- Reusing the install queue keeps progress and download state unified.
- Backend-authored resolution keeps policy out of the UI, matching conventions.

Tradeoffs:
- Instances now carry a strict manifest whose entries may drift from the
  filesystem. Read paths report only live managed entries without destroying the
  ownership record; explicit managed operations handle changes.
- Hand-dropped files remain local and unmanaged. Axial does not infer ownership,
  updates, compatibility, or removal authority from their hashes.
- Single-provider reality means cross-provider canonicalization is unexercised
  until a second source exists, so that path stays best-effort.
- Cherry-pick fails closed for files the provider cannot identify, because Axial
  cannot promise provenance, updates, compatibility, or managed removal for them.

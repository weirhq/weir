"""The engine's release version, for Bazel builds.

Cargo reads it from Cargo.toml instead; //server/internal/version checks
that the two agree. The release workflow refuses an engine/v* tag that
doesn't match.
"""

ENGINE_VERSION = "0.1.0"

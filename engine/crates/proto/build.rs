// Generates the engine contract from proto/. Cargo and Bazel both run this;
// the output lives in OUT_DIR and is never committed.
use std::env;
use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR")?);
    let proto_root = manifest.join("../../../proto");
    let engine_proto = proto_root.join("weir/engine/v1alpha/engine.proto");

    let includes = [proto_root];

    println!("cargo:rerun-if-changed={}", engine_proto.display());
    tonic_prost_build::configure().compile_protos(&[engine_proto], &includes)?;
    Ok(())
}

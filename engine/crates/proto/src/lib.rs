//! The weir.engine.v1alpha contract, generated from `proto/` at build time.
//! The module path mirrors the proto package so Cargo and Bazel builds agree.

pub mod weir {
    pub mod engine {
        pub mod v1alpha {
            tonic::include_proto!("weir.engine.v1alpha");
        }
    }
}

pub use weir::engine::v1alpha;

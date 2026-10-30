//! The engine's gRPC service. `main.rs` binds the socket; tests drive
//! [`serve`] directly.

use std::future::Future;
use std::path::PathBuf;

use engine_proto::v1alpha::engine_server::{Engine, EngineServer};
use engine_proto::v1alpha::{
    CapabilitiesRequest, CapabilitiesResponse, HealthRequest, HealthResponse, ProbeRequest, ProbeResponse,
};
use tokio::net::UnixListener;
use tokio_stream::wrappers::UnixListenerStream;
use tonic::{Request, Response, Status};

#[derive(Debug, Clone)]
pub struct Config {
    pub ffprobe: PathBuf,
    pub max_sessions: u32,
}

pub struct EngineService {
    config: Config,
    ffmpeg_version: String,
}

impl EngineService {
    /// Reads what doesn't change while the engine runs, such as the ffmpeg
    /// version.
    pub async fn new(config: Config) -> Self {
        let ffmpeg_version = probe::ffprobe_version(&config.ffprobe)
            .await
            .unwrap_or_else(|err| {
                tracing::warn!(%err, "could not read the ffmpeg version");
                String::new()
            });
        Self {
            config,
            ffmpeg_version,
        }
    }
}

#[tonic::async_trait]
impl Engine for EngineService {
    async fn capabilities(
        &self,
        _: Request<CapabilitiesRequest>,
    ) -> Result<Response<CapabilitiesResponse>, Status> {
        // Hardware, Vulkan, Dolby Vision and tonemapping arrive with the
        // Phase 2 pipeline; until then the honest answer is "none".
        Ok(Response::new(CapabilitiesResponse {
            engine_version: env!("CARGO_PKG_VERSION").to_string(),
            ffmpeg_version: self.ffmpeg_version.clone(),
            max_sessions: self.config.max_sessions,
            ..Default::default()
        }))
    }

    async fn probe(&self, req: Request<ProbeRequest>) -> Result<Response<ProbeResponse>, Status> {
        let path = PathBuf::from(req.into_inner().path);
        match probe::probe(&self.config.ffprobe, &path).await {
            Ok(resp) => Ok(Response::new(resp)),
            Err(err @ probe::Error::RelativePath(_)) => Err(Status::invalid_argument(err.to_string())),
            Err(err @ probe::Error::NotFound(_)) => Err(Status::not_found(err.to_string())),
            Err(err @ probe::Error::Unreadable { .. }) => Err(Status::failed_precondition(err.to_string())),
            Err(err) => {
                tracing::error!(%err, path = %path.display(), "probe failed");
                Err(Status::internal(err.to_string()))
            }
        }
    }

    async fn health(&self, _: Request<HealthRequest>) -> Result<Response<HealthResponse>, Status> {
        Ok(Response::new(HealthResponse::default()))
    }
}

/// Serves the engine on `listener` until `shutdown` completes.
pub async fn serve(
    listener: UnixListener,
    service: EngineService,
    shutdown: impl Future<Output = ()>,
) -> Result<(), tonic::transport::Error> {
    tonic::transport::Server::builder()
        .add_service(EngineServer::new(service))
        .serve_with_incoming_shutdown(UnixListenerStream::new(listener), shutdown)
        .await
}

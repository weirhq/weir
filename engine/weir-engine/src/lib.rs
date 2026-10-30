//! The engine's gRPC service. `main.rs` binds the socket; tests drive
//! [`serve`] directly.

use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use engine_proto::v1alpha::engine_server::{Engine, EngineServer};
use engine_proto::v1alpha::{
    CapabilitiesRequest, CapabilitiesResponse, ControlSessionRequest, ControlSessionResponse, HealthRequest,
    HealthResponse, ProbeRequest, ProbeResponse, StartSessionRequest, StartSessionResponse,
    control_session_request::Command as ControlCommand,
};
use tokio::net::UnixListener;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tokio_stream::wrappers::UnixListenerStream;
use tokio_stream::{Stream, StreamExt};
use tonic::{Request, Response, Status};

#[derive(Debug, Clone)]
pub struct Config {
    pub ffprobe: PathBuf,
    pub ffmpeg: PathBuf,
    pub max_sessions: u32,
    pub session_limits: session::Limits,
}

/// The default segment length when the server doesn't ask for one.
const DEFAULT_SEGMENT: Duration = Duration::from_secs(6);

/// Running sessions, by id, with the channel that steers each.
type Sessions = Arc<Mutex<HashMap<String, mpsc::Sender<session::Command>>>>;

pub struct EngineService {
    config: Config,
    ffmpeg_version: String,
    sessions: Sessions,
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
            sessions: Sessions::default(),
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
        let active = self.sessions.lock().expect("sessions lock").len();
        Ok(Response::new(HealthResponse {
            active_sessions: active as u32,
            ..Default::default()
        }))
    }

    type StartSessionStream = Pin<Box<dyn Stream<Item = Result<StartSessionResponse, Status>> + Send>>;

    async fn start_session(
        &self,
        req: Request<StartSessionRequest>,
    ) -> Result<Response<Self::StartSessionStream>, Status> {
        let req = req.into_inner();
        let input = PathBuf::from(&req.path);
        let dir = PathBuf::from(&req.output_dir);
        if req.session_id.is_empty() {
            return Err(Status::invalid_argument("session_id is required"));
        }
        if !input.is_absolute() || !dir.is_absolute() {
            return Err(Status::invalid_argument("path and output_dir must be absolute"));
        }
        if !input.is_file() {
            return Err(Status::not_found(format!("{}: no such file", input.display())));
        }
        let Some(output) = req.output else {
            return Err(Status::invalid_argument("output is required"));
        };
        if output.burn_in_subtitle_stream.is_some() && output.video.is_none() {
            return Err(Status::invalid_argument(
                "burning in subtitles needs video output",
            ));
        }
        std::fs::create_dir_all(&dir)
            .map_err(|err| Status::internal(format!("create {}: {err}", dir.display())))?;

        let (commands, rx) = mpsc::channel(8);
        {
            let mut sessions = self.sessions.lock().expect("sessions lock");
            if sessions.contains_key(&req.session_id) {
                return Err(Status::already_exists("a session with that id is running"));
            }
            if sessions.len() >= self.config.max_sessions as usize {
                return Err(Status::resource_exhausted(format!(
                    "the engine is running its maximum of {} sessions",
                    self.config.max_sessions
                )));
            }
            sessions.insert(req.session_id.clone(), commands);
        }

        let spec = session::Spec {
            ffmpeg: self.config.ffmpeg.clone(),
            input,
            output,
            offset: duration(req.start_offset),
            segment: Some(duration(req.segment_duration))
                .filter(|d| !d.is_zero())
                .unwrap_or(DEFAULT_SEGMENT),
            dir,
            start_segment: req.start_segment,
        };
        let (tx, events) = mpsc::channel(64);
        let (sessions, id, limits) = (
            self.sessions.clone(),
            req.session_id.clone(),
            self.config.session_limits,
        );
        tokio::spawn(async move {
            tracing::info!(session = %id, "session started");
            session::run(spec, limits, rx, tx).await;
            sessions.lock().expect("sessions lock").remove(&id);
            tracing::info!(session = %id, "session ended");
        });
        let stream = ReceiverStream::new(events).map(|e| Ok(StartSessionResponse { event: Some(e) }));
        Ok(Response::new(Box::pin(stream)))
    }

    async fn control_session(
        &self,
        req: Request<ControlSessionRequest>,
    ) -> Result<Response<ControlSessionResponse>, Status> {
        let req = req.into_inner();
        let command = match req.command {
            Some(ControlCommand::Seek(seek)) => session::Command::Seek {
                offset: duration(seek.offset),
                start_segment: seek.start_segment,
            },
            Some(ControlCommand::Heartbeat(_)) => session::Command::Heartbeat,
            Some(ControlCommand::Stop(_)) => session::Command::Stop,
            None => return Err(Status::invalid_argument("command is required")),
        };
        let sender = self
            .sessions
            .lock()
            .expect("sessions lock")
            .get(&req.session_id)
            .cloned();
        let Some(sender) = sender else {
            return Err(Status::not_found("no such session"));
        };
        sender
            .send(command)
            .await
            .map_err(|_| Status::not_found("the session has ended"))?;
        Ok(Response::new(ControlSessionResponse {}))
    }
}

fn duration(d: Option<prost_types::Duration>) -> Duration {
    d.and_then(|d| Duration::try_from(d).ok()).unwrap_or_default()
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

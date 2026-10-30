//! Talks to the engine over a real Unix socket, the way weir-server does.

use std::path::{Path, PathBuf};

use engine_proto::v1alpha::engine_client::EngineClient;
use engine_proto::v1alpha::{CapabilitiesRequest, HealthRequest, ProbeRequest};
use hyper_util::rt::TokioIo;
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::oneshot;
use tonic::Code;
use tonic::transport::{Channel, Endpoint};
use weir_engine::{Config, EngineService};

async fn start(dir: &Path) -> (EngineClient<Channel>, oneshot::Sender<()>) {
    let socket = dir.join("engine.sock");
    let listener = UnixListener::bind(&socket).unwrap();
    let service = EngineService::new(Config {
        ffprobe: PathBuf::from("ffprobe"),
        max_sessions: 3,
    })
    .await;
    let (stop, stopped) = oneshot::channel();
    tokio::spawn(weir_engine::serve(listener, service, async {
        stopped.await.ok();
    }));

    // The URI is required by tonic but unused: the connector dials the socket.
    let channel = Endpoint::from_static("http://engine")
        .connect_with_connector(tower::service_fn(move |_| {
            let socket = socket.clone();
            async move { Ok::<_, std::io::Error>(TokioIo::new(UnixStream::connect(socket).await?)) }
        }))
        .await
        .unwrap();
    (EngineClient::new(channel), stop)
}

#[tokio::test]
async fn capabilities_health_and_probe_errors() {
    let dir = tempfile::tempdir().unwrap();
    let (mut client, stop) = start(dir.path()).await;

    let caps = client
        .capabilities(CapabilitiesRequest {})
        .await
        .unwrap()
        .into_inner();
    assert_eq!(caps.engine_version, env!("CARGO_PKG_VERSION"));
    assert_eq!(caps.max_sessions, 3);

    let health = client.health(HealthRequest {}).await.unwrap().into_inner();
    assert_eq!(health.active_sessions, 0);

    let err = client
        .probe(ProbeRequest {
            path: "relative.mkv".into(),
        })
        .await
        .unwrap_err();
    assert_eq!(err.code(), Code::InvalidArgument);
    let err = client
        .probe(ProbeRequest {
            path: "/nonexistent/film.mkv".into(),
        })
        .await
        .unwrap_err();
    assert_eq!(err.code(), Code::NotFound);

    stop.send(()).unwrap();
}

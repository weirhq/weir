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
        ffmpeg: PathBuf::from("ffmpeg"),
        max_sessions: 3,
        session_limits: session::Limits::default(),
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

mod sessions {
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};

    use engine_proto::v1alpha::engine_client::EngineClient;
    use engine_proto::v1alpha::{
        ControlSessionRequest, HealthRequest, OutputProfile, StartSessionRequest, Stop,
        control_session_request::Command,
    };
    use hyper_util::rt::TokioIo;
    use tokio::net::{UnixListener, UnixStream};
    use tonic::Code;
    use tonic::transport::{Channel, Endpoint};
    use weir_engine::{Config, EngineService};

    async fn engine(dir: &Path, ffmpeg: PathBuf) -> EngineClient<Channel> {
        let socket = dir.join("engine.sock");
        let listener = UnixListener::bind(&socket).unwrap();
        let service = EngineService::new(Config {
            ffprobe: PathBuf::from("ffprobe"),
            ffmpeg,
            max_sessions: 1,
            session_limits: session::Limits::default(),
        })
        .await;
        tokio::spawn(weir_engine::serve(listener, service, std::future::pending()));
        let channel = Endpoint::from_static("http://engine")
            .connect_with_connector(tower::service_fn(move |_| {
                let socket = socket.clone();
                async move { Ok::<_, std::io::Error>(TokioIo::new(UnixStream::connect(socket).await?)) }
            }))
            .await
            .unwrap();
        EngineClient::new(channel)
    }

    #[tokio::test]
    async fn sessions_are_counted_capped_and_stopped() {
        let dir = tempfile::tempdir().unwrap();
        let ffmpeg = dir.path().join("ffmpeg");
        std::fs::write(&ffmpeg, "#!/bin/sh\nexec sleep 30\n").unwrap();
        std::fs::set_permissions(&ffmpeg, std::fs::Permissions::from_mode(0o755)).unwrap();
        let input = dir.path().join("film.mkv");
        std::fs::write(&input, "").unwrap();
        let mut client = engine(dir.path(), ffmpeg).await;

        let request = |id: &str| StartSessionRequest {
            session_id: id.into(),
            path: input.to_string_lossy().into(),
            output: Some(OutputProfile::default()),
            output_dir: dir.path().join(id).to_string_lossy().into(),
            ..Default::default()
        };
        let mut events = client.start_session(request("one")).await.unwrap().into_inner();
        assert_eq!(
            client
                .health(HealthRequest {})
                .await
                .unwrap()
                .into_inner()
                .active_sessions,
            1
        );

        let err = client.start_session(request("two")).await.unwrap_err();
        assert_eq!(err.code(), Code::ResourceExhausted);
        let mut missing = request("three");
        missing.path = "/nonexistent.mkv".into();
        assert_eq!(
            client.start_session(missing).await.unwrap_err().code(),
            Code::NotFound
        );

        let stop = |id: &str| ControlSessionRequest {
            session_id: id.into(),
            command: Some(Command::Stop(Stop {})),
        };
        assert_eq!(
            client.control_session(stop("nope")).await.unwrap_err().code(),
            Code::NotFound
        );
        client.control_session(stop("one")).await.unwrap();
        while events.message().await.unwrap().is_some() {}
        // The registry drops the session once its task ends.
        for _ in 0..50 {
            if client
                .health(HealthRequest {})
                .await
                .unwrap()
                .into_inner()
                .active_sessions
                == 0
            {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        panic!("session still counted after stopping");
    }
}

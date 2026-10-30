use std::io::{self, IsTerminal};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use clap::Parser;
use tokio::net::{UnixListener, UnixStream};
use tokio::signal::unix::{SignalKind, signal};
use tracing_subscriber::EnvFilter;

use weir_engine::{Config, EngineService};

/// Weir's media engine. weir-server starts it and talks to it over a Unix
/// socket; nothing else should.
#[derive(Parser)]
#[command(version)]
struct Args {
    /// Path of the Unix socket to listen on.
    #[arg(long, env = "WEIR_ENGINE_SOCKET")]
    socket: PathBuf,
    /// The ffprobe binary to run.
    #[arg(long, env = "WEIR_FFPROBE", default_value = "ffprobe")]
    ffprobe: PathBuf,
    /// Concurrent playback sessions this engine accepts.
    #[arg(long, env = "WEIR_ENGINE_MAX_SESSIONS", default_value_t = 2)]
    max_sessions: u32,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with_writer(io::stderr)
        .with_ansi(io::stderr().is_terminal())
        .init();
    let args = Args::parse();

    let listener = bind(&args.socket).await?;
    let service = EngineService::new(Config {
        ffprobe: args.ffprobe,
        max_sessions: args.max_sessions,
    })
    .await;
    tracing::info!(socket = %args.socket.display(), "listening");

    let result = weir_engine::serve(listener, service, shutdown_signal()).await;
    let _ = std::fs::remove_file(&args.socket);
    tracing::info!("stopped");
    Ok(result?)
}

/// Binds the socket, replacing a stale one left by a crashed engine but
/// refusing to steal one another engine is serving.
async fn bind(path: &Path) -> io::Result<UnixListener> {
    if path.exists() {
        if UnixStream::connect(path).await.is_ok() {
            return Err(io::Error::new(
                io::ErrorKind::AddrInUse,
                format!("another engine is already listening on {}", path.display()),
            ));
        }
        std::fs::remove_file(path)?;
    }
    let listener = UnixListener::bind(path)?;
    // The server may run as a different user in the same group.
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o660))?;
    Ok(listener)
}

async fn shutdown_signal() {
    let mut term = signal(SignalKind::terminate()).expect("install SIGTERM handler");
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        _ = term.recv() => {}
    }
}

//! The runner against fake ffmpeg scripts: no real encoding, so these run
//! anywhere, including Bazel's sandbox.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use engine_proto::v1alpha::OutputProfile;
use engine_proto::v1alpha::session_event::Event;
use session::{Command, Limits, Spec, run};
use tokio::sync::mpsc;

fn fake_ffmpeg(dir: &Path, body: &str) -> PathBuf {
    let path = dir.join("ffmpeg");
    std::fs::write(
        &path,
        format!("#!/bin/sh\nfor last; do :; done\nout=$(dirname \"$last\")\n{body}\n"),
    )
    .unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

struct Session {
    commands: mpsc::Sender<Command>,
    events: mpsc::Receiver<engine_proto::v1alpha::SessionEvent>,
    _dir: tempfile::TempDir,
}

fn start(ffmpeg: PathBuf, limits: Limits) -> Session {
    let dir = tempfile::tempdir().unwrap();
    let (commands, rx) = mpsc::channel(8);
    let (tx, events) = mpsc::channel(64);
    let spec = Spec {
        ffmpeg,
        input: PathBuf::from("/media/film.mkv"),
        output: OutputProfile::default(),
        offset: Duration::ZERO,
        segment: Duration::from_secs(1),
        dir: dir.path().to_owned(),
        start_segment: 0,
    };
    tokio::spawn(run(spec, limits, rx, tx));
    Session {
        commands,
        events,
        _dir: dir,
    }
}

/// Collects events until the stream ends, or 5 s pass.
async fn drain(s: &mut Session) -> Vec<Event> {
    let mut out = Vec::new();
    let deadline = tokio::time::sleep(Duration::from_secs(5));
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            e = s.events.recv() => match e {
                Some(e) => out.push(e.event.unwrap()),
                None => return out,
            },
            _ = &mut deadline => panic!("session still running after 5 s: {out:?}"),
        }
    }
}

fn failure(events: &[Event]) -> Option<&str> {
    events.iter().find_map(|e| match e {
        Event::Failed(f) => Some(f.message.as_str()),
        _ => None,
    })
}

#[tokio::test]
async fn reports_ready_segments_progress_and_finished() {
    let bin = tempfile::tempdir().unwrap();
    let ffmpeg = fake_ffmpeg(
        bin.path(),
        r#": > "$out/init.mp4"
printf '#EXTM3U\n#EXTINF:1.0,\n0.m4s\n#EXTINF:0.5,\n1.m4s\n#EXT-X-ENDLIST\n' > "$last"
echo out_time_us=1500000; echo speed=3.5x; echo progress=end
sleep 0.5"#,
    );
    let mut s = start(ffmpeg, Limits::default());
    let events = drain(&mut s).await;
    // Progress may come first; Ready must come before any segment.
    let ready = events
        .iter()
        .position(|e| matches!(e, Event::Ready(_)))
        .expect("no Ready");
    let first_segment = events
        .iter()
        .position(|e| matches!(e, Event::Segment(_)))
        .expect("no segment");
    assert!(ready < first_segment, "{events:?}");
    let segments: Vec<_> = events
        .iter()
        .filter_map(|e| match e {
            Event::Segment(seg) => Some((seg.index, seg.duration.unwrap().nanos)),
            _ => None,
        })
        .collect();
    assert_eq!(segments, [(0, 0), (1, 500_000_000)]);
    assert!(
        events
            .iter()
            .any(|e| matches!(e, Event::Progress(p) if p.speed == 3.5)),
        "{events:?}"
    );
    assert!(matches!(events.last(), Some(Event::Finished(_))), "{events:?}");
}

#[tokio::test]
async fn reports_ffmpeg_errors() {
    let bin = tempfile::tempdir().unwrap();
    let ffmpeg = fake_ffmpeg(
        bin.path(),
        "echo 'Invalid data found when processing input' >&2\nexit 1",
    );
    let mut s = start(ffmpeg, Limits::default());
    let events = drain(&mut s).await;
    assert!(failure(&events).unwrap().contains("Invalid data"), "{events:?}");
}

#[tokio::test]
async fn ends_without_heartbeats() {
    let bin = tempfile::tempdir().unwrap();
    let mut s = start(
        fake_ffmpeg(bin.path(), "exec sleep 30"),
        Limits {
            stall: Duration::from_secs(60),
            heartbeat: Duration::from_millis(500),
        },
    );
    let events = drain(&mut s).await;
    assert!(failure(&events).unwrap().contains("heartbeat"), "{events:?}");
}

#[tokio::test]
async fn heartbeats_keep_it_alive_until_it_stalls() {
    let bin = tempfile::tempdir().unwrap();
    let mut s = start(
        fake_ffmpeg(bin.path(), "exec sleep 30"),
        Limits {
            stall: Duration::from_millis(1500),
            heartbeat: Duration::from_millis(500),
        },
    );
    let commands = s.commands.clone();
    tokio::spawn(async move {
        while commands.send(Command::Heartbeat).await.is_ok() {
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    });
    let events = drain(&mut s).await;
    assert!(failure(&events).unwrap().contains("stalled"), "{events:?}");
}

#[tokio::test]
async fn stop_ends_quietly() {
    let bin = tempfile::tempdir().unwrap();
    let mut s = start(fake_ffmpeg(bin.path(), "exec sleep 30"), Limits::default());
    s.commands.send(Command::Stop).await.unwrap();
    let events = drain(&mut s).await;
    assert!(failure(&events).is_none(), "{events:?}");
}

/// Waits until the fake ffmpeg has logged `n` runs.
async fn runs_logged(log: &Path, n: usize) -> Vec<String> {
    for _ in 0..100 {
        if let Ok(text) = std::fs::read_to_string(log) {
            let runs: Vec<String> = text.lines().map(str::to_owned).collect();
            if runs.len() >= n {
                return runs;
            }
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("fewer than {n} ffmpeg runs logged in 5 s");
}

#[tokio::test]
async fn seek_restarts_from_the_offset_with_new_numbers() {
    let bin = tempfile::tempdir().unwrap();
    let log = bin.path().join("runs");
    let ffmpeg = fake_ffmpeg(
        bin.path(),
        &format!("echo \"$*\" >> {}\nexec sleep 30", log.display()),
    );
    let mut s = start(ffmpeg, Limits::default());
    runs_logged(&log, 1).await;
    s.commands
        .send(Command::Seek {
            offset: Duration::from_secs(90),
            start_segment: 15,
        })
        .await
        .unwrap();
    let runs = runs_logged(&log, 2).await;
    s.commands.send(Command::Stop).await.unwrap();
    drain(&mut s).await;

    assert_eq!(runs.len(), 2, "{runs:?}");
    assert!(
        !runs[0].contains("-ss ") && runs[0].contains("-start_number 0"),
        "{}",
        runs[0]
    );
    assert!(
        runs[1].contains("-ss 90.000") && runs[1].contains("-start_number 15"),
        "{}",
        runs[1]
    );
}

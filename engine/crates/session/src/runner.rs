//! Running one session: ffmpeg, the segments it writes, and the commands
//! that steer it.

use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use engine_proto::v1alpha::{
    OutputProfile, SegmentReady, SessionEvent, SessionFailed, SessionFinished, SessionProgress, SessionReady,
    session_event::Event,
};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command as Process};
use tokio::sync::mpsc;
use tokio::time::{Instant, interval};

use crate::args::{INIT_SEGMENT, PLAYLIST, Run, ffmpeg_args};
use crate::playlist;

const POLL: Duration = Duration::from_millis(200);
const PROGRESS_EVERY: Duration = Duration::from_secs(1);
const STDERR_LINES: usize = 20;

/// How long a session may go without a segment, or without a heartbeat,
/// before it is killed.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub stall: Duration,
    pub heartbeat: Duration,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            stall: Duration::from_secs(20),
            heartbeat: Duration::from_secs(30),
        }
    }
}

#[derive(Debug)]
pub enum Command {
    Seek { offset: Duration, start_segment: u32 },
    Heartbeat,
    Stop,
}

/// Everything a session needs to start.
pub struct Spec {
    pub ffmpeg: PathBuf,
    pub input: PathBuf,
    pub output: OutputProfile,
    pub offset: Duration,
    pub segment: Duration,
    pub dir: PathBuf,
    pub start_segment: u32,
}

/// How a run of ffmpeg ended.
enum Outcome {
    Done,
    /// A seek: run again from this offset, numbering from this segment.
    Restart {
        offset: Duration,
        start_segment: u32,
    },
}

/// Runs the session until it finishes, fails, is stopped, or the server
/// stops listening. ffmpeg never outlives it.
pub async fn run(
    mut spec: Spec,
    limits: Limits,
    mut commands: mpsc::Receiver<Command>,
    events: mpsc::Sender<SessionEvent>,
) {
    let mut last_heartbeat = Instant::now();
    let mut ready_sent = false;
    loop {
        match run_once(
            &spec,
            limits,
            &mut commands,
            &events,
            &mut last_heartbeat,
            &mut ready_sent,
        )
        .await
        {
            Ok(Outcome::Done) => return,
            Ok(Outcome::Restart {
                offset,
                start_segment,
            }) => {
                spec.offset = offset;
                spec.start_segment = start_segment;
            }
            Err(message) => {
                let _ = events.send(event(Event::Failed(SessionFailed { message }))).await;
                return;
            }
        }
    }
}

async fn run_once(
    spec: &Spec,
    limits: Limits,
    commands: &mut mpsc::Receiver<Command>,
    events: &mpsc::Sender<SessionEvent>,
    last_heartbeat: &mut Instant,
    ready_sent: &mut bool,
) -> Result<Outcome, String> {
    // A playlist from before a seek would list segments this run won't write.
    let _ = std::fs::remove_file(spec.dir.join(PLAYLIST));
    let args = ffmpeg_args(&Run {
        input: &spec.input,
        output: &spec.output,
        offset: spec.offset,
        segment: spec.segment,
        dir: &spec.dir,
        start_segment: spec.start_segment,
    });
    let mut child = Process::new(&spec.ffmpeg)
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|err| format!("start {}: {err}", spec.ffmpeg.display()))?;
    let stderr = keep_tail(&mut child);
    let mut progress = BufReader::new(child.stdout.take().expect("piped stdout")).lines();

    let mut emitted = HashSet::new();
    let mut last_segment = Instant::now();
    let mut last_progress = Instant::now() - PROGRESS_EVERY;
    let (mut out_time, mut speed) = (Duration::ZERO, 0.0);
    let mut tick = interval(POLL);

    loop {
        tokio::select! {
            _ = tick.tick() => {
                if report_segments(&spec.dir, &mut emitted, ready_sent, events).await > 0 {
                    last_segment = Instant::now();
                }
                if last_heartbeat.elapsed() > limits.heartbeat {
                    stop(&mut child).await;
                    return Err("no heartbeat; the client is gone".into());
                }
                if last_segment.elapsed() > limits.stall {
                    stop(&mut child).await;
                    return Err(format!("stalled: no segment for {}s", limits.stall.as_secs()));
                }
            }
            line = progress.next_line() => {
                // ffmpeg -progress writes key=value lines, ending each report
                // with "progress=continue".
                if let Ok(Some(line)) = line {
                        if let Some(us) = line.strip_prefix("out_time_us=").and_then(|v| v.parse::<u64>().ok()) {
                            out_time = spec.offset + Duration::from_micros(us);
                        } else if let Some(s) = line.strip_prefix("speed=").and_then(|v| v.trim_end_matches('x').trim().parse().ok()) {
                            speed = s;
                        } else if line.starts_with("progress=") && last_progress.elapsed() >= PROGRESS_EVERY {
                            last_progress = Instant::now();
                            let position = prost_types::Duration::try_from(out_time).ok();
                            let _ = events.send(event(Event::Progress(SessionProgress { position, speed }))).await;
                        }
                }
                // A closed stdout means ffmpeg is exiting; wait() reports how.
            }
            status = child.wait() => {
                report_segments(&spec.dir, &mut emitted, ready_sent, events).await;
                let status = status.map_err(|err| err.to_string())?;
                if status.success() {
                    let _ = events.send(event(Event::Finished(SessionFinished {}))).await;
                    return Ok(Outcome::Done);
                }
                let tail = stderr.lock().expect("stderr lock").iter().cloned().collect::<Vec<_>>().join("\n");
                return Err(format!("ffmpeg exited with {status}: {tail}"));
            }
            command = commands.recv() => match command {
                Some(Command::Heartbeat) => *last_heartbeat = Instant::now(),
                Some(Command::Seek { offset, start_segment }) => {
                    stop(&mut child).await;
                    return Ok(Outcome::Restart { offset, start_segment });
                }
                Some(Command::Stop) | None => {
                    stop(&mut child).await;
                    return Ok(Outcome::Done);
                }
            },
            _ = events.closed() => {
                stop(&mut child).await;
                return Ok(Outcome::Done);
            }
        }
    }
}

/// Sends events for segments ffmpeg has finished since the last look, and
/// Ready once the init segment exists. Returns how many segments were new.
async fn report_segments(
    dir: &Path,
    emitted: &mut HashSet<u32>,
    ready_sent: &mut bool,
    events: &mpsc::Sender<SessionEvent>,
) -> usize {
    if !*ready_sent && dir.join(INIT_SEGMENT).exists() {
        *ready_sent = true;
        let init = dir.join(INIT_SEGMENT).to_string_lossy().into_owned();
        let _ = events
            .send(event(Event::Ready(SessionReady { init_segment: init })))
            .await;
    }
    let Ok(text) = tokio::fs::read_to_string(dir.join(PLAYLIST)).await else {
        return 0;
    };
    let mut new = 0;
    for seg in playlist::parse(&text).segments {
        if emitted.insert(seg.index) {
            new += 1;
            let ready = SegmentReady {
                index: seg.index,
                path: dir.join(&seg.file).to_string_lossy().into_owned(),
                duration: prost_types::Duration::try_from(seg.duration).ok(),
            };
            let _ = events.send(event(Event::Segment(ready))).await;
        }
    }
    new
}

/// Keeps the last lines ffmpeg writes to stderr, for failure messages.
fn keep_tail(child: &mut Child) -> Arc<Mutex<VecDeque<String>>> {
    let tail = Arc::new(Mutex::new(VecDeque::new()));
    if let Some(stderr) = child.stderr.take() {
        let tail = tail.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let mut t = tail.lock().expect("stderr lock");
                if t.len() == STDERR_LINES {
                    t.pop_front();
                }
                t.push_back(line);
            }
        });
    }
    tail
}

async fn stop(child: &mut Child) {
    let _ = child.kill().await;
}

fn event(e: Event) -> SessionEvent {
    SessionEvent { event: Some(e) }
}

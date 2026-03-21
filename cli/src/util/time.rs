use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::{DateTime, SecondsFormat, Utc};

type WallClock = Arc<dyn Fn() -> DateTime<Utc> + Send + Sync>;
type MonotonicClock = Arc<dyn Fn() -> Duration + Send + Sync>;

pub fn utc_now() -> DateTime<Utc> {
    Utc::now()
}

pub fn format_utc_timestamp(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[derive(Clone)]
pub struct SessionClock {
    wall_clock: WallClock,
    monotonic_clock: MonotonicClock,
    start_wall_clock: DateTime<Utc>,
    start_monotonic: Duration,
}

impl std::fmt::Debug for SessionClock {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SessionClock")
            .field("started_at", &self.started_at())
            .field("elapsed_ms", &self.elapsed_ms())
            .finish()
    }
}

impl Default for SessionClock {
    fn default() -> Self {
        let origin = Instant::now();
        Self::from_sources(utc_now, move || origin.elapsed())
    }
}

impl SessionClock {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_sources<W, M>(wall_clock: W, monotonic_clock: M) -> Self
    where
        W: Fn() -> DateTime<Utc> + Send + Sync + 'static,
        M: Fn() -> Duration + Send + Sync + 'static,
    {
        let wall_clock = Arc::new(wall_clock) as WallClock;
        let monotonic_clock = Arc::new(monotonic_clock) as MonotonicClock;
        let start_wall_clock = wall_clock();
        let start_monotonic = monotonic_clock();

        Self {
            wall_clock,
            monotonic_clock,
            start_wall_clock,
            start_monotonic,
        }
    }

    pub fn started_at(&self) -> String {
        format_utc_timestamp(self.start_wall_clock)
    }

    pub fn created_at(&self) -> String {
        format_utc_timestamp((self.wall_clock)())
    }

    pub fn elapsed_ms(&self) -> u64 {
        (self.monotonic_clock)()
            .saturating_sub(self.start_monotonic)
            .as_millis() as u64
    }
}

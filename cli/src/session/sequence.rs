use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};

#[derive(Debug, Clone, Default)]
pub struct Sequence {
    current: Arc<AtomicU64>,
}

impl Sequence {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_start(start: u64) -> Self {
        Self {
            current: Arc::new(AtomicU64::new(start)),
        }
    }

    pub fn current(&self) -> u64 {
        self.current.load(Ordering::Relaxed)
    }

    pub fn next(&self) -> u64 {
        self.current.fetch_add(1, Ordering::Relaxed) + 1
    }
}

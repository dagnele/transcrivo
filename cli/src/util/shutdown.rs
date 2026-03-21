use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use tokio::sync::Notify;

#[derive(Clone, Debug, Default)]
pub struct ShutdownController {
    requested: Arc<AtomicBool>,
    notify: Arc<Notify>,
}

impl ShutdownController {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn request(&self) {
        if !self.requested.swap(true, Ordering::SeqCst) {
            self.notify.notify_waiters();
        }
    }

    pub fn is_requested(&self) -> bool {
        self.requested.load(Ordering::SeqCst)
    }

    pub async fn wait_for_request(&self) {
        let notified = self.notify.notified();
        if self.is_requested() {
            return;
        }
        notified.await;
    }
}

use uuid::Uuid;

pub fn new_session_id() -> String {
    format!("sess_{}", Uuid::now_v7().simple())
}

pub fn new_event_id() -> String {
    format!("evt_{}", Uuid::new_v4().simple())
}

pub fn new_utterance_id() -> String {
    format!("utt_{}", Uuid::new_v4().simple())
}

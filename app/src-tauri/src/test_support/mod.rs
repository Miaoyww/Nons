use std::path::PathBuf;

pub struct TestDir(pub PathBuf);
impl TestDir {
    pub fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "nons-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for TestDir {
    fn drop(&mut self) {
        assert!(self.0.is_absolute() && self.0.starts_with(std::env::temp_dir()));
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

use std::path::{Path, PathBuf};

#[cfg(windows)]
fn strip_windows_verbatim_prefix(raw: &str) -> String {
    if let Some(rest) = raw.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{}", rest)
    } else if let Some(rest) = raw.strip_prefix(r"\\?\") {
        rest.to_string()
    } else if let Some(rest) = raw.strip_prefix(r"\??\UNC\") {
        format!(r"\\{}", rest)
    } else if let Some(rest) = raw.strip_prefix(r"\??\") {
        rest.to_string()
    } else {
        raw.to_string()
    }
}

pub fn normalize_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let raw = path.to_string_lossy();
        PathBuf::from(strip_windows_verbatim_prefix(&raw))
    }

    #[cfg(not(windows))]
    {
        path.to_path_buf()
    }
}

pub fn normalize_path_string(path: &Path) -> String {
    normalize_path(path).to_string_lossy().to_string()
}

pub fn canonicalize_for_storage(path: &Path) -> PathBuf {
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    normalize_path(&canonical)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn normalize_path_strips_verbatim_prefix() {
        let path = Path::new(r"\\?\D:\repo\project");
        assert_eq!(normalize_path_string(path), r"D:\repo\project");
    }

    #[cfg(windows)]
    #[test]
    fn normalize_path_strips_unc_verbatim_prefix() {
        let path = Path::new(r"\\?\UNC\server\share\repo");
        assert_eq!(normalize_path_string(path), r"\\server\share\repo");
    }
}

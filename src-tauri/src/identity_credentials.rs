// Identity-level credentials (currently just a signed-in identity's own
// GitHub personal access token, used for the repo-sync feature) -- real
// OS-native credential storage (macOS Keychain / Windows Credential
// Manager / Linux Secret Service), via the same `keyring` crate
// connected_sources.rs already uses for custom connector credentials.
// Kept as its OWN keyring service namespace (not a reuse of
// connected_sources.rs's `connected_source_*` commands) so an identity's
// token id-space can never collide with a real connector's id, and so
// this module reads clearly as "identity credentials," not "a connected
// source that happens not to be one." Generic over an arbitrary `field`
// name (not hardcoded to "githubToken") in case a future identity-level
// secret needs the same storage with no new commands.
use keyring::Entry;

const KEYRING_SERVICE: &str = "wigwag-identity-credentials";

fn credential_entry(identity_id: &str, field: &str) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, &format!("{}:{}", identity_id, field)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn identity_credential_set(identity_id: String, field: String, value: String) -> Result<(), String> {
    credential_entry(&identity_id, &field)?
        .set_password(&value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn identity_credential_get(identity_id: String, field: String) -> Result<Option<String>, String> {
    match credential_entry(&identity_id, &field)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn identity_credential_delete(identity_id: String, field: String) -> Result<(), String> {
    match credential_entry(&identity_id, &field)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // already gone -- not an error for a "clear this token" action
        Err(e) => Err(e.to_string()),
    }
}

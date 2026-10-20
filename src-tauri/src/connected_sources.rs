// Connected Sources (Phase 1): custom, user-defined external-system
// connectors (name + credential + regex patterns + a pasted JS macro).
// Two things a plain webview can't do on its own, which is the entire
// reason this needs Rust at all:
//
// 1. Arbitrary-domain HTTP with no CORS restriction. tauri-plugin-http's
//    own allow-scope is static, declared once in capabilities.json at
//    build time, with no runtime-extension API (confirmed by reading its
//    own source) -- that doesn't work for "a user adds a connector
//    pointing at a domain nobody could have predicted at build time". A
//    plain #[tauri::command]'s only ACL is "can the frontend call this at
//    all", not "which URLs can it hit" -- reqwest here has no scope
//    restriction of its own.
// 2. Real OS-native credential storage (macOS Keychain / Windows
//    Credential Manager / Linux Secret Service), via the `keyring` crate.
//    Nothing in this codebase touches a native keychain anywhere else;
//    every other credential (GitHub token, Jira/Salesforce/GitHub proxy
//    secrets) lives in localStorage today.

use std::collections::HashMap;

use keyring::Entry;
use serde::Serialize;

const KEYRING_SERVICE: &str = "wigwag-connected-sources";

#[derive(Serialize)]
pub struct FetchResponse {
    status: u16,
    headers: HashMap<String, String>,
    body: String,
}

// One Client for the app's whole lifetime, held in Tauri-managed state and
// handed to main.rs's Builder via .manage() -- reqwest::Client owns the
// connection pool, DNS cache, and TLS session state, and is cheap to
// clone (internally Arc'd) specifically so callers share one instead of
// building a fresh one per request. connected_source_fetch used to call
// reqwest::Client::new() on every single invocation, throwing all of that
// away each time -- every paste/refresh/macro-test paid a full TCP+TLS
// handshake from scratch instead of reusing a warm connection. Tom's own
// report ("why is the custom connector flow so slow") traced to exactly
// this.
pub struct ConnectedSourcesHttp {
    client: reqwest::Client,
}

impl Default for ConnectedSourcesHttp {
    fn default() -> Self {
        Self {
            client: reqwest::Client::new(),
        }
    }
}

// Deliberately no capabilities/permission scoping on the URL itself --
// see the module comment above. The frontend's own fetch shim (wigwag.html)
// is what a pasted macro actually calls; this command is that shim's
// transport, not something a macro invokes directly.
#[tauri::command]
pub async fn connected_source_fetch(
    state: tauri::State<'_, ConnectedSourcesHttp>,
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
) -> Result<FetchResponse, String> {
    let client = &state.client;
    let method = method.unwrap_or_else(|| "GET".to_string());
    let verb = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut req = client.request(verb, &url);

    if let Some(hdrs) = headers {
        for (k, v) in hdrs {
            req = req.header(k, v);
        }
    }
    if let Some(b) = body {
        req = req.body(b);
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let mut out_headers = HashMap::new();
    for (name, value) in resp.headers().iter() {
        if let Ok(v) = value.to_str() {
            out_headers.insert(name.as_str().to_string(), v.to_string());
        }
    }
    let body_text = resp.text().await.map_err(|e| e.to_string())?;

    Ok(FetchResponse {
        status,
        headers: out_headers,
        body: body_text,
    })
}

// Account name is the connector's stable internal id (e.g. "conn_7f3a1c"),
// never its mutable, user-editable name/key -- so renaming a connector
// never orphans its stored credential.
fn credential_entry(connector_id: &str) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, connector_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn connected_source_set_credential(connector_id: String, value: String) -> Result<(), String> {
    credential_entry(&connector_id)?
        .set_password(&value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn connected_source_get_credential(connector_id: String) -> Result<Option<String>, String> {
    match credential_entry(&connector_id)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn connected_source_delete_credential(connector_id: String) -> Result<(), String> {
    match credential_entry(&connector_id)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // already gone -- not an error for a "remove this connector" action
        Err(e) => Err(e.to_string()),
    }
}

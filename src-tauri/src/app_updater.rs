use std::cmp::Ordering;

use reqwest::{Client, Url};
use semver::Version;
use serde::{Deserialize, Serialize};
use tauri::{Manager, ResourceId, Runtime, Webview};
use tauri_plugin_updater::UpdaterExt;

const GITHUB_RELEASES_API_URL: &str = "https://api.github.com/repos/somnifex/Rosetta/releases";
const GITHUB_API_USER_AGENT: &str = "Rosetta-Updater";
const GITHUB_API_TIMEOUT_SECS: u64 = 15;
const RELEASE_MANIFEST_ASSET_NAME: &str = "latest.json";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    rid: ResourceId,
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
    raw_json: serde_json::Value,
}

#[derive(Debug, Deserialize, Clone)]
struct GitHubRelease {
    tag_name: String,
    prerelease: bool,
    draft: bool,
    html_url: Option<String>,
    published_at: Option<String>,
    assets: Vec<GitHubReleaseAsset>,
}

#[derive(Debug, Deserialize, Clone)]
struct GitHubReleaseAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Debug, Clone)]
struct ReleaseCandidate {
    tag_name: String,
    prerelease: bool,
    html_url: Option<String>,
    published_at: Option<String>,
    version: Version,
    manifest_url: Url,
}

#[tauri::command]
pub async fn check_app_update<R: Runtime>(
    webview: Webview<R>,
    accept_prereleases: bool,
) -> Result<Option<UpdateMetadata>, String> {
    let release_candidate = if accept_prereleases {
        Some(fetch_release_candidate(accept_prereleases).await?)
    } else {
        None
    };

    let mut builder = webview.updater_builder();

    if let Some(candidate) = release_candidate.as_ref() {
        builder = builder
            .endpoints(vec![candidate.manifest_url.clone()])
            .map_err(|error| error.to_string())?;
    }

    let updater = builder.build().map_err(|error| error.to_string())?;
    let update = updater.check().await.map_err(|error| error.to_string())?;

    if let Some(mut update) = update {
        annotate_release_metadata(
            &mut update.raw_json,
            release_candidate.as_ref(),
            accept_prereleases,
        );

        let metadata = UpdateMetadata {
            current_version: update.current_version.clone(),
            version: update.version.clone(),
            date: update.date.map(|date| date.to_string()),
            body: update.body.clone(),
            raw_json: update.raw_json.clone(),
            rid: webview.resources_table().add(update),
        };

        Ok(Some(metadata))
    } else {
        Ok(None)
    }
}

async fn fetch_release_candidate(accept_prereleases: bool) -> Result<ReleaseCandidate, String> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(GITHUB_API_TIMEOUT_SECS))
        .user_agent(GITHUB_API_USER_AGENT)
        .build()
        .map_err(|error| format!("Failed to build update discovery client: {error}"))?;

    let releases = client
        .get(GITHUB_RELEASES_API_URL)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|error| format!("Failed to query GitHub releases: {error}"))?
        .error_for_status()
        .map_err(|error| format!("GitHub releases API returned an error: {error}"))?
        .json::<Vec<GitHubRelease>>()
        .await
        .map_err(|error| format!("Failed to decode GitHub releases response: {error}"))?;

    select_release_candidate(&releases, accept_prereleases)
        .ok_or_else(|| "No eligible release with updater metadata was found.".to_string())
}

fn select_release_candidate(
    releases: &[GitHubRelease],
    accept_prereleases: bool,
) -> Option<ReleaseCandidate> {
    releases
        .iter()
        .filter(|release| !release.draft)
        .filter(|release| accept_prereleases || !release.prerelease)
        .filter_map(|release| {
            let manifest_url = release_manifest_url(release)?;
            let version = release_version(&release.tag_name)?;

            Some(ReleaseCandidate {
                tag_name: release.tag_name.clone(),
                prerelease: release.prerelease,
                html_url: release.html_url.clone(),
                published_at: release.published_at.clone(),
                version,
                manifest_url,
            })
        })
        .max_by(compare_release_candidates)
}

fn compare_release_candidates(left: &ReleaseCandidate, right: &ReleaseCandidate) -> Ordering {
    left.version
        .cmp(&right.version)
        .then_with(|| left.published_at.cmp(&right.published_at))
}

fn release_manifest_url(release: &GitHubRelease) -> Option<Url> {
    release
        .assets
        .iter()
        .find(|asset| asset.name.eq_ignore_ascii_case(RELEASE_MANIFEST_ASSET_NAME))
        .and_then(|asset| Url::parse(&asset.browser_download_url).ok())
}

fn release_version(tag_name: &str) -> Option<Version> {
    Version::parse(tag_name.trim_start_matches('v')).ok()
}

fn annotate_release_metadata(
    raw_json: &mut serde_json::Value,
    release_candidate: Option<&ReleaseCandidate>,
    accept_prereleases: bool,
) {
    if !raw_json.is_object() {
        *raw_json = serde_json::json!({});
    }

    let Some(object) = raw_json.as_object_mut() else {
        return;
    };

    object.insert(
        "accepts_prereleases".to_string(),
        serde_json::Value::Bool(accept_prereleases),
    );

    if let Some(candidate) = release_candidate {
        object.insert(
            "prerelease".to_string(),
            serde_json::Value::Bool(candidate.prerelease),
        );
        object.insert(
            "tag_name".to_string(),
            serde_json::Value::String(candidate.tag_name.clone()),
        );

        if let Some(html_url) = candidate.html_url.clone() {
            object.insert("html_url".to_string(), serde_json::Value::String(html_url));
        }
    } else {
        object
            .entry("prerelease".to_string())
            .or_insert(serde_json::Value::Bool(false));
    }
}

#[cfg(test)]
mod tests {
    use super::{
        release_manifest_url, release_version, select_release_candidate, GitHubRelease,
        GitHubReleaseAsset,
    };

    fn release(
        tag_name: &str,
        prerelease: bool,
        published_at: &str,
        asset_name: Option<&str>,
    ) -> GitHubRelease {
        GitHubRelease {
            tag_name: tag_name.to_string(),
            prerelease,
            draft: false,
            html_url: Some(format!("https://example.com/{tag_name}")),
            published_at: Some(published_at.to_string()),
            assets: asset_name
                .map(|name| {
                    vec![GitHubReleaseAsset {
                        name: name.to_string(),
                        browser_download_url: format!("https://example.com/{tag_name}/{name}"),
                    }]
                })
                .unwrap_or_default(),
        }
    }

    #[test]
    fn parses_release_version_from_prefixed_tags() {
        let version = release_version("v0.3.0-beta.1").expect("expected a semver release tag");
        assert_eq!(version.to_string(), "0.3.0-beta.1");
    }

    #[test]
    fn ignores_releases_without_latest_manifest_asset() {
        let release = release(
            "v0.3.0-beta.1",
            true,
            "2026-04-04T00:00:00Z",
            Some("notes.txt"),
        );
        assert!(release_manifest_url(&release).is_none());
    }

    #[test]
    fn picks_latest_stable_release_when_prereleases_are_disabled() {
        let releases = vec![
            release(
                "v0.3.0-beta.1",
                true,
                "2026-04-04T00:00:00Z",
                Some("latest.json"),
            ),
            release("v0.2.9", false, "2026-04-03T00:00:00Z", Some("latest.json")),
        ];

        let selected =
            select_release_candidate(&releases, false).expect("expected a stable release");

        assert_eq!(selected.tag_name, "v0.2.9");
        assert!(!selected.prerelease);
    }

    #[test]
    fn picks_highest_semver_release_when_prereleases_are_enabled() {
        let releases = vec![
            release("v0.2.9", false, "2026-04-03T00:00:00Z", Some("latest.json")),
            release(
                "v0.3.0-beta.1",
                true,
                "2026-04-04T00:00:00Z",
                Some("latest.json"),
            ),
        ];

        let selected =
            select_release_candidate(&releases, true).expect("expected a release candidate");

        assert_eq!(selected.tag_name, "v0.3.0-beta.1");
        assert!(selected.prerelease);
    }
}

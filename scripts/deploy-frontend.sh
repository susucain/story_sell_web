#!/usr/bin/env bash
set -Eeuo pipefail

readonly DEPLOY_DIR="${DEPLOY_DIR:-/opt/agui-frontend}"
readonly RELEASES_DIR="${DEPLOY_DIR}/releases"
readonly CURRENT_LINK="${DEPLOY_DIR}/current"
readonly ARCHIVE="${1:?Usage: deploy-frontend.sh <archive> <git-sha>}"
readonly GIT_SHA="${2:?Usage: deploy-frontend.sh <archive> <git-sha>}"
readonly HEALTH_URL="${HEALTH_URL:-http://127.0.0.1/index.html}"

if [[ ! "${GIT_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Invalid Git commit SHA: ${GIT_SHA}" >&2
  exit 1
fi

if [[ ! -r "${ARCHIVE}" ]]; then
  echo "Release archive is not readable: ${ARCHIVE}" >&2
  exit 1
fi

readonly RELEASE_DIR="${RELEASES_DIR}/${GIT_SHA}"
readonly TEMP_DIR="${RELEASES_DIR}/.${GIT_SHA}.tmp"

previous_release=""
if [[ -L "${CURRENT_LINK}" ]]; then
  previous_release="$(readlink -f "${CURRENT_LINK}")"
fi

rm -rf "${TEMP_DIR}"
mkdir -p "${TEMP_DIR}"
tar -xzf "${ARCHIVE}" -C "${TEMP_DIR}"

if [[ ! -f "${TEMP_DIR}/index.html" ]]; then
  echo "Release does not contain index.html" >&2
  rm -rf "${TEMP_DIR}"
  exit 1
fi

asset_path="$(
  sed -nE 's/.*(src|href)="(\/assets\/[^"]+)".*/\2/p' \
    "${TEMP_DIR}/index.html" | head -n 1
)"
if [[ -n "${asset_path}" && ! -f "${TEMP_DIR}/${asset_path#/}" ]]; then
  echo "Referenced asset is missing: ${asset_path}" >&2
  rm -rf "${TEMP_DIR}"
  exit 1
fi

if [[ -d "${RELEASE_DIR}" ]]; then
  rm -rf "${TEMP_DIR}"
else
  mv "${TEMP_DIR}" "${RELEASE_DIR}"
fi

ln -sfn "${RELEASE_DIR}" "${CURRENT_LINK}"

if ! curl --fail --silent --show-error --max-time 10 \
  "${HEALTH_URL}" > /dev/null; then
  echo "Frontend health check failed." >&2
  if [[ -n "${previous_release}" && -d "${previous_release}" ]]; then
    ln -sfn "${previous_release}" "${CURRENT_LINK}"
    echo "Rolled back to ${previous_release}" >&2
  fi
  exit 1
fi

rm -f "${ARCHIVE}"
echo "Frontend deployment completed: ${GIT_SHA}"

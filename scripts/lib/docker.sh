#!/usr/bin/env bash

qft_services=(
  message-gateway
  context-hub
  model-hub
  capability-registry
  runtime-center
  scheduler-center
  resource-center
  governance-center
  browser-worker
  capability-worker
  console
)

qft_select_docker() {
  if docker info >/dev/null 2>&1; then
    qft_docker_command=(docker)
  elif sudo -n docker info >/dev/null 2>&1; then
    qft_docker_command=(sudo -n docker)
  else
    printf 'Docker is unavailable. Grant the current user Docker access or configure passwordless sudo for Docker.\n' >&2
    return 1
  fi
}

qft_docker() {
  "${qft_docker_command[@]}" "$@"
}

qft_checksum_create() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$@"
  else
    shasum -a 256 "$@"
  fi
}

qft_checksum_verify() {
  local manifest="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum --check "$manifest"
  else
    shasum -a 256 --check "$manifest"
  fi
}

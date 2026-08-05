# shellcheck shell=bash
# Source from other scripts in this directory (do not execute directly).
# Hostname, user, port, and IdentityFile should live in ~/.ssh/config (e.g. Host optimus).
# Optional overrides: OPTIMUS / OPTIMUS_HOST / OPTIMUS_EXTERNAL, SSH_KEY, OPTIMUS_SSH_PORT / SSH_PORT.

# Default to optimus-wan (SSH config / ProxyJump) — bare "optimus" LAN IP times out off-LAN.
OPTIMUS="${OPTIMUS_EXTERNAL:-${OPTIMUS:-${OPTIMUS_HOST:-optimus-wan}}}"
_port="${OPTIMUS_SSH_PORT:-${SSH_PORT:-}}"
_jump="${OPTIMUS_SSH_JUMP:-}"

_ssh=(ssh -o BatchMode=yes)
if [[ -n "${_jump}" ]]; then
  _ssh+=(-J "${_jump}")
fi
[[ -n "${SSH_KEY:-}" ]] && _ssh+=(-i "$SSH_KEY")
[[ -n "${_port}" ]] && _ssh+=(-p "${_port}")
_ssh+=(-o StrictHostKeyChecking=no)
OPTIMUS_SSH=("${_ssh[@]}")
OPTIMUS_RSYNC_E="$(printf '%q ' "${OPTIMUS_SSH[@]}")"

_scp=(scp -o BatchMode=yes)
[[ -n "${SSH_KEY:-}" ]] && _scp+=(-i "$SSH_KEY")
[[ -n "${_port}" ]] && _scp+=(-P "${_port}")
_scp+=(-o StrictHostKeyChecking=no)
OPTIMUS_SCP=("${_scp[@]}")

_batch=(ssh -o BatchMode=yes)
[[ -n "${SSH_KEY:-}" ]] && _batch+=(-i "$SSH_KEY")
[[ -n "${_port}" ]] && _batch+=(-p "${_port}")
_batch+=(-o StrictHostKeyChecking=no)
OPTIMUS_SSH_BATCH=("${_batch[@]}")

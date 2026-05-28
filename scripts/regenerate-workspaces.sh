#!/usr/bin/env bash
# Rebuild each agent's workspace/AGENTS.md from its inputs:
#   _shared/<role>-reference.md  + role prompt + _shared/snippets/<role>.md
# OpenClaw injects AGENTS.md into the system prompt on first turn, so any
# change to a role prompt, the syntax reference, or the snippet bank takes
# effect only after this script runs and the agent restarts.

set -euo pipefail
cd "$(dirname "$0")/.."

write_workspace () {
  local role="$1"          # strudel-drums / strudel-bass / strudel-lead / hydra
  local ref_kind="$2"      # strudel / hydra
  local out="agents/homes/$role/workspace/AGENTS.md"
  mkdir -p "$(dirname "$out")"
  {
    cat "agents/_shared/${ref_kind}-reference.md"
    echo
    echo "---"
    echo
    cat "agents/$role/prompt.md"
    echo
    echo "---"
    echo
    cat "agents/_shared/snippets/$role.md"
  } > "$out"
  echo "wrote $out ($(wc -l < "$out") lines)"
}

write_workspace strudel-drums strudel
write_workspace strudel-bass  strudel
write_workspace strudel-lead  strudel
write_workspace hydra         hydra

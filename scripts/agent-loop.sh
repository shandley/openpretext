#!/bin/bash
# OpenPretext Agent Loop
# Based on the approach from: https://www.anthropic.com/engineering/building-c-compiler
#
# This runs a Claude Code agent in a loop, continuously improving the project.
# Run this inside a Docker container or sandboxed environment.
#
# Usage: ./scripts/agent-loop.sh [agent-id]

AGENT_ID=${1:-"agent-$(date +%s)"}
LOG_DIR="agent_logs"
mkdir -p "$LOG_DIR"

echo "Starting OpenPretext agent loop: $AGENT_ID"

while true; do
    COMMIT=$(git rev-parse --short=6 HEAD 2>/dev/null || echo "no-git")
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    LOGFILE="${LOG_DIR}/${AGENT_ID}_${TIMESTAMP}_${COMMIT}.log"

    echo "[$AGENT_ID] Starting session at $TIMESTAMP (commit: $COMMIT)"

    claude --dangerously-skip-permissions \
           -p "$(cat AGENT_PROMPT.md)" \
           --model claude-opus-4-6 \
           2>&1 | tee "$LOGFILE"

    echo "[$AGENT_ID] Session ended. Restarting in 5s..."
    sleep 5
done

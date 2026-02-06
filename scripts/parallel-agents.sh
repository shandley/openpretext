#!/bin/bash
# Spin up parallel Claude Code agents for OpenPretext development.
# Based on the approach from: https://www.anthropic.com/engineering/building-c-compiler
#
# Prerequisites:
# - Docker installed
# - ANTHROPIC_API_KEY environment variable set
# - A bare git repo at ./openpretext-upstream.git
#
# Usage: ./scripts/parallel-agents.sh <num-agents>

NUM_AGENTS=${1:-4}
UPSTREAM_REPO="$(pwd)/openpretext-upstream.git"

# Create upstream bare repo if it doesn't exist
if [ ! -d "$UPSTREAM_REPO" ]; then
    echo "Creating upstream bare repo..."
    git init --bare "$UPSTREAM_REPO"
    
    # Push current state
    git remote add upstream "$UPSTREAM_REPO" 2>/dev/null || true
    git push upstream main 2>/dev/null || git push upstream master 2>/dev/null
fi

echo "Starting $NUM_AGENTS agents..."

for i in $(seq 1 $NUM_AGENTS); do
    AGENT_NAME="openpretext-agent-$i"
    echo "Launching $AGENT_NAME..."
    
    docker run -d \
        --name "$AGENT_NAME" \
        -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
        -v "$UPSTREAM_REPO:/upstream:rw" \
        node:22 \
        bash -c "
            # Install Claude Code
            npm install -g @anthropic-ai/claude-code
            
            # Clone the repo
            git clone /upstream /workspace
            cd /workspace
            npm install
            
            # Run the agent loop
            chmod +x scripts/agent-loop.sh
            ./scripts/agent-loop.sh $AGENT_NAME
        "
    
    echo "$AGENT_NAME launched"
    sleep 2
done

echo ""
echo "All $NUM_AGENTS agents running."
echo "Monitor with: docker logs -f openpretext-agent-1"
echo "Stop all: docker stop \$(docker ps -q --filter name=openpretext-agent)"

# List available commands
default:
    @just --list

# Be friendly
hi:
    @echo 'hi'

logs:
    docker logs -t --since 10m gopher

logs2:
    set -a; source .env; set +a; curl -s -H "Authorization: Bearer $LUMIN_API_TOKEN" "$LUMIN_API_URL/ai/queue?source=file&limit=20" | jq '{count,total_pending,types:([.items[].file_type]|group_by(.)|map({type:.[0],n:length})), names:[.items[0:8][]|{id:.file_id,name:.file_name,type:.file_type,size:.file_size}]}'

restart:
    docker restart gopher && docker logs -tf gopher

build:
    docker compose up -d --build gopher && docker logs -tf gopher
    
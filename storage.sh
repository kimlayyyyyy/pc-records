#!/bin/bash
echo "Content-Type: application/json"
echo "Access-Control-Allow-Origin: *"
echo ""

VIDEOS_PATH="/var/www/html/videos"

# Total disk info for the partition holding /srv/recordings (mounted into container)
read -r total_kb used_kb avail_kb <<< $(df -k "$VIDEOS_PATH" 2>/dev/null | awk 'NR==2{print $2, $3, $4}')

total_bytes=$((total_kb * 1024))
used_bytes=$((used_kb * 1024))
avail_bytes=$((avail_kb * 1024))

# Per-station usage
stations_json="["
first=1
for dir in "$VIDEOS_PATH"/PC*/; do
  [ -d "$dir" ] || continue
  name=$(basename "$dir")
  size_kb=$(du -sk "$dir" 2>/dev/null | awk '{print $1}')
  size_bytes=$((size_kb * 1024))
  count=$(find "$dir" -maxdepth 1 -type f \( -iname "*.mp4" -o -iname "*.webm" -o -iname "*.mkv" -o -iname "*.mov" -o -iname "*.avi" \) 2>/dev/null | wc -l)
  [ $first -eq 0 ] && stations_json+=","
  stations_json+="{\"id\":\"$name\",\"bytes\":$size_bytes,\"files\":$count}"
  first=0
done
stations_json+="]"

echo "{\"total\":$total_bytes,\"used\":$used_bytes,\"available\":$avail_bytes,\"stations\":$stations_json}"

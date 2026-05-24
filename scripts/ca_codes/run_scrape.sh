#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")"
mkdir -p data
python3 ca_codes_scraper.py --config config.yaml -v 2>&1 | tee -a data/scrape.log
status=${PIPESTATUS[0]}
echo ""
echo "Scrape exited with code $status at $(date)"
echo "Log: $(pwd)/data/scrape.log"
if [[ $status -ne 0 ]]; then
  echo "Tip: open https://law.justia.com in Chrome, then export cookies to cookies.txt"
fi
sleep 3600

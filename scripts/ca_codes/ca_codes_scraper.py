#!/usr/bin/env python3
"""Convenience launcher: python ca_codes_scraper.py [args]"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ca_codes.__main__ import main

if __name__ == "__main__":
    main()

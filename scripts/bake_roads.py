"""Owns only data/roads.geojson. The ground bake reads this recipe without writes."""
import json
from collections import Counter
from pathlib import Path
from bake_ground import bake_roads

if __name__ == '__main__':
    stats, warnings = Counter(), []
    data = dict(type='FeatureCollection', features=bake_roads(stats, warnings))
    target = Path(__file__).resolve().parents[1]/'data/roads.geojson'
    target.write_text(json.dumps(data, separators=(',', ':')), encoding='utf-8')
    print('Roads:', len(data['features']), 'features;', len(warnings), 'warnings')

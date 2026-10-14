"""Erzeugt die Test-Fixtures (Mini-DVG-Paket + PLZ-GeoJSON). Benötigt: pip install pyshp pyproj"""
import json, os, shapefile
from pyproj import Transformer

here = os.path.dirname(os.path.abspath(__file__))
to_wgs = Transformer.from_crs(25832, 4326, always_xy=True)

def rect(x1, y1, x2, y2):  # im Uhrzeigersinn (Shapefile-Außenring)
    return [[x1, y1], [x1, y2], [x2, y2], [x2, y1], [x1, y1]]

def hole(x1, y1, x2, y2):  # gegen den Uhrzeigersinn
    return list(reversed(rect(x1, y1, x2, y2)))

def write(name, feats):
    w = shapefile.Writer(os.path.join(here, 'dvg', name), shapeType=shapefile.POLYGON, encoding='utf-8')
    w.field('KN', 'C', 40); w.field('GN', 'C', 40)
    for kn, gn, rings in feats:
        w.poly(rings); w.record(kn, gn)
    w.close()
    open(os.path.join(here, 'dvg', name + '.cpg'), 'w').write('UTF-8')

write('dvg2rbz_nw', [('05100000000', 'Düsseldorf', [rect(300000, 5600000, 350000, 5700000)]),
                     ('05300000000', 'Köln', [rect(350000, 5600000, 400000, 5700000)])])
write('dvg2krs_nw', [('05111000', 'Düsseldorf', [rect(300000, 5650000, 350000, 5700000)]),
                     ('05158000', 'Mettmann', [rect(300000, 5600000, 350000, 5650000)]),
                     ('05315000', 'Köln', [rect(350000, 5600000, 400000, 5700000)])])
write('dvg2gem_nw', [('05111000', 'Düsseldorf', [rect(300000, 5650000, 350000, 5700000)]),
                     ('05158004', 'Erkrath', [rect(300000, 5600000, 325000, 5650000)]),
                     ('05158008', 'Haan', [rect(325000, 5600000, 350000, 5650000)]),
                     ('05315000', 'Köln', [rect(350000, 5600000, 400000, 5700000), hole(370000, 5640000, 380000, 5660000)])])

def wgs_rect(x1, y1, x2, y2):
    return [[list(map(lambda v: round(v, 7), to_wgs.transform(x, y))) for x, y in reversed(rect(x1, y1, x2, y2))]]

plz = {'type': 'FeatureCollection', 'features': [
    {'type': 'Feature', 'properties': {'plz': '40210', 'note': '40210 Düsseldorf'}, 'geometry': {'type': 'Polygon', 'coordinates': wgs_rect(310000, 5680000, 320000, 5690000)}},
    {'type': 'Feature', 'properties': {'plz': '40211', 'note': '40211 Düsseldorf'}, 'geometry': {'type': 'Polygon', 'coordinates': wgs_rect(320000, 5680000, 330000, 5690000)}},
    {'type': 'Feature', 'properties': {'plz': '40211', 'note': '40211 Düsseldorf'}, 'geometry': {'type': 'Polygon', 'coordinates': wgs_rect(320000, 5670000, 330000, 5680000)}},
    {'type': 'Feature', 'properties': {'plz': '50667', 'note': '50667 Köln'}, 'geometry': {'type': 'Polygon', 'coordinates': wgs_rect(390000, 5650000, 410000, 5660000)}},
    {'type': 'Feature', 'properties': {'plz': '35037', 'note': '35037 Außerhalb'}, 'geometry': {'type': 'Polygon', 'coordinates': wgs_rect(420000, 5600000, 430000, 5610000)}},
    {'type': 'Feature', 'properties': {'plz': '80331', 'note': '80331 München'}, 'geometry': {'type': 'Polygon', 'coordinates': [[[11.56, 48.13], [11.58, 48.13], [11.58, 48.15], [11.56, 48.15], [11.56, 48.13]]]}},
]}
json.dump(plz, open(os.path.join(here, 'plz5.geojson'), 'w'), ensure_ascii=False)

"""Local-metre geometry helpers; no GIS dependencies."""

from __future__ import annotations
import math
from collections import defaultdict

MPD_LAT = 111195.0
MPD_LON = 96061.0
ORIGIN = (-97.74, 30.285)


def xy(coordinate):
    return ((coordinate[0] - ORIGIN[0]) * MPD_LON,
            (coordinate[1] - ORIGIN[1]) * MPD_LAT)


def lonlat(position):
    return [position[0] / MPD_LON + ORIGIN[0], position[1] / MPD_LAT + ORIGIN[1]]


def distance(first, second):
    return math.hypot(first[0] - second[0], first[1] - second[1])


def project(point, start, end):
    delta = (end[0] - start[0], end[1] - start[1])
    square = delta[0] ** 2 + delta[1] ** 2
    fraction = max(0.0, min(1.0, ((point[0] - start[0]) * delta[0]
                               + (point[1] - start[1]) * delta[1]) / square)) if square else 0.0
    position = (start[0] + fraction * delta[0], start[1] + fraction * delta[1])
    return distance(point, position), position, fraction


def in_ring(point, ring):
    inside = False
    for start, end in zip(ring, ring[1:]):
        if project(point, start, end)[0] < 1e-7:
            return True
        if (start[1] > point[1]) != (end[1] > point[1]):
            intercept = start[0] + (point[1] - start[1]) * (end[0] - start[0]) / (end[1] - start[1])
            if point[0] < intercept:
                inside = not inside
    return inside


def in_polygon(point, rings):
    return in_ring(point, rings[0]) and not any(in_ring(point, hole) for hole in rings[1:])


def nearest_wall(point, polygons):
    return min((project(point, start, end) for rings in polygons
                for ring in rings for start, end in zip(ring, ring[1:])), key=lambda result: result[0])


def boundary_crossing(start, end, polygons):
    delta = (end[0] - start[0], end[1] - start[1])
    intersections = []
    for rings in polygons:
        for ring in rings:
            for wall_start, wall_end in zip(ring, ring[1:]):
                wall_delta = (wall_end[0] - wall_start[0], wall_end[1] - wall_start[1])
                determinant = delta[0] * wall_delta[1] - delta[1] * wall_delta[0]
                if abs(determinant) < 1e-9:
                    continue
                offset = (wall_start[0] - start[0], wall_start[1] - start[1])
                fraction = (offset[0] * wall_delta[1] - offset[1] * wall_delta[0]) / determinant
                wall_fraction = (offset[0] * delta[1] - offset[1] * delta[0]) / determinant
                if 0 <= fraction <= 1 and 0 <= wall_fraction <= 1:
                    intersections.append((fraction, (start[0] + fraction * delta[0], start[1] + fraction * delta[1])))
    return min(intersections)[1] if intersections else nearest_wall(end, polygons)[1]


def length(positions):
    return sum(distance(first, second) for first, second in zip(positions, positions[1:]))


def simplify(positions, tolerance):
    if len(positions) <= 2:
        return list(positions)
    maximum, split = max((project(position, positions[0], positions[-1])[0], index)
                         for index, position in enumerate(positions[1:-1], 1))
    if maximum <= tolerance:
        return [positions[0], positions[-1]]
    return simplify(positions[:split + 1], tolerance)[:-1] + simplify(positions[split:], tolerance)


class Grid:
    def __init__(self, cell=50.0):
        self.cell = cell
        self.cells = defaultdict(set)

    def add(self, index, positions):
        for cell_x in range(math.floor(min(position[0] for position in positions) / self.cell),
                            math.floor(max(position[0] for position in positions) / self.cell) + 1):
            for cell_y in range(math.floor(min(position[1] for position in positions) / self.cell),
                                math.floor(max(position[1] for position in positions) / self.cell) + 1):
                self.cells[cell_x, cell_y].add(index)

    def near(self, position, radius):
        found = set()
        for cell_x in range(math.floor((position[0] - radius) / self.cell),
                            math.floor((position[0] + radius) / self.cell) + 1):
            for cell_y in range(math.floor((position[1] - radius) / self.cell),
                                math.floor((position[1] + radius) / self.cell) + 1):
                found.update(self.cells.get((cell_x, cell_y), ()))
        return found

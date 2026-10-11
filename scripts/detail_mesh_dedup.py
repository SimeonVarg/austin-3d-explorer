"""Compact authored mesh input without welding rendered faces or rounding coordinates."""
import math
import struct

# Unknown fields may be parallel vertex attributes. Reject them until their
# remapping semantics are explicit, rather than silently losing seams/data.
_MESH_FIELDS = {'id', 'tone', 'vertices', 'triangles', 'minDetail', '_src'}


def deduplicate_detail_meshes(spec):
    """Mutate only vertices/indices; retain triangle order and all source metadata.

    Float64 keys preserve signed zero and distinguish arbitrarily close points.
    The renderer computes a separate normal for each expanded triangle, so input
    index sharing never averages normals. Unreferenced unique vertices remain:
    the renderer also uses the vertex list to determine the building's top.
    """
    removed = 0
    for mesh in spec.get('detailMeshes', []):
        unknown = set(mesh) - _MESH_FIELDS
        if unknown:
            raise ValueError(f"Unsupported detail mesh fields in {mesh.get('id')}: {sorted(unknown)}")
        vertices, triangles = mesh['vertices'], mesh['triangles']
        unique, remap, lookup = [], [], {}
        for point in vertices:
            if len(point) != 3 or any(type(x) not in (int, float) or not math.isfinite(x) for x in point):
                raise ValueError(f"Invalid detail mesh vertex in {mesh.get('id')}")
            key = struct.pack('>ddd', *point)
            if key not in lookup:
                lookup[key] = len(unique)
                unique.append(point)
            remap.append(lookup[key])
        for triangle in triangles:
            if len(triangle) != 3 or any(type(i) is not int or not 0 <= i < len(vertices) for i in triangle):
                raise ValueError(f"Invalid detail mesh triangle in {mesh.get('id')}")
        if len(unique) == len(vertices):
            continue
        mesh['vertices'] = unique
        mesh['triangles'] = [[remap[i] for i in triangle] for triangle in triangles]
        removed += len(vertices) - len(unique)
    return removed
